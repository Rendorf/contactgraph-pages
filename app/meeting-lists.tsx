"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarPlus, Check, Clock3, ListPlus, Pencil, Trash2, UserPlus, UsersRound, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { normalizeSearch, searchRank } from "./search";
import { useAuth } from "./auth-context";

export type MeetingList = { id: string; name: string; cadence_days: number; revision?: number };
export type MeetingListMember = { id: string; list_id: string; contact_id: string; cadence_days: number; uses_list_cadence: boolean; snoozed_until?: string | null; last_contact_on?: string | null; joined_on: string; due_date: string; last_activity?: string | null; last_meeting?: { date: string; insights: string } | null; contact: { id: string; name: string; organization?: string } };
export type MeetingListsData = { today: string; lists: MeetingList[]; members: MeetingListMember[] };
type Contact = { id: string; name: string; organization?: string };

const readableDate = (value: string) => new Date(`${value}T12:00:00Z`).toLocaleDateString(undefined, { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" });
const nextDay = (value: string) => { const day = new Date(`${value}T12:00:00Z`); day.setUTCDate(day.getUTCDate() + 1); return day.toISOString().slice(0, 10); };

export function useMeetingLists(enabled = true) {
  const [data, setData] = useState<MeetingListsData>({ today: "", lists: [], members: [] });
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    if (!enabled) return;
    const response = await fetch("/api/meeting-lists", { cache: "no-store" });
    const body = await response.json().catch(() => ({})) as MeetingListsData & { error?: string };
    if (!response.ok || !Array.isArray(body.lists) || !Array.isArray(body.members)) throw new Error(body.error || "Meeting lists could not be loaded.");
    setData(body); setError(""); setLoading(false);
  }, [enabled]);
  useEffect(() => {
    let active = true;
    const initial = window.setTimeout(() => void load().catch(() => { if (active) { setError("Meeting lists are temporarily unavailable."); setLoading(false); } }), 0);
    const refresh = () => void load().catch(() => undefined);
    for (const name of ["meeting_lists", "meeting_list_members", "meetings"]) window.addEventListener(`contactgraph:collection:${name}`, refresh);
    window.addEventListener("contactgraph:meeting-lists-changed", refresh);
    return () => { active = false; window.clearTimeout(initial); for (const name of ["meeting_lists", "meeting_list_members", "meetings"]) window.removeEventListener(`contactgraph:collection:${name}`, refresh); window.removeEventListener("contactgraph:meeting-lists-changed", refresh); };
  }, [load]);
  const mutate = useCallback(async (payload: Record<string, unknown>, success: string) => {
    const response = await fetch("/api/meeting-lists", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
    const body = await response.json().catch(() => ({})) as { error?: string };
    if (!response.ok) throw new Error(body.error || "Meeting list could not be saved.");
    toast.success(success); await load(); window.dispatchEvent(new Event("contactgraph:meeting-lists-changed"));
  }, [load]);
  return { data, loading, error, mutate, refresh: load };
}

function MemberCard({ member, list, today, canManage, canAddNotes, onOpenContact, onAddMeetingNotes, mutate }: { member: MeetingListMember; list: MeetingList; today: string; canManage: boolean; canAddNotes: boolean; onOpenContact: (id: string) => void; onAddMeetingNotes: (id: string) => void; mutate: (payload: Record<string, unknown>, success: string) => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [cadence, setCadence] = useState(member.uses_list_cadence ? "" : String(member.cadence_days));
  const [snooze, setSnooze] = useState(member.snoozed_until || "");
  const overdue = member.due_date < today;
  return <article className="meeting-list-member">
    <div><small>{overdue ? "Overdue" : "Next meeting"} · {readableDate(member.due_date)}</small><strong>{member.contact.name}</strong><span>{member.contact.organization || list.name} · every {member.cadence_days} days</span>{member.last_meeting?.insights && <p>{member.last_meeting.insights}</p>}</div>
    <div className="meeting-list-actions"><Button size="sm" variant="outline" onClick={() => onOpenContact(member.contact_id)}>View person</Button>{canAddNotes && <Button size="sm" variant="outline" onClick={() => onAddMeetingNotes(member.contact_id)}><CalendarPlus />Add notes</Button>}
      {canManage && <><Button size="sm" onClick={() => void mutate({ type: "mark-met", contact_id: member.contact_id }, `${member.contact.name} marked as met`).catch((error) => toast.error(error.message))}><Check />Met today</Button><Button size="icon" variant="ghost" onClick={() => setEditing(!editing)} aria-label={`Schedule ${member.contact.name}`}><Clock3 /></Button></>}
    </div>
    {editing && <div className="meeting-list-inline"><label>Cadence<Input type="number" min={7} max={365} placeholder={`${list.cadence_days} (list)`} value={cadence} onChange={(event) => setCadence(event.target.value)} /></label><label>Snooze until<Input type="date" min={nextDay(today)} value={snooze} onChange={(event) => setSnooze(event.target.value)} /></label><Button size="sm" onClick={() => void mutate({ type: "update-member", id: member.id, cadence_days: cadence ? Number(cadence) : null, snoozed_until: snooze || null }, "Schedule saved").then(() => setEditing(false)).catch((error) => toast.error(error.message))}>Save</Button><Button size="sm" variant="ghost" onClick={() => void mutate({ type: "delete-member", id: member.id }, "Person removed from list").catch((error) => toast.error(error.message))}><X />Remove</Button></div>}
  </article>;
}

export function MeetingListsWorkspace({ contacts, onOpenContact, onAddMeetingNotes }: { contacts: Contact[]; onOpenContact: (id: string) => void; onAddMeetingNotes: (id: string) => void }) {
  const { can } = useAuth();
  const { data, loading, error, mutate } = useMeetingLists(can("followups.view"));
  const [selected, setSelected] = useState("all");
  const [manage, setManage] = useState(false);
  const [activeList, setActiveList] = useState("");
  const [name, setName] = useState("");
  const [cadence, setCadence] = useState(30);
  const [query, setQuery] = useState("");
  const [pendingContactIds, setPendingContactIds] = useState<Set<string>>(() => new Set());
  const selectedList = data.lists.find((item) => item.id === activeList);
  const members = data.members.filter((item) => selected === "all" || item.list_id === selected);
  const memberIds = useMemo(() => new Set(data.members.filter((item) => item.list_id === activeList).map((item) => item.contact_id)), [activeList, data.members]);
  const matches = useMemo(() => query.trim().length > 1 ? contacts.filter((item) => !memberIds.has(item.id) && normalizeSearch(`${item.name} ${item.organization || ""}`).includes(normalizeSearch(query))).sort((a, b) => searchRank(a.name, query) - searchRank(b.name, query)).slice(0, 8) : [], [contacts, memberIds, query]);
  const create = () => void mutate({ type: "create-list", name, cadence_days: cadence }, "Meeting list created").then(() => { setName(""); setCadence(30); }).catch((error) => toast.error(error.message));
  const beginNewList = () => { setActiveList(""); setName(""); setCadence(30); setQuery(""); setPendingContactIds(new Set()); };
  const togglePending = (contactId: string) => setPendingContactIds((current) => { const next = new Set(current); if (next.has(contactId)) next.delete(contactId); else next.add(contactId); return next; });
  const addSelected = () => {
    if (!selectedList || !pendingContactIds.size) return;
    const ids = [...pendingContactIds];
    void mutate({ type: "add-members", list_id: selectedList.id, contact_ids: ids }, `${ids.length} ${ids.length === 1 ? "person" : "people"} added`).then(() => { setQuery(""); setPendingContactIds(new Set()); }).catch((error) => toast.error(error.message));
  };
  return <section className="meeting-lists-workspace">
    <div className="followup-section-head"><div><h2>People to meet</h2><p>Named queues recalculate from your latest meeting and cadence.</p></div>{can("followups.manage") && <Button size="sm" variant="outline" onClick={() => setManage(!manage)}><ListPlus />{manage ? "Close manager" : "Manage lists"}</Button>}</div>
    <div className="meeting-list-filters"><Button size="sm" variant={selected === "all" ? "default" : "outline"} onClick={() => setSelected("all")}>All lists</Button>{data.lists.map((list) => <Button key={list.id} size="sm" variant={selected === list.id ? "default" : "outline"} onClick={() => setSelected(list.id)}>{list.name}<span>{data.members.filter((item) => item.list_id === list.id && item.due_date <= data.today).length}</span></Button>)}</div>
    {manage && <div className="meeting-list-manager"><div className="meeting-list-create"><Input maxLength={80} value={name} onChange={(event) => setName(event.target.value)} placeholder={selectedList ? "List name" : "New list name"} /><Input type="number" min={7} max={365} value={cadence} onChange={(event) => setCadence(Number(event.target.value))} aria-label="Default cadence in days" />{selectedList ? <><Button onClick={() => void mutate({ type: "update-list", id: selectedList.id, name, cadence_days: cadence }, "List updated").catch((error) => toast.error(error.message))}><Pencil />Save</Button><Button variant="ghost" onClick={() => { if (window.confirm(`Delete “${selectedList.name}” and its memberships?`)) void mutate({ type: "delete-list", id: selectedList.id }, "List deleted").then(beginNewList).catch((error) => toast.error(error.message)); }}><Trash2 />Delete</Button></> : <Button disabled={!name.trim()} onClick={create}><ListPlus />Create list</Button>}</div>
      <div className="meeting-list-manager-tabs"><button className={!activeList ? "selected" : ""} onClick={beginNewList}>New list</button>{data.lists.map((list) => <button key={list.id} className={activeList === list.id ? "selected" : ""} onClick={() => { setActiveList(list.id); setName(list.name); setCadence(list.cadence_days); setQuery(""); setPendingContactIds(new Set()); }}>{list.name}</button>)}</div>
      {selectedList && <div className="meeting-list-add"><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find people to add…" />{matches.map((contact) => <button type="button" aria-pressed={pendingContactIds.has(contact.id)} className={pendingContactIds.has(contact.id) ? "selected" : ""} key={contact.id} onClick={() => togglePending(contact.id)}><span aria-hidden="true">{pendingContactIds.has(contact.id) ? <Check /> : <UserPlus />}</span>{contact.name}{contact.organization ? ` · ${contact.organization}` : ""}</button>)}{pendingContactIds.size > 0 && <Button className="meeting-list-add-confirm" size="sm" onClick={addSelected}>Add selected ({pendingContactIds.size})</Button>}</div>}
    </div>}
    {loading ? <p className="followup-empty">Loading meeting lists…</p> : error ? <p className="followup-empty">{error}</p> : members.length ? <div className="meeting-list-grid">{members.map((member) => <MemberCard key={member.id} member={member} list={data.lists.find((list) => list.id === member.list_id)!} today={data.today} canManage={can("followups.manage")} canAddNotes={can("meetings.create")} onOpenContact={onOpenContact} onAddMeetingNotes={onAddMeetingNotes} mutate={mutate} />)}</div> : <div className="followup-empty"><UsersRound />{data.lists.length ? "No people are in this view yet." : "Create a list, then add the people you want to meet regularly."}</div>}
  </section>;
}

export function MeetingListsToday({ onOpenContact, onAddMeetingNotes }: { onOpenContact: (id: string) => void; onAddMeetingNotes: (id: string) => void }) {
  const { can } = useAuth();
  const { data, loading, error, mutate } = useMeetingLists(can("followups.view"));
  const due = data.members.filter((item) => item.due_date <= data.today);
  if (!can("followups.view") || (!loading && !error && !data.lists.length)) return null;
  return <section className="today-meeting-lists"><div className="today-section-heading"><div><p className="eyebrow">People to meet</p><h2>{due.length ? `${new Set(due.map((item) => item.contact_id)).size} people need attention` : "Meeting lists are caught up"}</h2></div></div>
    {loading ? <p className="today-muted">Loading meeting lists…</p> : error ? <p className="today-muted">{error}</p> : data.lists.map((list) => { const items = due.filter((item) => item.list_id === list.id); return items.length ? <div className="today-meeting-list" key={list.id}><h3>{list.name}<span>{items.length}</span></h3>{items.map((member) => <div key={member.id}><button onClick={() => onOpenContact(member.contact_id)}><strong>{member.contact.name}</strong><small>{member.due_date < data.today ? `Overdue · ${readableDate(member.due_date)}` : "Due today"}</small></button>{can("meetings.create") && <Button size="sm" variant="outline" onClick={() => onAddMeetingNotes(member.contact_id)}><CalendarPlus />Notes</Button>}{can("followups.manage") && <Button size="sm" onClick={() => void mutate({ type: "mark-met", contact_id: member.contact_id }, `${member.contact.name} marked as met`).catch((cause) => toast.error(cause.message))}><Check />Met</Button>}</div>)}</div> : null; })}
  </section>;
}
