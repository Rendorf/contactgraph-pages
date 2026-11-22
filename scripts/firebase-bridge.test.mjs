import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const directory = await mkdtemp(join(tmpdir(), "contactgraph-bridge-test-"));
process.env.CONTACTGRAPH_SECRETS_DIR = directory;
const { createFirebaseBridge } = await import("./firebase-bridge.mjs");
const token = "a".repeat(120);
const origin = "https://contacts.vusalkhalilov.com";
const identity = { uid: "user-1", email: "owner@example.com", email_verified: true, firebase: { sign_in_provider: "google.com" } };
const records = {
  "members/owner@example.com": { id: "owner@example.com", email: "owner@example.com", role_id: "owner", active: true },
  "contacts/person-1": { id: "person-1", name: "Person One", interaction_type: "Siz", role: "Rector", organization: "University" },
  "holidays/holiday-1": { id: "holiday-1", title: "Occasion", start_date: "2026-11-08", categories: [], templates: {} },
};
const read = async (collection, id) => records[`${collection}/${id}`] ?? null;
const openai = async (path) => path === "responses" ? { output_text: "A respectful greeting." } : {};

async function withServer(overrides, run) {
  const server = createFirebaseBridge({ verifyToken: async () => identity, read, openai, origins: [origin], ...overrides });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = `http://127.0.0.1:${server.address().port}`;
  const call = (path, options = {}) => fetch(address + path, { ...options, headers: { origin, authorization: `Bearer ${token}`, ...options.headers } });
  try { await run(call); }
  finally { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
}

test("bridge rejects missing origin, token, and invalid identity", async () => {
  await withServer({}, async (call) => {
    assert.equal((await call("/v1/firebase/settings", { headers: { origin: "https://evil.example" } })).status, 403);
    assert.equal((await call("/v1/firebase/settings", { headers: { authorization: "" } })).status, 401);
  });
  await withServer({ verifyToken: async () => ({ ...identity, firebase: { sign_in_provider: "password" } }) }, async (call) => {
    assert.equal((await call("/v1/firebase/settings")).status, 401);
  });
  await withServer({ verifyToken: async () => { throw new Error("invalid signature"); } }, async (call) => {
    assert.equal((await call("/v1/firebase/settings")).status, 401);
  });
});

test("bridge denies inactive members and missing role permissions", async () => {
  await withServer({ read: async (collection, id) => collection === "members" ? { ...records[`members/${id}`], active: false } : null }, async (call) => {
    assert.equal((await call("/v1/firebase/settings")).status, 403);
  });
  await withServer({ read: async (collection, id) => collection === "members" ? { ...records[`members/${id}`], role_id: "assistant" } : collection === "roles" ? { permissions: ["drafts.view"] } : read(collection, id) }, async (call) => {
    assert.equal((await call("/v1/firebase/settings")).status, 403);
    assert.equal((await call("/v1/firebase/birthday", { method: "POST", body: JSON.stringify({ contact_id: "person-1", language: "English" }) })).status, 403);
  });
  await withServer({ read: async () => { throw new Error("Firestore down"); } }, async (call) => {
    assert.equal((await call("/v1/firebase/settings")).status, 503);
  });
});

test("OSINT routes require the right role permissions and fail closed", async () => {
  const osintRoute = async (_request, response, url, _body, readContact) => {
    assert.equal(url.pathname, "/api/osint/availability");
    assert.equal((await readContact("person-1")).name, "Person One");
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ available: true }));
  };
  await withServer({ osintRoute }, async (call) => {
    const answer = await call("/v1/firebase/osint/availability");
    assert.equal(answer.status, 200);
    assert.equal(answer.headers.get("access-control-allow-origin"), origin);
    assert.deepEqual(await answer.json(), { available: true });
  });
  const limitedRead = async (collection, id) => collection === "members" ? { ...records[`members/${id}`], role_id: "limited" } : collection === "roles" ? { permissions: ["osint.view"] } : read(collection, id);
  await withServer({ read: limitedRead, osintRoute }, async (call) => {
    assert.equal((await call("/v1/firebase/osint/availability")).status, 200);
    assert.equal((await call("/v1/firebase/osint/search", { method: "POST", body: "{}" })).status, 403);
  });
  const managerRead = async (collection, id) => collection === "members" ? { ...records[`members/${id}`], role_id: "manager" } : collection === "roles" ? { permissions: ["osint.view", "osint.manage"] } : read(collection, id);
  await withServer({ read: managerRead, osintRoute }, async (call) => {
    assert.equal((await call("/v1/firebase/osint/candidates/one/confirm", { method: "POST", body: "{}" })).status, 403);
  });
  await withServer({ osintRoute: async () => { throw new Error("OSINT database is offline"); } }, async (call) => {
    assert.equal((await call("/v1/firebase/osint/availability")).status, 503);
  });
});

