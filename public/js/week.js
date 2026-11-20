import { api, toast, h, TICK_SVG, fmtNum, stLbToKg, kgToStLb, formatStLb, diffKg } from '/js/common.js';
import { withCombined, grouped } from '/js/combined.js';

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
  data.entries = withCombined(data.targets, data.entries); // combined targets follow their sources
  let got = 0, max = 0;
  for (const t of data.targets) {
    t.done = Object.values(data.entries[t.id] ?? {}).filter((v) => v > 0).length;
    if (t.goal_days == null) continue; // no goal: logged, not scored
    got += Math.min(t.done, t.goal_days);
    max += t.goal_days;
  }
  data.score = max ? Math.round((got / max) * 100) : null;
  const scored = data.targets.filter((t) => t.goal_days != null);
  data.cleanSweep = scored.length > 0 && scored.every((t) => t.done >= t.goal_days);
}

const goalMet = (t) => t.goal_days != null && t.done >= t.goal_days;
const parentOf = (t) => (t.part_of ? data.targets.find((x) => x.id === t.part_of) : null);
const sourcesOf = (t) => data.targets.filter((s) => s.part_of === t.id);
/** A source shows stars when its combined target is met. */
const showsStars = (t) => goalMet(parentOf(t) ?? t);

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
  renderStreaks();
}

function renderNotices() {
  const box = $('notices');
  box.replaceChildren();
  const anyEditable = data.days.some((d) => d.editable);
  if (data.current && !data.personalBest) box.append(h('div', { class: 'notice' }, 'New here? ', h('a', { href: '/help' }, 'See how it works'), '.'));
  if (data.corrections) box.append(h('div', { class: 'notice warn' }, 'Corrections mode is on: older weeks are unlocked. ', h('a', { href: '/settings' }, 'Settings')));
  if (!data.current && anyEditable && !data.corrections) box.append(h('div', { class: 'notice' }, 'Last week stays editable until this week’s weigh-in.'));
  if (!anyEditable && !data.current) box.append(h('div', { class: 'notice' }, 'This week is locked. ', h('a', { href: '/settings' }, 'Corrections mode'), ' unlocks it.'));
}

/**
 * The week in a word instead of a %. This week is judged on pace: what's done against what the goals need by now,
 * counting finished days only (today can't put you behind). A past week gets a verdict from its score.
 * `warn` turns the word and bar amber.
 */
function weekWord() {
  if (data.cleanSweep) return { word: 'Perfect week 🏆' };
  if (!data.current) {
    const s = data.score;
    return s >= 80 ? { word: 'Great week' } : s >= 60 ? { word: 'Good week' } : { word: 'Tough week', warn: true };
  }
  const scored = data.targets.filter((t) => t.goal_days != null);
  const got = scored.reduce((a, t) => a + Math.min(t.done, t.goal_days), 0);
  const gone = data.days.filter((d) => d.date < data.today).length; // finished days
  if (!gone) return { word: got ? 'Started' : 'Fresh week' };
  const pace = got / scored.reduce((a, t) => a + (t.goal_days * gone) / 7, 0);
  return pace >= 1.2 ? { word: 'Great' } : pace >= 0.85 ? { word: 'On track' } : { word: 'Catch-up time', warn: true };
}

function renderScore() {
  const card = $('scorecard');
  if (data.score == null) {
    card.replaceChildren(h('div', { class: 'muted' }, 'No targets this week. ', h('a', { href: '/settings' }, 'Add some in Settings.')));
    return;
  }
  const { word, warn } = weekWord();
  card.replaceChildren(
    h('div', { class: 'score' + (warn ? ' warn' : '') },
      h('span', { class: 'big' }, word),
    ),
    h('div', { class: 'bar' + (warn ? ' warn' : '') }, h('i', { style: `width:${data.score}%` })),
  );
}

