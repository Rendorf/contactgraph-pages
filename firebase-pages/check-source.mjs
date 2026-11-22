import fs from "node:fs";
import { execFileSync } from "node:child_process";

const tracked = execFileSync("git", ["ls-files", "-z"]).toString("utf8").split("\0").filter(Boolean);
const firebaseFiles = new Set(["README.md", "all-connections-graph.test.mjs", "api.ts", "auth-context.tsx", "backup-firestore.mjs", "check-artifact.mjs", "check-permissions.mjs", "check-source.mjs", "export-duckdb.py", "firebase.json", "firebase.ts", "firestore.rules", "storage.rules", "firestore.rules.test.mjs", "firestore-osint-store.test.mjs", "graph-pan.test.mjs", "hermes-api.ts", "import-firestore.mjs", "index.html", "main.tsx", "meeting-recorder.test.mjs", "migration.test.mjs", "offline-status.tsx", "offline.ts", "permission-catalog.json", "quota.mjs", "quota.test.mjs", "recording-store.ts", "canvas-kanban.test.mjs", "search.test.mjs", "calendar.test.mjs", "settings-module.tsx", "sync-collections.json", "vite-env.d.ts"]);
const cloudScripts = new Set(["celebration-address.mjs", "cloudrun-server.mjs", "firebase-bridge.mjs", "firebase-bridge.test.mjs", "firebase-osint-confirm.mjs", "firestore-osint-store.mjs", "osint-candidates.mjs", "osint-cloud.test.mjs", "osint-feed.mjs", "osint-providers.mjs", "osint-service.mjs", "osint-service.test.mjs", "osint-web.mjs", "osintdb.py"]);
const allowed = (file) => file === ".gitignore"
  || file === "package.json" || file === "package-lock.json" || file === "postcss.config.mjs"
  || file === "tsconfig.json" || file === "vite.firebase.config.ts" || file === "Dockerfile.cloudrun" || file === "requirements-contactdb.txt"
  || file.startsWith("cloudrun/")
  || file.startsWith(".github/workflows/") || file.startsWith("firebase-pages/") && firebaseFiles.has(file.slice("firebase-pages/".length))
  || file.startsWith("components/ui/") || file === "hooks/use-mobile.ts" || file === "lib/utils.ts"
  || file.startsWith("app/") && (file.endsWith(".tsx") || file.endsWith(".ts") || file === "app/globals.css" || file === "app/themes.css")
  || file.startsWith("public/") && ["favicon.svg", "window.svg", "globe.svg", "file.svg", "manifest.webmanifest", "service-worker.js"].includes(file.slice(7))
  || ["docs/firebase-pages-threat-model.md", "docs/appearance-redesign-review.md", "docs/appearance-redesign-backlog.md", "docs/osint-cloud-backend.md", "docs/threat-notes/appearance-and-timeline-redesign-2026-11-18.md", "docs/threat-notes/graph-pan-2026-11-21.md"].includes(file)
  || file === "vendor/shadcn-tailwind-4.13.0.css" || file === "vendor/shadcn-tailwind-4.13.0.LICENSE.md"
  || ["scripts/osint-search.mjs", "scripts/contact-timeline.mjs", "scripts/contact-timeline.test.mjs"].includes(file)
  || file.startsWith("scripts/") && cloudScripts.has(file.slice("scripts/".length));
for (const file of tracked) {
  if (!allowed(file) || /(?:^|\/)(?:contacts\.json|photos|backups|\.env|.*\.duckdb)(?:\/|$)/i.test(file)) throw new Error(`Private or unexpected source file: ${file}`);
  if (file === "package-lock.json") continue;
  const body = fs.readFileSync(file, "utf8");
  if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\b(?:ghp_|github_pat_|sk-proj-)[A-Za-z0-9_-]{16,}|[A-Za-z0-9._%+-]+@gmail\.com/i.test(body)) throw new Error(`Potential secret or personal email in public source: ${file}`);
}
console.log(`Public source audit passed (${tracked.length} tracked files).`);
