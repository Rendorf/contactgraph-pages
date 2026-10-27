"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bell, CalendarDays, Check, CheckSquare2, ChevronDown, ContactRound, Copy, Edit3, GitMerge, LayoutDashboard, Mail, MapPin, Menu, Network,
  Phone, Plus, Search, Settings2, Tag, Trash2, UserRound, X, Radar,
} from "lucide-react";
import { toast } from "sonner";
import { ContactGraph } from "./contact-graph";
import { HolidayModule } from "./holiday-module";
import { CanvaModule } from "./canva-module";
import { AccountSettingsModule, SettingsModule } from "./settings-module";
import { AccountsModule } from "./accounts-module";
import { useAuth } from "./auth-context";
import { ContactMessageHistory } from "./contact-message-history";
import { ContactOsintHistory } from "./contact-osint-history";
import { BirthdayMessageComposer, NotificationsModule } from "./birthday-module";
import { DuplicatesModule } from "./duplicates-module";
import { ContactMeetingHistory, MeetingsModule } from "./meetings-module";
import { FollowupsModule } from "./followups-module";
import { ContactFollowupReminders } from "./contact-followup-reminders";
import { OfflineStatus } from "./offline-status";
import { OsintModule } from "./osint-module";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";

type Module = "contacts" | "graph" | "holidays" | "notifications" | "duplicates" | "meetings" | "followups" | "canva" | "osint" | "settings" | "accounts" | "account";
const MODULE_PERMISSIONS: Partial<Record<Module, string>> = {
  graph: "graph.view", holidays: "holidays.view", notifications: "drafts.view",
  duplicates: "duplicates.view", meetings: "meetings.view", followups: "followups.view",
  canva: "canvases.view", osint: "osint.view", settings: "settings.manage", accounts: "users.manage",
};
type SettingsSection = "settings" | "accounts" | "account";
type BulkAction = "add-tag" | "remove-tag" | "delete";
type Contact = Record<string, unknown> & {
  id: string;
  name: string;
  nickname?: string;
  organization?: string;
  role?: string;
  photo_file?: string;
  photo_url?: string;
  positions?: Array<{ id: string; title: string; organization: string; period: string; source_url: string; confirmed_at: string }>;
  department?: string;
  category?: string;
  birthday?: string;
  notes?: string;
  relationship_status?: string;
  follow_up?: string;
  interaction_type?: string;
  labels?: string[];
  emails?: Array<{ label?: string; address?: string }>;
  phones?: Array<{ label?: string; number?: string }>;
  locations?: string[];
};

const textFields = [
  ["name", "Full name"], ["nickname", "Nickname"], ["organization", "Organization"],
  ["role", "Role"], ["department", "Department"], ["category", "Category"],
  ["interaction_type", "Interaction type"], ["relationship_status", "Relationship status"], ["follow_up", "Follow-up notes"],
] as const;
const mergeTextFields = [...textFields, ["notes", "Notes"], ["photo_file", "Photo file"]] as const;
const mergeListFields = ["industries", "topics", "events", "interests", "locations", "groups", "labels", "emails", "phones", "websites", "socials", "addresses", "sources", "positions"] as const;