function renderWeigh() {
  const card = $('weigh');
  const w = data.weighIn;
  card.className = 'card weigh' + (data.current && !w && data.weighInEditable ? ' due' : '');
  const showing = w && !editingWeigh;
  const kids = [h('div', { class: 'row', style: 'margin-bottom:10px' },
    h('h2', { style: 'margin:0' }, `Weigh-in · ${data.days[0].ddmm}`),
    showing && data.weighInEditable
      ? h('button', { class: 'btn link small', style: 'margin-left:auto', onclick: () => { editingWeigh = true; renderWeigh(); } }, 'Edit') : null)];
  if (data.current && !w && data.weighInEditable) {
    const monday = data.days[0].isToday;
    kids.push(h('div', { class: 'small', style: 'margin:-4px 0 10px' },
      monday ? 'Step on the scales this morning.' : 'Missed Monday? You can still enter it (counts as late).'));
  }

  if (showing) {
    const prev = data.prevWeighIn;
    let delta = null;
    if (prev) {
      const diff = diffKg(w.kg, prev.kg);
      const cls = diff < 0 ? 'down' : diff > 0 ? 'up' : '';
      const arrow = diff < 0 ? '▼ ' : diff > 0 ? '▲ ' : '';
      delta = h('span', { class: `delta ${cls}` }, Math.abs(diff) < 0.02 ? 'no change' : arrow + formatStLb(Math.abs(diff)));
    }
    kids.push(h('div', { class: 'row' },
      h('span', { class: 'value' }, formatStLb(w.kg)),
      delta,
      w.late ? h('span', { class: 'pill warn' }, 'late') : null,
    ));
  } else if (data.weighInEditable) {
    kids.push(weighForm(w));
  } else {
    kids.push(h('div', { class: 'muted' }, 'No weigh-in this week.'));
  }

  const goal = goalLine();
  if (goal) kids.push(goal);
  card.replaceChildren(...kids);
}

