import { createHash, randomUUID } from "node:crypto";

const collections = {
  settings: "osint_settings",
  monitors: "osint_monitors",
  feeds: "osint_feeds",
  items: "osint_items",
  runs: "osint_runs",
  candidates: "osint_candidates",
  findings: "osint_provider_findings",
  transients: "osint_transients",
  controls: "osint_controls",
};
const providerSet = new Set(["web", "gdelt", "wikidata", "openalex", "maigret"]);
const defaultSettings = { enabled: false, daily_time: "09:00", last_run_date: null, last_run_at: null };

function id(prefix, values) {
  return `${prefix}-${createHash("sha256").update(JSON.stringify(values)).digest("hex").slice(0, 40)}`;
}

function cleanRecord(snapshot) {
  return { id: snapshot.id, ...snapshot.data() };
}

function validId(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9._:+@-]{1,200}$/.test(value) || value === "." || value === "..") throw new Error("Invalid record ID");
  return value;
}

function validContactId(value) {
  return validId(value);
}

function validHttps(value) {
  if (typeof value !== "string" || value.length > 2048) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch { return false; }
}

function legacyProviders(value) {
  return Array.isArray(value) ? [...new Set(value.map(provider => provider === "searxng" ? "web" : provider).filter(provider => providerSet.has(provider)))] : ["web"];
}

async function all(firestore, name) {
  const snapshot = await firestore.collection(collections[name]).get();
  return snapshot.docs.map(cleanRecord);
}

async function queryContact(firestore, name, contactId) {
  const snapshot = await firestore.collection(collections[name]).where("contact_id", "==", contactId).get();
  return snapshot.docs.map(cleanRecord);
}

function ordered(rows, field, limit) {
  return rows.sort((left, right) => String(right[field] || "").localeCompare(String(left[field] || ""))).slice(0, limit);
}

