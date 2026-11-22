import { createServer } from "node:http";
import { chmod, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { celebrationAddressGuidance } from "./celebration-address.mjs";
import { handleOsintRoute } from "./osint-service.mjs";
import { confirmFirebaseOsint } from "./firebase-osint-confirm.mjs";

const projectId = process.env.CONTACTGRAPH_FIREBASE_PROJECT_ID || "contactgraph-vusal-2026";
const allowedOrigins = (process.env.CONTACTGRAPH_FIREBASE_ALLOWED_ORIGINS || "https://contacts.vusalkhalilov.com,https://contactgraph-vusal-2026.web.app")
  .split(",").map((item) => item.trim()).filter(Boolean);
const secretDirectory = resolve(process.env.CONTACTGRAPH_SECRETS_DIR || "/data/secrets");
const port = Number(process.env.CONTACTGRAPH_FIREBASE_BRIDGE_PORT || 4180);
const keyFile = resolve(secretDirectory, "openai-api-key");
const modelFile = resolve(secretDirectory, "openai-model");
const defaultModel = process.env.OPENAI_MODEL || "gpt-6-astra";
const maxBodyBytes = 16_384;
const languages = new Set(["Azerbaijani", "English", "Russian"]);
const securityHeaders = {
  "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
  "permissions-policy": "camera=(), microphone=(), geolocation=()",
  "referrer-policy": "no-referrer",
  "strict-transport-security": "max-age=31536000; includeSubDomains",
  "x-content-type-options": "nosniff",
};

function send(response, status, body, origin = "") {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    ...securityHeaders,
    ...(origin ? { "access-control-allow-origin": origin, vary: "Origin" } : {}),
  });
  response.end(JSON.stringify(body));
}

function documentId(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9._:+@-]{1,200}$/.test(value) || value === "." || value === "..") throw new HttpError(400, "Invalid record ID.");
  return value;
}

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

async function readBody(request) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBodyBytes) throw new HttpError(413, "Request is too large.");
    chunks.push(chunk);
  }
  let body;
  try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new HttpError(400, "Invalid JSON."); }
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new HttpError(400, "Invalid request body.");
  return body;
}

function decodeField(field) {
  if ("stringValue" in field) return field.stringValue;
  if ("integerValue" in field) return Number(field.integerValue);
  if ("doubleValue" in field) return Number(field.doubleValue);
  if ("booleanValue" in field) return field.booleanValue;
  if ("nullValue" in field) return null;
  if ("arrayValue" in field) return (field.arrayValue.values || []).map(decodeField);
  if ("mapValue" in field) return Object.fromEntries(Object.entries(field.mapValue.fields || {}).map(([key, value]) => [key, decodeField(value)]));
  throw new HttpError(503, "Record format is unavailable.");
}

async function firestoreDocument(collection, id, token, fetcher = fetch) {
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${collection}/${encodeURIComponent(documentId(id))}`;
  let response;
  try { response = await fetcher(url, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(8000) }); }
  catch { throw new HttpError(503, "Firebase is temporarily unavailable."); }
  if (response.status === 404) return null;
  if (response.status === 401 || response.status === 403) throw new HttpError(403, "Access denied.");
  if (!response.ok) throw new HttpError(503, "Firebase is temporarily unavailable.");
  const document = await response.json().catch(() => null);
  if (!document?.fields || typeof document.fields !== "object") throw new HttpError(503, "Record format is unavailable.");
  const record = { id, ...Object.fromEntries(Object.entries(document.fields).map(([key, value]) => [key, decodeField(value)])) };
  Object.defineProperty(record, "_firestore_update_time", { value: document.updateTime });
  return record;
}

async function fileText(path) {
  try { return (await readFile(path, "utf8")).trim(); }
  catch (error) { if (error?.code === "ENOENT") return ""; throw error; }
}

async function configuration() {
  const environmentKey = process.env.OPENAI_API_KEY?.trim() || "";
  const storedKey = environmentKey ? "" : await fileText(keyFile);
  const key = environmentKey || storedKey;
  const model = environmentKey ? defaultModel : await fileText(modelFile) || defaultModel;
  return { key, model, status: {
    configured: Boolean(key), source: environmentKey ? "environment" : storedKey ? "settings" : null,
    key_hint: key ? `••••${key.slice(-4)}` : "", model,
  } };
}

async function storeSecret(path, value) {
  await mkdir(secretDirectory, { recursive: true, mode: 0o700 });
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${value}\n`, { encoding: "utf8", mode: 0o600 });
  try { await rename(temporary, path); await chmod(path, 0o600); }
  catch (error) { await unlink(temporary).catch(() => undefined); throw error; }
}

