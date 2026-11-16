import { api, toast, h, TICK_SVG, fmtNum, stLbToKg, kgToStLb, formatStLb } from '/js/common.js';

const $ = (id) => document.getElementById(id);
let data = null;
let editingWeigh = false;

// ---------- load ----------
async function load(monday) {
  const qs = monday ? `?monday=${monday}` : '';
  try {
    data = await api('GET', `/api/week${qs}`);
  } catch (e) {
    toast(e.message);
    if (monday) return load(); // bad ?week= in the URL: fall back to this week
    return;
  }
  editingWeigh = false;
  const url = data.current ? '/' : `/?week=${data.monday}`;
  if (location.pathname + location.search !== url) history.replaceState(null, '', url);
  render();
}

// ---------- local scoring (mirrors src/scoring.js) ----------
function recompute() {
  let got = 0, max = 0;
  for (const t of data.targets) {
    t.done = Object.values(data.entries[t.id] ?? {}).filter((v) => v > 0).length;
    got += Math.min(t.done, t.goal_days);
    max += t.goal_days;
  }
  data.score = max ? Math.round((got / max) * 100) : null;
  data.cleanSweep = data.targets.length > 0 && data.targets.every((t) => t.done >= t.goal_days);
}

// ---------- render ----------
/** '16/11 – 22/11/26', or '28/12/26 – 03/01/27' when the week crosses New Year. */
function weekRange(from, to) {
  const dm = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
  const y1 = from.slice(2, 4), y2 = to.slice(2, 4);
  return y1 === y2 ? `${dm(from)} – ${dm(to)}/${y2}` : `${dm(from)}/${y1} – ${dm(to)}/${y2}`;
}

function render() {
  const d0 = data.days[0], d6 = data.days[6];
  $('weeklabel').replaceChildren(
    data.current ? 'This week' : `Week of ${d0.ddmm}`,
    h('small', {}, weekRange(d0.date, d6.date)),
  );
  $('prev').disabled = !data.prevMonday;
  $('next').disabled = !data.nextMonday;
  renderNotices();
  renderScore();
  renderWeigh();
  renderGrid();
}

function renderNotices() {
  const box = $('notices');
  box.replaceChildren();
  const anyEditable = data.days.some((d) => d.editable);
  if (data.corrections) box.append(h('div', { class: 'notice warn' }, 'Corrections mode is on: older weeks are unlocked. ', h('a', { href: '/settings' }, 'Settings')));
  if (!data.current && anyEditable && !data.corrections) box.append(h('div', { class: 'notice' }, 'Last week stays editable until this week’s weigh-in.'));
  if (!anyEditable && !data.current) box.append(h('div', { class: 'notice' }, 'This week is locked. ', h('a', { href: '/settings' }, 'Corrections mode'), ' unlocks it.'));
}

function renderScore() {
  const card = $('scorecard');
  if (data.score == null) {
    card.replaceChildren(h('div', { class: 'muted' }, 'No targets this week. ', h('a', { href: '/settings' }, 'Add some in Settings.')));
    return;
  }
  card.replaceChildren(
    h('div', { class: 'score' },
      h('span', { class: 'big' }, `${data.score}%`),
      h('span', { class: 'muted' }, 'week score'),
      data.cleanSweep ? h('span', { class: 'badge', style: 'margin-left:auto' }, '🏆 Clean sweep') : data.current ? h('span', { class: 'pill', style: 'margin-left:auto' }, 'in progress') : null,
    ),
    h('div', { class: 'bar' }, h('i', { style: `width:${data.score}%` })),
  );
}

