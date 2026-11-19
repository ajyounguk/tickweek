import { api, toast, h, fmtNum, formatStLb } from '/js/common.js';
import { KG_PER_LB } from '/js/weight.js';

const $ = (id) => document.getElementById(id);
const ddmm = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
let data;

async function load() {
  try { data = await api('GET', '/api/history'); }
  catch (e) { return toast(e.message); }
  index();
  renderHero();
  renderChart();
  renderMonth();
  renderYear();
  renderRecords();
  renderTargets();
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
  // Biggest drop between consecutive weekly weigh-ins (a missed week isn't a "weekly" drop).
  let drop = null;
  data.weighIns.forEach((w, i) => {
    const prev = data.weighIns[i - 1];
    if (prev && addDays(prev.monday_date, 7) === w.monday_date && prev.kg - w.kg > (drop?.kg ?? 0.02)) drop = { kg: prev.kg - w.kg, monday: w.monday_date };
  });
  $('achperiod').textContent = r.weeksTracked ? `all time · since ${ddmm(data.weeks.at(-1).monday)}` : '';
  $('records').replaceChildren(
    tile('Lowest weight', r.personalBest ? formatStLb(r.personalBest.kg) : null, r.personalBest ? `weighed ${ddmm(r.personalBest.monday)}` : 'no weigh-ins yet'),
    tile('Weight-loss streak', twoWeighIns ? plural(data.losing.current, 'week') : null,
      twoWeighIns ? `best ${plural(data.losing.longest, 'week')}` : 'needs 2 weigh-ins'),
    tile('Biggest weekly drop', drop ? `▼ ${formatStLb(drop.kg)}` : null, drop ? `w/c ${ddmm(drop.monday)}` : 'needs 2 weigh-ins in a row'),
    tile('Perfect weeks 🏆', String(r.cleanSweeps), 'every target hit its goal'),
    tile('Star days', `${r.fullDays}/${starDayCount()}`, 'every daily target done'),
    tile('Total weeks tracked', String(r.weeksTracked), r.weeksTracked ? 'including this week' : null),
  );
}

// ---------- per target ----------
function renderTargets() {
  const list = data.targets.filter((t) => !t.archived || t.daysDone > 0);
  $('targetstats').replaceChildren(...(list.length ? list.map((t) => {
    const u = t.streakUnit === 'days' ? 'day' : 'week';
    const parent = t.part_of ? data.targets.find((x) => x.id === t.part_of) : null;
    const goal = t.goal_days == null ? (parent ? `in ${parent.name}` : 'no goal') : t.goal_days === 7 ? 'every day' : `${t.goal_days} days a week`;
    const done = t.kind === 'number' && t.total
      ? `${fmtNum(t.total)} ${t.unit ?? ''}`.trim()
      : `${plural(t.daysDone, 'day')} done`;
    return h('li', {},
      h('div', { class: 'info' },
        h('div', {}, t.name, t.archived ? h('span', { class: 'pill', style: 'margin-left:6px' }, 'retired') : null),
        h('div', { class: 'meta' }, `${goal} · ${done}`)),
      t.goal_days == null ? null : h('div', { style: 'text-align:right' },
        t.streak.longest
          ? [h('div', { class: 'streak' + (t.streak.current >= 2 ? ' on' : '') }, `${plural(t.streak.current, u)} in a row`),
             h('div', { class: 'meta small muted' }, `best ${t.streak.longest}`)]
          : h('div', { class: 'meta small muted' }, 'no streak yet')),
    );
  }) : [h('li', { class: 'muted' }, 'No targets yet.')]));
}

// ---------- date helpers (UTC-midnight ISO dates, like src/dates.js) ----------
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const addDays = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const mondayOf = (iso) => addDays(iso, -((new Date(iso + 'T00:00:00Z').getUTCDay() + 6) % 7));
const shiftMonth = (ym, n) => { const [y, m] = ym.split('-').map(Number); return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7); };
const kgDelta = (diff) => (Math.abs(diff) < 0.02 ? '±0' : `${diff < 0 ? '▼' : '▲'} ${formatStLb(Math.abs(diff))}`);
const deltaClass = (diff) => (Math.abs(diff) < 0.02 ? 'same' : diff < 0 ? 'down' : 'up');
/** '14st 11.5': compact st/lb for tight columns. */
const shortStLb = (kg) => formatStLb(kg).replace(' st ', 'st ').replace(' lb', '');

let weekMap = new Map();   // monday → week
let weighMap = new Map();  // monday → weigh-in
function index() {
  weekMap = new Map(data.weeks.map((w) => [w.monday, w]));
  weighMap = new Map(data.weighIns.map((w) => [w.monday_date, w]));
}
/** Last weigh-in strictly before a date. */
const lastWeighInBefore = (iso) => [...data.weighIns].reverse().find((w) => w.monday_date < iso) ?? null;

