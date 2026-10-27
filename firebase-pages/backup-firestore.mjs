// Encrypted private export and verification for Spark projects without a
// managed database backup. Never put backup files in the Pages source repo.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const appRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const entries = process.argv.slice(2);
const arg = (key) => { const at = entries.indexOf(`--${key}`); return at >= 0 ? entries[at + 1] : undefined; };
const mode = arg("mode") || "verify";
const output = path.resolve(arg("file") || "");
const passphrase = process.env.CONTACTGRAPH_BACKUP_PASSPHRASE;
if ((mode !== "self-test" && !arg("file")) || (arg("file") && output.startsWith(`${appRoot}${path.sep}`))) throw new Error("Choose a backup file outside the public source repository.");
if (!passphrase || passphrase.length < 20) throw new Error("Set CONTACTGRAPH_BACKUP_PASSPHRASE to a private passphrase of at least 20 characters.");
const collections = ["contacts", "holidays", "holiday_messages", "canvases", "meetings", "followup_actions", "followup_settings", "roles", "members", "photo_chunks", "osint_settings", "osint_monitors", "osint_feeds", "osint_items", "osint_runs", "osint_candidates", "osint_provider_findings"];
const aad = Buffer.from("ContactGraph Firestore backup v1");

function decrypt(file) {
  const envelope = JSON.parse(fs.readFileSync(file, "utf8"));
  if (envelope.version !== 1 || envelope.kdf !== "scrypt" || envelope.cipher !== "aes-256-gcm") throw new Error("Unsupported backup format.");
  const key = crypto.scryptSync(passphrase, Buffer.from(envelope.salt, "base64"), 32, { N: 32768, r: 8, p: 1, maxmem: 128 * 1024 * 1024 });
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(envelope.iv, "base64"));
  decipher.setAAD(aad);
  decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(envelope.data, "base64")), decipher.final()]);
  const payload = JSON.parse(plaintext.toString("utf8"));
  if (payload.version !== 1 || !collections.every((name) => Array.isArray(payload.collections[name]))) throw new Error("Backup contents are invalid.");
  return payload;
}
function encrypt(payload) {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = crypto.scryptSync(passphrase, salt, 32, { N: 32768, r: 8, p: 1, maxmem: 128 * 1024 * 1024 });
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(aad);
  const encrypted = Buffer.concat([cipher.update(Buffer.from(JSON.stringify(payload))), cipher.final()]);
  return { version: 1, kdf: "scrypt", cipher: "aes-256-gcm", salt: salt.toString("base64"), iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), data: encrypted.toString("base64") };
}

if (mode === "self-test") {
  const file = path.join(process.env.TMPDIR || "/tmp", `contactgraph-backup-test-${crypto.randomUUID()}.cgbak`);
  try {
    const payload = { version: 1, created_at: new Date().toISOString(), collections: Object.fromEntries(collections.map((name) => [name, name === "contacts" ? [{ id: "example", data: { name: "Private test record" } }] : []])) };
    fs.writeFileSync(file, JSON.stringify(encrypt(payload)), { flag: "wx", mode: 0o600 });
    if (decrypt(file).collections.contacts[0].data.name !== "Private test record") throw new Error("Backup round-trip failed.");
    const tampered = JSON.parse(fs.readFileSync(file, "utf8"));
    tampered.tag = crypto.randomBytes(16).toString("base64");
    fs.writeFileSync(file, JSON.stringify(tampered));
    let rejected = false;
    try { decrypt(file); } catch { rejected = true; }
    if (!rejected) throw new Error("Tampered backup was accepted.");
    console.log("Encrypted backup round-trip and tamper test passed.");
  } finally { fs.rmSync(file, { force: true }); }
} else if (mode === "verify") {
  const payload = decrypt(output);
  console.log(JSON.stringify({ verified: true, created_at: payload.created_at, counts: Object.fromEntries(collections.map((name) => [name, payload.collections[name].length])) }));
} else if (mode === "export") {
  const projectId = arg("project");
  if (!projectId) throw new Error("Pass --project with the Firebase project ID.");
  if (fs.existsSync(output)) throw new Error("Backup file already exists; choose a new path.");
  initializeApp({ ...(process.env.FIRESTORE_EMULATOR_HOST ? {} : { credential: applicationDefault() }), projectId });
  const db = getFirestore();
  const data = Object.fromEntries(await Promise.all(collections.map(async (name) => {
    const snapshot = await db.collection(name).get();
    return [name, snapshot.docs.map((item) => ({ id: item.id, data: item.data() }))];
  })));
  const payload = { version: 1, created_at: new Date().toISOString(), project_id: projectId, collections: data };
  const envelope = encrypt(payload);
  fs.writeFileSync(output, JSON.stringify(envelope), { flag: "wx", mode: 0o600 });
  const verified = decrypt(output);
  console.log(JSON.stringify({ verified: true, created_at: verified.created_at, counts: Object.fromEntries(collections.map((name) => [name, verified.collections[name].length])) }));
} else if (mode === "restore") {
  const projectId = arg("project");
  if (!projectId) throw new Error("Pass --project with an empty target Firebase project ID.");
  const payload = decrypt(output);
  initializeApp({ ...(process.env.FIRESTORE_EMULATOR_HOST ? {} : { credential: applicationDefault() }), projectId });
  const db = getFirestore();
  for (const name of collections) if (!(await db.collection(name).limit(1).get()).empty) throw new Error(`Target ${name} is not empty; restore stopped before writing.`);
  for (const name of collections) {
    const rows = payload.collections[name];
    for (let offset = 0; offset < rows.length;) {
      const part = [];
      let bytes = 0;
      while (offset + part.length < rows.length && part.length < 300) {
        const row = rows[offset + part.length];
        const size = Buffer.byteLength(JSON.stringify(row.data));
        if (size > 900000) throw new Error(`${name}/${row.id} is too large for one Firestore document.`);
        if (part.length && bytes + size > 4000000) break;
        part.push(row); bytes += size;
      }
      const batch = db.batch();
      for (const row of part) batch.create(db.collection(name).doc(row.id), row.data);
      await batch.commit();
      offset += part.length;
      console.log(JSON.stringify({ collection: name, restored: offset, total: rows.length }));
    }
  }
  for (const name of collections) {
    const count = (await db.collection(name).count().get()).data().count;
    if (count !== payload.collections[name].length) throw new Error(`Restore count mismatch for ${name}.`);
  }
  console.log(JSON.stringify({ restored: true, source_project: payload.project_id, target_project: projectId }));
} else throw new Error("Choose --mode export, verify, restore, or self-test.");
