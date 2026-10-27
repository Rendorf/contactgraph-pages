"use client";

import { useEffect, useMemo, useState } from "react";
import { Cake, CalendarDays, Check, Copy, ExternalLink, Send, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { useAuth } from "./auth-context";

type BirthdayContact = {
  id: string;
  name: string;
  birthday?: string;
  interaction_type?: string;
  role?: string;
  organization?: string;
  notes?: string;
  emails?: Array<{ address?: string }>;
  phones?: Array<{ number?: string }>;
};
type BirthdayMessage = { sequence: number; content: string; language: string; status: "generated" | "sent" };
type NotificationHoliday = { id: string; title: string; start_date: string; end_date: string; recurrence: string[]; description: string; categories: string[] };
const languages = ["Azerbaijani", "English", "Russian"];

function todayInBaku() {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Baku", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

export function BirthdayMessageComposer({ contact, compact = false, onUpdated }: { contact: BirthdayContact; compact?: boolean; onUpdated?: () => void }) {
  const [language, setLanguage] = useState("Azerbaijani");
  const [guidance, setGuidance] = useState("");
  const [message, setMessage] = useState<BirthdayMessage | null>(null);
  const [configured, setConfigured] = useState(false);
  const [model, setModel] = useState("");
  const [working, setWorking] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    let active = true;
    fetch("/api/ai-availability").then((response) => response.json() as Promise<{ configured?: boolean; model?: string }>).then((status) => {
      if (active) { setConfigured(Boolean(status.configured)); setModel(status.model || ""); }
    }).catch(() => undefined);
    return () => { active = false; };
  }, []);
  const generate = async () => {
    setWorking(true);
    try {
      const response = await fetch("/api/birthdays/generate-message", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ contact_id: contact.id, language, guidance }) });
      const body = await response.json().catch(() => ({})) as { message?: BirthdayMessage; error?: string };
      if (!response.ok || !body.message) throw new Error(body.error || "Birthday message could not be generated");
      setMessage(body.message); setDirty(false);
      onUpdated?.();
      toast.success(`Birthday greeting generated for ${contact.name}`);
    } catch (error) { toast.error(error instanceof Error ? error.message : "Birthday message could not be generated"); }
    finally { setWorking(false); }
  };
  const copy = async () => {
    if (!message) return;
    await navigator.clipboard.writeText(message.content);
    setCopied(true); window.setTimeout(() => setCopied(false), 1500);
  };
  const save = async () => {
    if (!message) return;
    setWorking(true);
    try {
      const response = await fetch(`/api/holiday-messages/${message.sequence}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ content: message.content }) });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(body.error || "Message could not be saved");
      setDirty(false); onUpdated?.(); toast.success("Birthday message saved");
    } catch (error) { toast.error(error instanceof Error ? error.message : "Message could not be saved"); }
    finally { setWorking(false); }
  };
  const share = async () => {
    if (!message) return;
    try {
      if (navigator.share) await navigator.share({ title: `Birthday message for ${contact.name}`, text: message.content });
      else {
        const email = contact.emails?.find((item) => item.address)?.address;
        const phone = contact.phones?.find((item) => item.number)?.number;
        if (email) window.location.href = `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent("Happy Birthday!")}&body=${encodeURIComponent(message.content)}`;
        else if (phone) window.location.href = `sms:${encodeURIComponent(phone)}?&body=${encodeURIComponent(message.content)}`;
        else { await copy(); toast.info("No email or phone is recorded; the message was copied."); }
      }
    } catch (error) {
      if (error instanceof Error && error.name !== "AbortError") toast.error("Could not open a sharing app");
      return;
    }
    if (typeof navigator.share === "function") toast.info("Choose the recipient and send from your sharing app.");
  };
  const markSent = async () => {
    if (!message) return;
    setWorking(true);
    try {
      const response = await fetch(`/api/holiday-messages/${message.sequence}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: "sent" }) });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(body.error || "Message status could not be updated");
      setMessage({ ...message, status: "sent" }); onUpdated?.(); toast.success("Message marked as sent");
    } catch (error) { toast.error(error instanceof Error ? error.message : "Message status could not be updated"); }
    finally { setWorking(false); }
  };

  return <div className={compact ? "birthday-composer compact" : "birthday-composer"}>
    {!compact && <div className="birthday-composer-heading"><div><strong><Cake />Birthday greeting</strong><small>{configured ? `Ready with ${model}` : "Add your OpenAI API key in Settings to generate"}</small></div></div>}
    <label className="generation-guidance birthday-guidance"><span>Optional extra guidance</span><Textarea maxLength={2000} rows={2} value={guidance} onChange={(event) => setGuidance(event.target.value)} placeholder="Style, tone, details to mention, or anything to avoid…" /><small>Added to the prompt for this greeting (up to 2,000 characters).</small></label>
    <div className="birthday-compose-controls"><NativeSelect value={language} onChange={(event) => setLanguage(event.target.value)} aria-label="Birthday message language">{languages.map((item) => <NativeSelectOption key={item} value={item}>{item}</NativeSelectOption>)}</NativeSelect><Button onClick={() => void generate()} disabled={working || !configured}><Sparkles />{working ? "Working…" : "Generate birthday message"}</Button></div>
    {message && <><label className="birthday-draft-label"><span>Editable {message.status === "sent" ? "sent message" : "draft"}{dirty ? " · unsaved" : ""}</span><Textarea value={message.content} onChange={(event) => { setMessage({ ...message, content: event.target.value }); setDirty(true); }} aria-label={`Birthday message for ${contact.name}`} /></label><div className="birthday-message-actions"><Button size="sm" variant="outline" onClick={() => void save()} disabled={!dirty || working}>Save edit</Button><Button size="sm" variant="outline" onClick={() => void copy()}>{copied ? <Check /> : <Copy />}{copied ? "Copied" : "Copy"}</Button><Button size="sm" onClick={() => void share()}><Send />Open to send</Button>{message.status !== "sent" && <Button size="sm" variant="ghost" onClick={() => void markSent()} disabled={working}>Mark sent</Button>}</div></>}
  </div>;
}