test("durable rate limiting fails closed and internal routes bypass browser CORS only through their verifier", async () => {
  let limitCalls = 0;
  await withServer({ consumeRateLimit: async subject => ({ allowed: ++limitCalls < 2 && subject === identity.uid }) }, async (call) => {
    const first = await call("/v1/firebase/birthday", { method: "POST", body: JSON.stringify({ contact_id: "person-1", language: "English" }) });
    assert.equal(first.status, 503, "generation still fails closed when no key is configured");
    const second = await call("/v1/firebase/birthday", { method: "POST", body: JSON.stringify({ contact_id: "person-1", language: "English" }) });
    assert.equal(second.status, 429);
  });
  const server = createFirebaseBridge({ verifyToken: async () => identity, read, openai, origins: [origin], internalRoute: async (_request, response, path) => {
    assert.equal(path, "/internal/osint/tick");
    response.writeHead(403, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "Access denied." }));
  } });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const result = await fetch(`http://127.0.0.1:${server.address().port}/internal/osint/tick`, { method: "POST" });
    assert.equal(result.status, 403);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});

test("bridge saves the key only in its private file and uses canonical contact data", async () => {
  await withServer({}, async (call) => {
    const saved = await call("/v1/firebase/openai-key", { method: "PUT", body: JSON.stringify({ api_key: "sk-" + "x".repeat(28) }) });
    assert.equal(saved.status, 200);
    const status = await saved.json();
    assert.equal(status.configured, true);
    assert.equal("api_key" in status, false);
    assert.equal((await readFile(join(directory, "openai-api-key"), "utf8")).trim(), "sk-" + "x".repeat(28));
    const generated = await call("/v1/firebase/birthday", { method: "POST", body: JSON.stringify({ contact_id: "person-1", language: "English", name: "Spoofed Name" }) });
    assert.equal(generated.status, 200);
    assert.equal((await generated.json()).message.contact_name, "Person One");
    const invalid = await call("/v1/firebase/birthday", { method: "POST", body: JSON.stringify({ contact_id: "../../other", language: "English" }) });
    assert.equal(invalid.status, 400);
    const removed = await call("/v1/firebase/openai-key", { method: "DELETE" });
    assert.equal((await removed.json()).configured, false);
  });
});

test("deployment-managed OpenAI configuration remains usable but cannot be changed by the browser", async () => {
  process.env.OPENAI_API_KEY = "sk-" + "m".repeat(28);
  try {
    await withServer({}, async (call) => {
      const statusResponse = await call("/v1/firebase/settings");
      assert.equal(statusResponse.status, 200);
      const status = await statusResponse.json();
      assert.equal(status.configured, true);
      assert.equal(status.source, "environment");
      assert.equal(status.key_hint, "••••mmmm");
      assert.equal((await call("/v1/firebase/openai-key", { method: "PUT", body: JSON.stringify({ api_key: "sk-" + "x".repeat(28) }) })).status, 409);
      assert.equal((await call("/v1/firebase/openai-key", { method: "DELETE" })).status, 409);
      assert.equal((await call("/v1/firebase/openai-model", { method: "PUT", body: JSON.stringify({ model: "gpt-6-luna" }) })).status, 409);
      assert.equal((await call("/v1/firebase/birthday", { method: "POST", body: JSON.stringify({ contact_id: "person-1", language: "English" }) })).status, 200);
    });
  } finally {
    delete process.env.OPENAI_API_KEY;
  }
});

test("bridge rejects OpenAI failure without returning a draft", async () => {
  await writeFile(join(directory, "openai-api-key"), "sk-" + "y".repeat(28));
  await withServer({ openai: async () => { throw new Error("provider failed"); } }, async (call) => {
    const response = await call("/v1/firebase/birthday", { method: "POST", body: JSON.stringify({ contact_id: "person-1", language: "English" }) });
    assert.equal(response.status, 503);
    assert.equal("message" in await response.json(), false);
  });
});

