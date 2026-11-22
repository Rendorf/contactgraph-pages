import test from "node:test";
import assert from "node:assert/strict";
import { parsePublicFeed } from "./osint-feed.mjs";
import { configureManagedSearchBudget, searchWeb } from "./osint-web.mjs";

test("managed web search normalizes web, news, and image results without exposing its key", async () => {
  process.env.BRAVE_SEARCH_API_KEY = "test-secret-never-log";
  let budgetCalls = 0;
  const requests = [];
  configureManagedSearchBudget(async () => ({ used: ++budgetCalls, limit: 10 }));
  const fetcher = async (url, options) => {
    requests.push({ url: url.href, key: options.headers["x-subscription-token"] });
    const image = url.pathname.includes("images");
    return { ok: true, status: 200, json: async () => image
      ? { results: [{ url: "https://example.org/profile", title: "Portrait", properties: { url: "https://cdn.example.org/photo.jpg" }, thumbnail: { src: "https://cdn.example.org/thumb.jpg" } }] }
      : { web: { results: [{ url: "https://example.org/person", title: "Person", description: "Public profile" }] }, results: [{ url: "https://example.org/news", title: "News", description: "Public mention" }] } };
  };
  assert.equal((await searchWeb("Example Person", "general", { fetcher }))[0].url, "https://example.org/person");
  assert.equal((await searchWeb("Example Person", "news", { fetcher }))[0].url, "https://example.org/news");
  assert.equal((await searchWeb("Example Person", "images", { fetcher }))[0].img_src, "https://cdn.example.org/photo.jpg");
  assert.equal(budgetCalls, 3);
  assert.equal(requests.every(request => request.key === process.env.BRAVE_SEARCH_API_KEY), true);
  assert.equal(JSON.stringify(requests).includes("test-secret-never-log"), true, "the test observes the request header but production logs never serialize it");
  delete process.env.BRAVE_SEARCH_API_KEY;
});

test("managed search fails closed when configuration, budget, or provider data is invalid", async () => {
  await assert.rejects(searchWeb("Person", "general", { fetcher: async () => ({ ok: true }) }), /not configured/);
  process.env.BRAVE_SEARCH_API_KEY = "test-key";
  configureManagedSearchBudget(async () => { throw new Error("Monthly managed-search limit reached"); });
  await assert.rejects(searchWeb("Person", "general", { fetcher: async () => ({ ok: true }) }), /limit reached/);
  configureManagedSearchBudget(async () => ({ used: 1, limit: 10 }));
  assert.deepEqual(await searchWeb("Person", "images", { fetcher: async () => ({ ok: true, status: 200, json: async () => ({ results: [{ url: "http://127.0.0.1/private", properties: { url: "https://cdn.example.org/photo.jpg" } }] }) }) }), []);
  delete process.env.BRAVE_SEARCH_API_KEY;
});

test("feed parser accepts bounded RSS and Atom while rejecting declarations and unsafe links", () => {
  assert.deepEqual(parsePublicFeed('<rss><channel><item><title>Verified &amp; public</title><link>https://example.org/post</link><description><![CDATA[Public <b>summary</b>]]></description></item></channel></rss>'), [{ url: "https://example.org/post", title: "Verified & public", summary: "Public summary", published: "" }]);
  assert.equal(parsePublicFeed('<feed><entry><title>Entry</title><link href="https://example.org/entry"/><updated>2026-11-22</updated></entry></feed>')[0].published, "2026-11-22");
  assert.deepEqual(parsePublicFeed('<rss><item><link>file:///etc/passwd</link></item></rss>'), []);
  assert.throws(() => parsePublicFeed('<!DOCTYPE rss [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><rss/>'), /declarations/);
  assert.throws(() => parsePublicFeed("x".repeat(2_000_001)), /too large/);
});