/** Weight change over a period: last weigh-in in it vs the last one before it (or its first). */
function periodStats(inPeriod, startIso) {
  const ws = data.weighIns.filter((w) => inPeriod(w.monday_date));
  const base = lastWeighInBefore(startIso) ?? ws[0];
  const change = ws.length && base && base !== ws.at(-1) ? ws.at(-1).kg - base.kg : null;
  const closed = data.weeks.filter((w) => inPeriod(w.monday) && !w.current && w.score != null);
  const score = closed.length ? Math.round(closed.reduce((a, w) => a + w.score, 0) / closed.length) : null;
  const fullDays = data.weeks.flatMap((w) => w.fullDays).filter(inPeriod).length;
  const starDayOf = starDayCount(inPeriod);
  return { endKg: ws.at(-1)?.kg ?? null, change, score, fullDays, starDayOf };
}

/** Days that could have been a star day: tracked weeks with a 7/7 target, up to today. */
function starDayCount(inPeriod = () => true) {
  return data.weeks
    .filter((w) => w.targets.some((t) => t.goal_days === 7))
    .flatMap((w) => w.days)
    .filter((d) => d <= data.today && inPeriod(d)).length;
}

// ---------- weight hero ----------
function renderHero() {
  const pts = data.weighIns;
  if (!pts.length) return $('hero').replaceChildren();
  const latest = pts.at(-1), first = pts[0];
  const lost = latest.kg - first.kg;
  const kids = [h('div', { class: 'hero' },
    h('div', {},
      h('div', { class: 'hero-label' }, 'Current weight'),
      h('div', { class: 'hero-kg' }, formatStLb(latest.kg)),
      h('div', { class: 'small muted' }, `weighed ${ddmm(latest.monday_date)}`)),
    pts.length > 1 ? h('div', { class: `hero-lost ${deltaClass(lost)}` },
      h('div', { class: 'hero-label' }, `Since ${ddmm(first.monday_date)}`),
      h('b', {}, kgDelta(lost)),
      h('span', {}, lost < 0 ? 'lost' : lost > 0 ? 'gained' : 'no change')) : null,
  )];
  if (data.goalKg != null) {
    const toGo = Math.max(0, latest.kg - data.goalKg);
    const span = first.kg - data.goalKg;
    const pct = span > 0 ? Math.min(100, Math.max(0, ((first.kg - latest.kg) / span) * 100)) : toGo === 0 ? 100 : 0;
    kids.push(h('div', { style: 'margin:10px 0 4px' },
      h('div', { class: 'row small', style: 'margin-bottom:5px' },
        h('span', {}, toGo < 0.02 ? 'Goal reached!' : h('b', {}, `${formatStLb(toGo)} to go`)),
        h('span', { class: 'muted', style: 'margin-left:auto' }, `goal ${formatStLb(data.goalKg)}`)),
      h('div', { class: 'bar' }, h('i', { style: `width:${pct}%` }))));
  }
  $('hero').replaceChildren(...kids);
}

// ---------- month calendar ----------
let month = null; // 'YYYY-MM'
const firstMonth = () => (data.weeks.length ? data.weeks.at(-1).monday.slice(0, 7) : data.today.slice(0, 7));

/** Dots are for targets with a goal: a combined target's sources show up through its own dot. */
const scoredOf = (w) => w.targets.filter((t) => t.goal_days != null);

