import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { URL } from "node:url";
import sharp from "sharp";
import { fetchCandidateImage, fetchPublic, gatherCandidates, publicUrl } from "./osint-candidates.mjs";
import { parsePublicFeed } from "./osint-feed.mjs";
import { normalizeHandles, normalizeProviders, searchProvider } from "./osint-providers.mjs";
import { osintSearchPlan } from "./osint-search.mjs";
import { searchWeb } from "./osint-web.mjs";

const enabled = process.env.CONTACTGRAPH_OSINT_ENABLED === "1";
const python = process.env.CONTACTGRAPH_PYTHON || "python3";
const script = new URL("./osintdb.py", import.meta.url).pathname;
const database = process.env.CONTACTGRAPH_OSINT_DB || "/data/osint/osint.duckdb";
const searxUrl = process.env.CONTACTGRAPH_SEARXNG_URL || "http://searxng:8080";
const rsshubUrl = process.env.CONTACTGRAPH_RSSHUB_URL || "http://rsshub:1200";
const allowRsshub = process.env.CONTACTGRAPH_OSINT_ALLOW_RSSHUB !== "0";
let queue = Promise.resolve();
let active = 0;
let manualActive = false;
let dailyActive = false;
const recentCandidates = new Map();
const recentFindings = new Map();

export const osintEnabled = enabled;

function localDb(command, payload) {
  const job = queue.then(() => new Promise((resolve, reject) => {
    const child = spawn(python, [script, "--database", database, command], { stdio: ["pipe", "pipe", "pipe"] });
    let output = "";
    let errors = "";
    child.stdout.on("data", chunk => { output += chunk; });
    child.stderr.on("data", chunk => { errors += chunk; });
    child.on("error", reject);
    child.on("exit", code => {
      if (code !== 0) return reject(new Error(errors.trim() || `OSINT database exited with ${code}`));
      try { resolve(JSON.parse(output.trim())); } catch { reject(new Error("Invalid OSINT database response")); }
    });
    child.stdin.end(payload === undefined ? "" : typeof payload === "string" ? payload : JSON.stringify(payload));
  }));
  queue = job.catch(() => undefined);
  return job;
}

let databaseCommand = localDb;
let persistentTransients = false;

export function configureOsintDatabase(command, options = {}) {
  if (typeof command !== "function") throw new TypeError("An OSINT database command function is required");
  databaseCommand = command;
  persistentTransients = options.persistentTransients === true;
}

const db = (command, payload) => databaseCommand(command, payload);

function json(response, status, body) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(JSON.stringify(body));
}

async function fetchText(url) {
  if (url.startsWith("https://")) return (await fetchPublic(url, 2_000_000)).bytes.toString("utf8");
  // Only the private RSSHub service may be fetched without the public-address checks.
  if (new URL(url).origin !== new URL(rsshubUrl).origin) throw new Error("Use a public HTTPS feed URL or rsshub:/route");
  const response = await fetch(url, { signal: AbortSignal.timeout(15000), redirect: "error", headers: { "user-agent": "ContactGraph-OSINT/1.0" } });
  if (!response.ok) throw new Error(`${new URL(url).hostname} returned ${response.status}`);
  if (Number(response.headers.get("content-length") || 0) > 2_000_000) throw new Error("Feed is too large");
  const raw = await response.text();
  if (raw.length > 2_000_000) throw new Error("Feed is too large");
  return raw;
}

