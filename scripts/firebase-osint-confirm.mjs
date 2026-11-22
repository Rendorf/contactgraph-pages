import { createHash, randomUUID } from "node:crypto";

function field(value) {
  if (value === null) return { nullValue: null };
  if (typeof value === "string") return { stringValue: value };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number" && Number.isFinite(value)) return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(field) } };
  if (value && typeof value === "object") return { mapValue: { fields: Object.fromEntries(Object.entries(value).map(([key, item]) => [key, field(item)])) } };
  throw new Error("Invalid contact data.");
}

function document(name, values) {
  return { name, fields: Object.fromEntries(Object.entries(values).map(([key, value]) => [key, field(value)])) };
}

function validSource(value) {
  if (typeof value !== "string" || value.length > 2048) throw new Error("A public HTTPS source is required.");
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || !url.hostname.includes(".")) throw new Error("A public HTTPS source is required.");
  return value;
}

export async function confirmFirebaseOsint(contactId, payload, { read, token, uid, projectId, fetcher = fetch }) {
  const candidate = payload?.candidate;
  if (!candidate || !["photo", "position"].includes(candidate.kind)) throw new Error("Invalid candidate.");
  validSource(candidate.source_url);
  const contact = await read("contacts", contactId, token);
  if (!contact) throw new Error("Contact not found.");
  if (!contact._firestore_update_time) throw new Error("Contact version is unavailable. Refresh and try again.");
  const base = `projects/${projectId}/databases/(default)/documents`;
  const changes = { revision: Number(contact.revision ?? 0) + 1, updated_at: new Date().toISOString(), updated_by: uid };
  const writes = [];
  let photoUrl = "";
  if (candidate.kind === "position") {
    const title = candidate.title;
    const organization = candidate.organization;
    if (typeof title !== "string" || !title.trim() || title.length > 200 || typeof organization !== "string" || organization.length > 200) throw new Error("Invalid position.");
    const previous = Array.isArray(contact.positions) ? contact.positions : [];
    if (previous.some((item) => item?.source_url === candidate.source_url && item?.title === title.trim() && item?.organization === organization.trim())) return { saved: true, contact };
    if (previous.length > 100) throw new Error("This contact's position history is full.");
    changes.positions = [...previous, { id: randomUUID(), title: title.trim(), organization: organization.trim(), period: String(candidate.period || "unknown").slice(0, 40), source_url: candidate.source_url, source_title: String(candidate.source_title || "").slice(0, 300), evidence: String(candidate.evidence || "").slice(0, 500), confirmed_at: new Date().toISOString() }];
    if (payload.update_current === true) { changes.role = title.trim(); changes.organization = organization.trim(); }
  } else {
    if (contact.photo_file && payload.replace_existing !== true) throw new Error("Confirm photo replacement first.");
    const encoded = payload.image_base64;
    if (typeof encoded !== "string" || encoded.length > 410_000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw new Error("Invalid photo data.");
    const bytes = Buffer.from(encoded, "base64");
    if (bytes.length > 300_000 || bytes.length < 3 || bytes.subarray(0, 3).toString("hex") !== "ffd8ff" || bytes.toString("base64") !== encoded) throw new Error("Only a JPEG photo up to 300 KB is supported.");
    const digest = createHash("sha256").update(bytes).digest("hex");
    changes.photo_file = `firebase/osint/${contactId}-${digest.slice(0, 16)}.jpg`;
    photoUrl = `data:image/jpeg;base64,${encoded}`;
    const chunkId = `${contactId}_0`;
    writes.push({ update: document(`${base}/photo_chunks/${chunkId}`, { id: chunkId, contact_id: contactId, index: 0, total: 1, mime: "image/jpeg", sha256: digest, data: encoded }) });
    const old = await read("photo_chunks", chunkId, token);
    if (contact.photo_file === changes.photo_file && old?.sha256 === digest) return { saved: true, contact: { ...contact, photo_url: photoUrl } };
    const total = Number(old?.total ?? 0);
    if (!Number.isInteger(total) || total < 0 || total > 20) throw new Error("Existing photo is invalid.");
    for (let index = 1; index < total; index++) writes.push({ delete: `${base}/photo_chunks/${contactId}_${index}` });
  }
  writes.unshift({ update: document(`${base}/contacts/${contactId}`, changes), updateMask: { fieldPaths: Object.keys(changes) }, currentDocument: { updateTime: contact._firestore_update_time } });
  let response;
  try { response = await fetcher(`https://firestore.googleapis.com/v1/${base}:commit`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ writes }), signal: AbortSignal.timeout(20_000) }); }
  catch { throw new Error("Firebase is temporarily unavailable."); }
  if (!response.ok) throw new Error(response.status === 403 ? "Access denied to update this contact." : "The contact changed or Firebase could not save it. Refresh and try again.");
  return { saved: true, contact: { ...contact, ...changes, ...(photoUrl ? { photo_url: photoUrl } : {}) } };
}
