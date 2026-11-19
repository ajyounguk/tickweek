import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { openDb, makeRepo, SCHEMA_VERSION } from '../src/db.js';
import { createApp } from '../src/app.js';
import { withCombined, grouped } from '../src/combined.js';
import { weekScore, isCleanSweep } from '../src/scoring.js';
import { buildStats } from '../src/stats.js';

// Fixed clock: Wed 18 Nov 2026, 12:00 London.
const clock = new Date('2026-11-18T12:00:00Z');
let server, base;

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
  const text = await res.text();
  return { status: res.status, body: res.headers.get('content-type')?.includes('json') ? JSON.parse(text) : text };
}
const byName = async (name) => (await call('GET', '/api/targets')).body.find((t) => t.name === name);

// ---------- pure ----------
test('withCombined: a day counts once whichever sources were done', () => {
  const targets = [{ id: 1, kind: 'number', part_of: 3 }, { id: 2, kind: 'number', part_of: 3 }, { id: 3, kind: 'combined' }, { id: 4, kind: 'tick' }];
  const entries = { 1: { '2026-11-16': 3, '2026-11-18': 2 }, 2: { '2026-11-17': 45, '2026-11-18': 30 }, 4: { '2026-11-16': 1 } };
  const out = withCombined(targets, entries);
  assert.deepEqual(out[3], { '2026-11-16': 1, '2026-11-17': 1, '2026-11-18': 1 });
  assert.equal(out[1], entries[1], 'sources untouched');
  assert.deepEqual(grouped([{ id: 3, kind: 'combined' }, { id: 4 }, { id: 1, part_of: 3 }, { id: 2, part_of: 3 }]).map((t) => t.id), [1, 2, 3, 4]);
});

test('scoring leaves out targets with no goal', () => {
  const targets = [{ id: 1, goal_days: 7 }, { id: 2, goal_days: null }, { id: 3, goal_days: 2 }];
  const entries = { 1: { a: 1 }, 2: { a: 1, b: 1 }, 3: { a: 1, b: 1 } };
  assert.equal(weekScore(targets, entries), Math.round((3 / 9) * 100));
  assert.equal(isCleanSweep([{ id: 2, goal_days: null }, { id: 3, goal_days: 2 }], entries), true);
  assert.equal(isCleanSweep([{ id: 2, goal_days: null }], entries), false, 'nothing scored → no perfect week');
});

