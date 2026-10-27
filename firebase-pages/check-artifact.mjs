import fs from "node:fs";
import path from "node:path";

const root = path.resolve(process.argv[2] || "firebase-pages-dist");
if (!fs.existsSync(path.join(root, "index.html"))) throw new Error("Pages artifact is missing index.html.");
const safeFiles = new Set(["index.html", "favicon.svg", "window.svg", "globe.svg", "file.svg", "manifest.webmanifest", "service-worker.js"]);
let files = 0;
function inspect(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Artifact contains a symbolic link: ${absolute}`);
    if (entry.isDirectory()) { inspect(absolute); continue; }
    const relative = path.relative(root, absolute).split(path.sep).join("/");
    if (!entry.isFile() || !(safeFiles.has(relative) || /^assets\/[a-zA-Z0-9_-]+\.(js|css)$/.test(relative))) throw new Error(`Unexpected Pages artifact file: ${relative}`);
    const body = fs.readFileSync(absolute, "utf8");
    if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|contactgraph\.duckdb|"emails"\s*:\s*\[|"phones"\s*:\s*\[/.test(body)) throw new Error(`Potential private data in Pages artifact: ${relative}`);
    files++;
  }
}
inspect(root);
console.log(`Pages artifact safety check passed (${files} files).`);
