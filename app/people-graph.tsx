"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { ExternalLink, Link2, RotateCcw, Search, UsersRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { fetchLinks, LINKS_EVENT, type ContactLink } from "./contact-connections";
import { GraphZoomControls, useGraphZoom } from "./graph-zoom";
import { normalizeSearch, searchRank } from "./search";

type PeopleContact = { id: string; name: string; organization?: string; role?: string; labels?: string[] };
type Point = { x: number; y: number };

const WIDTH = 1100;
const HEIGHT = 720;
const CENTER = { x: WIDTH / 2, y: HEIGHT / 2 };
const NODE_LIMIT = 180;
const NAME_LIMIT = 50;
const MARGIN = 40;

const hash = (value: string) => {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return result >>> 0;
};
const initials = (name: string) => name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();

/**
 * Deterministic force layout (Fruchterman–Reingold with gravity). Starting points come
 * from a hash of each contact ID, so the same data always draws the same picture.
 * At most NODE_LIMIT nodes, so the O(n²) repulsion stays fast enough for one render.
 */
function forceLayout(nodes: string[], edges: Array<[string, string]>, focus: string | null, depth: Map<string, number>): Map<string, Point> {
  const positions = new Map<string, Point>();
  nodes.forEach((id, index) => {
    const random = hash(id);
    if (id === focus) { positions.set(id, { ...CENTER }); return; }
    const ring = focus ? depth.get(id) ?? 2 : 0;
    const angle = focus ? (index / Math.max(1, nodes.length)) * Math.PI * 2 + (random % 100) / 400 : ((random % 3600) / 3600) * Math.PI * 2;
    const radius = focus ? 110 * ring + (random % 30) : 40 + ((random >>> 12) % 240);
    positions.set(id, { x: CENTER.x + Math.cos(angle) * radius, y: CENTER.y + Math.sin(angle) * radius });
  });
  if (nodes.length < 2) return positions;
  // Ideal edge length; capped so a small network stays compact in the middle.
  const k = Math.min(110, Math.sqrt(((WIDTH - 2 * MARGIN) * (HEIGHT - 2 * MARGIN)) / nodes.length) * 0.75);
  const steps = 220;
  for (let step = 0; step < steps; step += 1) {
    const temperature = 45 * (1 - step / steps) + 1;
    const shift = new Map(nodes.map((id) => [id, { x: 0, y: 0 }]));
    for (let left = 0; left < nodes.length; left += 1) {
      const a = positions.get(nodes[left])!;
      for (let right = left + 1; right < nodes.length; right += 1) {
        const b = positions.get(nodes[right])!;
        let dx = a.x - b.x;
        let dy = a.y - b.y;
        let distance = Math.hypot(dx, dy);
        if (distance < 0.01) { dx = 0.01 * ((left % 3) - 1 || 1); dy = 0.01; distance = 0.015; }
        const force = (k * k) / distance;
        const fx = (dx / distance) * force;
        const fy = (dy / distance) * force;
        const sa = shift.get(nodes[left])!;
        const sb = shift.get(nodes[right])!;
        sa.x += fx; sa.y += fy; sb.x -= fx; sb.y -= fy;
      }
    }
    for (const [source, target] of edges) {
      const a = positions.get(source)!;
      const b = positions.get(target)!;
      const dx = a.x - b.x;
      const dy = a.y - b.y;
      const distance = Math.max(0.01, Math.hypot(dx, dy));
      const force = (distance * distance) / k;
      const sa = shift.get(source)!;
      const sb = shift.get(target)!;
      sa.x -= (dx / distance) * force; sa.y -= (dy / distance) * force;
      sb.x += (dx / distance) * force; sb.y += (dy / distance) * force;
    }
    for (const id of nodes) {
      if (id === focus) continue;
      const point = positions.get(id)!;
      const move = shift.get(id)!;
      move.x += (CENTER.x - point.x) * 0.04 * k / 60;
      move.y += (CENTER.y - point.y) * 0.04 * k / 60;
      const length = Math.max(0.01, Math.hypot(move.x, move.y));
      const limited = Math.min(length, temperature);
      point.x = Math.min(WIDTH - MARGIN, Math.max(MARGIN, point.x + (move.x / length) * limited));
      point.y = Math.min(HEIGHT - MARGIN, Math.max(MARGIN, point.y + (move.y / length) * limited));
    }
  }
  return positions;
}