function weighForm(existing) {
  const base = existing?.kg ?? data.prevWeighIn?.kg ?? data.latestKg;
  const p = base ? kgToStLb(base) : null;
  const st = h('input', { type: 'number', class: 'n2', inputmode: 'numeric', min: 0, max: 60, step: 1, 'aria-label': 'stone', value: existing ? p.st : null, placeholder: p ? p.st : 'st' });
  const lb = h('input', { type: 'number', class: 'n3', inputmode: 'numeric', min: 0, max: 13, step: 1, 'aria-label': 'pounds', value: existing ? p.lb : null, placeholder: p ? p.lb : 'lb' });
  // Same stone as last week is the common case: pre-fill it so only lb needs typing.
  if (!existing && p) st.value = p.st;

  const save = async () => {
    const s = Number(st.value), l = Number(lb.value || 0);
    if (!st.value || !Number.isInteger(s) || s < 0 || !Number.isInteger(l) || l < 0 || l >= 14) return toast('Enter whole stone and lb (0–13)');
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

  return h('div', {},
    h('div', { class: 'stlb' },
      h('label', {}, st, 'st'),
      h('label', {}, lb, 'lb'),
      h('button', { class: 'btn primary', onclick: save }, 'Save'),
      existing ? h('button', { class: 'btn link', onclick: () => { editingWeigh = false; renderWeigh(); } }, 'Cancel') : null,
      existing ? h('button', { class: 'btn link danger', onclick: remove }, 'Delete') : null,
    ),
  );
}

function goalLine() {
  if (data.goalKg == null) {
    return data.current ? h('div', { class: 'small muted', style: 'margin-top:10px' }, h('a', { href: '/settings' }, 'Set a goal weight'), ' to see how far there is to go.') : null;
  }
  if (data.latestKg == null) return null;
  const toGo = Math.max(0, diffKg(data.latestKg, data.goalKg));
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

/** `change` = { ids, dir: 'in' | 'out' } when a tap just crossed a goal: animate only those rows. */
function renderGrid(change) {
  const card = $('gridcard');
  card.classList.toggle('hidden', !data.targets.length); // the score card already says "add some in Settings"
  const stars = new Set(data.fullDays);
  const head = h('div', { class: 'grid' }, data.days.map((d) => {
    const star = stars.has(d.date);
    const title = [d.dow === 'Mon' && 'Weigh-in day', star && 'Star day: every goal done'].filter(Boolean).join(' · ') || null;
    return h('div', { class: 'dayhead' + (d.isToday ? ' today' : '') + (d.dow === 'Mon' ? ' weighday' : '') + (star ? ' starday' : ''), title },
      h('b', {}, d.dow), d.ddmm.slice(0, 2), d.dow === 'Mon' ? h('span', { class: 'scale', 'aria-hidden': 'true' }, ' ⚖') : null,
      star ? h('span', { class: 'dstar', role: 'img', 'aria-label': 'star day', html: STAR_SVG }) : null);
  }));
  // A combined target heads a .group block; its sources follow inside it.
  const blocks = [];
  let group = null;
  for (const t of grouped(data.targets)) {
    const row = targetRow(t, change);
    if (t.kind === 'combined') blocks.push(group = h('div', { class: 'group' }, row));
    else if (parentOf(t) && group) group.append(row);
    else { group = null; blocks.push(row); }
  }
  card.replaceChildren(head, ...blocks);
}

/** One target's row: name, unit or weekly total, N/goal pill, and its seven boxes. */
function targetRow(t, change) {
  const met = showsStars(t);
  // Cascade order over the filled boxes: left-to-right into stars, right-to-left back to ticks.
  let order = null;
  if (change?.ids.has(t.id)) {
    const filled = data.days.filter((d) => (data.entries[t.id]?.[d.date] ?? 0) > 0).map((d) => d.date);
    if (change.dir === 'out') filled.reverse();
    order = new Map(filled.map((date, i) => [date, i]));
  }
  return h('div', { class: 'target' + (parentOf(t) ? ' src' : '') },
    h('div', { class: 'name' },
      t.name,
      t.kind === 'number' ? h('span', { class: 'unit' }, weekTotal(t) ? `${fmtNum(weekTotal(t))} ${t.unit ?? ''}` : t.unit ?? '') : null,
      t.goal_days != null ? h('span', { style: 'margin-left:auto', class: 'pill' + (met ? ' met' : '') }, `${t.done}/${t.goal_days}`)
        : parentOf(t) ? null : h('span', { style: 'margin-left:auto', class: 'pill nogoal' }, 'no goal'),
    ),
    h('div', { class: 'grid' }, data.days.map((d) => cell(t, d, met, order?.has(d.date) ? { dir: change.dir, i: order.get(d.date) } : null))),
  );
}

/** Compact streaks for this week only: "Intermittent fast · 15 days in a row". Full detail lives on History. */
function renderStreaks() {
  const card = $('streakcard');
  const live = data.current ? data.targets.filter((t) => t.streak > 0) : [];
  card.classList.toggle('hidden', !live.length);
  if (!live.length) return card.replaceChildren();
  const unit = (t) => (t.streakUnit === 'days' ? (t.streak === 1 ? 'day' : 'days') : t.streak === 1 ? 'week' : 'weeks');
  card.replaceChildren(
    h('h2', {}, 'Streaks'),
    h('ul', { class: 'tlist compact' }, live.map((t) => h('li', {},
      h('div', { class: 'info' }, t.name),
      h('div', { class: 'streak' + (t.streak >= 2 ? ' on' : '') }, `${t.streak} ${unit(t)} in a row`)))),
  );
}

const weekTotal = (t) => Object.values(data.entries[t.id] ?? {}).reduce((a, v) => a + v, 0);

const STAR_SVG = '<svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" aria-hidden="true"><path d="M12 2.8l2.8 5.8 6.4.9-4.6 4.5 1.1 6.4L12 17.4l-5.7 3 1.1-6.4-4.6-4.5 6.4-.9z"/></svg>';

/** What a filled box shows: tick or number, or ★ (with the number small underneath) once the row has met its goal. */
function glyph(t, v, star) {
  if (!star) return t.kind === 'number' ? h('span', { class: 'g' }, fmtNum(v)) : h('span', { class: 'g', html: TICK_SVG }); // combined draws as a tick
  return h('span', { class: 'g star', html: STAR_SVG }, t.kind === 'number' ? h('small', {}, fmtNum(v)) : null);
}

/**
 * `anim` = { dir, i } when this box morphs as its row crosses the goal (i = position in the cascade).
 * A combined target's boxes aren't buttons: they fill themselves from its sources.
 */
function cell(t, d, met, anim) {
  const v = data.entries[t.id]?.[d.date] ?? 0;
  const done = v > 0;
  const auto = t.kind === 'combined';
  const cls = ['cell', done && 'done', t.kind === 'number' && 'num', d.isToday && 'today', d.future && 'future',
    auto && 'auto', auto && !d.editable && 'locked', anim && 'morph', anim?.dir === 'in' && 'glow'].filter(Boolean).join(' ');
  const what = auto
    ? (done ? `done (${sourcesOf(t).filter((s) => data.entries[s.id]?.[d.date] > 0).map((s) => s.name).join(', ')})` : 'not done')
    : done ? (t.kind === 'number' ? `${fmtNum(v)} ${t.unit ?? ''}` : 'done') : 'not done';
  const label = `${t.name}, ${d.dow} ${d.ddmm}: ${what}${met ? ', goal met' : ''}`;
  const btn = auto
    ? h('div', { class: cls, role: 'img', 'aria-label': label })
    : h('button', { class: cls, disabled: !d.editable, 'aria-label': label, 'aria-pressed': t.kind === 'tick' ? String(done) : null });
  if (done && anim) {
    // Old glyph out, new glyph in, layered in the same spot; CSS staggers by --i.
    btn.style.setProperty('--i', anim.i);
    const into = anim.dir === 'in';
    btn.append(h('span', { class: 'out' }, glyph(t, v, !into)), h('span', { class: 'in' }, glyph(t, v, into)));
  } else if (done) {
    btn.append(glyph(t, v, met));
  }
  if (!auto) btn.addEventListener('click', () => (t.kind === 'tick' ? setEntry(t, d.date, done ? 0 : 1) : openPad(t, d, v)));
  return btn;
}

// ---------- writes (optimistic) ----------
async function setEntry(t, date, value) {
  const before = data.entries[t.id]?.[date];
  const map = (data.entries[t.id] ??= {});
  // The goal that can flip: the target's own, or (for a source) its combined target's.
  const watched = parentOf(t) ?? t;
  recompute();
  const wasMet = goalMet(watched);
  if (value > 0) map[date] = value; else delete map[date];
  recompute();
  const isMet = goalMet(watched);
  let change = null;
  if (wasMet !== isMet) {
    change = { ids: new Set([watched.id, ...sourcesOf(watched).map((s) => s.id)]), dir: isMet ? 'in' : 'out' };
    animUntil = Date.now() + 70 * 7 + 400; // stagger + morph + glow
  }
  renderScore();
  renderGrid(change);
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
// The refresh rebuilds the grid, so it waits for any star cascade to finish.
let refreshT, animUntil = 0;
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
      renderStreaks();
    } catch { /* next load will catch up */ }
  }, Math.max(700, animUntil - Date.now()));
}

