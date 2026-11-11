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
  await db.doc("members/tagger@example.com").set({ id: "tagger@example.com", email: "tagger@example.com", role_id: "tagger", active: true });
  await db.doc("roles/assistant").set({ id: "assistant", name: "Assistant", permissions: ["contacts.view", "contacts.create", "contacts.edit", "meetings.view"] });
  await db.doc("roles/tagger").set({ id: "tagger", name: "Tag editor", permissions: ["contacts.view", "tags.edit"] });
  for (const role of ["merger", "merger-deleter"]) {
    await db.doc(`members/${role}@example.com`).set({ email: `${role}@example.com`, role_id: role, active: true });
    await db.doc(`roles/${role}`).set({ id: role, permissions: ["contacts.view", "contacts.merge", ...(role === "merger-deleter" ? ["contacts.delete"] : [])] });
  }
  await db.doc("contacts/person-1").set({ id: "person-1", name: "Person One", revision: 1, updated_at: "2026-10-27T00:00:00Z", updated_by: "migration", labels: [] });
  await db.doc("contacts/person-2").set({ id: "person-2", name: "Person Two", revision: 1, updated_at: "2026-10-27T00:00:00Z", updated_by: "migration", labels: [], private_note: "Keep this" });
});
const google = (email, uid) => env.authenticatedContext(uid, { email, email_verified: true, firebase: { sign_in_provider: "google.com" } }).firestore();
const owner = google("owner@example.com", "owner-uid");
const assistant = google("assistant@example.com", "assistant-uid");
const tagger = google("tagger@example.com", "tagger-uid");
const contact = (id, revision, uid, name = "Person One") => ({ id, name, revision, updated_at: "2026-10-27T01:00:00Z", updated_by: uid, labels: [] });

test("unregistered, anonymous, and password identities cannot read private contacts", async () => {
  await assertFails(env.unauthenticatedContext().firestore().doc("contacts/person-1").get());
  await assertFails(google("stranger@example.com", "stranger-uid").doc("contacts/person-1").get());
  const password = env.authenticatedContext("password-uid", { email: "assistant@example.com", email_verified: true, firebase: { sign_in_provider: "password" } }).firestore();
  await assertFails(password.doc("contacts/person-1").get());
});

