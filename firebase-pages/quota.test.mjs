import assert from "node:assert/strict";
import test from "node:test";
import { isFirestoreQuotaExceeded } from "./quota.mjs";

test("recognizes Firestore's exhausted read quota", () => {
  assert.equal(isFirestoreQuotaExceeded({ code: "resource-exhausted", message: "Quota exceeded." }), true);
  assert.equal(isFirestoreQuotaExceeded({ code: "firestore/resource-exhausted" }), true);
});

test("does not treat browser storage or permission failures as a remote quota", () => {
  assert.equal(isFirestoreQuotaExceeded({ name: "QuotaExceededError", code: 22, message: "Quota exceeded." }), false);
  assert.equal(isFirestoreQuotaExceeded({ code: "permission-denied" }), false);
  assert.equal(isFirestoreQuotaExceeded(new Error("Quota exceeded.")), false);
});
