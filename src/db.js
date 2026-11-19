import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { weekDates } from './dates.js';

// One schema, created in one go on an empty database and tracked with PRAGMA user_version.
// A database from another schema version is refused, never touched: move it aside to start fresh.
export const SCHEMA_VERSION = 2;
const SCHEMA = `
  CREATE TABLE target (
    id          INTEGER PRIMARY KEY,
    name        TEXT NOT NULL,
    kind        TEXT NOT NULL CHECK (kind IN ('tick','number','combined')),
    unit        TEXT,
    goal_days   INTEGER CHECK (goal_days IS NULL OR goal_days BETWEEN 1 AND 7), -- NULL: no goal (logged, not scored)
    sort_order  INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    archived_at TEXT,
    part_of     INTEGER REFERENCES target(id)                                   -- the combined target it counts towards
  );
  CREATE TABLE week (
    monday_date TEXT PRIMARY KEY,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );
  -- Each week's own copy of the targets, goals and groupings, so past weeks never shift.
  CREATE TABLE week_target (
    monday_date TEXT NOT NULL REFERENCES week(monday_date),
    target_id   INTEGER NOT NULL REFERENCES target(id),
    goal_days   INTEGER,
    sort_order  INTEGER NOT NULL,
    part_of     INTEGER,
    PRIMARY KEY (monday_date, target_id)
  );
  -- Only tick and number targets have entries; a combined target's days are derived (src/combined.js).
  CREATE TABLE entry (
    date       TEXT NOT NULL,
    target_id  INTEGER NOT NULL REFERENCES target(id),
    value      REAL NOT NULL CHECK (value > 0),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (date, target_id)
  );
  CREATE TABLE weigh_in (
    monday_date TEXT PRIMARY KEY,
    kg          REAL NOT NULL CHECK (kg > 0),
    entered_on  TEXT NOT NULL,
    late        INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE setting (
    key   TEXT PRIMARY KEY,
    value TEXT
  );
  -- Starting set: Exercise is done by either a run or a weights session.
  INSERT INTO target (id, name, kind, unit, goal_days, sort_order, part_of) VALUES
    (1, 'Intermittent fast', 'tick',     NULL,    7,    1, NULL),
    (2, 'No snacks',         'tick',     NULL,    7,    2, NULL),
    (5, 'Exercise',          'combined', NULL,    4,    5, NULL),
    (3, 'Running',           'number',   'miles', NULL, 3, 5),
    (4, 'Weight training',   'number',   'min',   NULL, 4, 5);
`;

export function openDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  const version = db.pragma('user_version', { simple: true });
  if (version === 0) {
    db.transaction(() => {
      db.exec(SCHEMA);
      db.pragma(`user_version = ${SCHEMA_VERSION}`);
    })();
  } else if (version !== SCHEMA_VERSION) {
    db.close();
    throw new Error(`${file} is from another Tickweek version (schema ${version}, this one needs ${SCHEMA_VERSION}). `
      + 'Move it aside to start fresh.');
  }
  return db;
}

// ---------- data access ----------

