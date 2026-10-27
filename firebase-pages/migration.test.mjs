import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const appRoot = path.resolve(new URL("..", import.meta.url).pathname);
const run = (script, args, env = {}) => {
  const result = spawnSync(process.execPath, [path.join(appRoot, "firebase-pages", script), ...args], { cwd: appRoot, env: { ...process.env, ...env }, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`${script} failed: ${result.stderr || result.stdout}`);
  return result.stdout;
};

test("private migration imports, resumes, backs up, verifies, and restores", () => {
  assert.ok(process.env.FIRESTORE_EMULATOR_HOST, "Run this test under the Firestore emulator.");
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "contactgraph-migration-test-"));
  try {
    const input = path.join(directory, "source.json");
    const file = path.join(directory, "backup.cgbak");
    const source = Object.fromEntries(["contacts", "holidays", "holiday_messages", "canvases", "meetings", "followup_actions", "followup_settings", "roles", "members", "osint_settings", "osint_monitors", "osint_feeds", "osint_items", "osint_runs", "osint_candidates", "osint_provider_findings"].map((name) => [name, []]));
    source.contacts.push({ id: "person-1", name: "Private test contact", labels: ["Test"], emails: [{ address: "private@example.test" }] });
    source.roles.push({ id: "owner", name: "Owner", permissions: ["*"] }, { id: "assistant", name: "Assistant", permissions: ["contacts.view"] });
    source.members.push({ id: "local-owner", username: "owner", display_name: "Owner", role_id: "owner", active: true, email: null });
    fs.writeFileSync(input, JSON.stringify(source), { mode: 0o600 });
    const common = ["--input", input, "--owner-email", "owner@example.com"];
    assert.match(run("import-firestore.mjs", common), /"mode":"dry-run"/);
    assert.match(run("import-firestore.mjs", [...common, "--project", "demo-contactgraph-migration", "--apply"]), /"verified":true/);
    assert.match(run("import-firestore.mjs", [...common, "--project", "demo-contactgraph-migration", "--apply", "--resume"]), /"verified":true/);
    const env = { CONTACTGRAPH_BACKUP_PASSPHRASE: "synthetic-backup-passphrase-12345" };
    assert.match(run("backup-firestore.mjs", ["--mode", "export", "--project", "demo-contactgraph-migration", "--file", file], env), /"verified":true/);
    assert.doesNotMatch(fs.readFileSync(file, "utf8"), /Private test contact/);
    assert.match(run("backup-firestore.mjs", ["--mode", "verify", "--file", file], env), /"verified":true/);
    assert.match(run("backup-firestore.mjs", ["--mode", "restore", "--project", "demo-contactgraph-restored", "--file", file], env), /"restored":true/);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