async function openAiRequest(path, options, fetcher = fetch) {
  let response;
  try { response = await fetcher(`https://api.openai.com/v1/${path}`, { ...options, signal: AbortSignal.timeout(60_000) }); }
  catch { throw new HttpError(503, "OpenAI is temporarily unavailable."); }
  if (!response.ok) throw new HttpError(response.status === 401 || response.status === 403 ? 400 : 503, "OpenAI rejected the request. Check the key, model, and account access.");
  return response.json().catch(() => { throw new HttpError(503, "OpenAI returned an invalid response."); });
}

function responseText(body) {
  if (typeof body.output_text === "string" && body.output_text.trim()) return body.output_text.trim();
  return (body.output || []).flatMap((item) => item.content || []).filter((item) => item.type === "output_text").map((item) => item.text).join("\n").trim();
}

function languageAndGuidance(body) {
  if (!languages.has(body.language)) throw new HttpError(400, "Choose Azerbaijani, English, or Russian.");
  const guidance = body.guidance ?? "";
  if (typeof guidance !== "string" || guidance.length > 2000) throw new HttpError(400, "Extra guidance must be 2,000 characters or fewer.");
  return { language: body.language, guidance: guidance.trim() };
}

function limited(value, length = 300) { return typeof value === "string" ? value.slice(0, length) : ""; }

