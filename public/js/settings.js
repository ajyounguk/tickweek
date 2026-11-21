import { api, toast, h, stLbToKg, kgToStLb } from '/js/common.js';
import { grouped } from '/js/combined.js';

const $ = (id) => document.getElementById(id);
let targets = [];
let editingId = null;
/** Unsaved edits to a combined target: the list previews its sources as they're ticked. */
let draft = null;
function startEdit(t) {
  editingId = t?.id ?? null;
  draft = null;
  if (t?.kind === 'combined') {
    const sources = sourcesOf(t).map((s) => s.id);
    const pool = targets.filter((x) => !x.archived_at && x.kind !== 'combined');
    draft = { name: t.name, goal: t.goal_days, sources,
      order: [...pool.filter((x) => sources.includes(x.id)), ...pool.filter((x) => !sources.includes(x.id))].map((x) => x.id) };
  }
  renderTargets();
}
/** A target as the list should show it, with the draft's sources moved under the combined target being edited. */
const preview = (t) => {
  if (!draft) return t;
  const part_of = draft.sources.includes(t.id) ? editingId : t.part_of === editingId ? null : t.part_of;
  return part_of === t.part_of ? t : { ...t, part_of };
};

/** Goal choices; `none` adds "No goal" (logged, not scored). Value '' means no goal. */
const goalOptions = (sel, none) => [
  ...[7, 6, 5, 4, 3, 2, 1].map((n) => h('option', { value: n, selected: n === sel }, `${n}/7 days`)),
  none ? h('option', { value: '', selected: sel == null }, 'No goal') : null,
];
const byId = (id) => targets.find((t) => t.id === id);
const sourcesOf = (t) => targets.filter((s) => s.part_of === t.id && !s.archived_at);
/** Label over a combined target's checkboxes. */
const SOURCES_LABEL = 'Made up of these targets:';
const kindLabel = (t) => (t.kind === 'tick' ? 'Tick' : t.kind === 'number' ? `Value${t.unit ? ` (${t.unit})` : ''}` : 'Combined target');
function describe(t) {
  const goal = t.goal_days != null ? `${t.goal_days}/7` : t.part_of && byId(t.part_of) ? `in ${byId(t.part_of).name}` : 'no goal';
  const from = t.kind === 'combined' && !sourcesOf(t).length ? ' · counts nothing yet' : '';
  return `${kindLabel(t)}${from} · ${goal}`;
}
/** Checkboxes for a combined target's sources: every active tick/number target, one per line, picked ones first
 *  (or in `order`, kept fixed while editing so boxes don't jump). `onchange` gets the ticked ids. */
function sourceChecks(selfId, picked, order, onchange) {
  const pool = targets.filter((t) => !t.archived_at && t.kind !== 'combined');
  const sorted = order ? order.map(byId).filter((t) => pool.includes(t))
    : [...pool.filter((t) => picked.includes(t.id)), ...pool.filter((t) => !picked.includes(t.id))];
  const box = h('div', { class: 'checks' }, sorted.map((t) =>
    h('label', { class: 'chk' },
      h('input', { type: 'checkbox', value: t.id, checked: picked.includes(t.id), onchange: onchange && (() => onchange(checkedIds(box))) }),
      t.name,
      t.part_of && t.part_of !== selfId && byId(t.part_of) ? h('span', { class: 'muted small' }, ` (in ${byId(t.part_of).name})`) : null)));
  return box;
}
const checkedIds = (box) => [...box.querySelectorAll('input:checked')].map((i) => Number(i.value));

async function loadTargets() {
  targets = await api('GET', '/api/targets');
  renderTargets();
  renderAddSources();
}

