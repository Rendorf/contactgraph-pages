import { readFileSync } from "node:fs";
import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { test, after } from "node:test";

const rules = readFileSync(new URL("./firestore.rules", import.meta.url), "utf8");
const env = await initializeTestEnvironment({ projectId: "demo-contactgraph", firestore: { rules } });
after(async () => { await env.cleanup(); });
await env.withSecurityRulesDisabled(async (context) => {
  const db = context.firestore();
  await db.doc("members/owner@example.com").set({ id: "owner@example.com", email: "owner@example.com", role_id: "owner", active: true });
  await db.doc("members/assistant@example.com").set({ id: "assistant@example.com", email: "assistant@example.com", role_id: "assistant", active: true });
  await db.doc("roles/assistant").set({ id: "assistant", name: "Assistant", permissions: ["contacts.view", "contacts.edit", "meetings.view"] });
  await db.doc("contacts/person-1").set({ id: "person-1", name: "Person One", revision: 1, updated_at: "2026-10-27T00:00:00Z", updated_by: "migration", labels: [] });
});
const google = (email, uid) => env.authenticatedContext(uid, { email, email_verified: true, firebase: { sign_in_provider: "google.com" } }).firestore();
const owner = google("owner@example.com", "owner-uid");
const assistant = google("assistant@example.com", "assistant-uid");
const contact = (id, revision, uid, name = "Person One") => ({ id, name, revision, updated_at: "2026-10-27T01:00:00Z", updated_by: uid, labels: [] });

test("unregistered, anonymous, and password identities cannot read private contacts", async () => {
  await assertFails(env.unauthenticatedContext().firestore().doc("contacts/person-1").get());
  await assertFails(google("stranger@example.com", "stranger-uid").doc("contacts/person-1").get());
  const password = env.authenticatedContext("password-uid", { email: "assistant@example.com", email_verified: true, firebase: { sign_in_provider: "password" } }).firestore();
  await assertFails(password.doc("contacts/person-1").get());
});

test("assistant can read and edit contacts but cannot delete or grant access", async () => {
  await assertSucceeds(assistant.doc("contacts/person-1").get());
  await assertSucceeds(assistant.doc("contacts/person-1").set(contact("person-1", 2, "assistant-uid", "Updated Person")));
  await assertFails(assistant.doc("contacts/person-1").delete());
  await assertFails(assistant.doc("members/new@example.com").set({ id: "new@example.com", email: "new@example.com", role_id: "assistant", active: true }));
  await assertFails(assistant.doc("roles/assistant").set({ id: "assistant", name: "Superuser", permissions: ["contacts.view", "users.manage"] }));
});

test("contact writes reject stale revisions, spoofed IDs, and local-only fields", async () => {
  await assertFails(assistant.doc("contacts/person-1").set(contact("person-1", 2, "assistant-uid", "Stale")));
  await assertFails(assistant.doc("contacts/person-1").set(contact("different-id", 3, "assistant-uid")));
  await assertFails(assistant.doc("contacts/person-1").set({ ...contact("person-1", 3, "assistant-uid"), photo_url: "data:image/png;base64,AA==" }));
});

test("owner may manage assistant access but cannot edit or remove owner account", async () => {
  await assertSucceeds(owner.doc("members/new@example.com").set({ id: "new@example.com", email: "new@example.com", role_id: "assistant", active: true }));
  await assertFails(owner.doc("members/owner@example.com").delete());
  await assertFails(owner.doc("members/owner@example.com").update({ active: false }));
  await assertSucceeds(owner.doc("roles/other").set({ id: "other", name: "Other", permissions: ["contacts.view"] }));
  await assertFails(owner.doc("roles/other").update({ permissions: ["contacts.view", "made.up"] }));
});

test("private photos and unknown collections stay closed", async () => {
  await assertFails(env.unauthenticatedContext().firestore().doc("photo_chunks/person-1_0").get());
  await assertFails(assistant.doc("photo_chunks/person-1_0").set({ id: "person-1_0", contact_id: "person-1", index: 0, total: 1, mime: "text/plain", data: "AA==" }));
  await assertSucceeds(assistant.doc("photo_chunks/person-1_0").set({ id: "person-1_0", contact_id: "person-1", index: 0, total: 1, mime: "image/jpeg", sha256: "0".repeat(64), data: "AA==" }));
  await assertFails(owner.doc("unexpected/private").get());
});