export function PeopleGraph({ contacts, onSelectContact, modeSwitch }: { contacts: PeopleContact[]; onSelectContact: (id: string) => void; modeSwitch: ReactNode }) {
  const [links, setLinks] = useState<ContactLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [focusId, setFocusId] = useState<string | null>(null);
  const [depthLimit, setDepthLimit] = useState<1 | 2>(1);
  const [query, setQuery] = useState("");
  const [selectedLabel, setSelectedLabel] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const { zoom, setZoom, zoomIn, zoomOut, canvasRef } = useGraphZoom();

  const [version, setVersion] = useState(0);
  useEffect(() => {
    let active = true;
    fetchLinks().then((rows) => { if (active) { setLinks(rows); setError(""); } })
      .catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : "Connections could not be loaded"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [version]);
  useEffect(() => {
    const refresh = () => setVersion((value) => value + 1);
    window.addEventListener(LINKS_EVENT, refresh);
    return () => window.removeEventListener(LINKS_EVENT, refresh);
  }, []);

  const byId = useMemo(() => new Map(contacts.map((contact) => [contact.id, contact])), [contacts]);
  // Links whose people are both still present (a deleted contact's links are removed with it).
  const { neighbours, notes, validLinks } = useMemo(() => {
    const neighbours = new Map<string, Set<string>>();
    const notes = new Map<string, string>();
    let validLinks = 0;
    for (const link of links) {
      if (!byId.has(link.contact_a) || !byId.has(link.contact_b)) continue;
      validLinks += 1;
      for (const [from, to] of [[link.contact_a, link.contact_b], [link.contact_b, link.contact_a]]) {
        if (!neighbours.has(from)) neighbours.set(from, new Set());
        neighbours.get(from)!.add(to);
      }
      notes.set(`${link.contact_a}\n${link.contact_b}`, link.note);
    }
    return { neighbours, notes, validLinks };
  }, [links, byId]);
  const noteFor = (a: string, b: string) => notes.get(a < b ? `${a}\n${b}` : `${b}\n${a}`) ?? "";
  const connectedPeople = neighbours.size;

  const labelOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const id of neighbours.keys()) for (const label of new Set(byId.get(id)?.labels ?? [])) if (label.trim()) counts.set(label, (counts.get(label) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [neighbours, byId]);
  const hasLabel = useCallback((id: string) => Boolean(selectedLabel && (byId.get(id)?.labels ?? []).includes(selectedLabel)), [byId, selectedLabel]);

  const graph = useMemo(() => {
    const depth = new Map<string, number>();
    let nodes: string[];
    let total: number;
    if (focusId) {
      // Breadth-first from the focused person, nearest people first.
      depth.set(focusId, 0);
      const queue = [focusId];
      while (queue.length) {
        const current = queue.shift()!;
        const level = depth.get(current)!;
        if (level >= depthLimit) continue;
        for (const next of [...(neighbours.get(current) ?? [])].sort()) if (!depth.has(next)) { depth.set(next, level + 1); queue.push(next); }
      }
      total = depth.size;
      nodes = [...depth.keys()].slice(0, NODE_LIMIT);
    } else {
      // Whole network, or the people with the chosen tag plus their direct connections.
      let ids = [...neighbours.keys()];
      if (selectedLabel) {
        const tagged = ids.filter(hasLabel);
        ids = [...new Set([...tagged, ...tagged.flatMap((id) => [...(neighbours.get(id) ?? [])])])];
      }
      ids.sort((a, b) => (Number(hasLabel(b)) - Number(hasLabel(a))) || (neighbours.get(b)?.size ?? 0) - (neighbours.get(a)?.size ?? 0) || a.localeCompare(b));
      total = ids.length;
      nodes = ids.slice(0, NODE_LIMIT);
    }
    const visible = new Set(nodes);
    const edges: Array<[string, string]> = [];
    for (const id of nodes) for (const other of neighbours.get(id) ?? []) if (id < other && visible.has(other)) edges.push([id, other]);
    return { nodes, edges, total, depth, positions: forceLayout(nodes, edges, focusId, depth) };
  }, [focusId, depthLimit, neighbours, selectedLabel, hasLabel]);

  const matches = useMemo(() => {
    const needle = normalizeSearch(query.trim());
    if (!needle) return [];
    return contacts.filter((contact) => normalizeSearch(`${contact.name} ${contact.organization ?? ""}`).includes(needle))
      .sort((a, b) => searchRank(a.name, query) - searchRank(b.name, query) || (neighbours.get(b.id)?.size ?? 0) - (neighbours.get(a.id)?.size ?? 0)).slice(0, 8);
  }, [contacts, query, neighbours]);

  const focus = focusId ? byId.get(focusId) : undefined;
  const focusNeighbours = focusId ? [...(neighbours.get(focusId) ?? [])].map((id) => byId.get(id)!).filter(Boolean).sort((a, b) => a.name.localeCompare(b.name)) : [];
  const choose = (id: string) => { setFocusId(id); setQuery(""); };
  const showNames = graph.nodes.length <= NAME_LIMIT;
  const hoveredContact = hovered ? byId.get(hovered) : undefined;

  return <div className="graph-module">
    <div className="graph-toolbar">
      <div>
        <p className="eyebrow">Relationship map</p>
        <h1 className="module-title">Contact graph</h1>
        <p className="module-subtitle">People are linked when you connect them on their contact page. Select a person to see who they know.</p>
      </div>
      <div className="flex w-full flex-col gap-2 sm:w-auto sm:min-w-72">
        {modeSwitch}
        <label className="graph-tag-filter"><span>Filter by tag</span><NativeSelect className="w-full bg-white" value={selectedLabel ?? ""} onChange={(event) => setSelectedLabel(event.target.value || null)} aria-label="Filter people graph by tag"><NativeSelectOption value="">All tags</NativeSelectOption>{labelOptions.map(([label, count]) => <NativeSelectOption key={label} value={label}>{label} ({count})</NativeSelectOption>)}</NativeSelect></label>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#7b909b]" />
          <Input className="h-10 bg-white pl-9" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find a person" aria-label="Find a person in the graph" />
          {matches.length > 0 && <div className="people-search-results" role="listbox" aria-label="Matching people">{matches.map((contact) => <button key={contact.id} type="button" role="option" aria-selected={false} onClick={() => choose(contact.id)}>
            <strong>{contact.name}</strong><small>{[contact.organization, `${neighbours.get(contact.id)?.size ?? 0} connections`].filter(Boolean).join(" · ")}</small>
          </button>)}</div>}
        </div>
        {focusId && <div className="people-depth" role="radiogroup" aria-label="How far to show connections">
          <button role="radio" aria-checked={depthLimit === 1} className={depthLimit === 1 ? "active" : ""} onClick={() => setDepthLimit(1)}>Direct connections</button>
          <button role="radio" aria-checked={depthLimit === 2} className={depthLimit === 2 ? "active" : ""} onClick={() => setDepthLimit(2)}>Up to 2 steps</button>
        </div>}
        {focusId && <Button variant="outline" size="sm" className="justify-start bg-white" onClick={() => setFocusId(null)}><RotateCcw />Show whole network</Button>}
      </div>
    </div>

    <div className="graph-summary">
      <div className="graph-summary-items">
        <span><UsersRound className="size-4" />{graph.nodes.length} of {graph.total} people shown</span>
        <span><Link2 className="size-4" />{validLinks} connections in total</span>
        <span>{Math.max(0, contacts.length - connectedPeople)} {contacts.length - connectedPeople === 1 ? "person" : "people"} without connections</span>
        {selectedLabel && <span className="graph-focus">Tag: {selectedLabel}</span>}
        {focus && <span className="graph-focus">Focused on {focus.name}</span>}
      </div>
      <GraphZoomControls zoom={zoom} setZoom={setZoom} zoomIn={zoomIn} zoomOut={zoomOut} />
    </div>

    <div className={`graph-focus-layout ${focus ? "focused" : ""}`}>
      <div className="graph-visual">
        <div ref={canvasRef} className="graph-canvas" aria-label="People connection graph">
          {loading ? <div className="graph-empty"><UsersRound className="size-8" /><strong>Loading connections…</strong></div>
            : error ? <div className="graph-empty"><UsersRound className="size-8" /><strong>Connections could not be loaded</strong><span>{error}</span></div>
            : !graph.nodes.length ? <div className="graph-empty"><Link2 className="size-8" /><strong>{validLinks ? "No connected people match" : "No connections yet"}</strong><span>{validLinks ? "Choose another tag or show the whole network." : "Open a contact and use Connections to link people."}</span></div>
            : <svg style={{ width: `${zoom * 100}%`, minWidth: `${760 * zoom}px` }} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label="People and the connections between them">
              <g className="people-edges">
                {graph.edges.map(([a, b]) => {
                  const source = graph.positions.get(a)!;
                  const target = graph.positions.get(b)!;
                  const active = hovered === a || hovered === b || (focusId !== null && (a === focusId || b === focusId));
                  const note = noteFor(a, b);
                  return <line key={`${a}-${b}`} className={active ? "active" : ""} x1={source.x} y1={source.y} x2={target.x} y2={target.y}><title>{byId.get(a)?.name} – {byId.get(b)?.name}{note ? `: ${note}` : ""}</title></line>;
                })}
              </g>
              <g className="people-nodes">
                {graph.nodes.map((id) => {
                  const person = byId.get(id)!;
                  const point = graph.positions.get(id)!;
                  const degree = neighbours.get(id)?.size ?? 0;
                  const isFocus = id === focusId;
                  const dimmed = Boolean(selectedLabel) && !hasLabel(id);
                  const named = isFocus || hovered === id || showNames || (focusId !== null && graph.depth.get(id) === 1 && graph.nodes.length <= NODE_LIMIT / 2);
                  const radius = isFocus ? 14 : Math.min(12, 5 + Math.log2(degree + 1) * 1.8);
                  const onLeft = point.x < CENTER.x;
                  const label = person.name.length > 26 ? `${person.name.slice(0, 25)}…` : person.name;
                  return <g key={id} className={`${isFocus ? "focus" : ""} ${hovered === id ? "active" : ""} ${dimmed ? "dimmed" : ""} ${hasLabel(id) ? "tagged" : ""}`} role="button" tabIndex={0}
                    aria-label={`${person.name}, ${degree} connections. Select to focus.`}
                    onMouseEnter={() => setHovered(id)} onMouseLeave={() => setHovered(null)} onFocus={() => setHovered(id)} onBlur={() => setHovered(null)}
                    onClick={() => setFocusId(id)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setFocusId(id); } }}>
                    <circle cx={point.x} cy={point.y} r={radius + 9} className="graph-node-hit" style={{ fill: "transparent", stroke: "none" }} />
                    <circle cx={point.x} cy={point.y} r={radius} />
                    {named && <text x={point.x + (onLeft ? -(radius + 4) : radius + 4)} y={point.y + 3} textAnchor={onLeft ? "end" : "start"}>{label}</text>}
                    <title>{person.name}: {degree} connections</title>
                  </g>;
                })}
              </g>
            </svg>}
          {hoveredContact && <button className="graph-contact-popover" onClick={() => onSelectContact(hoveredContact.id)}>
            <span className="graph-contact-avatar">{initials(hoveredContact.name)}</span>
            <span><strong>{hoveredContact.name}</strong><small>{[hoveredContact.role, hoveredContact.organization].filter(Boolean).join(" · ") || "Open contact"}</small></span>
          </button>}
        </div>
        <div className="graph-note">{focus
          ? `Showing ${focus.name} and ${depthLimit === 1 ? "their direct connections" : "people up to two steps away"}${graph.total > graph.nodes.length ? ` (first ${graph.nodes.length} of ${graph.total})` : ""}. Select anyone to move the focus to them.`
          : `Showing ${selectedLabel ? `people tagged ${selectedLabel} and their direct connections` : "everyone with at least one connection"}${graph.total > NODE_LIMIT ? `, the ${NODE_LIMIT} most connected first` : ""}. Larger dots have more connections. Hover over a line to read its note.`}</div>
      </div>
      {focus && <aside className="graph-people-list" aria-label={`Connections of ${focus.name}`}>
        <div className="graph-people-header"><div><span>Connections of</span><strong>{focus.name}</strong></div><small>{focusNeighbours.length} total</small></div>
        <div className="people-focus-actions"><Button size="sm" variant="outline" className="w-full bg-white" onClick={() => onSelectContact(focus.id)}><ExternalLink />Open contact</Button></div>
        <div className="graph-people-scroll">{focusNeighbours.length ? focusNeighbours.map((contact) => <button key={contact.id} onClick={() => setFocusId(contact.id)} onMouseEnter={() => setHovered(contact.id)} onMouseLeave={() => setHovered(null)}>
          <span className="graph-list-avatar">{initials(contact.name)}</span>
          <span className="graph-list-copy"><strong>{contact.name}</strong><small>{noteFor(focus.id, contact.id) || [contact.role, contact.organization].filter(Boolean).join(" · ") || "No details"}</small></span>
        </button>) : <p className="graph-list-limit">No connections yet. Open the contact to connect people.</p>}</div>
      </aside>}
    </div>
  </div>;
}
