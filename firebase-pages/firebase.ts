import { initializeApp } from "firebase/app";
import { getAuth, signOut, type Auth } from "firebase/auth";
import { clearIndexedDbPersistence, initializeFirestore, memoryLocalCache, persistentLocalCache, persistentMultipleTabManager, terminate, type Firestore } from "firebase/firestore";

const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY as string | undefined,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID as string | undefined,
  appId: import.meta.env.VITE_FIREBASE_APP_ID as string | undefined,
};

export const configured = Object.values(config).every((value) => typeof value === "string" && value.length > 0);
const app = configured ? initializeApp(config) : null;
export const auth: Auth | null = app ? getAuth(app) : null;

let trusted = false;
try { trusted = window.localStorage.getItem("contactgraph-trusted-device") === "1"; } catch { /* unavailable browser storage */ }
export const db: Firestore | null = app ? initializeFirestore(app, {
  localCache: trusted ? persistentLocalCache({ tabManager: persistentMultipleTabManager() }) : memoryLocalCache(),
}) : null;

async function clearTrustedData(discardPending = false) {
  const { getPending } = await import("./offline");
  if (!discardPending && (await getPending()).length) throw new Error("Unsynced edits remain on this device.");
  if (db) { await terminate(db); await clearIndexedDbPersistence(db); }
  await new Promise<void>((resolve, reject) => { const request = indexedDB.deleteDatabase("contactgraph-outbox-v1"); request.onsuccess = () => resolve(); request.onerror = () => reject(request.error); request.onblocked = () => reject(new Error("Close other ContactGraph tabs before clearing offline data.")); });
}
export async function secureSignOut(discardPending = false) {
  if (trusted) await clearTrustedData(discardPending);
  if (auth) await signOut(auth);
}
export async function setTrustedDevice(enabled: boolean) {
  if (!enabled && trusted) await secureSignOut();
  window.localStorage.setItem("contactgraph-trusted-device", enabled ? "1" : "0");
}

export function isTrustedDevice() { return trusted; }

export function requireFirebase() {
  if (!auth || !db) throw new Error("Firebase is not configured for this site.");
  return { auth, db };
}
