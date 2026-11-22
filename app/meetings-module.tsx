"use client";
import { normalizeSearch, searchRank } from "./search";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { CalendarDays, Pencil, Plus, Save, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "./auth-context";
import { MeetingRecorder, type MeetingRecording } from "./meeting-recorder";

export type Meeting = { id: string; contact_id: string; contact_ids?: string[]; date: string; insights: string; created_at?: string; updated_at?: string; revision?: number };
type MeetingContact = { id: string; name: string; organization?: string };
const participants = (meeting: Meeting) => meeting.contact_ids?.length ? meeting.contact_ids : [meeting.contact_id];

export function ParticipantPicker({ contacts, selected, onChange, lockedId, label = "People at this meeting", emptyText = "Choose at least one contact" }: { contacts: MeetingContact[]; selected: string[]; onChange: (ids: string[]) => void; lockedId?: string; label?: string; emptyText?: string }) {
  const [search, setSearch] = useState("");
  const byId = useMemo(() => new Map(contacts.map((contact) => [contact.id, contact])), [contacts]);
  const matches = contacts.filter((contact) => normalizeSearch(`${contact.name} ${contact.organization ?? ""}`).includes(normalizeSearch(search))).sort((a, b) => searchRank(a.name, search) - searchRank(b.name, search)).slice(0, 80);
  return <div className="meeting-participants"><span className="meeting-participants-label">{label}</span>
    <div className="meeting-selected">{selected.length ? selected.map((id) => <span key={id}>{byId.get(id)?.name ?? "Contact unavailable"}{id !== lockedId && <button type="button" onClick={() => onChange(selected.filter((item) => item !== id))} aria-label={`Remove ${byId.get(id)?.name ?? "contact"}`}><X /></button>}</span>) : <small>{emptyText}</small>}</div>
    <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Find a contact to add…" aria-label={`Search: ${label}`} />
    <div className="meeting-participant-options" role="group" aria-label={label}>{matches.map((contact) => <label key={contact.id}><input type="checkbox" checked={selected.includes(contact.id)} disabled={contact.id === lockedId || (!selected.includes(contact.id) && selected.length >= 100)} onChange={(event) => onChange(event.target.checked ? [...selected, contact.id] : selected.filter((id) => id !== contact.id))} /><span>{contact.name}{contact.organization ? <small> · {contact.organization}</small> : null}</span></label>)}{!matches.length && <small>No matching contacts</small>}</div>
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
  const [recordingMeetingId, setRecordingMeetingId] = useState<string | null>(null);
  const [recordings, setRecordings] = useState<MeetingRecording[]>([]);
  const refreshMeetings = async () => {
    const response = await fetch(`/api/meetings?contact_id=${encodeURIComponent(contactId)}`);
    const body = await response.json().catch(() => ({})) as { meetings?: Meeting[]; error?: string };
    if (!response.ok) throw new Error(body.error ?? "Meeting notes could not be loaded");
    setMeetings(body.meetings ?? []);
  };
  const refreshRecordings = async () => {
    const response = await fetch("/api/meeting-recordings");
    const body = await response.json().catch(() => ({})) as { recordings?: MeetingRecording[]; error?: string };
    if (!response.ok) throw new Error(body.error ?? "Recordings could not be loaded");
    setRecordings(body.recordings ?? []);
  };
  useEffect(() => {
    let active = true;
    fetch(`/api/meetings?contact_id=${encodeURIComponent(contactId)}`).then(async (response) => {
      const body = await response.json().catch(() => ({})) as { meetings?: Meeting[]; error?: string };
      if (!response.ok) throw new Error(body.error ?? "Meeting notes could not be loaded");
      if (active) setMeetings(body.meetings ?? []);
    }).catch((error) => { if (active) toast.error(error instanceof Error ? error.message : "Meeting notes could not be loaded"); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [contactId]);
  useEffect(() => { const timer = window.setTimeout(() => { void refreshRecordings().catch(() => undefined); }, 0); return () => window.clearTimeout(timer); }, [contactId]);
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
      setMeetings((current) => [savedMeeting, ...current.filter((item) => item.id !== savedMeeting.id)].sort((a, b) => b.date.localeCompare(a.date) || (b.updated_at ?? "").localeCompare(a.updated_at ?? "")));
      setInsights("");
      setContactIds([contactId]);
      toast.success("Meeting note saved");
    } catch (error) { toast.error(error instanceof Error ? error.message : "Meeting note could not be saved"); }
    finally { setSaving(false); }
  };
  const ensureRecordingMeeting = async () => {
    if (recordingMeetingId) return recordingMeetingId;
    if (!date || !contactIds.length) throw new Error("Choose a meeting date and at least one person first.");
    const id = crypto.randomUUID();
    const response = await fetch("/api/meetings", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, contact_id: contactId, contact_ids: contactIds, date, insights: insights.trim() }) });
    const body = await response.json().catch(() => ({})) as { meeting?: Meeting; error?: string };
    if (!response.ok || !body.meeting) throw new Error(body.error ?? "Meeting could not be saved before recording");
    setMeetings((current) => [body.meeting!, ...current.filter((item) => item.id !== id)].sort((a, b) => b.date.localeCompare(a.date)));
    setRecordingMeetingId(id);
    return id;
  };
  const recordingChanged = (recording: MeetingRecording | null, deletedId?: string) => {
    setRecordings((current) => deletedId ? current.filter((item) => item.id !== deletedId) : recording ? [recording, ...current.filter((item) => item.id !== recording.id)] : current);
    if (recording?.transcript_status === "ready") void refreshMeetings().catch(() => undefined);
  };
  return <div className="contact-meetings">
    {can("meetings.create") && <form className="contact-meeting-form" onSubmit={(event) => void addMeeting(event)}>
      <ParticipantPicker contacts={contacts} selected={contactIds} onChange={setContactIds} lockedId={contactId} />
      <label><span>Meeting date</span><Input type="date" value={date} onChange={(event) => setDate(event.target.value)} required /></label>
      <label><span>Insights and notes</span><Textarea rows={3} value={insights} onChange={(event) => setInsights(event.target.value)} placeholder="What did you discuss? Decisions, follow-ups, personal context…" required /></label>
      <Button type="submit" size="sm" disabled={saving || !date || !insights.trim()}><Plus />{saving ? "Saving…" : "Add meeting note"}</Button>
    </form>}
    {can("meetings.create") && <MeetingRecorder meetingId={recordingMeetingId} ensureMeeting={ensureRecordingMeeting} recordings={recordings.filter((item) => item.meeting_id === recordingMeetingId)} onChange={recordingChanged} />}
    <div className="meeting-history">
      {loading ? <p className="meeting-muted">Loading meeting notes…</p> : meetings.length ? meetings.map((meeting) => { const audio = recordings.filter((item) => item.meeting_id === meeting.id); return <article key={meeting.id}><time dateTime={meeting.date}>{new Date(`${meeting.date}T12:00:00`).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })}</time>{participants(meeting).length > 1 && <small>With {participants(meeting).filter((id) => id !== contactId).map((id) => contacts.find((contact) => contact.id === id)?.name ?? "Contact unavailable").join(", ")}</small>}<p>{meeting.insights || (audio.length ? "Audio saved; transcript pending." : "No written notes.")}</p>{audio.map((item) => <div className="contact-meeting-audio" key={item.id}><audio controls preload="none" src={`/api/meeting-recordings/${encodeURIComponent(item.id)}/audio`} /><small>{item.transcript_status === "ready" ? "Transcript ready" : "Transcript pending"}</small></div>)}</article>; }) : <p className="meeting-muted">No meeting notes recorded for this contact yet.</p>}
    </div>
  </div>;
}

