import assert from "node:assert/strict";
import test from "node:test";
import { paginateTimeline, timelineEntries } from "./contact-timeline.mjs";

test("timeline includes only the requested contact and sorts newest first", () => {
  const items = timelineEntries({
    contactId: "contact-a",
    meetings: [{ id: "m1", contact_id: "contact-a", date: "2026-10-10", insights: "Discussed launch" }, { id: "m2", contact_id: "contact-b", date: "2026-11-10", insights: "Private" }],
    followups: { actions: [{ id: "f1", contact_id: "contact-a", due_date: "2026-11-01", title: "Reconnect", status: "open" }] },
    messages: [{ sequence: 2, contact_id: "contact-a", created_at: "2026-09-01T10:00:00Z", content: "Synthetic greeting", status: "generated" }],
  });
  assert.deepEqual(items.map(item => item.id), ["followup:f1", "meeting:m1", "message:2"]);
  assert.equal(items.some(item => item.summary === "Private"), false);
});

test("timeline pagination is bounded and cursor-based", () => {
  const entries = timelineEntries({ contactId: "contact-a", meetings: [
    { id: "m3", contact_id: "contact-a", date: "2026-11-03", insights: "Three" },
    { id: "m2", contact_id: "contact-a", date: "2026-11-02", insights: "Two" },
    { id: "m1", contact_id: "contact-a", date: "2026-11-01", insights: "One" },
  ] });
  const first = paginateTimeline(entries, 2, null);
  const second = paginateTimeline(entries, 2, first.next_cursor);
  assert.deepEqual(first.items.map(item => item.id), ["meeting:m3", "meeting:m2"]);
  assert.deepEqual(second.items.map(item => item.id), ["meeting:m1"]);
  assert.equal(second.next_cursor, null);
  assert.throws(() => paginateTimeline(entries, 2, "not-a-real-cursor"), /Invalid timeline cursor/);
});
