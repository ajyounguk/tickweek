import path from 'node:path';
import { openDb, makeRepo } from './db.js';
import { createApp } from './app.js';
import { TZ } from './dates.js';

const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = process.env.DATA_DIR || process.argv[2] || path.resolve('data'); // argv: `npm run demo`

const db = openDb(path.join(DATA_DIR, 'tickweek.db'));
// Dev/demo only: TICKWEEK_NOW pins the clock (e.g. for screenshots). Unset in normal use.
const pinned = process.env.TICKWEEK_NOW ? new Date(process.env.TICKWEEK_NOW) : null;
if (pinned && Number.isNaN(pinned.getTime())) throw new Error('TICKWEEK_NOW is not a valid date');
const app = createApp({ repo: makeRepo(db), now: pinned ? () => pinned : undefined });

const server = app.listen(PORT, () => {
  console.log(`tickweek listening on :${PORT} (data ${DATA_DIR}, tz ${TZ})${pinned ? ` CLOCK PINNED to ${pinned.toISOString()}` : ''}`);
});

// Close cleanly on docker stop so the WAL is checkpointed before any backup copies the data dir.
for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => {
    const done = () => { if (db.open) db.close(); process.exit(0); };
    server.close(done);
    setTimeout(done, 3000).unref();
  });
}