async function generateBirthday(body, token, read, openai) {
  const { language, guidance } = languageAndGuidance(body);
  const contact = await read("contacts", documentId(body.contact_id), token);
  if (!contact) throw new HttpError(404, "Contact not found.");
  const { key, model } = await configuration();
  if (!key) throw new HttpError(503, "Add an OpenAI API key in Settings first.");
  const input = [
    "Write one warm, concise, copy-ready personal birthday greeting.",
    `Language: ${language}`,
    `Recipient's exact saved name: ${limited(contact.name)}`,
    `Saved interaction type/address preference: ${limited(contact.interaction_type) || "Unrecorded"}`,
    `Address-form rule: ${celebrationAddressGuidance(language, contact.interaction_type)}`,
    `Role: ${limited(contact.role) || "Unrecorded"}`,
    `Organization: ${limited(contact.organization) || "Unrecorded"}`,
    // Privacy (2026-11-08): notes are sent only when the user opts in for this request.
    body.include_notes === true ? `Saved notes: ${limited(contact.notes, 2000) || "None"}` : "",
    guidance ? `Additional user guidance, subordinate to saved preferences and factual accuracy:\n${guidance}` : "",
    "Follow the address-form rule throughout. Do not infer familiarity, gender, relationship, title, achievements, or anecdotes. Do not mention email or phone. Return only the message text.",
  ].join("\n\n");
  const answer = await openai("responses", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${key}` }, body: JSON.stringify({ model, store: false, instructions: "Write accurate, respectful birthday messages using only supplied contact details. Never claim a message was sent.", input }) });
  const content = responseText(answer);
  if (!content || content.length > 10_000) throw new HttpError(503, "OpenAI returned an invalid message.");
  return { message: { holiday_id: "contactgraph-birthday", holiday_title: "Birthday", contact_id: contact.id, contact_name: contact.name, language, content, model, status: "generated", sent_at: null } };
}

async function generateHoliday(body, token, read, openai) {
  const { language, guidance } = languageAndGuidance(body);
  const holiday = await read("holidays", documentId(body.holiday_id), token);
  if (!holiday) throw new HttpError(404, "Holiday not found.");
  if (!Array.isArray(body.contact_ids) || body.contact_ids.length < 1 || body.contact_ids.length > 50) throw new HttpError(400, "Choose between 1 and 50 contacts.");
  const ids = [...new Set(body.contact_ids.map(documentId))];
  if (ids.length !== body.contact_ids.length) throw new HttpError(400, "Choose each contact once.");
  const contacts = await Promise.all(ids.map((id) => read("contacts", id, token)));
  if (contacts.some((contact) => !contact)) throw new HttpError(404, "A selected contact was not found.");
  const { key, model } = await configuration();
  if (!key) throw new HttpError(503, "Add an OpenAI API key in Settings first.");
  const template = limited(holiday.templates?.[language], 4000);
  const recipients = contacts.map((contact) => ({
    contact_id: contact.id, saved_name: limited(contact.name), organization: limited(contact.organization), role: limited(contact.role),
    department: limited(contact.department), interaction_type: limited(contact.interaction_type) || "Unrecorded",
    address_form_guidance: celebrationAddressGuidance(language, contact.interaction_type, Boolean(template)),
    ...(body.include_notes === true ? { notes: String(contact.notes || "").slice(0, 2000) } : {}),
  }));
  const input = [
    `Occasion: ${limited(holiday.title)}`,
    `Date: ${limited(holiday.start_date, 10)}`,
    `Language: ${language}`,
    `Category: ${Array.isArray(holiday.categories) ? holiday.categories.map((value) => limited(value, 80)).join(", ") : ""}`,
    `Verification: ${limited(holiday.verification, 500)}`,
    `Background: ${limited(holiday.description, 4000)}`,
    template ? `Approved reference wording:\n${template}` : "No approved wording is stored; stay within the supplied occasion facts.",
    `Recipients:\n${JSON.stringify(recipients)}`,
    guidance ? `Additional user guidance, subordinate to saved preferences and factual accuracy:\n${guidance}` : "",
    `Create exactly one concise personal message for every recipient. Address each by exact saved_name and follow their address_form_guidance separately. Do not include contact details in the message or invent achievements, relationships, gender, patronymics, or endorsements. For academic leaders without a confirmed teaching role, acknowledge educational leadership without saying they teach classes. ${holiday.categories?.includes("AZ_REMEMBRANCE") ? "Use solemn remembrance language and never congratulate." : "Use an appropriate warm, professional tone."} Return every contact_id exactly once.`,
  ].join("\n\n");
  const answer = await openai("responses", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${key}` }, body: JSON.stringify({
    model, store: false, instructions: "Write accurate individual celebration or remembrance messages using only supplied facts. Never claim a message was sent.", input,
    text: { format: { type: "json_schema", name: "personalized_holiday_messages", strict: true, schema: {
      type: "object", properties: { messages: { type: "array", items: { type: "object", properties: { contact_id: { type: "string", enum: ids }, content: { type: "string" } }, required: ["contact_id", "content"], additionalProperties: false } } }, required: ["messages"], additionalProperties: false,
    } } },
  }) });
  let parsed;
  try { parsed = JSON.parse(responseText(answer)); }
  catch { throw new HttpError(503, "OpenAI returned messages in an unexpected format."); }
  if (!Array.isArray(parsed?.messages) || parsed.messages.length !== ids.length) throw new HttpError(503, "OpenAI returned an incomplete set of messages.");
  const byId = new Map(parsed.messages.map((item) => [item.contact_id, item.content]));
  if (byId.size !== ids.length || ids.some((id) => typeof byId.get(id) !== "string" || !byId.get(id).trim() || byId.get(id).length > 10_000)) throw new HttpError(503, "OpenAI returned an incomplete set of messages.");
  return { messages: ids.map((id, index) => ({ holiday_id: holiday.id, holiday_title: holiday.title, contact_id: id, contact_name: contacts[index].name, language, content: byId.get(id).trim(), model, status: "generated", sent_at: null })) };
}

