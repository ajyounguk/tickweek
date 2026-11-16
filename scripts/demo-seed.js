// Fills a SEPARATE demo database with ~12 weeks of made-up data (for screenshots and trying the UI).
// Usage: npm run demo  (seeds ./demo-data once, then serves it on :3000)
// Refuses to touch a DB that already has weigh-ins, so it can't scribble over real data.
import path from 'node:path';
import { openDb, makeRepo } from '../src/db.js';
import { todayISO, mondayOf, addDays, weekDates } from '../src/dates.js';
import { stLbToKg } from '../src/weight.js';

const dir = process.argv[2];
if (!dir) { console.error('usage: node scripts/demo-seed.js <data-dir>'); process.exit(1); }
const db = openDb(path.join(dir, 'tickweek.db'));
const repo = makeRepo(db);
if (repo.allRows().weighIns.length) { console.log('That DB already has weigh-ins: leaving it as it is.'); process.exit(0); }

let seed = 42;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);

const today = todayISO(process.env.TICKWEEK_NOW ? new Date(process.env.TICKWEEK_NOW) : new Date()); // match a pinned server clock
const current = mondayOf(today);
const WEEKS = 12;
let kg = stLbToKg(15, 6);

db.transaction(() => {
  repo.setSetting('goal_kg', stLbToKg(13, 7));
  for (let w = WEEKS - 1; w >= 0; w--) {
    const monday = addDays(current, -7 * w);
    repo.ensureWeek(monday);
    const targets = repo.weekTargets(monday);
    const skill = 0.6 + 0.35 * ((WEEKS - w) / WEEKS); // gets better over time
    for (const date of weekDates(monday).filter((d) => d <= today)) {
      for (const t of targets) {
        const p = t.goal_days === 7 ? skill : (t.goal_days / 7) * (0.8 + skill * 0.5);
        if (rand() < p) repo.setEntry(date, t.id, t.kind === 'tick' ? 1 : t.unit === 'miles' ? Math.round((2 + rand() * 3) * 10) / 10 : 30 + Math.round(rand() * 4) * 10);
      }
    }
    if (w === 7) continue; // a missed weigh-in, to show the gap
    kg += -0.9 + rand() * 1.1 - (w === 0 ? 0.4 : 0);
    repo.setWeighIn(monday, Math.round(kg * 10) / 10, rand() < 0.15 && w !== 0 ? addDays(monday, 2) : monday);
  }
})();
db.close();
console.log(`demo data: ${WEEKS} weeks up to ${today} in ${dir}`);
