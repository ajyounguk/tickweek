import { api, toast, h, stLbToKg, kgToStLb } from '/js/common.js';
import { grouped } from '/js/combined.js';

const $ = (id) => document.getElementById(id);
let targets = [];
let editingId = null;

/** Goal choices; `none` adds "No goal" (logged, not scored). Value '' means no goal. */
const goalOptions = (sel, none) => [
  ...[7, 6, 5, 4, 3, 2, 1].map((n) => h('option', { value: n, selected: n === sel }, `${n}/7 days`)),
  none ? h('option', { value: '', selected: sel == null }, 'No goal') : null,
];
const byId = (id) => targets.find((t) => t.id === id);
const sourcesOf = (t) => targets.filter((s) => s.part_of === t.id && !s.archived_at);
const kindLabel = (t) => (t.kind === 'tick' ? 'Tick' : t.kind === 'number' ? `Number${t.unit ? ` (${t.unit})` : ''}` : 'Combined');
function describe(t) {
  const goal = t.goal_days != null ? `${t.goal_days}/7` : t.part_of && byId(t.part_of) ? `in ${byId(t.part_of).name}` : 'no goal';
  const from = t.kind === 'combined' ? ` · ${sourcesOf(t).map((s) => s.name).join(' + ') || 'nothing yet'}` : '';
  return `${kindLabel(t)}${from} · ${goal}`;
}
/** Checkboxes for a combined target's sources: every active tick/number target. */
function sourceChecks(selfId, picked) {
  return h('div', { class: 'checks' }, targets.filter((t) => !t.archived_at && t.kind !== 'combined').map((t) =>
    h('label', { class: 'chk' },
      h('input', { type: 'checkbox', value: t.id, checked: picked.includes(t.id) }),
      t.name,
      t.part_of && t.part_of !== selfId && byId(t.part_of) ? h('span', { class: 'muted small' }, ` (in ${byId(t.part_of).name})`) : null)));
}
const checkedIds = (box) => [...box.querySelectorAll('input:checked')].map((i) => Number(i.value));

async function loadTargets() {
  targets = await api('GET', '/api/targets');
  renderTargets();
  renderAddSources();
}

function renderTargets() {
  const active = grouped(targets.filter((t) => !t.archived_at));
  const archived = targets.filter((t) => t.archived_at);
  // Reorder moves blocks: a combined target moves together with its sources.
  // grouped() puts sources straight before their combined target, so collect them until it comes.
  const blocks = [];
  let sources = [];
  for (const t of active) {
    if (t.part_of && active.some((x) => x.id === t.part_of)) { sources.push(t); continue; }
    blocks.push(t.kind === 'combined' ? [...sources, t] : [t]);
    sources = [];
  }
  const rows = blocks.flatMap((block, bi) => block.map((t) => (t.id === editingId ? editRow(t) : viewRow(t, bi, blocks))));
  $('targets').replaceChildren(...(rows.length ? rows : [h('li', { class: 'muted' }, 'No active targets.')]));

  $('archivedcard').classList.toggle('hidden', !archived.length);
  $('archived').replaceChildren(...archived.map((t) => h('li', {},
    h('div', { class: 'info' }, h('div', {}, t.name), h('div', { class: 'meta' }, describe(t))),
    h('button', { class: 'btn', onclick: () => act(`/api/targets/${t.id}/unarchive`, 'POST', null, 'Restored') }, 'Restore'),
  )));
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
    h('button', { class: 'btn link', onclick: () => { editingId = t.id; renderTargets(); } }, 'Edit'),
  );
}

function editRow(t) {
  const combined = t.kind === 'combined';
  const src = !!(t.part_of && byId(t.part_of));
  const name = h('input', { type: 'text', value: t.name, maxlength: 40, 'aria-label': 'Name' });
  const unit = t.kind === 'number' ? h('input', { type: 'text', value: t.unit ?? '', maxlength: 12, 'aria-label': 'Unit', placeholder: 'unit' }) : null;
  const goal = src ? null : h('select', { 'aria-label': 'Goal' }, goalOptions(t.goal_days, !combined));
  const checks = combined ? sourceChecks(t.id, sourcesOf(t).map((s) => s.id)) : null;
  const save = () => {
    const body = { name: name.value, unit: unit?.value };
    if (goal) body.goal_days = goal.value === '' ? null : Number(goal.value);
    if (checks) body.sources = checkedIds(checks);
    act(`/api/targets/${t.id}`, 'PATCH', body, 'Saved').then((ok) => { if (ok) editingId = null; renderTargets(); });
  };
  const freed = combined ? sourcesOf(t).map((s) => s.name) : [];
  const retireMsg = `Retire “${t.name}”? It disappears from this week on; its history stays.`
    + (freed.length ? ` ${freed.join(' and ')} will have no goal until you set one.` : '');
  return h('li', {},
    h('div', { class: 'form', style: 'flex:1' },
      h('label', {}, h('span', {}, 'Name'), name),
      h('div', { class: 'two' },
        unit ? h('label', {}, h('span', {}, 'Unit'), unit) : null,
        goal ? h('label', {}, h('span', {}, 'Goal'), goal) : null,
      ),
      checks ? h('div', {}, h('span', { class: 'small muted' }, 'Counts'), checks) : null,
      h('div', { class: 'row' },
        h('button', { class: 'btn primary', onclick: save }, 'Save'),
        h('button', { class: 'btn link', onclick: () => { editingId = null; renderTargets(); } }, 'Cancel'),
        h('button', {
          class: 'btn link danger', style: 'margin-left:auto',
          onclick: () => confirm(retireMsg)
            && act(`/api/targets/${t.id}/archive`, 'POST', null, 'Retired').then((ok) => { if (ok) { editingId = null; renderTargets(); } }),
        }, 'Retire'),
      ),
      h('div', { class: 'small muted' }, src
        ? `Counts towards ${byId(t.part_of).name}, so it has no goal of its own`
        : `${kindLabel(t).split(' ')[0]} target (the kind can’t change once created)`),
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
F.goal_days.append(...goalOptions(7, true).filter(Boolean));
F.kind.addEventListener('change', syncKind);
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = { name: F.name.value, kind: F.kind.value, unit: F.unit.value, goal_days: F.goal_days.value === '' ? null : Number(F.goal_days.value) };
  if (body.kind === 'combined') body.sources = checkedIds($('addsources'));
  const ok = await act('/api/targets', 'POST', body, 'Added');
  if (ok) { form.reset(); syncKind(); renderAddSources(); }
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
  if (!$('goalst').value || !Number.isInteger(s) || l < 0 || l >= 14) return toast('Enter stone (whole) and lb (0–13.9)');
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