function renderTargets() {
  const active = grouped(targets.filter((t) => !t.archived_at).map(preview));
  const archived = targets.filter((t) => t.archived_at);
  // Reorder moves blocks: a combined target moves together with its sources.
  // grouped() puts sources straight after their combined target, so they join its block.
  const blocks = [];
  for (const t of active) {
    if (t.part_of && active.some((x) => x.id === t.part_of)) blocks.at(-1).push(t);
    else blocks.push([t]);
  }
  const rows = blocks.flatMap((block, bi) => block.map((t, k) => {
    const li = t.id === editingId ? editRow(t) : viewRow(t, bi, blocks);
    // A combined target and its sources are drawn as one group.
    if (block.length > 1) li.classList.add('grp', ...(k === 0 ? ['grp-first'] : []), ...(k === block.length - 1 ? ['grp-last'] : []));
    // While editing, other groups lose their green (the fading is done by applyFocus).
    if (editingId != null && !block.some((x) => x.id === editingId)) li.classList.add('other');
    return li;
  }));
  $('targets').replaceChildren(...(rows.length ? rows : [h('li', { class: 'muted' }, 'No active targets.')]));

  $('archivedcard').classList.toggle('hidden', !archived.length);
  $('archived').replaceChildren(...archived.map((t) => h('li', {},
    h('div', { class: 'info' }, h('div', {}, t.name), h('div', { class: 'meta' }, describe(t))),
    h('button', { class: 'btn link danger', onclick: () => confirm(`Delete “${t.name}” forever? Its ticks go from every past week too, so old scores change. This can’t be undone.`)
      && act(`/api/targets/${t.id}`, 'DELETE', null, 'Deleted') }, 'Delete'),
    h('button', { class: 'btn', onclick: () => act(`/api/targets/${t.id}/unarchive`, 'POST', null, 'Restored') }, 'Restore'),
  )));
  applyFocus();
}

/** One thing is edited at a time: everything else on the page (bar headings) fades back and can't be used. */
function applyFocus() {
  for (const x of document.querySelectorAll('.dim')) { x.classList.remove('dim'); x.inert = false; }
  const el = editingId != null ? $('targets').querySelector('li.editing') : form.classList.contains('hidden') ? null : form;
  const main = document.querySelector('main');
  for (let n = el; n && n !== main; n = n.parentElement) {
    for (const s of n.parentElement.children) {
      if (s !== n && !s.matches('header, h1, h2, .hidden')) { s.classList.add('dim'); s.inert = true; }
    }
  }
}

function viewRow(t, bi, blocks) {
  const move = (dir) => {
    const order = [...blocks];
    [order[bi], order[bi + dir]] = [order[bi + dir], order[bi]];
    act('/api/targets/order', 'PUT', { ids: order.flat().map((x) => x.id) });
  };
  const src = !!(t.part_of && byId(t.part_of));
  return h('li', { class: src ? 'src' : null },
    h('div', { class: 'info' }, h('div', {}, t.name), h('div', { class: 'meta' }, describe(t))),
    src ? null : h('button', { class: 'iconbtn', disabled: bi === 0, 'aria-label': `Move ${t.name} up`, onclick: () => move(-1) }, '↑'),
    src ? null : h('button', { class: 'iconbtn', disabled: bi === blocks.length - 1, 'aria-label': `Move ${t.name} down`, onclick: () => move(1) }, '↓'),
    h('button', { class: 'btn link', onclick: () => startEdit(t) }, 'Edit'),
  );
}

function editRow(t) {
  const combined = t.kind === 'combined';
  const src = !!(t.part_of && byId(t.part_of));
  // The target's name heads the box and follows the Name field as it's typed.
  const title = h('div', { class: 'edittitle' }, draft?.name || t.name);
  const name = h('input', { type: 'text', value: draft?.name ?? t.name, maxlength: 40, 'aria-label': 'Name', oninput: () => {
    if (draft) draft.name = name.value;
    title.textContent = name.value.trim() || t.name;
  } });
  const unit = t.kind === 'number' ? h('input', { type: 'text', value: t.unit ?? '', maxlength: 12, 'aria-label': 'Unit', placeholder: 'unit' }) : null;
  const goal = src ? null : h('select', { 'aria-label': 'Goal', onchange: () => { if (draft) draft.goal = Number(goal.value); } },
    goalOptions(draft ? draft.goal : t.goal_days, !combined));
  const checks = combined ? sourceChecks(t.id, draft.sources, draft.order, (ids) => { draft.sources = ids; renderTargets(); }) : null;
  const save = () => {
    const body = { name: name.value, unit: unit?.value };
    if (goal) body.goal_days = goal.value === '' ? null : Number(goal.value);
    if (checks) body.sources = checkedIds(checks);
    act(`/api/targets/${t.id}`, 'PATCH', body, 'Saved, from this week on').then((ok) => { if (ok) startEdit(null); else renderTargets(); });
  };
  const freed = combined ? sourcesOf(t).map((s) => s.name) : [];
  const retireMsg = `Retire “${t.name}”? It disappears from this week on; its history stays.`
    + (freed.length ? ` ${freed.join(' and ')} will have no goal until you set one.` : '');
  return h('li', { class: 'editing' },
    h('div', { class: 'form', style: 'flex:1' },
      h('div', { class: 'edithead' }, title, h('span', { class: `pill kind${combined ? ' combined' : ''}` }, `${{ tick: 'Tick', number: 'Value', combined: 'Combined' }[t.kind]} target`),
        src ? h('span', { class: 'small muted' }, `in ${byId(t.part_of).name}`) : null),
      h('label', {}, h('span', {}, 'Name'), name),
      h('div', { class: 'two' },
        unit ? h('label', {}, h('span', {}, 'Unit'), unit) : null,
        goal ? h('label', {}, h('span', {}, 'Goal'), goal) : null,
      ),
      checks ? h('div', {}, h('span', { class: 'small muted srclabel' }, SOURCES_LABEL), checks) : null,
      h('div', { class: 'row' },
        h('button', { class: 'btn primary', onclick: save }, 'Save'),
        h('button', { class: 'btn link', onclick: () => startEdit(null) }, 'Cancel'),
        h('button', {
          class: 'btn link danger', style: 'margin-left:auto',
          onclick: () => confirm(retireMsg)
            && act(`/api/targets/${t.id}/archive`, 'POST', null, 'Retired').then((ok) => { if (ok) startEdit(null); }),
        }, 'Retire'),
      ),
    ),
  );
}

