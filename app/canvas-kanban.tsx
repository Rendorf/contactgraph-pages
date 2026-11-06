"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export type Kanban = {
  columns: Record<string, string>;
  column_order: string[];
  assignments: Record<string, string>;
  card_order: string[];
};
export const emptyKanban = (): Kanban => ({ columns: {}, column_order: [], assignments: {}, card_order: [] });
export function readKanban(value?: Partial<Kanban>): Kanban {
  return { ...emptyKanban(), ...value };
}
export function validateKanban(value: unknown, nodeIds: string[]): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid Kanban configuration.");
  const keys = Object.keys(value);
  if (keys.length === 0) return;
  if (keys.length !== 4 || !keys.every(key => ["columns", "column_order", "assignments", "card_order"].includes(key))) throw new Error("Invalid Kanban configuration.");
  const board = value as Kanban;
  const { columns, column_order, assignments, card_order } = board;
  if (!columns || typeof columns !== "object" || Array.isArray(columns) || Object.keys(columns).length > 20
    || Object.entries(columns).some(([id, title]) => !id || id.length > 100 || ["__proto__", "constructor", "prototype"].includes(id) || typeof title !== "string" || !title.trim() || title.length > 80)) throw new Error("Use at most 20 columns with names of 1-80 characters.");
  if (!Array.isArray(column_order) || new Set(column_order).size !== column_order.length || column_order.length !== Object.keys(columns).length || column_order.some(id => typeof id !== "string" || !Object.hasOwn(columns, id))) throw new Error("Invalid Kanban column order.");
  if (!assignments || typeof assignments !== "object" || Array.isArray(assignments) || Object.entries(assignments).some(([id, status]) => !nodeIds.includes(id) || typeof status !== "string" || !Object.hasOwn(columns, status))) throw new Error("Kanban assignments must reference this board's cards and columns.");
  if (!Array.isArray(card_order) || new Set(card_order).size !== card_order.length || card_order.some(id => typeof id !== "string" || !nodeIds.includes(id))) throw new Error("Invalid Kanban card order.");
}

export function moveKanbanCard(value: Kanban, nodeIds: string[], id: string, status: string, before?: string): Kanban {
  if (!nodeIds.includes(id) || id === before || (status && !Object.hasOwn(value.columns, status))) return value;
  const assignments = { ...value.assignments, [id]: status };
  if (!status) delete assignments[id];
  const order = [...value.card_order.filter(key => nodeIds.includes(key)), ...nodeIds.filter(key => !value.card_order.includes(key))];
  const card_order = order.filter(key => key !== id);
  const index = before ? card_order.indexOf(before) : card_order.length;
  card_order.splice(index < 0 ? card_order.length : index, 0, id);
  return { ...value, assignments, card_order };
}

type Card = { id: string; title: string; notes: string; contact_ids: string[] };
type Props = {
  value: Kanban;
  nodes: Card[];
  editable: boolean;
  disabled: boolean;
  onChange: (value: Kanban) => void;
  onOpen: (id: string) => void;
  contactName: (id: string) => string;
};

