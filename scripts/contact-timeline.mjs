const sourceOrder = { meeting: 0, followup: 1, message: 2, occasion: 3 };

function text(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function entryDate(value) {
  const raw = text(value);
  if (!/^\d{4}-\d{2}-\d{2}(?:[T ][0-9:.+-Z]+)?$/.test(raw)) return "";
  return raw.includes("T") ? raw : `${raw.slice(0, 10)}T12:00:00Z`;
}

/** @param {{contactId:string, meetings?:any[], followups?:{actions?:any[]}, messages?:any[], states?:any[]}} input */
export function timelineEntries({ contactId, meetings = [], followups = {}, messages = [], states = [] }) {
  const entries = [];
  for (const meeting of meetings) {
    if (!(meeting.contact_ids ?? [meeting.contact_id]).includes(contactId)) continue;
    const occurredAt = entryDate(meeting.date);
    if (!occurredAt) continue;
    entries.push({ id: `meeting:${meeting.id}`, source: "meeting", occurred_at: occurredAt, title: "Meeting", summary: text(meeting.insights, "Meeting note"), status: "recorded" });
  }
  for (const action of followups.actions ?? []) {
    if (action.contact_id !== contactId) continue;
    const occurredAt = entryDate(action.completed_on || action.due_date || action.updated_at || action.created_at);
    if (!occurredAt) continue;
    entries.push({ id: `followup:${action.id}`, source: "followup", occurred_at: occurredAt, title: text(action.title, "Follow-up"), summary: action.completed_on ? "Completed follow-up" : "Relationship reminder", status: action.status || (action.completed_on ? "done" : "open") });
  }
  for (const message of messages) {
    if (message.contact_id !== contactId) continue;
    const occurredAt = entryDate(message.sent_at || message.created_at);
    if (!occurredAt) continue;
    entries.push({ id: `message:${message.sequence}`, source: "message", occurred_at: occurredAt, title: text(message.holiday_title || message.holiday_id, "Message"), summary: text(message.content, "Saved message"), status: message.status || "generated" });
  }
  for (const state of states) {
    if (state.event_type !== "birthday" || state.source_id !== contactId) continue;
    const occurredAt = entryDate(state.changed_at || state.occurrence_date);
    if (!occurredAt) continue;
    entries.push({ id: `occasion:${state.id}`, source: "occasion", occurred_at: occurredAt, title: "Birthday occasion", summary: state.status === "handled" ? "Marked handled" : state.status === "no_action" ? "No action needed" : "Reopened", status: state.status });
  }
  return entries.sort((a, b) => b.occurred_at.localeCompare(a.occurred_at) || (sourceOrder[a.source] ?? 9) - (sourceOrder[b.source] ?? 9) || a.id.localeCompare(b.id));
}

/** @param {{occurred_at:string,id:string}} entry */
export function encodeTimelineCursor(entry) {
  const bytes = new TextEncoder().encode(JSON.stringify({ occurred_at: entry.occurred_at, id: entry.id }));
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

/** @param {string | null | undefined} value */
export function decodeTimelineCursor(value) {
  if (!value) return null;
  if (typeof value !== "string" || value.length > 500 || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("Invalid timeline cursor.");
  try {
    const padded = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
    const parsed = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(padded), character => character.charCodeAt(0))));
    if (!parsed || typeof parsed.occurred_at !== "string" || typeof parsed.id !== "string" || parsed.id.length > 300 || !entryDate(parsed.occurred_at)) throw new Error();
    return parsed;
  } catch {
    throw new Error("Invalid timeline cursor.");
  }
}

/** @param {any[]} entries @param {number} limit @param {string | null | undefined} cursorValue */
export function paginateTimeline(entries, limit, cursorValue) {
  const cursor = decodeTimelineCursor(cursorValue);
  const start = cursor ? entries.findIndex((entry) => entry.occurred_at === cursor.occurred_at && entry.id === cursor.id) + 1 : 0;
  if (cursor && start === 0) throw new Error("Invalid timeline cursor.");
  const items = entries.slice(start, start + limit);
  const hasMore = start + items.length < entries.length;
  return { items, next_cursor: hasMore && items.length ? encodeTimelineCursor(items.at(-1)) : null };
}