test('a fresh database starts with Exercise; one from another version is refused and left alone', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tickweek-'));
  try {
    const fresh = openDb(path.join(dir, 'new.db'));
    assert.equal(fresh.pragma('user_version', { simple: true }), SCHEMA_VERSION);
    assert.deepEqual(fresh.prepare('SELECT name, kind, goal_days, part_of FROM target ORDER BY sort_order').all().map((t) => Object.values(t)),
      [['Intermittent fast', 'tick', 7, null], ['No snacks', 'tick', 7, null], ['Running', 'number', null, 5], ['Weight training', 'number', null, 5], ['Exercise', 'combined', 4, null]]);
    fresh.close();

    const oldFile = path.join(dir, 'old.db');
    const old = new Database(oldFile);
    old.exec("CREATE TABLE target (id INTEGER PRIMARY KEY, name TEXT); INSERT INTO target VALUES (1, 'kept');");
    old.pragma('user_version = 1');
    old.close();
    assert.throws(() => openDb(oldFile), /another Tickweek version \(schema 1.*Move it aside/);
    const check = new Database(oldFile, { readonly: true });
    assert.equal(check.prepare('SELECT name FROM target').pluck().get(), 'kept');
    assert.equal(check.pragma('user_version', { simple: true }), 1);
    check.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('buildStats: combined target scores and streaks; its sources have none', () => {
  const snap = (m) => [
    { monday_date: m, id: 1, name: 'Run', kind: 'number', unit: 'miles', goal_days: null, sort_order: 1, part_of: 3 },
    { monday_date: m, id: 2, name: 'Weights', kind: 'number', unit: 'min', goal_days: null, sort_order: 2, part_of: 3 },
    { monday_date: m, id: 3, name: 'Exercise', kind: 'combined', unit: null, goal_days: 2, sort_order: 3, part_of: null },
  ];
  const s = buildStats({
    targets: [
      { id: 1, name: 'Run', kind: 'number', unit: 'miles', goal_days: null, part_of: 3, archived_at: null },
      { id: 2, name: 'Weights', kind: 'number', unit: 'min', goal_days: null, part_of: 3, archived_at: null },
      { id: 3, name: 'Exercise', kind: 'combined', unit: null, goal_days: 2, part_of: null, archived_at: null },
    ],
    weeks: ['2026-11-09', '2026-11-16'],
    snapshots: [...snap('2026-11-09'), ...snap('2026-11-16')],
    entries: [
      { date: '2026-11-10', target_id: 1, value: 3 }, { date: '2026-11-10', target_id: 2, value: 40 }, // same day: 1
      { date: '2026-11-12', target_id: 2, value: 30 },
      { date: '2026-11-17', target_id: 1, value: 2 },
    ],
    weighIns: [],
  }, '2026-11-18');
  assert.equal(s.weeks[0].targets.find((t) => t.id === 3).done, 2);
  assert.equal(s.weeks[0].score, 100);
  assert.equal(s.weeks[0].cleanSweep, true);
  assert.equal(s.weeks[1].score, 50);
  const ex = s.targets.find((t) => t.id === 3);
  assert.deepEqual(ex.streak, { current: 1, longest: 1 });
  assert.equal(ex.daysDone, 3);
  assert.deepEqual(s.targets.find((t) => t.id === 1).streak, { current: 0, longest: 0 });
  assert.equal(s.targets.find((t) => t.id === 1).total, 5);
});

// ---------- API ----------
test('combined target: derive, score, protect, validate', async () => {
  // Last week exists first: its snapshot stays as it was whatever changes this week.
  assert.equal((await call('GET', '/api/week?monday=2026-11-09')).status, 200);
  const running = await byName('Running'), weights = await byName('Weight training');
  const ex = await byName('Exercise'), fast = await byName('Intermittent fast');
  assert.equal(running.part_of, ex.id);

  assert.equal((await call('POST', '/api/targets', { name: 'Cardio', kind: 'combined', goal_days: 4 })).status, 400, 'needs sources');
  assert.equal((await call('POST', '/api/targets', { name: 'Cardio', kind: 'combined', goal_days: null, sources: [running.id] })).status, 400, 'needs a goal');
  assert.equal((await call('POST', '/api/targets', { name: 'Cardio', kind: 'combined', goal_days: 2, sources: [ex.id] })).status, 400, 'no nesting');
  assert.equal((await call('PATCH', `/api/targets/${running.id}`, { goal_days: 3 })).status, 400, 'a source has no goal of its own');
  assert.equal((await call('PATCH', `/api/targets/${running.id}`, { name: 'Run' })).status, 200, 'but can be renamed');

  // Mon run, Tue weights, Wed both → 3 Exercise days (Wed counts once).
  for (const [date, id, value] of [['2026-11-16', running.id, 3], ['2026-11-17', weights.id, 45], ['2026-11-18', running.id, 2.4], ['2026-11-18', weights.id, 30], ['2026-11-16', fast.id, 1]]) {
    assert.equal((await call('PUT', '/api/entry', { date, target_id: id, value })).status, 200);
  }
  assert.equal((await call('PUT', '/api/entry', { date: '2026-11-18', target_id: ex.id, value: 1 })).status, 400, 'not tappable');

  const wk = (await call('GET', '/api/week')).body;
  assert.equal(wk.targets.find((t) => t.id === ex.id).done, 3);
  assert.deepEqual(Object.keys(wk.entries[ex.id]).sort(), ['2026-11-16', '2026-11-17', '2026-11-18']);
  // fast 1/7 + snacks 0/7 + Exercise 3/4; the sources don't count
  assert.equal(wk.score, Math.round((4 / 18) * 100));

  // Export: CSV column for Exercise, JSON format 2 with part_of.
  const csv = (await call('GET', '/api/export.csv')).body.replace(/^﻿/, '').trimEnd().split('\r\n');
  const col = csv[0].split(',').indexOf('Exercise');
  assert.ok(col > 0);
  assert.deepEqual(csv.slice(-3).map((l) => l.split(',')[col]), ['1', '1', '1']);
  const json = (await call('GET', '/api/export.json')).body;
  assert.equal(json.format, 2);
  assert.equal(json.targets.find((t) => t.id === running.id).part_of, ex.id);
  assert.equal(json.weeks.find((w) => w.monday === '2026-11-16').targets.find((t) => t.target_id === running.id).part_of, ex.id);
});

test('combined target: add one, change sources, retire', async () => {
  const fast = await byName('Intermittent fast'), snacks = await byName('No snacks');
  const made = await call('POST', '/api/targets', { name: 'Habits', kind: 'combined', goal_days: 5, sources: [fast.id, snacks.id] });
  assert.equal(made.status, 201);
  assert.equal((await byName('No snacks')).goal_days, null, 'a new source loses its goal');

  const ex = await byName('Exercise'), running = await byName('Run'), weights = await byName('Weight training');
  assert.equal((await call('PATCH', `/api/targets/${ex.id}`, { sources: [] })).status, 400);
  assert.equal((await call('PATCH', `/api/targets/${ex.id}`, { sources: [running.id], goal_days: 2 })).status, 200);
  assert.equal((await byName('Weight training')).part_of, null, 'dropped source leaves');
  assert.equal((await byName('Weight training')).goal_days, null, '…with no goal until one is set');
  assert.equal((await call('PATCH', `/api/targets/${weights.id}`, { goal_days: 2 })).status, 200);

  assert.equal((await call('POST', `/api/targets/${ex.id}/archive`)).status, 200);
  const r = await byName('Run');
  assert.equal(r.part_of, null);
  assert.equal(r.goal_days, null);
  const wk = (await call('GET', '/api/week')).body;
  assert.ok(!wk.targets.some((t) => t.id === ex.id));

  const last = (await call('GET', '/api/week?monday=2026-11-09')).body;
  assert.equal(last.targets.find((t) => t.id === running.id).part_of, ex.id, 'past week keeps its grouping');
  assert.equal(last.targets.find((t) => t.id === snacks.id).goal_days, 7, '…and its goals');
});
