"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Check, ExternalLink, Link2, Pencil, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "./auth-context";
import { ParticipantPicker } from "./meetings-module";

/** A mutual connection between two people. Stored once per pair (contact_a < contact_b). */
export type ContactLink = { id: string; contact_a: string; contact_b: string; note: string; revision?: number; updated_at?: string };
type LinkContact = { id: string; name: string; organization?: string };

export const LINKS_EVENT = "contactgraph:collection:contact_links";
const NOTE_LIMIT = 500;

export async function fetchLinks(contactId?: string): Promise<ContactLink[]> {
  const response = await fetch(contactId ? `/api/contact-links?contact_id=${encodeURIComponent(contactId)}` : "/api/contact-links");
  const body = await response.json().catch(() => ({})) as { links?: ContactLink[]; error?: string };
  if (!response.ok) throw new Error(body.error ?? "Connections could not be loaded");
  return body.links ?? [];
}

async function send(path: string, method: string, payload?: unknown) {
  const response = await fetch(path, { method, headers: { "content-type": "application/json" }, body: payload === undefined ? undefined : JSON.stringify(payload) });
  const body = await response.json().catch(() => ({})) as Record<string, unknown> & { error?: string };
  if (!response.ok) throw new Error(body.error ?? "The connection could not be saved");
  // Other open views (the People graph) refresh on this event.
  window.dispatchEvent(new Event(LINKS_EVENT));
  return body;
}

const otherOf = (link: ContactLink, contactId: string) => link.contact_a === contactId ? link.contact_b : link.contact_a;

export function ContactConnections({ contactId, contacts, onOpenContact }: { contactId: string; contacts: LinkContact[]; onOpenContact?: (id: string) => void }) {
  const { can } = useAuth();
  const canManage = can("connections.manage");
  const [links, setLinks] = useState<ContactLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<{ id: string; note: string } | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const byId = useMemo(() => new Map(contacts.map((contact) => [contact.id, contact])), [contacts]);

  const [version, setVersion] = useState(0);
  useEffect(() => {
    let active = true;
    fetchLinks(contactId).then((rows) => { if (active) setLinks(rows); })
      .catch((error) => { if (active) toast.error(error instanceof Error ? error.message : "Connections could not be loaded"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [contactId, version]);
  useEffect(() => {
    const refresh = () => setVersion((value) => value + 1);
    window.addEventListener(LINKS_EVENT, refresh);
    return () => window.removeEventListener(LINKS_EVENT, refresh);
  }, []);

  const connectedIds = useMemo(() => new Set(links.map((link) => otherOf(link, contactId))), [links, contactId]);
  const candidates = useMemo(() => contacts.filter((contact) => contact.id !== contactId && !connectedIds.has(contact.id)), [contacts, contactId, connectedIds]);
  const rows = useMemo(() => links.map((link) => ({ link, other: otherOf(link, contactId) }))
    .sort((a, b) => (byId.get(a.other)?.name ?? "").localeCompare(byId.get(b.other)?.name ?? "")), [links, contactId, byId]);

  const connect = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selected.length) return;
    setSaving(true);
    try {
      const body = await send("/api/contact-links", "POST", { contact_id: contactId, contact_ids: selected, note: note.trim() }) as { links?: ContactLink[]; skipped?: number };
      const created = body.links?.length ?? 0;
      toast.success(created === 1 ? "Connection added" : `${created} connections added`);
      setSelected([]);
      setNote("");
    } catch (error) { toast.error(error instanceof Error ? error.message : "The connection could not be saved"); }
    finally { setSaving(false); }
  };
  const saveNote = async (link: ContactLink) => {
    if (!editing) return;
    try {
      await send(`/api/contact-links/${encodeURIComponent(link.id)}`, "PUT", { id: link.id, note: editing.note.trim(), revision: link.revision });
      setEditing(null);
      toast.success("Note saved");
    } catch (error) { toast.error(error instanceof Error ? error.message : "The note could not be saved"); }
  };
  const remove = async (link: ContactLink) => {
    try {
      await send(`/api/contact-links/${encodeURIComponent(link.id)}`, "DELETE");
      setConfirmRemove(null);
      toast.success("Connection removed");
    } catch (error) { toast.error(error instanceof Error ? error.message : "The connection could not be removed"); }
  };

  return <div className="contact-connections">
    {loading ? <p className="meeting-muted">Loading connections…</p> : rows.length ? <ul className="connection-list">
      {rows.map(({ link, other }) => {
        const person = byId.get(other);
        const isEditing = editing?.id === link.id;
        return <li key={link.id}>
          <div className="connection-person">
            <span className="graph-list-avatar">{(person?.name ?? "?").split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase()}</span>
            <span className="connection-copy">
              <strong>{person?.name ?? "Contact unavailable"}</strong>
              {person?.organization && <small>{person.organization}</small>}
              {!isEditing && link.note && <em>{link.note}</em>}
            </span>
            <span className="connection-actions">
              {person && onOpenContact && <Button type="button" size="icon" variant="ghost" onClick={() => onOpenContact(other)} aria-label={`Open ${person.name}`}><ExternalLink /></Button>}
              {canManage && !isEditing && <Button type="button" size="icon" variant="ghost" onClick={() => { setEditing({ id: link.id, note: link.note }); setConfirmRemove(null); }} aria-label={`Edit note for ${person?.name ?? "connection"}`}><Pencil /></Button>}
              {canManage && <Button type="button" size="icon" variant="ghost" onClick={() => { setConfirmRemove(link.id); setEditing(null); }} aria-label={`Remove connection with ${person?.name ?? "contact"}`}><Trash2 /></Button>}
            </span>
          </div>
          {isEditing && <div className="connection-edit">
            <Input value={editing.note} maxLength={NOTE_LIMIT} onChange={(event) => setEditing({ id: link.id, note: event.target.value })} placeholder="How are they connected? (optional)" aria-label="Connection note" autoFocus />
            <Button type="button" size="sm" onClick={() => void saveNote(link)}><Check />Save</Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(null)}><X />Cancel</Button>
          </div>}
          {confirmRemove === link.id && <div className="connection-confirm" role="alert">
            <span>Remove the connection with {person?.name ?? "this contact"}? Both people stay in your contacts.</span>
            <Button type="button" size="sm" variant="destructive" onClick={() => void remove(link)}>Remove</Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setConfirmRemove(null)}>Keep</Button>
          </div>}
        </li>;
      })}
    </ul> : <p className="meeting-muted">No connections yet.{canManage ? " Choose people below to connect them with this contact." : ""}</p>}
    {canManage && <form className="contact-meeting-form connection-form" onSubmit={(event) => void connect(event)}>
      <ParticipantPicker contacts={candidates} selected={selected} onChange={setSelected} label="Connect with" emptyText="Choose one or more people" />
      <label><span>Note (optional, applies to each new connection)</span><Input value={note} maxLength={NOTE_LIMIT} onChange={(event) => setNote(event.target.value)} placeholder="e.g. colleagues at the same bank, introduced at a conference" /></label>
      <Button type="submit" size="sm" disabled={saving || !selected.length}><Link2 />{saving ? "Saving…" : selected.length > 1 ? `Connect ${selected.length} people` : "Connect"}</Button>
    </form>}
  </div>;
}
