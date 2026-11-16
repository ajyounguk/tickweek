import { api, toast, h, fmtNum, formatStLb } from '/js/common.js';
import { KG_PER_LB } from '/js/weight.js';

const $ = (id) => document.getElementById(id);
const ddmm = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const DOW = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
let data;

async function load() {
  try { data = await api('GET', '/api/history'); }
  catch (e) { return toast(e.message); }
  renderRecords();
  renderTargets();
  renderWeeks();
  renderChart();
  // Content arrives after the browser's own #anchor jump, so redo it once rendered (e.g. /history#weekscard).
  if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView();
}

// ---------- records ----------
function tile(label, value, sub) {
  return h('div', { class: 'tile' }, h('div', { class: 'tl' }, label), h('div', { class: 'tv' }, value ?? '–'), sub ? h('div', { class: 'ts' }, sub) : null);
}
function plural(n, word) { return `${n} ${word}${n === 1 ? '' : 's'}`; }

function renderRecords() {
  const r = data.records;
  const twoWeighIns = data.weighIns.length >= 2;
  const lost = twoWeighIns ? r.startKg - r.latestKg : null;
  $('records').replaceChildren(
    tile('Personal best', r.personalBest ? formatStLb(r.personalBest.kg) : null, r.personalBest ? `w/c ${ddmm(r.personalBest.monday)}` : 'no weigh-ins yet'),
    tile('Lost so far', lost != null ? (lost >= 0 ? formatStLb(lost) : `+${formatStLb(-lost)}`) : null,
      r.startKg != null ? (twoWeighIns ? `from ${formatStLb(r.startKg)}` : 'needs 2 weigh-ins') : 'needs 2 weigh-ins'),
    tile('Losing streak', twoWeighIns ? plural(data.losing.current, 'week') : null,
      twoWeighIns ? `best ${plural(data.losing.longest, 'week')}` : 'needs 2 weigh-ins'),
    tile('Best week', r.bestScore != null ? `${r.bestScore}%` : null, r.bestScore != null ? 'closed weeks' : 'after week 1'),
    tile('Clean sweeps', String(r.cleanSweeps), plural(r.weeksTracked, 'week') + ' tracked'),
    tile('Full days', String(r.fullDays), 'all daily targets done'),
  );
}

// ---------- per target ----------
function renderTargets() {
  const list = data.targets.filter((t) => !t.archived || t.daysDone > 0);
  $('targetstats').replaceChildren(...(list.length ? list.map((t) => {
    const u = t.streakUnit === 'days' ? 'day' : 'week';
    const total = t.kind === 'number' ? `${fmtNum(t.total)} ${t.unit ?? ''} · ${plural(t.daysDone, 'day')}` : plural(t.daysDone, 'day');
    return h('li', {},
      h('div', { class: 'info' },
        h('div', {}, t.name, t.archived ? h('span', { class: 'pill', style: 'margin-left:6px' }, 'retired') : null),
        h('div', { class: 'meta' }, `${t.goal_days}/7 · total ${total}`)),
      h('div', { style: 'text-align:right' },
        t.streak.longest
          ? [h('div', { class: 'streak' + (t.streak.current >= 2 ? ' on' : '') }, plural(t.streak.current, u)),
             h('div', { class: 'meta small muted' }, `best ${plural(t.streak.longest, u)}`)]
          : h('div', { class: 'meta small muted' }, 'no streak yet')),
    );
  }) : [h('li', { class: 'muted' }, 'No targets yet.')]));
}

