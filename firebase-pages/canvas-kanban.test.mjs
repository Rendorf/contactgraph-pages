import assert from "node:assert/strict";
import { test, after } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const directory = mkdtempSync(path.join(tmpdir(), "contactgraph-kanban-test-"));
after(() => rmSync(directory, { recursive: true, force: true }));
const app = fileURLToPath(new URL("../", import.meta.url));
const output = path.join(directory, "board.cjs");
await build({
  stdin: { contents: `export * from './app/canvas-kanban';
    import React from 'react';
    import { renderToStaticMarkup } from 'react-dom/server';
    import { CanvasKanban } from './app/canvas-kanban';
    export const render = props => renderToStaticMarkup(React.createElement(CanvasKanban, props));`, resolveDir: app, loader: "tsx" },
  absWorkingDir: app, outfile: output, bundle: true, platform: "node", format: "cjs", jsx: "automatic", logLevel: "silent",
});
const { validateKanban, readKanban, moveKanbanCard, moveKanbanColumn, render } = createRequire(import.meta.url)(output);
const board = { columns: { todo: "To do", done: "Done" }, column_order: ["todo", "done"], assignments: { a: "todo" }, card_order: ["a", "b"] };

test("legacy boards and valid assignments are accepted", () => {
  assert.deepEqual(readKanban({}), { columns: {}, column_order: [], assignments: {}, card_order: [] });
  validateKanban({}, ["a"]);
  validateKanban(board, ["a", "b"]);
});
test("invalid, duplicate and cross-board references are rejected", () => {
  for (const invalid of [null, [], { ...board, assignments: { a: "foreign" } }, { ...board, assignments: { foreign: "todo" } },
    { ...board, column_order: ["todo", "todo"] }, { ...board, card_order: ["a", "a"] }, { ...board, columns: { todo: "", done: "Done" } }]) {
    assert.throws(() => validateKanban(invalid, ["a", "b"]));
  }
});
test("viewer sees assigned and unassigned cards without mutation controls", () => {
  const html = render({ value: board, nodes: [{ id: "a", title: "Assigned", notes: "<script>unsafe</script>", contact_ids: ["c"] }, { id: "b", title: "Unassigned card", notes: "", contact_ids: [] }], editable: false, disabled: false, onChange: () => {}, onOpen: () => {}, contactName: () => "Example contact" });
  assert.match(html, /Assigned/);
  assert.match(html, /Unassigned card/);
  assert.match(html, /Example contact/);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script>|Add column|Rename|draggable="true"|<select/);
});

test("moving and reordering cards preserves the original board and other assignments", () => {
  const moved = moveKanbanCard(board, ["a", "b"], "b", "todo", "a");
  assert.deepEqual(moved.card_order, ["b", "a"]);
  assert.deepEqual(moved.assignments, { a: "todo", b: "todo" });
  assert.deepEqual(board.assignments, { a: "todo" });
  const unassigned = moveKanbanCard(moved, ["a", "b"], "a", "");
  assert.deepEqual(unassigned.assignments, { b: "todo" });
  assert.equal(moveKanbanCard(board, ["a", "b"], "a", "foreign"), board);
});

test("columns move before or after targets without changing cards or assignments", () => {
  const three = { ...board, columns: { ...board.columns, review: "Review" }, column_order: ["todo", "review", "done"] };
  assert.deepEqual(moveKanbanColumn(three, "done", "todo").column_order, ["done", "todo", "review"]);
  const moved = moveKanbanColumn(three, "todo", "done", true);
  assert.deepEqual(moved.column_order, ["review", "done", "todo"]);
  assert.equal(moved.assignments, three.assignments);
  assert.equal(moved.card_order, three.card_order);
  assert.deepEqual(three.column_order, ["todo", "review", "done"]);
  assert.equal(moveKanbanColumn(three, "todo", "todo"), three);
  assert.equal(moveKanbanColumn(three, "", "todo"), three);
  assert.equal(moveKanbanColumn(three, "todo", "foreign"), three);
  validateKanban(moved, ["a", "b"]);
});
test("column drag handles are available only to editors and disabled during saving", () => {
  const props = { value: board, nodes: [], editable: true, disabled: false, onChange: () => {}, onOpen: () => {}, contactName: () => "" };
  assert.match(render(props), /aria-label="Drag To do column to reorder"/);
  assert.doesNotMatch(render({ ...props, editable: false }), /column-drag-handle/);
  assert.doesNotMatch(render({ ...props, disabled: true }), /draggable="true"/);
});
