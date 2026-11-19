// Combined targets tick themselves: a day is done when any of their sources has an entry that day
// (a run and weights on the same day = 1 day). Shared with the browser, served as /js/combined.js.

/**
 * `entries` plus a derived { [date]: 1 } for each combined target in `targets` (one week's snapshot, so the
 * sources are that week's). Raw entries for combined targets are never stored; anything there is replaced.
 * targets: [{ id, kind, part_of }], entries: { [targetId]: { [date]: value } }
 */
export function withCombined(targets, entries) {
  const out = { ...entries };
  for (const t of targets) {
    if (t.kind !== 'combined') continue;
    const days = {};
    for (const s of targets) {
      if (s.part_of !== t.id) continue;
      for (const [date, v] of Object.entries(entries[s.id] ?? {})) if (v > 0) days[date] = 1;
    }
    out[t.id] = days;
  }
  return out;
}

/** Display order: each combined target directly below its sources, at the combined target's own place. */
export function grouped(targets) {
  const has = new Set(targets.map((t) => t.id));
  const out = [];
  for (const t of targets) {
    if (t.part_of && has.has(t.part_of)) continue; // drawn with its combined target
    if (t.kind === 'combined') out.push(...targets.filter((s) => s.part_of === t.id));
    out.push(t);
  }
  return out;
}