export function NotificationsModule({ contacts, onOpenContact, onOpenSettings, onOpenHoliday }: { contacts: BirthdayContact[]; onOpenContact: (contactId: string) => void; onOpenSettings: () => void; onOpenHoliday: (holidayId: string) => void }) {
  const { can } = useAuth();
  const today = todayInBaku();
  const [holidays, setHolidays] = useState<NotificationHoliday[]>([]);
  useEffect(() => {
    let active = true;
    fetch("/api/holidays").then(async (response) => {
      if (!response.ok) throw new Error("Could not load holidays");
      return response.json() as Promise<{ holidays: NotificationHoliday[] }>;
    }).then((body) => { if (active) setHolidays(body.holidays); })
      .catch(() => { if (active) toast.error("Today’s holidays could not be loaded"); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    const refresh = () => { void fetch("/api/holidays").then((response) => response.json() as Promise<{ holidays?: NotificationHoliday[] }>).then((body) => setHolidays(body.holidays ?? [])).catch(() => toast.error("Today’s holidays could not refresh.")); };
    window.addEventListener("contactgraph:collection:holidays", refresh);
    return () => window.removeEventListener("contactgraph:collection:holidays", refresh);
  }, []);
  const todaysHolidays = useMemo(() => {
    const day = new Date(`${today}T00:00:00`);
    return holidays.filter((holiday) => {
      const originalStart = new Date(`${holiday.start_date}T00:00:00`);
      const originalEnd = new Date(`${holiday.end_date}T00:00:00`);
      const duration = Math.max(1, Math.round((originalEnd.getTime() - originalStart.getTime()) / 86_400_000));
      const recurring = holiday.recurrence.some((item) => item.includes("FREQ=YEARLY"));
      const start = recurring ? new Date(day.getFullYear(), originalStart.getMonth(), originalStart.getDate()) : new Date(originalStart);
      const end = new Date(start);
      end.setDate(end.getDate() + duration);
      if (recurring && end <= day) {
        start.setFullYear(start.getFullYear() + 1);
        end.setFullYear(end.getFullYear() + 1);
      }
      return day >= start && day < end;
    }).sort((a, b) => a.title.localeCompare(b.title));
  }, [holidays, today]);
  const birthdayMonthDay = (birthday?: string) => /^\d{4}-\d{2}-\d{2}$/.test(birthday || "") ? birthday!.slice(5) : /^--\d{2}-\d{2}$/.test(birthday || "") ? birthday!.slice(2) : null;
  const todaysBirthdays = useMemo(() => contacts.filter((contact) => birthdayMonthDay(contact.birthday) === today.slice(5)).sort((a, b) => a.name.localeCompare(b.name)), [contacts, today]);
  const upcomingBirthdays = useMemo(() => contacts.filter((contact) => birthdayMonthDay(contact.birthday) && birthdayMonthDay(contact.birthday) !== today.slice(5)).map((contact) => {
    const monthDay = birthdayMonthDay(contact.birthday)!;
    const next = `${today.slice(0, 4)}-${monthDay}`;
    const upcoming = next >= today ? next : `${Number(today.slice(0, 4)) + 1}-${monthDay}`;
    return { contact, date: upcoming };
  }).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 20), [contacts, today]);
  const formatBirthday = (value: string) => new Date(`${value}T12:00:00`).toLocaleDateString("en", { month: "long", day: "numeric", timeZone: "Asia/Baku" });
  return <div className="notifications-module">
    <div className="module-heading"><div><p className="eyebrow">Reminders · {formatBirthday(today)}</p><h1 className="module-title">Notifications</h1><p className="module-subtitle">Birthdays and holidays for today, using the Asia/Baku date.</p></div>{can("settings.manage") && <Button variant="outline" onClick={onOpenSettings}><ExternalLink />Generation settings</Button>}</div>
    <section className="notifications-holidays"><header><div><CalendarDays /><span><strong>Today’s holidays and observances</strong><small>{todaysHolidays.length ? `${todaysHolidays.length} occasion${todaysHolidays.length === 1 ? "" : "s"} today` : "No holiday or observance today"}</small></span></div><time>{today.slice(5)}</time></header>
      {todaysHolidays.length ? <div className="notifications-holiday-list">{todaysHolidays.map((holiday) => <article key={holiday.id}><div><strong>{holiday.title}</strong><span>{holiday.categories.map((category) => category.replaceAll("_", " ")).join(" · ") || "Holiday or observance"}</span>{holiday.description && <p>{holiday.description}</p>}</div>{can("drafts.manage") && <Button size="sm" onClick={() => onOpenHoliday(holiday.id)}><Sparkles />Prepare messages</Button>}</article>)}</div> : <div className="notifications-holiday-empty">When an occasion falls today, it will appear here with a shortcut to prepare individual messages.</div>}
    </section>
    <section className="birthday-today-section"><header><div><Cake /><span><strong>Today’s birthdays</strong><small>{todaysBirthdays.length ? `${todaysBirthdays.length} contact${todaysBirthdays.length === 1 ? "" : "s"} to celebrate` : "No birthdays today"}</small></span></div><time>{today.slice(5)}</time></header>
      {todaysBirthdays.length ? <div className="birthday-contact-list">{todaysBirthdays.map((contact) => <article key={contact.id}><div className="birthday-person"><div className="birthday-avatar">{contact.name.trim().slice(0, 1).toLocaleUpperCase()}</div><div><strong>{contact.name}</strong><span>{[contact.role, contact.organization].filter(Boolean).join(" · ") || "Contact"}</span><small>{contact.emails?.find((item) => item.address)?.address || "Email not recorded"} · {contact.phones?.find((item) => item.number)?.number || "Phone not recorded"}</small></div></div><div className="birthday-person-actions"><Button size="sm" variant="outline" onClick={() => onOpenContact(contact.id)}>Contact details</Button></div>{can("drafts.manage") && <BirthdayMessageComposer compact contact={contact} />}</article>)}</div> : <div className="birthday-empty"><Cake /><strong>No birthday reminders today</strong><span>Add birthdays to contact records and they’ll appear here on the right day.</span></div>}
    </section>
    <section className="birthday-upcoming-section"><header><div><strong>Upcoming birthdays</strong><span>Next 20 contacts with a saved birthday</span></div></header>{upcomingBirthdays.length ? <div className="upcoming-birthday-list">{upcomingBirthdays.map(({ contact, date }) => <button key={contact.id} onClick={() => onOpenContact(contact.id)}><time>{formatBirthday(date)}</time><span>{contact.name}</span><small>{contact.birthday?.startsWith("--") ? "Year unknown" : contact.birthday?.slice(0, 4)}</small></button>)}</div> : <p className="birthday-upcoming-empty">No other birthdays are recorded.</p>}</section>
  </div>;
}
