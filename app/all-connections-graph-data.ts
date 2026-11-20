export type AllGraphContact = {
  id: string;
  name: string;
  organization?: string;
  role?: string;
  labels?: string[];
};

export type AllGraphLink = {
  contact_a: string;
  contact_b: string;
  note?: string;
};

export type AllGraphNodeKind = "person" | "organization" | "tag";
export type AllGraphEdgeKind = "people" | "organization" | "tag";

export type AllGraphNode = {
  id: string;
  kind: AllGraphNodeKind;
  label: string;
  description: string;
  count: number;
  contactId?: string;
};

export type AllGraphEdge = {
  id: string;
  source: string;
  target: string;
  kind: AllGraphEdgeKind;
  note?: string;
};

export type AllConnectionsModel = {
  nodes: AllGraphNode[];
  edges: AllGraphEdge[];
};

export type AllConnectionsSubgraph = AllConnectionsModel & {
  nodeIds: Set<string>;
  depth: Map<string, number>;
  totalNodes: number;
};

export const personNodeId = (contactId: string) => `person:${contactId}`;
export const organizationNodeId = (organization: string) => `organization:${organization.trim()}`;
export const tagNodeId = (tag: string) => `tag:${tag.trim()}`;

const edgeId = (kind: AllGraphEdgeKind, source: string, target: string) => `${kind}:${source}\n${target}`;

/** Build a read-only relationship index from contacts the caller is already authorized to view. */
export function buildAllConnections(contacts: AllGraphContact[], links: AllGraphLink[]): AllConnectionsModel {
  const validContacts = contacts.filter((contact) => Boolean(contact.id && contact.name));
  const contactsById = new Map(validContacts.map((contact) => [contact.id, contact]));
  const nodes = new Map<string, AllGraphNode>();
  const edges = new Map<string, AllGraphEdge>();

  for (const contact of validContacts) {
    const personId = personNodeId(contact.id);
    nodes.set(personId, {
      id: personId,
      kind: "person",
      label: contact.name,
      description: [contact.role?.trim(), contact.organization?.trim()].filter(Boolean).join(" · ") || "Person",
      count: 0,
      contactId: contact.id,
    });

    const organization = contact.organization?.trim();
    if (organization) {
      const organizationId = organizationNodeId(organization);
      if (!nodes.has(organizationId)) nodes.set(organizationId, { id: organizationId, kind: "organization", label: organization, description: "Organisation", count: 0 });
      const id = edgeId("organization", personId, organizationId);
      edges.set(id, { id, source: personId, target: organizationId, kind: "organization" });
    }

    for (const tag of new Set((contact.labels ?? []).map((value) => value.trim()).filter(Boolean))) {
      const tagId = tagNodeId(tag);
      if (!nodes.has(tagId)) nodes.set(tagId, { id: tagId, kind: "tag", label: tag, description: "Tag", count: 0 });
      const id = edgeId("tag", personId, tagId);
      edges.set(id, { id, source: personId, target: tagId, kind: "tag" });
    }
  }

  const seenPairs = new Set<string>();
  for (const link of links) {
    if (link.contact_a === link.contact_b || !contactsById.has(link.contact_a) || !contactsById.has(link.contact_b)) continue;
    const [left, right] = link.contact_a < link.contact_b ? [link.contact_a, link.contact_b] : [link.contact_b, link.contact_a];
    const pair = `${left}\n${right}`;
    if (seenPairs.has(pair)) continue;
    seenPairs.add(pair);
    const source = personNodeId(left);
    const target = personNodeId(right);
    const id = edgeId("people", source, target);
    edges.set(id, { id, source, target, kind: "people", note: link.note?.trim() || undefined });
  }

  const counts = new Map<string, number>();
  for (const edge of edges.values()) {
    counts.set(edge.source, (counts.get(edge.source) ?? 0) + 1);
    counts.set(edge.target, (counts.get(edge.target) ?? 0) + 1);
  }
  for (const node of nodes.values()) node.count = counts.get(node.id) ?? 0;

  return {
    nodes: [...nodes.values()].sort((a, b) => a.kind.localeCompare(b.kind) || a.label.localeCompare(b.label)),
    edges: [...edges.values()].sort((a, b) => a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id)),
  };
}

const nodeOrder = (left: AllGraphNode, right: AllGraphNode) => right.count - left.count || left.label.localeCompare(right.label) || left.id.localeCompare(right.id);

