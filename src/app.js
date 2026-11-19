import express from 'express';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { todayISO, isISODate, mondayOf, addDays, weekDates, ddmm, canEditDate, canEditWeighIn } from './dates.js';
import { daysDone, weekScore, isCleanSweep } from './scoring.js';
import { buildStats, fullDays } from './stats.js';
import { exportJson, exportCsv } from './export.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const { version } = JSON.parse(readFileSync(path.join(here, '..', 'package.json'), 'utf8'));
const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

class BadRequest extends Error {
  constructor(msg, status = 400) { super(msg); this.status = status; }
}
const fail = (msg, status) => { throw new BadRequest(msg, status); };

/** createApp({ repo, now }) — `now` is injectable so tests can fix the clock. */
export function createApp({ repo, now = () => new Date() }) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '16kb' }));

  const corrections = () => repo.getSetting('corrections_mode') === '1';
  const thisMonday = () => mondayOf(todayISO(now()));

  // The current week always exists, so target changes and the edit window have something to work on.
  app.use('/api', (req, res, next) => { repo.ensureWeek(thisMonday()); next(); });

  app.get('/health', (req, res) => res.json({ ok: true, version }));

  // ---------- week ----------
  app.get('/api/week', (req, res) => {
    const today = todayISO(now());
    const current = mondayOf(today);
    const monday = req.query.monday ?? current;
    if (!isISODate(monday) || mondayOf(monday) !== monday) fail('monday must be a Monday (YYYY-MM-DD)');
    if (monday > current) fail('that week has not started yet');

    const thisWeighedIn = !!repo.weighIn(current);
    const edit = { thisWeekWeighedIn: thisWeighedIn, corrections: corrections() };
    // Create a past week only if it's editable (so its snapshot is taken from today's targets, the best we have).
    if (!repo.weekExists(monday) && weekDates(monday).some((d) => canEditDate(d, today, edit))) repo.ensureWeek(monday);

    const targets = repo.weekTargets(monday);
    const entries = repo.weekEntries(monday);
    const weighIn = repo.weighIn(monday);
    const prev = repo.prevWeighIn(monday);
    const first = repo.firstWeighIn();
    const latest = repo.latestWeighIn(monday);
    const goal = repo.getSetting('goal_kg');
    const firstWeek = repo.firstWeek();

    const stats = buildStats(repo.allRows(), today);
    const tStats = new Map(stats.targets.map((t) => [t.id, t]));

    res.json({
      today,
      monday,
      current: monday === current,
      prevMonday: firstWeek && addDays(monday, -7) >= firstWeek ? addDays(monday, -7) : null,
      nextMonday: monday < current ? addDays(monday, 7) : null,
      days: weekDates(monday).map((date, i) => ({
        date, ddmm: ddmm(date), dow: DOW[i], isToday: date === today, future: date > today,
        editable: canEditDate(date, today, edit),
      })),
      targets: targets.map((t) => ({
        ...t,
        done: daysDone(entries[t.id]),
        streak: tStats.get(t.id)?.streak.current ?? 0,
        streakUnit: tStats.get(t.id)?.streakUnit ?? 'days',
      })),
      fullDays: fullDays(targets, entries, weekDates(monday).filter((d) => d <= today)),
      losing: stats.losing,
      personalBest: stats.records.personalBest,
      entries,
      score: weekScore(targets, entries),
      cleanSweep: isCleanSweep(targets, entries),
      weighIn,
      weighInEditable: canEditWeighIn(monday, today, { corrections: corrections() }),
      prevWeighIn: prev,
      startKg: first ? first.kg : null,
      latestKg: latest ? latest.kg : null,
      goalKg: goal != null ? Number(goal) : null,
      corrections: corrections(),
    });
  });

  app.put('/api/entry', (req, res) => {
    const { date, target_id: targetId } = req.body ?? {};
    let { value } = req.body ?? {};
    if (!isISODate(date)) fail('date must be YYYY-MM-DD');
    const today = todayISO(now());
    const edit = { thisWeekWeighedIn: !!repo.weighIn(mondayOf(today)), corrections: corrections() };
    if (!canEditDate(date, today, edit)) fail('that day is locked', 409);

    const monday = mondayOf(date);
    repo.ensureWeek(monday);
    const target = repo.target(Number(targetId));
    if (!target || !repo.inSnapshot(monday, target.id)) fail('target is not part of that week');

    value = value == null || value === '' ? 0 : Number(value);
    if (!Number.isFinite(value) || value < 0 || value > 100000) fail('value out of range');
    if (target.kind === 'tick') value = value > 0 ? 1 : 0;
    else value = Math.round(value * 100) / 100;

    repo.setEntry(date, target.id, value);
    res.json({ ok: true, value });
  });

  // ---------- history ----------
  app.get('/api/history', (req, res) => {
    const today = todayISO(now());
    const stats = buildStats(repo.allRows(), today);
    const goal = repo.getSetting('goal_kg');
    res.json({
      ...stats,
      weeks: stats.weeks.map((w) => ({ ...w, ddmm: ddmm(w.monday), days: weekDates(w.monday) })).reverse(),
      goalKg: goal != null ? Number(goal) : null,
    });
  });

  // ---------- weigh-in ----------
  app.put('/api/weigh-in', (req, res) => {
    const { monday, kg } = req.body ?? {};
    if (!isISODate(monday) || mondayOf(monday) !== monday) fail('monday must be a Monday (YYYY-MM-DD)');
    const today = todayISO(now());
    if (!canEditWeighIn(monday, today, { corrections: corrections() })) fail('that weigh-in is locked', 409);
    if (kg == null || kg === '') {
      repo.deleteWeighIn(monday);
      return res.json({ ok: true, weighIn: null });
    }
    const n = Number(kg);
    if (!Number.isFinite(n) || n < 20 || n > 400) fail('weight out of range');
    repo.setWeighIn(monday, Math.round(n * 1000) / 1000, today);
    res.json({ ok: true, weighIn: repo.weighIn(monday) });
  });

  // ---------- settings ----------
  const settingsView = () => {
    const g = repo.getSetting('goal_kg');
    return { goalKg: g != null ? Number(g) : null, corrections: corrections() };
  };
  app.get('/api/settings', (req, res) => res.json(settingsView()));
  app.put('/api/settings', (req, res) => {
    const b = req.body ?? {};
    if ('goalKg' in b) {
      if (b.goalKg == null || b.goalKg === '') repo.setSetting('goal_kg', null);
      else {
        const n = Number(b.goalKg);
        if (!Number.isFinite(n) || n < 20 || n > 400) fail('goal weight out of range');
        repo.setSetting('goal_kg', Math.round(n * 1000) / 1000);
      }
    }
    if ('corrections' in b) repo.setSetting('corrections_mode', b.corrections ? '1' : '0');
    res.json(settingsView());
  });

  // ---------- targets ----------
  const cleanTarget = (b, existing) => {
    const name = String(b.name ?? existing?.name ?? '').trim();
    if (!name || name.length > 40) fail('name must be 1–40 characters');
    const kind = existing ? existing.kind : b.kind;
    if (kind !== 'tick' && kind !== 'number') fail('kind must be tick or number');
    let unit = kind === 'number' ? String(b.unit ?? existing?.unit ?? '').trim() : null;
    if (unit && unit.length > 12) fail('unit must be up to 12 characters');
    const goalDays = Number(b.goal_days ?? existing?.goal_days ?? 7);
    if (!Number.isInteger(goalDays) || goalDays < 1 || goalDays > 7) fail('goal must be 1–7 days');
    return { name, kind, unit: unit || null, goal_days: goalDays };
  };
  const afterTargetChange = () => repo.resyncWeek(thisMonday());
  const mustTarget = (id) => repo.target(Number(id)) ?? fail('no such target', 404);

  app.get('/api/targets', (req, res) => res.json(repo.allTargets()));

  app.post('/api/targets', (req, res) => {
    const id = repo.addTarget(cleanTarget(req.body ?? {}));
    afterTargetChange();
    res.status(201).json(repo.target(id));
  });

  app.put('/api/targets/order', (req, res) => {
    const ids = req.body?.ids;
    if (!Array.isArray(ids) || !ids.every((id) => repo.target(Number(id)))) fail('ids must be target ids');
    repo.reorder(ids.map(Number));
    afterTargetChange();
    res.json(repo.allTargets());
  });

  app.patch('/api/targets/:id', (req, res) => {
    const t = mustTarget(req.params.id);
    repo.updateTarget(t.id, cleanTarget(req.body ?? {}, t));
    afterTargetChange();
    res.json(repo.target(t.id));
  });

  app.post('/api/targets/:id/archive', (req, res) => {
    const t = mustTarget(req.params.id);
    repo.archive(t.id);
    afterTargetChange();
    res.json(repo.target(t.id));
  });

  app.post('/api/targets/:id/unarchive', (req, res) => {
    const t = mustTarget(req.params.id);
    repo.unarchive(t.id);
    afterTargetChange();
    res.json(repo.target(t.id));
  });

  // ---------- export ----------
  app.get('/api/export.json', (req, res) => {
    const today = todayISO(now());
    res.attachment(`tickweek-${today}.json`).json(exportJson(repo, now().toISOString()));
  });
  app.get('/api/export.csv', (req, res) => {
    const today = todayISO(now());
    res.attachment(`tickweek-${today}.csv`).type('text/csv; charset=utf-8').send(exportCsv(repo, today));
  });

  // ---------- static ----------
  app.get('/js/weight.js', (req, res) => res.sendFile(path.join(here, 'weight.js')));
  app.use(express.static(path.join(here, '..', 'public'), { extensions: ['html'] }));

  app.use('/api', (req, res) => res.status(404).json({ error: 'not found' }));
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err instanceof BadRequest) return res.status(err.status).json({ error: err.message });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'bad JSON' });
    console.error(err);
    res.status(500).json({ error: 'server error' });
  });

  return app;
}
