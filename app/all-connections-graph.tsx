"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Building2, ExternalLink, Link2, Network, RotateCcw, Search, Tag, UserRound, UsersRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  buildAllConnections,
  selectConnectionSubgraph,
  type AllGraphContact,
  type AllGraphEdge,
  type AllGraphNode,
} from "./all-connections-graph-data";
import { fetchLinks, LINKS_EVENT, type ContactLink } from "./contact-connections";
import { GRAPH_HEIGHT as HEIGHT, GRAPH_WIDTH as WIDTH, graphForceLayout } from "./graph-force-layout";
import { GraphZoomControls, useGraphZoom } from "./graph-zoom";
import { normalizeSearch, searchRank } from "./search";

const NODE_LIMIT = 180;
const NAME_LIMIT = 55;

const kindLabel = (node: AllGraphNode) => node.kind === "person" ? "Person" : node.kind === "organization" ? "Organisation" : "Tag";
const edgeLabel = (edge: AllGraphEdge) => edge.kind === "people" ? "People connection" : edge.kind === "organization" ? "Organisation membership" : "Tag membership";
const initials = (name: string) => name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();

export function AllConnectionsGraph({ contacts, onSelectContact, modeSwitch }: {
  contacts: AllGraphContact[];
  onSelectContact: (id: string) => void;
  modeSwitch: ReactNode;
}) {
  const [links, setLinks] = useState<ContactLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [focusId, setFocusId] = useState<string | null>(null);
  const [depthLimit, setDepthLimit] = useState<1 | 2>(1);
  const [query, setQuery] = useState("");
  const [hovered, setHovered] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const { zoom, setZoom, zoomIn, zoomOut, canvasRef } = useGraphZoom();

  useEffect(() => {
    let active = true;
    fetchLinks().then((rows) => { if (active) { setLinks(rows); setError(""); } })
      .catch(() => { if (active) setError("Connections could not be loaded"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [version]);
  useEffect(() => {
    const refresh = () => { setLoading(true); setVersion((value) => value + 1); };
    window.addEventListener(LINKS_EVENT, refresh);
    return () => window.removeEventListener(LINKS_EVENT, refresh);
  }, []);

  const model = useMemo(() => buildAllConnections(contacts, links), [contacts, links]);
  const nodesById = useMemo(() => new Map(model.nodes.map((node) => [node.id, node])), [model.nodes]);
  const activeFocusId = focusId && nodesById.has(focusId) ? focusId : null;
  const graph = useMemo(() => selectConnectionSubgraph(model, { focusId: activeFocusId, depth: depthLimit, nodeLimit: NODE_LIMIT }), [model, activeFocusId, depthLimit]);
  const positions = useMemo(() => graphForceLayout(graph.nodes.map((node) => node.id), graph.edges.map((edge) => [edge.source, edge.target]), activeFocusId, graph.depth), [graph, activeFocusId]);

  const totals = useMemo(() => ({
    people: model.nodes.filter((node) => node.kind === "person").length,
    organizations: model.nodes.filter((node) => node.kind === "organization").length,
    tags: model.nodes.filter((node) => node.kind === "tag").length,
    explicit: model.edges.filter((edge) => edge.kind === "people").length,
  }), [model]);
  const visibleTotals = useMemo(() => ({
    people: graph.nodes.filter((node) => node.kind === "person").length,
    organizations: graph.nodes.filter((node) => node.kind === "organization").length,
    tags: graph.nodes.filter((node) => node.kind === "tag").length,
  }), [graph.nodes]);

  const matches = useMemo(() => {
    const needle = normalizeSearch(query.trim());
    if (!needle) return [];
    return model.nodes.filter((node) => normalizeSearch(`${node.label} ${node.description} ${kindLabel(node)}`).includes(needle))
      .sort((a, b) => searchRank(a.label, query) - searchRank(b.label, query) || b.count - a.count || a.label.localeCompare(b.label))
      .slice(0, 10);
  }, [model.nodes, query]);

  const focus = activeFocusId ? nodesById.get(activeFocusId) : undefined;
  const focusConnections = useMemo(() => {
    if (!activeFocusId) return [];
    return model.edges.filter((edge) => edge.source === activeFocusId || edge.target === activeFocusId).map((edge) => ({
      edge,
      node: nodesById.get(edge.source === activeFocusId ? edge.target : edge.source),
    })).filter((item): item is { edge: AllGraphEdge; node: AllGraphNode } => Boolean(item.node))
      .sort((a, b) => a.node.kind.localeCompare(b.node.kind) || a.node.label.localeCompare(b.node.label));
  }, [activeFocusId, model.edges, nodesById]);
  const hoveredNode = hovered ? nodesById.get(hovered) : undefined;
  const showPersonNames = graph.nodes.length <= NAME_LIMIT;
  const choose = (id: string) => { setFocusId(id); setQuery(""); };

  return <div className="graph-module all-connections-graph">
    <div className="graph-toolbar">
      <div>
        <p className="eyebrow">Complete relationship map</p>
        <h1 className="module-title">All connections</h1>
        <p className="module-subtitle">People connect directly to each other and link organisations and tags through their memberships.</p>
      </div>
      <div className="flex w-full flex-col gap-2 sm:w-auto sm:min-w-72">
        {modeSwitch}
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#7b909b]" />
          <Input className="h-10 bg-white pl-9" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find a person, organisation or tag" aria-label="Find any node in the graph" />
          {matches.length > 0 && <div className="people-search-results" role="listbox" aria-label="Matching graph nodes">{matches.map((node) => <button key={node.id} type="button" role="option" aria-selected={false} onClick={() => choose(node.id)}>
            <strong>{node.label}</strong><small>{kindLabel(node)} · {node.count} connections{node.description !== kindLabel(node) ? ` · ${node.description}` : ""}</small>
          </button>)}</div>}
        </div>
        {activeFocusId && <div className="people-depth" role="radiogroup" aria-label="How far to show all connections">
          <button role="radio" aria-checked={depthLimit === 1} className={depthLimit === 1 ? "active" : ""} onClick={() => setDepthLimit(1)}>Direct connections</button>
          <button role="radio" aria-checked={depthLimit === 2} className={depthLimit === 2 ? "active" : ""} onClick={() => setDepthLimit(2)}>Up to 2 steps</button>
        </div>}
        {activeFocusId && <Button variant="outline" size="sm" className="justify-start bg-white" onClick={() => setFocusId(null)}><RotateCcw />Show whole network</Button>}
      </div>
    </div>

    <div className="graph-summary">
      <div className="graph-summary-items">
        <span><UsersRound className="size-4" />{visibleTotals.people} of {totals.people} people</span>
        <span><Building2 className="size-4" />{visibleTotals.organizations} of {totals.organizations} organisations</span>
        <span><Tag className="size-4" />{visibleTotals.tags} of {totals.tags} tags</span>
        <span><Link2 className="size-4" />{totals.explicit} people connections</span>
        {focus && <span className="graph-focus">Focused on {focus.label}</span>}
      </div>
      <GraphZoomControls zoom={zoom} setZoom={setZoom} zoomIn={zoomIn} zoomOut={zoomOut} />
    </div>

    <div className="all-graph-legend" aria-label="Graph legend">
      <span className="person"><i />Person</span><span className="organization"><i />Organisation</span><span className="tag"><i />Tag</span>
      <span className="people-edge"><i />Person ↔ person</span><span className="organization-edge"><i />Person ↔ organisation</span><span className="tag-edge"><i />Person ↔ tag</span>
    </div>

    <div className={`graph-focus-layout ${focus ? "focused" : ""}`}>
      <div className="graph-visual">
        <div ref={canvasRef} className="graph-canvas" aria-label="All people, organisation, tag and relationship connections">
          {loading ? <div className="graph-empty"><Network className="size-8" /><strong>Loading all connections…</strong></div>
            : error ? <div className="graph-empty"><Network className="size-8" /><strong>Connections could not be loaded</strong><span>{error}</span></div>
            : !graph.nodes.length ? <div className="graph-empty"><Network className="size-8" /><strong>No graph data yet</strong><span>Add contacts, organisations, tags, or person-to-person connections.</span></div>
            : <svg style={{ width: `${zoom * 100}%`, minWidth: `${760 * zoom}px` }} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label="Combined relationship graph">
              <g className="all-graph-edges">
                {graph.edges.map((edge) => {
                  const source = positions.get(edge.source)!;
                  const target = positions.get(edge.target)!;
                  const active = hovered === edge.source || hovered === edge.target || activeFocusId === edge.source || activeFocusId === edge.target;
                  return <line key={edge.id} className={`${edge.kind} ${active ? "active" : ""}`} x1={source.x} y1={source.y} x2={target.x} y2={target.y}>
                    <title>{nodesById.get(edge.source)?.label} – {nodesById.get(edge.target)?.label}: {edge.note || edgeLabel(edge)}</title>
                  </line>;
                })}
              </g>
              <g className="all-graph-nodes">
                {graph.nodes.map((node) => {
                  const point = positions.get(node.id)!;
                  const active = hovered === node.id;
                  const selected = activeFocusId === node.id;
                  const label = node.label.length > 24 ? `${node.label.slice(0, 23)}…` : node.label;
                  const personRadius = selected ? 14 : Math.min(12, 6 + Math.log2(node.count + 1) * 1.5);
                  const entityWidth = Math.min(150, Math.max(node.kind === "tag" ? 64 : 82, 24 + label.length * 6.2));
                  const showName = node.kind !== "person" || showPersonNames || active || selected;
                  return <g key={node.id} className={`${node.kind} ${active ? "active" : ""} ${selected ? "focus" : ""}`} role="button" tabIndex={0}
                    aria-label={`${kindLabel(node)} ${node.label}, ${node.count} connections. Select to focus.`}
                    onMouseEnter={() => setHovered(node.id)} onMouseLeave={() => setHovered(null)} onFocus={() => setHovered(node.id)} onBlur={() => setHovered(null)}
                    onClick={() => setFocusId(node.id)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setFocusId(node.id); } }}>
                    {node.kind === "person" ? <>
                      <circle className="graph-node-hit" cx={point.x} cy={point.y} r={personRadius + 10} />
                      <circle cx={point.x} cy={point.y} r={personRadius} />
                      {showName && <text x={point.x + personRadius + 5} y={point.y + 4}>{label}</text>}
                    </> : <>
                      <rect className="graph-node-hit" x={point.x - entityWidth / 2 - 8} y={point.y - 22} width={entityWidth + 16} height={44} rx="14" />
                      <rect x={point.x - entityWidth / 2} y={point.y - 15} width={entityWidth} height={30} rx={node.kind === "tag" ? 15 : 8} />
                      <text x={point.x} y={point.y + 4} textAnchor="middle">{label}</text>
                    </>}
                    <title>{kindLabel(node)}: {node.label}. {node.count} connections.</title>
                  </g>;
                })}
              </g>
            </svg>}
          {hoveredNode && <div className={`all-graph-hover-card ${hoveredNode.kind}`}>
            <span className="graph-contact-avatar">{hoveredNode.kind === "person" ? initials(hoveredNode.label) : hoveredNode.kind === "organization" ? <Building2 /> : <Tag />}</span>
            <span><strong>{hoveredNode.label}</strong><small>{kindLabel(hoveredNode)} · {hoveredNode.count} connections</small></span>
          </div>}
        </div>
        <div className="graph-note">{focus
          ? `Showing ${focus.label} and ${depthLimit === 1 ? "its direct connections" : "connections up to two steps away"}${graph.totalNodes > graph.nodes.length ? ` (first ${graph.nodes.length} of ${graph.totalNodes})` : ""}. Select another node to move the focus.`
          : `Showing all connection types, capped at ${NODE_LIMIT} visible nodes for phone performance. Use search to open any person, organisation, or tag that is outside the overview.`}</div>
      </div>

      {focus && <aside className="graph-people-list" aria-label={`Connections of ${focus.label}`}>
        <div className="graph-people-header"><div><span>{kindLabel(focus)}</span><strong>{focus.label}</strong></div><small>{focusConnections.length} total</small></div>
        {focus.kind === "person" && focus.contactId && <div className="people-focus-actions"><Button size="sm" variant="outline" className="w-full bg-white" onClick={() => onSelectContact(focus.contactId!)}><ExternalLink />Open contact</Button></div>}
        <div className="graph-people-scroll">{focusConnections.length ? focusConnections.map(({ edge, node }) => <button key={edge.id} onClick={() => setFocusId(node.id)} onMouseEnter={() => setHovered(node.id)} onMouseLeave={() => setHovered(null)}>
          <span className={`all-list-icon ${node.kind}`}>{node.kind === "person" ? <UserRound /> : node.kind === "organization" ? <Building2 /> : <Tag />}</span>
          <span className="graph-list-copy"><strong>{node.label}</strong><small>{edge.note || edgeLabel(edge)}</small></span>
        </button>) : <p className="graph-list-limit">No direct connections.</p>}</div>
      </aside>}
    </div>
  </div>;
}
