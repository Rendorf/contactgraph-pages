import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const authSource = fs.readFileSync(new URL("./auth-context.tsx", import.meta.url), "utf8");
const apiSource = fs.readFileSync(new URL("./hermes-api.ts", import.meta.url), "utf8");
const moreSource = fs.readFileSync(new URL("../app/more-module.tsx", import.meta.url), "utf8");
const pageSource = fs.readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");

test("managed API cutover exposes OSINT capabilities to permitted online users", () => {
  assert.match(authSource, /const unavailable = new Set\(\["sync\.read", "sync\.write"\]\);/);
  assert.doesNotMatch(authSource, /unavailable[^;]+osint\.(?:view|manage)/);
});

test("Firebase ID tokens are sent only to the deployed ContactGraph Cloud Run service", () => {
  assert.match(apiSource, /const origin = "https:\/\/contactgraph-osint-api-el2lney4da-ew\.a\.run\.app";/);
  assert.doesNotMatch(apiSource, /const origin = "https:\/\/api\.contacts\.vusalkhalilov\.com";/);
});

test("permitted online users always see the OSINT entry even if the service check fails", () => {
  assert.doesNotMatch(moreSource, /osintAvailable/);
  assert.doesNotMatch(pageSource, /osintAvailable/);
  assert.match(moreSource, /!module\.permission \|\| can\(module\.permission\)/);
  assert.match(pageSource, /!offline && can\("osint\.view"\)/);
});
