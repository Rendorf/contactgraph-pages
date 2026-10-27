"use client";

import { useEffect, useState, type FormEvent } from "react";
import { CalendarClock, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "./auth-context";

type Reminder = { id: string; contact_id: string; title: string; due_date: string };
type FollowupsResponse = { actions?: Reminder[]; error?: string };

const bakuToday = () => {
  const parts = new Intl.DateTimeFormat("en", { timeZone: "Asia/Baku", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts();
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
};

export function ContactFollowupReminders({ contactId }: { contactId: string }) {
  const { can } = useAuth();
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [saving, setSaving] = useState(false);
  const [title, setTitle] = useState("Reconnect");
  const [dueDate, setDueDate] = useState(bakuToday);

  useEffect(() => {
    let active = true;
    fetch("/api/followups").then(async (response) => {
      const body = await response.json().catch(() => ({})) as FollowupsResponse;
      if (!response.ok) throw new Error(body.error || "Reminders could not be loaded.");
      if (active) {
        setReminders((body.actions ?? []).filter((item) => item.contact_id === contactId));
        setLoadError("");
      }
    }).catch((error) => {
      if (active) setLoadError(error instanceof Error ? error.message : "Reminders could not be loaded.");
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [contactId, refreshKey]);
  useEffect(() => {
    const refresh = () => setRefreshKey((value) => value + 1);
    window.addEventListener("contactgraph:collection:followup_actions", refresh);
    return () => window.removeEventListener("contactgraph:collection:followup_actions", refresh);
  }, []);

  const addReminder = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!title.trim() || !dueDate) return;
    setSaving(true);
    try {
      const response = await fetch("/api/followups", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "create", contact_id: contactId, title: title.trim(), due_date: dueDate }),
      });
      const body = await response.json().catch(() => ({})) as { id?: string; error?: string };
      if (!response.ok || !body.id) throw new Error(body.error || "Reminder could not be saved.");
      setReminders((current) => [...current, { id: body.id!, contact_id: contactId, title: title.trim(), due_date: dueDate }]
        .sort((a, b) => a.due_date.localeCompare(b.due_date)));
      setLoadError("");
      setTitle("Reconnect");
      setLoading(true);
      setRefreshKey((value) => value + 1);
      toast.success("Reminder saved in Follow-ups");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Reminder could not be saved.");
    } finally { setSaving(false); }
  };

  return <div className="contact-reminders">
    {can("followups.manage") && <form className="contact-reminder-form" onSubmit={(event) => void addReminder(event)}>
      <label><span>Remind me to</span><Input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={200} aria-label="Reminder description" required /></label>
      <label><span>Reminder date</span><Input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} aria-label="Reminder date" required /></label>
      <Button type="submit" size="sm" disabled={saving || !title.trim() || !dueDate}><Plus />{saving ? "Saving…" : "Set reminder"}</Button>
      <small>Reminders save immediately in Follow-ups and become due on the chosen date.</small>
    </form>}
    {loading ? <p className="meeting-muted">Loading reminders…</p> : loadError ? <div role="alert"><p className="meeting-muted">{loadError}</p><Button type="button" size="sm" variant="outline" onClick={() => { setLoading(true); setRefreshKey((value) => value + 1); }}>Retry</Button></div> : reminders.length ? <div className="contact-reminder-list">{reminders.map((reminder) => <div key={reminder.id}><CalendarClock /><span><strong>{reminder.title}</strong><time dateTime={reminder.due_date}>{new Date(`${reminder.due_date}T12:00:00`).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })}</time></span></div>)}</div> : <p className="meeting-muted">No reminders set for this contact.</p>}
  </div>;
}
