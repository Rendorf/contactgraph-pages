import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { BlockList, isIP } from "node:net";
import { osintSearchPlan } from "./osint-search.mjs";

const blocked = new BlockList();
for (const [subnet, prefix] of [["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["224.0.0.0", 4], ["240.0.0.0", 4]]) blocked.addSubnet(subnet, prefix, "ipv4");
for (const [subnet, prefix] of [["::", 128], ["::1", 128], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8]]) blocked.addSubnet(subnet, prefix, "ipv6");
const mappedIpv4 = new BlockList();
mappedIpv4.addSubnet("::ffff:0:0", 96, "ipv6");

export function publicAddress(address) {
  if (!address || ![4, 6].includes(address.family) || isIP(address.address) !== address.family) return false;
  if (address.family === 6 && mappedIpv4.check(address.address, "ipv6")) return false;
  return !blocked.check(address.address, address.family === 6 ? "ipv6" : "ipv4");
}

export function pinnedLookup(address) {
  return (_host, options, done) => options.all
    ? done(null, [{ address: address.address, family: address.family }])
    : done(null, address.address, address.family);
}

export function publicUrl(raw) {
  if (typeof raw !== "string" || raw.length > 2048) throw new Error("Invalid public URL");
  const url = new URL(raw);
  if (url.protocol !== "https:" || url.username || url.password || url.port || !url.hostname.includes(".") || isIP(url.hostname) || /(?:^|\.)(?:localhost|local|internal)$/.test(url.hostname)) throw new Error("A public HTTPS URL is required");
  return url;
}

export async function fetchPublic(raw, maxBytes = 2_000_000, redirectsLeft = 3) {
  const url = publicUrl(raw);
  const addresses = await lookup(url.hostname, { all: true, verbatim: true });
  const address = addresses.find(publicAddress);
  if (!address) throw new Error("Source address is not public");
  return await new Promise((resolve, reject) => {
    const req = request(url, { method: "GET", timeout: 12000, headers: { "user-agent": "ContactGraph-OSINT/1.0", accept: "image/jpeg,image/png,image/webp,text/html" }, lookup: pinnedLookup(address) }, response => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode) && response.headers.location) {
        response.resume();
        if (redirectsLeft <= 0) return reject(new Error("Too many source redirects"));
        return resolve(fetchPublic(new URL(response.headers.location, url).href, maxBytes, redirectsLeft - 1));
      }
      if (response.statusCode !== 200) { response.resume(); return reject(new Error(`Source returned ${response.statusCode}`)); }
      if (Number(response.headers["content-length"] || 0) > maxBytes) { response.destroy(); return reject(new Error("Source is too large")); }
      const chunks = [];
      let length = 0;
      response.on("data", chunk => {
        length += chunk.length;
        if (length > maxBytes) { response.destroy(); reject(new Error("Source is too large")); }
        else chunks.push(chunk);
      });
      response.on("end", () => resolve({ bytes: Buffer.concat(chunks), type: String(response.headers["content-type"] || "").split(";")[0].toLowerCase() }));
      response.on("error", reject);
    });
    req.on("timeout", () => req.destroy(new Error("Source timed out")));
    req.on("error", reject);
    req.end();
  });
}

export function imageType(bytes) {
  if (bytes.length >= 3 && bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return "image/jpeg";
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "image/png";
  if (bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  throw new Error("Source is not a supported image");
}

export async function fetchCandidateImage(candidate, { fetchImage = fetchPublic, preferThumbnail = false } = {}) {
  const urls = [...new Set((preferThumbnail ? [candidate.thumbnail_url, candidate.image_url] : [candidate.image_url, candidate.thumbnail_url]).filter(Boolean))];
  let lastError;
  for (const url of urls) {
    try {
      const { bytes } = await fetchImage(url);
      return { bytes, type: imageType(bytes) };
    } catch (error) { lastError = error; }
  }
  throw lastError || new Error("No usable image URL was found");
}

const clean = value => String(value || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
const normalized = value => clean(value).toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

function personObjects(value) {
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value)) return value.flatMap(personObjects);
  const own = String(value["@type"] || "").split(/[, ]+/).some(type => type === "Person" || type.endsWith("/Person")) ? [value] : [];
  return [...own, ...personObjects(value["@graph"] || [])];
}

export function positionsFromHtml(html, contact, sourceUrl, sourceTitle) {
  const output = [];
  for (const match of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      for (const person of personObjects(JSON.parse(match[1]))) {
        if (normalized(person.name) !== normalized(contact.name)) continue;
        const titles = Array.isArray(person.jobTitle) ? person.jobTitle : [person.jobTitle];
        const organizations = Array.isArray(person.worksFor) ? person.worksFor : [person.worksFor];
        for (const title of titles) {
          const role = clean(typeof title === "string" ? title : title?.name);
          if (!role) continue;
          const organization = clean(typeof organizations[0] === "string" ? organizations[0] : organizations[0]?.name);
          output.push({ kind: "position", title: role.slice(0, 200), organization: organization.slice(0, 200), period: "unknown", source_url: sourceUrl, source_title: sourceTitle, evidence: `Public profile metadata for ${contact.name}` });
        }
      }
    } catch { /* Ignore malformed public metadata. */ }
  }
  return output;
}

