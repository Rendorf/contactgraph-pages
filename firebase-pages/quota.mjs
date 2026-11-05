// Firestore's RESOURCE_EXHAUSTED is a remote service limit. Browser storage
// quota errors must not be mistaken for it because the local outbox may be full.
export function isFirestoreQuotaExceeded(error) {
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
  return code === "resource-exhausted" || code === "firestore/resource-exhausted";
}
