import { test } from 'node:test';
import assert from 'node:assert/strict';
import { todayISO, mondayOf, addDays, weekDates, ddmm, isISODate, canEditDate, canEditWeighIn } from '../src/dates.js';
import { stLbToKg, kgToStLb, formatStLb } from '../src/weight.js';
import { weekScore, isCleanSweep, goalProgress } from '../src/scoring.js';

test('todayISO uses Europe/London, not UTC', () => {
  // 23:30 UTC on 30 Jun = 00:30 BST on 1 Jul
  assert.equal(todayISO(new Date('2026-06-30T23:30:00Z')), '2026-07-01');
  // winter: GMT = UTC
  assert.equal(todayISO(new Date('2026-11-16T23:30:00Z')), '2026-11-16');
});

test('mondayOf / weekDates / addDays across month, year and DST', () => {
  assert.equal(mondayOf('2026-11-16'), '2026-11-16'); // Monday
  assert.equal(mondayOf('2026-11-22'), '2026-11-16'); // Sunday
  assert.equal(mondayOf('2027-01-01'), '2026-12-28');
  assert.equal(mondayOf('2026-03-29'), '2026-03-23'); // DST change Sunday
  assert.deepEqual(weekDates('2026-12-28').at(-1), '2027-01-03');
  assert.equal(addDays('2026-10-25', 1), '2026-10-26');
  assert.equal(ddmm('2026-11-16'), '16/11');
});

test('isISODate rejects junk and impossible dates', () => {
  assert.ok(isISODate('2026-02-28'));
  assert.ok(!isISODate('2026-02-30'));
  assert.ok(!isISODate('16/11/2026'));
  assert.ok(!isISODate(undefined));
});

test('edit window', () => {
  const today = '2026-11-18'; // Wed
  assert.ok(canEditDate('2026-11-16', today));
  assert.ok(canEditDate('2026-11-18', today));
  assert.ok(!canEditDate('2026-11-19', today), 'no future');
  assert.ok(canEditDate('2026-11-15', today), 'last week open before weigh-in');
  assert.ok(!canEditDate('2026-11-15', today, { thisWeekWeighedIn: true }), 'last week locks after weigh-in');
  assert.ok(!canEditDate('2026-11-08', today), 'older locked');
  assert.ok(canEditDate('2026-11-08', today, { corrections: true }));
  assert.ok(!canEditDate('2026-11-19', today, { corrections: true }), 'corrections never allow future');
  assert.ok(canEditWeighIn('2026-11-16', today));
  assert.ok(!canEditWeighIn('2026-11-09', today));
  assert.ok(canEditWeighIn('2026-11-09', today, { corrections: true }));
  assert.ok(!canEditWeighIn('2026-11-23', today, { corrections: true }));
});

test('stone/lb conversion round-trips to 0.1 lb', () => {
  assert.deepEqual(kgToStLb(stLbToKg(14, 3.4)), { st: 14, lb: 3.4 });
  assert.deepEqual(kgToStLb(stLbToKg(12, 0)), { st: 12, lb: 0 });
  assert.deepEqual(kgToStLb(stLbToKg(11, 13.96)), { st: 12, lb: 0 }, 'carries 14.0 lb');
  assert.equal(formatStLb(stLbToKg(14, 3.4)), '14 st 3.4 lb');
  assert.equal(formatStLb(stLbToKg(1, 2)), '1 st 2 lb');
  assert.equal(formatStLb(stLbToKg(0, 1.5)), '1.5 lb');
  assert.equal(formatStLb(-stLbToKg(0, 2)), '-2 lb');
  assert.ok(Math.abs(stLbToKg(14, 0) - 88.904) < 0.001);
});

test('week score caps each target at its goal', () => {
  const targets = [{ id: 1, goal_days: 7 }, { id: 2, goal_days: 3 }];
  const full = Object.fromEntries(weekDates('2026-11-16').map((d) => [d, 1]));
  // target 1: 7/7, target 2: 5 days (over goal of 3) → (7+3)/10
  const entries = { 1: full, 2: { '2026-11-16': 2, '2026-11-17': 1, '2026-11-18': 3, '2026-11-19': 1, '2026-11-20': 1 } };
  assert.equal(weekScore(targets, entries), 100);
  assert.ok(isCleanSweep(targets, entries));
  // target 1: 3 days, target 2: 1 day → (3+1)/10
  const partial = { 1: { '2026-11-16': 1, '2026-11-17': 1, '2026-11-18': 1 }, 2: { '2026-11-16': 2 } };
  assert.equal(weekScore(targets, partial), 40);
  assert.ok(!isCleanSweep(targets, partial));
  assert.equal(weekScore([], {}), null);
  assert.ok(!isCleanSweep([], {}));
});

test('goal progress', () => {
  assert.deepEqual(goalProgress(100, 95, 90), { toGoKg: 5, pct: 50 });
  assert.deepEqual(goalProgress(100, 89, 90), { toGoKg: 0, pct: 100 });
  assert.deepEqual(goalProgress(100, 102, 90), { toGoKg: 12, pct: 0 });
  assert.equal(goalProgress(100, null, 90), null);
});
