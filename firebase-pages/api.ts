import { doc, getDoc, collection, onSnapshot, runTransaction, setDoc, writeBatch } from "firebase/firestore";
import { requireFirebase, secureSignOut } from "./firebase";
import permissionModules from "./permission-catalog.json";
import { overlay, queueDelete, queuePut, syncPending } from "./offline";

type Json = Record<string, any>;
type Item = Json & { id: string; revision?: number };
const originalFetch = window.fetch.bind(window);
const knownRevisions = new Map<string, number>();
const live = new Map<string, { rows: Item[]; ready: Promise<void>; stop: () => void }>();
const cacheKey = (name: string, id: string) => `${name}/${id}`;
const networkFailure = (error: unknown) => !navigator.onLine || (typeof error === "object" && error !== null && "code" in error && ["unavailable", "deadline-exceeded", "cancelled"].includes(String(error.code)));
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const errorResponse = (error: unknown) => response({ error: error instanceof Error ? error.message : "Request failed" }, 400);
const cleanId = (value: string) => {
  if (!value || value.length > 200 || value.includes("/") || value === "." || value === "..") throw new Error("Invalid record ID.");
  return value;
};
const parse = (options?: RequestInit): Json => {
  const body = JSON.parse(String(options?.body ?? "{}"));
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("Invalid request body.");
  return body;
};
const online = () => { if (!navigator.onLine) throw new Error("Connect to the internet for this action."); };
const readAll = async (name: string): Promise<Item[]> => {
  const { db } = requireFirebase();
  let entry = live.get(name);
  if (!entry) {
    let resolveReady!: () => void;
    let rejectReady!: (error: Error) => void;
    let initial = true;
    const ready = new Promise<void>((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
    entry = { rows: [], ready, stop: () => {} };
    live.set(name, entry);
    const current = entry;
    current.stop = onSnapshot(collection(db, name), (snapshot) => {
      current.rows = snapshot.docs.map((item) => ({ ...item.data(), id: item.id })) as Item[];
      current.rows.forEach((item) => knownRevisions.set(cacheKey(name, item.id), Number(item.revision ?? 0)));
      if (initial) { initial = false; resolveReady(); }
      else window.dispatchEvent(new Event(name === "contacts" || name === "photo_chunks" ? "contactgraph:sync" : `contactgraph:collection:${name}`));
    }, (cause) => { live.delete(name); rejectReady(cause); });
  }
  await entry.ready;
  const rows = entry.rows.map((item) => ({ ...item }));
  if (name === "contacts") rows.sort((a, b) => Number(a.sort_order ?? Number.MAX_SAFE_INTEGER) - Number(b.sort_order ?? Number.MAX_SAFE_INTEGER) || String(a.name).localeCompare(String(b.name)));
  return rows;
};
const readOne = async (name: string, id: string): Promise<Item | null> => {
  const { db } = requireFirebase();
  const snapshot = await getDoc(doc(db, name, cleanId(id)));
  if (!snapshot.exists()) return null;
  const item = { ...snapshot.data(), id: snapshot.id } as Item;
  knownRevisions.set(cacheKey(name, item.id), Number(item.revision ?? 0));
  return item;
};
const put = async (name: string, item: Item, create: boolean) => {
  if (!navigator.onLine) return queuePut(name, item);
  const { db, auth } = requireFirebase();
  const id = cleanId(String(item.id));
  const ref = doc(db, name, id);
  let saved: Item;
  try { saved = await runTransaction(db, async (tx) => {
    const previous = await tx.get(ref);
    if (create && previous.exists()) throw new Error("This record already exists. Refresh the list.");
    if (!create && !previous.exists()) throw new Error("This record was deleted on another device. Refresh the list.");
    const prior = previous.data();
    if (!create && Number(item.revision ?? 0) !== Number(prior?.revision ?? 0)) throw new Error("This record changed on another device. Copy your edits, refresh, and review the newer version.");
    const { photo_url: _photoUrl, ...persisted } = item;
    const next = { ...persisted, id, revision: Number(prior?.revision ?? 0) + 1, updated_at: new Date().toISOString(), updated_by: auth.currentUser?.uid ?? "" };
    tx.set(ref, next);
    return _photoUrl ? { ...next, photo_url: _photoUrl } : next;
  }); } catch (error) { if (networkFailure(error)) return queuePut(name, item); throw error; }
  knownRevisions.set(cacheKey(name, id), Number(saved.revision));
  return saved;
};
const remove = async (name: string, id: string) => {
  const { db } = requireFirebase();
  id = cleanId(id);
  const expected = knownRevisions.get(cacheKey(name, id));
  if (!navigator.onLine) { if (expected === undefined) throw new Error("Open this record online before deleting it offline."); await queueDelete(name, id, expected); return; }
  try {
    await runTransaction(db, async (tx) => {
      const ref = doc(db, name, id);
      const snapshot = await tx.get(ref);
      if (!snapshot.exists()) return;
      if (expected !== undefined && Number(snapshot.data().revision ?? 0) !== expected) throw new Error("This record changed on another device. Refresh before deleting.");
      tx.delete(ref);
    });
    knownRevisions.delete(cacheKey(name, id));
  } catch (error) { if (networkFailure(error) && expected !== undefined) { await queueDelete(name, id, expected); return; } throw error; }
};
const readRows = async (name: string) => overlay(name, await readAll(name));
const todayBaku = () => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Baku", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts().map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
};
const addDays = (date: string, count: number) => new Date(Date.parse(`${date}T12:00:00Z`) + count * 86400000).toISOString().slice(0, 10);
async function followupsView() {
  const [contacts, meetings, actions, settings] = await Promise.all([readRows("contacts"), readRows("meetings"), readRows("followup_actions"), readRows("followup_settings")]);
  const byId = new Map(contacts.map((item) => [item.id, item]));
  const lastMeetings = new Map<string, Item>();
  for (const item of meetings.sort((a, b) => String(b.date).localeCompare(String(a.date)))) for (const id of (item.contact_ids ?? [item.contact_id])) if (!lastMeetings.has(id)) lastMeetings.set(id, item);
  const today = todayBaku();
  const weekday = (new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7;
  const weekEnd = addDays(today, 6 - weekday);
  const settingsById = Object.fromEntries(settings.map((item) => [item.id, item]));
  const active = actions.filter((item) => item.status !== "done" && !item.completed_at).map((item) => ({ ...item, contact: byId.get(item.contact_id), last_meeting: lastMeetings.get(item.contact_id) ?? null })).filter((item) => item.contact);
  const openContacts = new Set(active.map((item: Json) => item.contact_id));
  const completed = new Map<string, string>();
  for (const item of actions) if (item.status === "done" || item.completed_at) {
    const date = String(item.completed_on || item.completed_at || "").slice(0, 10);
    if (date > (completed.get(item.contact_id) || "")) completed.set(item.contact_id, date);
  }
  const suggestions = [] as Json[];
  for (const contact of contacts) {
    if (!contact.labels?.includes("Net") || openContacts.has(contact.id)) continue;
    const lastMeeting = lastMeetings.get(contact.id);
    const lastActivity = [String(lastMeeting?.date ?? ""), completed.get(contact.id) || ""].sort().at(-1) || "";
    if (!lastActivity) continue;
    const setting = settingsById[contact.id] || {};
    if (setting.dismissed_activity_on && lastActivity <= setting.dismissed_activity_on) continue;
    if (setting.snoozed_until && setting.snoozed_until > today) continue;
    const cadence = Number(setting.cadence_days || 30);
    const due = [addDays(lastActivity, cadence), setting.snoozed_until || ""].sort().at(-1)!;
    if (due <= weekEnd) suggestions.push({ contact_id: contact.id, contact, due_date: due, last_activity: lastActivity, cadence_days: cadence, last_meeting: lastMeeting ?? null });
  }
  suggestions.sort((a, b) => a.due_date.localeCompare(b.due_date) || a.contact.name.localeCompare(b.contact.name));
  return { today, week_end: weekEnd, actions: active, suggestions, settings: settingsById };
}
const refreshContacts = () => window.dispatchEvent(new Event("contactgraph:sync"));
async function batchContacts(ids: string[], transform: (item: Item) => Item | null) {
  online();
  if (!ids.length || ids.length > 5000 || ids.some((id) => typeof id !== "string")) throw new Error("Choose 1 to 5000 contacts.");
  const { db, auth } = requireFirebase();
  const unique = [...new Set(ids.map(cleanId))];
  let changed = 0;
  for (let offset = 0; offset < unique.length; offset += 4) {
    const refs = unique.slice(offset, offset + 4).map((id) => doc(db, "contacts", id));
    changed += await runTransaction(db, async (tx) => {
      const selected = await Promise.all(refs.map((ref) => tx.get(ref)));
      let writes = 0;
      for (let index = 0; index < selected.length; index++) {
        const snapshot = selected[index];
        if (!snapshot.exists()) continue;
        const item = { ...snapshot.data(), id: snapshot.id } as Item;
        const next = transform(item);
        if (next === item) continue;
        if (!next) tx.delete(refs[index]);
        else {
          const { photo_url: _photoUrl, pending_sync: _pending, ...persisted } = next;
          tx.set(refs[index], { ...persisted, revision: Number(item.revision ?? 0) + 1, updated_at: new Date().toISOString(), updated_by: auth.currentUser?.uid ?? "" });
        }
        writes++;
      }
      return writes;
    });
  }
  refreshContacts();
  return changed;
}
async function mergeContacts(body: Json): Promise<Item> {
  online();
  const ids = body.source_ids;
  const targetId = body.target_id;
  if (!Array.isArray(ids) || ids.length < 2 || ids.length > 20 || ids.some((id) => typeof id !== "string") || new Set(ids).size !== ids.length || !ids.includes(targetId) || body.contact?.id !== targetId || typeof body.contact.name !== "string" || !body.contact.name.trim()) throw new Error("Choose distinct contacts and a valid surviving contact.");
  ids.forEach(cleanId);
  const sources = new Set(ids.filter((id) => id !== targetId));
  const { db, auth } = requireFirebase();
  const [meetings, actions, settings, canvases, messages, photos] = await Promise.all(["meetings", "followup_actions", "followup_settings", "canvases", "holiday_messages", "photo_chunks"].map(readAll));
  const related: Array<{ name: string; item: Item }> = [];
  for (const item of meetings) if ((item.contact_ids ?? [item.contact_id]).some((id: string) => sources.has(id))) related.push({ name: "meetings", item });
  for (const item of actions) if (sources.has(item.contact_id)) related.push({ name: "followup_actions", item });
  for (const item of settings) if (sources.has(item.id)) related.push({ name: "followup_settings", item });
  for (const item of canvases) if (item.nodes?.some((node: Json) => node.contact_ids?.some((id: string) => sources.has(id)))) related.push({ name: "canvases", item });
  for (const item of messages) if (sources.has(item.contact_id)) related.push({ name: "holiday_messages", item });
  for (const item of photos) if (sources.has(item.contact_id) || item.contact_id === targetId) related.push({ name: "photo_chunks", item });
  if (related.length + ids.length > 220) throw new Error("This merge has too many linked records for one atomic operation. Review it in the local app.");
  const contactRefs = ids.map((id: string) => doc(db, "contacts", id));
  const relatedRefs = related.map(({ name, item }) => doc(db, name, item.id));
  const targetSettingsRef = doc(db, "followup_settings", targetId);
  const saved = await runTransaction(db, async (tx) => {
    const [contactSnaps, relatedSnaps, targetSettings] = await Promise.all([
      Promise.all(contactRefs.map((ref) => tx.get(ref))),
      Promise.all(relatedRefs.map((ref) => tx.get(ref))),
      tx.get(targetSettingsRef),
    ]);
    if (contactSnaps.some((snapshot) => !snapshot.exists())) throw new Error("A selected contact changed or was deleted. Refresh first.");
    const current = new Map(contactSnaps.map((snapshot) => [snapshot.id, snapshot.data()!]));
    for (const expected of body.expected_contacts ?? []) if (Number(expected?.revision ?? 0) !== Number(current.get(expected?.id)?.revision ?? -1)) throw new Error("A duplicate changed on another device. Refresh first.");
    const oldTarget = current.get(targetId)!;
    if (Number(body.contact.revision ?? 0) !== Number(oldTarget.revision ?? 0)) throw new Error("The surviving contact changed on another device. Refresh first.");
    if (relatedSnaps.some((snapshot) => !snapshot.exists())) throw new Error("Linked data changed on another device. Refresh first.");
    const updatedAt = new Date().toISOString();
    const updatedBy = auth.currentUser?.uid ?? "";
    const { photo_url: _photoUrl, ...persisted } = body.contact;
    const final = { ...persisted, revision: Number(oldTarget.revision) + 1, updated_at: updatedAt, updated_by: updatedBy };
    tx.set(contactRefs[ids.indexOf(targetId)], final);
    for (let index = 0; index < ids.length; index++) if (ids[index] !== targetId) tx.delete(contactRefs[index]);
    const photoOwner = final.photo_file ? ids.find((id: string) => current.get(id)?.photo_file === final.photo_file) : undefined;
    const existingPhoto = related.filter((row) => row.name === "photo_chunks");
    for (let index = 0; index < related.length; index++) {
      const { name, item } = related[index];
      const ref = relatedRefs[index];
      const value = relatedSnaps[index].data()!;
      const meta = { revision: Number(value.revision ?? 0) + 1, updated_at: updatedAt, updated_by: updatedBy };
      if (name === "meetings") {
        const contactIds = [...new Set((value.contact_ids ?? [value.contact_id]).map((id: string) => sources.has(id) ? targetId : id))];
        tx.set(ref, { ...value, ...meta, contact_id: contactIds[0], contact_ids: contactIds });
      } else if (name === "followup_actions" || name === "holiday_messages") {
        tx.set(ref, { ...value, ...meta, contact_id: targetId, ...(name === "holiday_messages" ? { contact_name: final.name } : {}) });
      } else if (name === "canvases") {
        tx.set(ref, { ...value, ...meta, nodes: value.nodes.map((node: Json) => ({ ...node, contact_ids: [...new Set((node.contact_ids ?? []).map((id: string) => sources.has(id) ? targetId : id))] })) });
      } else if (name === "followup_settings") {
        tx.delete(ref);
        if (!targetSettings.exists()) tx.set(targetSettingsRef, { ...value, id: targetId, revision: 1, updated_at: updatedAt, updated_by: updatedBy });
      }
    }
    if (photoOwner !== targetId) {
      const chosen = existingPhoto.filter((row) => row.item.contact_id === photoOwner);
      if (photoOwner && !chosen.length) throw new Error("Chosen photo is unavailable. Refresh first.");
      const chosenByIndex = new Map(chosen.map((row) => [row.item.index, row.item]));
      const targetChunks = existingPhoto.filter((row) => row.item.contact_id === targetId);
      const targetIndexes = new Set(targetChunks.map((row) => row.item.index));
      for (const row of targetChunks) {
        const replacement = chosenByIndex.get(row.item.index);
        const ref = doc(db, "photo_chunks", row.item.id);
        if (replacement) tx.set(ref, { ...replacement, id: row.item.id, contact_id: targetId });
        else tx.delete(ref);
      }
      for (const row of chosen) if (!targetIndexes.has(row.item.index)) {
        const id = `${targetId}_${row.item.index}`;
        tx.set(doc(db, "photo_chunks", id), { ...row.item, id, contact_id: targetId });
      }
    }
    for (const row of existingPhoto) if (row.item.contact_id !== targetId) tx.delete(doc(db, "photo_chunks", row.item.id));
    return _photoUrl ? { ...final, photo_url: _photoUrl } : final;
  });
  refreshContacts();
  return saved;
}
async function deleteContact(id: string, expectedRevision?: number) {
  online();
  id = cleanId(id);
  const { db, auth } = requireFirebase();
  const [meetings, actions, settings, canvases, photos] = await Promise.all(["meetings", "followup_actions", "followup_settings", "canvases", "photo_chunks"].map(readAll));
  const related: Array<{ name: string; item: Item }> = [];
  for (const item of meetings) if ((item.contact_ids ?? [item.contact_id]).includes(id)) related.push({ name: "meetings", item });
  for (const item of actions) if (item.contact_id === id) related.push({ name: "followup_actions", item });
  for (const item of settings) if (item.id === id) related.push({ name: "followup_settings", item });
  for (const item of canvases) if (item.nodes?.some((node: Json) => node.contact_ids?.includes(id))) related.push({ name: "canvases", item });
  for (const item of photos) if (item.contact_id === id) related.push({ name: "photo_chunks", item });
  if (related.length > 180) throw new Error("This contact has too many linked records to delete atomically. Review it in the local app.");
  const ref = doc(db, "contacts", id);
  const linkedRefs = related.map((row) => doc(db, row.name, row.item.id));
  const deleted = await runTransaction(db, async (tx) => {
    const [contact, linked] = await Promise.all([tx.get(ref), Promise.all(linkedRefs.map((item) => tx.get(item)))]);
    if (!contact.exists()) return false;
    if (expectedRevision !== undefined && Number(contact.data().revision ?? 0) !== expectedRevision) throw new Error("This contact changed on another device. Refresh first.");
    if (linked.some((item) => !item.exists())) throw new Error("Linked data changed on another device. Refresh first.");
    const now = new Date().toISOString();
    const updatedBy = auth.currentUser?.uid ?? "";
    for (let index = 0; index < related.length; index++) {
      const { name } = related[index];
      const value = linked[index].data()!;
      const linkedRef = linkedRefs[index];
      if (name === "meetings") {
        const ids = (value.contact_ids ?? [value.contact_id]).filter((participant: string) => participant !== id);
        if (!ids.length) tx.delete(linkedRef);
        else tx.set(linkedRef, { ...value, contact_id: ids[0], contact_ids: ids, revision: Number(value.revision ?? 0) + 1, updated_at: now, updated_by: updatedBy });
      } else if (name === "canvases") {
        tx.set(linkedRef, { ...value, nodes: value.nodes.map((node: Json) => ({ ...node, contact_ids: (node.contact_ids ?? []).filter((contactId: string) => contactId !== id) })), revision: Number(value.revision ?? 0) + 1, updated_at: now, updated_by: updatedBy });
      } else tx.delete(linkedRef);
    }
    tx.delete(ref);
    return true;
  });
  refreshContacts();
  return deleted;
}

async function route(url: URL, options?: RequestInit): Promise<Response> {
  const path = decodeURIComponent(url.pathname);
  const method = options?.method?.toUpperCase() ?? "GET";
  try {
    if (path === "/api/auth/logout" && method === "POST") { await secureSignOut(parse(options).discard_pending === true); resetFirebaseApi(); return response({ ok: true }); }
    if (path === "/api/auth/config") return response({ mode: "google" });
    if (path === "/api/auth/admin" && method === "GET") {
      const [members, roles] = await Promise.all([readAll("members"), readAll("roles")]);
      return response({
        users: members.map((member) => ({ ...member, email: member.email || member.id, must_change_password: false, passkey_count: 0 })),
        roles, permission_modules: permissionModules,
        available_permissions: permissionModules.flatMap((module) => module.permissions.map((permission) => permission.key)),
      });
    }
    if (path === "/api/auth/users" && method === "PUT") {
      online();
      const body = parse(options);
      const email = String(body.email ?? "").trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 200) throw new Error("Enter a valid Google email.");
      if (body.role_id === "owner" || typeof body.role_id !== "string" || !await readOne("roles", body.role_id)) throw new Error("Choose a valid non-owner role.");
      if (typeof body.display_name !== "string" || !body.display_name.trim() || typeof body.username !== "string" || !body.username.trim()) throw new Error("Enter a username and display name.");
      const { db } = requireFirebase();
      const prior = await readOne("members", email);
      if (prior?.role_id === "owner") throw new Error("Owner account cannot be edited here.");
      const account = { id: email, email, username: body.username.trim(), display_name: body.display_name.trim(), role_id: body.role_id, active: body.active !== false };
      if (body.id && body.id !== email) {
        const old = await readOne("members", cleanId(String(body.id)));
        if (!old || old.role_id === "owner" || prior) throw new Error("Email change conflicts with an existing account.");
        const batch = writeBatch(db);
        batch.set(doc(db, "members", email), account);
        batch.delete(doc(db, "members", old.id));
        await batch.commit();
      } else await setDoc(doc(db, "members", email), account);
      return response({ ok: true });
    }
    if (path === "/api/auth/roles" && method === "PUT") {
      online();
      const body = parse(options);
      const id = cleanId(String(body.id || crypto.randomUUID()));
      const allowedKeys = new Set(permissionModules.flatMap((module) => module.permissions.map((permission) => permission.key)));
      if (id === "owner" || typeof body.name !== "string" || !body.name.trim() || !Array.isArray(body.permissions) || !body.permissions.includes("contacts.view") || body.permissions.some((permission: unknown) => typeof permission !== "string" || !allowedKeys.has(permission))) throw new Error("Invalid role or permissions.");
      const { db } = requireFirebase();
      await setDoc(doc(db, "roles", id), { id, name: body.name.trim(), permissions: [...new Set(body.permissions)] });
      return response({ ok: true });
    }
    if (path === "/api/contacts/overrides" && method === "GET") {
      const [contacts, chunks] = await Promise.all([readRows("contacts"), readAll("photo_chunks")]);
      const byContact = new Map<string, Item[]>();
      for (const chunk of chunks) {
        if (!byContact.has(chunk.contact_id)) byContact.set(chunk.contact_id, []);
        byContact.get(chunk.contact_id)!.push(chunk);
      }
      for (const contact of contacts) {
        const parts = byContact.get(contact.id);
        if (parts?.length && parts.length === parts[0].total) {
          try {
            const base64 = parts.sort((a, b) => a.index - b.index).map((part) => part.data).join("");
            const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
            const digest = await crypto.subtle.digest("SHA-256", bytes);
            const sha256 = [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
            if (sha256 === parts[0].sha256) contact.photo_url = `data:${parts[0].mime};base64,${base64}`;
          } catch { /* An invalid photo must not hide the contact directory. */ }
        }
      }
      return response({ contacts });
    }
    if (path === "/api/contacts" && method === "POST") {
      const item = parse(options) as Item;
      if (typeof item.name !== "string" || !item.name.trim() || item.name.length > 300) throw new Error("Enter a valid contact name.");
      item.sort_order ??= Date.now();
      return response({ contact: await put("contacts", item, true) });
    }
    const contact = /^\/api\/contacts\/([^/]+)$/.exec(path);
    if (contact) {
      const id = cleanId(contact[1]);
      if (method === "DELETE") { await deleteContact(id, knownRevisions.get(cacheKey("contacts", id))); return response({ deleted: true }); }
      if (method === "PUT") { const item = parse(options) as Item; if (item.id !== id || typeof item.name !== "string" || !item.name.trim() || item.name.length > 300) throw new Error("Invalid contact."); return response({ contact: await put("contacts", item, false) }); }
    }
    if (path === "/api/contacts/bulk" && method === "POST") {
      const body = parse(options);
      if (!Array.isArray(body.ids)) throw new Error("Choose contacts first.");
      if (body.action === "delete") { online(); let changed = 0; for (const id of [...new Set(body.ids)]) if (await deleteContact(id, knownRevisions.get(cacheKey("contacts", id)))) changed++; return response({ changed }); }
      if (body.action === "tags") {
        const add = body.add_tags ?? [];
        const remove = body.remove_tags ?? [];
        if (!Array.isArray(add) || !Array.isArray(remove) || [...add, ...remove].some((tag) => typeof tag !== "string" || !tag.trim() || tag.length > 200)) throw new Error("Invalid tags.");
        const changed = await batchContacts(body.ids, (item) => {
          const labels = [...new Set([...(Array.isArray(item.labels) ? item.labels : []), ...add.map((tag: string) => tag.trim())])].filter((tag) => !remove.includes(tag));
          return JSON.stringify(labels) === JSON.stringify(item.labels ?? []) ? item : { ...item, labels };
        });
        return response({ changed });
      }
      throw new Error("Invalid bulk action.");
    }
    if (path === "/api/contacts/merge-tags" && method === "POST") {
      const body = parse(options);
      if (!Array.isArray(body.tags) || body.tags.length === 0 || body.tags.some((tag) => typeof tag !== "string" || !tag.trim()) || typeof body.target_tag !== "string" || !body.target_tag.trim()) throw new Error("Choose tags and a target name.");
      const tags = new Set<string>(body.tags);
      const target = body.target_tag.trim();
      const matching = (await readAll("contacts")).filter((item) => item.labels?.some((tag: string) => tags.has(tag))).map((item) => item.id);
      const changed = await batchContacts(matching, (item) => ({ ...item, labels: [...new Set((item.labels ?? []).map((tag: string) => tags.has(tag) ? target : tag))] }));
      return response({ changed });
    }
    if ((path === "/api/contacts/merge-contacts" || path === "/api/duplicates/merge") && method === "POST") return response({ contact: await mergeContacts(parse(options)) });
    if (path === "/api/duplicates/delete" && method === "POST") {
      const body = parse(options);
      if (!Array.isArray(body.ids) || body.ids.length < 1 || body.ids.length > 2) throw new Error("Choose one or two duplicate contacts.");
      online();
      const expected = new Map<string, number>((body.expected_pair ?? []).map((item: Item) => [item.id, Number(item.revision ?? 0)]));
      let changed = 0;
      for (const id of body.ids) if (await deleteContact(id, expected.get(id) ?? knownRevisions.get(cacheKey("contacts", id)))) changed++;
      return response({ changed });
    }
    if (path === "/api/meetings" && method === "GET") {
      const contactId = url.searchParams.get("contact_id");
      return response({ meetings: (await readRows("meetings")).filter((item) => !contactId || item.contact_id === contactId || item.contact_ids?.includes(contactId)).sort((a, b) => String(b.date).localeCompare(String(a.date))) });
    }
    if (path === "/api/meetings" && method === "POST") { const item = parse(options) as Item; item.id ||= crypto.randomUUID(); if (!Array.isArray(item.contact_ids) || !item.contact_ids.length || typeof item.insights !== "string" || !item.insights.trim()) throw new Error("Choose a contact and add meeting notes."); return response({ meeting: await put("meetings", item, true) }); }
    const meeting = /^\/api\/meetings\/([^/]+)$/.exec(path);
    if (meeting) {
      if (method === "DELETE") { await remove("meetings", meeting[1]); return response({ deleted: true }); }
      if (method === "PUT") { const item = parse(options) as Item; if (item.id !== meeting[1]) throw new Error("Meeting ID mismatch."); return response({ meeting: await put("meetings", item, false) }); }
    }
    if (path === "/api/canvases" && method === "GET") return response({ canvases: (await readRows("canvases")).sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at))) });
    if (path === "/api/canvases" && method === "POST") { const body = parse(options); const item: Item = { id: crypto.randomUUID(), title: String(body.title ?? "").trim(), nodes: [], created_at: new Date().toISOString() }; if (!item.title) throw new Error("Enter a canvas title."); return response({ canvas: await put("canvases", item, true) }); }
    const canvas = /^\/api\/canvases\/([^/]+)$/.exec(path);
    if (canvas) {
      if (method === "DELETE") { await remove("canvases", canvas[1]); return response({ deleted: true }); }
      if (method === "PUT") { const item = parse(options) as Item; if (item.id !== canvas[1] || !Array.isArray(item.nodes) || item.nodes.length > 300) throw new Error("Invalid canvas."); return response({ canvas: await put("canvases", item, false) }); }
    }
    if (path === "/api/holidays" && method === "GET") return response({ holidays: await readRows("holidays") });
    if (path === "/api/holiday-messages" && method === "GET") {
      const contactId = url.searchParams.get("contact_id");
      return response({ messages: (await readRows("holiday_messages")).filter((item) => !contactId || item.contact_id === contactId).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))) });
    }
    const message = /^\/api\/holiday-messages\/([^/]+)$/.exec(path);
    if (message) {
      if (method === "DELETE") { await remove("holiday_messages", message[1]); return response({ deleted: true }); }
      if (method === "PUT") { const prior = await readOne("holiday_messages", message[1]); if (!prior) throw new Error("Message no longer exists."); const body = parse(options); const updated = await put("holiday_messages", { ...prior, ...body, id: prior.id, ...(body.status ? { sent_at: body.status === "sent" ? new Date().toISOString() : null } : {}) }, false); return response(updated); }
    }
    if (path === "/api/ai-availability") return response({ configured: false, model: "" });
    if (path === "/api/followups" && method === "GET") return response(await followupsView());
    if (path === "/api/followups" && method === "POST") {
      const body = parse(options);
      if (body.type === "create") { if (!body.contact_id || !body.title || !/^\d{4}-\d{2}-\d{2}$/.test(body.due_date)) throw new Error("Invalid reminder."); const id = crypto.randomUUID(); await put("followup_actions", { id, contact_id: body.contact_id, title: String(body.title).slice(0, 200), due_date: body.due_date }, true); return response({ id }); }
      if (["complete", "delete", "reschedule"].includes(body.type)) { const prior = await readOne("followup_actions", body.id); if (!prior) throw new Error("Reminder no longer exists."); if (body.type === "delete") await remove("followup_actions", body.id); else await put("followup_actions", { ...prior, ...(body.type === "complete" ? { status: "done", completed_at: new Date().toISOString(), completed_on: todayBaku() } : { due_date: body.due_date }) }, false); return response({ ok: true }); }
      if (body.type === "set-cadence") { if (!Number.isInteger(body.cadence_days) || body.cadence_days < 7 || body.cadence_days > 365) throw new Error("Choose a cadence from 7 to 365 days."); const prior = await readOne("followup_settings", body.contact_id); await put("followup_settings", { ...(prior ?? { id: body.contact_id }), cadence_days: body.cadence_days }, !prior); return response({ ok: true }); }
      if (["snooze-suggestion", "dismiss-suggestion", "complete-suggestion"].includes(body.type)) {
        const suggestion = (await followupsView()).suggestions.find((item) => item.contact_id === body.contact_id);
        if (!suggestion) throw new Error("This suggestion is no longer active. Refresh follow-ups.");
        if (body.type === "snooze-suggestion" && (!/^\d{4}-\d{2}-\d{2}$/.test(body.due_date) || body.due_date <= todayBaku())) throw new Error("Choose a future snooze date.");
        const prior = await readOne("followup_settings", body.contact_id);
        if (body.type === "complete-suggestion") {
          const id = crypto.randomUUID();
          await put("followup_actions", { id, contact_id: body.contact_id, title: "Reconnect", due_date: todayBaku(), status: "done", completed_at: new Date().toISOString() }, true);
          if (prior) await put("followup_settings", { ...prior, snoozed_until: null }, false);
        } else {
          const update = body.type === "snooze-suggestion" ? { snoozed_until: body.due_date } : { dismissed_activity_on: suggestion.last_activity, snoozed_until: null };
          await put("followup_settings", { ...(prior ?? { id: body.contact_id, cadence_days: 30 }), ...update }, !prior);
        }
        return response({ ok: true });
      }
      return response({ error: "This follow-up action is unavailable in the Pages app." }, 501);
    }
    if (path === "/api/osint") return response({ error: "OSINT collection requires a private server." }, 503);
    return response({ error: "This feature is not yet available in the Firebase Pages app." }, 501);
  } catch (error) { return errorResponse(error); }
}

export function installFirebaseApi() {
  window.addEventListener("online", () => { void syncPending(); });
  window.fetch = ((input: RequestInfo | URL, options?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, window.location.href);
    return url.origin === window.location.origin && url.pathname.startsWith("/api/") ? route(url, options) : originalFetch(input, options);
  }) as typeof window.fetch;
}
export function resetFirebaseApi() {
  for (const entry of live.values()) entry.stop();
  live.clear();
  knownRevisions.clear();
}
