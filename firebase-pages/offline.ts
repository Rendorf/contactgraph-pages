import { doc, runTransaction } from "firebase/firestore";
import { db, auth, isTrustedDevice } from "./firebase";
import { toast } from "sonner";

export type Pending = { key: string; collection: string; id: string; uid: string; op: "put" | "delete"; item?: Record<string, any>; baseRevision: number; status: "pending" | "conflict"; remote?: Record<string, any> | null; createdAt: string };
const DATABASE = "contactgraph-outbox-v1";
const STORE = "pending";
const changed = () => window.dispatchEvent(new Event("contactgraph:outbox"));

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE, { keyPath: "key" }); };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function operation<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const database = await open();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(STORE, mode);
    const request = run(tx.objectStore(STORE));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    tx.onerror = () => reject(tx.error);
    tx.oncomplete = () => database.close();
  });
}
const keyFor = (collection: string, id: string, uid: string) => `${uid}:${collection}:${id}`;
const currentUid = () => { if (!auth?.currentUser?.uid) throw new Error("Sign in before editing offline."); return auth.currentUser.uid; };
export const getPending = async (): Promise<Pending[]> => {
  if (!isTrustedDevice()) return [];
  const uid = currentUid();
  const all = await operation("readonly", (store) => store.getAll()) as Pending[];
  return all.filter((item) => item.uid === uid);
};
const find = async (collection: string, id: string, uid: string) => operation("readonly", (store) => store.get(keyFor(collection, id, uid))) as Promise<Pending | undefined>;
const save = async (item: Pending) => { await operation("readwrite", (store) => store.put(item)); changed(); };
const discard = async (item: Pending) => { await operation("readwrite", (store) => store.delete(item.key)); changed(); };

export async function queuePut(collection: string, item: Record<string, any>) {
  if (!isTrustedDevice()) throw new Error("Enable trusted-device offline access in Settings before editing without a connection.");
  const uid = currentUid();
  const key = keyFor(collection, item.id, uid);
  const prior = await find(collection, item.id, uid);
  const baseRevision = prior?.baseRevision ?? Number(item.revision ?? 0);
  const { photo_url: _photoUrl, pending_sync: _pending, ...persisted } = item;
  const local = { ...persisted, revision: baseRevision + 1, pending_sync: true, ...(_photoUrl ? { photo_url: _photoUrl } : {}) };
  await save({ key, collection, id: item.id, uid, op: "put", item: persisted, baseRevision, status: "pending", createdAt: prior?.createdAt ?? new Date().toISOString() });
  toast.info("Saved on this device. Sync pending.");
  return local;
}
export async function queueDelete(collection: string, id: string, revision: number) {
  if (!isTrustedDevice()) throw new Error("Enable trusted-device offline access in Settings before editing without a connection.");
  const uid = currentUid();
  const key = keyFor(collection, id, uid);
  const prior = await find(collection, id, uid);
  if (prior?.op === "put" && prior.baseRevision === 0) { await discard(prior); return; }
  await save({ key, collection, id, uid, op: "delete", baseRevision: prior?.baseRevision ?? revision, status: "pending", createdAt: prior?.createdAt ?? new Date().toISOString() });
  toast.info("Deletion saved on this device. Sync pending.");
}
export async function overlay<T extends { id: string }>(collection: string, rows: T[]): Promise<T[]> {
  if (!isTrustedDevice()) return rows;
  const pending = (await getPending()).filter((item) => item.collection === collection);
  const map = new Map(rows.map((item) => [item.id, item]));
  for (const item of pending) {
    if (item.op === "delete") map.delete(item.id);
    else map.set(item.id, { ...item.item, revision: item.baseRevision + 1, pending_sync: true } as unknown as T);
  }
  return [...map.values()];
}
export async function syncPending() {
  if (!navigator.onLine || !db || !auth?.currentUser || !isTrustedDevice()) return;
  for (const item of (await getPending()).filter((value) => value.status === "pending")) {
    const ref = doc(db, item.collection, item.id);
    try {
      const result = await runTransaction(db, async (tx) => {
        const snapshot = await tx.get(ref);
        const remote = snapshot.exists() ? snapshot.data() : null;
        const remoteRevision = Number(remote?.revision ?? 0);
        if (item.op === "delete" && !snapshot.exists()) return { conflict: false, remote: null };
        if (remoteRevision !== item.baseRevision) return { conflict: true, remote };
        if (item.op === "delete") { if (snapshot.exists()) tx.delete(ref); }
        else tx.set(ref, { ...item.item, id: item.id, revision: remoteRevision + 1, updated_at: new Date().toISOString(), updated_by: item.uid });
        return { conflict: false, remote: null };
      });
      if (result.conflict) await save({ ...item, status: "conflict", remote: result.remote });
      else await discard(item);
    } catch (error) {
      // Permission and validation failures stay in the outbox for explicit review.
      if (navigator.onLine) await save({ ...item, status: "conflict", remote: null });
      break;
    }
  }
  changed();
}
export async function resolveConflict(key: string, choice: "mine" | "server") {
  const item = (await getPending()).find((value) => value.key === key && value.status === "conflict");
  if (!item) throw new Error("Conflict no longer exists.");
  if (choice === "server") await discard(item);
  else { await save({ ...item, baseRevision: Number(item.remote?.revision ?? 0), status: "pending", remote: undefined }); await syncPending(); }
  changed();
}