test("approved users can create a contact and unknown users cannot", async () => {
  const fresh = { id: "new-person", name: "New Person", emails: [], phones: [], labels: [], notes: "", birthday: "", sort_order: Date.now(), revision: 1, updated_at: "2026-11-02T00:00:00Z", updated_by: "assistant-uid" };
  await assertFails(env.unauthenticatedContext().firestore().doc("contacts/new-person").set(fresh));
  await assertFails(google("stranger@example.com", "stranger-uid").doc("contacts/new-person").set({ ...fresh, updated_by: "stranger-uid" }));
  await assertFails(assistant.doc("contacts/forged-id").set(fresh));
  await assertSucceeds(assistant.doc("contacts/new-person").set(fresh));
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

test("tag editors can change labels but cannot add or remove unrelated fields", async () => {
  const labelsOnly = { ...contact("person-2", 2, "tagger-uid", "Person Two"), labels: ["Network"], private_note: "Keep this" };
  await assertSucceeds(tagger.doc("contacts/person-2").set(labelsOnly));
  await assertFails(tagger.doc("contacts/person-2").set({ ...labelsOnly, revision: 3, private_note: "unauthorized" }));
  await assertFails(tagger.doc("contacts/person-2").set({ id: "person-2", name: "Person Two", revision: 3, updated_at: labelsOnly.updated_at, updated_by: "tagger-uid" }));
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

test("merge permission cannot delete contacts; an authorized merge is atomic", async () => {
  await owner.doc("contacts/merge-target").set(contact("merge-target", 1, "owner-uid"));
  await owner.doc("contacts/merge-source").set(contact("merge-source", 1, "owner-uid"));
  const mergeOnly = google("merger@example.com", "merger-uid");
  await assertFails(mergeOnly.doc("contacts/merge-source").delete());
  const denied = mergeOnly.batch();
  denied.set(mergeOnly.doc("contacts/merge-target"), contact("merge-target", 2, "merger-uid", "Merged"));
  denied.delete(mergeOnly.doc("contacts/merge-source"));
  await assertFails(denied.commit());
  if ((await owner.doc("contacts/merge-target").get()).data().revision !== 1) throw new Error("Denied merge partially applied");
  const merger = google("merger-deleter@example.com", "merger-deleter-uid");
  const allowed = merger.batch();
  allowed.set(merger.doc("contacts/merge-target"), contact("merge-target", 2, "merger-deleter-uid", "Merged"));
  allowed.delete(merger.doc("contacts/merge-source"));
  await assertSucceeds(allowed.commit());
});

test("photos require canonical ownership, a surviving contact, and a valid digest", async () => {
  const photo = (contactId, index = 0) => ({ id: `${contactId}_${index}`, contact_id: contactId, index, total: 2, mime: "image/jpeg", sha256: "a".repeat(64), data: "AA==" });
  await assertFails(assistant.doc("photo_chunks/missing_0").set(photo("missing")));
  await assertFails(assistant.doc("photo_chunks/wrong-id").set({ ...photo("person-1"), id: "wrong-id" }));
  await assertFails(assistant.doc("photo_chunks/person-1_0").set({ ...photo("person-1"), contact_id: "person-2" }));
  await assertFails(assistant.doc("photo_chunks/person-1_0").set({ ...photo("person-1"), index: 1 }));
  await assertFails(assistant.doc("photo_chunks/person-1_0").set({ ...photo("person-1"), sha256: "z".repeat(64) }));
  const create = assistant.batch();
  create.set(assistant.doc("contacts/photo-new"), contact("photo-new", 1, "assistant-uid"));
  create.set(assistant.doc("photo_chunks/photo-new_0"), photo("photo-new"));
  await assertSucceeds(create.commit());
  const orphan = owner.batch();
  orphan.delete(owner.doc("contacts/photo-new"));
  orphan.set(owner.doc("photo_chunks/photo-new_1"), photo("photo-new", 1));
  await assertFails(orphan.commit());
  // Cleanup must remain possible even after legacy data lost its contact.
  await env.withSecurityRulesDisabled(async (context) => context.firestore().doc("contacts/photo-new").delete());
  await assertSucceeds(assistant.doc("photo_chunks/photo-new_0").delete());
});

test("three-way sync requests are authorized, single-flight, and cannot forge results", async () => {
  const path = "sync_control/threeway";
  const request = { id: "threeway", status: "queued", request_id: "11111111-1111-4111-8111-111111111111", requested_at: "2026-11-04T10:00:00.000Z", requested_by: "owner-uid" };
  await assertFails(env.unauthenticatedContext().firestore().doc(path).get());
  await assertFails(assistant.doc(path).get());
  await assertFails(assistant.doc(path).set({ ...request, requested_by: "assistant-uid" }));
  await assertFails(owner.doc(path).set({ ...request, requested_by: "assistant-uid" }));
  await assertFails(owner.doc(path).set({ ...request, result: { contacts: 999 } }));
  await assertSucceeds(owner.doc(path).set(request));
  await assertFails(owner.doc(path).update({ request_id: "22222222-2222-4222-8222-222222222222" }));
  await assertFails(owner.doc(path).update({ status: "succeeded", result: { contacts: 1 } }));
  await env.withSecurityRulesDisabled(async (context) => context.firestore().doc(path).update({ status: "succeeded" }));
  await assertSucceeds(owner.doc(path).update({ status: "queued", request_id: "22222222-2222-4222-8222-222222222222", requested_at: "2026-11-04T11:00:00.000Z", requested_by: "owner-uid" }));
  await env.withSecurityRulesDisabled(async (context) => context.firestore().doc(path).set({ id: "threeway", status: "idle", worker_seen_at: "2026-11-04T11:00:00.000Z" }));
  await assertSucceeds(owner.doc(path).update({ status: "queued", request_id: "33333333-3333-4333-8333-333333333333", requested_at: "2026-11-04T12:00:00.000Z", requested_by: "owner-uid" }));
});

test("canvas Kanban validates board-local columns and enforces existing permissions", async () => {
  const board = { id: "kanban-board", title: "Board", nodes: [], revision: 1, updated_at: "2026-11-06T00:00:00Z", updated_by: "owner-uid",
    kanban: { columns: { todo: "To do" }, column_order: ["todo"], assignments: {}, card_order: [] } };
  await assertFails(assistant.doc("canvases/kanban-board").set({ ...board, updated_by: "assistant-uid" }));
  await assertFails(env.unauthenticatedContext().firestore().doc("canvases/kanban-board").set(board));
  await assertSucceeds(owner.doc("canvases/kanban-board").set(board));
  const updated = { ...board, revision: 2 };
  await assertFails(owner.doc("canvases/kanban-board").set({ ...updated, kanban: { ...board.kanban, assignments: { card: "other-board-status" } } }));
  await assertFails(owner.doc("canvases/kanban-board").set({ ...updated, kanban: { ...board.kanban, column_order: ["todo", "todo"] } }));
  await assertFails(owner.doc("canvases/kanban-board").set({ ...updated, kanban: { ...board.kanban, columns: { todo: 42 } } }));
  await assertSucceeds(owner.doc("canvases/kanban-board").set({ ...updated, kanban: { ...board.kanban, columns: { todo: "Ready" } } }));
});