function overviewNodeIds(model: AllConnectionsModel, nodeLimit: number): Set<string> {
  if (model.nodes.length <= nodeLimit) return new Set(model.nodes.map((node) => node.id));
  const people = model.nodes.filter((node) => node.kind === "person");
  const organizations = model.nodes.filter((node) => node.kind === "organization").sort(nodeOrder);
  const tags = model.nodes.filter((node) => node.kind === "tag").sort(nodeOrder);
  const entityBudget = Math.min(organizations.length + tags.length, Math.max(0, Math.floor(nodeLimit * 0.4)));
  let organizationBudget = 0;
  let tagBudget = 0;
  if (organizations.length && tags.length && entityBudget >= 2) {
    organizationBudget = Math.max(1, Math.min(entityBudget - 1, Math.round(entityBudget * organizations.length / (organizations.length + tags.length))));
    tagBudget = entityBudget - organizationBudget;
  } else if (organizations.length) organizationBudget = entityBudget;
  else tagBudget = entityBudget;

  const selectedEntities = [...organizations.slice(0, organizationBudget), ...tags.slice(0, tagBudget)];
  const selectedEntityIds = new Set(selectedEntities.map((node) => node.id));
  const explicitDegree = new Map<string, number>();
  const selectedMemberships = new Map<string, number>();
  for (const edge of model.edges) {
    if (edge.kind === "people") {
      explicitDegree.set(edge.source, (explicitDegree.get(edge.source) ?? 0) + 1);
      explicitDegree.set(edge.target, (explicitDegree.get(edge.target) ?? 0) + 1);
    } else if (selectedEntityIds.has(edge.target)) {
      selectedMemberships.set(edge.source, (selectedMemberships.get(edge.source) ?? 0) + 1);
    }
  }
  const selected = new Set(selectedEntities.map((node) => node.id));
  const peopleBudget = Math.max(0, nodeLimit - selected.size);
  const explicitPeople = people.filter((person) => (explicitDegree.get(person.id) ?? 0) > 0)
    .sort((a, b) => (explicitDegree.get(b.id) ?? 0) - (explicitDegree.get(a.id) ?? 0) || nodeOrder(a, b));
  const membershipPeople = [...people].sort((a, b) => (selectedMemberships.get(b.id) ?? 0) - (selectedMemberships.get(a.id) ?? 0)
    || (explicitDegree.get(b.id) ?? 0) - (explicitDegree.get(a.id) ?? 0)
    || nodeOrder(a, b));
  const explicitBudget = Math.min(explicitPeople.length, membershipPeople.some((person) => (selectedMemberships.get(person.id) ?? 0) > 0) ? Math.max(1, Math.floor(peopleBudget * 0.55)) : peopleBudget);
  for (const person of explicitPeople.slice(0, explicitBudget)) selected.add(person.id);
  for (const person of membershipPeople) {
    if (selected.size >= selectedEntities.length + peopleBudget) break;
    selected.add(person.id);
  }
  if (selected.size < nodeLimit) {
    for (const node of [...organizations.slice(organizationBudget), ...tags.slice(tagBudget)].sort(nodeOrder)) {
      selected.add(node.id);
      if (selected.size >= nodeLimit) break;
    }
  }
  return selected;
}

/** Select a bounded overview or a bounded breadth-first neighborhood around one node. */
export function selectConnectionSubgraph(model: AllConnectionsModel, options: { focusId: string | null; depth: 1 | 2; nodeLimit: number }): AllConnectionsSubgraph {
  const nodeLimit = Math.max(3, Math.floor(options.nodeLimit));
  const nodesById = new Map(model.nodes.map((node) => [node.id, node]));
  const adjacency = new Map<string, Set<string>>();
  for (const edge of model.edges) {
    if (!adjacency.has(edge.source)) adjacency.set(edge.source, new Set());
    if (!adjacency.has(edge.target)) adjacency.set(edge.target, new Set());
    adjacency.get(edge.source)!.add(edge.target);
    adjacency.get(edge.target)!.add(edge.source);
  }

  const depth = new Map<string, number>();
  let nodeIds: Set<string>;
  if (options.focusId && nodesById.has(options.focusId)) {
    depth.set(options.focusId, 0);
    const queue = [options.focusId];
    while (queue.length && depth.size < nodeLimit) {
      const current = queue.shift()!;
      const level = depth.get(current)!;
      if (level >= options.depth) continue;
      const neighbours = [...(adjacency.get(current) ?? [])]
        .map((id) => nodesById.get(id))
        .filter((node): node is AllGraphNode => Boolean(node))
        .sort(nodeOrder);
      for (const neighbour of neighbours) {
        if (depth.has(neighbour.id)) continue;
        depth.set(neighbour.id, level + 1);
        queue.push(neighbour.id);
        if (depth.size >= nodeLimit) break;
      }
    }
    nodeIds = new Set(depth.keys());
  } else {
    nodeIds = overviewNodeIds(model, nodeLimit);
    for (const id of nodeIds) depth.set(id, 0);
  }

  return {
    nodes: model.nodes.filter((node) => nodeIds.has(node.id)),
    edges: model.edges.filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target)),
    nodeIds,
    depth,
    totalNodes: model.nodes.length,
  };
}