export function MeetingsModule({ contacts, prefillContactId, onPrefillConsumed }: { contacts: MeetingContact[]; prefillContactId?: string; onPrefillConsumed?: () => void }) {
  const { can } = useAuth();
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [contactIds, setContactIds] = useState<string[]>([]);
  const [date, setDate] = useState(today);
  const [insights, setInsights] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState("");
  const [recordings, setRecordings] = useState<MeetingRecording[]>([]);
  const byId = useMemo(() => new Map(contacts.map((contact) => [contact.id, contact])), [contacts]);
  const load = async () => {
    const response = await fetch("/api/meetings");
    const body = await response.json().catch(() => ({})) as { meetings?: Meeting[]; error?: string };
    if (!response.ok) throw new Error(body.error ?? "Meetings could not be loaded");
    setMeetings(body.meetings ?? []);
  };
  const loadRecordings = async () => {
    const response = await fetch("/api/meeting-recordings");
    const body = await response.json().catch(() => ({})) as { recordings?: MeetingRecording[]; error?: string };
    if (!response.ok) throw new Error(body.error ?? "Meeting recordings could not be loaded");
    setRecordings(body.recordings ?? []);
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
  useEffect(() => { const timer = window.setTimeout(() => { void loadRecordings().catch(() => toast.error("Meeting recordings could not be loaded.")); }, 0); return () => window.clearTimeout(timer); }, []);
  useEffect(() => {
    const refresh = () => { void load().catch(() => toast.error("Meetings could not refresh.")); };
    window.addEventListener("contactgraph:collection:meetings", refresh);
    return () => window.removeEventListener("contactgraph:collection:meetings", refresh);
  }, []);
  useEffect(() => {
    if (!prefillContactId || !contacts.some((contact) => contact.id === prefillContactId)) return;
    const timer = window.setTimeout(() => {
      setEditingId(null); setContactIds([prefillContactId]); setDate(today()); setInsights("");
      onPrefillConsumed?.();
      window.scrollTo({ top: 0, behavior: "smooth" });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [contacts, onPrefillConsumed, prefillContactId]);
  const reset = () => { setEditingId(null); setContactIds([]); setDate(today()); setInsights(""); };
  const persistMeeting = async (allowEmpty = false) => {
    if (!contactIds.length || !date || (!allowEmpty && !insights.trim())) throw new Error("Choose contacts, a date, and add meeting insights.");
    setSaving(true);
    try {
      const payload = { id: editingId ?? crypto.randomUUID(), contact_id: contactIds[0], contact_ids: contactIds, date, insights: insights.trim(), ...(editingId ? { revision: meetings.find((item) => item.id === editingId)?.revision } : {}) };
      const response = await fetch(editingId ? `/api/meetings/${encodeURIComponent(editingId)}` : "/api/meetings", { method: editingId ? "PUT" : "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      const body = await response.json().catch(() => ({})) as { meeting?: Meeting; error?: string };
      if (!response.ok || !body.meeting) throw new Error(body.error ?? "Meeting could not be saved");
      const saved = body.meeting;
      setMeetings((current) => [saved, ...current.filter((item) => item.id !== saved.id)].sort((a, b) => b.date.localeCompare(a.date) || (b.updated_at ?? "").localeCompare(a.updated_at ?? "")));
      setEditingId(saved.id);
      return saved;
    } finally { setSaving(false); }
  };
  const submit = async () => {
    const wasEditing = Boolean(editingId);
    try {
      const hasRecording = Boolean(editingId && recordings.some((item) => item.meeting_id === editingId));
      await persistMeeting(hasRecording);
      reset();
      toast.success(wasEditing ? "Meeting updated" : "Meeting saved");
    } catch (error) { toast.error(error instanceof Error ? error.message : "Meeting could not be saved"); }
  };
  const ensureRecordingMeeting = async () => (await persistMeeting(true)).id;
  const recordingChanged = (recording: MeetingRecording | null, deletedId?: string) => {
    setRecordings((current) => deletedId ? current.filter((item) => item.id !== deletedId) : recording ? [recording, ...current.filter((item) => item.id !== recording.id)] : current);
    if (recording?.transcript_status === "ready") void load().catch(() => undefined);
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
  const filtered = meetings.filter((meeting) => normalizeSearch(`${participants(meeting).map((id) => `${byId.get(id)?.name ?? ""} ${byId.get(id)?.organization ?? ""}`).join(" ")} ${meeting.insights}`).includes(normalizeSearch(query)));
  return <main className="meetings-module">
    <div className="module-heading"><div><p className="eyebrow">Relationship journal</p><h1 className="module-title">Meetings</h1><p className="module-subtitle">Keep dated notes and insights, linked to the people you met.</p></div><div className="meeting-count"><CalendarDays />{meetings.length} {meetings.length === 1 ? "meeting" : "meetings"}</div></div>
    {(can("meetings.create") || (editingId && can("meetings.edit"))) && <section className="meeting-editor"><div className="meeting-editor-heading"><div><span className="meeting-editor-icon"><Plus /></span><div><h2>{editingId ? "Edit meeting notes" : "Log a meeting"}</h2><p>Notes will also appear in the linked contact’s details.</p></div></div>{editingId && <Button variant="ghost" size="sm" onClick={reset}><X />Cancel edit</Button>}</div>
      <div className="meeting-form"><ParticipantPicker contacts={contacts} selected={contactIds} onChange={setContactIds} /><label><span>Meeting date</span><Input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label><label className="meeting-insights"><span>Insights and notes</span><Textarea value={insights} onChange={(event) => setInsights(event.target.value)} placeholder="What did you discuss? Decisions, follow-ups, personal context…" rows={4} /></label><MeetingRecorder meetingId={editingId} ensureMeeting={ensureRecordingMeeting} recordings={recordings.filter((item) => item.meeting_id === editingId)} onChange={recordingChanged} /><Button className="meeting-save" onClick={() => void submit()} disabled={saving}>{saving ? "Saving…" : <><Save />{editingId ? "Save changes" : "Save meeting"}</>}</Button></div>
    </section>}
    <section className="meeting-list-section"><header><div><h2>Meeting log</h2><p>Newest meeting dates first</p></div><Input className="meeting-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search contact or notes…" aria-label="Search meetings" /></header>
      {filtered.length ? <div className="meeting-list">{filtered.map((meeting) => { const names = participants(meeting).map((id) => byId.get(id)?.name ?? "Contact unavailable"); const audioCount = recordings.filter((item) => item.meeting_id === meeting.id).length; return <article key={meeting.id}><div className="meeting-date-badge"><span>{new Date(`${meeting.date}T12:00:00`).toLocaleDateString(undefined, { month: "short" })}</span><strong>{new Date(`${meeting.date}T12:00:00`).getDate()}</strong><small>{new Date(`${meeting.date}T12:00:00`).getFullYear()}</small></div><div className="meeting-list-copy"><strong>{names.join(", ")}</strong><span>{participants(meeting).length} {participants(meeting).length === 1 ? "person" : "people"}{audioCount ? ` · ${audioCount} recording${audioCount === 1 ? "" : "s"}` : ""}</span><p>{meeting.insights || (audioCount ? "Audio saved; transcript pending." : "No written notes.")}</p></div><div className="meeting-row-actions">{can("meetings.edit") && <Button size="icon" variant="ghost" onClick={() => startEdit(meeting)} aria-label={`Edit meeting with ${names.join(", ")}`}><Pencil /></Button>}{can("meetings.delete") && <Button size="icon" variant="ghost" onClick={() => void remove(meeting)} aria-label="Delete meeting note"><Trash2 /></Button>}</div></article>; })}</div> : <div className="meeting-empty"><CalendarDays /><strong>{query ? "No matching meetings" : "No meetings logged yet"}</strong><span>{query ? "Try searching for a different person or phrase." : "Add a meeting above. Its notes will be available from each participant’s profile too."}</span></div>}
    </section>
  </main>;
}
