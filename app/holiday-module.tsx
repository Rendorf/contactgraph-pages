"use client";

import { useEffect, useMemo, useState } from "react";
import { CalendarDays, Check, Copy, History, KeyRound, Languages, Mail, Phone, RefreshCw, Save, Search, Send, Sparkles, Trash2, Undo2, UsersRound, X } from "lucide-react";
import { toast } from "sonner";
import { Calendar } from "@/components/ui/calendar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ContactMessageHistory } from "./contact-message-history";
import { useAuth } from "./auth-context";

type Holiday = {
  id: string;
  title: string;
  start_date: string;
  end_date: string;
  recurrence: string[];
  categories: string[];
  description: string;
  source_ids: string[];
  verification: string;
  statutory_day_off: boolean;
  note_file: string;
  templates: Record<string, string>;
};

type Recipient = {
  id: string;
  name: string;
  organization?: string;
  role?: string;
  interaction_type?: string;
  labels?: string[];
  emails?: Array<{ label?: string; address?: string }>;
  phones?: Array<{ label?: string; number?: string }>;
};
type GeneratedMessage = {
  sequence: number;
  holiday_id: string;
  holiday_title: string;
  contact_id: string;
  contact_name: string;
  language: string;
  content: string;
  model: string;
  status: "generated" | "sent";
  sent_at: string | null;
  created_at: string;
};
const languageOptions = ["Azerbaijani", "English", "Russian"];
const localDate = (value: string) => new Date(`${value}T00:00:00`);
const occurrenceStart = (holiday: Holiday, year: number) => {
  const original = localDate(holiday.start_date);
  return holiday.recurrence.some((value) => value.includes("FREQ=YEARLY")) ? new Date(year, original.getMonth(), original.getDate()) : original;
};
const occursOn = (holiday: Holiday, date: Date) => {
  const start = occurrenceStart(holiday, date.getFullYear());
  const originalStart = localDate(holiday.start_date);
  const originalEnd = localDate(holiday.end_date);
  const duration = Math.max(1, Math.round((originalEnd.getTime() - originalStart.getTime()) / 86_400_000));
  const end = new Date(start); end.setDate(end.getDate() + duration);
  return date >= start && date < end;
};
const nextOccurrence = (holiday: Holiday, today: Date) => {
  const recurring = holiday.recurrence.some((value) => value.includes("FREQ=YEARLY"));
  const originalStart = localDate(holiday.start_date);
  const originalEnd = localDate(holiday.end_date);
  const duration = Math.max(1, Math.round((originalEnd.getTime() - originalStart.getTime()) / 86_400_000));
  let date = recurring ? occurrenceStart(holiday, today.getFullYear()) : originalStart;
  const end = new Date(date); end.setDate(end.getDate() + duration);
  if (recurring && end <= today) date = occurrenceStart(holiday, today.getFullYear() + 1);
  return { holiday, date, past: !recurring && end <= today };
};