export function positionsFromResults(results, contact) {
  const output = [];
  const escaped = String(contact.name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`^${escaped}\\s*(?:[-–—|,:]\\s*)(.{3,120}?)\\s+(?:at|@)\\s+(.{2,100}?)(?:\\s*[-–—|]|$)`, "i");
  for (const result of results.slice(0, 25)) {
    if (typeof result.url !== "string") continue;
    try { publicUrl(result.url); } catch { continue; }
    const evidence = clean(result.title || result.content).slice(0, 300);
    const match = evidence.match(pattern);
    if (!match) continue;
    const summary = clean(result.content);
    const period = /\b(?:former|previously|until \d{4})\b/i.test(summary) ? "previous" : /\b(?:currently|present)\b/i.test(summary) ? "claimed current" : "unknown";
    output.push({ kind: "position", title: clean(match[1]), organization: clean(match[2]), period, source_url: result.url, source_title: clean(result.title), evidence: `${evidence}${summary ? ` — ${summary.slice(0, 180)}` : ""}` });
  }
  return output;
}

export async function gatherCandidates(contact, searchSource, queries = osintSearchPlan(contact).queries) {
  const errors = [];
  const candidates = [];
  async function search(category, query) {
    if (typeof searchSource === "function") return searchSource(query, category);
    const url = new URL("/search", searchSource);
    url.searchParams.set("q", query);
    url.searchParams.set("format", "json");
    url.searchParams.set("categories", category);
    const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error(`Web ${category} search returned ${response.status}`);
    return (await response.json()).results || [];
  }
  let webResults = [];
  const searchAll = async (category, suffix) => (await Promise.all(queries.slice(0, 2).map(async query => {
    try { return await search(category, `${query} ${suffix}`); }
    catch (error) { errors.push(`${category}: ${error.message}`); return []; }
  }))).flat();
  {
    const images = await searchAll("images", "portrait photo");
    for (const result of images.slice(0, 30)) {
      try { publicUrl(result.url); } catch { continue; }
      const imageUrls = [...new Set([result.img_src, result.thumbnail_src, result.thumbnail].filter(value => {
        try { publicUrl(value); return true; } catch { return false; }
      }))];
      if (!imageUrls.length) continue;
      candidates.push({ kind: "photo", image_url: imageUrls[0], thumbnail_url: imageUrls[1] || "", source_url: result.url, source_title: clean(result.title || result.url).slice(0, 300), evidence: clean(result.content).slice(0, 500) || "Image-search match; identity is unverified" });
    }
  }
  {
    webResults = await searchAll("general", "position biography");
    candidates.push(...positionsFromResults(webResults, contact));
  }
  const metadataSources = webResults.filter(result => normalized(result.title).includes(normalized(contact.name))).slice(0, 4);
  const metadata = await Promise.all(metadataSources.map(async result => {
    try {
      const { bytes, type } = await fetchPublic(result.url, 500_000);
      return type === "text/html" ? positionsFromHtml(bytes.toString("utf8"), contact, result.url, clean(result.title)) : [];
    } catch { return []; /* Snippets still provide possible matches. */ }
  }));
  for (const found of metadata) candidates.push(...found);
  const seen = new Set();
  const unique = candidates.filter(candidate => {
    candidate.candidate_key = candidate.kind === "photo" ? candidate.image_url : `${candidate.source_url}|${normalized(candidate.title)}|${normalized(candidate.organization)}`;
    if (seen.has(candidate.candidate_key)) return false;
    seen.add(candidate.candidate_key);
    return true;
  });
  return { candidates: unique.slice(0, 40), errors };
}
