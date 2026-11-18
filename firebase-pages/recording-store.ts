export type LocalRecording = {
  key: string;
  uid: string;
  id: string;
  meetingId: string;
  item: Record<string, unknown>;
  blob: Blob;
  createdAt: string;
};

const DATABASE = "contactgraph-recordings-v1";
const STORE = "recordings";
const changed = () => window.dispatchEvent(new Event("contactgraph:local-recordings"));

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE, { keyPath: "key" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function operation<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const database = await open();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE, mode);
      const request = run(transaction.objectStore(STORE));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onabort = () => reject(transaction.error ?? new Error("Local recording transaction aborted."));
      transaction.onerror = () => reject(transaction.error ?? request.error ?? new Error("Local recording transaction failed."));
    });
  } finally {
    database.close();
  }
}

const keyFor = (uid: string, id: string) => `${uid}:${id}`;

export async function listLocalRecordings(uid: string): Promise<LocalRecording[]> {
  const rows = await operation("readonly", (store) => store.getAll()) as LocalRecording[];
  return rows.filter((row) => row.uid === uid);
}

export async function getLocalRecording(uid: string, id: string): Promise<LocalRecording | undefined> {
  return operation("readonly", (store) => store.get(keyFor(uid, id))) as Promise<LocalRecording | undefined>;
}

export async function saveLocalRecording(uid: string, item: Record<string, unknown>, blob: Blob): Promise<LocalRecording> {
  const id = String(item.id ?? "");
  const meetingId = String(item.meeting_id ?? "");
  if (!uid || !id || !meetingId) throw new Error("Invalid local recording identity.");
  const previous = await getLocalRecording(uid, id);
  const row: LocalRecording = { key: keyFor(uid, id), uid, id, meetingId, item, blob, createdAt: previous?.createdAt ?? new Date().toISOString() };
  await operation("readwrite", (store) => store.put(row));
  changed();
  return row;
}

export async function deleteLocalRecording(uid: string, id: string): Promise<void> {
  await operation("readwrite", (store) => store.delete(keyFor(uid, id)));
  changed();
}

export async function deleteLocalRecordingsForMeeting(uid: string, meetingId: string): Promise<void> {
  const matches = (await listLocalRecordings(uid)).filter((row) => row.meetingId === meetingId);
  for (const row of matches) await operation("readwrite", (store) => store.delete(row.key));
  if (matches.length) changed();
}

export async function countLocalRecordings(): Promise<number> {
  return operation("readonly", (store) => store.count());
}

export async function deleteLocalRecordingDatabase(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DATABASE);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("Close other ContactGraph tabs before clearing local recordings."));
  });
  changed();
}
