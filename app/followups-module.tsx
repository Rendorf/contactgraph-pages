"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarClock, Check, ChevronDown, Clock3, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "./auth-context";

type Contact = { id: string; name: string; organization?: string; is_net?: boolean };
type Meeting = { date: string; insights: string } | null;
type Action = { id: string; contact_id: string; title: string; due_date: string; contact: Contact; last_meeting: Meeting };
type Suggestion = { contact_id: string; due_date: string; last_activity: string; cadence_days: number; contact: Contact; last_meeting: Meeting };
type Followups = { today: string; week_end: string; actions: Action[]; suggestions: Suggestion[]; settings: Record<string, { cadence_days: number }> };

const bakuToday = () => {
  const parts = new Intl.DateTimeFormat("en", { timeZone: "Asia/Baku", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts();
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
};
const readableDate = (value: string) => new Date(`${value}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
const tomorrow = (value: string) => new Date(Date.parse(`${value}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

export function FollowupsModule({ contacts, onOpenContact }: { contacts: Contact[]; onOpenContact: (id: string) => void }) {
  const { can } = useAuth();
  const [data, setData] = useState<Followups | null>(null);
  const [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState(false);
  const [contactId, setContactId] = useState("");
  const [contactQuery, setContactQuery] = useState("");
  const [title, setTitle] = useState("");
  const [dueDate, setDueDate] = useState(bakuToday);
  const [showAll, setShowAll] = useState(false);
  const [editingDate, setEditingDate] = useState("");
  const [newDate, setNewDate] = useState(bakuToday);
  const [editingCadence, setEditingCadence] = useState("");
  const [cadenceDays, setCadenceDays] = useState(30);

  const load = useCallback(async () => {
    const response = await fetch("/api/followups");
    const body = await response.json().catch(() => ({})) as Followups & { error?: string };
    if (!response.ok) throw new Error(body.error || "Follow-ups could not be loaded.");
    setData(body);
    setLoadError("");
  }, []);
  useEffect(() => {
    let active = true;
    fetch("/api/followups").then(async (response) => {
      const body = await response.json().catch(() => ({})) as Followups & { error?: string };
      if (!response.ok) throw new Error(body.error || "Follow-ups could not be loaded.");
      if (active) setData(body);
    }).catch((error) => { if (active) { setLoadError("Follow-ups could not be loaded."); toast.error(error instanceof Error ? error.message : "Follow-ups could not be loaded."); } });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    const refresh = () => { void load().catch(() => toast.error("Follow-ups could not refresh.")); };
    for (const name of ["followup_actions", "followup_settings", "meetings", "contacts"]) window.addEventListener(`contactgraph:collection:${name}`, refresh);
    window.addEventListener("contactgraph:sync", refresh);
    return () => { for (const name of ["followup_actions", "followup_settings", "meetings", "contacts"]) window.removeEventListener(`contactgraph:collection:${name}`, refresh); window.removeEventListener("contactgraph:sync", refresh); };
  }, [load]);

  const mutate = async (payload: Record<string, unknown>, success: string) => {
    setBusy(true);
    try {
      const response = await fetch("/api/followups", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(body.error || "Follow-up could not be saved.");
      await load();
      setEditingDate("");
      setEditingCadence("");
      toast.success(success);
      return true;
    } catch (error) { toast.error(error instanceof Error ? error.message : "Follow-up could not be saved."); return false; }
    finally { setBusy(false); }
  };
  const matches = useMemo(() => contactQuery.trim().length > 1
    ? contacts.filter((contact) => `${contact.name} ${contact.organization || ""}`.toLocaleLowerCase().includes(contactQuery.toLocaleLowerCase())).slice(0, 8)
    : [], [contacts, contactQuery]);
  const entries = useMemo(() => {
    if (!data) return [];
    return [
      ...data.actions.map((item) => ({ kind: "action" as const, id: item.id, contact_id: item.contact_id, contact: item.contact, due_date: item.due_date, title: item.title, last_meeting: item.last_meeting, reason: `You set this next step for ${readableDate(item.due_date)}.` })),
      ...data.suggestions.map((item) => ({ kind: "suggestion" as const, id: `suggestion:${item.contact_id}`, contact_id: item.contact_id, contact: item.contact, due_date: item.due_date, title: "Reconnect", last_meeting: item.last_meeting, reason: `${item.cadence_days} days since the last recorded meeting or completed follow-up (${readableDate(item.last_activity)}).` })),
    ].sort((a, b) => a.due_date.localeCompare(b.due_date) || (a.kind === "action" ? -1 : 1));
  }, [data]);
  const due = entries.filter((entry) => data && entry.due_date <= data.week_end);
  const upcoming = entries.filter((entry) => data && entry.due_date > data.week_end);
  const overdue = due.filter((entry) => data && entry.due_date < data.today).length;
  const selected = contacts.find((contact) => contact.id === contactId);

  const renderEntry = (entry: typeof entries[number]) => <article className="followup-card" key={entry.id}>
    <div className="followup-card-head"><div><span className="followup-kind">{entry.kind === "action" ? "Planned action" : "Reconnect suggestion"}</span><h3>{entry.contact.name}</h3><p>{entry.contact.organization || "Contact"}</p></div><span className={`followup-date ${data && entry.due_date < data.today ? "overdue" : ""}`}>{entry.due_date < (data?.today || "") ? "Overdue · " : "Due · "}{readableDate(entry.due_date)}</span></div>
    <strong className="followup-next">{entry.title}</strong><p className="followup-reason">{entry.reason}</p>
    {entry.last_meeting && <div className="followup-meeting"><span>Last meeting · {readableDate(entry.last_meeting.date)}</span><p>{entry.last_meeting.insights}</p></div>}
    <div className="followup-actions"><Button size="sm" variant="outline" onClick={() => onOpenContact(entry.contact_id)}>Contact details</Button>
      {can("followups.manage") && <><Button size="sm" onClick={() => void mutate(entry.kind === "action" ? { type: "complete", id: entry.id } : { type: "complete-suggestion", contact_id: entry.contact_id }, "Follow-up completed")} disabled={busy}><Check />Done</Button><Button size="sm" variant="outline" onClick={() => { setEditingDate(editingDate === entry.id ? "" : entry.id); setNewDate(entry.kind === "suggestion" ? tomorrow(data?.today || bakuToday()) : data?.today || bakuToday()); }} disabled={busy}><Clock3 />{entry.kind === "action" ? "Set date" : "Snooze"}</Button>
        <Button size="sm" variant="ghost" onClick={() => void mutate(entry.kind === "action" ? { type: "delete", id: entry.id } : { type: "dismiss-suggestion", contact_id: entry.contact_id }, "Reminder dismissed")} disabled={busy}><X />Discard</Button>
        {entry.kind === "suggestion" && <Button size="sm" variant="ghost" onClick={() => { setEditingCadence(editingCadence === entry.id ? "" : entry.id); setCadenceDays(data?.settings[entry.contact_id]?.cadence_days || 30); }} disabled={busy}>Cadence</Button>}</>}
    </div>
    {editingDate === entry.id && <div className="followup-inline"><Input type="date" min={entry.kind === "suggestion" ? tomorrow(data?.today || bakuToday()) : undefined} aria-label="New follow-up date" value={newDate} onChange={(event) => setNewDate(event.target.value)} /><Button size="sm" disabled={busy || !newDate} onClick={() => void mutate(entry.kind === "action" ? { type: "reschedule", id: entry.id, due_date: newDate } : { type: "snooze-suggestion", contact_id: entry.contact_id, due_date: newDate }, "Date saved")}>Save date</Button></div>}
    {editingCadence === entry.id && <div className="followup-inline"><label>Repeat every <Input type="number" min={7} max={365} value={cadenceDays} onChange={(event) => setCadenceDays(Number(event.target.value))} /> days</label><Button size="sm" disabled={busy || cadenceDays < 7 || cadenceDays > 365} onClick={() => void mutate({ type: "set-cadence", contact_id: entry.contact_id, cadence_days: cadenceDays }, "Cadence saved")}>Save cadence</Button></div>}
  </article>;

  return <main className="followups-module">
    <div className="module-heading"><div><p className="eyebrow">Relationship rhythm</p><h1 className="module-title">Who should I contact this week?</h1><p className="module-subtitle">A shared view of planned next steps and timely reconnections.</p></div><div className="meeting-count"><CalendarClock />Week ending {readableDate(data?.week_end || bakuToday())}</div></div>
    <div className="followup-stats"><div><strong>{due.length}</strong><span>Due this week</span></div><div><strong>{overdue}</strong><span>Overdue</span></div><div><strong>{data?.suggestions.length || 0}</strong><span>Net suggestions</span></div></div>
    {can("followups.manage") && <section className="followup-create"><div><h2>Set a next step</h2><p>Choose a person and a date. Your assistant will see the same queue.</p></div><div className="followup-form"><div className="followup-contact-picker"><Input value={contactQuery} onChange={(event) => { setContactQuery(event.target.value); setContactId(""); }} placeholder="Find a contact…" aria-label="Find a contact" />{matches.length > 0 && !selected && <div className="followup-matches">{matches.map((contact) => <button key={contact.id} onClick={() => { setContactId(contact.id); setContactQuery(contact.name); }}>{contact.name}{contact.organization ? ` · ${contact.organization}` : ""}</button>)}</div>}</div><Input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={200} placeholder="Next step, e.g. ask about the proposal" aria-label="Next step" /><Input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} aria-label="Due date" /><Button disabled={busy || !selected || !title.trim() || !dueDate} onClick={() => { void mutate({ type: "create", contact_id: contactId, title: title.trim(), due_date: dueDate }, "Follow-up added").then((saved) => { if (saved) { setTitle(""); setContactId(""); setContactQuery(""); } }); }}><Plus />Add follow-up</Button></div></section>}
    <section className="followup-list"><div className="followup-section-head"><div><h2>This week</h2><p>Overdue items stay here until completed or rescheduled.</p></div>{due.length > 10 && <Button size="sm" variant="ghost" onClick={() => setShowAll(!showAll)}>{showAll ? "Show fewer" : `Show all ${due.length}`}<ChevronDown /></Button>}</div>{!data ? <div className="followup-empty">{loadError ? <>{loadError} <Button size="sm" variant="outline" onClick={() => void load().catch(() => setLoadError("Follow-ups could not be loaded."))}>Retry</Button></> : "Loading follow-ups…"}</div> : due.length ? <div className="followup-grid">{(showAll ? due : due.slice(0, 10)).map(renderEntry)}</div> : <p className="followup-empty">Nothing due this week. Set a next step above or log a meeting with a Net contact.</p>}</section>
    {upcoming.length > 0 && <section className="followup-list"><div className="followup-section-head"><div><h2>Coming up</h2><p>Scheduled beyond this week.</p></div></div><div className="followup-grid">{upcoming.slice(0, showAll ? undefined : 10).map(renderEntry)}</div>{upcoming.length > 10 && <Button size="sm" variant="ghost" onClick={() => setShowAll(!showAll)}>{showAll ? "Show fewer" : `Show all ${upcoming.length}`}</Button>}</section>}
  </main>;
}
