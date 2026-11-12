"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from './auth-context';
import { calendarEvents, todayInBaku, type CalendarContact, type FollowupData, type OccurrenceState } from './calendar-model';
import type { Holiday } from './holiday-module';
const collections = ['holidays', 'calendar_occurrence_states', 'followup_actions', 'followup_settings', 'contacts', 'meetings'];
export function useCalendarData(contacts: CalendarContact[], month?: string) {
  const { can } = useAuth();
  const birthdays = can('contacts.view'), holidaysAllowed = can('holidays.view'), followupsAllowed = can('followups.view');
  const [today, setToday] = useState(todayInBaku);
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [followups, setFollowups] = useState<FollowupData>({ actions: [], suggestions: [] });
  const [states, setStates] = useState<OccurrenceState[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const sequence = useRef(0);
  const refresh = useCallback(async () => {
    const current = ++sequence.current;
    setToday(todayInBaku());
    const get = async (path: string) => { const res = await fetch(path, { cache: 'no-store' }); if (!res.ok) throw new Error('Calendar could not load all items. Counts may be incomplete.'); return res.json(); };
    const results = await Promise.allSettled([
      holidaysAllowed ? get('/api/holidays') : Promise.resolve({ holidays: [] }),
      followupsAllowed ? get('/api/followups') : Promise.resolve({ actions: [], suggestions: [] }),
      birthdays ? get('/api/calendar-states/birthday') : Promise.resolve({ states: [] }),
      holidaysAllowed ? get('/api/calendar-states/holiday') : Promise.resolve({ states: [] }),
    ]);
    if (current !== sequence.current) return;
    const value = (i: number, fallback: any) => results[i].status === 'fulfilled' ? results[i].value : fallback;
    setHolidays(value(0, { holidays: [] }).holidays);
    setFollowups(value(1, { actions: [], suggestions: [] }));
    setStates([...value(2, { states: [] }).states, ...value(3, { states: [] }).states]);
    setError(results.some(r => r.status === 'rejected') ? 'Calendar could not load all items. Counts may be incomplete. Retry to see the current status.' : '');
    setLoading(false);
  }, [birthdays, holidaysAllowed, followupsAllowed]);
  useEffect(() => {
    void refresh();
    const events = ['focus', 'online', 'contactgraph:sync', 'contactgraph:calendar-changed', 'contactgraph:followups-changed', ...collections.map(c => `contactgraph:collection:${c}`)];
    const listener = () => { void refresh(); };
    events.forEach(name => window.addEventListener(name, listener));
    const timer = window.setInterval(listener, 60000);
    return () => { sequence.current++; window.clearInterval(timer); events.forEach(name => window.removeEventListener(name, listener)); };
  }, [refresh]);
  const year = Number((month || today).slice(0, 4));
  const events = useMemo(() => {
    const make = (y: number) => calendarEvents(birthdays ? contacts : [], holidays, followups, states, `${y}-01-01`, `${y}-12-31`);
    return [...new Map([...make(year), ...make(Number(today.slice(0, 4)))].map(e => [e.id, e])).values()].sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title));
  }, [birthdays, contacts, holidays, followups, states, year, today]);
  return { today, events, holidays, states, loading, error, refresh };
}
export type CalendarData = ReturnType<typeof useCalendarData>;
