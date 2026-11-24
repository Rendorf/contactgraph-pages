import { spawn } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const OSINT_PROVIDERS = ["web", "gdelt", "wikidata", "openalex", "maigret"];
const providerSet = new Set(OSINT_PROVIDERS);
const OPENALEX_ORIGIN = "https://api.openalex.org";
let maigretQueue = Promise.resolve();
let gdeltBlockedUntil = 0;

export function normalizeProviders(value) {
  if (value === undefined) return [...OSINT_PROVIDERS];
  if (!Array.isArray(value)) throw new Error("Choose at least one valid OSINT source");
  const normalized = value.map(item => item === "searxng" ? "web" : item);
  if (!normalized.length || normalized.length > OSINT_PROVIDERS.length || normalized.some(item => !providerSet.has(item)) || new Set(normalized).size !== normalized.length) throw new Error("Choose at least one valid OSINT source");
  return normalized;
}

export function normalizeHandles(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 3 || value.some(handle => typeof handle !== "string" || !/^[\p{L}\p{N}][\p{L}\p{N}._-]{1,39}$/u.test(handle)) || new Set(value).size !== value.length) throw new Error("Use up to three distinct usernames");
  return value;
}

async function fetchJson(url, timeout = 20000, headers = {}) {
  const response = await fetch(url, { signal: AbortSignal.timeout(timeout), headers: { accept: "application/json", "user-agent": "ContactGraph-OSINT/1.0", ...headers } });
  if (response.status === 429) throw new Error("Rate limited (HTTP 429); try again later");
  if (!response.ok) throw new Error("Source returned HTTP " + response.status);
  return response.json();
}

export function openAlexHeaders(url, apiKey) {
  if (url.origin !== OPENALEX_ORIGIN) return {};
  if (apiKey === undefined) return {};
  const key = typeof apiKey === "string" ? apiKey.trim() : "";
  if (!key || key.length < 16 || key.length > 256 || /[\s\x00-\x1f\x7f]/.test(key)) throw new Error("OpenAlex API key configuration is invalid");
  return { authorization: `Bearer ${key}` };
}

function valueText(value, limit = 500) {
  return String(value || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, limit);
}

function httpsUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.href : "";
  } catch { return ""; }
}

function gdeltSeenDate(value) {
  const text = String(value || "");
  const match = text.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
  return match ? match[1] + "-" + match[2] + "-" + match[3] + "T" + match[4] + ":" + match[5] + ":" + match[6] + "Z" : "";
}

export async function searchGdelt(query, contact) {
  if (Date.now() < gdeltBlockedUntil) throw new Error("Rate limited; retry after 10 minutes");
  const url = new URL(process.env.CONTACTGRAPH_GDELT_URL || "https://api.gdeltproject.org/api/v2/doc/doc");
  url.searchParams.set("query", contact ? '"' + valueText(contact.name, 120).replaceAll('"', "") + '"' : query);
  url.searchParams.set("mode", "artlist");
  url.searchParams.set("format", "json");
  url.searchParams.set("maxrecords", "30");
  let body;
  try { body = await fetchJson(url); }
  catch (error) { if (error.message.includes("429")) gdeltBlockedUntil = Date.now() + 10 * 60_000; throw error; }
  return (Array.isArray(body.articles) ? body.articles : []).flatMap(article => {
    const source = httpsUrl(article.url);
    if (!source) return [];
    return [{ provider: "gdelt", kind: "news", key: source, url: source, title: valueText(article.title || source), summary: valueText(article.domain || article.sourcecountry || ""), published: gdeltSeenDate(article.seendate), metadata: { domain: valueText(article.domain, 150), language: valueText(article.language, 40), date_label: "Seen by GDELT" } }];
  });
}

function gdeltFailureReason(error) {
  const message = error instanceof Error ? error.message : "";
  if (/rate limit|429/i.test(message)) return "rate limited";
  if (/fetch failed|timeout|abort/i.test(message)) return "connection failed";
  return "request failed";
}

async function searchNewsFallback(query, contact, fallback) {
  const actualQuery = contact ? '"' + valueText(contact.name, 120).replaceAll('"', "") + '"' : query;
  let results;
  if (typeof fallback === "function") results = await fallback(actualQuery, "news");
  else {
    const url = new URL("/search", fallback);
    url.searchParams.set("q", actualQuery);
    url.searchParams.set("format", "json");
    url.searchParams.set("categories", "news");
    const body = await fetchJson(url, 15000);
    results = Array.isArray(body.results) ? body.results : [];
  }
  return results.slice(0, 30).flatMap(article => {
    const source = httpsUrl(article.url);
    if (!source) return [];
    const engine = valueText(article.engine || "web news", 80);
    return [{ provider: "gdelt", kind: "news", key: source, url: source, title: valueText(article.title || source), summary: valueText(article.content || ""), published: valueText(article.publishedDate || "", 60), metadata: { upstream: "managed-news", source_name: engine, date_label: "Published" } }];
  });
}

export async function searchGlobalNews(query, contact, newsFallback) {
  try { return { findings: await searchGdelt(query, contact) }; }
  catch (error) {
    const reason = gdeltFailureReason(error);
    if (!newsFallback) throw new Error(`GDELT ${reason}`);
    try {
      return { findings: await searchNewsFallback(query, contact, newsFallback), notices: [`GDELT unavailable (${reason}); showing managed news results instead.`] };
    } catch {
      throw new Error(`Global news unavailable: GDELT ${reason} and managed news search failed`);
    }
  }
}

