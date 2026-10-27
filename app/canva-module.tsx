"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { Grip, LayoutDashboard, Maximize2, Minus, Plus, Save, Scaling, Search, StickyNote, Trash2, UsersRound, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useAuth } from "./auth-context";

type CanvasContact = { id: string; name: string; organization?: string; role?: string };
type CanvasNode = { id: string; title: string; notes: string; x: number; y: number; width: number; height: number; contact_ids: string[] };
type CanvasRecord = { id: string; title: string; created_at: string; updated_at: string; nodes: CanvasNode[] };

const STAGE_WIDTH = 1200;
const STAGE_HEIGHT = 760;
const MIN_NODE_WIDTH = 220;
const MAX_NODE_WIDTH = 600;
const MIN_NODE_HEIGHT = 145;
const MAX_NODE_HEIGHT = 520;
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const nodeId = () => globalThis.crypto?.randomUUID?.() ?? `node-${Date.now()}-${Math.random().toString(16).slice(2)}`;

export function CanvaModule({ contacts }: { contacts: CanvasContact[] }) {
  const { can } = useAuth();
  const [canvases, setCanvases] = useState<CanvasRecord[]>([]);
  const [activeId, setActiveId] = useState("");
  const [draft, setDraft] = useState<CanvasRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  const [contactQuery, setContactQuery] = useState("");
  const [zoom, setZoom] = useState(1);
  const stageScrollRef = useRef<HTMLDivElement>(null);
  const zoomRef = useRef(zoom);
  useEffect(() => { zoomRef.current = zoom; }, [zoom]);

  useEffect(() => {
    const stage = stageScrollRef.current;
    if (!stage) return;
    let pinch: { distance: number; zoom: number } | null = null;
    const distance = (event: TouchEvent) => Math.hypot(event.touches[0].clientX - event.touches[1].clientX, event.touches[0].clientY - event.touches[1].clientY);
    const start = (event: TouchEvent) => { if (event.touches.length === 2) pinch = { distance: distance(event), zoom: zoomRef.current }; };
    const move = (event: TouchEvent) => {
      if (event.touches.length !== 2) return;
      event.preventDefault();
      if (!pinch) pinch = { distance: distance(event), zoom: zoomRef.current };
      setZoom(Math.max(0.5, Math.min(2, Number((pinch.zoom * distance(event) / Math.max(1, pinch.distance)).toFixed(2)))));
    };
    const end = (event: TouchEvent) => { if (event.touches.length < 2) pinch = null; };
    stage.addEventListener("touchstart", start, { passive: true });
    stage.addEventListener("touchmove", move, { passive: false });
    stage.addEventListener("touchend", end);
    stage.addEventListener("touchcancel", end);
    return () => {
      stage.removeEventListener("touchstart", start);
      stage.removeEventListener("touchmove", move);
      stage.removeEventListener("touchend", end);
      stage.removeEventListener("touchcancel", end);
    };
  }, [draft?.id]);

  useEffect(() => {
    fetch("/api/canvases").then(async (response) => {
      const body = await response.json().catch(() => ({})) as { canvases?: CanvasRecord[]; error?: string };
      if (!response.ok) throw new Error(body.error ?? "Canvases could not be loaded");
      const loaded = body.canvases ?? [];
      setCanvases(loaded);
      if (loaded[0]) { setActiveId(loaded[0].id); setDraft(structuredClone(loaded[0])); }
    }).catch((error) => toast.error(error instanceof Error ? error.message : "Canvases could not be loaded")).finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    const refresh = () => { void fetch("/api/canvases").then((response) => response.json() as Promise<{ canvases?: CanvasRecord[] }>).then((body) => {
      const updated = body.canvases ?? [];
      setCanvases(updated);
      if (!dirty) {
        const active = updated.find((item) => item.id === activeId) ?? updated[0];
        setActiveId(active?.id ?? "");
        setDraft(active ? structuredClone(active) : null);
      }
    }).catch(() => toast.error("Canvases could not refresh.")); };
    window.addEventListener("contactgraph:collection:canvases", refresh);
    return () => window.removeEventListener("contactgraph:collection:canvases", refresh);
  }, [activeId, dirty]);

  const chooseCanvas = (canvas: CanvasRecord) => {
    if (dirty && !window.confirm("Discard unsaved changes and open another canvas?")) return;
    setActiveId(canvas.id);
    setDraft(structuredClone(canvas));
    setDirty(false);
    setEditingNodeId(null);
  };
  const updateDraft = (updater: (canvas: CanvasRecord) => CanvasRecord) => {
    setDraft((current) => current ? updater(current) : current);
    setDirty(true);
  };
  const createCanvas = async () => {
    if (!newTitle.trim()) return;
    setSaving(true);
    try {
      const response = await fetch("/api/canvases", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: newTitle.trim(), nodes: [] }) });
      const body = await response.json().catch(() => ({})) as { canvas?: CanvasRecord; error?: string };
      if (!response.ok || !body.canvas) throw new Error(body.error ?? "Canvas could not be created");
      setCanvases((current) => [body.canvas!, ...current]);
      setActiveId(body.canvas.id); setDraft(structuredClone(body.canvas)); setDirty(false);
      setNewTitle(""); setCreateOpen(false); toast.success("Canvas created");
    } catch (error) { toast.error(error instanceof Error ? error.message : "Canvas could not be created"); }
    finally { setSaving(false); }
  };
  const saveCanvas = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      const response = await fetch(`/api/canvases/${encodeURIComponent(draft.id)}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(draft) });
      const body = await response.json().catch(() => ({})) as { canvas?: CanvasRecord; error?: string };
      if (!response.ok || !body.canvas) throw new Error(body.error ?? "Canvas could not be saved");
      setDraft(body.canvas); setCanvases((current) => [body.canvas!, ...current.filter((item) => item.id !== body.canvas!.id)]); setDirty(false); toast.success("Canvas saved");
    } catch (error) { toast.error(error instanceof Error ? error.message : "Canvas could not be saved"); }
    finally { setSaving(false); }
  };
  const deleteCanvas = async () => {
    if (!draft || !window.confirm(`Delete “${draft.title}” and all its nodes? This cannot be undone.`)) return;
    setSaving(true);
    try {
      const response = await fetch(`/api/canvases/${encodeURIComponent(draft.id)}`, { method: "DELETE" });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Canvas could not be deleted");
      const remaining = canvases.filter((item) => item.id !== draft.id);
      setCanvases(remaining); setActiveId(remaining[0]?.id ?? ""); setDraft(remaining[0] ? structuredClone(remaining[0]) : null); setDirty(false); toast.success("Canvas deleted");
    } catch (error) { toast.error(error instanceof Error ? error.message : "Canvas could not be deleted"); }
    finally { setSaving(false); }
  };
  const addNode = () => {
    if (!draft) return;
    const index = draft.nodes.length;
    const node: CanvasNode = { id: nodeId(), title: "New node", notes: "", x: 50 + (index % 4) * 245, y: 50 + (Math.floor(index / 4) % 4) * 185, width: MIN_NODE_WIDTH, height: MIN_NODE_HEIGHT, contact_ids: [] };
    updateDraft((canvas) => ({ ...canvas, nodes: [...canvas.nodes, node] }));
    setEditingNodeId(node.id);
  };
  const updateNode = (id: string, changes: Partial<CanvasNode>) => updateDraft((canvas) => ({ ...canvas, nodes: canvas.nodes.map((node) => node.id === id ? { ...node, ...changes } : node) }));
  const deleteNode = (id: string) => { updateDraft((canvas) => ({ ...canvas, nodes: canvas.nodes.filter((node) => node.id !== id) })); setEditingNodeId(null); };
  const beginDrag = (event: ReactPointerEvent, node: CanvasNode) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const startX = event.clientX, startY = event.clientY, originalX = node.x, originalY = node.y;
    const pointerId = event.pointerId;
    const move = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) return;
      updateNode(node.id, { x: clamp(originalX + (moveEvent.clientX - startX) / zoomRef.current, 0, STAGE_WIDTH - (node.width ?? MIN_NODE_WIDTH)), y: clamp(originalY + (moveEvent.clientY - startY) / zoomRef.current, 0, STAGE_HEIGHT - (node.height ?? MIN_NODE_HEIGHT)) });
    };
    const stop = (stopEvent: PointerEvent) => {
      if (stopEvent.pointerId !== pointerId) return;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
  };
  const beginResize = (event: ReactPointerEvent, node: CanvasNode) => {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const startX = event.clientX, startY = event.clientY, originalWidth = node.width ?? MIN_NODE_WIDTH, originalHeight = node.height ?? MIN_NODE_HEIGHT;
    const pointerId = event.pointerId;
    const move = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) return;
      const width = Math.round(clamp(originalWidth + (moveEvent.clientX - startX) / zoomRef.current, MIN_NODE_WIDTH, Math.floor(Math.min(MAX_NODE_WIDTH, STAGE_WIDTH - node.x))));
      const height = Math.round(clamp(originalHeight + (moveEvent.clientY - startY) / zoomRef.current, MIN_NODE_HEIGHT, Math.floor(Math.min(MAX_NODE_HEIGHT, STAGE_HEIGHT - node.y))));
      updateNode(node.id, {
        width, height,
        x: clamp(node.x, 0, STAGE_WIDTH - width),
        y: clamp(node.y, 0, STAGE_HEIGHT - height),
      });
    };
    const stop = (stopEvent: PointerEvent) => {
      if (stopEvent.pointerId !== pointerId) return;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
  };
  const changeSize = (node: CanvasNode, field: "width" | "height", raw: string) => {
    const value = Number(raw);
    if (!Number.isFinite(value)) return node[field] ?? (field === "width" ? MIN_NODE_WIDTH : MIN_NODE_HEIGHT);
    const width = field === "width" ? clamp(Math.round(value), MIN_NODE_WIDTH, Math.floor(Math.min(MAX_NODE_WIDTH, STAGE_WIDTH - node.x))) : node.width ?? MIN_NODE_WIDTH;
    const height = field === "height" ? clamp(Math.round(value), MIN_NODE_HEIGHT, Math.floor(Math.min(MAX_NODE_HEIGHT, STAGE_HEIGHT - node.y))) : node.height ?? MIN_NODE_HEIGHT;
    updateNode(node.id, { width, height, x: clamp(node.x, 0, STAGE_WIDTH - width), y: clamp(node.y, 0, STAGE_HEIGHT - height) });
    return field === "width" ? width : height;
  };
  const editingNode = draft?.nodes.find((node) => node.id === editingNodeId) ?? null;
  const contactsById = useMemo(() => new Map(contacts.map((contact) => [contact.id, contact])), [contacts]);
  const selectedContacts = editingNode?.contact_ids.map((id) => contactsById.get(id)).filter((contact): contact is CanvasContact => Boolean(contact)) ?? [];
  const needle = contactQuery.trim().toLocaleLowerCase();
  const matchedContacts = contacts.filter((contact) => !editingNode?.contact_ids.includes(contact.id) && (!needle || `${contact.name} ${contact.organization ?? ""} ${contact.role ?? ""}`.toLocaleLowerCase().includes(needle))).slice(0, 100);

  if (!can("canvases.manage")) return <main className="canva-module"><div className="module-heading"><div><p className="eyebrow">Thinking spaces</p><h1 className="module-title">Canva</h1></div></div><div className="canva-layout"><aside className="canva-list"><header><strong>Canvases</strong><span>{canvases.length}</span></header>{canvases.map(canvas => <button key={canvas.id} className={activeId === canvas.id ? "active" : ""} onClick={() => chooseCanvas(canvas)}><LayoutDashboard /><span><strong>{canvas.title}</strong><small>{canvas.nodes.length} nodes</small></span></button>)}</aside><section className="canva-workspace">{draft?.nodes.map(node => <article key={node.id} className="settings-card" style={{ padding: "1rem", margin: "1rem" }}><h2>{node.title}</h2><p>{node.notes}</p><small>{contacts.filter(contact => node.contact_ids.includes(contact.id)).map(contact => contact.name).join(", ")}</small></article>)}</section></div></main>;
  return <div className="canva-module">
    <div className="module-heading"><div><p className="eyebrow">Thinking spaces</p><h1 className="module-title">Canva</h1><p className="module-subtitle">Create isolated canvases with movable nodes, notes, and contact references.</p></div><Button onClick={() => setCreateOpen(true)}><Plus />New canvas</Button></div>
    <div className="canva-layout">
      <aside className="canva-list"><header><strong>Your canvases</strong><span>{canvases.length}</span></header>{loading ? <p>Loading…</p> : canvases.length ? canvases.map((canvas) => <button key={canvas.id} className={activeId === canvas.id ? "active" : ""} onClick={() => chooseCanvas(canvas)}><LayoutDashboard /><span><strong>{canvas.title}</strong><small>{canvas.nodes.length} node{canvas.nodes.length === 1 ? "" : "s"}</small></span></button>) : <div className="canva-list-empty"><LayoutDashboard /><span>No canvases yet.</span></div>}</aside>
      <section className="canva-workspace">
        {draft ? <><div className="canva-toolbar"><Input value={draft.title} onChange={(event) => updateDraft((canvas) => ({ ...canvas, title: event.target.value }))} aria-label="Canvas title" /><div><span className={dirty ? "unsaved" : "saved"}>{dirty ? "Unsaved changes" : "Saved"}</span><div className="zoom-controls" aria-label="Canva zoom controls"><Button size="icon" variant="outline" onClick={() => setZoom((value) => Math.max(0.5, Number((value - 0.25).toFixed(2))))} disabled={zoom <= 0.5} aria-label="Zoom canvas out"><Minus /></Button><button className="zoom-level" onClick={() => setZoom(1)} aria-label="Reset canvas zoom to 100 percent">{Math.round(zoom * 100)}%</button><Button size="icon" variant="outline" onClick={() => setZoom((value) => Math.min(2, Number((value + 0.25).toFixed(2))))} disabled={zoom >= 2} aria-label="Zoom canvas in"><Plus /></Button><Button size="icon" variant="outline" onClick={() => setZoom(1)} disabled={zoom === 1} aria-label="Reset canvas zoom"><Maximize2 /></Button></div><Button variant="outline" onClick={addNode}><Plus />Add node</Button><Button onClick={() => void saveCanvas()} disabled={!dirty || saving}><Save />{saving ? "Saving…" : "Save canvas"}</Button><Button variant="outline" className="canva-delete" onClick={() => void deleteCanvas()} disabled={saving}><Trash2 /></Button></div></div><div ref={stageScrollRef} className="canva-stage-scroll"><div className="canva-stage-viewport" style={{ width: STAGE_WIDTH * zoom, height: STAGE_HEIGHT * zoom }}><div className="canva-stage" style={{ transform: `scale(${zoom})` }}>{draft.nodes.map((node) => {
          const linked = node.contact_ids.map((id) => contactsById.get(id)).filter((contact): contact is CanvasContact => Boolean(contact));
          return <article className="canva-node" key={node.id} style={{ left: node.x, top: node.y, width: node.width ?? MIN_NODE_WIDTH, height: node.height ?? MIN_NODE_HEIGHT }}>
            <button className="canva-node-handle" onPointerDown={(event) => beginDrag(event, node)} aria-label={`Move ${node.title}`}><Grip /></button>
            <button className="canva-node-main" onClick={() => setEditingNodeId(node.id)} aria-label={`Open ${node.title}, ${linked.length} attached contacts`}>
              <strong>{node.title}</strong><p>{node.notes || "Add notes…"}</p>
              <span className="canva-node-contacts"><span className="canva-node-contact-heading"><UsersRound />{linked.length} contact{linked.length === 1 ? "" : "s"}</span><span className="canva-node-contact-list">{linked.length ? linked.map((contact) => <span key={contact.id}>{contact.name}</span>) : <span>No contacts</span>}</span></span>
            </button>
            <button className="canva-node-resize" onPointerDown={(event) => beginResize(event, node)} aria-label={`Resize ${node.title}`} title="Drag to resize node"><Scaling /></button>
          </article>;
        })}{draft.nodes.length === 0 && <div className="canva-stage-empty"><StickyNote /><strong>Start with a node</strong><span>Each node can hold notes and linked contacts.</span><Button onClick={addNode}><Plus />Add first node</Button></div>}</div></div></div></> : <div className="canva-empty"><LayoutDashboard /><h2>Choose or create a canvas</h2><p>Every canvas is a separate, deletable thinking space.</p><Button onClick={() => setCreateOpen(true)}><Plus />Create canvas</Button></div>}
      </section>
    </div>
    <Dialog open={createOpen} onOpenChange={setCreateOpen}><DialogContent><DialogHeader><DialogTitle>Create a canvas</DialogTitle><DialogDescription>Name this isolated thinking space. You can rename it later.</DialogDescription></DialogHeader><Input autoFocus value={newTitle} onChange={(event) => setNewTitle(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void createCanvas(); }} placeholder="e.g. Washington data company" /><DialogFooter><Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button><Button onClick={() => void createCanvas()} disabled={!newTitle.trim() || saving}>{saving ? "Creating…" : "Create canvas"}</Button></DialogFooter></DialogContent></Dialog>
    <Sheet open={editingNode !== null} onOpenChange={(open) => { if (!open) { setEditingNodeId(null); setContactQuery(""); } }}>
      <SheetContent className="w-full gap-0 overflow-hidden p-0 sm:max-w-xl">
        <SheetHeader className="border-b px-5 py-5 pr-14"><SheetTitle>Edit node</SheetTitle><SheetDescription>Notes and contacts remain inside this canvas.</SheetDescription></SheetHeader>
        {editingNode && <div className="canva-node-editor">
          <label><span>Node title</span><Input value={editingNode.title} onChange={(event) => updateNode(editingNode.id, { title: event.target.value })} /></label>
          <div className="canva-size-fields">
            <label><span>Width (px)</span><Input key={`${editingNode.id}-width`} type="number" min={MIN_NODE_WIDTH} max={MAX_NODE_WIDTH} defaultValue={editingNode.width ?? MIN_NODE_WIDTH} onBlur={(event) => { event.currentTarget.value = String(changeSize(editingNode, "width", event.currentTarget.value)); }} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} /></label>
            <label><span>Height (px)</span><Input key={`${editingNode.id}-height`} type="number" min={MIN_NODE_HEIGHT} max={MAX_NODE_HEIGHT} defaultValue={editingNode.height ?? MIN_NODE_HEIGHT} onBlur={(event) => { event.currentTarget.value = String(changeSize(editingNode, "height", event.currentTarget.value)); }} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} /></label>
          </div>
          <label><span>Notes</span><Textarea className="min-h-40" value={editingNode.notes} onChange={(event) => updateNode(editingNode.id, { notes: event.target.value })} placeholder="Add your thoughts, questions, or next steps…" /></label>
          <section>
            <div><strong>Selected contacts</strong><small>{selectedContacts.length} selected</small></div>
            <div className="canva-selected-contacts">{selectedContacts.length ? selectedContacts.map((contact) => <div key={contact.id}>
              <span><strong>{contact.name}</strong><small>{[contact.role, contact.organization].filter(Boolean).join(" · ") || "No organization details"}</small></span>
              <Button type="button" size="icon" variant="ghost" onClick={() => updateNode(editingNode.id, { contact_ids: editingNode.contact_ids.filter((id) => id !== contact.id) })} aria-label={`Remove ${contact.name} from node`}><X /></Button>
            </div>) : <p>No contacts selected yet.</p>}</div>
          </section>
          <section>
            <div><strong>Add contacts</strong><small>Search your directory</small></div>
            <div className="recipient-search"><Search /><Input value={contactQuery} onChange={(event) => setContactQuery(event.target.value)} placeholder="Search contacts…" aria-label="Search contacts to add" /></div>
            <div className="canva-contact-picker">{matchedContacts.length ? matchedContacts.map((contact) => <label key={contact.id}><input type="checkbox" checked={false} onChange={() => updateNode(editingNode.id, { contact_ids: [...editingNode.contact_ids, contact.id] })} /><span /><div><strong>{contact.name}</strong><small>{[contact.role, contact.organization].filter(Boolean).join(" · ") || "No organization details"}</small></div></label>) : <p>No matching contacts.</p>}</div>
          </section>
          <div className="canva-node-editor-footer"><Button variant="outline" className="canva-delete" onClick={() => deleteNode(editingNode.id)}><Trash2 />Delete node</Button><Button onClick={() => setEditingNodeId(null)}>Done</Button></div>
        </div>}
      </SheetContent>
    </Sheet>
  </div>;
}
