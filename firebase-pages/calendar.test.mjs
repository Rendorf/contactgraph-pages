import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
const source = readFileSync(new URL('../app/calendar-model.tsx', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText;
const { calendarEvents, attentionCount, todayInBaku, validDate } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
const empty = { actions: [], suggestions: [] };
test('Baku midnight, leap days and yearless birthdays', () => {
  assert.equal(todayInBaku(new Date('2026-11-11T20:00:00Z')), '2026-11-12');
  assert.equal(validDate('2027-02-29'), false);
  const people = [{ id: 'a', name: 'A', birthday: '--02-29' }, { id: 'b', name: 'B', birthday: '1980-02-28' }];
  assert.equal(calendarEvents(people, [], empty, [], '2027-01-01', '2027-12-31').length, 1);
  assert.equal(calendarEvents(people, [], empty, [], '2028-01-01', '2028-12-31').length, 2);
});
test('cross-year and multi-day holidays are one occurrence with an exclusive end', () => {
  const holiday = { id: 'h', title: 'Holiday', start_date: '2025-12-31', end_date: '2026-01-03', recurrence: ['RRULE:FREQ=YEARLY'] };
  const events = calendarEvents([], [holiday, holiday], empty, [], '2027-01-01', '2027-01-31');
  assert.equal(events.length, 1); assert.equal(events[0].id, 'holiday:h:2026-12-31');
  assert.equal(attentionCount(events, '2027-01-02'), 1); assert.equal(attentionCount(events, '2027-01-03'), 0);
});
test('outcomes only resolve that occurrence; reopening restores badge, drafting has no effect', () => {
  const c = [{ id: 'a', name: 'A', birthday: '--11-12' }];
  const state = { id: 'birthday:a:2026-11-12', status: 'handled', revision: 1 };
  const make = states => calendarEvents(c, [], empty, states, '2026-01-01', '2027-12-31');
  assert.equal(attentionCount(make([state]), '2026-11-12'), 0);
  assert.equal(attentionCount(make([state]), '2027-11-12'), 1);
  assert.equal(attentionCount(make([{ ...state, status: 'open', revision: 2 }]), '2026-11-12'), 1);
  assert.equal(attentionCount(make([{ ...state, status: 'no_action' }]), '2026-11-12'), 0);
  assert.equal(attentionCount(make([]), '2026-11-13'), 0);
});
test('overdue follow-ups survive month boundaries; future follow-ups are not counted', () => {
  const followups = { actions: [{ id: 'a', title: 'Call', contact_id: 'p', due_date: '2025-01-01' }, { id: 'b', title: 'Visit', contact_id: 'p', due_date: '2026-12-01' }], suggestions: [{ contact_id: 'q', due_date: '2026-11-12' }] };
  assert.equal(attentionCount(calendarEvents([], [], followups, [], '2026-01-01', '2026-12-31'), '2026-11-12'), 2);
});
test('explicit year holidays do not recur and malformed dates cannot roll over', () => {
  const h = [{ id: 'h', title: 'Holiday', start_date: '2026-11-12', end_date: '2026-11-13', recurrence: [] }];
  assert.equal(calendarEvents([], h, empty, [], '2027-01-01', '2027-12-31').length, 0);
  assert.equal(validDate('2026-04-31'), false);
});