// ---------- weeks (the paper layout) ----------
function renderWeeks() {
  const cur = data.weeks.find((w) => w.current) ?? data.weeks[0];
  $('legend').textContent = cur?.targets.length ? `Dots: ${cur.targets.map((t) => t.name).join(' · ')}` : '';

  const head = h('div', { class: 'wrow whead' }, h('div', {}), ...DOW.map((d) => h('div', {}, d)), h('div', {}, '%'));
  const rows = data.weeks.map((w) => {
    const full = new Set(w.fullDays);
    const cells = w.days.map((d) => {
      const future = d > data.today;
      const dots = w.targets.map((t) => h('i', { class: (w.entries[t.id]?.[d] > 0 ? 'on' : '') }));
      const doneNames = w.targets.filter((t) => w.entries[t.id]?.[d] > 0).map((t) => t.name);
      return h('div', {
        class: 'wcell' + (full.has(d) ? ' full' : '') + (future ? ' future' : ''),
        title: `${ddmm(d)}: ${future ? 'not yet' : doneNames.length ? doneNames.join(', ') : 'nothing ticked'}`,
      }, future ? null : dots);
    });
    const wi = w.weighIn;
    return h('a', { class: 'wrow', href: w.current ? '/' : `/?week=${w.monday}` },
      h('div', { class: 'wdate' }, h('b', {}, w.ddmm), h('span', {}, wi ? formatStLb(wi.kg).replace(' lb', '') : '—', wi?.late ? '*' : '')),
      ...cells,
      h('div', { class: 'wscore' + (w.current ? ' live' : ''), title: w.current ? 'Week score so far (week in progress)' : 'Week score' },
        w.score != null ? `${w.score}` : '–',
        w.cleanSweep ? h('span', { class: 'sweep', title: 'Clean sweep' }, '★') : w.current ? h('span', { class: 'sofar' }, 'so far') : null),
    );
  });
  $('weeks').replaceChildren(head, ...rows,
    h('div', { class: 'small muted', style: 'margin-top:8px' }, '% = week score: days ticked ÷ days the goals ask for (counted against the whole week, so the current week climbs as it goes) · ★ clean sweep · ringed day = full day · weight in st lb, * = late weigh-in. Tap a week to open it.'));
}

// ---------- weight chart (inline SVG, single series, goal reference line, crosshair tooltip) ----------
const NS = 'http://www.w3.org/2000/svg';
const s = (tag, attrs = {}) => { const el = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v); return el; };
const toLb = (kg) => kg / KG_PER_LB;
const lbLabel = (lb) => { const st = Math.floor(lb / 14); const r = Math.round(lb - st * 14); return r === 14 ? `${st + 1}st` : r ? `${st}st ${r}` : `${st}st`; };
const dayNum = (iso) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 864e5;