function renderWeigh() {
  const card = $('weigh');
  const w = data.weighIn;
  card.className = 'card weigh' + (data.current && !w && data.weighInEditable ? ' due' : '');
  const kids = [h('h2', {}, `Weigh-in · Mon ${data.days[0].ddmm}`)];

  if (w && !editingWeigh) {
    const prev = data.prevWeighIn;
    let delta = null;
    if (prev) {
      const diff = w.kg - prev.kg;
      const cls = diff < 0 ? 'down' : diff > 0 ? 'up' : '';
      const arrow = diff < 0 ? '▼ ' : diff > 0 ? '▲ ' : '';
      delta = h('span', { class: `delta ${cls}` }, Math.abs(diff) < 0.02 ? 'no change' : arrow + formatStLb(Math.abs(diff)));
    }
    kids.push(h('div', { class: 'row' },
      h('span', { class: 'value' }, formatStLb(w.kg)),
      delta,
      w.late ? h('span', { class: 'pill warn' }, 'late') : null,
      data.weighInEditable ? h('button', { class: 'btn link', style: 'margin-left:auto', onclick: () => { editingWeigh = true; renderWeigh(); } }, 'Edit') : null,
    ));
  } else if (data.weighInEditable) {
    kids.push(weighForm(w));
  } else {
    kids.push(h('div', { class: 'muted' }, 'No weigh-in this week.'));
  }

  const goal = goalLine();
  if (goal) kids.push(goal);
  if (data.personalBest && (data.prevWeighIn || data.losing.longest)) { // nothing to say until a second weigh-in
    kids.push(h('div', { class: 'wstats' },
      h('span', {}, 'Losing streak ', h('b', {}, `${data.losing.current} wk${data.losing.current === 1 ? '' : 's'}`)),
      h('span', {}, 'Best ', h('b', {}, `${data.losing.longest} wk${data.losing.longest === 1 ? '' : 's'}`)),
      h('span', {}, 'PB ', h('b', {}, formatStLb(data.personalBest.kg))),
    ));
  }
  card.replaceChildren(...kids);
}

function weighForm(existing) {
  const base = existing?.kg ?? data.prevWeighIn?.kg ?? data.latestKg;
  const p = base ? kgToStLb(base) : null;
  const st = h('input', { type: 'number', class: 'n2', inputmode: 'numeric', min: 0, max: 60, step: 1, 'aria-label': 'stone', value: existing ? p.st : null, placeholder: p ? p.st : 'st' });
  const lb = h('input', { type: 'number', class: 'n3', inputmode: 'decimal', min: 0, max: 13.9, step: 0.1, 'aria-label': 'pounds', value: existing ? p.lb : null, placeholder: p ? p.lb : 'lb' });
  // Same stone as last week is the common case: pre-fill it so only lb needs typing.
  if (!existing && p) st.value = p.st;

  const save = async () => {
    const s = Number(st.value), l = Number(lb.value || 0);
    if (!st.value || !Number.isInteger(s) || s < 0 || l < 0 || l >= 14) return toast('Enter stone (whole) and lb (0–13.9)');
    try {
      const r = await api('PUT', '/api/weigh-in', { monday: data.monday, kg: stLbToKg(s, l) });
      toast(r.weighIn.late ? 'Saved (late weigh-in)' : 'Saved');
      await load(data.current ? null : data.monday);
    } catch (e) { toast(e.message); }
  };
  const remove = async () => {
    if (!confirm('Delete this weigh-in?')) return;
    try { await api('PUT', '/api/weigh-in', { monday: data.monday, kg: null }); await load(data.current ? null : data.monday); }
    catch (e) { toast(e.message); }
  };
  lb.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); });

  const today = data.days.find((d) => d.isToday);
  const late = data.current && !existing && today && today.dow !== 'Mon';
  return h('div', {},
    h('div', { class: 'stlb' },
      h('label', {}, st, 'st'),
      h('label', {}, lb, 'lb'),
      h('button', { class: 'btn primary', onclick: save }, 'Save'),
      existing ? h('button', { class: 'btn link', onclick: () => { editingWeigh = false; renderWeigh(); } }, 'Cancel') : null,
      existing ? h('button', { class: 'btn link danger', onclick: remove }, 'Delete') : null,
    ),
    late ? h('div', { class: 'small muted', style: 'margin-top:6px' }, 'Not Monday any more: this will count as a late weigh-in.') : null,
  );
}

