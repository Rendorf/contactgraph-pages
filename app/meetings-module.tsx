"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { CalendarDays, Pencil, Plus, Save, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "./auth-context";

export type Meeting = { id: string; contact_id: string; contact_ids?: string[]; date: string; insights: string; created_at?: string; updated_at?: string; revision?: number };
type MeetingContact = { id: string; name: string; organization?: string };
const participants = (meeting: Meeting) => meeting.contact_ids?.length ? meeting.contact_ids : [meeting.contact_id];

function ParticipantPicker({ contacts, selected, onChange, lockedId }: { contacts: MeetingContact[]; selected: string[]; onChange: (ids: string[]) => void; lockedId?: string }) {
  const [search, setSearch] = useState("");
  const byId = useMemo(() => new Map(contacts.map((contact) => [contact.id, contact])), [contacts]);
  const matches = contacts.filter((contact) => `${contact.name} ${contact.organization ?? ""}`.toLocaleLowerCase().includes(search.toLocaleLowerCase())).slice(0, 80);
  return <div className="meeting-participants"><span className="meeting-participants-label">People at this meeting</span>
    <div className="meeting-selected">{selected.length ? selected.map((id) => <span key={id}>{byId.get(id)?.name ?? "Contact unavailable"}{id !== lockedId && <button type="button" onClick={() => onChange(selected.filter((item) => item !== id))} aria-label={`Remove ${byId.get(id)?.name ?? "contact"}`}><X /></button>}</span>) : <small>Choose at least one contact</small>}</div>
    <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Find a contact to add…" aria-label="Search meeting contacts" />
    <div className="meeting-participant-options" role="group" aria-label="Meeting contacts">{matches.map((contact) => <label key={contact.id}><input type="checkbox" checked={selected.includes(contact.id)} disabled={contact.id === lockedId || (!selected.includes(contact.id) && selected.length >= 100)} onChange={(event) => onChange(event.target.checked ? [...selected, contact.id] : selected.filter((id) => id !== contact.id))} /><span>{contact.name}{contact.organization ? <small> · {contact.organization}</small> : null}</span></label>)}{!matches.length && <small>No matching contacts</small>}</div>
  </div>;
}

const today = () => {
  const parts = new Intl.DateTimeFormat("en", { timeZone: "Asia/Baku", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts();
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
};

export function ContactMeetingHistory({ contactId, contacts }: { contactId: string; contacts: MeetingContact[] }) {
  const { can } = useAuth();
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [loading, setLoading] = useState(true);
  const [date, setDate] = useState(today);
  const [insights, setInsights] = useState("");
  const [contactIds, setContactIds] = useState<string[]>([contactId]);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    let active = true;
    fetch(`/api/meetings?contact_id=${encodeURIComponent(contactId)}`).then(async (response) => {
      const body = await response.json().catch(() => ({})) as { meetings?: Meeting[]; error?: string };
      if (!response.ok) throw new Error(body.error ?? "Meeting notes could not be loaded");
      if (active) setMeetings(body.meetings ?? []);
    }).catch((error) => { if (active) toast.error(error instanceof Error ? error.message : "Meeting notes could not be loaded"); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [contactId]);
  useEffect(() => {
    const refresh = () => { void fetch(`/api/meetings?contact_id=${encodeURIComponent(contactId)}`).then((response) => response.json() as Promise<{ meetings?: Meeting[] }>).then((body) => setMeetings(body.meetings ?? [])); };
    window.addEventListener("contactgraph:collection:meetings", refresh);
    return () => window.removeEventListener("contactgraph:collection:meetings", refresh);
  }, [contactId]);
  const addMeeting = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!date || !insights.trim()) return;
    setSaving(true);
    try {
      const response = await fetch("/api/meetings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ contact_id: contactId, contact_ids: contactIds, date, insights: insights.trim() }),
      });
      const body = await response.json().catch(() => ({})) as { meeting?: Meeting; error?: string };
      const savedMeeting = body.meeting;
      if (!response.ok || !savedMeeting) throw new Error(body.error ?? "Meeting note could not be saved");
      setMeetings((current) => [savedMeeting, ...current].sort((a, b) => b.date.localeCompare(a.date) || (b.updated_at ?? "").localeCompare(a.updated_at ?? "")));
      setInsights("");
      setContactIds([contactId]);
      toast.success("Meeting note saved");
    } catch (error) { toast.error(error instanceof Error ? error.message : "Meeting note could not be saved"); }
    finally { setSaving(false); }
  };
  return <div className="contact-meetings">
    {can("meetings.create") && <form className="contact-meeting-form" onSubmit={(event) => void addMeeting(event)}>
      <ParticipantPicker contacts={contacts} selected={contactIds} onChange={setContactIds} lockedId={contactId} />
      <label><span>Meeting date</span><Input type="date" value={date} onChange={(event) => setDate(event.target.value)} required /></label>
      <label><span>Insights and notes</span><Textarea rows={3} value={insights} onChange={(event) => setInsights(event.target.value)} placeholder="What did you discuss? Decisions, follow-ups, personal context…" required /></label>
      <Button type="submit" size="sm" disabled={saving || !date || !insights.trim()}><Plus />{saving ? "Saving…" : "Add meeting note"}</Button>
    </form>}
    <div className="meeting-history">
      {loading ? <p className="meeting-muted">Loading meeting notes…</p> : meetings.length ? meetings.map((meeting) => <article key={meeting.id}><time dateTime={meeting.date}>{new Date(`${meeting.date}T12:00:00`).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })}</time>{participants(meeting).length > 1 && <small>With {participants(meeting).filter((id) => id !== contactId).map((id) => contacts.find((contact) => contact.id === id)?.name ?? "Contact unavailable").join(", ")}</small>}<p>{meeting.insights}</p></article>) : <p className="meeting-muted">No meeting notes recorded for this contact yet.</p>}
    </div>
  </div>;
}

