import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fetchCandidateImage, pinnedLookup, positionsFromHtml, positionsFromResults, publicAddress, publicUrl } from "./osint-candidates.mjs";
import { defaultOsintQuery, osintSearchPlan, suggestMaigretHandles } from "./osint-search.mjs";
import { normalizeHandles, normalizeProviders, parseMaigretReport } from "./osint-providers.mjs";

test("contact metadata narrows automatic searches without exposing private fields", () => {
  const contact = { name: "Example Person", organization: "Example Org", role: "Counsel", department: "Legal", locations: ["Baku"], notes: "Private meeting", emails: [{ address: "private@example.org" }], phones: [{ number: "+12345" }], addresses: [{ city: "Home City" }] };
  assert.equal(defaultOsintQuery(contact), '"Example Person" "Example Org" "Counsel"');
  assert.deepEqual(osintSearchPlan(contact).queries, ['"Example Person" "Example Org" "Counsel"', '"Example Person" "Example Org"']);
  assert.deepEqual(osintSearchPlan({ name: "Example Person", role: "Counsel", locations: ["Baku"] }).queries, ['"Example Person" "Counsel" "Baku"', '"Example Person" "Counsel"']);
  assert.deepEqual(osintSearchPlan(contact, '"Example Person" site:example.org').queries, ['"Example Person" site:example.org']);
  assert.equal(osintSearchPlan(contact, '"Example Person" "Example Org"').automatic, true, "legacy default searches gain contact metadata");
});

test("position evidence requires an exact person name and public image sources", () => {
  const person = { name: "Example Person" };
  assert.equal(positionsFromResults([{ url: "https://example.org/profile", title: "Example Person - Chief Counsel at Example Org" }], person)[0].title, "Chief Counsel");
  assert.equal(positionsFromResults([{ url: "https://example.org/profile", title: "Another Person - Chief Counsel at Example Org" }], person).length, 0);
  assert.equal(positionsFromHtml('<script type="application/ld+json">{"@type":"Person","name":"Example Person","jobTitle":"Director","worksFor":{"name":"Example Org"}}</script>', person, "https://example.org/profile", "Profile")[0].organization, "Example Org");
  assert.throws(() => publicUrl("http://example.org/photo.jpg"));
  assert.throws(() => publicUrl("https://127.0.0.1/photo.jpg"));
  assert.equal(publicAddress({ address: "185.15.59.240", family: 4 }), true);
  assert.equal(publicAddress({ address: "127.0.0.1", family: 4 }), false);
  assert.equal(publicAddress({ address: "::ffff:127.0.0.1", family: 6 }), false);
  assert.equal(publicAddress({ address: "2a02:ec80:300:ed1a::2:b", family: 6 }), true);
  const pinned = pinnedLookup({ address: "185.15.59.240", family: 4 });
  pinned("example.org", { all: true }, (_error, addresses) => assert.deepEqual(addresses, [{ address: "185.15.59.240", family: 4 }]));
  pinned("example.org", { all: false }, (_error, address, family) => { assert.equal(address, "185.15.59.240"); assert.equal(family, 4); });
});

test("photo preview falls back to a valid thumbnail", async () => {
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const requested = [];
  const result = await fetchCandidateImage({ image_url: "https://example.org/image", thumbnail_url: "https://example.org/thumb" }, { fetchImage: async url => {
    requested.push(url);
    if (url.endsWith("/image")) throw new Error("Source returned 403");
    return { bytes: png };
  } });
  assert.equal(result.type, "image/png");
  assert.deepEqual(requested, ["https://example.org/image", "https://example.org/thumb"]);
  const preview = await fetchCandidateImage({ image_url: "https://example.org/image", thumbnail_url: "https://example.org/thumb" }, { fetchImage: async url => { requested.push(url); return { bytes: png }; }, preferThumbnail: true });
  assert.equal(preview.type, "image/png");
  assert.equal(requested.at(-1), "https://example.org/thumb");
});

test("provider and username inputs are constrained", () => {
  assert.deepEqual(normalizeProviders(["gdelt", "openalex"]), ["gdelt", "openalex"]);
  assert.deepEqual(normalizeProviders(["searxng", "gdelt"]), ["web", "gdelt"], "legacy monitors migrate to the managed web provider");
  assert.throws(() => normalizeProviders(["gdelt", "gdelt"]));
  assert.throws(() => normalizeProviders(["unknown"]));
  assert.deepEqual(normalizeHandles(["person.name"]), ["person.name"]);
  assert.throws(() => normalizeHandles(["bad handle"]));
  const report = JSON.stringify({ GitHub: { url_user: "https://github.com/person", status: { ids_data: { name: "Person Name", bio: "Researcher" } } } });
  assert.equal(parseMaigretReport(report, "person")[0].url, "https://github.com/person");
  assert.deepEqual(suggestMaigretHandles({ name: "Example Person", socials: [{ value: "https://github.com/examplep" }] }), ["examplep", "exampleperson", "example.person"]);
});

