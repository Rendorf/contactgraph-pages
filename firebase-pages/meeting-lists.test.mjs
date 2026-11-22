import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = readFileSync(new URL("../app/meeting-lists-model.ts", import.meta.url), "utf8");
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText;
const { meetingListSchedule } = await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);

test("new members are due on the day they join", () => {
  assert.deepEqual(meetingListSchedule({ joined_on: "2026-11-22", cadence_days: null }, 30, null, "2026-11-22"), {
    cadence_days: 30, uses_list_cadence: true, last_activity: null, due_date: "2026-11-22",
  });
});

test("latest meeting or quick check-in advances every derived schedule", () => {
  assert.equal(meetingListSchedule({ joined_on: "2026-01-01", last_contact_on: "2026-11-20", cadence_days: 14 }, 30, "2026-11-18", "2026-11-22").due_date, "2026-12-04");
  assert.equal(meetingListSchedule({ joined_on: "2026-01-01", last_contact_on: "2026-11-18", cadence_days: null }, 30, "2026-11-20", "2026-11-22").due_date, "2026-12-20");
});

test("snooze can defer but not pull a due date forward", () => {
  assert.equal(meetingListSchedule({ joined_on: "2026-01-01", last_contact_on: "2026-11-20", snoozed_until: "2027-01-15" }, 30, null, "2026-11-22").due_date, "2027-01-15");
  assert.equal(meetingListSchedule({ joined_on: "2026-01-01", last_contact_on: "2026-11-20", snoozed_until: "2026-11-25" }, 30, null, "2026-11-22").due_date, "2026-12-20");
});

test("future activity cannot hide a currently due person", () => {
  assert.equal(meetingListSchedule({ joined_on: "2026-01-01", last_contact_on: "2099-01-01" }, 30, null, "2026-11-22").due_date, "2026-01-01");
});
