// Private, one-time import. Requires Application Default Credentials or a
// GOOGLE_APPLICATION_CREDENTIALS file stored outside this repository.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const appRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const args = Object.fromEntries(process.argv.slice(2).flatMap((value, index, all) => value.startsWith("--") && all[index + 1] && !all[index + 1].startsWith("--") ? [[value.slice(2), all[index + 1]]] : []));
const applied = process.argv.includes("--apply");
const resume = process.argv.includes("--resume");
const input = path.resolve(args.input ?? "");
if (!args.input || input.startsWith(`${appRoot}${path.sep}`) || !fs.existsSync(input)) throw new Error("Pass --input with a private export JSON outside the source repository.");
const data = JSON.parse(fs.readFileSync(input, "utf8"));
const required = ["contacts", "holidays", "holiday_messages", "canvases", "meetings", "followup_actions", "followup_settings", "roles", "members", "osint_settings", "osint_monitors", "osint_feeds", "osint_items", "osint_runs", "osint_candidates", "osint_provider_findings"];
for (const key of required) if (!Array.isArray(data[key])) throw new Error(`Missing migration array: ${key}`);
const ownerEmail = args["owner-email"]?.toLowerCase();
const members = data.members.map((member) => ({ ...member, email: member.role_id === "owner" && ownerEmail ? ownerEmail : member.email }));
if (members.some((member) => !member.email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(member.email))) throw new Error("Every member needs a bound email; pass --owner-email for the Owner.");
if (new Set(members.map((member) => member.email)).size !== members.length) throw new Error("Member emails must be unique.");
const now = new Date().toISOString();
const collections = Object.fromEntries(required.filter((key) => key !== "members").map((key) => [key, data[key].map((item, position) => {
  const id = String(item.id ?? (key === "holiday_messages" ? item.sequence : key === "osint_monitors" ? item.contact_id : ""));
  if (!id || id.includes("/") || id.length > 200) throw new Error(`Invalid ${key} record ID.`);
  const clean = JSON.parse(JSON.stringify({ ...item, id, revision: 1, updated_at: item.updated_at || now, updated_by: "migration" }));
  if (key === "contacts") clean.sort_order = position;
  if (key === "followup_actions") {
    if (clean.status === "done") clean.completed_at = clean.completed_on || now;
    delete clean.completed_on;
  }
  return clean;
})]));
collections.members = members.map((member) => ({ ...member, id: member.email }));

const photosDir = path.resolve(appRoot, "..", "data", "photos");
const photoChunks = [];
let missingPhotos = 0;
for (const contact of collections.contacts) {
  if (!contact.photo_file) continue;
  const relative = String(contact.photo_file).replace(/^data\/photos\//, "");
  const file = path.resolve(photosDir, relative);
  if (!file.startsWith(`${photosDir}${path.sep}`)) throw new Error("Photo path leaves the private photos directory.");
  if (!fs.existsSync(file)) { missingPhotos++; continue; }
  const bytes = fs.readFileSync(file);
  const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
  const mime = /\.png$/i.test(file) ? "image/png" : /\.webp$/i.test(file) ? "image/webp" : "image/jpeg";
  const base64 = bytes.toString("base64");
  const parts = base64.match(/.{1,700000}/g) ?? [];
  for (let index = 0; index < parts.length; index++) photoChunks.push({ id: `${contact.id}_${index}`, contact_id: contact.id, index, total: parts.length, mime, sha256, data: parts[index] });
}
collections.photo_chunks = photoChunks;

const counts = Object.fromEntries(Object.entries(collections).map(([key, value]) => [key, value.length]));
const maxDocumentBytes = Math.max(0, ...Object.values(collections).flatMap((rows) => rows.map((row) => Buffer.byteLength(JSON.stringify(row)))));
if (maxDocumentBytes > 900000) throw new Error(`A migration document is too large for Firestore (${maxDocumentBytes} bytes).`);
const sha256 = crypto.createHash("sha256").update(fs.readFileSync(input)).digest("hex");
console.log(JSON.stringify({ mode: applied ? resume ? "apply-resume" : "apply" : "dry-run", sha256, counts, missingPhotos, maxDocumentBytes }));
if (!applied) process.exit(0);
if (!args.project || !/^[a-z][a-z0-9-]{3,40}$/.test(args.project)) throw new Error("Pass a valid --project Firebase project ID.");
initializeApp({ ...(process.env.FIRESTORE_EMULATOR_HOST ? {} : { credential: applicationDefault() }), projectId: args.project });
const db = getFirestore();
if (!resume) for (const key of Object.keys(collections)) {
  const existing = await db.collection(key).limit(1).get();
  if (!existing.empty) throw new Error(`Target collection ${key} already contains data; import stopped without changes. Use --resume only for a verified partial import.`);
}
const stable = (value) => Array.isArray(value) ? value.map(stable) : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])])) : value;
const comparable = (value) => { const copy = { ...value }; delete copy.updated_at; return stable(copy); };
for (const [key, rows] of Object.entries(collections)) {
  for (let offset = 0; offset < rows.length;) {
    const part = [];
    let bytes = 0;
    while (offset + part.length < rows.length && part.length < 300) {
      const row = rows[offset + part.length];
      const size = Buffer.byteLength(JSON.stringify(row));
      if (size > 900000) throw new Error(`${key}/${row.id} is too large for one Firestore document.`);
      if (part.length && bytes + size > 4000000) break;
      part.push(row); bytes += size;
    }
    const existing = resume ? await db.getAll(...part.map((row) => db.collection(key).doc(row.id))) : [];
    const batch = db.batch();
    let newRecords = 0;
    for (let index = 0; index < part.length; index++) {
      const row = part[index];
      if (existing[index]?.exists) {
        if (JSON.stringify(comparable(existing[index].data())) !== JSON.stringify(comparable(row))) throw new Error(`Existing ${key}/${row.id} differs from the migration snapshot; stopped before this batch.`);
      } else { batch.create(db.collection(key).doc(row.id), row); newRecords++; }
    }
    if (newRecords) await batch.commit();
    offset += part.length;
    console.log(JSON.stringify({ collection: key, imported: offset, total: rows.length }));
  }
}
for (const [key, rows] of Object.entries(collections)) {
  const snapshot = await db.collection(key).count().get();
  const actual = snapshot.data().count;
  if (actual !== rows.length) throw new Error(`Verification failed for ${key}: expected ${rows.length}, found ${actual}`);
}
console.log(JSON.stringify({ verified: true, counts }));
