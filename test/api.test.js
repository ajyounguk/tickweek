import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openDb, makeRepo } from '../src/db.js';
import { createApp } from '../src/app.js';

// Fixed clock: Wed 18 Nov 2026, 12:00 London.
let clock = new Date('2026-11-18T12:00:00Z');
let server;
let base;

before(async () => {
  const repo = makeRepo(openDb(':memory:'));
  server = createApp({ repo, now: () => clock }).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

async function call(method, url, body) {
  const res = await fetch(base + url, {
    method,
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json() };
}

test('health', async () => {
  assert.deepEqual((await call('GET', '/health')).body, { ok: true });
});

test('current week has the seeded targets and an edit window', async () => {
  const { body } = await call('GET', '/api/week');
  assert.equal(body.monday, '2026-11-16');
  assert.deepEqual(body.targets.map((t) => t.name), ['Intermittent fast', 'No snacks', 'Running', 'Weight training']);
  assert.deepEqual(body.days.map((d) => d.editable), [true, true, true, false, false, false, false]);
  assert.equal(body.days[2].isToday, true);
  assert.equal(body.score, 0);
  assert.equal(body.prevMonday, null);
  assert.equal(body.nextMonday, null);
});

test('ticks, numbers, score and locks', async () => {
  const { body: wk } = await call('GET', '/api/week');
  const [fast, , running] = wk.targets;

  assert.equal((await call('PUT', '/api/entry', { date: '2026-11-16', target_id: fast.id, value: 1 })).status, 200);
  const r = await call('PUT', '/api/entry', { date: '2026-11-17', target_id: running.id, value: 3.456 });
  assert.equal(r.body.value, 3.46);
  // future day is locked
  assert.equal((await call('PUT', '/api/entry', { date: '2026-11-19', target_id: fast.id, value: 1 })).status, 409);
  // tick values collapse to 1
  assert.equal((await call('PUT', '/api/entry', { date: '2026-11-17', target_id: fast.id, value: 7 })).body.value, 1);

  const { body } = await call('GET', '/api/week');
  // fast 2/7, snacks 0/7, running 1/3, weights 0/2 → 3/19
  assert.equal(body.score, Math.round((3 / 19) * 100));
  assert.equal(body.entries[running.id]['2026-11-17'], 3.46);

  // clearing (0) removes the entry
  await call('PUT', '/api/entry', { date: '2026-11-17', target_id: running.id, value: 0 });
  assert.equal((await call('GET', '/api/week')).body.entries[running.id], undefined);
});

test('last week stays open until this week’s weigh-in, then locks', async () => {
  const { body: wk } = await call('GET', '/api/week?monday=2026-11-09');
  assert.equal(wk.days[6].editable, true);
  const fast = wk.targets[0];
  assert.equal((await call('PUT', '/api/entry', { date: '2026-11-15', target_id: fast.id, value: 1 })).status, 200);

  const w = await call('PUT', '/api/weigh-in', { monday: '2026-11-16', kg: 90.5 });
  assert.equal(w.body.weighIn.late, 1, 'entered Wednesday = late');

  assert.equal((await call('PUT', '/api/entry', { date: '2026-11-14', target_id: fast.id, value: 1 })).status, 409);
  assert.equal((await call('GET', '/api/week?monday=2026-11-09')).body.days[6].editable, false);
  // last week's weigh-in is locked, this week's is not
  assert.equal((await call('PUT', '/api/weigh-in', { monday: '2026-11-09', kg: 91 })).status, 409);
});

test('corrections mode unlocks older weeks, and a correction keeps the late flag', async () => {
  await call('PUT', '/api/settings', { corrections: true });
  assert.equal((await call('PUT', '/api/weigh-in', { monday: '2026-11-09', kg: 92 })).status, 200);
  const { body: wk } = await call('GET', '/api/week?monday=2026-11-09');
  assert.equal(wk.days[0].editable, true);
  await call('PUT', '/api/settings', { corrections: false });

  const fix = await call('PUT', '/api/weigh-in', { monday: '2026-11-16', kg: 90.2 });
  assert.equal(fix.body.weighIn.kg, 90.2);
  assert.equal(fix.body.weighIn.entered_on, '2026-11-18');
});

test('target changes apply from the current week on; past snapshot is kept', async () => {
  const { body: targets } = await call('GET', '/api/targets');
  const running = targets.find((t) => t.name === 'Running');
  await call('PATCH', `/api/targets/${running.id}`, { goal_days: 4 });
  await call('POST', `/api/targets/${targets.find((t) => t.name === 'No snacks').id}/archive`);
  const added = await call('POST', '/api/targets', { name: 'Steps 10k', kind: 'tick', goal_days: 5 });
  assert.equal(added.status, 201);

  const now = (await call('GET', '/api/week')).body;
  assert.deepEqual(now.targets.map((t) => t.name), ['Intermittent fast', 'Running', 'Weight training', 'Steps 10k']);
  assert.equal(now.targets.find((t) => t.name === 'Running').goal_days, 4);

  const last = (await call('GET', '/api/week?monday=2026-11-09')).body;
  assert.equal(last.targets.length, 4);
  assert.equal(last.targets.find((t) => t.name === 'Running').goal_days, 3);
  assert.ok(last.targets.some((t) => t.name === 'No snacks'));
});

test('validation', async () => {
  assert.equal((await call('POST', '/api/targets', { name: '', kind: 'tick' })).status, 400);
  assert.equal((await call('POST', '/api/targets', { name: 'x', kind: 'tick', goal_days: 8 })).status, 400);
  assert.equal((await call('POST', '/api/targets', { name: 'x', kind: 'nope' })).status, 400);
  assert.equal((await call('PUT', '/api/weigh-in', { monday: '2026-11-17', kg: 90 })).status, 400);
  assert.equal((await call('PUT', '/api/weigh-in', { monday: '2026-11-16', kg: 5 })).status, 400);
  assert.equal((await call('GET', '/api/week?monday=2026-11-23')).status, 400);
  assert.equal((await call('PUT', '/api/entry', { date: 'nope', target_id: 1, value: 1 })).status, 400);
});

test('a new week takes a fresh snapshot and keeps history navigable', async () => {
  clock = new Date('2026-11-23T08:00:00Z'); // next Monday
  const { body } = await call('GET', '/api/week');
  assert.equal(body.monday, '2026-11-23');
  assert.equal(body.prevMonday, '2026-11-16');
  assert.equal(body.prevWeighIn.kg, 90.2);
  assert.equal(body.weighInEditable, true);
  const w = await call('PUT', '/api/weigh-in', { monday: '2026-11-23', kg: 89.9 });
  assert.equal(w.body.weighIn.late, 0, 'Monday weigh-in is on time');
});

test('week carries streaks and weight records; history lists weeks newest first', async () => {
  const { body } = await call('GET', '/api/week');
  assert.deepEqual(body.losing, { current: 2, longest: 2 }, '92 → 90.2 → 89.9');
  assert.deepEqual(body.personalBest, { kg: 89.9, monday: '2026-11-23' });
  assert.ok(body.targets.every((t) => typeof t.streak === 'number' && ['days', 'weeks'].includes(t.streakUnit)));
  assert.ok(Array.isArray(body.fullDays));

  const { status, body: h } = await call('GET', '/api/history');
  assert.equal(status, 200);
  assert.deepEqual(h.weeks.map((w) => w.monday), ['2026-11-23', '2026-11-16', '2026-11-09']);
  assert.equal(h.weeks[0].ddmm, '23/11');
  assert.equal(h.weeks[0].days.length, 7);
  assert.equal(h.weighIns.length, 3);
  assert.ok('records' in h && 'targets' in h);
});

test('export: JSON has everything, CSV has one row per day', async () => {
  const j = await fetch(`${base}/api/export.json`);
  assert.equal(j.status, 200);
  assert.match(j.headers.get('content-disposition'), /^attachment; filename="?tickweek-2026-11-23\.json"?$/);
  const data = await j.json();
  assert.equal(data.weightUnit, 'kg');
  assert.equal(data.targets.length, 5, 'retired targets included');
  assert.deepEqual(data.weeks.map((w) => w.monday), ['2026-11-09', '2026-11-16', '2026-11-23']);
  const running = data.targets.find((t) => t.name === 'Running');
  assert.equal(data.weeks[0].targets.find((t) => t.target_id === running.id).goal_days, 3, 'per-week goals kept');
  assert.deepEqual(data.weighIns.map((w) => [w.monday_date, w.kg, w.late]), [['2026-11-09', 92, true], ['2026-11-16', 90.2, true], ['2026-11-23', 89.9, false]]);
  assert.equal(data.entries.length, 3);

  const c = await fetch(`${base}/api/export.csv`);
  assert.equal(c.status, 200);
  assert.match(c.headers.get('content-type'), /^text\/csv/);
  assert.match(c.headers.get('content-disposition'), /tickweek-2026-11-23\.csv/);
  const lines = (await c.text()).replace(/^﻿/, '').trimEnd().split('\r\n');
  assert.equal(lines[0], 'date,day,week,weigh-in kg,weigh-in st/lb,late,Intermittent fast,Running (miles),Weight training (min),Steps 10k,No snacks');
  assert.equal(lines.length, 1 + 15, '09/11 to 23/11');
  assert.equal(lines[1], '2026-11-09,Mon,2026-11-09,92,14 st 6.8 lb,yes,,,,,');
  assert.equal(lines[7], '2026-11-15,Sun,2026-11-09,,,,1,,,,');
  assert.equal(lines.at(-1), '2026-11-23,Mon,2026-11-23,89.9,14 st 2.2 lb,,,,,,');
});
