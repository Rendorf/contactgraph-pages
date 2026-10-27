import fs from "node:fs";
import { execFileSync } from "node:child_process";

const tracked = execFileSync("git", ["ls-files", "-z"]).toString("utf8").split("\0").filter(Boolean);
const firebaseFiles = new Set(["README.md", "api.ts", "auth-context.tsx", "backup-firestore.mjs", "check-artifact.mjs", "check-permissions.mjs", "check-source.mjs", "export-duckdb.py", "firebase.json", "firebase.ts", "firestore.rules", "firestore.rules.test.mjs", "import-firestore.mjs", "index.html", "main.tsx", "migration.test.mjs", "offline-status.tsx", "offline.ts", "osint-module.tsx", "permission-catalog.json", "settings-module.tsx", "vite-env.d.ts"]);
const allowed = (file) => file === ".gitignore"
  || file === "package.json" || file === "package-lock.json" || file === "postcss.config.mjs"
  || file === "tsconfig.json" || file === "vite.firebase.config.ts"
  || file.startsWith(".github/workflows/") || file.startsWith("firebase-pages/") && firebaseFiles.has(file.slice("firebase-pages/".length))
  || file.startsWith("components/ui/") || file === "hooks/use-mobile.ts" || file === "lib/utils.ts"
  || file.startsWith("app/") && (file.endsWith(".tsx") || file === "app/globals.css")
  || file.startsWith("public/") && ["favicon.svg", "window.svg", "globe.svg", "file.svg", "manifest.webmanifest", "service-worker.js"].includes(file.slice(7))
  || file === "docs/firebase-pages-threat-model.md"
  || file === "vendor/shadcn-tailwind-4.13.0.css" || file === "vendor/shadcn-tailwind-4.13.0.LICENSE.md"
  || file === "scripts/osint-search.mjs";
for (const file of tracked) {
  if (!allowed(file) || /(?:^|\/)(?:contacts\.json|photos|backups|\.env|.*\.duckdb)(?:\/|$)/i.test(file)) throw new Error(`Private or unexpected source file: ${file}`);
  if (file === "package-lock.json") continue;
  const body = fs.readFileSync(file, "utf8");
  if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\b(?:ghp_|github_pat_|sk-proj-)[A-Za-z0-9_-]{16,}|[A-Za-z0-9._%+-]+@gmail\.com/i.test(body)) throw new Error(`Potential secret or personal email in public source: ${file}`);
}
console.log(`Public source audit passed (${tracked.length} tracked files).`);