function MessageGenerator({ holiday, contacts, open, onOpenChange, serverConfigured, model, onOpenSettings }: {
  holiday: Holiday | null;
  contacts: Recipient[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  serverConfigured: boolean;
  model: string;
  onOpenSettings: () => void;
}) {
  const [language, setLanguage] = useState("Azerbaijani");
  const [recipientQuery, setRecipientQuery] = useState("");
  const [recipientTag, setRecipientTag] = useState("");
  const [guidance, setGuidance] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [messages, setMessages] = useState<GeneratedMessage[]>([]);
  const [showPicker, setShowPicker] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [copied, setCopied] = useState<number | null>(null);
  const [dirtyIds, setDirtyIds] = useState<Set<number>>(() => new Set());
  const [savingId, setSavingId] = useState<number | null>(null);
  const [regeneratingId, setRegeneratingId] = useState<number | null>(null);
  const [historyContact, setHistoryContact] = useState<Recipient | null>(null);
  const tags = useMemo(() => {
    const counts = new Map<string, number>();
    contacts.forEach((contact) => (contact.labels ?? []).forEach((tag) => counts.set(tag, (counts.get(tag) ?? 0) + 1)));
    return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [contacts]);
  const filteredContacts = useMemo(() => {
    const needle = recipientQuery.trim().toLocaleLowerCase();
    return contacts.filter((contact) => {
      const matchesTag = !recipientTag || (contact.labels ?? []).includes(recipientTag);
      const searchable = [contact.name, contact.organization, contact.role, ...(contact.labels ?? []), ...(contact.emails ?? []).map((item) => item.address), ...(contact.phones ?? []).map((item) => item.number)].join(" ").toLocaleLowerCase();
      return matchesTag && (!needle || searchable.includes(needle));
    });
  }, [contacts, recipientQuery, recipientTag]);
  const selectedContacts = useMemo(() => contacts.filter((contact) => selectedIds.has(contact.id)), [contacts, selectedIds]);
  const toggleRecipient = (contactId: string) => setSelectedIds((current) => {
    const next = new Set(current);
    if (next.has(contactId)) next.delete(contactId);
    else if (next.size < 50) next.add(contactId);
    else toast.error("Generate messages for up to 50 contacts at a time");
    return next;
  });
  const selectFiltered = () => {
    const next = new Set(selectedIds);
    filteredContacts.forEach((contact) => { if (next.size < 50) next.add(contact.id); });
    setSelectedIds(next);
    if (filteredContacts.length + selectedIds.size > 50) toast.info("The first 50 matching contacts were selected");
  };
  const generate = async () => {
    if (!holiday || !serverConfigured || selectedIds.size === 0) return;
    setGenerating(true);
    setMessages([]);
    try {
      const response = await fetch("/api/holidays/generate-messages", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ holiday_id: holiday.id, language, contact_ids: [...selectedIds], guidance }) });
      const body = await response.json().catch(() => ({})) as { messages?: GeneratedMessage[]; error?: string };
      if (!response.ok) throw new Error(body.error ?? "Message generation failed");
      setMessages(body.messages ?? []);
      setDirtyIds(new Set());
      setShowPicker(false);
      toast.success(`${body.messages?.length ?? 0} personalized messages generated`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Message generation failed");
    } finally {
      setGenerating(false);
    }
  };
  const copy = async (message: GeneratedMessage) => {
    await navigator.clipboard.writeText(message.content);
    setCopied(message.sequence);
    setTimeout(() => setCopied(null), 1500);
  };
  const editMessage = (message: GeneratedMessage, content: string) => {
    setMessages((current) => current.map((item) => item.sequence === message.sequence ? { ...item, content } : item));
    setDirtyIds((current) => new Set(current).add(message.sequence));
  };
  const saveMessage = async (message: GeneratedMessage) => {
    setSavingId(message.sequence);
    try {
      const response = await fetch(`/api/holiday-messages/${message.sequence}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ content: message.content }) });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Draft could not be saved");
      setDirtyIds((current) => { const next = new Set(current); next.delete(message.sequence); return next; });
      toast.success("Draft saved");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Draft could not be saved");
    } finally {
      setSavingId(null);
    }
  };
  const regenerateMessage = async (message: GeneratedMessage) => {
    if (!holiday) return;
    setRegeneratingId(message.sequence);
    try {
      const response = await fetch("/api/holidays/regenerate-message", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ holiday_id: holiday.id, language, contact_id: message.contact_id, guidance }) });
      const body = await response.json().catch(() => ({})) as { message?: GeneratedMessage; error?: string };
      if (!response.ok || !body.message) throw new Error(body.error ?? "Message could not be regenerated");
      setMessages((current) => current.map((item) => item.sequence === message.sequence ? body.message! : item));
      setDirtyIds((current) => { const next = new Set(current); next.delete(message.sequence); return next; });
      toast.success(`New draft generated for ${body.message.contact_name}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Message could not be regenerated");
    } finally {
      setRegeneratingId(null);
    }
  };
  return <><Dialog open={open} onOpenChange={(next) => { if (!generating) onOpenChange(next); }}>
    <DialogContent className="personal-message-dialog flex max-h-[calc(100dvh-1rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-5xl">
      <DialogHeader className="shrink-0 border-b px-5 py-5 pr-12">
        <DialogTitle>Prepare individual messages</DialogTitle>
        <DialogDescription>{holiday?.title} · choose recipients, exclude anyone you do not want, then generate one message per person.</DialogDescription>
      </DialogHeader>
      <div className="holiday-generator-body">
        <div className="holiday-api-key">
          <div><KeyRound /><span><strong>OpenAI integration</strong><small>{serverConfigured ? `Configured securely · ${model}` : "Add an API key once in Settings to enable generation"}</small></span></div>
          {!serverConfigured && <Button type="button" variant="outline" onClick={() => { onOpenChange(false); onOpenSettings(); }}>Open Settings</Button>}
        </div>
        {showPicker ? <>
          <div className="recipient-controls">
            <label><span>Search contacts</span><div className="recipient-search"><Search /><Input value={recipientQuery} onChange={(event) => setRecipientQuery(event.target.value)} placeholder="Name, organization, email, phone…" /></div></label>
            <label><span>Filter by tag</span><NativeSelect className="w-full" value={recipientTag} onChange={(event) => setRecipientTag(event.target.value)}><NativeSelectOption value="">All tags</NativeSelectOption>{tags.map(([tag, count]) => <NativeSelectOption key={tag} value={tag}>{tag} ({count})</NativeSelectOption>)}</NativeSelect></label>
            <label><span>Message language</span><NativeSelect className="w-full" value={language} onChange={(event) => setLanguage(event.target.value)}>{languageOptions.map((option) => <NativeSelectOption key={option} value={option}>{option}</NativeSelectOption>)}</NativeSelect></label>
          </div>
          <label className="generation-guidance"><span>Optional extra guidance</span><Textarea maxLength={2000} rows={2} value={guidance} onChange={(event) => setGuidance(event.target.value)} placeholder="Style, tone, details to mention, or anything to avoid…" /><small>Applied to every generated message. Factual and contact-specific guidance still takes priority.</small></label>
          <div className="recipient-actions"><span><strong>{selectedIds.size}</strong> selected · maximum 50 per batch</span><div><Button size="sm" variant="outline" onClick={selectFiltered} disabled={filteredContacts.length === 0}>Select filtered ({filteredContacts.length})</Button><Button size="sm" variant="ghost" onClick={() => setSelectedIds(new Set())} disabled={selectedIds.size === 0}>Clear</Button></div></div>
          <div className="recipient-picker-grid">
            <section><header><strong>Matching contacts</strong><span>{filteredContacts.length > 200 ? "First 200 shown" : `${filteredContacts.length} shown`}</span></header><div className="recipient-scroll">{filteredContacts.slice(0, 200).map((contact) => { const selected = selectedIds.has(contact.id); return <label className={selected ? "selected" : ""} key={contact.id}><input type="checkbox" checked={selected} onChange={() => toggleRecipient(contact.id)} /><span className="recipient-checkbox">{selected && <Check />}</span><span className="recipient-copy"><strong>{contact.name}</strong><small>{[contact.role, contact.organization].filter(Boolean).join(" · ") || "No organization details"}</small></span></label>; })}</div></section>
            <section><header><strong>Included recipients</strong><span>Review history or exclude</span></header><div className="recipient-scroll selected-list">{selectedContacts.length ? selectedContacts.map((contact) => <div key={contact.id}><span className="recipient-copy"><strong>{contact.name}</strong><small>{contact.interaction_type || "Address form unrecorded"}</small></span><Button size="icon" variant="ghost" onClick={() => setHistoryContact(contact)} aria-label={`Message history for ${contact.name}`}><History /></Button><Button size="icon" variant="ghost" onClick={() => toggleRecipient(contact.id)} aria-label={`Exclude ${contact.name}`}><X /></Button></div>) : <div className="recipient-empty"><UsersRound /><span>Select contacts from search results or a tag.</span></div>}</div></section>
          </div>
        </> : <>
          <div className="generated-message-summary"><div><Languages /><span><strong>{messages.length} individual messages</strong><small>{language} · nothing has been sent</small></span></div><Button size="sm" variant="outline" onClick={() => setShowPicker(true)}>Edit recipients</Button></div>
          <div className="personal-message-results">{messages.map((message) => { const contact = contacts.find((item) => item.id === message.contact_id); if (!contact) return null; return <article key={message.sequence}>
            <header><div><strong>{contact.name}</strong><small>{contact.interaction_type || "Address form unrecorded"}</small></div><div className="message-card-actions"><Button size="sm" variant="outline" onClick={() => setHistoryContact(contact)}><History />History</Button><Button size="sm" variant="outline" onClick={() => void regenerateMessage(message)} disabled={regeneratingId === message.sequence}><RefreshCw className={regeneratingId === message.sequence ? "animate-spin" : ""} />{regeneratingId === message.sequence ? "Regenerating…" : "Regenerate"}</Button><Button size="sm" variant="outline" onClick={() => void saveMessage(message)} disabled={!dirtyIds.has(message.sequence) || savingId === message.sequence}><Save />{savingId === message.sequence ? "Saving…" : dirtyIds.has(message.sequence) ? "Save edit" : "Saved"}</Button><Button size="sm" variant="outline" onClick={() => void copy(message)}><Copy />{copied === message.sequence ? "Copied" : "Copy"}</Button></div></header>
            <div className="message-contact-details"><span><Mail />{(contact.emails ?? []).map((item) => item.address).filter(Boolean).join(", ") || "Email not recorded"}</span><span><Phone />{(contact.phones ?? []).map((item) => item.number).filter(Boolean).join(", ") || "Phone not recorded"}</span></div>
            <label className="message-edit-label"><span>Editable draft{dirtyIds.has(message.sequence) ? " · unsaved changes" : ""}</span><Textarea value={message.content} onChange={(event) => editMessage(message, event.target.value)} aria-label={`Message for ${contact.name}`} /></label>
          </article>; })}</div>
        </>}
      </div>
      <DialogFooter className="shrink-0 border-t px-5 py-4"><Button variant="outline" onClick={() => onOpenChange(false)} disabled={generating}>Close</Button>{showPicker && <Button onClick={() => void generate()} disabled={generating || !holiday || !serverConfigured || selectedIds.size === 0}><Sparkles />{generating ? `Generating ${selectedIds.size}…` : `Generate ${selectedIds.size || ""} message${selectedIds.size === 1 ? "" : "s"}`}</Button>}</DialogFooter>
    </DialogContent>
  </Dialog><Dialog open={historyContact !== null} onOpenChange={(next) => { if (!next) setHistoryContact(null); }}><DialogContent className="flex max-h-[calc(100dvh-1rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl"><DialogHeader className="shrink-0 border-b px-5 py-5 pr-12"><DialogTitle>{historyContact?.name} · message history</DialogTitle><DialogDescription>All generated drafts and messages manually marked as sent for this contact.</DialogDescription></DialogHeader><div className="contact-history-dialog-body">{historyContact && <ContactMessageHistory contactId={historyContact.id} contactName={historyContact.name} refreshKey={messages.length} />}</div><DialogFooter className="shrink-0 border-t px-5 py-4"><Button variant="outline" onClick={() => setHistoryContact(null)}>Close</Button></DialogFooter></DialogContent></Dialog></>;
}

function MessageHistory({ open, onOpenChange, contacts, serverConfigured }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contacts: Recipient[];
  serverConfigured: boolean;
}) {
  const { can } = useAuth();
  const [messages, setMessages] = useState<GeneratedMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [dirtyIds, setDirtyIds] = useState<Set<number>>(() => new Set());
  const [workingId, setWorkingId] = useState<number | null>(null);
  const [copied, setCopied] = useState<number | null>(null);

  useEffect(() => {
    if (!open) return;
    let active = true;
    queueMicrotask(() => { if (active) setLoading(true); });
    fetch("/api/holiday-messages")
      .then(async (response) => {
        const body = await response.json().catch(() => ({})) as { messages?: GeneratedMessage[]; error?: string };
        if (!response.ok) throw new Error(body.error ?? "Message history could not be loaded");
        if (active) { setMessages(body.messages ?? []); setDirtyIds(new Set()); }
      })
      .catch((error) => toast.error(error instanceof Error ? error.message : "Message history could not be loaded"))
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [open]);

  const filteredMessages = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return messages;
    return messages.filter((message) => `${message.contact_name ?? ""} ${message.holiday_title ?? ""} ${message.language} ${message.content}`.toLocaleLowerCase().includes(needle));
  }, [messages, query]);
  const editMessage = (message: GeneratedMessage, content: string) => {
    setMessages((current) => current.map((item) => item.sequence === message.sequence ? { ...item, content } : item));
    setDirtyIds((current) => new Set(current).add(message.sequence));
  };
  const saveMessage = async (message: GeneratedMessage) => {
    setWorkingId(message.sequence);
    try {
      const response = await fetch(`/api/holiday-messages/${message.sequence}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ content: message.content }) });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Draft could not be saved");
      setDirtyIds((current) => { const next = new Set(current); next.delete(message.sequence); return next; });
      toast.success("Draft saved");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Draft could not be saved");
    } finally {
      setWorkingId(null);
    }
  };
  const regenerateMessage = async (message: GeneratedMessage) => {
    setWorkingId(message.sequence);
    try {
      const response = await fetch("/api/holidays/regenerate-message", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ holiday_id: message.holiday_id, language: message.language, contact_id: message.contact_id }) });
      const body = await response.json().catch(() => ({})) as { message?: GeneratedMessage; error?: string };
      if (!response.ok || !body.message) throw new Error(body.error ?? "Message could not be regenerated");
      setMessages((current) => [body.message!, ...current]);
      toast.success(`A new draft was added for ${body.message.contact_name}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Message could not be regenerated");
    } finally {
      setWorkingId(null);
    }
  };
  const toggleSent = async (message: GeneratedMessage) => {
    const status = message.status === "sent" ? "generated" : "sent";
    setWorkingId(message.sequence);
    try {
      const response = await fetch(`/api/holiday-messages/${message.sequence}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ status }) });
      const body = await response.json().catch(() => ({})) as { status?: "generated" | "sent"; sent_at?: string | null; error?: string };
      if (!response.ok || !body.status) throw new Error(body.error ?? "Message status could not be changed");
      setMessages((current) => current.map((item) => item.sequence === message.sequence ? { ...item, status: body.status!, sent_at: body.sent_at ?? null } : item));
      toast.success(body.status === "sent" ? "Message marked as sent" : "Message returned to generated drafts");
    } catch (error) { toast.error(error instanceof Error ? error.message : "Message status could not be changed"); }
    finally { setWorkingId(null); }
  };
  const deleteMessage = async (message: GeneratedMessage) => {
    if (!window.confirm(`Delete this saved message for ${message.contact_name || "this contact"}?`)) return;
    setWorkingId(message.sequence);
    try {
      const response = await fetch(`/api/holiday-messages/${message.sequence}`, { method: "DELETE" });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Message could not be deleted");
      setMessages((current) => current.filter((item) => item.sequence !== message.sequence));
      setDirtyIds((current) => { const next = new Set(current); next.delete(message.sequence); return next; });
      toast.success("Saved message deleted");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Message could not be deleted");
    } finally {
      setWorkingId(null);
    }
  };
  const copyMessage = async (message: GeneratedMessage) => {
    await navigator.clipboard.writeText(message.content);
    setCopied(message.sequence);
    setTimeout(() => setCopied(null), 1500);
  };

  return <Dialog open={open} onOpenChange={(next) => { if (workingId === null) onOpenChange(next); }}>
    <DialogContent className="message-history-dialog flex max-h-[calc(100dvh-1rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-5xl">
      <DialogHeader className="shrink-0 border-b px-5 py-5 pr-12">
        <DialogTitle>Generated message history</DialogTitle>
        <DialogDescription>Review every generated version, including messages you manually marked as sent.</DialogDescription>
      </DialogHeader>
      <div className="message-history-body">
        <div className="message-history-toolbar"><div className="recipient-search"><Search /><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search contact, holiday, language, or message…" /></div><span>{filteredMessages.length} of {messages.length} messages</span></div>
        {loading ? <div className="message-history-loading">Loading saved messages…</div> : filteredMessages.length ? <div className="personal-message-results history-results">{filteredMessages.map((message) => {
          const contact = contacts.find((item) => item.id === message.contact_id);
          return <article key={message.sequence}>
            <header><div><strong>{message.contact_name || contact?.name || "Deleted contact"} <span className={`message-status ${message.status}`}>{message.status === "sent" ? "Sent" : "Generated"}</span></strong><small>{message.holiday_title || message.holiday_id} · {message.language} · {message.created_at?.replace("T", " ")}</small></div><div className="message-card-actions">{can("drafts.manage") && <><Button size="sm" variant="outline" onClick={() => void toggleSent(message)} disabled={workingId === message.sequence}>{message.status === "sent" ? <Undo2 /> : <Send />}{message.status === "sent" ? "Mark unsent" : "Mark sent"}</Button><Button size="sm" variant="outline" onClick={() => void regenerateMessage(message)} disabled={!serverConfigured || workingId === message.sequence}><RefreshCw className={workingId === message.sequence ? "animate-spin" : ""} />Regenerate</Button><Button size="sm" variant="outline" onClick={() => void saveMessage(message)} disabled={!dirtyIds.has(message.sequence) || workingId === message.sequence}><Save />{dirtyIds.has(message.sequence) ? "Save edit" : "Saved"}</Button></>}<Button size="sm" variant="outline" onClick={() => void copyMessage(message)}><Copy />{copied === message.sequence ? "Copied" : "Copy"}</Button>{can("drafts.manage") && <Button size="sm" variant="outline" className="message-delete-button" onClick={() => void deleteMessage(message)} disabled={workingId === message.sequence}><Trash2 />Delete</Button>}</div></header>
            <div className="message-contact-details"><span><Mail />{(contact?.emails ?? []).map((item) => item.address).filter(Boolean).join(", ") || "Email not recorded"}</span><span><Phone />{(contact?.phones ?? []).map((item) => item.number).filter(Boolean).join(", ") || "Phone not recorded"}</span></div>
            <label className="message-edit-label"><span>Saved draft{dirtyIds.has(message.sequence) ? " · unsaved changes" : ""}</span><Textarea readOnly={!can("drafts.manage")} value={message.content} onChange={(event) => editMessage(message, event.target.value)} aria-label={`Saved message for ${message.contact_name || contact?.name || "contact"}`} /></label>
          </article>;
        })}</div> : <div className="message-history-empty"><History /><strong>No saved messages found</strong><span>{query ? "Try a different search." : "Generated messages will appear here automatically."}</span></div>}
      </div>
      <DialogFooter className="shrink-0 border-t px-5 py-4"><Button variant="outline" onClick={() => onOpenChange(false)} disabled={workingId !== null}>Close</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}

export function HolidayModule({ contacts, onOpenSettings, openHolidayId, onHolidayOpened }: { contacts: Recipient[]; onOpenSettings: () => void; openHolidayId?: string | null; onHolidayOpened?: () => void }) {
  const { can } = useAuth();
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [month, setMonth] = useState<Date>(new Date());
  const [selectedHoliday, setSelectedHoliday] = useState<Holiday | null>(null);
  const [generatorOpen, setGeneratorOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [serverConfigured, setServerConfigured] = useState(false);
  const [model, setModel] = useState("");
  const [holidayQuery, setHolidayQuery] = useState("");

  useEffect(() => {
    Promise.all([
      fetch("/api/holidays").then((response) => { if (!response.ok) throw new Error(); return response.json() as Promise<{ holidays: Holiday[] }>; }),
      can("drafts.manage") ? fetch("/api/ai-availability").then((response) => response.json() as Promise<{ configured: boolean; model: string }>) : Promise.resolve({ configured: false, model: "" }),
    ]).then(([holidayBody, status]) => { setHolidays(holidayBody.holidays); setServerConfigured(status.configured); setModel(status.model); setLoading(false); }).catch(() => { setLoading(false); toast.error("Holiday calendar could not be loaded"); });
  }, []);
  useEffect(() => {
    const refresh = () => { void fetch("/api/holidays").then((response) => response.json() as Promise<{ holidays?: Holiday[] }>).then((body) => setHolidays(body.holidays ?? [])).catch(() => toast.error("Holiday calendar could not refresh.")); };
    window.addEventListener("contactgraph:collection:holidays", refresh);
    return () => window.removeEventListener("contactgraph:collection:holidays", refresh);
  }, []);

  useEffect(() => {
    if (!openHolidayId || loading) return;
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      const holiday = holidays.find((item) => item.id === openHolidayId);
      if (!holiday) return;
      const date = new Date();
      date.setHours(0, 0, 0, 0);
      setSelectedDate(date);
      setMonth(date);
      setSelectedHoliday(holiday);
      if (can("drafts.manage")) setGeneratorOpen(true);
      onHolidayOpened?.();
    });
    return () => { active = false; };
  }, [holidays, loading, onHolidayOpened, openHolidayId]);

  const markedDates = useMemo(() => holidays.map((holiday) => occurrenceStart(holiday, month.getFullYear())), [holidays, month]);
  const selectedDayHolidays = useMemo(() => holidays.filter((holiday) => occursOn(holiday, selectedDate)), [holidays, selectedDate]);
  const orderedHolidays = useMemo(() => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const needle = holidayQuery.trim().toLocaleLowerCase();
    const rows = holidays
      .filter((holiday) => !needle || `${holiday.title} ${holiday.categories.join(" ")}`.toLocaleLowerCase().includes(needle))
      .map((holiday) => nextOccurrence(holiday, today));
    return {
      upcoming: rows.filter((row) => !row.past).sort((a, b) => a.date.getTime() - b.date.getTime() || a.holiday.title.localeCompare(b.holiday.title)),
      past: rows.filter((row) => row.past).sort((a, b) => b.date.getTime() - a.date.getTime() || a.holiday.title.localeCompare(b.holiday.title)),
    };
  }, [holidays, holidayQuery]);
  const openGenerator = (holiday: Holiday) => { if (!can("drafts.manage")) return; setSelectedHoliday(holiday); setGeneratorOpen(true); };
  const selectHoliday = (holiday: Holiday, date: Date) => { setSelectedHoliday(holiday); setSelectedDate(date); setMonth(date); };

  return <div className="holiday-module">
    <div className="module-heading"><div><p className="eyebrow">Content calendar</p><h1 className="module-title">Holidays</h1><p className="module-subtitle">Choose an occasion and prepare a separate copy-ready message for every selected contact.</p></div><div className="holiday-heading-actions"><Button variant="outline" onClick={() => setHistoryOpen(true)}><History />Message history</Button><div className="holiday-count"><CalendarDays />{holidays.length} occasions in DuckDB</div></div></div>
    <div className="holiday-layout">
      <section className="holiday-calendar-card">
        {loading ? <div className="h-80 animate-pulse rounded-xl bg-[#edf3f5]" /> : <Calendar mode="single" selected={selectedDate} onSelect={(date) => date && setSelectedDate(date)} month={month} onMonthChange={setMonth} modifiers={{ holiday: markedDates }} modifiersClassNames={{ holiday: "holiday-calendar-day" }} className="w-full" />}
        <div className="holiday-calendar-legend"><span><i />Holiday or observance</span><small>Asia/Baku · annual events repeat by month and day</small></div>
      </section>
      <section className="holiday-day-panel">
        <header><div><span>{selectedDate.toLocaleDateString("en", { weekday: "long" })}</span><strong>{selectedDate.toLocaleDateString("en", { day: "numeric", month: "long", year: "numeric" })}</strong></div><small>{selectedDayHolidays.length} occasion{selectedDayHolidays.length === 1 ? "" : "s"}</small></header>
        {selectedDayHolidays.length ? <div className="holiday-cards">{selectedDayHolidays.map((holiday) => <article key={holiday.id}><div className="holiday-card-top"><div className="holiday-category-list">{holiday.categories.map((category) => <span key={category}>{category.replaceAll("_", " ")}</span>)}</div><span className={`holiday-verification ${holiday.verification.toLowerCase()}`}>{holiday.verification}</span></div><h2>{holiday.title}</h2><div className="holiday-meta"><span>{holiday.statutory_day_off ? "Statutory day off" : "Working day / observance"}</span>{holiday.templates && Object.keys(holiday.templates).length > 0 && <span>Approved wording available</span>}</div>{can("drafts.manage") && <Button onClick={() => openGenerator(holiday)}><Sparkles />Prepare messages</Button>}</article>)}</div> : <div className="holiday-empty"><CalendarDays /><strong>No occasion on this date</strong><span>Choose a marked day or browse the upcoming list below.</span></div>}
      </section>
    </div>
    <section className="holiday-month-list">
      <header><div><strong>Upcoming holidays and observances</strong><small>Nearest occasion first</small></div><span>{orderedHolidays.upcoming.length} upcoming</span></header>
      <div className="holiday-list-search"><Search /><Input value={holidayQuery} onChange={(event) => setHolidayQuery(event.target.value)} placeholder="Find a holiday" aria-label="Find a holiday" /></div>
      <div className="holiday-list-rows">{orderedHolidays.upcoming.map(({ holiday, date }) => <article className={selectedHoliday?.id === holiday.id ? "selected" : ""} key={holiday.id}>
        <button className="holiday-list-main" onClick={() => selectHoliday(holiday, date)}>
          <time><b>{date.toLocaleDateString("en", { month: "short" })}</b>{String(date.getDate()).padStart(2, "0")}</time>
          <span><strong>{holiday.title}</strong><small>{date.toLocaleDateString("en", { weekday: "short", year: "numeric" })} · {holiday.categories.map((item) => item.replaceAll("_", " ")).join(" · ")}</small></span>
        </button>
        {can("drafts.manage") && <Button size="sm" variant="outline" onClick={() => openGenerator(holiday)}><Sparkles />Generate</Button>}
      </article>)}</div>
      {orderedHolidays.past.length > 0 && <><div className="holiday-list-divider"><span>Past one-off dates</span><small>{orderedHolidays.past.length}</small></div><div className="holiday-list-rows past">{orderedHolidays.past.map(({ holiday, date }) => <article key={holiday.id}>
        <button className="holiday-list-main" onClick={() => selectHoliday(holiday, date)}><time><b>{date.toLocaleDateString("en", { month: "short" })}</b>{String(date.getDate()).padStart(2, "0")}</time><span><strong>{holiday.title}</strong><small>{date.toLocaleDateString("en", { year: "numeric" })} · {holiday.categories.map((item) => item.replaceAll("_", " ")).join(" · ")}</small></span></button>
        {can("drafts.manage") && <Button size="sm" variant="outline" onClick={() => openGenerator(holiday)}><Sparkles />Generate</Button>}
      </article>)}</div></>}
      {!loading && orderedHolidays.upcoming.length === 0 && orderedHolidays.past.length === 0 && <div className="holiday-list-none">No holidays match “{holidayQuery}”.</div>}
    </section>
    <MessageGenerator key={selectedHoliday?.id ?? "no-holiday"} holiday={selectedHoliday} contacts={contacts} open={generatorOpen} onOpenChange={setGeneratorOpen} serverConfigured={serverConfigured} model={model} onOpenSettings={onOpenSettings} />
    <MessageHistory open={historyOpen} onOpenChange={setHistoryOpen} contacts={contacts} serverConfigured={serverConfigured} />
  </div>;
}