export function CanvasKanban({ value, nodes, editable, disabled, onChange, onOpen, contactName }: Props) {
  const [newColumn, setNewColumn] = useState("");
  const [dragging, setDragging] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [columnTitle, setColumnTitle] = useState("");
  const canEdit = editable && !disabled;
  const nodeIds = nodes.map(node => node.id);
  const order = [...value.card_order.filter(id => nodeIds.includes(id)), ...nodeIds.filter(id => !value.card_order.includes(id))];
  const orderedNodes = order.map(id => nodes.find(node => node.id === id)!);
  const statusOf = (id: string) => Object.hasOwn(value.columns, value.assignments[id]) ? value.assignments[id] : "";
  const moveCard = (id: string, status: string, before?: string) => {
    if (!canEdit) return;
    onChange(moveKanbanCard(value, nodeIds, id, status, before));
  };
  const addColumn = () => {
    if (!canEdit || !newColumn.trim() || value.column_order.length >= 20) return;
    const id = crypto.randomUUID();
    onChange({ ...value, columns: { ...value.columns, [id]: newColumn.trim() }, column_order: [...value.column_order, id] });
    setNewColumn("");
  };
  const removeColumn = (id: string) => {
    if (!canEdit || !window.confirm(`Delete column “${value.columns[id]}”? Its cards will move to Unassigned.`)) return;
    const columns = { ...value.columns };
    delete columns[id];
    onChange({ ...value, columns, column_order: value.column_order.filter(key => key !== id), assignments: Object.fromEntries(Object.entries(value.assignments).filter(([, status]) => status !== id)) });
  };
  const moveColumn = (index: number, offset: number) => {
    const column_order = [...value.column_order];
    const target = index + offset;
    if (!canEdit || target < 0 || target >= column_order.length) return;
    [column_order[index], column_order[target]] = [column_order[target], column_order[index]];
    onChange({ ...value, column_order });
  };
  return <div className="canvas-kanban">
    {editable && <form className="kanban-add-column" onSubmit={event => { event.preventDefault(); addColumn(); }}>
      <Input value={newColumn} maxLength={80} onChange={event => setNewColumn(event.target.value)} placeholder="New status column" aria-label="New status column" disabled={!canEdit} />
      <Button type="submit" disabled={!canEdit || !newColumn.trim() || value.column_order.length >= 20}>Add column</Button>
      <small>{value.column_order.length}/20 columns</small>
    </form>}
    <div className="kanban-columns">
      {["", ...value.column_order].map(status => {
        const cards = orderedNodes.filter(node => statusOf(node.id) === status);
        const title = status ? value.columns[status] : "Unassigned";
        const columnIndex = value.column_order.indexOf(status);
        return <section className="kanban-column" key={status} aria-label={`${title} column`}
          onDragOver={event => { if (canEdit && dragging) event.preventDefault(); }}
          onDrop={event => { event.preventDefault(); if (dragging) moveCard(dragging, status); setDragging(null); }}>
          <header><strong>{title}</strong><span>{cards.length}</span></header>
          {status && editable && <div className="kanban-column-actions">
            <Button size="sm" variant="ghost" disabled={!canEdit || columnIndex === 0} onClick={() => moveColumn(columnIndex, -1)} aria-label={`Move ${title} column left`}>←</Button>
            <Button size="sm" variant="ghost" disabled={!canEdit || columnIndex === value.column_order.length - 1} onClick={() => moveColumn(columnIndex, 1)} aria-label={`Move ${title} column right`}>→</Button>
            <Button size="sm" variant="ghost" disabled={!canEdit} onClick={() => { setRenaming(status); setColumnTitle(title); }}>Rename</Button>
            <Button size="sm" variant="ghost" disabled={!canEdit} onClick={() => removeColumn(status)}>Delete</Button>
          </div>}
          {renaming === status && <form onSubmit={event => { event.preventDefault(); if (canEdit && columnTitle.trim()) { onChange({ ...value, columns: { ...value.columns, [status]: columnTitle.trim() } }); setRenaming(null); } }}>
            <Input autoFocus maxLength={80} aria-label="Column name" value={columnTitle} onChange={event => setColumnTitle(event.target.value)} />
            <Button size="sm" disabled={!canEdit || !columnTitle.trim()}>Apply</Button><Button type="button" size="sm" variant="ghost" onClick={() => setRenaming(null)}>Cancel</Button>
          </form>}
          {cards.map((node, index) => <article className="kanban-card" key={node.id} draggable={canEdit}
            onDragStart={event => { setDragging(node.id); event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", node.id); }} onDragEnd={() => setDragging(null)}
            onDragOver={event => { if (canEdit && dragging) event.preventDefault(); }}
            onDrop={event => { event.preventDefault(); event.stopPropagation(); if (dragging) moveCard(dragging, status, node.id); setDragging(null); }}>
            <button className="kanban-card-content" onClick={() => onOpen(node.id)}><strong>{node.title}</strong><p>{node.notes || "No notes"}</p><small>{node.contact_ids.map(contactName).join(", ") || "No contacts"}</small></button>
            {editable && <div className="kanban-card-actions">
              <select aria-label={`Status for ${node.title}`} value={status} disabled={!canEdit} onChange={event => moveCard(node.id, event.target.value)}><option value="">Unassigned</option>{value.column_order.map(id => <option key={id} value={id}>{value.columns[id]}</option>)}</select>
              <Button size="sm" variant="ghost" disabled={!canEdit || index === 0} aria-label={`Move ${node.title} up`} onClick={() => moveCard(node.id, status, cards[index - 1]?.id)}>↑</Button>
              <Button size="sm" variant="ghost" disabled={!canEdit || index === cards.length - 1} aria-label={`Move ${node.title} down`} onClick={() => moveCard(node.id, status, cards[index + 2]?.id)}>↓</Button>
            </div>}
          </article>)}
          {!cards.length && <p className="kanban-empty">No cards in this column</p>}
        </section>;
      })}
    </div>
  </div>;
}
