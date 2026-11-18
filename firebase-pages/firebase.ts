import { initializeApp } from "firebase/app";
import { browserLocalPersistence, browserSessionPersistence, getAuth, setPersistence, signOut, type Auth, type Persistence } from "firebase/auth";
import { clearIndexedDbPersistence, initializeFirestore, memoryLocalCache, persistentLocalCache, persistentMultipleTabManager, terminate, type Firestore } from "firebase/firestore";
import { getStorage, type FirebaseStorage } from "firebase/storage";

const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY as string | undefined,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID as string | undefined,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET as string | undefined,
  appId: import.meta.env.VITE_FIREBASE_APP_ID as string | undefined,
};

export const configured = Object.values(config).every((value) => typeof value === "string" && value.length > 0);
const app = configured ? initializeApp(config) : null;
export const auth: Auth | null = app ? getAuth(app) : null;
export const storage: FirebaseStorage | null = app ? getStorage(app) : null;

let trusted = false;
try { trusted = window.localStorage.getItem("contactgraph-trusted-device") === "1"; } catch { /* unavailable browser storage */ }
export const db: Firestore | null = app ? initializeFirestore(app, {
  localCache: trusted ? persistentLocalCache({ tabManager: persistentMultipleTabManager() }) : memoryLocalCache(),
}) : null;

async function clearTrustedData(discardPending = false) {
  const { getPending } = await import("./offline");
  const { countLocalRecordings, deleteLocalRecordingDatabase } = await import("./recording-store");
  if (!discardPending && ((await getPending()).length || (await countLocalRecordings()) > 0)) throw new Error("Unsynced edits or meeting recordings remain on this device.");
  if (db) { await terminate(db); await clearIndexedDbPersistence(db); }
  await new Promise<void>((resolve, reject) => { const request = indexedDB.deleteDatabase("contactgraph-outbox-v1"); request.onsuccess = () => resolve(); request.onerror = () => reject(request.error); request.onblocked = () => reject(new Error("Close other ContactGraph tabs before clearing offline data.")); });
  await deleteLocalRecordingDatabase();
}
export async function secureSignOut(discardPending = false) {
  if (trusted) await clearTrustedData(discardPending);
  if (auth) await signOut(auth);
}
export async function setTrustedDevice(enabled: boolean) {
  if (!enabled && trusted) await secureSignOut();
  window.localStorage.setItem("contactgraph-trusted-device", enabled ? "1" : "0");
  trusted = enabled;
}

export function isTrustedDevice() { return trusted; }

// "Keep me signed in": remember only the Google sign-in on this device (no cached data).
// Without it the sign-in lasts one browser session, which a phone's home-screen app
// loses whenever the system closes it in the background.
let keepSignedIn = false;
try { keepSignedIn = window.localStorage.getItem("contactgraph-keep-signed-in") === "1"; } catch { /* unavailable browser storage */ }
export function keepsSignedIn() { return keepSignedIn; }
export function authPersistence(): Persistence { return trusted || keepSignedIn ? browserLocalPersistence : browserSessionPersistence; }
export async function setKeepSignedIn(enabled: boolean) {
  window.localStorage.setItem("contactgraph-keep-signed-in", enabled ? "1" : "0");
  keepSignedIn = enabled;
  // Moves the current sign-in to the matching storage, so no new sign-in is needed.
  if (auth) await setPersistence(auth, authPersistence());
}

export function requireFirebase() {
  if (!auth || !db) throw new Error("Firebase is not configured for this site.");
  return { auth, db };
}

export function requireFirebaseStorage() {
  if (!storage) throw new Error("Firebase Storage is not configured for this site.");
  return storage;
}
