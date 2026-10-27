"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Building2, Maximize2, Minus, Network, Plus, RotateCcw, Search, Tag, UsersRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type GraphContact = {
  id: string;
  name: string;
  organization?: string;
  role?: string;
  labels?: string[];
};

type Point = { x: number; y: number };
type TagEdge = { source: string; target: string; shared: number };
type GraphMode = "labels" | "organizations";

const WIDTH = 1100;
const HEIGHT = 720;
const CENTER = { x: WIDTH / 2, y: HEIGHT / 2 };
const TAG_LIMIT = 20;
const CONTACT_LIMIT = 180;
const FOCUSED_CONTACT_LIMIT = 80;
const ALWAYS_LABEL_LIMIT = 36;

const normalize = (value: string) => value.toLocaleLowerCase();
const hash = (value: string) => {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return result >>> 0;
};
const groupsForContact = (contact: GraphContact, mode: GraphMode) => mode === "labels"
  ? (contact.labels ?? [])
  : contact.organization?.trim() ? [contact.organization.trim()] : [];

export function ContactGraph({ contacts, onSelectContact }: {
  contacts: GraphContact[];
  onSelectContact: (contactId: string) => void;
}) {
  const [graphMode, setGraphMode] = useState<GraphMode>("labels");
  const [focusTag, setFocusTag] = useState<string | null>(null);
  const [tagQuery, setTagQuery] = useState("");
  const [hoveredContact, setHoveredContact] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const canvasRef = useRef<HTMLDivElement>(null);
  const zoomRef = useRef(zoom);
  useEffect(() => { zoomRef.current = zoom; }, [zoom]);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let pinch: { distance: number; zoom: number } | null = null;
    const distance = (event: TouchEvent) => Math.hypot(event.touches[0].clientX - event.touches[1].clientX, event.touches[0].clientY - event.touches[1].clientY);
    const start = (event: TouchEvent) => {
      if (event.touches.length === 2) pinch = { distance: distance(event), zoom: zoomRef.current };
    };
    const move = (event: TouchEvent) => {
      if (event.touches.length !== 2) return;
      event.preventDefault();
      if (!pinch) pinch = { distance: distance(event), zoom: zoomRef.current };
      setZoom(Math.max(0.5, Math.min(2, Number((pinch.zoom * distance(event) / Math.max(1, pinch.distance)).toFixed(2)))));
    };
    const end = (event: TouchEvent) => { if (event.touches.length < 2) pinch = null; };
    canvas.addEventListener("touchstart", start, { passive: true });
    canvas.addEventListener("touchmove", move, { passive: false });
    canvas.addEventListener("touchend", end);
    canvas.addEventListener("touchcancel", end);
    return () => {
      canvas.removeEventListener("touchstart", start);
      canvas.removeEventListener("touchmove", move);
      canvas.removeEventListener("touchend", end);
      canvas.removeEventListener("touchcancel", end);
    };
  }, []);
  const zoomOut = () => setZoom((value) => Math.max(0.5, Number((value - 0.25).toFixed(2))));
  const zoomIn = () => setZoom((value) => Math.min(2, Number((value + 0.25).toFixed(2))));

  const graph = useMemo(() => {
    const tagContacts = new Map<string, Set<string>>();
    contacts.forEach((contact) => {
      groupsForContact(contact, graphMode).forEach((tag) => {
        if (!tagContacts.has(tag)) tagContacts.set(tag, new Set());
        tagContacts.get(tag)?.add(contact.id);
      });
    });
    const rankedTags = [...tagContacts.entries()]
      .map(([tag, ids]) => ({ tag, count: ids.size }))
      .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
    const needle = normalize(tagQuery.trim());
    let tags = rankedTags.filter(({ tag }) => !needle || normalize(tag).includes(needle));

    if (focusTag && tagContacts.has(focusTag)) {
      const focusIds = tagContacts.get(focusTag) ?? new Set<string>();
      const related = rankedTags
        .filter(({ tag }) => tag !== focusTag)
        .map(({ tag, count }) => ({
          tag,
          count,
          shared: [...(tagContacts.get(tag) ?? [])].filter((id) => focusIds.has(id)).length,
        }))
        .filter(({ shared, tag }) => shared > 0 && (!needle || normalize(tag).includes(needle)))
        .sort((a, b) => b.shared - a.shared || b.count - a.count)
        .slice(0, TAG_LIMIT - 1);
      tags = [{ tag: focusTag, count: focusIds.size }, ...related];
    } else {
      tags = tags.slice(0, TAG_LIMIT);
    }

    const visibleTagNames = new Set(tags.map(({ tag }) => tag));
    const visibleContacts = contacts
      .filter((contact) => focusTag
        ? groupsForContact(contact, graphMode).includes(focusTag)
        : groupsForContact(contact, graphMode).some((tag) => visibleTagNames.has(tag)))
      .sort((a, b) => {
        const aFocus = focusTag && groupsForContact(a, graphMode).includes(focusTag) ? 1 : 0;
        const bFocus = focusTag && groupsForContact(b, graphMode).includes(focusTag) ? 1 : 0;
        return bFocus - aFocus || a.name.localeCompare(b.name);
      })
      .slice(0, focusTag ? FOCUSED_CONTACT_LIMIT : CONTACT_LIMIT);

    const tagPositions = new Map<string, Point>();
    tags.forEach(({ tag }, index) => {
      if (focusTag && tag === focusTag) {
        tagPositions.set(tag, CENTER);
        return;
      }
      const ringIndex = focusTag ? index - 1 : index;
      const ringCount = Math.max(1, focusTag ? tags.length - 1 : tags.length);
      const angle = -Math.PI / 2 + (ringIndex / ringCount) * Math.PI * 2;
      const radius = focusTag ? 215 : 220;
      tagPositions.set(tag, {
        x: CENTER.x + Math.cos(angle) * radius,
        y: CENTER.y + Math.sin(angle) * radius,
      });
    });

    const contactPositions = new Map<string, Point>();
    visibleContacts.forEach((contact, index) => {
      const linkedTags = groupsForContact(contact, graphMode).filter((tag) => visibleTagNames.has(tag));
      const random = hash(contact.id);
      if (focusTag && linkedTags.includes(focusTag)) {
        const angle = -Math.PI / 2 + (index / Math.max(1, visibleContacts.length)) * Math.PI * 2;
        const radius = 320 + (random % 64);
        contactPositions.set(contact.id, {
          x: CENTER.x + Math.cos(angle) * radius,
          y: CENTER.y + Math.sin(angle) * radius,
        });
        return;
      }
      const anchor = tagPositions.get(linkedTags[0]) ?? CENTER;
      const baseAngle = Math.atan2(anchor.y - CENTER.y, anchor.x - CENTER.x);
      const jitter = (((random % 1000) / 1000) - 0.5) * 0.42;
      const radius = 325 + (random % 74) + (index % 3) * 8;
      contactPositions.set(contact.id, {
        x: CENTER.x + Math.cos(baseAngle + jitter) * radius,
        y: CENTER.y + Math.sin(baseAngle + jitter) * radius,
      });
    });

    const tagEdges: TagEdge[] = [];
    for (let left = 0; left < tags.length; left += 1) {
      for (let right = left + 1; right < tags.length; right += 1) {
        const leftIds = tagContacts.get(tags[left].tag) ?? new Set<string>();
        const rightIds = tagContacts.get(tags[right].tag) ?? new Set<string>();
        const smaller = leftIds.size < rightIds.size ? leftIds : rightIds;
        const larger = smaller === leftIds ? rightIds : leftIds;
        const shared = [...smaller].filter((id) => larger.has(id)).length;
        if (shared > 0) tagEdges.push({ source: tags[left].tag, target: tags[right].tag, shared });
      }
    }
    tagEdges.sort((a, b) => b.shared - a.shared);

    const focusCount = focusTag ? tagContacts.get(focusTag)?.size ?? 0 : 0;
    return { tags, visibleTagNames, visibleContacts, tagPositions, contactPositions, tagEdges: tagEdges.slice(0, 90), rankedTags, focusCount };
  }, [contacts, focusTag, graphMode, tagQuery]);

  const hovered = graph.visibleContacts.find((contact) => contact.id === hoveredContact);

  return <div className="graph-module">
    <div className="graph-toolbar">
      <div>
        <p className="eyebrow">Relationship map</p>
        <h1 className="module-title">Contact graph</h1>
        <p className="module-subtitle">{graphMode === "labels" ? "Tags connect when they share people." : "Organizations form clusters around their people."} Contacts form the outer layer.</p>
      </div>
      <div className="flex w-full flex-col gap-2 sm:w-auto sm:min-w-72">
        <div className="graph-mode-switch" role="radiogroup" aria-label="Group graph nodes by">
          <button role="radio" aria-checked={graphMode === "labels"} className={graphMode === "labels" ? "active" : ""} onClick={() => { setGraphMode("labels"); setFocusTag(null); setTagQuery(""); }}><Tag />Tags</button>
          <button role="radio" aria-checked={graphMode === "organizations"} className={graphMode === "organizations" ? "active" : ""} onClick={() => { setGraphMode("organizations"); setFocusTag(null); setTagQuery(""); }}><Building2 />Organizations</button>
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#7b909b]" />
          <Input className="h-10 bg-white pl-9" value={tagQuery} onChange={(event) => setTagQuery(event.target.value)} placeholder={graphMode === "labels" ? "Find a tag" : "Find an organization"} aria-label={graphMode === "labels" ? "Find a graph tag" : "Find a graph organization"} />
        </div>
        {focusTag && <Button variant="outline" size="sm" className="justify-start bg-white" onClick={() => setFocusTag(null)}><RotateCcw />Show full graph</Button>}
      </div>
    </div>

    <div className="graph-summary">
      <div className="graph-summary-items"><span><Network className="size-4" />{graph.tags.length} {graphMode === "labels" ? "tag" : "organization"} nodes</span><span><UsersRound className="size-4" />{graph.visibleContacts.length} contact nodes shown</span><span>{graph.tagEdges.length} {graphMode === "labels" ? "tag" : "organization"} connections</span>{focusTag && <span className="graph-focus">Focused on {focusTag}</span>}</div>
      <div className="zoom-controls" aria-label="Graph zoom controls"><Button size="icon" variant="outline" onClick={zoomOut} disabled={zoom <= 0.5} aria-label="Zoom graph out"><Minus /></Button><button className="zoom-level" onClick={() => setZoom(1)} aria-label="Reset graph zoom to 100 percent">{Math.round(zoom * 100)}%</button><Button size="icon" variant="outline" onClick={zoomIn} disabled={zoom >= 2} aria-label="Zoom graph in"><Plus /></Button><Button size="icon" variant="outline" onClick={() => setZoom(1)} disabled={zoom === 1} aria-label="Reset graph zoom"><Maximize2 /></Button></div>
    </div>

    <div className={`graph-focus-layout ${focusTag ? "focused" : ""}`}>
      <div className="graph-visual">
      <div ref={canvasRef} className="graph-canvas" aria-label={`Interactive contact graph grouped by ${graphMode}`}>
      {graph.tags.length === 0 ? <div className="graph-empty"><Network className="size-8" /><strong>No matching {graphMode === "labels" ? "tags" : "organizations"}</strong><span>Try another search.</span></div> : <svg style={{ width: `${zoom * 100}%`, minWidth: `${760 * zoom}px` }} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={`${graphMode === "labels" ? "Tags" : "Organizations"} with contacts around the outside`}>
        <g className="tag-edges">
          {graph.tagEdges.map((edge) => {
            const source = graph.tagPositions.get(edge.source)!;
            const target = graph.tagPositions.get(edge.target)!;
            return <line key={`${edge.source}-${edge.target}`} x1={source.x} y1={source.y} x2={target.x} y2={target.y} style={{ strokeWidth: Math.min(7, 1 + Math.log2(edge.shared + 1)) }}><title>{edge.source} and {edge.target}: {edge.shared} shared contacts</title></line>;
          })}
        </g>
        <g className="contact-edges">
          {graph.visibleContacts.flatMap((contact) => {
            const point = graph.contactPositions.get(contact.id)!;
            return groupsForContact(contact, graphMode).filter((tag) => graph.visibleTagNames.has(tag)).map((tag) => {
              const target = graph.tagPositions.get(tag)!;
              return <line key={`${contact.id}-${tag}`} x1={point.x} y1={point.y} x2={target.x} y2={target.y} />;
            });
          })}
        </g>
        <g className="contact-nodes">
          {graph.visibleContacts.map((contact) => {
            const point = graph.contactPositions.get(contact.id)!;
            const active = hoveredContact === contact.id;
            const showName = Boolean(focusTag && groupsForContact(contact, graphMode).includes(focusTag) && (graph.focusCount <= ALWAYS_LABEL_LIMIT || active));
            const onLeft = point.x < CENTER.x;
            const displayName = contact.name.length > 28 ? `${contact.name.slice(0, 27)}…` : contact.name;
            return <g key={contact.id} className={`${active ? "active" : ""} ${showName ? "named" : ""}`} tabIndex={0} role="button" aria-label={`Open ${contact.name}`}
              onMouseEnter={() => setHoveredContact(contact.id)} onMouseLeave={() => setHoveredContact(null)} onFocus={() => setHoveredContact(contact.id)} onBlur={() => setHoveredContact(null)} onClick={() => onSelectContact(contact.id)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") onSelectContact(contact.id); }}>
              <circle cx={point.x} cy={point.y} r="15" className="graph-node-hit" style={{ fill: "transparent", stroke: "none" }} />
              <circle cx={point.x} cy={point.y} r={active ? 6 : showName ? 4.5 : 3.5} />
              {showName && <text className="contact-name" x={point.x + (onLeft ? -8 : 8)} y={point.y + 3} textAnchor={onLeft ? "end" : "start"}>{displayName}</text>}
              <title>{contact.name}</title>
            </g>;
          })}
        </g>
        <g className="tag-nodes">
          {graph.tags.map(({ tag, count }) => {
            const point = graph.tagPositions.get(tag)!;
            const active = focusTag === tag;
            const radius = Math.min(34, 17 + Math.log2(count + 1) * 2.4);
            return <g key={tag} className={active ? "active" : ""} role="button" tabIndex={0} aria-label={`Focus ${tag}, ${count} contacts`} onClick={() => setFocusTag(tag)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") setFocusTag(tag); }}>
              <circle cx={point.x} cy={point.y} r={radius + 10} className="graph-node-hit" style={{ fill: "transparent", stroke: "none" }} />
              <circle cx={point.x} cy={point.y} r={radius} />
              <text x={point.x} y={point.y - 2} textAnchor="middle">{tag.length > 18 ? `${tag.slice(0, 17)}…` : tag}</text>
              <text className="tag-count" x={point.x} y={point.y + 12} textAnchor="middle">{count}</text>
              <title>{tag}: {count} contacts. Click to focus.</title>
            </g>;
          })}
        </g>
      </svg>}
      {hovered && <button className="graph-contact-popover" onClick={() => onSelectContact(hovered.id)}>
        <span className="graph-contact-avatar">{hovered.name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase()}</span>
        <span><strong>{hovered.name}</strong><small>{[hovered.role, hovered.organization].filter(Boolean).join(" · ") || "Open contact"}</small></span>
      </button>}
    </div>

      <div className="graph-note">{focusTag
        ? graph.focusCount <= ALWAYS_LABEL_LIMIT
          ? `Showing the people ${graphMode === "labels" ? `tagged ${focusTag}` : `at ${focusTag}`}, with names displayed beside their outer nodes. Select a person to edit the contact.`
          : `Showing ${Math.min(FOCUSED_CONTACT_LIMIT, graph.focusCount)} of ${graph.focusCount} people ${graphMode === "labels" ? `tagged ${focusTag}` : `at ${focusTag}`}. Names appear in the list below; select a person to edit the contact.`
        : `Showing the ${CONTACT_LIMIT} most relevant contacts for the visible ${graphMode === "labels" ? "tags" : "organizations"}. Select a node to reveal its people${graphMode === "labels" ? " and strongest neighboring tags" : ""}.`}
      </div>
      </div>
      {focusTag && <aside className="graph-people-list" aria-label={`Contacts ${graphMode === "labels" ? "tagged" : "at"} ${focusTag}`}>
        <div className="graph-people-header"><div><span>People in</span><strong>{focusTag}</strong></div><small>{graph.focusCount.toLocaleString()} total</small></div>
        <div className="graph-people-scroll">{graph.visibleContacts.map((contact) => <button key={contact.id} onClick={() => onSelectContact(contact.id)} onMouseEnter={() => setHoveredContact(contact.id)} onMouseLeave={() => setHoveredContact(null)}>
          <span className="graph-list-avatar">{contact.name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase()}</span>
          <span className="graph-list-copy"><strong>{contact.name}</strong><small>{[contact.role, contact.organization].filter(Boolean).join(" · ") || "No organization details"}</small></span>
        </button>)}</div>
        {graph.focusCount > graph.visibleContacts.length && <p className="graph-list-limit">Showing the first {graph.visibleContacts.length} contacts. Refine the group when more filtering is added.</p>}
      </aside>}
    </div>
  </div>;
}
