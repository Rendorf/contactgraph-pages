import assert from "node:assert/strict";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import test from "node:test";

const source = process.env.RECORDER_SOURCE_REF
  ? execFileSync("git", ["show", `${process.env.RECORDER_SOURCE_REF}:app/meeting-recorder.tsx`], { encoding: "utf8" })
  : fs.readFileSync(new URL("../app/meeting-recorder.tsx", import.meta.url), "utf8");
const onStopStart = source.indexOf("activeRecorder.onstop = () => {");
const onStopEnd = source.indexOf("elapsedRef.current = 0;", onStopStart);
const onStopBody = source.slice(onStopStart, onStopEnd);

test("stopping creates a local preview without uploading", () => {
  assert.notEqual(onStopStart, -1, "MediaRecorder stop handler is present");
  assert.notEqual(onStopEnd, -1, "MediaRecorder stop handler has its expected boundary");
  assert.equal(/setPending\(\{ blob, duration, url: URL\.createObjectURL\(blob\) \}\)/.test(onStopBody), true, "stop prepares a local object-URL preview");
  assert.equal(/\bupload\s*\(/.test(onStopBody), false, "stop must not persist audio");
  assert.equal(/Stop &amp; review/.test(source), true, "the stop action describes the review step");
});

test("an unsaved preview can be played, explicitly saved, discarded, or downloaded", () => {
  assert.equal(/<audio controls preload="metadata" src=\{pending\.url\}/.test(source), true, "the pending Blob has local audio controls");
  assert.equal(/onClick=\{\(\) => void upload\(pending\.blob, pending\.duration\)\}/.test(source), true, "upload requires the save action");
  assert.equal(/Save recording/.test(source), true);
  assert.equal(/onClick=\{discardPending\}/.test(source), true);
  assert.equal(/Download backup/.test(source), true);
});

test("an unsaved preview protects against accidental navigation", () => {
  assert.equal(/state !== "idle" \|\| pending/.test(source), true, "beforeunload includes a pending preview");
  assert.equal(/Preview · Not saved/.test(source), true, "the preview is visibly marked as unsaved");
});
