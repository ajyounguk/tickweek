// Calendar dates are ISO strings ('2026-11-16'), always in the app's timezone (Europe/London).
// Arithmetic is done on UTC midnights so DST never shifts a day.

export const TZ = process.env.APP_TZ || 'Europe/London';

const isoFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });

export function todayISO(now = new Date()) {
  return isoFmt.format(now);
}

export function isISODate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export function addDays(iso, n) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function mondayOf(iso) {
  const day = new Date(iso + 'T00:00:00Z').getUTCDay(); // 0 = Sun
  return addDays(iso, -((day + 6) % 7));
}

export function weekDates(monday) {
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

export function ddmm(iso) {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
}

/**
 * Edit window (design.md): this week up to today; last week until this week's weigh-in exists;
 * older weeks only in corrections mode. Never the future.
 */
export function canEditDate(date, today, { thisWeekWeighedIn = false, corrections = false } = {}) {
  if (date > today) return false;
  const thisMonday = mondayOf(today);
  const m = mondayOf(date);
  if (m === thisMonday) return true;
  if (m === addDays(thisMonday, -7) && !thisWeekWeighedIn) return true;
  return corrections;
}

/** A week's weigh-in can be entered during that week (late after Monday); older weeks only in corrections mode. */
export function canEditWeighIn(monday, today, { corrections = false } = {}) {
  if (monday > today) return false;
  if (monday === mondayOf(today)) return true;
  return corrections;
}