function renderChart() {
  const box = $('chart');
  const pts = data.weighIns;
  if (!pts.length) {
    box.replaceChildren(h('div', { class: 'muted small' }, 'Your weekly weigh-ins will plot here.'));
    return;
  }
  const W = Math.max(280, box.clientWidth), H = 200;
  const m = { l: 46, r: 12, t: 12, b: 24 };
  const iw = W - m.l - m.r, ih = H - m.t - m.b;

  const lbs = pts.map((p) => toLb(p.kg));
  const goalLb = data.goalKg != null ? toLb(data.goalKg) : null;
  let lo = Math.min(...lbs), hi = Math.max(...lbs);
  if (goalLb != null) { lo = Math.min(lo, goalLb); hi = Math.max(hi, goalLb); }
  const span = Math.max(hi - lo, 4);
  const step = [1, 2, 4, 7, 14, 28].find((x) => span / x <= 5) ?? 28;
  lo = Math.floor((lo - span * 0.08) / step) * step;
  hi = Math.ceil((hi + span * 0.08) / step) * step;

  const x0 = dayNum(pts[0].monday_date), x1 = dayNum(pts.at(-1).monday_date);
  const x = (iso) => m.l + (x1 === x0 ? iw / 2 : ((dayNum(iso) - x0) / (x1 - x0)) * iw);
  const y = (lb) => m.t + (1 - (lb - lo) / (hi - lo)) * ih;

  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: 'img', 'aria-label': `Weekly weigh-ins, ${pts.length} weeks`, tabindex: 0 });
  // grid + y labels
  for (let v = lo; v <= hi + 1e-9; v += step) {
    svg.append(s('line', { x1: m.l, x2: W - m.r, y1: y(v), y2: y(v), class: 'grid' }));
    const t = s('text', { x: m.l - 6, y: y(v) + 4, 'text-anchor': 'end', class: 'axis' }); t.textContent = lbLabel(v); svg.append(t);
  }
  // x labels: first and last week
  const xl = (iso, anchor) => { const t = s('text', { x: x(iso), y: H - 6, 'text-anchor': anchor, class: 'axis' }); t.textContent = ddmm(iso); svg.append(t); };
  xl(pts[0].monday_date, pts.length === 1 ? 'middle' : 'start');
  if (pts.length > 1) xl(pts.at(-1).monday_date, 'end');
  // goal reference line, direct-labelled
  if (goalLb != null) {
    svg.append(s('line', { x1: m.l, x2: W - m.r, y1: y(goalLb), y2: y(goalLb), class: 'goal' }));
    const t = s('text', { x: W - m.r, y: y(goalLb) - 5, 'text-anchor': 'end', class: 'goallabel' }); t.textContent = `goal ${formatStLb(data.goalKg)}`; svg.append(t);
  }
  // the series: 2px line, but don't draw across missing weeks (a gap is a gap)
  let d = '';
  pts.forEach((p, i) => {
    const join = i > 0 && dayNum(p.monday_date) - dayNum(pts[i - 1].monday_date) === 7;
    d += `${join ? 'L' : 'M'}${x(p.monday_date).toFixed(1)},${y(lbs[i]).toFixed(1)}`;
  });
  svg.append(s('path', { d, class: 'series' }));
  pts.forEach((p, i) => svg.append(s('circle', { cx: x(p.monday_date), cy: y(lbs[i]), r: pts.length > 40 ? 2.5 : 4, class: 'dot' })));

  // hover layer
  const cross = s('line', { y1: m.t, y2: m.t + ih, class: 'cross', visibility: 'hidden' });
  const ring = s('circle', { r: 6, class: 'hot', visibility: 'hidden' });
  svg.append(cross, ring);
  const tip = h('div', { class: 'tip hidden', role: 'status' });
  box.replaceChildren(svg, tip);
  if (pts.length === 1) box.append(h('div', { class: 'small muted', style: 'margin-top:4px' }, 'One weigh-in so far: the line starts with the next one.'));

  let idx = null;
  const show = (i) => {
    idx = i;
    const p = pts[i], prev = pts[i - 1];
    const cx = x(p.monday_date), cy = y(lbs[i]);
    cross.setAttribute('x1', cx); cross.setAttribute('x2', cx); cross.setAttribute('visibility', 'visible');
    ring.setAttribute('cx', cx); ring.setAttribute('cy', cy); ring.setAttribute('visibility', 'visible');
    const diff = prev && dayNum(p.monday_date) - dayNum(prev.monday_date) === 7 ? p.kg - prev.kg : null;
    tip.replaceChildren(
      h('b', {}, formatStLb(p.kg)),
      h('span', {}, `w/c ${ddmm(p.monday_date)}${p.late ? ' · late' : ''}`),
      diff != null ? h('span', {}, Math.abs(diff) < 0.02 ? 'no change' : `${diff < 0 ? '▼' : '▲'} ${formatStLb(Math.abs(diff))}`) : null,
    );
    tip.classList.remove('hidden');
    const left = Math.min(Math.max(cx - tip.offsetWidth / 2, 0), W - tip.offsetWidth);
    tip.style.left = `${left}px`;
    tip.style.top = `${Math.max(cy - tip.offsetHeight - 12, 0)}px`;
  };
  const hide = () => { idx = null; cross.setAttribute('visibility', 'hidden'); ring.setAttribute('visibility', 'hidden'); tip.classList.add('hidden'); };
  const nearest = (px) => {
    let best = 0;
    pts.forEach((p, i) => { if (Math.abs(x(p.monday_date) - px) < Math.abs(x(pts[best].monday_date) - px)) best = i; });
    return best;
  };
  svg.addEventListener('pointermove', (e) => {
    const r = svg.getBoundingClientRect();
    show(nearest(((e.clientX - r.left) / r.width) * W));
  });
  svg.addEventListener('pointerleave', hide);
  svg.addEventListener('focus', () => show(pts.length - 1));
  svg.addEventListener('blur', hide);
  svg.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') show(Math.max(0, (idx ?? pts.length) - 1));
    else if (e.key === 'ArrowRight') show(Math.min(pts.length - 1, (idx ?? -1) + 1));
  });
}

let resizeT;
window.addEventListener('resize', () => { clearTimeout(resizeT); resizeT = setTimeout(() => data && renderChart(), 150); });

load();