export function createFirestoreOsintStore(firestore, { now = () => new Date(), monthlyLimit = Number(process.env.CONTACTGRAPH_BRAVE_MONTHLY_LIMIT || 2500) } = {}) {
  if (!firestore?.collection || !firestore?.runTransaction) throw new TypeError("A Firestore Admin client is required");
  const stamp = () => now().toISOString();

  async function snapshot() {
    const [settingsRows, monitors, feeds, items, runs, candidates, findings, budget] = await Promise.all([
      all(firestore, "settings"), all(firestore, "monitors"), all(firestore, "feeds"), all(firestore, "items"),
      all(firestore, "runs"), all(firestore, "candidates"), all(firestore, "findings"), firestore.collection(collections.controls).doc("managed-search-budget").get(),
    ]);
    const settings = settingsRows.find(row => row.id === "1") || settingsRows[0] || defaultSettings;
    return {
      settings: { ...defaultSettings, ...settings },
      monitors: monitors.map(row => ({ ...row, providers: legacyProviders(row.providers), handles: Array.isArray(row.handles) ? row.handles : [] })).sort((a, b) => a.contact_id.localeCompare(b.contact_id)),
      feeds: feeds.sort((a, b) => `${a.contact_id}:${a.url}`.localeCompare(`${b.contact_id}:${b.url}`)),
      items: ordered(items, "found_at", 500), runs: ordered(runs, "started_at", 30), candidates: ordered(candidates, "found_at", 500), findings: ordered(findings, "found_at", 500),
      managed_search: { used: budget.exists && budget.data().month === stamp().slice(0, 7) ? Number(budget.data().used || 0) : 0, limit: monthlyLimit },
    };
  }

  async function saveUnique(name, rows, identity, normalize) {
    let added = 0;
    for (const value of rows) {
      const record = normalize(value);
      if (!record) continue;
      const reference = firestore.collection(collections[name]).doc(id(name.slice(0, -1) || name, identity(record)));
      const created = await firestore.runTransaction(async transaction => {
        const current = await transaction.get(reference);
        if (current.exists) return false;
        transaction.create(reference, { id: reference.id, ...record });
        return true;
      });
      if (created) added += 1;
    }
    return { added };
  }

  async function command(name, payload = {}) {
    if (name === "health") {
      await firestore.collection(collections.settings).doc("1").get();
      return { available: true, backend: "firestore", providers: ["web", "gdelt", "wikidata", "openalex", "maigret"] };
    }
    if (name === "transients-save") {
      if (!["candidate", "finding"].includes(payload.type) || !Array.isArray(payload.entries) || payload.entries.length > 100) throw new Error("Invalid transient OSINT results");
      const contactId = payload.contact_id === null ? null : validContactId(payload.contact_id);
      const expiresAt = new Date(now().getTime() + 15 * 60_000);
      const batch = firestore.batch();
      for (const entry of payload.entries) {
        const transientId = validId(entry?.id);
        batch.set(firestore.collection(collections.transients).doc(transientId), { id: transientId, type: payload.type, contact_id: contactId, payload: entry, expires_at: expiresAt });
      }
      if (payload.entries.length) await batch.commit();
      return { saved: payload.entries.length };
    }
    if (name === "transient-get") {
      if (!["candidate", "finding"].includes(payload.type)) throw new Error("Invalid transient OSINT result type");
      const found = await firestore.collection(collections.transients).doc(validId(payload.id)).get();
      if (!found.exists || found.data().type !== payload.type) return null;
      const expiresAt = found.data().expires_at?.toDate ? found.data().expires_at.toDate() : found.data().expires_at;
      if (!(expiresAt instanceof Date) || expiresAt.getTime() <= now().getTime()) return null;
      return { payload: found.data().payload, contact_id: found.data().contact_id ?? null, expires: expiresAt.getTime() };
    }
    if (name === "transient-delete") { await firestore.collection(collections.transients).doc(validId(payload.id)).delete(); return { ok: true }; }
    if (name === "snapshot") return snapshot();
    if (name === "contact-reports") {
      const contactId = validContactId(payload.contact_id);
      const [items, candidates, findings] = await Promise.all([queryContact(firestore, "items", contactId), queryContact(firestore, "candidates", contactId), queryContact(firestore, "findings", contactId)]);
      return { items: ordered(items.filter(row => row.status !== "dismissed"), "found_at", 500), candidates: ordered(candidates.filter(row => row.status !== "dismissed"), "found_at", 500), findings: ordered(findings.filter(row => row.status !== "dismissed"), "found_at", 500) };
    }
    if (name === "settings-update") {
      if (typeof payload.enabled !== "boolean" || typeof payload.daily_time !== "string" || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(payload.daily_time)) throw new Error("Invalid schedule");
      const reference = firestore.collection(collections.settings).doc("1");
      await reference.set({ id: "1", enabled: payload.enabled, daily_time: payload.daily_time }, { merge: true });
      return { ...defaultSettings, ...(await reference.get()).data() };
    }
    if (name === "mark-daily") {
      if (typeof payload.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(payload.date)) throw new Error("Invalid run date");
      const reference = firestore.collection(collections.settings).doc("1");
      const marked = await firestore.runTransaction(async transaction => {
        const current = await transaction.get(reference);
        if (current.exists && current.data().last_run_date === payload.date) return false;
        transaction.set(reference, { id: "1", ...defaultSettings, ...(current.exists ? current.data() : {}), last_run_date: payload.date, last_run_at: stamp() }, { merge: true });
        return true;
      });
      return { ok: true, marked };
    }
    if (name === "monitor-save") {
      const contactId = validContactId(payload.contact_id);
      const query = typeof payload.query === "string" ? payload.query.trim() : "";
      const enabled = payload.enabled ?? true;
      const providers = legacyProviders(payload.providers);
      const handles = Array.isArray(payload.handles) ? payload.handles : [];
      if (!query || query.length > 300 || typeof enabled !== "boolean" || !providers.length || handles.length > 3 || handles.some(handle => typeof handle !== "string" || !/^[\p{L}\p{N}][\p{L}\p{N}._-]{1,39}$/u.test(handle)) || new Set(handles).size !== handles.length) throw new Error("Invalid monitor");
      const reference = firestore.collection(collections.monitors).doc(contactId);
      await firestore.runTransaction(async transaction => {
        const enabledRows = await transaction.get(firestore.collection(collections.monitors).where("enabled", "==", true));
        const others = enabledRows.docs.filter(row => row.id !== contactId).length;
        if (enabled && others >= 25) throw new Error("A maximum of 25 contacts can be monitored");
        transaction.set(reference, { id: contactId, contact_id: contactId, query, enabled, providers, handles });
      });
      return { ok: true };
    }
    if (name === "feed-add") {
      const contactId = validContactId(payload.contact_id);
      if (!validHttps(payload.url)) throw new Error("Use a public HTTPS feed URL");
      const reference = firestore.collection(collections.feeds).doc(id("feed", [contactId, payload.url]));
      await reference.set({ id: reference.id, contact_id: contactId, url: payload.url }, { merge: false });
      return { ok: true };
    }
    if (name === "feed-delete") { await firestore.collection(collections.feeds).doc(validId(payload.id)).delete(); return { ok: true }; }
    if (name === "items-save") {
      const contactId = validContactId(payload.contact_id);
      return saveUnique("items", (Array.isArray(payload.items) ? payload.items : []).slice(0, 100), row => [contactId, row.url], row => {
        if (!validHttps(row.url)) return null;
        return { contact_id: contactId, url: row.url, title: String(row.title || row.url).slice(0, 500), summary: String(row.summary || "").slice(0, 2000), source: String(row.source || "web").slice(0, 100), published: String(row.published || "").slice(0, 100), found_at: stamp(), status: row.confirmed ? "saved" : "review", provider: String(row.provider || "web").slice(0, 40) };
      });
    }
    if (name === "item-update") {
      if (!["saved", "dismissed"].includes(payload.status)) throw new Error("Invalid status");
      await firestore.collection(collections.items).doc(validId(payload.id)).update({ status: payload.status }); return { ok: true };
    }
    if (name === "candidates-save") {
      const contactId = validContactId(payload.contact_id);
      return saveUnique("candidates", (Array.isArray(payload.candidates) ? payload.candidates : []).slice(0, 50), row => [contactId, row.kind, row.candidate_key], row => {
        if (!["photo", "position"].includes(row.kind) || !validHttps(row.source_url) || typeof row.candidate_key !== "string" || !row.candidate_key) return null;
        return { contact_id: contactId, kind: row.kind, source_url: row.source_url, candidate_key: row.candidate_key.slice(0, 2048), payload: row, found_at: stamp(), status: "review" };
      });
    }
    if (name === "candidate-get") { const found = await firestore.collection(collections.candidates).doc(validId(payload.id)).get(); return found.exists ? cleanRecord(found) : null; }
    if (name === "candidate-update") {
      if (!["confirmed", "dismissed"].includes(payload.status)) throw new Error("Invalid candidate status");
      const reference = firestore.collection(collections.candidates).doc(validId(payload.id));
      await firestore.runTransaction(async transaction => {
        const current = await transaction.get(reference);
        if (!current.exists || current.data().status !== "review") throw new Error("Candidate is no longer awaiting review");
        transaction.update(reference, { status: payload.status });
      });
      return { ok: true };
    }
    if (name === "findings-save") {
      const contactId = validContactId(payload.contact_id);
      let added = 0;
      for (const row of (Array.isArray(payload.findings) ? payload.findings : []).slice(0, 100)) {
        if (!["gdelt", "wikidata", "openalex", "maigret"].includes(row.provider) || typeof row.key !== "string" || !row.key || !validHttps(row.url)) continue;
        const reference = firestore.collection(collections.findings).doc(id("finding", [contactId, row.provider, row.key]));
        const created = await firestore.runTransaction(async transaction => {
          const current = await transaction.get(reference);
          if (current.exists) { transaction.update(reference, { last_seen_at: stamp() }); return false; }
          transaction.create(reference, { id: reference.id, contact_id: contactId, provider: row.provider, finding_key: row.key.slice(0, 2048), url: row.url, title: String(row.title || row.url).slice(0, 500), summary: String(row.summary || "").slice(0, 2000), published: String(row.published || "").slice(0, 100), payload: row, found_at: stamp(), last_seen_at: stamp(), status: "review" });
          return true;
        });
        if (created) added += 1;
      }
      return { added };
    }
    if (name === "finding-update") {
      if (!["saved", "dismissed"].includes(payload.status)) throw new Error("Invalid finding status");
      await firestore.collection(collections.findings).doc(validId(payload.id)).update({ status: payload.status }); return { ok: true };
    }
    if (name === "run-start") {
      const runId = randomUUID();
      await firestore.collection(collections.runs).doc(runId).create({ id: runId, contact_id: payload.contact_id ? validContactId(payload.contact_id) : null, started_at: stamp(), finished_at: null, status: "running", found: 0, error: "" });
      return { id: runId };
    }
    if (name === "run-finish") {
      if (!["complete", "partial", "error"].includes(payload.status)) throw new Error("Invalid run status");
      await firestore.collection(collections.runs).doc(validId(payload.id)).update({ finished_at: stamp(), status: payload.status, found: Math.max(0, Math.min(10_000, Number(payload.found || 0))), error: String(payload.error || "").slice(0, 1000) });
      return { ok: true };
    }
    if (name === "budget-consume") {
      if (!Number.isInteger(monthlyLimit) || monthlyLimit < 1 || monthlyLimit > 100_000) throw new Error("Invalid managed-search budget");
      const reference = firestore.collection(collections.controls).doc("managed-search-budget");
      return firestore.runTransaction(async transaction => {
        const current = await transaction.get(reference);
        const month = stamp().slice(0, 7);
        const used = current.exists && current.data().month === month ? Number(current.data().used || 0) : 0;
        if (!Number.isInteger(used) || used < 0 || used >= monthlyLimit) throw new Error("Monthly managed-search limit reached");
        transaction.set(reference, { id: "managed-search-budget", month, used: used + 1, limit: monthlyLimit, updated_at: stamp() });
        return { used: used + 1, limit: monthlyLimit };
      });
    }
    if (name === "rate-limit-consume") {
      const subject = typeof payload.subject === "string" && payload.subject.length >= 1 && payload.subject.length <= 160 && !/[\u0000-\u001f\u007f]/.test(payload.subject) ? payload.subject : null;
      if (!subject) throw new Error("Invalid rate-limit subject");
      const reference = firestore.collection(collections.controls).doc(id("rate", [subject]));
      return firestore.runTransaction(async transaction => {
        const current = await transaction.get(reference);
        const cutoff = now().getTime() - 60_000;
        const times = (current.exists && Array.isArray(current.data().times) ? current.data().times : []).filter(value => Number.isFinite(value) && value > cutoff);
        if (times.length >= 5) return { allowed: false, retry_after: Math.ceil((times[0] + 60_000 - now().getTime()) / 1000) };
        transaction.set(reference, { id: reference.id, times: [...times, now().getTime()], updated_at: stamp() });
        return { allowed: true };
      });
    }
    throw new Error(`Unknown Firestore OSINT command: ${name}`);
  }

  return { command };
}

export const firestoreOsintCollections = Object.freeze({ ...collections });