function renderMonth() {
  month ??= data.today.slice(0, 7);
  const [y, m] = month.split('-').map(Number);
  $('monthlabel').textContent = `${MONTHS[m - 1]} ${y}`;
  $('mprev').disabled = month <= firstMonth();
  $('mnext').disabled = month >= data.today.slice(0, 7);

  // A week belongs to the month its Monday is in; oldest first, like the paper sheet.
  const weeks = data.weeks.filter((w) => w.monday.slice(0, 7) === month).reverse();
  const cur = data.weeks.find((w) => w.current) ?? data.weeks[0];

  const st = periodStats((iso) => iso.slice(0, 7) === month, month + '-01');
  const summary = h('div', { class: 'msum' },
    h('span', {}, 'Weight ', st.change != null ? h('b', { class: `delta ${deltaClass(st.change)}` }, kgDelta(st.change)) : h('b', {}, '–')),
    h('span', {}, 'Score ', h('b', {}, st.score != null ? `${st.score}%` : '–')),
    h('span', {}, 'Star days ', h('b', {}, `${st.fullDays}/${st.starDayOf}`)));
  const dots = h('div', { class: 'small muted', style: 'margin-bottom:6px' },
    cur?.targets.length ? `Dots: ${scoredOf(cur).map((t) => t.name).join(' · ')}` : '');

  const head = h('div', { class: 'wrow whead' }, h('div', {}), ...['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d) => h('div', {}, d)), h('div', {}, '%'));
  const rows = weeks.map((w) => {
    const full = new Set(w.fullDays);
    const cells = w.days.map((d) => {
      const future = d > data.today;
      const done = scoredOf(w).filter((t) => w.entries[t.id]?.[d] > 0);
      return h('div', {
        class: 'wcell' + (full.has(d) ? ' full' : '') + (future ? ' future' : ''),
        title: `${ddmm(d)}: ${future ? 'not yet' : done.length ? done.map((t) => t.name).join(', ') : 'nothing ticked'}`,
      }, future ? null : scoredOf(w).map((t) => h('i', { class: w.entries[t.id]?.[d] > 0 ? 'on' : '' })));
    });
    const wi = w.weighIn;
    const prev = wi ? weighMap.get(addDays(w.monday, -7)) : null;
    const diff = wi && prev ? wi.kg - prev.kg : null;
    return h('a', { class: 'wrow', href: w.current ? '/' : `/?week=${w.monday}` },
      h('div', { class: 'wdate' },
        h('span', {}, w.ddmm),
        h('b', {}, wi ? shortStLb(wi.kg) : '—', wi?.late ? '*' : ''),
        diff != null ? h('span', { class: `delta ${deltaClass(diff)}` }, kgDelta(diff).replace(' lb', '')) : null),
      ...cells,
      h('div', { class: 'wscore' + (w.current ? ' live' : '') },
        w.score != null ? `${w.score}` : '–',
        w.cleanSweep ? h('span', { class: 'sweep', title: 'Perfect week: every target hit its goal' }, '🏆') : w.current ? h('span', { class: 'sofar' }, 'so far') : null),
    );
  });
  const key = h('div', { class: 'small muted wkey' },
    h('span', {}, h('b', {}, '%'), ' week score'),
    h('span', {}, h('i', { class: 'wcell full' }), ' star day'),
    h('span', {}, h('b', { class: 'sweep' }, '🏆'), ' perfect week'));

  $('month').replaceChildren(summary, dots, ...(rows.length ? [head, ...rows, key] : [h('div', { class: 'muted small' }, 'Nothing tracked this month.')]));
}

// ---------- year ----------
let year = null;
function renderYear() {
  year ??= Number(data.today.slice(0, 4));
  const thisMonth = data.today.slice(0, 7);
  $('yearlabel').textContent = String(year);
  $('yprev').disabled = year <= Number(firstMonth().slice(0, 4));
  $('ynext').disabled = year >= Number(data.today.slice(0, 4));

  const rows = [];
  for (let m = 12; m >= 1; m--) {
    const ym = `${year}-${String(m).padStart(2, '0')}`;
    if (ym > thisMonth || ym < firstMonth()) continue;
    const st = periodStats((iso) => iso.slice(0, 7) === ym, ym + '-01');
    rows.push(h('button', {
      class: 'yrow', type: 'button', title: `Show ${MONTHS[m - 1]}`,
      onclick: () => { month = ym; renderMonth(); $('monthcard').scrollIntoView({ behavior: 'smooth' }); },
    },
      h('span', { class: 'ym' }, MONTHS[m - 1].slice(0, 3)),
      h('span', { class: 'ykg' }, st.endKg != null ? shortStLb(st.endKg) : '—'),
      h('span', { class: `ych delta ${st.change != null ? deltaClass(st.change) : ''}` }, st.change != null ? kgDelta(st.change) : '–'),
      h('span', { class: 'ysc' }, st.score != null ? `${st.score}%` : '–')));
  }

  const yr = String(year);
  const yst = periodStats((iso) => iso.startsWith(yr), `${yr}-01-01`);
  const top = h('div', { class: 'ytotal' },
    h('div', { class: 'tl' }, yst.change == null ? 'This year' : yst.change < -0.02 ? 'Lost this year' : yst.change > 0.02 ? 'Gained this year' : 'No change this year'),
    h('div', { class: `ybig delta ${yst.change != null ? deltaClass(yst.change) : ''}` }, yst.change != null ? kgDelta(yst.change) : '–'));
  const head = h('div', { class: 'yrow yhead' }, h('span', { class: 'ym' }, ''), h('span', { class: 'ykg' }, 'Weight'), h('span', { class: 'ych' }, 'Change'), h('span', { class: 'ysc' }, 'Score'));
  $('year').replaceChildren(top, ...(rows.length ? [head, ...rows] : [h('div', { class: 'muted small' }, 'Nothing tracked this year.')]));
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

$('mprev').addEventListener('click', () => { month = shiftMonth(month, -1); renderMonth(); });
$('mnext').addEventListener('click', () => { month = shiftMonth(month, 1); renderMonth(); });
$('yprev').addEventListener('click', () => { year -= 1; renderYear(); });
$('ynext').addEventListener('click', () => { year += 1; renderYear(); });

let resizeT;
window.addEventListener('resize', () => { clearTimeout(resizeT); resizeT = setTimeout(() => data && renderChart(), 150); });

load();