export function createFirebaseBridge({ verifyToken, read = firestoreDocument, openai = openAiRequest, osintRoute = handleOsintRoute, confirmOsint = confirmFirebaseOsint, origins = allowedOrigins, consumeRateLimit, internalRoute } = {}) {
  const generationTimes = new Map();
  return createServer(async (request, response) => {
    const requestId = randomUUID();
    const requestPath = new URL(request.url, "http://localhost").pathname;
    if (requestPath.startsWith("/internal/")) {
      if (typeof internalRoute !== "function") return send(response, 404, { error: "Not found.", request_id: requestId });
      try { return await internalRoute(request, response, requestPath, readBody, requestId); }
      catch (error) {
        console.error(JSON.stringify({ timestamp: new Date().toISOString(), level: "error", service: "contactgraph-osint", request_id: requestId, event: "internal_request_failed" }));
        return send(response, error instanceof HttpError ? error.status : 503, { error: error instanceof HttpError ? error.message : "Service is temporarily unavailable.", request_id: requestId });
      }
    }
    const origin = String(request.headers.origin || "");
    if (requestPath === "/healthz" && request.method === "GET") return send(response, 200, { ok: true, service: "contactgraph-osint" });
    if (!origins.includes(origin)) return send(response, 403, { error: "Origin is not allowed." });
    if (request.method === "OPTIONS") {
      response.writeHead(204, { ...securityHeaders, "access-control-allow-origin": origin, "access-control-allow-methods": "GET, PUT, POST, DELETE, OPTIONS", "access-control-allow-headers": "Authorization, Content-Type", "access-control-max-age": "600", vary: "Origin", "cache-control": "no-store" });
      return response.end();
    }
    const bearer = /^Bearer ([A-Za-z0-9._-]{100,8192})$/.exec(String(request.headers.authorization || ""));
    if (!bearer) return send(response, 401, { error: "Sign in required." }, origin);
    try {
      let identity;
      try { identity = await verifyToken(bearer[1]); }
      catch { throw new HttpError(401, "Sign in required."); }
      if (!identity?.uid || identity.email_verified !== true || identity.firebase?.sign_in_provider !== "google.com" || typeof identity.email !== "string") throw new HttpError(401, "Sign in required.");
      const email = identity.email.toLowerCase();
      const member = await read("members", documentId(email), bearer[1]);
      if (!member || member.active !== true || (member.email && member.email.toLowerCase() !== email) || typeof member.role_id !== "string") throw new HttpError(403, "Access denied.");
      let permissions = ["*"];
      if (member.role_id !== "owner") {
        const role = await read("roles", documentId(member.role_id), bearer[1]);
        permissions = Array.isArray(role?.permissions) ? role.permissions : [];
      }
      const permitted = (name) => permissions.includes("*") || permissions.includes(name);
      const path = new URL(request.url, "http://localhost").pathname;
      const method = request.method;
      const setting = path === "/v1/firebase/settings" || path === "/v1/firebase/openai-key" || path === "/v1/firebase/openai-model";
      const generation = path === "/v1/firebase/availability" || path === "/v1/firebase/birthday" || path === "/v1/firebase/holiday";
      const osint = path === "/v1/firebase/osint" || path.startsWith("/v1/firebase/osint/");
      if (!setting && !generation && !osint) throw new HttpError(404, "Not found.");
      if (!permitted(osint ? method === "GET" ? "osint.view" : "osint.manage" : setting ? "settings.manage" : "drafts.manage")) throw new HttpError(403, "Access denied.");
      if (osint && method === "POST" && /^\/v1\/firebase\/osint\/candidates\/[^/]+\/confirm$/.test(path) && !permitted("contacts.edit")) throw new HttpError(403, "Access denied.");
      if (method === "POST" && (path === "/v1/firebase/birthday" || path === "/v1/firebase/holiday" || path === "/v1/firebase/osint/search" || path === "/v1/firebase/osint/run")) {
        if (consumeRateLimit) {
          const result = await consumeRateLimit(identity.uid);
          if (!result?.allowed) throw new HttpError(429, "Please wait before starting another search or generation.");
        } else {
          const now = Date.now();
          const recent = (generationTimes.get(identity.uid) || []).filter((time) => now - time < 60_000);
          if (recent.length >= 5) throw new HttpError(429, "Please wait before generating more messages.");
          generationTimes.set(identity.uid, [...recent, now]);
        }
      }
      if (osint) {
        const mapped = new URL(request.url, "http://localhost");
        mapped.pathname = path.replace(/^\/v1\/firebase\/osint/, "/api/osint");
        const corsResponse = {
          writeHead(status, headers = {}) { response.writeHead(status, { ...headers, ...securityHeaders, "access-control-allow-origin": origin, vary: "Origin" }); },
          end(body) { response.end(body); },
        };
        return await osintRoute(request, corsResponse, mapped, readBody, (id) => read("contacts", documentId(id), bearer[1]),
          (id, payload) => confirmOsint(documentId(id), payload, { read, token: bearer[1], uid: identity.uid, projectId }));
      }
      if (method === "GET" && (path === "/v1/firebase/settings" || path === "/v1/firebase/availability")) {
        const config = await configuration();
        return send(response, 200, path.endsWith("availability") ? { configured: config.status.configured, model: config.model } : config.status, origin);
      }
      if (path === "/v1/firebase/openai-key" && method === "PUT") {
        if (process.env.OPENAI_API_KEY?.trim()) throw new HttpError(409, "The OpenAI key is managed in Google Secret Manager. Update the secret and deploy a new revision.");
        const body = await readBody(request);
        const key = body.api_key;
        if (typeof key !== "string" || key.length < 20 || key.length > 512 || !/^sk-[A-Za-z0-9_-]+$/.test(key)) throw new HttpError(400, "Enter a valid OpenAI API key.");
        await openai("models", { headers: { authorization: `Bearer ${key}` } });
        await storeSecret(keyFile, key);
        return send(response, 200, (await configuration()).status, origin);
      }
      if (path === "/v1/firebase/openai-key" && method === "DELETE") {
        if (process.env.OPENAI_API_KEY?.trim()) throw new HttpError(409, "The OpenAI key is managed in Google Secret Manager and cannot be removed here.");
        await unlink(keyFile).catch((error) => { if (error?.code !== "ENOENT") throw error; });
        return send(response, 200, (await configuration()).status, origin);
      }
      if (path === "/v1/firebase/openai-model" && method === "PUT") {
        if (process.env.OPENAI_API_KEY?.trim()) throw new HttpError(409, "The OpenAI model is managed by the Cloud Run deployment.");
        const body = await readBody(request);
        const model = body.model;
        if (typeof model !== "string" || model.length < 1 || model.length > 120 || !/^[A-Za-z0-9._:-]+$/.test(model)) throw new HttpError(400, "Enter a valid model ID.");
        const config = await configuration();
        if (!config.key) throw new HttpError(400, "Add an OpenAI API key first.");
        await openai(`models/${encodeURIComponent(model)}`, { headers: { authorization: `Bearer ${config.key}` } });
        await storeSecret(modelFile, model);
        return send(response, 200, (await configuration()).status, origin);
      }
      if (path === "/v1/firebase/birthday" && method === "POST") return send(response, 200, await generateBirthday(await readBody(request), bearer[1], read, openai), origin);
      if (path === "/v1/firebase/holiday" && method === "POST") return send(response, 200, await generateHoliday(await readBody(request), bearer[1], read, openai), origin);
      throw new HttpError(405, "Method not allowed.");
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 503;
      console.error(JSON.stringify({ timestamp: new Date().toISOString(), level: status >= 500 ? "error" : "warning", service: "contactgraph-osint", request_id: requestId, event: status === 401 || status === 403 ? "access_denied" : "request_failed", status }));
      return send(response, status, { error: error instanceof HttpError ? error.message : "Service is temporarily unavailable.", request_id: requestId }, origin);
    }
  });
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  const app = initializeApp({ projectId });
  const server = createFirebaseBridge({ verifyToken: (token) => getAuth(app).verifyIdToken(token) });
  server.listen(port, "0.0.0.0", () => console.info(`Firebase bridge listening on ${port}`));
}