// ---------- number entry (plain input, so the phone's own number keyboard comes up, as for the weigh-in) ----------
let pad = { t: null, d: null };

function openPad(t, d, current) {
  pad = { t, d };
  $('padtitle').textContent = t.name;
  $('padsub').textContent = `${d.dow} ${d.ddmm}`;
  $('padunit').textContent = t.unit ?? '';
  const input = $('padinput');
  input.value = current > 0 ? fmtNum(current) : '';
  input.setAttribute('aria-label', t.unit || t.name);
  $('pad').showModal();
  input.focus();
}
function closePad(save) {
  $('pad').close();
  if (save !== undefined) setEntry(pad.t, pad.d.date, save);
}
$('padcancel').addEventListener('click', () => closePad());
$('padclear').addEventListener('click', () => closePad(0));
$('padsave').addEventListener('click', () => {
  const raw = $('padinput').value.trim().replace(',', '.');
  const v = raw === '' ? 0 : Number(raw);
  if (!Number.isFinite(v) || v < 0 || v > 100000) return toast('Enter a number');
  closePad(Math.round(v * 100) / 100);
});
$('padinput').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('padsave').click(); } });
$('pad').addEventListener('click', (e) => { if (e.target === $('pad')) closePad(); }); // tap backdrop

// ---------- nav ----------
$('prev').addEventListener('click', () => data?.prevMonday && load(data.prevMonday));
$('next').addEventListener('click', () => data?.nextMonday && load(data.nextMonday));
// Coming back to the app (home-screen icon, next morning): refresh so "today" moves on.
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && data) load(data.current ? null : data.monday); });

load(new URLSearchParams(location.search).get('week'));
