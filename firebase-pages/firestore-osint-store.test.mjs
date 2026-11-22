import test from "node:test";
import assert from "node:assert/strict";
import { initializeApp, deleteApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { createFirestoreOsintStore } from "../scripts/firestore-osint-store.mjs";

const app = initializeApp({ projectId: "demo-contactgraph-osint-store" }, "osint-store-test");
const firestore = getFirestore(app);
let clock = new Date("2026-11-22T08:00:00.000Z");
const store = createFirestoreOsintStore(firestore, { now: () => new Date(clock), monthlyLimit: 2 });

test("Firestore OSINT store preserves state, deduplicates evidence, and migrates legacy providers", async () => {
  assert.equal((await store.command("snapshot")).settings.enabled, false);
  await store.command("settings-update", { enabled: true, daily_time: "09:30" });
  await store.command("monitor-save", { contact_id: "person-1", query: '"Person One"', enabled: true, providers: ["searxng", "gdelt"], handles: ["person.one"] });
  await store.command("feed-add", { contact_id: "person-1", url: "https://example.org/feed.xml" });
  assert.equal((await store.command("items-save", { contact_id: "person-1", items: [{ url: "https://example.org/news", title: "News" }] })).added, 1);
  assert.equal((await store.command("items-save", { contact_id: "person-1", items: [{ url: "https://example.org/news", title: "Duplicate" }] })).added, 0);
  const snapshot = await store.command("snapshot");
  assert.equal(snapshot.settings.daily_time, "09:30");
  assert.deepEqual(snapshot.monitors[0].providers, ["web", "gdelt"]);
  assert.equal(snapshot.items.length, 1);
  assert.equal((await store.command("contact-reports", { contact_id: "person-1" })).items.length, 1);
  await store.command("transients-save", { type: "candidate", contact_id: "person-1", entries: [{ id: "temporary-1", kind: "photo", source_url: "https://example.org/profile" }] });
  assert.equal((await store.command("transient-get", { type: "candidate", id: "temporary-1" })).contact_id, "person-1");
  await store.command("transient-delete", { id: "temporary-1" });
  assert.equal(await store.command("transient-get", { type: "candidate", id: "temporary-1" }), null);
  await assert.rejects(store.command("feed-add", { contact_id: "person-1", url: "http://127.0.0.1/feed" }), /public HTTPS/);
});

test("daily claims, managed-search budget, and user rate limits are atomic", async () => {
  assert.equal((await store.command("mark-daily", { date: "2026-11-22" })).marked, true);
  assert.equal((await store.command("mark-daily", { date: "2026-11-22" })).marked, false);
  assert.equal((await store.command("budget-consume")).used, 1);
  assert.equal((await store.command("budget-consume")).used, 2);
  await assert.rejects(store.command("budget-consume"), /limit reached/);
  for (let count = 0; count < 5; count++) assert.equal((await store.command("rate-limit-consume", { subject: "user-1" })).allowed, true);
  assert.equal((await store.command("rate-limit-consume", { subject: "user-1" })).allowed, false);
  clock = new Date("2026-11-22T08:01:01.000Z");
  assert.equal((await store.command("rate-limit-consume", { subject: "user-1" })).allowed, true);
});

test.after(async () => { await deleteApp(app); });
