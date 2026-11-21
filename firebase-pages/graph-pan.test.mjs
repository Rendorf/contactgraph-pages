import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  canStartGraphPan,
  graphCenteredScroll,
  graphPanDistance,
  graphPanScroll,
  GRAPH_PAN_THRESHOLD,
} from "../app/graph-pan.ts";

test("primary left mouse drag can start only on non-interactive graph space", () => {
  assert.equal(canStartGraphPan({ button: 0, isPrimary: true, pointerType: "mouse", interactiveTarget: false }), true);
  assert.equal(canStartGraphPan({ button: 1, isPrimary: true, pointerType: "mouse", interactiveTarget: false }), false);
  assert.equal(canStartGraphPan({ button: 0, isPrimary: false, pointerType: "mouse", interactiveTarget: false }), false);
  assert.equal(canStartGraphPan({ button: 0, isPrimary: true, pointerType: "touch", interactiveTarget: false }), false);
  assert.equal(canStartGraphPan({ button: 0, isPrimary: true, pointerType: "mouse", interactiveTarget: true }), false);
});

test("drag threshold separates a click from an intentional canvas pan", () => {
  const origin = { clientX: 100, clientY: 80 };
  assert.equal(graphPanDistance(origin, 102, 81) < GRAPH_PAN_THRESHOLD, true);
  assert.equal(graphPanDistance(origin, 104, 83) >= GRAPH_PAN_THRESHOLD, true);
});

test("canvas scroll follows mouse dragging in both axes", () => {
  const origin = { clientX: 100, clientY: 80, scrollLeft: 250, scrollTop: 140 };
  assert.deepEqual(graphPanScroll(origin, 130, 110), { left: 220, top: 110 });
  assert.deepEqual(graphPanScroll(origin, 70, 40), { left: 280, top: 180 });
});

test("new graph content starts centered inside its pannable overscan", () => {
  assert.deepEqual(graphCenteredScroll(1240, 1000, 820, 600), { left: 120, top: 110 });
  assert.deepEqual(graphCenteredScroll(700, 1000, 500, 600), { left: 0, top: 0 });
});

test("every graph mode receives pan behavior through the shared zoom hook", () => {
  const zoomSource = fs.readFileSync(new URL("../app/graph-zoom.tsx", import.meta.url), "utf8");
  assert.match(zoomSource, /addEventListener\("pointerdown", startPan\)/);
  assert.match(zoomSource, /setPointerCapture\(event\.pointerId\)/);
  assert.match(zoomSource, /addEventListener\("click", suppressDraggedClick, true\)/);
  for (const file of ["contact-graph.tsx", "people-graph.tsx", "all-connections-graph.tsx"]) {
    const source = fs.readFileSync(new URL(`../app/${file}`, import.meta.url), "utf8");
    assert.match(source, /useGraphZoom\(\)/, `${file} must use the shared graph interaction hook`);
  }
});
