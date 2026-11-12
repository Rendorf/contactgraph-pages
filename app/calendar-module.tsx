"use client";
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Calendar } from '@/components/ui/calendar';
import { useAuth } from './auth-context';
import { MessageGenerator, MessageHistory } from './holiday-module';
import { BirthdayMessageComposer } from './birthday-module';
import { ContactMessageHistory } from './contact-message-history';
import { addDays, addMonths, upcomingEvents, needsAttention, type CalendarContact, type CalendarEvent } from './calendar-model';
import type { CalendarData } from './calendar-data';
const dateLabel = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString(undefined, { timeZone: 'UTC', year: 'numeric', month: 'short', day: 'numeric' });
const localDate = (day: string) => new Date(`${day}T12:00:00`);
const dateKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
async function post(path: string, body: unknown) { const res = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); const value = await res.json() as { error?: string }; if (!res.ok) throw new Error(value.error || 'Could not save.'); return value; }

export function CalendarModule({ contacts, data, month, onMonthChange, onOpenSettings, onOpenContact }: { contacts: CalendarContact[]; data: CalendarData; month: string; onMonthChange: (month: string) => void; onOpenSettings: () => void; onOpenContact: (id: string) => void }) {
  const { can } = useAuth();
  const canGenerate = can('drafts.manage');
  const opener = useRef<HTMLButtonElement | null>(null);
  const [filter, setFilter] = useState('all');
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(20);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [newDate, setNewDate] = useState(addDays(data.today, 1));
  const [history, setHistory] = useState(false);
  const [generator, setGenerator] = useState(false);
  const [ai, setAi] = useState({ configured: false, model: '' });
  const [recipient, setRecipient] = useState('');
  const [draft, setDraft] = useState('');
  const [language, setLanguage] = useState('Azerbaijani');
  const [historyKey, setHistoryKey] = useState(0);
  const selected = data.events.find(e => e.id === selectedId);
  const contact = contacts.find(c => c.id === (selected?.contactId || recipient));
  const holiday = data.holidays.find(h => h.id === selected?.sourceId);
  useEffect(() => {
    if (!canGenerate) return;
    let active = true;
    const check = () => { void fetch('/api/ai-availability', { cache: 'no-store' }).then(async res => res.ok ? res.json() as Promise<{ configured?: boolean; model?: string }> : { configured: false, model: '' }).then(value => { if (active) setAi({ configured: Boolean(value.configured), model: value.model || '' }); }).catch(() => { if (active) setAi({ configured: false, model: '' }); }); };
    check(); const timer = window.setInterval(check, 60000); window.addEventListener('focus', check);
    return () => { active = false; window.clearInterval(timer); window.removeEventListener('focus', check); };
  }, [canGenerate]);
  const filtered = useMemo(() => data.events.filter(e => filter === 'all' || e.type === filter), [data.events, filter]);
  const upcoming = useMemo(() => upcomingEvents(data.events, data.today, filter), [data.events, data.today, filter]);
  const overdue = filtered.filter(event => event.type === 'followup' && event.status === 'open' && event.date < data.today);
  const selectedDayEvents = selectedDate ? filtered.filter(event => event.date <= selectedDate && event.end > selectedDate) : [];
  const changeMonth = (value: string) => { onMonthChange(value); setSelectedDate(null); };
  useEffect(() => { setVisibleCount(20); }, [filter, data.today]);
  const open = (event: CalendarEvent) => { setSelectedId(event.id); setRecipient(event.contactId || ''); setDraft(''); setNewDate(addDays(data.today, 1)); };
  const mutate = async (task: () => Promise<unknown>) => { setBusy(true); try { await task(); await data.refresh(); } catch (error) { toast.error(error instanceof Error ? error.message : 'Could not save.'); } finally { setBusy(false); } };
  const outcome = (status: 'open' | 'handled' | 'no_action') => selected && mutate(() => post(`/api/calendar-states/${selected.type}`, { id: selected.id, source_id: selected.sourceId, occurrence_date: selected.date, status, revision: selected.revision }));
  const followup = (action: 'complete' | 'reschedule' | 'delete') => selected && mutate(async () => { await post('/api/followups', selected.suggestion ? { type: action === 'complete' ? 'complete-suggestion' : action === 'reschedule' ? 'snooze-suggestion' : 'dismiss-suggestion', contact_id: selected.sourceId, ...(action === 'reschedule' ? { due_date: newDate } : {}) } : { type: action, id: selected.sourceId, ...(action === 'reschedule' ? { due_date: newDate } : {}) }); setSelectedId(null); });
  const saveDraft = async () => {
    if (!selected || !contact) return;
    setBusy(true);
    try { await post(`/api/calendar-drafts/${selected.type}`, { source_id: selected.sourceId, contact_id: contact.id, content: draft, language }); setDraft(''); setHistoryKey(k => k + 1); toast.success('Draft saved. Nothing sent.'); }
    catch (error) { toast.error(error instanceof Error ? error.message : 'Draft could not be saved.'); }
    finally { setBusy(false); }
  };
  const eventRows = (events: CalendarEvent[]) => events.map(event => <button key={event.id} onClick={click => { opener.current = click.currentTarget; open(event); }} className="flex w-full items-center justify-between gap-3 rounded-xl border bg-white p-4 text-left hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-teal-600"><span className="min-w-0"><span className="block break-words font-medium">{event.title}</span><span className="text-xs text-slate-500">{dateLabel(event.date)} · {event.type === 'followup' ? 'Follow-up' : event.type === 'birthday' ? 'Birthday' : 'Holiday'}</span></span><span className={`shrink-0 text-xs ${needsAttention(event, data.today) ? 'text-amber-700' : 'text-slate-500'}`}>{event.status === 'handled' ? 'Handled' : event.status === 'no_action' ? 'No action needed' : event.type === 'followup' && event.date < data.today ? 'Overdue' : needsAttention(event, data.today) ? 'Needs action' : 'Open'}</span></button>);
  return <section className="space-y-5 p-4 sm:p-6">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="eyebrow">Occasions and actions</p><h1 className="module-title">Calendar</h1><p className="module-subtitle">Birthdays, holidays and follow-ups · Asia/Baku</p></div>{can('drafts.view') && <Button variant="outline" onClick={() => setHistory(true)}>Saved drafts &amp; history</Button>}</div>
    <div className="flex flex-wrap justify-center gap-2" role="group" aria-label="Filter calendar events">{[['all', 'All'], ['holiday', 'Holidays'], ['birthday', 'Birthdays'], ['followup', 'Follow-ups']].map(([value, label]) => <Button key={value} variant={filter === value ? 'default' : 'outline'} aria-pressed={filter === value} onClick={() => setFilter(value)}>{label}</Button>)}</div>
    {data.error && <div role="alert" className="rounded border border-amber-300 p-3">{data.error} <Button variant="outline" onClick={() => void data.refresh()}>Retry</Button></div>}
    <div className="mx-auto max-w-3xl rounded-2xl border bg-white p-3 sm:p-6">
      <div className="mb-3 flex flex-wrap items-center justify-center gap-3"><label className="flex items-center gap-2 text-sm">Month <Input className="w-auto" type="month" min="1900-01" max="2100-12" value={month.slice(0, 7)} onChange={e => { if (e.target.value) changeMonth(`${e.target.value}-01`); }} /></label><Button variant="outline" onClick={() => changeMonth(data.today)}>Today</Button></div>
      <Calendar className="mx-auto rounded-xl [--cell-size:clamp(2rem,7vw,4.5rem)]" mode="single" month={localDate(month)} onMonthChange={d => changeMonth(dateKey(d))} selected={selectedDate ? localDate(selectedDate) : undefined} onSelect={d => setSelectedDate(d ? dateKey(d) : null)} modifiers={{ events: d => filtered.some(e => e.date <= dateKey(d) && e.end > dateKey(d)) }} modifiersClassNames={{ events: 'font-bold underline decoration-teal-500 decoration-2 underline-offset-4' }} />
      <p className="mt-3 text-center text-xs text-slate-500">Underlined dates have events. Select a day to see its details.</p>
    </div>
    <div className="mx-auto max-w-4xl space-y-6">
      {selectedDate && <section className="space-y-2 rounded-xl border bg-slate-50 p-4" aria-label="Selected day"><div className="flex items-center justify-between gap-2"><h2 className="font-semibold">{dateLabel(selectedDate)}</h2><Button variant="ghost" onClick={() => setSelectedDate(null)}>Close day details</Button></div>{data.loading ? <p role="status">Loading events…</p> : selectedDayEvents.length ? eventRows(selectedDayEvents) : <p className="text-sm text-slate-500">No matching events on this day.</p>}</section>}
      {overdue.length > 0 && <section className="space-y-2" aria-label="Overdue follow-ups"><h2 className="font-semibold text-amber-800">Overdue follow-ups · {overdue.length}</h2>{eventRows(overdue)}</section>}
      <section className="space-y-2" aria-label="Upcoming events"><h2 className="text-lg font-semibold">Upcoming{filter === 'holiday' ? ' holidays' : filter === 'birthday' ? ' birthdays' : filter === 'followup' ? ' follow-ups' : ' events'}</h2><p className="pb-2 text-sm text-slate-500">From today through {dateLabel(addMonths(data.today, 12))}, across all months.</p>{data.loading ? <p role="status">Loading upcoming events…</p> : upcoming.length ? eventRows(upcoming.slice(0, visibleCount)) : <p className="text-sm text-slate-500">{data.error ? 'Upcoming events could not be fully loaded.' : 'No matching events in the next 12 months.'}</p>}{upcoming.length > visibleCount && <Button variant="outline" className="mt-3" onClick={() => setVisibleCount(count => count + 20)}>Show more ({upcoming.length - visibleCount} remaining)</Button>}</section>
    </div>
    <Dialog open={Boolean(selected)} onOpenChange={open => { if (!open && !busy) setSelectedId(null); }}><DialogContent onCloseAutoFocus={event => { event.preventDefault(); opener.current?.focus(); }} className="max-h-[90dvh] overflow-y-auto sm:max-w-3xl"><DialogHeader><DialogTitle>{selected?.title}</DialogTitle><DialogDescription>{selected && dateLabel(selected.date)} · {selected?.type === 'followup' ? 'Manage this follow-up.' : 'The outcome applies only to this occurrence. Drafting and copying do not mark it handled or sent.'}</DialogDescription></DialogHeader>
      {selected?.type === 'followup' ? <div className="space-y-4">{can('followups.manage') && <><div className="flex flex-wrap gap-2"><Button disabled={busy} onClick={() => void followup('complete')}>Complete</Button><Button variant="outline" disabled={busy} onClick={() => void followup('delete')}>Dismiss</Button></div><label className="block text-sm">{selected.suggestion ? 'Snooze until' : 'Reschedule to'}<Input type="date" value={newDate} onChange={e => setNewDate(e.target.value)} /></label><Button variant="outline" disabled={busy || !newDate} onClick={() => void followup('reschedule')}>{selected.suggestion ? 'Snooze' : 'Reschedule'}</Button></>}{selected.contactId && <Button variant="outline" onClick={() => onOpenContact(selected.contactId!)}>Open contact</Button>}</div> : selected && <div className="space-y-5">
        {holiday && <p className="whitespace-pre-wrap text-sm">{holiday.description}<br />{holiday.verification && `Verification: ${holiday.verification}`}</p>}
        {can('drafts.manage') && <div className="flex flex-wrap gap-2">{selected.status === 'open' ? <><Button disabled={busy || Boolean(data.error)} onClick={() => void outcome('handled')}>Mark handled</Button><Button disabled={busy || Boolean(data.error)} variant="outline" onClick={() => void outcome('no_action')}>No action needed</Button></> : <><span>{selected.status === 'handled' ? 'Handled' : 'No action needed'}</span><Button variant="outline" disabled={busy || Boolean(data.error)} onClick={() => void outcome('open')}>Reopen</Button></>}</div>}
        {selected.type === 'holiday' && <label className="block text-sm">Recipient<select className="mt-1 w-full rounded border p-2" value={recipient} onChange={e => setRecipient(e.target.value)}><option value="">Choose a contact</option>{contacts.map(c => <option key={c.id} value={c.id}>{c.name}{c.organization ? ` · ${c.organization}` : ''}</option>)}</select></label>}
        {contact && <p className="text-sm">{contact.name} · Address form: {contact.interaction_type || 'Unrecorded'}<br />Email: {contact.emails?.map(e => e.address).filter(Boolean).join(', ') || 'Not recorded'}<br />Phone: {contact.phones?.map(p => p.number).filter(Boolean).join(', ') || 'Not recorded'}</p>}
        {can('drafts.manage') && <><p className="text-xs text-slate-500">{ai.configured ? `AI available · ${ai.model}` : 'AI generation is unavailable. You can write and save a draft here.'}</p>{selected.type === 'birthday' && contact && ai.configured && <BirthdayMessageComposer contact={contact} onUpdated={() => setHistoryKey(k => k + 1)} />}{selected.type === 'holiday' && <Button variant="outline" disabled={!ai.configured} onClick={() => setGenerator(true)}>Generate holiday messages</Button>}{contact && <div className="space-y-2"><h3 className="font-medium">Write a draft</h3><label className="text-sm">Language <select className="rounded border p-2" value={language} onChange={e => setLanguage(e.target.value)}>{['Azerbaijani', 'English', 'Russian'].map(l => <option key={l}>{l}</option>)}</select></label><Textarea aria-label="Manual message draft" value={draft} maxLength={10000} onChange={e => setDraft(e.target.value)} placeholder="Write your message…" /><Button disabled={busy || !draft.trim()} onClick={() => void saveDraft()}>Save draft</Button></div>}</>}
        {contact && can('drafts.view') && <ContactMessageHistory contactId={contact.id} contactName={contact.name} refreshKey={historyKey} />}
      </div>}
    </DialogContent></Dialog>
    <MessageGenerator holiday={holiday ?? null} contacts={contacts} open={generator} onOpenChange={setGenerator} serverConfigured={ai.configured} model={ai.model} onOpenSettings={onOpenSettings} />
    <MessageHistory open={history} onOpenChange={setHistory} contacts={contacts} serverConfigured={ai.configured} />
  </section>;
}