/** Call the API, reload the list. Returns true on success. */
async function act(url, method, body, msg) {
  try {
    await api(method, url, body ?? undefined);
    if (msg) toast(msg);
    await loadTargets();
    return true;
  } catch (e) {
    toast(e.message);
    return false;
  }
}

// ---------- add ----------
const form = $('addform');
const F = form.elements;
function renderAddSources() { $('addsources').replaceChildren(sourceChecks(null, checkedIds($('addsources')))); }
function syncKind() {
  const k = F.kind.value;
  form.querySelector('.unitfield').classList.toggle('hidden', k !== 'number');
  form.querySelector('.sourcesfield').classList.toggle('hidden', k !== 'combined');
  const sel = F.goal_days.value === '' ? null : Number(F.goal_days.value);
  F.goal_days.replaceChildren(...goalOptions(k === 'combined' ? sel ?? 4 : sel, k !== 'combined').filter(Boolean));
}
form.querySelector('.srclabel').textContent = SOURCES_LABEL;
$('kindhelpbtn').addEventListener('click', (e) => {
  const open = $('kindhelp').classList.toggle('hidden') === false;
  e.currentTarget.setAttribute('aria-expanded', open);
});
const openAdd = (open) => { form.classList.toggle('hidden', !open); $('addopen').classList.toggle('hidden', open); applyFocus(); if (open) F.name.focus(); };
function closeAdd() { form.reset(); syncKind(); openAdd(false); }
$('addopen').addEventListener('click', () => openAdd(true));
$('addcancel').addEventListener('click', closeAdd);
F.goal_days.append(...goalOptions(7, true).filter(Boolean));
F.kind.addEventListener('change', syncKind);
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = { name: F.name.value, kind: F.kind.value, unit: F.unit.value, goal_days: F.goal_days.value === '' ? null : Number(F.goal_days.value) };
  if (body.kind === 'combined') body.sources = checkedIds($('addsources'));
  const ok = await act('/api/targets', 'POST', body, 'Added');
  if (ok) { closeAdd(); renderAddSources(); }
});

// ---------- goal weight + corrections ----------
async function loadSettings() {
  const s = await api('GET', '/api/settings');
  if (s.goalKg != null) {
    const { st, lb } = kgToStLb(s.goalKg);
    $('goalst').value = st;
    $('goallb').value = lb;
  } else {
    $('goalst').value = '';
    $('goallb').value = '';
  }
  $('corrections').checked = s.corrections;
}

$('goalsave').addEventListener('click', async () => {
  const s = Number($('goalst').value), l = Number($('goallb').value || 0);
  if (!$('goalst').value || !Number.isInteger(s) || !Number.isInteger(l) || l < 0 || l >= 14) return toast('Enter whole stone and lb (0–13)');
  try { await api('PUT', '/api/settings', { goalKg: stLbToKg(s, l) }); toast('Goal saved'); await loadSettings(); }
  catch (e) { toast(e.message); }
});
$('goalclear').addEventListener('click', async () => {
  try { await api('PUT', '/api/settings', { goalKg: null }); toast('Goal cleared'); await loadSettings(); }
  catch (e) { toast(e.message); }
});
$('corrections').addEventListener('change', async (e) => {
  try { await api('PUT', '/api/settings', { corrections: e.target.checked }); toast(e.target.checked ? 'Corrections mode on' : 'Corrections mode off'); }
  catch (err) { toast(err.message); e.target.checked = !e.target.checked; }
});

loadTargets().catch((e) => toast(e.message));
loadSettings().catch((e) => toast(e.message));
