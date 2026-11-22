"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowRight, CalendarDays, Cake, CheckCircle2, Clock3, UsersRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "./auth-context";
import type { CalendarData } from "./calendar-data";
import { needsAttention, type CalendarContact, type CalendarEvent } from "./calendar-model";
import type { Meeting } from "./meetings-module";
import type { WorkspaceModule } from "./module-registry";
import { MeetingListsToday } from "./meeting-lists";

const displayDate = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString(undefined, { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" });

function eventKind(event: CalendarEvent, today: string) {
  if (event.type === "birthday") return { label: "Birthday", icon: Cake };
  if (event.type === "holiday") return { label: "Occasion", icon: CalendarDays };
  return { label: event.date < today ? "Overdue follow-up" : "Follow-up", icon: Clock3 };
}

export function TodayModule({ contacts, data, onOpenContact, onSelect, onAddMeetingNotes }: {
  contacts: CalendarContact[];
  data: CalendarData;
  onOpenContact: (id: string) => void;
  onSelect: (module: WorkspaceModule) => void;
  onAddMeetingNotes: (id: string) => void;
}) {
  const { user, can } = useAuth();
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [meetingsUnavailable, setMeetingsUnavailable] = useState(false);
  useEffect(() => {
    if (!can("meetings.view")) return;
    let active = true;
    const load = () => fetch("/api/meetings", { cache: "no-store" }).then(async (response) => {
      const body = await response.json().catch(() => ({})) as { meetings?: Meeting[] };
      if (!response.ok) throw new Error("Meetings unavailable");
      if (active) { setMeetings(body.meetings ?? []); setMeetingsUnavailable(false); }
    }).catch(() => { if (active) setMeetingsUnavailable(true); });
    void load();
    const refresh = () => void load();
    window.addEventListener("contactgraph:collection:meetings", refresh);
    return () => { active = false; window.removeEventListener("contactgraph:collection:meetings", refresh); };
  }, [can]);

  const contactById = useMemo(() => new Map(contacts.map((contact) => [contact.id, contact])), [contacts]);
  const attention = useMemo(() => data.events.filter((event) => needsAttention(event, data.today)), [data.events, data.today]);
  const todayMeetings = meetings.filter((meeting) => meeting.date === data.today);
  const upcoming = data.events.filter((event) => event.date > data.today).slice(0, 4);
  const firstName = user?.display_name?.trim().split(/\s+/)[0] || "there";

  return <section className="today-module">
    <header className="today-hero">
      <div><p className="eyebrow">{displayDate(data.today)}</p><h1>Good to see you, {firstName}.</h1><p>Here is the small set of relationships and moments worth your attention today.</p></div>
      <div className="today-summary" aria-label="Today summary"><strong>{attention.length}</strong><span>{attention.length === 1 ? "item" : "items"} to review</span></div>
    </header>

    {data.error && <div className="v2-notice" role="alert">Some calendar information is unavailable. <button type="button" onClick={() => void data.refresh()}>Try again</button></div>}

    <div className="today-layout">
      <section className="today-focus" aria-labelledby="today-focus-title">
        <div className="today-section-heading"><div><p className="eyebrow">Focus</p><h2 id="today-focus-title">Needs attention</h2></div><Button variant="ghost" onClick={() => onSelect("calendar")}>Open calendar <ArrowRight /></Button></div>
        {data.loading ? <div className="today-empty" role="status">Loading today’s details…</div> : attention.length ? <div className="today-list">{attention.map((event) => {
          const kind = eventKind(event, data.today); const Icon = kind.icon;
          return <article key={event.id} className="today-item"><span className={`today-item-icon ${event.type}`}><Icon /></span><div><small>{kind.label}</small><strong>{event.title}</strong><span>{event.date < data.today ? `Due ${displayDate(event.date)}` : "Today"}</span></div>{event.contactId && <Button size="sm" variant="outline" onClick={() => onOpenContact(event.contactId!)}>View person</Button>}</article>;
        })}</div> : <div className="today-empty"><CheckCircle2 /><strong>You’re caught up</strong><span>No birthdays, occasions, or follow-ups need action today.</span></div>}
      </section>

      <aside className="today-rail">
        {can("meetings.view") && <section className="today-card"><div className="today-section-heading"><div><p className="eyebrow">Journal</p><h2>Today’s meetings</h2></div><button type="button" onClick={() => onSelect("meetings")} aria-label="Open meeting journal"><ArrowRight /></button></div>
          {meetingsUnavailable ? <p className="today-muted">Meeting information is temporarily unavailable.</p> : todayMeetings.length ? todayMeetings.map((meeting) => <button type="button" className="today-meeting" key={meeting.id} onClick={() => onSelect("meetings")}><UsersRound /><span><strong>{(meeting.contact_ids ?? [meeting.contact_id]).map((id) => contactById.get(id)?.name ?? "Contact").join(", ")}</strong><small>{meeting.insights || "Meeting note"}</small></span></button>) : <p className="today-muted">No meetings logged for today.</p>}
        </section>}
        <section className="today-card"><div className="today-section-heading"><div><p className="eyebrow">Next</p><h2>Coming up</h2></div><button type="button" onClick={() => onSelect("calendar")} aria-label="Open calendar"><ArrowRight /></button></div>
          {upcoming.length ? upcoming.map((event) => <button type="button" className="today-upcoming" key={event.id} onClick={() => event.contactId ? onOpenContact(event.contactId) : onSelect("calendar")}><span>{displayDate(event.date)}</span><strong>{event.title}</strong></button>) : <p className="today-muted">Nothing scheduled in the current window.</p>}
        </section>
      </aside>
    </div>
    <MeetingListsToday onOpenContact={onOpenContact} onAddMeetingNotes={onAddMeetingNotes} />
  </section>;
}
