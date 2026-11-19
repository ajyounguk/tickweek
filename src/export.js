// Data export: JSON (everything, lossless) and CSV (one row per day, like the paper grid).
import { addDays, mondayOf } from './dates.js';
import { formatStLb } from './weight.js';
import { withCombined } from './combined.js';

const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/**
 * Everything in the DB, in a stable shape. Weight is in kg.
 * Format 2: goal_days may be null (no goal), targets and week snapshots carry part_of (combined targets).
 */
export function exportJson(repo, exportedAt) {
  const { targets, weeks, snapshots, entries, weighIns } = repo.allRows();
  const goal = repo.getSetting('goal_kg');
  const byWeek = new Map(weeks.map((m) => [m, []]));
  for (const s of snapshots) byWeek.get(s.monday_date)?.push({ target_id: s.id, goal_days: s.goal_days, sort_order: s.sort_order, part_of: s.part_of ?? null });

  return {
    app: 'tickweek',
    format: 2,
    exportedAt,
    weightUnit: 'kg',
    settings: { goalKg: goal != null ? Number(goal) : null, corrections: repo.getSetting('corrections_mode') === '1' },
    targets,
    weeks: weeks.map((monday) => ({
      monday,
      targets: byWeek.get(monday).sort((a, b) => a.sort_order - b.sort_order || a.target_id - b.target_id),
    })),
    entries: [...entries].sort((a, b) => a.date.localeCompare(b.date) || a.target_id - b.target_id),
    weighIns: weighIns.map((w) => ({ ...w, late: !!w.late })),
  };
}

/**
 * One row per day from the first week to today; one column per target (active first, then retired).
 * A combined target's column shows 1 on days any of that week's sources has an entry.
 */
export function exportCsv(repo, today) {
  const { targets, weeks, snapshots, entries, weighIns } = repo.allRows();
  const firsts = [weeks[0], entries.length ? mondayOf(entries.reduce((m, e) => (e.date < m ? e.date : m), entries[0].date)) : null, weighIns[0]?.monday_date]
    .filter(Boolean);
  const header = ['date', 'day', 'week', 'weigh-in kg', 'weigh-in st/lb', 'late',
    ...targets.map((t) => (t.unit ? `${t.name} (${t.unit})` : t.name))];
  const rows = [header];
  if (firsts.length) {
    const value = new Map(entries.map((e) => [`${e.date}|${e.target_id}`, e.value]));
    // Derived combined days, week by week (sources come from that week's snapshot).
    const snapByWeek = new Map();
    for (const sn of snapshots) (snapByWeek.get(sn.monday_date) ?? snapByWeek.set(sn.monday_date, []).get(sn.monday_date)).push(sn);
    const byWeek = new Map();
    for (const e of entries) {
      const m = mondayOf(e.date);
      if (!byWeek.has(m)) byWeek.set(m, {});
      (byWeek.get(m)[e.target_id] ??= {})[e.date] = e.value;
    }
    for (const [m, snap] of snapByWeek) {
      if (!snap.some((t) => t.kind === 'combined')) continue;
      const derived = withCombined(snap, byWeek.get(m) ?? {});
      for (const t of snap) if (t.kind === 'combined') for (const d of Object.keys(derived[t.id])) value.set(`${d}|${t.id}`, 1);
    }
    const wi = new Map(weighIns.map((w) => [w.monday_date, w]));
    for (let d = firsts.sort()[0], i = 0; d <= today; d = addDays(d, 1), i = (i + 1) % 7) {
      const w = i === 0 ? wi.get(d) : null;
      rows.push([d, DOW[i], mondayOf(d), w ? w.kg : '', w ? formatStLb(w.kg) : '', w?.late ? 'yes' : '',
        ...targets.map((t) => value.get(`${d}|${t.id}`) ?? '')]);
    }
  }
  return '﻿' + rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}

/** CSV-quote a cell; text starting with = + - @ gets a ' so spreadsheets don't run it as a formula. */
function cell(v) {
  if (typeof v === 'number') return String(v);
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