const normalize = (value: unknown) => String(value ?? "").toLocaleLowerCase();
const initials = (name: string) => {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "?") + (parts.length > 1 ? parts.at(-1)?.[0] ?? "" : "")).toUpperCase();
};
const contactInitial = (name: string) => {
  const firstCharacter = Array.from(name.trim())[0]?.toLocaleUpperCase("az") ?? "#";
  return /^\p{L}$/u.test(firstCharacter) ? firstCharacter : "#";
};
const birthdayMonthDay = (birthday: unknown) => {
  const value = String(birthday ?? "");
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value.slice(5) : /^--\d{2}-\d{2}$/.test(value) ? value.slice(2) : null;
};
const validBirthday = (birthday: string) => {
  if (!birthday) return true;
  const full = /^(\d{4})-(\d{2})-(\d{2})$/.exec(birthday);
  const partial = /^--(\d{2})-(\d{2})$/.exec(birthday);
  if (!full && !partial) return false;
  const year = full ? Number(full[1]) : 2024;
  const month = Number(full ? full[2] : partial![1]);
  const day = Number(full ? full[3] : partial![2]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() + 1 === month && parsed.getUTCDate() === day;
};
const contactSearchText = (contact: Contact) => normalize([
  contact.name, contact.nickname, contact.organization, contact.role, contact.category, contact.interaction_type,
  ...(contact.labels ?? []), ...(contact.emails ?? []).map((item) => item.address),
  ...(contact.phones ?? []).map((item) => item.number),
].join(" "));
const contactJson = (contact: Contact) => {
  const { photo_url: _photoUrl, ...fields } = contact;
  return JSON.stringify(fields, null, 2);
};

const mergeContactDraft = (contacts: Contact[], targetId: string): Contact => {
  const base = structuredClone(contacts.find((contact) => contact.id === targetId) ?? contacts[0]);
  mergeListFields.forEach((field) => {
    const values = contacts.flatMap((contact) => Array.isArray(contact[field]) ? contact[field] as unknown[] : []);
    const seen = new Set<string>();
    (base as Record<string, unknown>)[field] = values.filter((value) => {
      const key = JSON.stringify(value);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  });
  base.id = targetId;
  return base;
};

function ContactEditor({ contact, contacts, tagSuggestions, organizationSuggestions, open, onOpenChange, onSave, onDelete, onMerge, isNew = false }: {
  contact: Contact | null;
  contacts: Contact[];
  tagSuggestions: string[];
  organizationSuggestions: string[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (contact: Contact) => Promise<void>;
  onDelete: (contact: Contact) => Promise<void>;
  onMerge: (contact: Contact) => void;
  isNew?: boolean;
}) {
  const { can, offline } = useAuth();
  const [draft, setDraft] = useState<Contact | null>(() => contact ? structuredClone(contact) : null);
  const [birthdayMode, setBirthdayMode] = useState<"full" | "month-day">(() => String(contact?.birthday ?? "").startsWith("--") ? "month-day" : "full");
  const [newTag, setNewTag] = useState("");
  const [rawJson, setRawJson] = useState(() => contact ? contactJson(contact) : "");
  const [rawError, setRawError] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [messageHistoryVersion, setMessageHistoryVersion] = useState(0);

  const update = (field: string, value: unknown) => setDraft((current) => {
    if (!current) return current;
    const next = { ...current, [field]: value } as Contact;
    setRawJson(contactJson(next));
    return next;
  });
  const addTag = () => {
    const tag = newTag.trim();
    if (!draft || !tag || (draft.labels ?? []).includes(tag)) return;
    update("labels", [...(draft.labels ?? []), tag]);
    setNewTag("");
  };
  const applyRawJson = () => {
    try {
      const parsed = JSON.parse(rawJson) as Contact;
      if (!parsed || typeof parsed !== "object" || !parsed.id || !parsed.name) throw new Error("Contact JSON must include id and name.");
      if (parsed.id !== contact?.id) throw new Error("A contact id cannot be changed.");
      setDraft({ ...parsed, photo_url: draft?.photo_url });
      setBirthdayMode(String(parsed.birthday ?? "").startsWith("--") ? "month-day" : "full");
      setRawError("");
      toast.success("JSON applied to the form");
    } catch (error) {
      setRawError(error instanceof Error ? error.message : "Invalid JSON");
    }
  };
  const save = async () => {
    if (!draft) return;
    if (!validBirthday(String(draft.birthday ?? ""))) return toast.error("Enter a valid birthday as YYYY-MM-DD or MM-DD without a year.");
    setSaving(true);
    try {
      await onSave(draft);
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };
  const remove = async () => {
    if (!contact) return;
    setDeleting(true);
    try {
      await onDelete(contact);
      setDeleteOpen(false);
      onOpenChange(false);
    } finally {
      setDeleting(false);
    }
  };

  return <>
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full gap-0 overflow-hidden border-l-[#dce6ec] bg-[#f8fbfc] p-0 sm:max-w-2xl">
        <SheetHeader className="border-b border-[#dce6ec] bg-white px-5 py-5 pr-14">
          <SheetTitle className="text-xl tracking-[-0.02em]">{isNew ? "Add contact" : "Edit contact"}</SheetTitle>
          <SheetDescription>{isNew ? "Enter the contact’s details, then save them to your database." : "Update any field, tags, or notes."}</SheetDescription>
        </SheetHeader>
        {draft && <div className="flex-1 overflow-y-auto px-5 py-6 sm:px-7">
          <div className="mb-7 flex items-center gap-4">
            <div className="grid size-14 shrink-0 place-items-center overflow-hidden rounded-2xl bg-[#172f3d] text-base font-bold text-white">{draft.photo_file ? <img className="size-full object-cover" src={draft.photo_url || `/api/contacts/${encodeURIComponent(draft.id)}/photo?v=${encodeURIComponent(draft.photo_file)}`} alt="" /> : initials(draft.name)}</div>
            <div className="min-w-0"><p className="truncate text-lg font-semibold">{draft.name || "Unnamed contact"}</p><p className="truncate text-sm text-[#647985]">{draft.organization || "No organization"}</p></div>
          </div>
          {!offline && !isNew && can("contacts.merge") && <Button type="button" variant="outline" className="mb-5 w-full bg-white" onClick={() => onMerge(draft)}><GitMerge />Merge with another contact</Button>}
          <div className="editor-contact-methods">
            {draft.emails?.find((item) => item.address)?.address ? <a href={`mailto:${draft.emails.find((item) => item.address)?.address}`}><Mail /><span><small>Primary email</small><strong>{draft.emails.find((item) => item.address)?.address}</strong></span></a> : <div className="missing"><Mail /><span><small>Primary email</small><strong>Not recorded</strong></span></div>}
            {draft.phones?.find((item) => item.number)?.number ? <a href={`tel:${draft.phones.find((item) => item.number)?.number}`}><Phone /><span><small>Primary phone</small><strong>{draft.phones.find((item) => item.number)?.number}</strong></span></a> : <div className="missing"><Phone /><span><small>Primary phone</small><strong>Not recorded</strong></span></div>}
          </div>
          {!isNew && can("followups.view") && <section className="editor-section"><div className="contact-history-heading"><h3>Follow-up reminders</h3><span>Choose when this contact should appear in Follow-ups</span></div><ContactFollowupReminders contactId={draft.id} /></section>}
          {!isNew && can("meetings.view") && <section className="editor-section"><div className="contact-history-heading"><h3>Meeting notes</h3><span>Add a dated note or review past meetings</span></div><ContactMeetingHistory contactId={draft.id} contacts={contacts} /></section>}
          {!offline && !isNew && can("osint.view") && <ContactOsintHistory contactId={draft.id} open={open} />}
          {!isNew && (draft.positions?.length ?? 0) > 0 && <section className="editor-section"><h3>Confirmed position history</h3><div className="mt-3 space-y-3">{draft.positions?.map(position => <div key={position.id} className="rounded-lg border bg-white p-3 text-sm"><strong>{position.title}</strong><span className="ml-2 text-[#647985]">{position.organization}</span><small className="mt-1 block text-[#71858f]">{position.period} · confirmed {new Date(position.confirmed_at).toLocaleDateString()}</small><a className="mt-1 block text-[#12646a] underline" href={position.source_url} target="_blank" rel="noopener noreferrer">Source</a></div>)}</div></section>}
          {(can("contacts.edit") || (isNew && can("contacts.create"))) && <section className="editor-section">
            <h3>Email addresses &amp; phone numbers</h3>
            <div className="grid gap-5 sm:grid-cols-2">
              <div className="space-y-2">
                <span className="editor-field-label">Email addresses</span>
                {(draft.emails ?? []).map((email, index) => <div className="editor-value-row" key={`email-${index}`}>
                  <Input aria-label={`Email ${index + 1} label`} className="label-input" value={email.label ?? ""} onChange={(event) => update("emails", (draft.emails ?? []).map((item, itemIndex) => itemIndex === index ? { ...item, label: event.target.value } : item))} placeholder="Label" />
                  <Input aria-label={`Email ${index + 1}`} type="email" value={email.address ?? ""} onChange={(event) => update("emails", (draft.emails ?? []).map((item, itemIndex) => itemIndex === index ? { ...item, address: event.target.value } : item))} placeholder="name@example.com" />
                  <Button type="button" size="icon" variant="ghost" onClick={() => update("emails", (draft.emails ?? []).filter((_, itemIndex) => itemIndex !== index))} aria-label={`Remove email ${index + 1}`}><X /></Button>
                </div>)}
                <Button type="button" size="sm" variant="outline" onClick={() => update("emails", [...(draft.emails ?? []), { label: "", address: "" }])}><Plus />Add email</Button>
              </div>
              <div className="space-y-2">
                <span className="editor-field-label">Phone numbers</span>
                {(draft.phones ?? []).map((phone, index) => <div className="editor-value-row" key={`phone-${index}`}>
                  <Input aria-label={`Phone ${index + 1} label`} className="label-input" value={phone.label ?? ""} onChange={(event) => update("phones", (draft.phones ?? []).map((item, itemIndex) => itemIndex === index ? { ...item, label: event.target.value } : item))} placeholder="Label" />
                  <Input aria-label={`Phone ${index + 1}`} type="tel" value={phone.number ?? ""} onChange={(event) => update("phones", (draft.phones ?? []).map((item, itemIndex) => itemIndex === index ? { ...item, number: event.target.value } : item))} placeholder="Phone number" />
                  <Button type="button" size="icon" variant="ghost" onClick={() => update("phones", (draft.phones ?? []).filter((_, itemIndex) => itemIndex !== index))} aria-label={`Remove phone ${index + 1}`}><X /></Button>
                </div>)}
                <Button type="button" size="sm" variant="outline" onClick={() => update("phones", [...(draft.phones ?? []), { label: "", number: "" }])}><Plus />Add phone</Button>
              </div>
            </div>
          </section>}
          {(can("contacts.edit") || (isNew && can("contacts.create"))) && <section className="editor-section">
            <h3>Contact details</h3>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2"><span className="editor-field-label">Birthday</span><div className="flex gap-1" role="group" aria-label="Birthday date format"><Button type="button" size="sm" variant={birthdayMode === "full" ? "default" : "outline"} onClick={() => setBirthdayMode("full")}>Full date</Button><Button type="button" size="sm" variant={birthdayMode === "month-day" ? "default" : "outline"} onClick={() => { setBirthdayMode("month-day"); if (/^\d{4}-\d{2}-\d{2}$/.test(String(draft.birthday ?? ""))) update("birthday", `--${String(draft.birthday).slice(5)}`); }}>Month/day only</Button></div></div>
                {birthdayMode === "month-day" ? <Input aria-label="Birthday month and day" inputMode="numeric" placeholder="MM-DD" maxLength={5} value={String(draft.birthday ?? "").startsWith("--") ? String(draft.birthday).slice(2) : ""} onChange={(event) => update("birthday", event.target.value ? `--${event.target.value}` : "")} /> : <Input aria-label="Birthday full date" type="date" value={/^\d{4}-\d{2}-\d{2}$/.test(String(draft.birthday ?? "")) ? String(draft.birthday) : ""} onChange={(event) => update("birthday", event.target.value)} />}
                <small className="mt-1 block text-xs text-[#71858f]">{birthdayMode === "month-day" ? "The birth year is unknown; enter MM-DD." : String(draft.birthday ?? "").startsWith("--") ? "The saved month and day remain until you choose a full date." : "Choose a full date, or switch to month/day if the year is unknown."}</small>
              </div>
              {textFields.map(([field, label]) => <label className={field === "name" ? "sm:col-span-2" : ""} key={field}><span>{label}</span><Input list={field === "interaction_type" ? "interaction-type-options" : field === "organization" ? "contact-organization-options" : undefined} placeholder={field === "interaction_type" ? "e.g. Siz, Sən, Mr., Prof." : field === "organization" ? "Choose an existing organization or type a new one" : undefined} value={String(draft[field] ?? "")} onChange={(event) => update(field, event.target.value)} /></label>)}
            </div>
            <datalist id="interaction-type-options"><option value="Siz" /><option value="Sən" /><option value="Mr." /><option value="Prof." /></datalist>
            <datalist id="contact-organization-options">{organizationSuggestions.map((organization) => <option key={organization} value={organization} />)}</datalist>
          </section>}
          {!isNew && can("drafts.manage") && <section className="editor-section"><BirthdayMessageComposer contact={draft} onUpdated={() => setMessageHistoryVersion((version) => version + 1)} /></section>}
          <section className="editor-section">
            <div className="mb-3 flex items-center justify-between gap-3"><h3 className="mb-0">Tags</h3><span className="text-xs text-[#71858f]">{(draft.labels ?? []).length} tags</span></div>
            <div className="mb-3 flex flex-wrap gap-2">{(draft.labels ?? []).length ? (draft.labels ?? []).map((label) => can("tags.edit") ? <button key={label} className="tag-pill" onClick={() => update("labels", (draft.labels ?? []).filter((item) => item !== label))} aria-label={`Remove ${label} tag`}>{label}<X className="size-3.5" /></button> : <span key={label} className="tag-pill">{label}</span>) : <p className="text-sm text-[#71858f]">No tags yet.</p>}</div>
            {can("tags.edit") && <div className="flex gap-2"><Input list="contact-tag-options" value={newTag} onChange={(event) => setNewTag(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addTag(); } }} placeholder="Add or choose a tag" aria-label="New tag" /><Button type="button" variant="outline" onClick={addTag}><Plus />Add</Button></div>}
            <datalist id="contact-tag-options">{tagSuggestions.filter((tag) => !(draft.labels ?? []).includes(tag)).map((tag) => <option key={tag} value={tag} />)}</datalist>
          </section>
          {(can("contacts.edit") || (isNew && can("contacts.create"))) && <section className="editor-section"><h3>Notes</h3><Textarea className="min-h-28" value={String(draft.notes ?? "")} onChange={(event) => update("notes", event.target.value)} /></section>}
          {!isNew && can("drafts.view") && <section className="editor-section"><div className="contact-history-heading"><h3>Message history</h3><span>Generated and manually marked as sent</span></div><ContactMessageHistory contactId={draft.id} contactName={draft.name} refreshKey={messageHistoryVersion} /></section>}
          {can("contacts.edit") && <section className="editor-section">
            <button className="flex w-full items-center justify-between text-left" onClick={() => setShowAdvanced((value) => !value)}>
              <span><strong className="block text-sm text-[#17384a]">All fields</strong><span className="text-xs text-[#71858f]">Edit the complete contact record as JSON</span></span>
              <ChevronDown className={`size-5 transition-transform ${showAdvanced ? "rotate-180" : ""}`} />
            </button>
            {showAdvanced && <div className="mt-4"><Textarea className="min-h-80 font-mono text-xs leading-relaxed" spellCheck={false} value={rawJson} onChange={(event) => setRawJson(event.target.value)} aria-label="Complete contact JSON" />{rawError && <p className="mt-2 text-sm text-red-600">{rawError}</p>}<Button className="mt-3" type="button" variant="outline" onClick={applyRawJson}>Apply JSON</Button></div>}
          </section>}
        </div>}
        <div className="flex gap-3 border-t border-[#dce6ec] bg-white px-5 py-4 sm:px-7">
          {!isNew && can("contacts.delete") && <Button variant="outline" className="h-11 text-[#b52e3c] hover:bg-[#fff1f2] hover:text-[#a11e2c]" onClick={() => setDeleteOpen(true)} disabled={!draft || saving}><Trash2 /><span className="hidden sm:inline">Delete</span></Button>}
          {(can("contacts.edit") || can("tags.edit") || (isNew && can("contacts.create"))) && <Button className="h-11 flex-1 bg-[#172f3d] hover:bg-[#24495c]" onClick={save} disabled={!draft || !draft.name.trim() || saving}>{saving ? "Saving…" : isNew ? "Add contact" : "Save changes"}</Button>}
          <Button className="h-11" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
        </div>
      </SheetContent>
    </Sheet>
    <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
      <AlertDialogContent>
        <AlertDialogHeader><AlertDialogTitle>Delete {contact?.name}?</AlertDialogTitle><AlertDialogDescription>This removes the contact from DuckDB and all generated exports. The previous record remains in the database change history.</AlertDialogDescription></AlertDialogHeader>
        <AlertDialogFooter><AlertDialogCancel disabled={deleting}>Keep contact</AlertDialogCancel><AlertDialogAction variant="destructive" disabled={deleting} onClick={(event) => { event.preventDefault(); void remove(); }}>{deleting ? "Deleting…" : "Delete contact"}</AlertDialogAction></AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </>;
}

function ContactMergeDialog({ selectedContacts, open, onOpenChange, onMerge }: {
  selectedContacts: Contact[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onMerge: (sourceIds: string[], targetId: string, contact: Contact) => Promise<void>;
}) {
  const [targetId, setTargetId] = useState(selectedContacts[0]?.id ?? "");
  const [draft, setDraft] = useState<Contact | null>(() => selectedContacts.length ? mergeContactDraft(selectedContacts, selectedContacts[0].id) : null);
  const [rawJson, setRawJson] = useState(() => draft ? contactJson(draft) : "");
  const [rawError, setRawError] = useState("");
  const [mergeError, setMergeError] = useState("");
  const [saving, setSaving] = useState(false);

  const chooseTarget = (nextTarget: string) => {
    const next = mergeContactDraft(selectedContacts, nextTarget);
    setTargetId(nextTarget);
    setDraft(next);
    setRawJson(contactJson(next));
    setRawError("");
    setMergeError("");
  };
  const update = (field: string, value: string) => setDraft((current) => {
    if (!current) return current;
    const next = { ...current, [field]: value } as Contact;
    setRawJson(contactJson(next));
    return next;
  });
  const applyJson = () => {
    try {
      const parsed = JSON.parse(rawJson) as Contact;
      if (!parsed?.name?.trim()) throw new Error("The final contact needs a name.");
      if (parsed.id !== targetId) throw new Error("The final id must match the surviving contact.");
      setDraft(parsed);
      setRawError("");
      toast.success("Final record updated from JSON");
    } catch (error) {
      setRawError(error instanceof Error ? error.message : "Invalid JSON");
    }
  };
  const submit = async () => {
    if (selectedContacts.length < 2) return;
    let finalDraft: Contact;
    try {
      finalDraft = JSON.parse(rawJson) as Contact;
      if (!finalDraft?.name?.trim()) throw new Error("The final contact needs a name.");
      if (finalDraft.id !== targetId) throw new Error("The final id must match the surviving contact.");
      setDraft(finalDraft);
      setRawError("");
      setMergeError("");
    } catch (error) {
      setRawError(error instanceof Error ? error.message : "Invalid JSON");
      return;
    }
    setSaving(true);
    try {
      await onMerge(selectedContacts.map((contact) => contact.id), targetId, finalDraft);
      onOpenChange(false);
    } catch (error) {
      setMergeError(error instanceof Error ? error.message : "Contact merge failed");
    } finally {
      setSaving(false);
    }
  };
  const changeOpen = (nextOpen: boolean) => {
    if (saving) return;
    if (!nextOpen && selectedContacts.length) chooseTarget(selectedContacts[0].id);
    onOpenChange(nextOpen);
  };

  return <Dialog open={open} onOpenChange={changeOpen}>
    <DialogContent className="flex max-h-[92vh] flex-col overflow-hidden p-0 sm:max-w-3xl">
      <DialogHeader className="border-b px-5 py-5 pr-12">
        <DialogTitle>Merge {selectedContacts.length} contacts</DialogTitle>
        <DialogDescription>Choose the surviving record, resolve conflicting fields, and review the complete result before merging.</DialogDescription>
      </DialogHeader>
      {draft && <div className="merge-dialog-body">
        <section className="merge-survivor">
          <label><span>Surviving contact</span><NativeSelect className="w-full" value={targetId} onChange={(event) => chooseTarget(event.target.value)}>{selectedContacts.map((contact) => <NativeSelectOption key={contact.id} value={contact.id}>{contact.name}</NativeSelectOption>)}</NativeSelect></label>
          <p>The other selected records will be removed only after this final record saves successfully.</p>
        </section>
        <section className="merge-fields">
          <div className="merge-section-title"><strong>Final fields</strong><span>Fields with different source values are marked as conflicts.</span></div>
          <div className="grid gap-4 sm:grid-cols-2">{mergeTextFields.map(([field, label]) => {
            const choices = [...new Set(selectedContacts.map((contact) => String(contact[field] ?? "")).filter(Boolean))];
            const conflict = choices.length > 1;
            return <label className={`merge-field ${conflict ? "conflict" : ""} ${field === "name" || field === "notes" ? "sm:col-span-2" : ""}`} key={field}>
              <span>{label}{conflict && <em>Conflict</em>}</span>
              {field === "notes" ? <Textarea value={String(draft[field] ?? "")} onChange={(event) => update(field, event.target.value)} /> : <Input value={String(draft[field] ?? "")} onChange={(event) => update(field, event.target.value)} />}
              {conflict && <div className="merge-choices">{choices.map((choice) => <button type="button" key={choice} onClick={() => update(field, choice)} title={choice}>{choice}</button>)}</div>}
            </label>;
          })}</div>
        </section>
        <section className="merge-fields">
          <div className="merge-section-title"><strong>Combined multi-value fields</strong><span>Email, phone, tag, source, and other lists are combined without exact duplicates.</span></div>
          <div className="merge-list-summary">{mergeListFields.map((field) => <span key={field}><strong>{Array.isArray(draft[field]) ? (draft[field] as unknown[]).length : 0}</strong>{field.replaceAll("_", " ")}</span>)}</div>
        </section>
        <section className="merge-fields">
          <div className="merge-section-title"><strong>Complete final record</strong><span>Edit this JSON for full control over every field, then apply it before merging.</span></div>
          <Textarea className="min-h-56 font-mono text-xs leading-relaxed" spellCheck={false} value={rawJson} onChange={(event) => setRawJson(event.target.value)} aria-label="Final merged contact JSON" />
          {rawError && <p className="mt-2 text-sm text-red-600">{rawError}</p>}
          <Button type="button" variant="outline" size="sm" className="mt-3" onClick={applyJson}>Apply JSON</Button>
        </section>
        {mergeError && <p className="merge-error" role="alert">{mergeError}</p>}
      </div>}
      <DialogFooter className="shrink-0 border-t px-5 py-4">
        <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
        <Button onClick={() => void submit()} disabled={saving || !draft?.name?.trim()}><GitMerge />{saving ? "Merging…" : "Merge contacts"}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}

function TagMergeDialog({ tags, open, onOpenChange, onMerge }: {
  tags: string[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onMerge: (tags: string[], targetTag: string) => Promise<void>;
}) {
  const [targetTag, setTargetTag] = useState(tags[0] ?? "");
  const [saving, setSaving] = useState(false);
  const submit = async () => {
    if (!targetTag.trim()) return;
    setSaving(true);
    try { await onMerge(tags, targetTag.trim()); onOpenChange(false); } finally { setSaving(false); }
  };
  return <Dialog open={open} onOpenChange={(next) => { if (saving) return; if (!next) setTargetTag(tags[0] ?? ""); onOpenChange(next); }}>
    <DialogContent>
      <DialogHeader><DialogTitle>{tags.length === 1 ? "Rename tag" : `Merge ${tags.length} tags`}</DialogTitle><DialogDescription>Every selected tag will be replaced by the final name on all affected contacts.</DialogDescription></DialogHeader>
      <div className="merge-tag-list">{tags.map((tag) => <span key={tag}>{tag}</span>)}</div>
      <label className="merge-tag-name"><span>Final tag name</span><Input autoFocus value={targetTag} onChange={(event) => setTargetTag(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && targetTag.trim()) { event.preventDefault(); void submit(); } }} /></label>
      <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button><Button onClick={() => void submit()} disabled={saving || !targetTag.trim()}><GitMerge />{saving ? "Merging…" : tags.length === 1 ? "Rename tag" : "Merge tags"}</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}

function TagFilter({ counts, selected, query, onQueryChange, onToggle, onClear, onMerge }: {
  counts: Array<[string, number]>;
  selected: string[];
  query: string;
  onQueryChange: (value: string) => void;
  onToggle: (tag: string) => void;
  onClear: () => void;
  onMerge: () => void;
}) {
  const { can } = useAuth();
  const shown = counts.filter(([tag]) => normalize(tag).includes(normalize(query))).slice(0, 80);
  return <div className="flex min-h-0 flex-1 flex-col">
    <div className="mb-4 flex items-center justify-between"><div className="flex items-center gap-2 text-sm font-semibold"><Tag className="size-4" />Tags</div>{selected.length > 0 && <button className="text-xs font-semibold text-[#087f8c]" onClick={onClear}>Clear</button>}</div>
    <div className="relative mb-3"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#7b909b]" /><Input className="h-10 bg-white pl-9" value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="Find a tag" /></div>
    {selected.length > 0 && can("tags.merge") && <Button type="button" variant="outline" size="sm" className="mb-3 w-full bg-white" onClick={onMerge}><GitMerge />{selected.length === 1 ? "Rename selected tag" : `Merge ${selected.length} selected tags`}</Button>}
    <div className="scrollbar-thin min-h-0 flex-1 space-y-1 overflow-y-auto pr-1">{shown.map(([tag, count]) => { const active = selected.includes(tag); return <button key={tag} className={`filter-row ${active ? "active" : ""}`} onClick={() => onToggle(tag)}><span className="flex min-w-0 items-center gap-2"><span className="check-box">{active && <Check className="size-3" />}</span><span className="truncate">{tag}</span></span><span className="text-xs tabular-nums text-[#7b909b]">{count}</span></button>; })}</div>
  </div>;
}

function Navigation({ activeModule, contactCount, birthdayCount, osintAvailable, mobile = false, onSelect }: {
  activeModule: Module;
  contactCount: number;
  birthdayCount: number;
  osintAvailable: boolean;
  mobile?: boolean;
  onSelect: (module: Module) => void;
}) {
  const { can, offline } = useAuth();
  return <nav className={mobile ? "mobile-navigation" : "admin-navigation"} aria-label="Main navigation">
    <button className={activeModule === "contacts" ? "active" : ""} onClick={() => onSelect("contacts")}><ContactRound /><span>Contacts</span><small>{contactCount.toLocaleString()}</small></button>
    {can("graph.view") && <button className={activeModule === "graph" ? "active" : ""} onClick={() => onSelect("graph")}><Network /><span>Graph view</span></button>}
    {!offline && can("holidays.view") && <button className={activeModule === "holidays" ? "active" : ""} onClick={() => onSelect("holidays")}><CalendarDays /><span>Holidays</span></button>}
    {!offline && can("drafts.view") && <button className={activeModule === "notifications" ? "active" : ""} onClick={() => onSelect("notifications")}><Bell /><span>Notifications</span>{birthdayCount > 0 && <small>{birthdayCount}</small>}</button>}
    {can("duplicates.view") && <button className={activeModule === "duplicates" ? "active" : ""} onClick={() => onSelect("duplicates")}><Copy /><span>Duplication and sync errors</span></button>}
    {can("meetings.view") && <button className={activeModule === "meetings" ? "active" : ""} onClick={() => onSelect("meetings")}><CalendarDays /><span>Meetings</span></button>}
    {can("followups.view") && <button className={activeModule === "followups" ? "active" : ""} onClick={() => onSelect("followups")}><LayoutDashboard /><span>Follow-ups</span></button>}
    {!offline && can("canvases.view") && <button className={activeModule === "canva" ? "active" : ""} onClick={() => onSelect("canva")}><LayoutDashboard /><span>Canva</span></button>}
    {!offline && osintAvailable && can("osint.view") && <button className={activeModule === "osint" ? "active" : ""} onClick={() => onSelect("osint")}><Radar /><span>OSINT updates</span></button>}
    <button className={["settings", "accounts", "account"].includes(activeModule) ? "active" : ""} onClick={() => onSelect(can("settings.manage") ? "settings" : can("users.manage") ? "accounts" : "account")}><Settings2 /><span>Settings</span></button>
  </nav>;
}

function SettingsArea({ section, onSelect }: { section: SettingsSection; onSelect: (section: SettingsSection) => void }) {
  const { can, offline } = useAuth();
  return <section className="settings-module">
    <div className="module-heading"><div><p className="eyebrow">Administration</p><h1 className="module-title">Settings</h1><p className="module-subtitle">Manage your account, integrations, users, and access roles.</p></div></div>
    <div className="settings-tabs" role="tablist" aria-label="Settings sections">
      {can("settings.manage") && <button id="settings-integrations-tab" role="tab" type="button" aria-selected={section === "settings"} aria-controls="settings-integrations-panel" onClick={() => onSelect("settings")}>Integrations</button>}
      {!offline && can("users.manage") && <button id="settings-accounts-tab" role="tab" type="button" aria-selected={section === "accounts"} aria-controls="settings-accounts-panel" onClick={() => onSelect("accounts")}>Users &amp; roles</button>}
      <button id="settings-account-tab" role="tab" type="button" aria-selected={section === "account"} aria-controls="settings-account-panel" onClick={() => onSelect("account")}>Account</button>
    </div>
    <div id={section === "accounts" ? "settings-accounts-panel" : section === "account" ? "settings-account-panel" : "settings-integrations-panel"} role="tabpanel" aria-labelledby={section === "accounts" ? "settings-accounts-tab" : section === "account" ? "settings-account-tab" : "settings-integrations-tab"}>
      {section === "accounts" ? <AccountsModule embedded /> : section === "account" ? <AccountSettingsModule /> : <SettingsModule embedded />}
    </div>
  </section>;
}

export default function Home() {
  const { user, can, offline } = useAuth();
  const [activeModule, setActiveModule] = useState<Module>("contacts");
  const moduleAllowed = (module: Module) => {
    const permission = MODULE_PERMISSIONS[module];
    return !permission || can(permission);
  };
  const visibleModule = moduleAllowed(activeModule) ? activeModule : "contacts";
  const [osintAvailable, setOsintAvailable] = useState(false);
  const [notificationHolidayId, setNotificationHolidayId] = useState<string | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [selectedLetter, setSelectedLetter] = useState("");
  const [tagQuery, setTagQuery] = useState("");
  const [editorContact, setEditorContact] = useState<Contact | null>(null);
  const [editorIsNew, setEditorIsNew] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [navigationOpen, setNavigationOpen] = useState(false);
  const [visibleCount, setVisibleCount] = useState(80);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [bulkAction, setBulkAction] = useState<BulkAction | null>(null);
  const [bulkTag, setBulkTag] = useState("");
  const [bulkSaving, setBulkSaving] = useState(false);
  const [contactMergeOpen, setContactMergeOpen] = useState(false);
  useEffect(() => {
    let active = true;
    fetch("/api/osint").then(response => { if (active) setOsintAvailable(response.ok); }).catch(() => undefined);
    return () => { active = false; };
  }, []);
  useEffect(() => {
    const refreshAfterSync = () => {
      void fetch("/api/contacts/overrides", { cache: "no-store" })
        .then(response => response.json() as Promise<{ contacts: Contact[] }>)
        .then(body => setContacts(body.contacts))
        .catch(() => toast.error("Contacts could not refresh after sync."));
    };
    window.addEventListener("contactgraph:sync", refreshAfterSync);
    return () => window.removeEventListener("contactgraph:sync", refreshAfterSync);
  }, []);
  const [mergePickerOpen, setMergePickerOpen] = useState(false);
  const [mergePickerQuery, setMergePickerQuery] = useState("");
  const [mergePickerContact, setMergePickerContact] = useState<Contact | null>(null);
  const [mergeSelection, setMergeSelection] = useState<Contact[] | null>(null);
  const [mergeFromDetails, setMergeFromDetails] = useState(false);
  const [tagMergeOpen, setTagMergeOpen] = useState(false);
  const bakuTodayParts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Baku", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date()).map((part) => [part.type, part.value]));
  const bakuToday = `${bakuTodayParts.year}-${bakuTodayParts.month}-${bakuTodayParts.day}`;
  const todaysBirthdayCount = contacts.filter((contact) => birthdayMonthDay(contact.birthday) === bakuToday.slice(5)).length;

  useEffect(() => {
    let active = true;
    fetch("/api/contacts/overrides")
      .then(async (response) => {
        if (!response.ok) throw new Error("Database unavailable");
        return response.json() as Promise<{ contacts: Contact[] }>;
      })
      .then((body) => { if (active) { setContacts(body.contacts); setLoading(false); } })
      .catch(async () => {
        if (import.meta.env.MODE === "firebase-pages") {
          if (active) { setLoading(false); toast.error("Contacts could not be loaded from Firebase"); }
          return;
        }
        try {
          const fallback = await fetch("/contacts.json").then((response) => response.json()) as Contact[];
          if (active) { setContacts(fallback); setLoading(false); toast.warning("Showing the latest generated export; database editing may be unavailable."); }
        } catch {
          if (active) { setLoading(false); toast.error("Contacts could not be loaded"); }
        }
      });
    return () => { active = false; };
  }, []);

  const tagCounts = useMemo(() => {
    const counts = new Map<string, number>();
    contacts.forEach((contact) => (contact.labels ?? []).forEach((tag) => counts.set(tag, (counts.get(tag) ?? 0) + 1)));
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [contacts]);
  const organizationSuggestions = useMemo(() => [...new Set(contacts.map((contact) => contact.organization?.trim()).filter((organization): organization is string => Boolean(organization)))].sort((a, b) => a.localeCompare(b)), [contacts]);
  const matchingContacts = useMemo(() => {
    const needle = normalize(query.trim());
    return contacts.filter((contact) => (!needle || contactSearchText(contact).includes(needle)) && selectedTags.every((tag) => (contact.labels ?? []).includes(tag)));
  }, [contacts, query, selectedTags]);
  const availableLetters = useMemo(() => [...new Set(matchingContacts.map((contact) => contactInitial(contact.name)))].sort((a, b) => {
    if (a === "#") return 1;
    if (b === "#") return -1;
    return a.localeCompare(b, "az", { sensitivity: "base" });
  }), [matchingContacts]);
  const filteredContacts = useMemo(() => selectedLetter
    ? matchingContacts.filter((contact) => contactInitial(contact.name) === selectedLetter)
    : matchingContacts,
  [matchingContacts, selectedLetter]);
  const selectedContacts = useMemo(() => contacts.filter((contact) => selectedIds.has(contact.id)), [contacts, selectedIds]);
  const mergeDialogContacts = mergeSelection ?? selectedContacts;
  const mergePickerResults = useMemo(() => {
    const needle = normalize(mergePickerQuery.trim());
    return contacts.filter((contact) => contact.id !== mergePickerContact?.id && (!needle || contactSearchText(contact).includes(needle))).slice(0, 100);
  }, [contacts, mergePickerContact, mergePickerQuery]);

  const openContact = useCallback((contact: Contact) => {
    setEditorIsNew(false);
    setEditorContact(contact);
    setEditorOpen(true);
  }, []);
  const addContact = () => {
    setEditorIsNew(true);
    setEditorContact({ id: crypto.randomUUID(), name: "", emails: [], phones: [], labels: [], notes: "", birthday: "" });
    setEditorOpen(true);
  };
  const openContactById = useCallback((contactId: string) => {
    const contact = contacts.find((item) => item.id === contactId);
    if (contact) openContact(contact);
  }, [contacts, openContact]);
  const saveContact = useCallback(async (contact: Contact) => {
    const isCreate = !contacts.some((item) => item.id === contact.id);
    const response = isCreate
      ? await fetch("/api/contacts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(contact) })
      : await fetch(`/api/contacts/${encodeURIComponent(contact.id)}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(contact) });
    const body = await response.json().catch(() => ({})) as { contact?: Contact; error?: string };
    if (!response.ok) { toast.error(body.error ?? "Could not save this contact"); throw new Error(body.error ?? "Save failed"); }
    const saved = body.contact ?? contact;
    setContacts((current) => current.some((item) => item.id === contact.id)
      ? current.map((item) => item.id === contact.id ? saved : item)
      : [...current, saved]);
    setEditorContact(saved);
    setEditorIsNew(false);
    toast.success(saved.pending_sync ? "Contact saved on this device" : "Contact saved");
  }, [contacts]);
  const deleteContact = useCallback(async (contact: Contact) => {
    const response = await fetch(`/api/contacts/${encodeURIComponent(contact.id)}`, { method: "DELETE" });
    const body = await response.json().catch(() => ({})) as { error?: string };
    if (!response.ok) { toast.error(body.error ?? "Could not delete this contact"); throw new Error(body.error ?? "Delete failed"); }
    setContacts((current) => current.filter((item) => item.id !== contact.id));
    setEditorContact(null);
    toast.success(`${contact.name} deleted`);
  }, []);
  const deleteDuplicateContacts = useCallback(async (first: Contact, second: Contact, targets: Contact[]) => {
    const response = await fetch("/api/duplicates/delete", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ ids: targets.map(contact => contact.id), pair_ids: [first.id, second.id], expected_pair: [first, second] }),
    });
    const body = await response.json().catch(() => ({})) as { error?: string };
    if (!response.ok) throw new Error(body.error ?? "Could not delete duplicate contacts");
    const removed = new Set(targets.map(contact => contact.id));
    setContacts((current) => current.filter((contact) => !removed.has(contact.id)));
    setEditorContact(null);
    toast.success(targets.length === 2 ? "Both contacts deleted" : `${targets[0].name} deleted`);
  }, []);
  const toggleContactSelection = (contactId: string) => setSelectedIds((current) => {
    const next = new Set(current);
    if (next.has(contactId)) next.delete(contactId);
    else next.add(contactId);
    return next;
  });
  const closeSelection = () => {
    setSelectionMode(false);
    setSelectedIds(new Set());
  };
  const openBulkAction = (action: BulkAction) => {
    setBulkTag("");
    setBulkAction(action);
  };
  const applyBulkAction = async () => {
    if (!bulkAction || selectedIds.size === 0) return;
    const tag = bulkTag.trim();
    if (bulkAction !== "delete" && !tag) return;
    setBulkSaving(true);
    try {
      const payload = bulkAction === "delete"
        ? { action: "delete", ids: [...selectedIds] }
        : { action: "tags", ids: [...selectedIds], ...(bulkAction === "add-tag" ? { add_tags: [tag] } : { remove_tags: [tag] }) };
      const response = await fetch("/api/contacts/bulk", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      const result = await response.json().catch(() => ({})) as { changed?: number; already_missing?: number; error?: string };
      if (!response.ok) throw new Error(result.error ?? "Bulk operation failed");
      if (bulkAction === "delete") {
        setContacts((current) => current.filter((contact) => !selectedIds.has(contact.id)));
      } else {
        setContacts((current) => current.map((contact) => {
          if (!selectedIds.has(contact.id)) return contact;
          const labels = contact.labels ?? [];
          return { ...contact, labels: bulkAction === "add-tag" ? (labels.includes(tag) ? labels : [...labels, tag]) : labels.filter((label) => label !== tag) };
        }));
      }
      const changed = result.changed ?? selectedIds.size;
      if (bulkAction === "delete") {
        toast.success(changed > 0 ? `${changed} contact${changed === 1 ? "" : "s"} deleted` : "Selected contacts were already deleted");
      } else {
        toast.success(`${changed} contact${changed === 1 ? "" : "s"} updated`);
      }
      setBulkAction(null);
      closeSelection();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Bulk operation failed");
    } finally {
      setBulkSaving(false);
    }
  };
  const mergeTags = async (tags: string[], targetTag: string) => {
    const response = await fetch("/api/contacts/merge-tags", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tags, target_tag: targetTag }) });
    const result = await response.json().catch(() => ({})) as { changed?: number; error?: string };
    if (!response.ok) { toast.error(result.error ?? "Could not merge tags"); throw new Error(result.error ?? "Tag merge failed"); }
    const sourceTags = new Set(tags);
    setContacts((current) => current.map((contact) => {
      if (!(contact.labels ?? []).some((label) => sourceTags.has(label))) return contact;
      const nextLabels: string[] = [];
      (contact.labels ?? []).forEach((label) => { const value = sourceTags.has(label) ? targetTag : label; if (!nextLabels.includes(value)) nextLabels.push(value); });
      return { ...contact, labels: nextLabels };
    }));
    setSelectedTags([targetTag]);
    toast.success(tags.length === 1 ? `Tag renamed to ${targetTag}` : `${tags.length} tags merged as ${targetTag}`);
  };
  const mergeContacts = async (sourceIds: string[], targetId: string, contact: Contact) => {
    const fromDuplicates = mergeSelection?.length === 2 && !mergeFromDetails;
    const response = await fetch(fromDuplicates ? "/api/duplicates/merge" : "/api/contacts/merge-contacts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ source_ids: sourceIds, target_id: targetId, contact, ...(fromDuplicates ? { expected_contacts: sourceIds.map(id => mergeSelection!.find(item => item.id === id)) } : {}) }) });
    const result = await response.json().catch(() => ({})) as { contact?: Contact; error?: string };
    if (!response.ok) { toast.error(result.error ?? "Could not merge contacts"); throw new Error(result.error ?? "Contact merge failed"); }
    const merged = result.contact ?? contact;
    const sourceSet = new Set(sourceIds);
    setContacts((current) => current.flatMap((item) => item.id === targetId ? [merged] : sourceSet.has(item.id) ? [] : [item]));
    setContactMergeOpen(false);
    closeSelection();
    if (mergeFromDetails) {
      setEditorContact(merged);
      setEditorIsNew(false);
      setEditorOpen(true);
      setMergeFromDetails(false);
      setMergeSelection(null);
      setMergePickerContact(null);
    }
    setMergeSelection(null);
    setMergeFromDetails(false);
    toast.success(`${sourceIds.length} contacts merged into ${merged.name}`);
  };

  const openContactMergePicker = (contact: Contact) => {
    setMergePickerContact(contact);
    setMergePickerQuery("");
    setMergePickerOpen(true);
  };
  const selectContactToMerge = (other: Contact) => {
    if (!mergePickerContact) return;
    setMergeSelection([mergePickerContact, other]);
    setMergeFromDetails(true);
    setEditorOpen(false);
    setEditorContact(null);
    setMergePickerOpen(false);
    setContactMergeOpen(true);
  };
  const setMergeDialogVisibility = (open: boolean) => {
    setContactMergeOpen(open);
    if (!open && mergeFromDetails) {
      setEditorContact(mergePickerContact);
      setEditorOpen(true);
      setMergeFromDetails(false);
      setMergeSelection(null);
      setMergePickerContact(null);
    } else if (!open) setMergeSelection(null);
  };
  const mergeDuplicatePair = (first: Contact, second: Contact) => {
    setMergeSelection([first, second]);
    setMergeFromDetails(false);
    setContactMergeOpen(true);
  };

  useEffect(() => {
    const modelContext = (document as Document & { modelContext?: { registerTool: (tool: unknown, options?: { signal?: AbortSignal }) => void | Promise<void> } }).modelContext;
    if (!modelContext?.registerTool) return;
    const lifecycle = new AbortController();
    void Promise.resolve(modelContext.registerTool({
      name: "search_contacts", title: "Search contacts", description: "Search contacts by name, organization, email, phone, or tag.",
      inputSchema: { type: "object", properties: { query: { type: "string" }, tags: { type: "array", items: { type: "string" } } }, additionalProperties: false },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute(input: unknown) { const value = input as { query?: string; tags?: string[] }; const needle = normalize(value.query?.trim()); const tags = Array.isArray(value.tags) ? value.tags : []; return contacts.filter((item) => (!needle || contactSearchText(item).includes(needle)) && tags.every((tag) => (item.labels ?? []).includes(tag))).slice(0, 50); },
    }, { signal: lifecycle.signal })).catch(() => undefined);
    void Promise.resolve(modelContext.registerTool({
      name: "update_contact", title: "Update contact", description: "Save a complete updated contact record using its existing id.",
      inputSchema: { type: "object", properties: { contact: { type: "object" } }, required: ["contact"], additionalProperties: false },
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      async execute(input: unknown) { const contact = (input as { contact?: Contact }).contact; if (!contact?.id || !contact.name) throw new Error("contact.id and contact.name are required"); await saveContact(contact); return { id: contact.id, saved: true }; },
    }, { signal: lifecycle.signal })).catch(() => undefined);
    return () => lifecycle.abort();
  }, [contacts, saveContact]);

  const toggleTag = (tag: string) => {
    setSelectedTags((current) => current.includes(tag) ? current.filter((item) => item !== tag) : [...current, tag]);
    setVisibleCount(80);
  };
  const selectModule = (module: Module) => {
    if (!moduleAllowed(module)) return;
    setActiveModule(module);
    setNavigationOpen(false);
  };
  const clearTags = () => { setSelectedTags([]); setVisibleCount(80); };
  const tagFilterProps = { counts: tagCounts, selected: selectedTags, query: tagQuery, onQueryChange: setTagQuery, onToggle: toggleTag, onClear: clearTags, onMerge: () => setTagMergeOpen(true) };
  const signOut = async () => {
    let response = await fetch("/api/auth/logout", { method: "POST" });
    if (!response.ok) {
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (import.meta.env.MODE !== "firebase-pages" || !body.error?.includes("Unsynced edits") || !window.confirm("Discard unsynced edits on this device and sign out?")) { toast.error(body.error ?? "Could not sign out"); return; }
      response = await fetch("/api/auth/logout", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ discard_pending: true }) });
    }
    if (!response.ok) { const body = await response.json().catch(() => ({})) as { error?: string }; toast.error(body.error ?? "Could not sign out"); return; }
    window.location.assign(import.meta.env.MODE === "firebase-pages" ? import.meta.env.BASE_URL : user?.auth_source === "access" ? "/cdn-cgi/access/logout" : "/login");
  };

  return <main className="admin-shell">
    <aside className="admin-sidebar">
      <div className="admin-brand"><div className="brand-mark"><UserRound /></div><div><strong>ContactGraph</strong><span>Network admin</span></div></div>
      <p className="navigation-label">Workspace</p>
      <Navigation activeModule={visibleModule} contactCount={contacts.length} birthdayCount={todaysBirthdayCount} osintAvailable={osintAvailable} onSelect={selectModule} />
      <div className="sidebar-status"><span className="status-dot" /><div><strong>{import.meta.env.MODE === "firebase-pages" ? "Shared database" : "Local database"}</strong><span>{contacts.length.toLocaleString()} records · {import.meta.env.MODE === "firebase-pages" ? "Firestore" : "DuckDB"}</span></div></div>
    </aside>

    <div className="admin-main">
      <header className="admin-header">
        <Button className="lg:hidden" variant="outline" size="icon" onClick={() => setNavigationOpen(true)} aria-label="Open navigation"><Menu /></Button>
        <div className="header-context"><span>{visibleModule === "contacts" ? "Contacts" : visibleModule === "graph" ? "Graph view" : visibleModule === "holidays" ? "Holidays" : visibleModule === "notifications" ? "Notifications" : visibleModule === "duplicates" ? "Duplication and sync errors" : visibleModule === "meetings" ? "Meetings" : visibleModule === "followups" ? "Follow-ups" : visibleModule === "canva" ? "Canva" : visibleModule === "osint" ? "OSINT updates" : "Settings"}</span><small>{offline ? "Offline copy" : user?.display_name || "Private workspace"}</small></div>
        {visibleModule === "contacts" && <div className="header-search"><Search /><Input value={query} onChange={(event) => { setQuery(event.target.value); setVisibleCount(80); }} placeholder="Search people, companies, tags…" aria-label="Search contacts" />{query && <button onClick={() => { setQuery(""); setVisibleCount(80); }} aria-label="Clear search"><X /></button>}</div>}
        <OfflineStatus /><Button className="header-signout" size="sm" variant="outline" onClick={() => void signOut()}>Sign out</Button><div className="header-avatar">{user?.display_name?.slice(0, 2).toUpperCase() || "VK"}</div>
      </header>

      {visibleModule === "contacts" ? <div className="contacts-module">
        <aside className="tag-sidebar"><TagFilter {...tagFilterProps} /></aside>
        <section className="contacts-content">
          <div className="module-heading"><div><p className="eyebrow">Directory</p><h1 className="module-title">{filteredContacts.length.toLocaleString()} contacts</h1><p className="module-subtitle">Manage people, details, tags and notes.</p></div><div className="flex max-w-xl flex-wrap justify-end gap-2">{selectedTags.map((tag) => <button className="tag-pill bg-white" key={tag} onClick={() => toggleTag(tag)}>{tag}<X className="size-3.5" /></button>)}{can("contacts.create") && <Button className="bg-[#172f3d] text-white hover:bg-[#24495c]" onClick={addContact}><Plus />Add contact</Button>}{(can("tags.edit") || can("contacts.delete") || can("contacts.merge")) && <Button variant={selectionMode ? "secondary" : "outline"} className="bg-white" onClick={() => selectionMode ? closeSelection() : setSelectionMode(true)}><CheckSquare2 />{selectionMode ? "Cancel selection" : "Select contacts"}</Button>}</div></div>
          {!loading && <nav className="contact-alphabet" aria-label="Filter contacts by first letter">
            <button className={selectedLetter === "" ? "active" : ""} type="button" aria-pressed={selectedLetter === ""} onClick={() => { setSelectedLetter(""); setVisibleCount(80); }}>All</button>
            {availableLetters.map((letter) => <button className={selectedLetter === letter ? "active" : ""} type="button" key={letter} aria-pressed={selectedLetter === letter} aria-label={letter === "#" ? "Names not starting with a letter" : `Names starting with ${letter}`} onClick={() => { setSelectedLetter(letter); setVisibleCount(80); }}>{letter}</button>)}
          </nav>}
          {selectionMode && <div className="bulk-toolbar">
            <div><strong>{selectedIds.size.toLocaleString()} selected</strong><span>Choose contacts below or select the current filtered results.</span></div>
            <div className="bulk-actions">
              <Button variant="outline" size="sm" onClick={() => setSelectedIds(new Set(filteredContacts.map((contact) => contact.id)))}>Select filtered ({filteredContacts.length.toLocaleString()})</Button>
              {can("tags.edit") && <Button variant="outline" size="sm" disabled={selectedIds.size === 0} onClick={() => openBulkAction("add-tag")}><Plus />Add tag</Button>}
              {can("tags.edit") && <Button variant="outline" size="sm" disabled={selectedIds.size === 0} onClick={() => openBulkAction("remove-tag")}><Tag />Remove tag</Button>}
              {!offline && can("contacts.merge") && <Button variant="outline" size="sm" disabled={selectedIds.size < 2 || selectedIds.size > 50} onClick={() => setContactMergeOpen(true)}><GitMerge />Merge</Button>}
              {!offline && can("contacts.delete") && <Button variant="destructive" size="sm" disabled={selectedIds.size === 0} onClick={() => openBulkAction("delete")}><Trash2 />Delete</Button>}
            </div>
          </div>}
          {loading ? <div className="contact-grid">{Array.from({ length: 8 }).map((_, index) => <div key={index} className="h-40 animate-pulse rounded-2xl border border-[#d8e3e8] bg-white/70" />)}</div>
          : filteredContacts.length === 0 ? <div className="empty-state"><Search /><h2>No contacts found</h2><p>{selectedLetter ? `No matching names start with ${selectedLetter}. Choose another letter or All.` : "Try another search or clear a tag filter."}</p></div>
          : <><div className="contact-grid">{filteredContacts.slice(0, visibleCount).map((contact, index) => { const selected = selectedIds.has(contact.id); return <article key={contact.id} className={`contact-card ${selected ? "selected" : ""}`}>
            {selectionMode && <label className="contact-selector"><input type="checkbox" checked={selected} onChange={() => toggleContactSelection(contact.id)} aria-label={`Select ${contact.name}`} /><span><Check /></span></label>}
            <button className="contact-card-main" onClick={() => selectionMode ? toggleContactSelection(contact.id) : openContact(contact)} aria-label={selectionMode ? `Select ${contact.name}` : `Edit ${contact.name}`}>
              <div className={`avatar avatar-${index % 5}`}>{contact.photo_file ? <img className="size-full rounded-full object-cover" src={contact.photo_url || `/api/contacts/${encodeURIComponent(contact.id)}/photo?v=${encodeURIComponent(contact.photo_file)}`} alt="" /> : initials(contact.name)}</div>
              <div className="min-w-0 flex-1"><h2>{contact.name || "Unnamed contact"}</h2><p>{[contact.role, contact.organization].filter(Boolean).join(" · ") || "No organization details"}</p></div>
              <Edit3 className="edit-glyph" />
            </button>
            <div className="contact-card-details">{contact.emails?.[0]?.address && <span><Mail />{contact.emails[0].address}</span>}{contact.phones?.[0]?.number && <span><Phone />{contact.phones[0].number}</span>}{contact.locations?.[0] && <span><MapPin />{contact.locations[0]}</span>}</div>
            {(contact.labels ?? []).length > 0 && <div className="contact-card-tags">{(contact.labels ?? []).slice(0, 4).map((label) => <button className="small-tag" key={label} onClick={() => toggleTag(label)}>{label}</button>)}{(contact.labels ?? []).length > 4 && <span className="small-tag">+{(contact.labels ?? []).length - 4}</span>}</div>}
          </article>; })}</div>{visibleCount < filteredContacts.length && <div className="mt-7 flex justify-center"><Button variant="outline" className="h-11 rounded-xl bg-white px-6" onClick={() => setVisibleCount((count) => count + 80)}>Show more</Button></div>}</>}
        </section>
      </div> : visibleModule === "graph" ? <ContactGraph contacts={contacts} onSelectContact={openContactById} /> : visibleModule === "holidays" ? <HolidayModule contacts={contacts} onOpenSettings={() => setActiveModule(can("settings.manage") ? "settings" : "account")} openHolidayId={notificationHolidayId} onHolidayOpened={() => setNotificationHolidayId(null)} /> : visibleModule === "notifications" ? <NotificationsModule contacts={contacts} onOpenContact={openContactById} onOpenSettings={() => setActiveModule(can("settings.manage") ? "settings" : "account")} onOpenHoliday={(holidayId) => { setNotificationHolidayId(holidayId); setActiveModule("holidays"); }} /> : visibleModule === "duplicates" ? <DuplicatesModule contacts={contacts} onOpenContact={openContactById} onMerge={mergeDuplicatePair} onDelete={deleteDuplicateContacts} /> : visibleModule === "meetings" ? <MeetingsModule contacts={contacts} /> : visibleModule === "followups" ? <FollowupsModule contacts={contacts} onOpenContact={openContactById} /> : visibleModule === "canva" ? <CanvaModule contacts={contacts} /> : visibleModule === "osint" ? <OsintModule contacts={contacts} onContactUpdated={(contact) => setContacts(current => current.map(item => item.id === contact.id ? contact as Contact : item))} /> : <SettingsArea section={visibleModule as SettingsSection} onSelect={setActiveModule} />}
    </div>

    <Sheet open={navigationOpen} onOpenChange={setNavigationOpen}><SheetContent side="left" className="mobile-navigation-sheet w-[82vw] bg-[#172f3d] p-5 text-white sm:max-w-xs"><SheetHeader className="mb-7 px-0"><SheetTitle className="text-white">ContactGraph</SheetTitle><SheetDescription className="text-[#a9bbc4]">Choose a workspace module.</SheetDescription></SheetHeader><Navigation activeModule={visibleModule} contactCount={contacts.length} birthdayCount={todaysBirthdayCount} osintAvailable={osintAvailable} mobile onSelect={selectModule} /><Button className="mobile-signout" variant="outline" onClick={() => void signOut()}>Sign out</Button></SheetContent></Sheet>
    <Sheet open={filtersOpen} onOpenChange={setFiltersOpen}><SheetContent side="left" className="w-[88vw] border-r-[#d5e1e6] bg-[#f8fbfc] p-5 sm:max-w-sm"><SheetHeader className="mb-4 px-0 pt-2"><SheetTitle>Filter contacts</SheetTitle><SheetDescription>Choose one or more tags.</SheetDescription></SheetHeader><TagFilter {...tagFilterProps} /></SheetContent></Sheet>
    {visibleModule === "contacts" && <Button className="mobile-filter-button" onClick={() => setFiltersOpen(true)}><Tag />Filters{selectedTags.length > 0 && <span>{selectedTags.length}</span>}</Button>}
    <AlertDialog open={bulkAction !== null} onOpenChange={(open) => { if (!open && !bulkSaving) setBulkAction(null); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{bulkAction === "delete" ? `Delete ${selectedIds.size.toLocaleString()} contacts?` : bulkAction === "add-tag" ? `Add a tag to ${selectedIds.size.toLocaleString()} contacts` : `Remove a tag from ${selectedIds.size.toLocaleString()} contacts`}</AlertDialogTitle>
          <AlertDialogDescription>{bulkAction === "delete" ? "The contacts will be removed from DuckDB and generated exports. Their previous records remain in the database audit history." : "This change will be applied to every selected contact in one database transaction."}</AlertDialogDescription>
        </AlertDialogHeader>
        {bulkAction && bulkAction !== "delete" && <Input autoFocus value={bulkTag} onChange={(event) => setBulkTag(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && bulkTag.trim()) { event.preventDefault(); void applyBulkAction(); } }} placeholder={bulkAction === "add-tag" ? "Tag to add" : "Tag to remove"} aria-label={bulkAction === "add-tag" ? "Tag to add" : "Tag to remove"} />}
        <AlertDialogFooter><AlertDialogCancel disabled={bulkSaving}>Cancel</AlertDialogCancel><AlertDialogAction variant={bulkAction === "delete" ? "destructive" : "default"} disabled={bulkSaving || (bulkAction !== "delete" && !bulkTag.trim())} onClick={(event) => { event.preventDefault(); void applyBulkAction(); }}>{bulkSaving ? "Applying…" : bulkAction === "delete" ? "Delete contacts" : bulkAction === "add-tag" ? "Add tag" : "Remove tag"}</AlertDialogAction></AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    <ContactEditor key={`${editorContact?.id ?? "no-contact"}:${editorOpen}`} contact={editorContact} contacts={contacts} tagSuggestions={tagCounts.map(([tag]) => tag)} organizationSuggestions={organizationSuggestions} open={editorOpen} onOpenChange={setEditorOpen} onSave={saveContact} onDelete={deleteContact} onMerge={openContactMergePicker} isNew={editorIsNew} />
    <TagMergeDialog tags={selectedTags} open={tagMergeOpen} onOpenChange={setTagMergeOpen} onMerge={mergeTags} />
    <Dialog open={mergePickerOpen} onOpenChange={(open) => { setMergePickerOpen(open); if (!open) setMergePickerContact(null); }}>
      <DialogContent className="flex max-h-[calc(100dvh-1rem)] flex-col overflow-hidden p-0 sm:max-w-xl">
        <DialogHeader className="shrink-0 border-b px-5 py-5 pr-12"><DialogTitle>Choose a contact to merge</DialogTitle><DialogDescription>Select the other record to combine with {mergePickerContact?.name}. You’ll review conflicts and choose the surviving contact next.</DialogDescription></DialogHeader>
        <div className="relative shrink-0 px-5 pt-4"><Search className="pointer-events-none absolute left-8 top-7 size-4 -translate-y-1/2 text-[#7b909b]" /><Input autoFocus className="pl-9" value={mergePickerQuery} onChange={(event) => setMergePickerQuery(event.target.value)} placeholder="Search by name, company, email, or tag" aria-label="Find contact to merge" /></div>
        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">{mergePickerResults.length ? mergePickerResults.map((candidate) => <button type="button" key={candidate.id} className="flex w-full items-center gap-3 rounded-xl p-3 text-left hover:bg-[#eef5f6]" onClick={() => selectContactToMerge(candidate)}><span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[#e1eeee] text-sm font-bold text-[#24616a]">{initials(candidate.name)}</span><span className="min-w-0 flex-1"><strong className="block truncate text-sm text-[#244957]">{candidate.name}</strong><small className="mt-1 block truncate text-xs text-[#748a93]">{[candidate.role, candidate.organization].filter(Boolean).join(" · ") || candidate.emails?.[0]?.address || "No organization details"}</small></span><GitMerge className="size-4 shrink-0 text-[#728993]" /></button>) : <div className="p-8 text-center text-sm text-[#71858d]">No other contacts match this search.</div>}</div>
        <DialogFooter className="shrink-0 border-t px-5 py-4"><Button variant="outline" onClick={() => setMergePickerOpen(false)}>Cancel</Button></DialogFooter>
      </DialogContent>
    </Dialog>
    <ContactMergeDialog key={mergeDialogContacts.map((contact) => contact.id).join("|")} selectedContacts={mergeDialogContacts} open={contactMergeOpen} onOpenChange={setMergeDialogVisibility} onMerge={mergeContacts} />
  </main>;
}
