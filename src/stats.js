// Game layer, computed from the raw tables (design.md: nothing here is stored).
// Pure: takes plain rows + today, returns plain objects. Data is small (one row per week), so recompute per request.
import { addDays, mondayOf, weekDates } from './dates.js';
import { daysDone, weekScore, isCleanSweep } from './scoring.js';

/**
 * Day streak for a 7/7 target. `done` is a Set of ISO dates with value > 0.
 * Current: counts back from today; if today isn't done yet it's "in progress", so count from yesterday.
 */
export function dayStreak(done, today) {
  let current = 0;
  let d = done.has(today) ? today : addDays(today, -1);
  while (done.has(d)) { current++; d = addDays(d, -1); }

  let longest = 0, run = 0, prev = null;
  for (const date of [...done].filter((x) => x <= today).sort()) {
    run = prev && addDays(prev, 1) === date ? run + 1 : 1;
    longest = Math.max(longest, run);
    prev = date;
  }
  return { current, longest };
}

/**
 * Week streak for an N/7 target. `met(monday)` → true/false for each week; weeks are walked Monday by Monday, so a
 * week with no record (or without the target) breaks it. The current week only counts once its goal is met.
 */
export function weekStreak(met, firstMonday, currentMonday) {
  let longest = 0, run = 0;
  for (let m = firstMonday; m <= currentMonday; m = addDays(m, 7)) {
    if (met(m)) { run++; longest = Math.max(longest, run); }
    else if (m !== currentMonday) run = 0;
  }
  // `run` is now the current streak: it includes this week if met, and otherwise wasn't reset by it (in progress).
  return { current: firstMonday ? run : 0, longest };
}

/**
 * Losing streak: consecutive weekly weigh-ins, each lower than the one before. Same weight = neither extends nor
 * breaks; a missing week breaks. The current streak survives this week's weigh-in not being in yet.
 * weighIns: [{ monday_date, kg }] in date order.
 */
export function losingStreak(weighIns, currentMonday) {
  let run = 0, longest = 0, prev = null;
  for (const w of weighIns) {
    if (!prev || addDays(prev.monday_date, 7) !== w.monday_date) run = 0;
    else if (w.kg < prev.kg) run++;
    else if (w.kg > prev.kg) run = 0;
    longest = Math.max(longest, run);
    prev = w;
  }
  const last = prev?.monday_date;
  const alive = last && (last === currentMonday || last === addDays(currentMonday, -7));
  return { current: alive ? run : 0, longest };
}

/** Dates in the week on which every 7/7 target of that week's snapshot is done (none if it has no 7/7 targets). */
export function fullDays(targets, entries, dates) {
  const daily = targets.filter((t) => t.goal_days === 7);
  if (!daily.length) return [];
  return dates.filter((d) => daily.every((t) => entries[t.id]?.[d] > 0));
}

/**
 * Build everything the UI needs from the raw rows.
 * rows: { targets, weeks: [monday], snapshots: [{ monday_date, id, name, kind, unit, goal_days, sort_order }],
 *         entries: [{ date, target_id, value }], weighIns: [{ monday_date, kg, entered_on, late }] }
 */
export function buildStats(rows, today) {
  const currentMonday = mondayOf(today);
  const weeksAsc = [...rows.weeks].sort();
  const firstMonday = weeksAsc[0] ?? null;

  // entries by target → date → value, and by week → target → date → value
  const byTarget = new Map();
  const byWeek = new Map();
  for (const e of rows.entries) {
    if (!byTarget.has(e.target_id)) byTarget.set(e.target_id, new Map());
    byTarget.get(e.target_id).set(e.date, e.value);
    const m = mondayOf(e.date);
    if (!byWeek.has(m)) byWeek.set(m, {});
    (byWeek.get(m)[e.target_id] ??= {})[e.date] = e.value;
  }
  const snapByWeek = new Map();
  for (const s of rows.snapshots) {
    if (!snapByWeek.has(s.monday_date)) snapByWeek.set(s.monday_date, []);
    snapByWeek.get(s.monday_date).push(s);
  }
  for (const list of snapByWeek.values()) list.sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);
  const weighByWeek = new Map(rows.weighIns.map((w) => [w.monday_date, w]));

  // ---- weeks ----
  const weeks = weeksAsc.map((monday) => {
    const targets = snapByWeek.get(monday) ?? [];
    const entries = byWeek.get(monday) ?? {};
    const dates = weekDates(monday);
    return {
      monday,
      current: monday === currentMonday,
      targets: targets.map((t) => ({ id: t.id, name: t.name, kind: t.kind, unit: t.unit, goal_days: t.goal_days, done: daysDone(entries[t.id]) })),
      entries,
      score: weekScore(targets, entries),
      cleanSweep: isCleanSweep(targets, entries),
      fullDays: fullDays(targets, entries, dates.filter((d) => d <= today)),
      weighIn: weighByWeek.get(monday) ?? null,
    };
  });
  const weekMap = new Map(weeks.map((w) => [w.monday, w]));

  // ---- per target ----
  const targets = rows.targets.map((t) => {
    const values = byTarget.get(t.id) ?? new Map();
    const doneDates = new Set([...values].filter(([, v]) => v > 0).map(([d]) => d));
    let total = 0;
    for (const v of values.values()) total += v;
    const daily = t.goal_days === 7;
    const streak = daily
      ? dayStreak(doneDates, today)
      : weekStreak((m) => {
          const wk = weekMap.get(m);
          const st = wk?.targets.find((x) => x.id === t.id);
          return !!st && st.done >= st.goal_days;
        }, firstMonday, currentMonday);
    return {
      id: t.id, name: t.name, kind: t.kind, unit: t.unit, goal_days: t.goal_days, archived: !!t.archived_at,
      streakUnit: daily ? 'days' : 'weeks',
      streak,
      daysDone: doneDates.size,
      total: t.kind === 'number' ? Math.round(total * 100) / 100 : null,
    };
  });

  // ---- weight ----
  const weighIns = [...rows.weighIns].sort((a, b) => (a.monday_date < b.monday_date ? -1 : 1));
  const best = weighIns.reduce((b, w) => (!b || w.kg < b.kg ? w : b), null);
  const closed = weeks.filter((w) => !w.current && w.score != null);

  return {
    today,
    currentMonday,
    weeks,
    targets,
    weighIns,
    losing: losingStreak(weighIns, currentMonday),
    records: {
      personalBest: best ? { kg: best.kg, monday: best.monday_date } : null,
      startKg: weighIns[0]?.kg ?? null,
      latestKg: weighIns.at(-1)?.kg ?? null,
      bestScore: closed.length ? Math.max(...closed.map((w) => w.score)) : null,
      cleanSweeps: closed.filter((w) => w.cleanSweep).length,
      fullDays: weeks.reduce((n, w) => n + w.fullDays.length, 0),
      weeksTracked: weeks.length,
    },
  };
}
