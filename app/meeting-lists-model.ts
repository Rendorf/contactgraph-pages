const DAY = 86_400_000;

function validDay(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}

function plusDays(value: string, count: number) {
  return new Date(Date.parse(`${value}T12:00:00Z`) + count * DAY).toISOString().slice(0, 10);
}

export type MeetingListScheduleInput = {
  cadence_days?: number | null;
  joined_on?: string | null;
  last_contact_on?: string | null;
  snoozed_until?: string | null;
};

/** Derive a membership's due date without storing a second source of truth. */
export function meetingListSchedule(member: MeetingListScheduleInput, listCadence: number, lastMeetingDate: unknown, today: string) {
  if (!validDay(today)) throw new Error("Invalid schedule date.");
  const cadence = Number.isInteger(member.cadence_days) && Number(member.cadence_days) >= 7 && Number(member.cadence_days) <= 365
    ? Number(member.cadence_days) : listCadence;
  if (!Number.isInteger(cadence) || cadence < 7 || cadence > 365) throw new Error("Invalid meeting-list cadence.");
  const activities = [lastMeetingDate, member.last_contact_on].filter((value): value is string => validDay(value) && value <= today);
  const lastActivity = activities.sort().at(-1) ?? null;
  const joined = validDay(member.joined_on) ? member.joined_on : today;
  let dueDate = lastActivity ? plusDays(lastActivity, cadence) : joined;
  if (validDay(member.snoozed_until) && member.snoozed_until > dueDate) dueDate = member.snoozed_until;
  return { cadence_days: cadence, uses_list_cadence: member.cadence_days == null, last_activity: lastActivity, due_date: dueDate };
}