export function feedTarget(value) {
  if (typeof value !== "string") throw new Error("Enter a feed URL");
  if (value.startsWith("rsshub:/")) {
    if (!allowRsshub) throw new Error("Use a public HTTPS RSS or Atom feed URL");
    const path = value.slice("rsshub:".length);
    // URL parsing treats "\\" as "/", so "rsshub:/\\host/x" would leave the RSSHub origin (SSRF).
    if (!/^\/[A-Za-z0-9._~!$&'()*+,;=:@%/-]*$/.test(path) || path.startsWith("//") || path.includes("..")) throw new Error("Invalid RSSHub route");
    const target = new URL(path, rsshubUrl);
    if (target.origin !== new URL(rsshubUrl).origin) throw new Error("Invalid RSSHub route");
    return target.href;
  }
  try { return publicUrl(value).href; }
  catch { throw new Error(allowRsshub ? "Use a public HTTPS feed URL or rsshub:/route" : "Use a public HTTPS RSS or Atom feed URL"); }
}

async function gather(queries, feeds) {
  const errors = [];
  const items = [];
  await Promise.all(queries.map(async query => {
    try {
      const results = await searchWeb(query, "general,news", { searxUrl });
      for (const result of results.slice(0, 30)) {
        if (typeof result.url !== "string" || !/^https?:\/\//.test(result.url)) continue;
        items.push({ url: result.url, title: result.title || result.url, summary: result.content || "", published: result.publishedDate || "", source: result.engine || "web search", provider: "web", confirmed: false });
      }
    } catch (error) { errors.push(error.message); }
  }));
  for (const feed of feeds) {
    try {
      const parsed = parsePublicFeed(await fetchText(feedTarget(feed.url)));
      for (const item of parsed) items.push({ ...item, source: feed.url, provider: "web", confirmed: true });
    } catch (error) { errors.push(`${feed.url}: ${error.message}`); }
  }
  const unique = [...new Map(items.map(item => [item.url, item])).values()];
  return { items: unique, errors };
}

async function contactFor(id, readContacts) {
  const result = await readContacts(id);
  const contact = Array.isArray(result) ? result.find(item => item.id === id) : result;
  if (!contact) throw new Error("Contact not found");
  return contact;
}

async function cacheCandidates(candidates, contactId) {
  for (const [id, entry] of recentCandidates) if (entry.expires < Date.now()) recentCandidates.delete(id);
  for (const candidate of candidates) {
    candidate.id = randomUUID();
    recentCandidates.set(candidate.id, { candidate, contact_id: contactId, expires: Date.now() + 15 * 60_000 });
  }
  if (persistentTransients && candidates.length) await db("transients-save", { type: "candidate", contact_id: contactId, entries: candidates });
  return candidates;
}

async function cacheFindings(findings, contactId) {
  for (const [id, entry] of recentFindings) if (entry.expires < Date.now()) recentFindings.delete(id);
  for (const finding of findings) {
    finding.id = randomUUID();
    recentFindings.set(finding.id, { finding, contact_id: contactId, expires: Date.now() + 15 * 60_000 });
  }
  if (persistentTransients && findings.length) await db("transients-save", { type: "finding", contact_id: contactId, entries: findings });
  return findings;
}

async function transient(type, id, memory) {
  const local = memory.get(id);
  if (local?.expires > Date.now()) return local;
  if (local) memory.delete(id);
  return persistentTransients ? db("transient-get", { type, id }) : null;
}

async function removeTransient(id, memory) {
  memory.delete(id);
  if (persistentTransients) await db("transient-delete", { id });
}

async function collectExternal(providers, options, persist, contactId) {
  const entries = await Promise.all(providers.filter(value => value !== "web").map(async provider => {
    try {
      const response = await searchProvider(provider, { ...options, newsFallback: (query, category) => searchWeb(query, category, { searxUrl }) });
      const findings = persist ? response.findings : await cacheFindings(response.findings, contactId);
      const added = persist && findings.length ? (await db("findings-save", { contact_id: contactId, findings })).added : 0;
      return [provider, { ...response, findings: persist ? [] : findings, errors: [] }, added, response.findings.length, ""];
    } catch (error) {
      return [provider, { findings: [], errors: [error.message] }, 0, 0, provider + ": " + error.message];
    }
  }));
  return { results: Object.fromEntries(entries.map(([provider, result]) => [provider, result])), added: entries.reduce((sum, entry) => sum + entry[2], 0), found: entries.reduce((sum, entry) => sum + entry[3], 0), errors: entries.map(entry => entry[4]).filter(Boolean) };
}

async function collect(contactId, query, readContacts, persist, fromScheduler = false, selectedProviders, requestedHandles, depth = 50) {
  if (manualActive && !fromScheduler) throw new Error("Another manual OSINT search is already running");
  if (!fromScheduler) manualActive = true;
  active += 1;
  let run;
  try {
    if (query != null && typeof query !== "string") throw new Error("Search query must be text");
    const providers = selectedProviders === undefined ? ["web"] : normalizeProviders(selectedProviders);
    const handles = normalizeHandles(requestedHandles);
    if (![50, 500].includes(depth) || (fromScheduler && depth !== 50)) throw new Error("Invalid Maigret scan depth");
    if (!contactId) {
      if (persist || fromScheduler) throw new Error("Choose a contact to store search results");
      const actualQuery = (query || "").trim();
      if (!actualQuery || actualQuery.length > 300) throw new Error("Search query must be 1–300 characters");
      const [result, discovery, external] = await Promise.all([
        providers.includes("web") ? gather([actualQuery], []) : { items: [], errors: [] },
        providers.includes("web") ? gatherCandidates({ name: actualQuery }, (value, category) => searchWeb(value, category, { searxUrl }), [actualQuery]) : { candidates: [], errors: [] },
        collectExternal(providers, { query: actualQuery, handles, depth }, false, null),
      ]);
      const providerResults = { web: { items: result.items, candidates: await cacheCandidates(discovery.candidates, null), errors: [...result.errors, ...discovery.errors] } };
      Object.assign(providerResults, external.results);
      const errors = [...providerResults.web.errors, ...external.errors];
      return { ...result, errors, candidates: providerResults.web.candidates, providers: providerResults, added: 0, candidate_added: 0, finding_added: 0, query: actualQuery, search_queries: [actualQuery] };
    }
    const contact = await contactFor(contactId, readContacts);
    const snapshot = await db("snapshot");
    const plan = osintSearchPlan(contact, query);
    const actualQuery = plan.query;
    if (!actualQuery || actualQuery.length > 300) throw new Error("Search query must be 1–300 characters");
    run = await db("run-start", { contact_id: contactId });
    const feeds = providers.includes("web") ? snapshot.feeds.filter(feed => feed.contact_id === contactId) : [];
    const [result, discovery, external] = await Promise.all([
      providers.includes("web") ? gather(plan.queries, feeds) : { items: [], errors: [] },
      !fromScheduler && providers.includes("web") ? gatherCandidates(contact, (value, category) => searchWeb(value, category, { searxUrl }), plan.queries) : { candidates: [], errors: [] },
      collectExternal(providers, { query: actualQuery, contact: plan.automatic ? contact : null, handles, depth }, persist, contactId),
    ]);
    let candidates = [];
    let candidateAdded = 0;
    if (!fromScheduler && providers.includes("web")) {
      result.errors.push(...discovery.errors);
      candidates = discovery.candidates;
      if (persist) candidateAdded = (await db("candidates-save", { contact_id: contactId, candidates })).added;
      else await cacheCandidates(candidates, contactId);
    }
    let added = 0;
    if (persist) added = (await db("items-save", { contact_id: contactId, items: result.items })).added;
    result.errors.push(...external.errors);
    const providerResults = { web: { items: result.items, candidates: persist ? [] : candidates, errors: [...result.errors] }, ...external.results };
    const found = result.items.length + external.found;
    await db("run-finish", { id: run.id, status: result.errors.length ? (found ? "partial" : "error") : "complete", found, error: result.errors.join("; ") });
    return { ...result, providers: providerResults, candidates: persist ? [] : candidates, added, candidate_added: candidateAdded, finding_added: external.added, query: actualQuery, search_queries: plan.queries };
  } catch (error) {
    if (run) await db("run-finish", { id: run.id, status: "error", error: error.message });
    throw error;
  } finally { active -= 1; if (!fromScheduler) manualActive = false; }
}

const bakuNow = () => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Baku", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts().map(part => [part.type, part.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
};

export async function runOsintMonitor(monitor, readContacts) {
  if (!monitor || typeof monitor !== "object") throw new Error("Invalid OSINT monitor task");
  return collect(monitor.contact_id, monitor.query, readContacts, true, true, monitor.providers, monitor.handles, 50);
}

export async function runOsintDailyTick(readContacts, now = bakuNow(), enqueueMonitor) {
  if (!enabled || active || dailyActive) return false;
  const snapshot = await db("snapshot");
  if (!snapshot.settings.enabled || snapshot.settings.last_run_date === now.date || now.time < snapshot.settings.daily_time) return false;
  dailyActive = true;
  try {
    const monitors = snapshot.monitors.filter(item => item.enabled);
    if (enqueueMonitor) {
      for (const monitor of monitors) await enqueueMonitor(monitor, now.date);
      const marked = await db("mark-daily", { date: now.date });
      return marked.marked !== false;
    }
    const marked = await db("mark-daily", { date: now.date });
    if (marked.marked === false) return false;
    for (const monitor of monitors) {
      try { await runOsintMonitor(monitor, readContacts); }
      catch (error) { console.error(`OSINT collection failed for ${monitor.contact_id}:`, error); }
    }
    return true;
  } finally { dailyActive = false; }
}

export function startOsintScheduler(readContacts) {
  if (!enabled) return;
  const tick = () => void runOsintDailyTick(readContacts).catch(error => console.error("OSINT scheduler failed:", error));
  setInterval(tick, 60_000).unref();
  setTimeout(tick, 5_000).unref();
}

export async function handleOsintRoute(request, response, url, readBody, readContacts, confirmCandidate) {
  if (!url.pathname.startsWith("/api/osint")) return false;
  if (!enabled) return json(response, 404, { error: "OSINT is not enabled on this app" });
  const path = url.pathname;
  const method = request.method;
  if (method === "GET" && path === "/api/osint/availability") return json(response, 200, await db("health"));
  if (method === "GET" && /^\/api\/osint\/photos\/[^/]+\/preview$/.test(path)) {
    const id = path.split("/")[4];
    const cached = await transient("candidate", id, recentCandidates);
    const stored = cached ? { payload: cached.candidate || cached.payload } : await db("candidate-get", { id });
    if (!stored || stored.payload.kind !== "photo") return json(response, 404, { error: "Photo candidate not found" });
    const { bytes, type } = await fetchCandidateImage(stored.payload, { preferThumbnail: true });
    response.writeHead(200, { "content-type": type, "cache-control": "private, max-age=300", "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'; sandbox" });
    return response.end(bytes);
  }
  if (method === "GET" && path === "/api/osint") return json(response, 200, { ...(await db("snapshot")), active: Boolean(active || dailyActive) });
  if (method === "GET" && /^\/api\/osint\/contacts\/[^/]+\/reports$/.test(path)) {
    let contactId;
    try { contactId = decodeURIComponent(path.split("/")[4]); } catch { return json(response, 400, { error: "Invalid contact ID" }); }
    if (!contactId || contactId.length > 200) return json(response, 400, { error: "Invalid contact ID" });
    const found = await readContacts(contactId);
    if (Array.isArray(found) ? !found.some(contact => contact.id === contactId) : !found) return json(response, 404, { error: "Contact not found" });
    return json(response, 200, await db("contact-reports", { contact_id: contactId }));
  }
  if (method === "PUT" && path === "/api/osint/settings") return json(response, 200, await db("settings-update", await readBody(request)));
  if (method === "PUT" && path === "/api/osint/monitor") {
    const payload = await readBody(request);
    await contactFor(payload.contact_id, readContacts);
    return json(response, 200, await db("monitor-save", payload));
  }
  if (method === "POST" && path === "/api/osint/feeds") {
    const payload = await readBody(request);
    await contactFor(payload.contact_id, readContacts);
    feedTarget(payload.url);
    return json(response, 200, await db("feed-add", payload));
  }
  if (method === "DELETE" && path.startsWith("/api/osint/feeds/")) return json(response, 200, await db("feed-delete", { id: path.slice("/api/osint/feeds/".length) }));
  if (method === "POST" && path === "/api/osint/search") {
    const payload = await readBody(request);
    return json(response, 200, await collect(payload.contact_id, payload.query, readContacts, false, false, payload.providers, payload.handles, payload.maigret_depth || 50));
  }
  if (method === "POST" && path === "/api/osint/run") {
    const payload = await readBody(request);
    return json(response, 200, await collect(payload.contact_id, payload.query, readContacts, true, false, payload.providers, payload.handles, payload.maigret_depth || 50));
  }
  if (method === "POST" && path === "/api/osint/findings") {
    const payload = await readBody(request);
    await contactFor(payload.contact_id, readContacts);
    const cached = await transient("finding", payload.id, recentFindings);
    if (!cached || cached.contact_id !== payload.contact_id) throw new Error("Search result expired; search again");
    await removeTransient(payload.id, recentFindings);
    return json(response, 200, await db("findings-save", { contact_id: payload.contact_id, findings: [cached.finding || cached.payload] }));
  }
  if (method === "PUT" && /^\/api\/osint\/findings\/[^/]+$/.test(path)) {
    const payload = await readBody(request);
    return json(response, 200, await db("finding-update", { id: path.split("/")[4], status: payload.status }));
  }
  if (method === "POST" && path === "/api/osint/candidates") {
    const payload = await readBody(request);
    await contactFor(payload.contact_id, readContacts);
    const cached = await transient("candidate", payload.id, recentCandidates);
    if (!cached || cached.contact_id !== payload.contact_id) throw new Error("Search result expired; search again");
    await removeTransient(payload.id, recentCandidates);
    return json(response, 200, await db("candidates-save", { contact_id: payload.contact_id, candidates: [cached.candidate || cached.payload] }));
  }
  if (method === "POST" && /^\/api\/osint\/candidates\/[^/]+\/confirm$/.test(path)) {
    const id = path.split("/")[4];
    const payload = await readBody(request);
    const stored = await db("candidate-get", { id });
    if (!stored || stored.status !== "review") throw new Error("Candidate is no longer awaiting review");
    await contactFor(stored.contact_id, readContacts);
    const upstream = process.env.CONTACTGRAPH_UPSTREAM_URL || `http://127.0.0.1:${process.env.APP_PORT || "4177"}`;
    const requestBody = { candidate: stored.payload, update_current: payload.update_current === true, replace_existing: payload.replace_existing === true };
    if (stored.kind === "photo") {
      const { bytes } = await fetchCandidateImage(stored.payload);
      const normalized = await sharp(bytes, { limitInputPixels: 20_000_000 }).rotate().resize(600, 600, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 78, mozjpeg: true }).toBuffer();
      if (normalized.length > 300_000) throw new Error("Photo is too large to save");
      requestBody.image_base64 = normalized.toString("base64");
    }
    let result;
    if (confirmCandidate) result = await confirmCandidate(stored.contact_id, requestBody);
    else {
      const target = new URL(`/api/contacts/${encodeURIComponent(stored.contact_id)}/osint-confirm`, upstream);
      const origin = process.env.CONTACTGRAPH_UPSTREAM_URL ? target.origin : process.env.CONTACTGRAPH_PUBLIC_ORIGIN || target.origin;
      const answer = await fetch(target, { method: "POST", headers: { "content-type": "application/json", origin, cookie: request.headers.cookie || "" }, body: JSON.stringify(requestBody), signal: AbortSignal.timeout(30_000) });
      result = await answer.json().catch(() => ({}));
      if (!answer.ok) throw new Error(result.error || `Contact update failed (${answer.status})`);
    }
    await db("candidate-update", { id, status: "confirmed" });
    return json(response, 200, result);
  }
  if (method === "PUT" && /^\/api\/osint\/candidates\/[^/]+$/.test(path)) {
    const payload = await readBody(request);
    if (payload.status !== "dismissed") throw new Error("Only dismissal is supported");
    return json(response, 200, await db("candidate-update", { id: path.split("/")[4], status: "dismissed" }));
  }
  if (method === "POST" && path === "/api/osint/items") {
    const payload = await readBody(request);
    await contactFor(payload.contact_id, readContacts);
    return json(response, 200, await db("items-save", { contact_id: payload.contact_id, items: [{ ...payload.item, confirmed: true }] }));
  }
  if (method === "PUT" && path.startsWith("/api/osint/items/")) {
    const payload = await readBody(request);
    return json(response, 200, await db("item-update", { id: path.slice("/api/osint/items/".length), status: payload.status }));
  }
  return json(response, 404, { error: "Unknown OSINT route" });
}
