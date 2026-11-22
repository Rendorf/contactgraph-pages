import { createHash } from "node:crypto";
import { CloudTasksClient } from "@google-cloud/tasks";
import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { OAuth2Client } from "google-auth-library";
import { createFirebaseBridge } from "./firebase-bridge.mjs";
import { createFirestoreOsintStore } from "./firestore-osint-store.mjs";
import { configureOsintDatabase, handleOsintRoute, runOsintDailyTick, runOsintMonitor } from "./osint-service.mjs";
import { configureManagedSearchBudget } from "./osint-web.mjs";

const projectId = process.env.CONTACTGRAPH_FIREBASE_PROJECT_ID || "contactgraph-vusal-2026";
const port = Number(process.env.PORT || 8080);
const origins = (process.env.CONTACTGRAPH_FIREBASE_ALLOWED_ORIGINS || "https://contacts.vusalkhalilov.com,https://contactgraph-vusal-2026.web.app")
  .split(",").map(value => value.trim()).filter(Boolean);
const internalAudience = process.env.CONTACTGRAPH_INTERNAL_AUDIENCE?.trim() || "";
const schedulerAccount = process.env.CONTACTGRAPH_SCHEDULER_SERVICE_ACCOUNT?.trim().toLowerCase() || "";
const taskQueue = process.env.CONTACTGRAPH_TASK_QUEUE?.trim() || "osint-monitor";

if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid service port");
if (!origins.length || origins.some(value => { try { return new URL(value).origin !== value; } catch { return true; } })) throw new Error("Invalid allowed origin configuration");

const app = initializeApp({ projectId });
const firestore = getFirestore(app);
firestore.settings({ ignoreUndefinedProperties: true });
const store = createFirestoreOsintStore(firestore);
configureOsintDatabase((command, payload) => store.command(command, payload), { persistentTransients: true });
configureManagedSearchBudget(() => store.command("budget-consume"));

function updateTime(value) {
  const seconds = value?.seconds ?? value?._seconds;
  const nanoseconds = value?.nanoseconds ?? value?._nanoseconds;
  if (!Number.isInteger(seconds) || !Number.isInteger(nanoseconds)) return "";
  const base = new Date(seconds * 1000).toISOString().slice(0, -1);
  return `${base}${String(nanoseconds).padStart(9, "0")}Z`;
}

async function read(collection, id) {
  const snapshot = await firestore.collection(collection).doc(id).get();
  if (!snapshot.exists) return null;
  const record = { id: snapshot.id, ...snapshot.data() };
  Object.defineProperty(record, "_firestore_update_time", { value: updateTime(snapshot.updateTime) });
  return record;
}

const oauth = new OAuth2Client();
let tasks;
async function verifyInternal(request) {
  if (!internalAudience || !schedulerAccount) return false;
  const match = /^Bearer ([A-Za-z0-9._-]{100,8192})$/.exec(String(request.headers.authorization || ""));
  if (!match) return false;
  try {
    const ticket = await oauth.verifyIdToken({ idToken: match[1], audience: internalAudience });
    const payload = ticket.getPayload();
    return payload?.email_verified === true && payload.email?.toLowerCase() === schedulerAccount;
  } catch { return false; }
}

async function enqueueMonitor(monitor, date) {
  if (!internalAudience || !schedulerAccount) throw new Error("Task queue authentication is not configured");
  tasks ||= new CloudTasksClient();
  const taskId = `osint-${date.replaceAll("-", "")}-${createHash("sha256").update(monitor.contact_id).digest("hex").slice(0, 24)}`;
  const parent = tasks.queuePath(projectId, "europe-west1", taskQueue);
  const body = Buffer.from(JSON.stringify({ contact_id: monitor.contact_id, query: monitor.query, providers: monitor.providers, handles: monitor.handles }), "utf8").toString("base64");
  try {
    await tasks.createTask({ parent, task: { name: `${parent}/tasks/${taskId}`, dispatchDeadline: { seconds: 300 }, httpRequest: { httpMethod: "POST", url: `${internalAudience}/internal/osint/monitor`, headers: { "content-type": "application/json" }, body, oidcToken: { serviceAccountEmail: schedulerAccount, audience: internalAudience } } } });
  } catch (error) {
    if (error?.code !== 6) throw error;
  }
}

async function internalRoute(request, response, path, _readBody, requestId) {
  response.setHeader("cache-control", "no-store");
  response.setHeader("x-content-type-options", "nosniff");
  response.setHeader("content-security-policy", "default-src 'none'; frame-ancestors 'none'");
  response.setHeader("referrer-policy", "no-referrer");
  response.setHeader("strict-transport-security", "max-age=31536000; includeSubDomains");
  if (!["/internal/osint/tick", "/internal/osint/monitor"].includes(path)) { response.writeHead(404, { "content-type": "application/json" }); return response.end(JSON.stringify({ error: "Not found.", request_id: requestId })); }
  if (request.method !== "POST") { response.writeHead(405, { "content-type": "application/json", allow: "POST" }); return response.end(JSON.stringify({ error: "Method not allowed.", request_id: requestId })); }
  if (!await verifyInternal(request)) { response.writeHead(403, { "content-type": "application/json" }); return response.end(JSON.stringify({ error: "Access denied.", request_id: requestId })); }
  if (path === "/internal/osint/monitor") {
    const result = await runOsintMonitor(await _readBody(request), id => read("contacts", id));
    response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    return response.end(JSON.stringify({ ok: true, found: Number(result.added || 0) + Number(result.finding_added || 0), request_id: requestId }));
  }
  const ran = await runOsintDailyTick(id => read("contacts", id), undefined, enqueueMonitor);
  response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
  return response.end(JSON.stringify({ ok: true, ran, request_id: requestId }));
}

const server = createFirebaseBridge({
  verifyToken: token => getAuth(app).verifyIdToken(token, true),
  read,
  osintRoute: handleOsintRoute,
  origins,
  consumeRateLimit: subject => store.command("rate-limit-consume", { subject }),
  internalRoute,
});

server.listen(port, "0.0.0.0", () => console.info(JSON.stringify({ timestamp: new Date().toISOString(), level: "info", service: "contactgraph-osint", event: "listening", port })));