function goalLine() {
  if (data.goalKg == null) {
    return data.current ? h('div', { class: 'small muted', style: 'margin-top:10px' }, h('a', { href: '/settings' }, 'Set a goal weight'), ' to see how far there is to go.') : null;
  }
  if (data.latestKg == null) return null;
  const toGo = Math.max(0, data.latestKg - data.goalKg);
  const span = data.startKg != null ? data.startKg - data.goalKg : 0;
  const pct = span > 0 ? Math.min(100, Math.max(0, ((data.startKg - data.latestKg) / span) * 100)) : toGo === 0 ? 100 : 0;
  return h('div', { style: 'margin-top:12px' },
    h('div', { class: 'row small', style: 'margin-bottom:5px' },
      h('span', {}, toGo < 0.02 ? 'Goal reached!' : `${formatStLb(toGo)} to go`),
      h('span', { class: 'muted', style: 'margin-left:auto' }, `goal ${formatStLb(data.goalKg)}`),
    ),
    h('div', { class: 'bar' }, h('i', { style: `width:${pct}%` })),
  );
}

function renderGrid() {
  const card = $('gridcard');
  card.classList.toggle('hidden', !data.targets.length); // the score card already says "add some in Settings"
  const head = h('div', { class: 'grid' }, data.days.map((d) =>
    h('div', { class: 'dayhead' + (d.isToday ? ' today' : '') }, h('b', {}, d.dow), d.ddmm.slice(0, 2))));
  const blocks = data.targets.map((t) => {
    const met = t.done >= t.goal_days;
    return h('div', { class: 'target' },
      h('div', { class: 'name' },
        t.name,
        t.kind === 'number' ? h('span', { class: 'unit' }, weekTotal(t) ? `${fmtNum(weekTotal(t))} ${t.unit ?? ''}` : t.unit ?? '') : null,
        h('span', { style: 'margin-left:auto', class: 'row' },
          data.current && t.streak > 0 ? h('span', { class: 'streak' + (t.streak >= 2 ? ' on' : ''), title: `Current streak: ${t.streak} ${t.streakUnit}` },
            `${t.streak}${t.streakUnit === 'days' ? 'd' : 'wk'} streak`) : null,
          h('span', { class: 'pill' + (met ? ' met' : '') }, `${t.done}/${t.goal_days}`)),
      ),
      h('div', { class: 'grid' }, data.days.map((d) => cell(t, d))),
    );
  });
  card.replaceChildren(head, ...blocks, fullDayRow());
}

/** Bottom row: a ★ under each day where every 7/7 target was done. Only shown if the week has 7/7 targets. */
function fullDayRow() {
  if (!data.targets.some((t) => t.goal_days === 7)) return '';
  const full = new Set(data.fullDays);
  return h('div', { class: 'target fullrow' },
    h('div', { class: 'name' }, 'Star day',
      h('span', { style: 'margin-left:auto', class: 'pill' + (full.size ? ' met' : '') }, `★ ${full.size}`)),
    h('div', { class: 'grid' }, data.days.map((d) =>
      h('div', { class: 'fd' + (full.has(d.date) ? ' on' : '') + (d.future ? ' future' : ''), title: full.has(d.date) ? `${d.dow}: star day (every daily target done)` : null },
        full.has(d.date) ? '★' : ''))));
}

const weekTotal = (t) => Object.values(data.entries[t.id] ?? {}).reduce((a, v) => a + v, 0);