export async function searchWikidata(query, contact) {
  const url = new URL(process.env.CONTACTGRAPH_WIKIDATA_URL || "https://www.wikidata.org/w/api.php");
  url.searchParams.set("action", "wbsearchentities");
  url.searchParams.set("search", contact?.name || query);
  url.searchParams.set("language", "en");
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", "15");
  const body = await fetchJson(url);
  return (Array.isArray(body.search) ? body.search : []).flatMap(entity => {
    if (!/^Q\d+$/.test(entity.id || "")) return [];
    return [{ provider: "wikidata", kind: "entity", key: entity.id, url: "https://www.wikidata.org/wiki/" + entity.id, title: valueText(entity.label || entity.id), summary: valueText(entity.description || "Public Wikidata entity"), published: "", metadata: { id: entity.id, aliases: Array.isArray(entity.aliases) ? entity.aliases.slice(0, 8) : [] } }];
  });
}

export async function searchOpenAlex(query, contact) {
  const url = new URL(process.env.CONTACTGRAPH_OPENALEX_URL || "https://api.openalex.org/authors");
  url.searchParams.set("search", contact?.name || query);
  url.searchParams.set("per_page", "15");
  const body = await fetchJson(url, 20000, openAlexHeaders(url, process.env.OPENALEX_API_KEY));
  return (Array.isArray(body.results) ? body.results : []).flatMap(author => {
    const id = String(author.id || "").match(/A\d+$/)?.[0];
    if (!id) return [];
    const institutions = (Array.isArray(author.last_known_institutions) ? author.last_known_institutions : []).map(item => valueText(item.display_name, 120)).filter(Boolean).slice(0, 3);
    const summary = [institutions.join(", "), author.works_count ? author.works_count + " works" : "", author.orcid || ""].filter(Boolean).join(" · ");
    return [{ provider: "openalex", kind: "author", key: id, url: "https://openalex.org/" + id, title: valueText(author.display_name || id), summary, published: "", metadata: { id, orcid: author.orcid || "", institutions, works_count: Number(author.works_count || 0) } }];
  });
}

export function parseMaigretReport(raw, handle) {
  const report = JSON.parse(raw);
  if (!report || typeof report !== "object" || Array.isArray(report)) return [];
  return Object.entries(report).flatMap(([siteName, entry]) => {
    const source = httpsUrl(entry?.url_user || entry?.status?.site_url_user);
    if (!source) return [];
    const details = entry?.status?.ids_data || {};
    const name = valueText(details.name || details.fullname || "", 120);
    const bio = valueText(details.bio || details.description || "", 300);
    return [{ provider: "maigret", kind: "profile", key: source, url: source, title: valueText(siteName + " · @" + handle), summary: [name, bio].filter(Boolean).join(" — ") || "Username exists here; identity is unverified", published: "", metadata: { handle, site: valueText(siteName, 100), name, bio } }];
  });
}

function executeMaigret(handle, depth) {
  const python = process.env.CONTACTGRAPH_PYTHON || "python3";
  return new Promise(async (resolve, reject) => {
    const directory = await mkdtemp(join(tmpdir(), "contactgraph-maigret-")).catch(reject);
    if (!directory) return;
    const args = ["-m", "maigret", handle, "--top-sites", String(depth), "--json", "simple", "--folderoutput", directory, "--no-autoupdate", "--no-recursion", "--exclude-tags", "porn,dating", "--timeout", "8", "--max-connections", depth === 50 ? "10" : "50", "--no-color", "--no-progressbar"];
    const child = spawn(python, args, { cwd: directory, stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", chunk => { stderr = (stderr + chunk).slice(-2000); });
    let timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, depth === 50 ? 60000 : 90000);
    let finished = false;
    const finish = async (error) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      try {
        if (error) throw error;
        const files = (await readdir(directory)).filter(name => name.endsWith(".json"));
        if (!files.length) throw new Error("Maigret did not create a report");
        const findings = [];
        for (const file of files) findings.push(...parseMaigretReport(await readFile(join(directory, file), "utf8"), handle));
        resolve(findings.slice(0, 80));
      } catch (failure) { reject(failure); }
      finally { await rm(directory, { recursive: true, force: true }).catch(() => undefined); }
    };
    child.on("error", error => void finish(error));
    child.on("exit", code => void finish(timedOut ? new Error("Maigret timed out") : code && code !== 0 ? new Error(stderr.trim() || "Maigret failed") : null));
  });
}

export async function searchMaigret(handles, depth = 50) {
  if (!handles.length) return { findings: [], needs_handle: true };
  if (depth === 500 && handles.length > 1) throw new Error("Deep scan supports one username at a time");
  const job = maigretQueue.then(async () => {
    const all = (await Promise.all(handles.map(handle => executeMaigret(handle, depth)))).flat();
    return { findings: [...new Map(all.map(item => [item.key, item])).values()] };
  });
  maigretQueue = job.catch(() => undefined);
  return job;
}

export async function searchProvider(provider, { query, contact, handles = [], depth = 50, newsFallback }) {
  if (provider === "gdelt") return searchGlobalNews(query, contact, newsFallback);
  if (provider === "wikidata") return { findings: await searchWikidata(query, contact) };
  if (provider === "openalex") return { findings: await searchOpenAlex(query, contact) };
  if (provider === "maigret") return searchMaigret(handles, depth);
  throw new Error("Unknown OSINT source");
}
