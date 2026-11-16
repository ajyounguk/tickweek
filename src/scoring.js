// Pure scoring helpers. Streaks/records arrive in M2.

/** Days done per target: number of dates in the week with value > 0. */
export function daysDone(entriesForTarget = {}) {
  return Object.values(entriesForTarget).filter((v) => v > 0).length;
}

/**
 * Week score % = Σ min(done, goal) ÷ Σ goals (over the week's snapshot). null if the week has no goals.
 * targets: [{ id, goal_days }], entries: { [targetId]: { [date]: value } }
 */
export function weekScore(targets, entries) {
  let got = 0;
  let max = 0;
  for (const t of targets) {
    got += Math.min(daysDone(entries[t.id]), t.goal_days);
    max += t.goal_days;
  }
  return max ? Math.round((got / max) * 100) : null;
}

export function isCleanSweep(targets, entries) {
  return targets.length > 0 && targets.every((t) => daysDone(entries[t.id]) >= t.goal_days);
}

/** Goal progress from the first weigh-in towards the goal: { toGoKg, pct } or null. */
export function goalProgress(startKg, currentKg, goalKg) {
  if (goalKg == null || currentKg == null) return null;
  const toGoKg = Math.max(0, currentKg - goalKg);
  const span = startKg != null ? startKg - goalKg : 0;
  const pct = span > 0 ? Math.min(100, Math.max(0, Math.round(((startKg - currentKg) / span) * 100))) : currentKg <= goalKg ? 100 : 0;
  return { toGoKg, pct };
}