function cell(t, d) {
  const v = data.entries[t.id]?.[d.date] ?? 0;
  const done = v > 0;
  const cls = ['cell', done && 'done', t.kind === 'number' && 'num', d.isToday && 'today', d.future && 'future'].filter(Boolean).join(' ');
  const label = `${t.name}, ${d.dow} ${d.ddmm}: ${done ? (t.kind === 'number' ? `${fmtNum(v)} ${t.unit ?? ''}` : 'done') : 'not done'}`;
  const btn = h('button', { class: cls, disabled: !d.editable, 'aria-label': label, 'aria-pressed': t.kind === 'tick' ? String(done) : null });
  if (done) {
    if (t.kind === 'tick') btn.innerHTML = TICK_SVG;
    else btn.textContent = fmtNum(v);
  }
  btn.addEventListener('click', () => (t.kind === 'tick' ? setEntry(t, d.date, done ? 0 : 1) : openPad(t, d, v)));
  return btn;
}

// ---------- writes (optimistic) ----------
async function setEntry(t, date, value) {
  const before = data.entries[t.id]?.[date];
  const map = (data.entries[t.id] ??= {});
  if (value > 0) map[date] = value; else delete map[date];
  recompute();
  renderScore();
  renderGrid();
  try {
    const r = await api('PUT', '/api/entry', { date, target_id: t.id, value });
    if (r.value > 0) map[date] = r.value; else delete map[date];
    refreshSoon();
  } catch (e) {
    if (before) map[date] = before; else delete map[date];
    recompute();
    toast(e.message);
    renderScore();
    renderGrid();
  }
}

// Streaks and star days are computed server-side: re-fetch shortly after a burst of taps settles.
let refreshT;
function refreshSoon() {
  clearTimeout(refreshT);
  refreshT = setTimeout(async () => {
    try {
      const fresh = await api('GET', `/api/week${data.current ? '' : `?monday=${data.monday}`}`);
      if (fresh.monday !== data.monday) return; // navigated away meanwhile
      data = fresh;
      if (!editingWeigh) renderWeigh();
      renderScore();
      renderGrid();
    } catch { /* next load will catch up */ }
  }, 700);
}

// ---------- number pad ----------
let pad = { t: null, d: null, buf: '' };

function openPad(t, d, current) {
  pad = { t, d, buf: current > 0 ? fmtNum(current) : '' };
  $('padtitle').textContent = t.name;
  $('padsub').textContent = `${d.dow} ${d.ddmm}`;
  drawPad();
  $('pad').showModal();
}
function drawPad() {
  $('paddisplay').replaceChildren(pad.buf || '0', pad.t.unit ? h('span', { class: 'u' }, pad.t.unit) : '');
}
function press(k) {
  if (k === '⌫') pad.buf = pad.buf.slice(0, -1);
  else if (k === '.') { if (!pad.buf.includes('.')) pad.buf = (pad.buf || '0') + '.'; }
  else if (pad.buf.length < 7 && !/\.\d\d$/.test(pad.buf)) pad.buf = pad.buf === '0' ? k : pad.buf + k;
  drawPad();
}
function closePad(save) {
  $('pad').close();
  if (save !== undefined) setEntry(pad.t, pad.d.date, save);
}
$('padkeys').append(...['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', '⌫'].map((k) =>
  h('button', { type: 'button', onclick: () => press(k), 'aria-label': k === '⌫' ? 'delete' : k }, k)));
$('padcancel').addEventListener('click', () => closePad());
$('padclear').addEventListener('click', () => closePad(0));
$('padsave').addEventListener('click', () => closePad(Number(pad.buf) || 0));
$('pad').addEventListener('keydown', (e) => {
  if (/^[0-9.]$/.test(e.key)) press(e.key);
  else if (e.key === 'Backspace') press('⌫');
  else if (e.key === 'Enter') { e.preventDefault(); $('padsave').click(); }
});
$('pad').addEventListener('click', (e) => { if (e.target === $('pad')) closePad(); }); // tap backdrop

// ---------- nav ----------
$('prev').addEventListener('click', () => data?.prevMonday && load(data.prevMonday));
$('next').addEventListener('click', () => data?.nextMonday && load(data.nextMonday));
// Coming back to the app (home-screen icon, next morning): refresh so "today" moves on.
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && data) load(data.current ? null : data.monday); });

load(new URLSearchParams(location.search).get('week'));