test("holiday generation uses saved recipients and verifies one message per contact", async () => {
  await writeFile(join(directory, "openai-api-key"), "sk-" + "z".repeat(28));
  let prompt = "";
  await withServer({ openai: async (_path, options) => {
    prompt = JSON.parse(options.body).input;
    return { output_text: JSON.stringify({ messages: [{ contact_id: "person-1", content: "A respectful occasion greeting." }] }) };
  } }, async (call) => {
    const result = await call("/v1/firebase/holiday", { method: "POST", body: JSON.stringify({ holiday_id: "holiday-1", contact_ids: ["person-1"], language: "English" }) });
    assert.equal(result.status, 200);
    assert.equal((await result.json()).messages[0].contact_name, "Person One");
    assert.match(prompt, /Person One/);
    assert.match(prompt, /formal/i);
  });
  await withServer({ openai: async () => ({ output_text: JSON.stringify({ messages: [] }) }) }, async (call) => {
    const result = await call("/v1/firebase/holiday", { method: "POST", body: JSON.stringify({ holiday_id: "holiday-1", contact_ids: ["person-1"], language: "English" }) });
    assert.equal(result.status, 503);
  });
});

test.after(async () => { await rm(directory, { recursive: true, force: true }); });

test("birthday prompts omit private notes unless the user opts in", async () => {
  await writeFile(join(directory, "openai-api-key"), "sk-" + "n".repeat(28));
  const prompts = [];
  const capture = async (path, options) => { if (path === "responses") prompts.push(JSON.parse(options.body).input); return path === "responses" ? { output_text: "A respectful greeting." } : {}; };
  const withNotes = async (collection, id) => collection === "contacts" ? { ...records["contacts/person-1"], notes: "Private health detail" } : read(collection, id);
  await withServer({ read: withNotes, openai: capture }, async (call) => {
    assert.equal((await call("/v1/firebase/birthday", { method: "POST", body: JSON.stringify({ contact_id: "person-1", language: "English" }) })).status, 200);
    assert.equal((await call("/v1/firebase/birthday", { method: "POST", body: JSON.stringify({ contact_id: "person-1", language: "English", include_notes: true }) })).status, 200);
    assert.equal((await call("/v1/firebase/birthday", { method: "POST", body: JSON.stringify({ contact_id: "person-1", language: "English", include_notes: "true" }) })).status, 200);
  });
  assert.equal(prompts.length, 3);
  assert.equal(prompts[0].includes("Private health detail"), false);
  assert.equal(prompts[1].includes("Private health detail"), true);
  assert.equal(prompts[2].includes("Private health detail"), false);
});

test("holiday notes consent is explicit and is never retained by the service", async () => {
  await writeFile(join(directory, "openai-api-key"), "sk-" + "n".repeat(28));
  const prompts = [];
  const withNotes = async (collection, id) => collection === "contacts" ? { ...records["contacts/person-1"], notes: "Private detail " + "x".repeat(2500), emails: [{ address: "not-for-ai@example.com" }] } : read(collection, id);
  const capture = async (_path, options) => {
    prompts.push(JSON.parse(options.body).input);
    return { output_text: JSON.stringify({ messages: [{ contact_id: "person-1", content: "A respectful greeting." }] }) };
  };
  await withServer({ read: withNotes, openai: capture }, async (call) => {
    for (const consent of [true, undefined, "true"]) {
      const result = await call("/v1/firebase/holiday", { method: "POST", body: JSON.stringify({ holiday_id: "holiday-1", contact_ids: ["person-1"], language: "English", include_notes: consent }) });
      assert.equal(result.status, 200);
    }
  });
  assert.equal(prompts[0].includes("Private detail"), true);
  assert.equal(prompts[1].includes("Private detail"), false);
  assert.equal(prompts[2].includes("Private detail"), false);
  for (const prompt of prompts) {
    assert.equal(prompt.includes("not-for-ai@example.com"), false);
    assert.equal(prompt.includes("x".repeat(2100)), false);
  }
});

test("OpenAI is asked not to store generated drafts", async () => {
  await writeFile(join(directory, "openai-api-key"), "sk-" + "s".repeat(28));
  const bodies = [];
  const capture = async (path, options) => { if (path === "responses") bodies.push(JSON.parse(options.body)); return path === "responses" ? { output_text: "A respectful greeting." } : {}; };
  await withServer({ openai: capture }, async (call) => {
    assert.equal((await call("/v1/firebase/birthday", { method: "POST", body: JSON.stringify({ contact_id: "person-1", language: "English" }) })).status, 200);
  });
  assert.equal(bodies.length, 1);
  assert.equal(bodies[0].store, false);
});