test("OSINT manual search, feed collection, review and local schedule", async () => {
  const directory = await mkdtemp(join(tmpdir(), "contactgraph-osint-"));
  const requestedQueries = [];
  const requestedPaths = [];
  let gdeltUnavailable = false;
  let newsUnavailable = false;
  const searchServer = createServer((request, response) => {
    response.setHeader("content-type", "application/json");
    const searchUrl = new URL(request.url, "http://localhost");
    requestedQueries.push(searchUrl.searchParams.get("q"));
    requestedPaths.push(searchUrl.pathname);
    if (searchUrl.pathname === "/gdelt") {
      if (gdeltUnavailable) { response.writeHead(429); return response.end(JSON.stringify({ error: "quota" })); }
      return response.end(JSON.stringify({ articles: [{ url: "https://example.org/global-news", title: "Global mention", seendate: "20261016T090000Z", domain: "example.org" }] }));
    }
    if (searchUrl.pathname === "/wikidata") return response.end(JSON.stringify({ search: [{ id: "Q123", label: "Example Person", description: "A possible match" }] }));
    if (searchUrl.pathname === "/openalex") return response.end(JSON.stringify({ results: [{ id: "https://openalex.org/A123", display_name: "Example Person", works_count: 5, last_known_institutions: [{ display_name: "Example University" }] }] }));
    const category = searchUrl.searchParams.get("categories");
    if (category === "news" && newsUnavailable) { response.writeHead(503); return response.end(JSON.stringify({ error: "offline" })); }
    response.end(JSON.stringify({ results: category === "images" ? [{ url: "https://example.org/profile", img_src: "https://example.org/portrait.jpg", title: "Example Person portrait" }] : category === "general" ? [] : [{ url: "https://example.org/person-news", title: "Person in the news", content: "A possible mention", engine: "test" }] }));
  });
  const feedServer = createServer((request, response) => {
    response.setHeader("content-type", "application/rss+xml");
    response.end('<rss version="2.0"><channel><item><title>Verified post</title><link>https://example.org/post</link><description>From a confirmed feed</description></item></channel></rss>');
  });
  await Promise.all([new Promise(resolve => searchServer.listen(0, "127.0.0.1", resolve)), new Promise(resolve => feedServer.listen(0, "127.0.0.1", resolve))]);
  try {
    process.env.CONTACTGRAPH_OSINT_ENABLED = "1";
    process.env.CONTACTGRAPH_OSINT_DB = join(directory, "osint.duckdb");
    const localPython = resolve("../.contactgraph-venv/bin/python");
    process.env.CONTACTGRAPH_PYTHON ||= existsSync(localPython) ? localPython : "python3";
    process.env.CONTACTGRAPH_SEARXNG_URL = `http://127.0.0.1:${searchServer.address().port}`;
    process.env.CONTACTGRAPH_RSSHUB_URL = `http://127.0.0.1:${feedServer.address().port}`;
    process.env.CONTACTGRAPH_GDELT_URL = `http://127.0.0.1:${searchServer.address().port}/gdelt`;
    process.env.CONTACTGRAPH_WIKIDATA_URL = `http://127.0.0.1:${searchServer.address().port}/wikidata`;
    process.env.CONTACTGRAPH_OPENALEX_URL = `http://127.0.0.1:${searchServer.address().port}/openalex`;
    const { handleOsintRoute, runOsintDailyTick } = await import("./osint-service.mjs");
    const contacts = [{ id: "one", name: "Example Person", organization: "Example Org", role: "Counsel", locations: ["Baku"], notes: "Private meeting", emails: [{ address: "private@example.org" }] }];
    let contactReads = 0;
    const call = async (path, method = "GET", payload = {}) => {
      let body;
      const response = { writeHead(code) { this.code = code; }, end(value) { body = JSON.parse(value); } };
      await handleOsintRoute({ method }, response, new URL(path, "http://localhost"), async () => payload, async () => { contactReads += 1; return contacts; });
      return { code: response.code, body };
    };
    let snapshot = (await call("/api/osint")).body;
    assert.equal(snapshot.settings.enabled, false);
    assert.equal(snapshot.items.length, 0);
    const freeSearch = (await call("/api/osint/search", "POST", { query: "  Unlisted Person  " })).body;
    assert.deepEqual(freeSearch.search_queries, ["Unlisted Person"]);
    assert.equal(freeSearch.items.length, 1);
    assert.equal(freeSearch.candidates.length, 1);
    assert.ok(freeSearch.candidates[0].id, "temporary photo previews have an ID");
    assert.ok(requestedQueries.includes("Unlisted Person"));
    assert.equal(contactReads, 0, "free-text search does not load contact records");
    assert.equal((await call("/api/osint")).body.runs.length, 0, "free-text searches do not create a run record");
    assert.equal((await call("/api/osint")).body.items.length, 0, "free-text results are not persisted");
    assert.equal((await call("/api/osint")).body.candidates.length, 0, "free-text candidates are not persisted");
    const multiSource = (await call("/api/osint/search", "POST", { query: "Example Person", providers: ["gdelt", "wikidata", "openalex", "maigret"] })).body;
    assert.equal(multiSource.providers.gdelt.findings.length, 1);
    assert.equal(multiSource.providers.wikidata.findings.length, 1);
    assert.equal(multiSource.providers.openalex.findings.length, 1);
    assert.equal(multiSource.providers.maigret.needs_handle, true);
    assert.equal((await call("/api/osint")).body.findings.length, 0, "free-text provider findings are not persisted");
    await assert.rejects(call("/api/osint/search", "POST", { query: "  " }), /Search query must be 1–300 characters/);
    await assert.rejects(call("/api/osint/run", "POST", { query: "Unlisted Person" }), /Choose a contact to store search results/);
    const search = (await call("/api/osint/search", "POST", { contact_id: "one" })).body;
    assert.equal(search.items.length, 1);
    assert.equal(search.candidates.length, 1);
    assert.deepEqual(search.search_queries, ['"Example Person" "Example Org" "Counsel"', '"Example Person" "Example Org"']);
    assert.ok(requestedQueries.includes('"Example Person" "Example Org" "Counsel"'));
    assert.ok(requestedQueries.every(query => !/Private meeting|private@example\.org/.test(query)));
    assert.equal((await call("/api/osint")).body.items.length, 0, "one-off results are not persisted");
    assert.equal((await call("/api/osint")).body.candidates.length, 0, "one-off candidates are not persisted");
    const contactSources = (await call("/api/osint/search", "POST", { contact_id: "one", providers: ["gdelt", "wikidata", "openalex"] })).body;
    await call("/api/osint/findings", "POST", { contact_id: "one", id: contactSources.providers.wikidata.findings[0].id });
    assert.equal((await call("/api/osint")).body.findings.length, 1);
    const storedSources = (await call("/api/osint/run", "POST", { contact_id: "one", providers: ["gdelt", "wikidata", "openalex"] })).body;
    assert.equal(storedSources.finding_added, 2, "existing Wikidata candidate is deduplicated");
    const reviewFinding = (await call("/api/osint")).body.findings.find(item => item.provider === "openalex");
    await call(`/api/osint/findings/${reviewFinding.id}`, "PUT", { status: "saved" });
    assert.equal((await call("/api/osint")).body.findings.find(item => item.id === reviewFinding.id).status, "saved");
    const reports = await call("/api/osint/contacts/one/reports");
    assert.equal(reports.code, 200);
    assert.ok(reports.body.findings.some(item => item.id === reviewFinding.id), "contact details include saved public findings");
    assert.equal((await call("/api/osint/contacts/missing/reports")).code, 404);
    await call("/api/osint/candidates", "POST", { contact_id: "one", id: search.candidates[0].id });
    assert.equal((await call("/api/osint")).body.candidates.length, 1);
    await call("/api/osint/feeds", "POST", { contact_id: "one", url: "rsshub:/person" });
    await call("/api/osint/monitor", "PUT", { contact_id: "one", query: '"Example Person"', enabled: true, providers: ["web", "gdelt"], handles: ["example.person"] });
    const run = (await call("/api/osint/run", "POST", { contact_id: "one" })).body;
    assert.equal(run.added, 2);
    assert.equal(run.candidate_added, 0, "duplicate candidate is not stored twice");
    snapshot = (await call("/api/osint")).body;
    assert.equal(snapshot.items.find(item => item.url.endsWith("/post")).status, "saved");
    const candidate = snapshot.items.find(item => item.url.endsWith("/person-news"));
    assert.equal(candidate.status, "review");
    await call(`/api/osint/items/${candidate.id}`, "PUT", { status: "saved" });
    assert.equal((await call("/api/osint")).body.items.find(item => item.id === candidate.id).status, "saved");
    assert.equal((await call("/api/osint/run", "POST", { contact_id: "one" })).body.added, 0);
    await call("/api/osint/settings", "PUT", { enabled: true, daily_time: "08:30" });
    snapshot = (await call("/api/osint")).body;
    assert.equal(snapshot.settings.daily_time, "08:30");
    assert.equal(snapshot.settings.enabled, true);
    assert.deepEqual(snapshot.monitors[0].providers, ["web", "gdelt"]);
    assert.deepEqual(snapshot.monitors[0].handles, ["example.person"]);
    const openalexBeforeDaily = requestedPaths.filter(path => path === "/openalex").length;
    const gdeltBeforeDaily = requestedPaths.filter(path => path === "/gdelt").length;
    assert.equal(await runOsintDailyTick(async () => contacts, { date: "2099-01-01", time: "09:00" }), true);
    snapshot = (await call("/api/osint")).body;
    assert.equal(snapshot.settings.last_run_date, "2099-01-01");
    assert.equal(requestedPaths.filter(path => path === "/gdelt").length, gdeltBeforeDaily + 1, "selected GDELT source ran daily");
    assert.equal(requestedPaths.filter(path => path === "/openalex").length, openalexBeforeDaily, "unselected OpenAlex source did not run daily");
    const enqueued = [];
    assert.equal(await runOsintDailyTick(async () => contacts, { date: "2099-01-02", time: "09:00" }, async (monitor, date) => enqueued.push({ monitor, date })), true);
    assert.equal(enqueued.length, 1);
    assert.equal(enqueued[0].monitor.contact_id, "one");
    assert.equal(enqueued[0].date, "2099-01-02");
    process.env.CONTACTGRAPH_GDELT_URL = "http://127.0.0.1:1/gdelt";
    const networkFailure = (await call("/api/osint/search", "POST", { query: "Example Person", providers: ["gdelt"] })).body.providers.gdelt;
    assert.equal(networkFailure.findings.length, 1, "network failure falls back to managed news");
    assert.equal(networkFailure.findings[0].metadata.upstream, "managed-news");
    assert.match(networkFailure.notices[0], /GDELT unavailable/i);
    process.env.CONTACTGRAPH_GDELT_URL = `http://127.0.0.1:${searchServer.address().port}/gdelt`;
    gdeltUnavailable = true;
    const rateLimited = (await call("/api/osint/search", "POST", { query: "Example Person", providers: ["gdelt"] })).body.providers.gdelt;
    assert.equal(rateLimited.findings.length, 1, "HTTP 429 falls back to managed news");
    assert.match(rateLimited.notices[0], /rate limit/i);
    const gdeltCallsDuringLimit = requestedPaths.filter(path => path === "/gdelt").length;
    const cooledDown = (await call("/api/osint/search", "POST", { query: "Example Person", providers: ["gdelt"] })).body.providers.gdelt;
    assert.equal(cooledDown.findings.length, 1);
    assert.equal(requestedPaths.filter(path => path === "/gdelt").length, gdeltCallsDuringLimit, "cooldown avoids another GDELT request");
    const contactNews = (await call("/api/osint/search", "POST", { contact_id: "one", providers: ["gdelt"] })).body.providers.gdelt;
    assert.equal(contactNews.findings.length, 1, "contact search uses the same fallback");
    newsUnavailable = true;
    const bothUnavailable = (await call("/api/osint/search", "POST", { query: "Example Person", providers: ["gdelt"] })).body.providers.gdelt;
    assert.equal(bothUnavailable.findings.length, 0);
    assert.match(bothUnavailable.errors[0], /GDELT rate limited and managed news search failed/);
  } finally {
    await Promise.all([new Promise(resolve => searchServer.close(resolve)), new Promise(resolve => feedServer.close(resolve))]);
    await rm(directory, { recursive: true, force: true });
  }
});

test("RSSHub feed routes cannot leave the RSSHub origin", async () => {
  const { feedTarget } = await import("./osint-service.mjs");
  assert.equal(new URL(feedTarget("rsshub:/github/issue/owner/repo")).origin, new URL(process.env.CONTACTGRAPH_RSSHUB_URL || "http://rsshub:1200").origin);
  for (const value of ["rsshub:/\\\\evil.example/x", "rsshub:/\\127.0.0.1:4177/api/x", "rsshub://evil.example/x", "rsshub:/a/../b", "rsshub:/a b"]) {
    assert.throws(() => feedTarget(value), /Invalid RSSHub route/, value);
  }
  assert.throws(() => feedTarget("http://127.0.0.1:4177/api"), /public HTTPS/);
});

test("Maigret handles cannot look like command-line options", () => {
  assert.deepEqual(normalizeHandles(["person.one", "p_2"]), ["person.one", "p_2"]);
  for (const handle of ["--version", "-h", "_x", ".x"]) assert.throws(() => normalizeHandles([handle]), /usernames/, handle);
});