export function MeetingsModule({ contacts }: { contacts: MeetingContact[] }) {
  const { can } = useAuth();
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [contactIds, setContactIds] = useState<string[]>([]);
  const [date, setDate] = useState(today);
  const [insights, setInsights] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState("");
  const byId = useMemo(() => new Map(contacts.map((contact) => [contact.id, contact])), [contacts]);
  const load = async () => {
    const response = await fetch("/api/meetings");
    const body = await response.json().catch(() => ({})) as { meetings?: Meeting[]; error?: string };
    if (!response.ok) throw new Error(body.error ?? "Meetings could not be loaded");
    setMeetings(body.meetings ?? []);
  };
  useEffect(() => {
    let active = true;
    fetch("/api/meetings").then(async (response) => {
      const body = await response.json().catch(() => ({})) as { meetings?: Meeting[]; error?: string };
      if (!response.ok) throw new Error(body.error ?? "Meetings could not be loaded");
      if (active) setMeetings(body.meetings ?? []);
    }).catch((error) => { if (active) toast.error(error instanceof Error ? error.message : "Meetings could not be loaded"); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    const refresh = () => { void load().catch(() => toast.error("Meetings could not refresh.")); };
    window.addEventListener("contactgraph:collection:meetings", refresh);
    return () => window.removeEventListener("contactgraph:collection:meetings", refresh);
  }, []);
  const reset = () => { setEditingId(null); setContactIds([]); setDate(today()); setInsights(""); };
  const submit = async () => {
    if (!contactIds.length || !date || !insights.trim()) { toast.error("Choose contacts, a date, and add meeting insights."); return; }
    setSaving(true);
    try {
      const payload = { id: editingId ?? crypto.randomUUID(), contact_id: contactIds[0], contact_ids: contactIds, date, insights: insights.trim(), ...(editingId ? { revision: meetings.find((item) => item.id === editingId)?.revision } : {}) };
      const response = await fetch(editingId ? `/api/meetings/${encodeURIComponent(editingId)}` : "/api/meetings", { method: editingId ? "PUT" : "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Meeting could not be saved");
      await load(); reset(); toast.success(editingId ? "Meeting updated" : "Meeting saved");
    } catch (error) { toast.error(error instanceof Error ? error.message : "Meeting could not be saved"); }
    finally { setSaving(false); }
  };
  const remove = async (meeting: Meeting) => {
    if (!window.confirm("Delete this meeting note?")) return;
    const response = await fetch(`/api/meetings/${encodeURIComponent(meeting.id)}`, { method: "DELETE" });
    const body = await response.json().catch(() => ({})) as { error?: string };
    if (!response.ok) { toast.error(body.error ?? "Meeting could not be deleted"); return; }
    setMeetings((current) => current.filter((item) => item.id !== meeting.id));
    if (editingId === meeting.id) reset();
    toast.success("Meeting deleted");
  };
  const startEdit = (meeting: Meeting) => { setEditingId(meeting.id); setContactIds(participants(meeting)); setDate(meeting.date); setInsights(meeting.insights); window.scrollTo({ top: 0, behavior: "smooth" }); };
  const filtered = meetings.filter((meeting) => `${participants(meeting).map((id) => `${byId.get(id)?.name ?? ""} ${byId.get(id)?.organization ?? ""}`).join(" ")} ${meeting.insights}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  return <main className="meetings-module">
    <div className="module-heading"><div><p className="eyebrow">Relationship journal</p><h1 className="module-title">Meetings</h1><p className="module-subtitle">Keep dated notes and insights, linked to the people you met.</p></div><div className="meeting-count"><CalendarDays />{meetings.length} {meetings.length === 1 ? "meeting" : "meetings"}</div></div>
    {(can("meetings.create") || (editingId && can("meetings.edit"))) && <section className="meeting-editor"><div className="meeting-editor-heading"><div><span className="meeting-editor-icon"><Plus /></span><div><h2>{editingId ? "Edit meeting notes" : "Log a meeting"}</h2><p>Notes will also appear in the linked contact’s details.</p></div></div>{editingId && <Button variant="ghost" size="sm" onClick={reset}><X />Cancel edit</Button>}</div>
      <div className="meeting-form"><ParticipantPicker contacts={contacts} selected={contactIds} onChange={setContactIds} /><label><span>Meeting date</span><Input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label><label className="meeting-insights"><span>Insights and notes</span><Textarea value={insights} onChange={(event) => setInsights(event.target.value)} placeholder="What did you discuss? Decisions, follow-ups, personal context…" rows={4} /></label><Button className="meeting-save" onClick={() => void submit()} disabled={saving}>{saving ? "Saving…" : <><Save />{editingId ? "Save changes" : "Save meeting"}</>}</Button></div>
    </section>}
    <section className="meeting-list-section"><header><div><h2>Meeting log</h2><p>Newest meeting dates first</p></div><Input className="meeting-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search contact or notes…" aria-label="Search meetings" /></header>
      {filtered.length ? <div className="meeting-list">{filtered.map((meeting) => { const names = participants(meeting).map((id) => byId.get(id)?.name ?? "Contact unavailable"); return <article key={meeting.id}><div className="meeting-date-badge"><span>{new Date(`${meeting.date}T12:00:00`).toLocaleDateString(undefined, { month: "short" })}</span><strong>{new Date(`${meeting.date}T12:00:00`).getDate()}</strong><small>{new Date(`${meeting.date}T12:00:00`).getFullYear()}</small></div><div className="meeting-list-copy"><strong>{names.join(", ")}</strong><span>{participants(meeting).length} {participants(meeting).length === 1 ? "person" : "people"}</span><p>{meeting.insights}</p></div><div className="meeting-row-actions">{can("meetings.edit") && <Button size="icon" variant="ghost" onClick={() => startEdit(meeting)} aria-label={`Edit meeting with ${names.join(", ")}`}><Pencil /></Button>}{can("meetings.delete") && <Button size="icon" variant="ghost" onClick={() => void remove(meeting)} aria-label="Delete meeting note"><Trash2 /></Button>}</div></article>; })}</div> : <div className="meeting-empty"><CalendarDays /><strong>{query ? "No matching meetings" : "No meetings logged yet"}</strong><span>{query ? "Try searching for a different person or phrase." : "Add a meeting above. Its notes will be available from each participant’s profile too."}</span></div>}
    </section>
  </main>;
}
