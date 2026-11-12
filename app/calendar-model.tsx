/** Date-only arithmetic: never interpret a stored occasion in the browser's timezone. */
export type CalendarContact = { id: string; name: string; birthday?: string; organization?: string; interaction_type?: string; emails?: { address?: string }[]; phones?: { number?: string }[] };
export type CalendarHoliday = { id: string; title: string; start_date: string; end_date: string; recurrence?: string[] };
export type OccurrenceState = { id: string; event_type: 'birthday' | 'holiday'; source_id: string; occurrence_date: string; status: 'open' | 'handled' | 'no_action'; revision: number; changed_at?: string; changed_by?: string };
export type FollowupData = { actions: { id: string; contact_id: string; title: string; due_date: string; contact?: CalendarContact }[]; suggestions: { contact_id: string; due_date: string; contact?: CalendarContact }[] };
export type CalendarEvent = { id: string; type: 'birthday' | 'holiday' | 'followup'; sourceId: string; date: string; end: string; title: string; contactId?: string; suggestion?: boolean; status: OccurrenceState['status']; revision: number };
const DAY = 86400000;
export function todayInBaku(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Baku', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now).map(p => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}
export function validDate(day: string) { return /^\d{4}-\d{2}-\d{2}$/.test(day) && Number.isFinite(Date.parse(day)) && new Date(day).toISOString().slice(0, 10) === day; }
export function addDays(day: string, count: number) { return new Date(Date.parse(`${day}T00:00:00Z`) + count * DAY).toISOString().slice(0, 10); }
export const occurrenceId = (type: string, source: string, day: string) => `${type}:${source}:${day}`;
export function calendarEvents(contacts: CalendarContact[], holidays: CalendarHoliday[], followups: FollowupData, states: OccurrenceState[], from: string, to: string): CalendarEvent[] {
  if (!validDate(from) || !validDate(to) || to < from || Number(to.slice(0, 4)) - Number(from.slice(0, 4)) > 10) throw new Error('Invalid calendar range.');
  const result = new Map<string, CalendarEvent>();
  const outcomes = new Map(states.map(s => [s.id, s]));
  const add = (event: Omit<CalendarEvent, 'status' | 'revision'>) => { const s = outcomes.get(event.id); result.set(event.id, { ...event, status: s?.status ?? 'open', revision: s?.revision ?? 0 }); };
  const years = Array.from({ length: Number(to.slice(0, 4)) - Number(from.slice(0, 4)) + 2 }, (_, i) => Number(from.slice(0, 4)) - 1 + i);
  for (const c of contacts) {
    const md = /^(?:\d{4}-|--)?(\d{2}-\d{2})$/.exec(c.birthday ?? '')?.[1];
    if (!md) continue;
    for (const year of years) { const date = `${year}-${md}`; if (validDate(date) && date >= from && date <= to) add({ id: occurrenceId('birthday', c.id, date), type: 'birthday', sourceId: c.id, date, end: addDays(date, 1), title: `${c.name} · Birthday`, contactId: c.id }); }
  }
  for (const h of holidays) {
    if (!validDate(h.start_date) || !validDate(h.end_date)) continue;
    const duration = Math.max(1, Math.round((Date.parse(h.end_date) - Date.parse(h.start_date)) / DAY));
    const starts = h.recurrence?.some(rule => rule.includes('FREQ=YEARLY')) ? years.map(year => `${year}-${h.start_date.slice(5)}`) : [h.start_date];
    for (const date of starts) { if (!validDate(date)) continue; const end = addDays(date, duration); if (date <= to && end > from) add({ id: occurrenceId('holiday', h.id, date), type: 'holiday', sourceId: h.id, date, end, title: h.title }); }
  }
  // Keep overdue follow-ups in Today, even when their due date is outside this month.
  for (const a of followups.actions) if (validDate(a.due_date) && a.due_date <= to) add({ id: `action:${a.id}`, type: 'followup', sourceId: a.id, date: a.due_date, end: addDays(a.due_date, 1), title: `${a.contact?.name ?? a.contact_id} · ${a.title}`, contactId: a.contact_id });
  for (const a of followups.suggestions) if (validDate(a.due_date) && a.due_date <= to) add({ id: `suggestion:${a.contact_id}`, type: 'followup', sourceId: a.contact_id, suggestion: true, date: a.due_date, end: addDays(a.due_date, 1), title: `${a.contact?.name ?? a.contact_id} · Reconnect`, contactId: a.contact_id });
  return [...result.values()].sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title));
}
export function needsAttention(event: CalendarEvent, today: string) { return event.status === 'open' && (event.type === 'followup' ? event.date <= today : event.date <= today && event.end > today); }
export const attentionCount = (events: CalendarEvent[], today: string) => new Set(events.filter(e => needsAttention(e, today)).map(e => e.id)).size;
