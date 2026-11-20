import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  buildAllConnections,
  organizationNodeId,
  personNodeId,
  selectConnectionSubgraph,
  tagNodeId,
} from "../app/all-connections-graph-data.ts";
import { GRAPH_HEIGHT, GRAPH_WIDTH, graphForceLayout } from "../app/graph-force-layout.ts";

const contacts = [
  { id: "alice", name: "Alice", organization: " Org One ", labels: ["Tag One", "Tag One", ""] },
  { id: "bob", name: "Bob", organization: "Org One", labels: ["Tag Two"] },
  { id: "cara", name: "Cara", organization: "Org Two", labels: ["Tag One"] },
];
const links = [
  { id: "ab", contact_a: "alice", contact_b: "bob", note: "colleagues" },
  { id: "ba-duplicate", contact_a: "bob", contact_b: "alice", note: "duplicate" },
  { id: "bc", contact_a: "bob", contact_b: "cara", note: "introduced" },
  { id: "self", contact_a: "alice", contact_b: "alice", note: "invalid" },
  { id: "missing", contact_a: "alice", contact_b: "missing", note: "stale" },
];

test("builds all three relationship types and ignores invalid links", () => {
  const model = buildAllConnections(contacts, links);
  assert.deepEqual(model.nodes.reduce((counts, node) => ({ ...counts, [node.kind]: (counts[node.kind] ?? 0) + 1 }), {}), {
    person: 3,
    organization: 2,
    tag: 2,
  });
  assert.deepEqual(model.edges.reduce((counts, edge) => ({ ...counts, [edge.kind]: (counts[edge.kind] ?? 0) + 1 }), {}), {
    people: 2,
    organization: 3,
    tag: 3,
  });
  assert.equal(model.nodes.find((node) => node.id === organizationNodeId("Org One"))?.count, 2);
  assert.equal(model.nodes.find((node) => node.id === tagNodeId("Tag One"))?.count, 2);
  assert.equal(model.edges.some((edge) => edge.source === edge.target), false);
  assert.equal(model.nodes.some((node) => node.label === ""), false);
});

test("focused traversal exposes organizations and tags through their people", () => {
  const model = buildAllConnections(contacts, links);
  const direct = selectConnectionSubgraph(model, { focusId: organizationNodeId("Org One"), depth: 1, nodeLimit: 20 });
  assert.deepEqual(new Set(direct.nodes.map((node) => node.id)), new Set([
    organizationNodeId("Org One"), personNodeId("alice"), personNodeId("bob"),
  ]));
  const twoSteps = selectConnectionSubgraph(model, { focusId: organizationNodeId("Org One"), depth: 2, nodeLimit: 20 });
  assert.equal(twoSteps.nodes.some((node) => node.id === tagNodeId("Tag One")), true);
  assert.equal(twoSteps.nodes.some((node) => node.id === tagNodeId("Tag Two")), true);
  assert.equal(twoSteps.nodes.some((node) => node.id === personNodeId("cara")), true);
});

test("overview is bounded while retaining every available node type", () => {
  const model = buildAllConnections(contacts, links);
  const overview = selectConnectionSubgraph(model, { focusId: null, depth: 1, nodeLimit: 5 });
  assert.equal(overview.nodes.length, 5);
  assert.deepEqual(new Set(overview.nodes.map((node) => node.kind)), new Set(["person", "organization", "tag"]));
  assert.deepEqual(new Set(overview.edges.map((edge) => edge.kind)), new Set(["people", "organization", "tag"]));
  assert.equal(overview.edges.every((edge) => overview.nodeIds.has(edge.source) && overview.nodeIds.has(edge.target)), true);
});

test("the combined graph stays behind contact and connection permissions", () => {
  const source = fs.readFileSync(new URL("../app/contact-graph.tsx", import.meta.url), "utf8");
  assert.equal(/const canViewPeople = can\("connections\.view"\) && can\("contacts\.view"\)/.test(source), true);
  assert.equal(/canViewPeople && <button[^>]+graphMode === "all"/.test(source), true);
  assert.equal(/graphMode === "all" && canViewPeople\) return <AllConnectionsGraph/.test(source), true);
});

test("the shared People/All layout is deterministic and bounded", () => {
  const nodes = ["person:a", "person:b", "organization:one", "tag:two"];
  const edges = [["person:a", "person:b"], ["person:a", "organization:one"], ["person:b", "tag:two"]];
  const first = graphForceLayout(nodes, edges, null, new Map());
  const second = graphForceLayout(nodes, edges, null, new Map());
  assert.deepEqual([...first], [...second]);
  assert.equal([...first.values()].every((point) => point.x >= 0 && point.x <= GRAPH_WIDTH && point.y >= 0 && point.y <= GRAPH_HEIGHT), true);
});