export function makeRepo(db) {
  const q = {
    weekExists: db.prepare('SELECT 1 FROM week WHERE monday_date = ?'),
    insertWeek: db.prepare('INSERT INTO week (monday_date) VALUES (?)'),
    firstWeek: db.prepare('SELECT MIN(monday_date) AS m FROM week'),
    allWeeks: db.prepare('SELECT monday_date FROM week ORDER BY monday_date').pluck(),
    allSnapshots: db.prepare(`
      SELECT wt.monday_date, t.id, t.name, t.kind, t.unit, wt.goal_days, wt.sort_order, wt.part_of
      FROM week_target wt JOIN target t ON t.id = wt.target_id`),
    allEntries: db.prepare('SELECT date, target_id, value FROM entry'),
    allWeighIns: db.prepare('SELECT * FROM weigh_in ORDER BY monday_date'),
    activeTargets: db.prepare('SELECT * FROM target WHERE archived_at IS NULL ORDER BY sort_order, id'),
    allTargets: db.prepare('SELECT * FROM target ORDER BY archived_at IS NOT NULL, sort_order, id'),
    target: db.prepare('SELECT * FROM target WHERE id = ?'),
    clearSnapshot: db.prepare('DELETE FROM week_target WHERE monday_date = ?'),
    insertSnapshot: db.prepare('INSERT INTO week_target (monday_date, target_id, goal_days, sort_order, part_of) VALUES (?, ?, ?, ?, ?)'),
    weekTargets: db.prepare(`
      SELECT t.id, t.name, t.kind, t.unit, wt.goal_days, wt.sort_order, wt.part_of
      FROM week_target wt JOIN target t ON t.id = wt.target_id
      WHERE wt.monday_date = ? ORDER BY wt.sort_order, t.id`),
    inSnapshot: db.prepare('SELECT 1 FROM week_target WHERE monday_date = ? AND target_id = ?'),
    entriesBetween: db.prepare('SELECT date, target_id, value FROM entry WHERE date BETWEEN ? AND ?'),
    upsertEntry: db.prepare(`
      INSERT INTO entry (date, target_id, value) VALUES (?, ?, ?)
      ON CONFLICT (date, target_id) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`),
    deleteEntry: db.prepare('DELETE FROM entry WHERE date = ? AND target_id = ?'),
    weighIn: db.prepare('SELECT * FROM weigh_in WHERE monday_date = ?'),
    upsertWeighIn: db.prepare(`
      INSERT INTO weigh_in (monday_date, kg, entered_on, late) VALUES (?, ?, ?, ?)
      ON CONFLICT (monday_date) DO UPDATE SET kg = excluded.kg, entered_on = excluded.entered_on, late = excluded.late`),
    deleteWeighIn: db.prepare('DELETE FROM weigh_in WHERE monday_date = ?'),
    firstWeighIn: db.prepare('SELECT * FROM weigh_in ORDER BY monday_date LIMIT 1'),
    prevWeighIn: db.prepare('SELECT * FROM weigh_in WHERE monday_date < ? ORDER BY monday_date DESC LIMIT 1'),
    latestWeighIn: db.prepare('SELECT * FROM weigh_in WHERE monday_date <= ? ORDER BY monday_date DESC LIMIT 1'),
    getSetting: db.prepare('SELECT value FROM setting WHERE key = ?'),
    setSetting: db.prepare('INSERT INTO setting (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value'),
    insertTarget: db.prepare('INSERT INTO target (name, kind, unit, goal_days, sort_order) VALUES (?, ?, ?, ?, ?)'),
    maxSort: db.prepare('SELECT COALESCE(MAX(sort_order), 0) AS m FROM target'),
    updateTarget: db.prepare('UPDATE target SET name = ?, unit = ?, goal_days = ? WHERE id = ?'),
    setSort: db.prepare('UPDATE target SET sort_order = ? WHERE id = ?'),
    archive: db.prepare("UPDATE target SET archived_at = datetime('now') WHERE id = ?"),
    unarchive: db.prepare('UPDATE target SET archived_at = NULL, sort_order = ? WHERE id = ?'),
    clearSources: db.prepare('UPDATE target SET part_of = NULL WHERE part_of = ?'),
    addSource: db.prepare('UPDATE target SET part_of = ?, goal_days = NULL WHERE id = ?'),
    leave: db.prepare('UPDATE target SET part_of = NULL WHERE id = ?'),
  };

  const repo = {
    db,

    /** Create the week and its target snapshot (from the current definitions) if it doesn't exist yet. */
    ensureWeek(monday) {
      if (q.weekExists.get(monday)) return;
      db.transaction(() => {
        q.insertWeek.run(monday);
        writeSnapshot(monday);
      })();
    },

    /** Re-snapshot the current week after a target change ("changes apply from the current week on"). */
    resyncWeek(monday) {
      db.transaction(() => {
        if (!q.weekExists.get(monday)) q.insertWeek.run(monday);
        q.clearSnapshot.run(monday);
        writeSnapshot(monday);
      })();
    },

    weekTargets: (monday) => q.weekTargets.all(monday),
    inSnapshot: (monday, targetId) => !!q.inSnapshot.get(monday, targetId),
    weekExists: (monday) => !!q.weekExists.get(monday),
    firstWeek: () => q.firstWeek.get().m,
    /** Everything stats.js needs, in one go. */
    allRows: () => ({
      targets: q.allTargets.all(),
      weeks: q.allWeeks.all(),
      snapshots: q.allSnapshots.all(),
      entries: q.allEntries.all(),
      weighIns: q.allWeighIns.all(),
    }),

    /** { [targetId]: { [date]: value } } for the week. */
    weekEntries(monday) {
      const dates = weekDates(monday);
      const out = {};
      for (const r of q.entriesBetween.all(dates[0], dates[6])) {
        (out[r.target_id] ??= {})[r.date] = r.value;
      }
      return out;
    },

    setEntry(date, targetId, value) {
      if (value > 0) q.upsertEntry.run(date, targetId, value);
      else q.deleteEntry.run(date, targetId);
    },

    weighIn: (monday) => q.weighIn.get(monday) ?? null,
    prevWeighIn: (monday) => q.prevWeighIn.get(monday) ?? null,
    latestWeighIn: (uptoMonday) => q.latestWeighIn.get(uptoMonday) ?? null,
    firstWeighIn: () => q.firstWeighIn.get() ?? null,
    /** A correction keeps the original entered_on/late; a new weigh-in after its Monday is late. */
    setWeighIn(monday, kg, enteredOn) {
      const existing = q.weighIn.get(monday);
      if (existing) q.upsertWeighIn.run(monday, kg, existing.entered_on, existing.late);
      else q.upsertWeighIn.run(monday, kg, enteredOn, enteredOn > monday ? 1 : 0);
    },
    deleteWeighIn: (monday) => q.deleteWeighIn.run(monday),

    getSetting(key) {
      const r = q.getSetting.get(key);
      return r ? r.value : null;
    },
    setSetting: (key, value) => q.setSetting.run(key, value == null ? null : String(value)),

    allTargets: () => q.allTargets.all(),
    target: (id) => q.target.get(id) ?? null,
    addTarget({ name, kind, unit, goal_days }) {
      const sort = q.maxSort.get().m + 1;
      return q.insertTarget.run(name, kind, unit || null, goal_days, sort).lastInsertRowid;
    },
    updateTarget(id, { name, unit, goal_days }) {
      q.updateTarget.run(name, unit || null, goal_days, id);
    },
    reorder(ids) {
      db.transaction(() => ids.forEach((id, i) => q.setSort.run(i + 1, id)))();
    },
    /** A combined target's sources: replaces the old set. Sources lose their own goal while they count towards it. */
    setSources(combinedId, ids) {
      db.transaction(() => {
        q.clearSources.run(combinedId);
        for (const id of ids) q.addSource.run(combinedId, id);
      })();
    },
    /** Retiring frees the target's sources (they keep no goal until one is set) and takes it out of its combined target. */
    archive(id) {
      db.transaction(() => {
        q.archive.run(id);
        q.clearSources.run(id);
        q.leave.run(id);
      })();
    },
    unarchive: (id) => q.unarchive.run(q.maxSort.get().m + 1, id),
  };

  function writeSnapshot(monday) {
    for (const t of q.activeTargets.all()) q.insertSnapshot.run(monday, t.id, t.goal_days, t.sort_order, t.part_of);
  }

  return repo;
}
