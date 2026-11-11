import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
const source = readFileSync(new URL("../app/search.tsx", import.meta.url), "utf8");
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText;
const { normalizeSearch, searchRank } = await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);

test("search folds Azerbaijani and Turkish without changing saved names", () => {
  const names = ["Vüsal", "İsmayıl", "Məmmədov", "IŞIK", "Gökçe"];
  assert.deepEqual(names.map(normalizeSearch), ["vusal", "ismayil", "memmedov", "isik", "gokce"]);
  assert.equal(names[0], "Vüsal");
  assert.equal(normalizeSearch("I\u0307smayıl"), normalizeSearch("İsmayıl"));
});
test("Cyrillic searches support original and Latin input", () => {
  assert.equal(normalizeSearch("Вусал"), normalizeSearch("Vusal"));
  assert.equal(normalizeSearch("Елена"), normalizeSearch("Elena"));
  assert.equal(normalizeSearch("Шамиль"), normalizeSearch("Shamil"));
});
test("original spelling ranks before approximate matches", () => {
  const names = ["Vusal", "Вусал", "Vüsal", "Vüsal Əliyev"];
  assert.equal([...names].sort((a, b) => searchRank(a, "Vüsal") - searchRank(b, "Vüsal"))[0], "Vüsal");
  assert.equal(searchRank("Unrelated", "Vüsal"), 6);
  assert.equal(normalizeSearch(null), "");
});
