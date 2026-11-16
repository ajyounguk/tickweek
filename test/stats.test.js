import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dayStreak, weekStreak, losingStreak, fullDays, buildStats } from '../src/stats.js';

const set = (...d) => new Set(d);

test('day streak: today pending, today done, gaps, longest', () => {
  const today = '2026-11-18';
  // done Mon, Tue; today (Wed) not yet → current 2 (in progress)
  assert.deepEqual(dayStreak(set('2026-11-16', '2026-11-17'), today), { current: 2, longest: 2 });
  // done today too → 3
  assert.deepEqual(dayStreak(set('2026-11-16', '2026-11-17', '2026-11-18'), today), { current: 3, longest: 3 });
  // missed yesterday → current 0 (today not done), longest from the older run
  assert.deepEqual(dayStreak(set('2026-11-10', '2026-11-11', '2026-11-12', '2026-11-16'), today), { current: 0, longest: 3 });
  // run across a month boundary
  assert.deepEqual(dayStreak(set('2026-10-31', '2026-11-01'), '2026-11-01'), { current: 2, longest: 2 });
  assert.deepEqual(dayStreak(set(), today), { current: 0, longest: 0 });
});

test('week streak: current week only counts once met, gaps break', () => {
  const met = (weeks) => (m) => weeks.includes(m);
  // met 02/11, 09/11; this week (16/11) not met yet → current 2 (in progress)
  assert.deepEqual(weekStreak(met(['2026-11-02', '2026-11-09']), '2026-11-02', '2026-11-16'), { current: 2, longest: 2 });
  // this week met already → 3
  assert.deepEqual(weekStreak(met(['2026-11-02', '2026-11-09', '2026-11-16']), '2026-11-02', '2026-11-16'), { current: 3, longest: 3 });
  // last week missed → 0
  assert.deepEqual(weekStreak(met(['2026-10-26', '2026-11-02']), '2026-10-26', '2026-11-16'), { current: 0, longest: 2 });
  assert.deepEqual(weekStreak(() => false, null, '2026-11-16'), { current: 0, longest: 0 });
});

test('losing streak: lower extends, same holds, higher or a missing week breaks', () => {
  const w = (monday_date, kg) => ({ monday_date, kg });
  const cur = '2026-11-30';
  assert.deepEqual(losingStreak([w('2026-11-02', 100), w('2026-11-09', 99), w('2026-11-16', 99), w('2026-11-23', 98), w('2026-11-30', 97.5)], cur), { current: 3, longest: 3 });
  // higher breaks
  assert.deepEqual(losingStreak([w('2026-11-02', 100), w('2026-11-09', 99), w('2026-11-16', 99.5), w('2026-11-23', 99)], cur), { current: 1, longest: 1 });
  // missing week (16/11) breaks
  assert.deepEqual(losingStreak([w('2026-11-02', 100), w('2026-11-09', 99), w('2026-11-23', 98)], cur), { current: 0, longest: 1 });
  // this week not weighed yet: last week's streak still alive
  assert.deepEqual(losingStreak([w('2026-11-16', 100), w('2026-11-23', 99)], cur), { current: 1, longest: 1 });
  // last weigh-in two weeks ago: broken
  assert.deepEqual(losingStreak([w('2026-11-09', 100), w('2026-11-16', 99)], cur), { current: 0, longest: 1 });
  assert.deepEqual(losingStreak([], cur), { current: 0, longest: 0 });
});

test('full day = every 7/7 target done that day', () => {
  const targets = [{ id: 1, goal_days: 7 }, { id: 2, goal_days: 7 }, { id: 3, goal_days: 3 }];
  const entries = { 1: { '2026-11-16': 1, '2026-11-17': 1 }, 2: { '2026-11-16': 1 }, 3: {} };
  assert.deepEqual(fullDays(targets, entries, ['2026-11-16', '2026-11-17']), ['2026-11-16']);
  assert.deepEqual(fullDays([{ id: 3, goal_days: 3 }], entries, ['2026-11-16']), [], 'no 7/7 targets → no full days');
});

test('buildStats pulls it together', () => {
  const rows = {
    targets: [
      { id: 1, name: 'Fast', kind: 'tick', unit: null, goal_days: 7, archived_at: null },
      { id: 2, name: 'Run', kind: 'number', unit: 'miles', goal_days: 2, archived_at: null },
    ],
    weeks: ['2026-11-09', '2026-11-16'],
    snapshots: ['2026-11-09', '2026-11-16'].flatMap((m) => [
      { monday_date: m, id: 1, name: 'Fast', kind: 'tick', unit: null, goal_days: 7, sort_order: 1 },
      { monday_date: m, id: 2, name: 'Run', kind: 'number', unit: 'miles', goal_days: 2, sort_order: 2 },
    ]),
    entries: [
      ...['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15', '2026-11-16', '2026-11-17']
        .map((date) => ({ date, target_id: 1, value: 1 })),
      { date: '2026-11-10', target_id: 2, value: 3 },
      { date: '2026-11-12', target_id: 2, value: 2.5 },
      { date: '2026-11-17', target_id: 2, value: 4 },
    ],
    weighIns: [{ monday_date: '2026-11-09', kg: 92 }, { monday_date: '2026-11-16', kg: 91.2 }],
  };
  const s = buildStats(rows, '2026-11-18');
  const fast = s.targets.find((t) => t.id === 1);
  const run = s.targets.find((t) => t.id === 2);
  assert.deepEqual(fast.streak, { current: 9, longest: 9 });
  assert.equal(fast.streakUnit, 'days');
  assert.deepEqual(run.streak, { current: 1, longest: 1 }, 'last week met, this week in progress (1 of 2)');
  assert.equal(run.total, 9.5);
  assert.equal(s.weeks[0].cleanSweep, true);
  assert.equal(s.weeks[0].score, 100);
  assert.equal(s.weeks[0].fullDays.length, 7);
  assert.deepEqual(s.losing, { current: 1, longest: 1 });
  assert.deepEqual(s.records.personalBest, { kg: 91.2, monday: '2026-11-16' });
  assert.equal(s.records.bestScore, 100);
  assert.equal(s.records.cleanSweeps, 1);
  assert.equal(s.records.fullDays, 9);
});
