import { api, toast, h, stLbToKg, kgToStLb } from '/js/common.js';

const $ = (id) => document.getElementById(id);
let targets = [];
let editingId = null;

const goalOptions = (sel) => [7, 6, 5, 4, 3, 2, 1].map((n) => h('option', { value: n, selected: n === sel }, `${n}/7 days`));
const describe = (t) => `${t.kind === 'tick' ? 'Tick' : `Number${t.unit ? ` (${t.unit})` : ''}`} · ${t.goal_days}/7`;

async function loadTargets() {
  targets = await api('GET', '/api/targets');
  renderTargets();
}

function renderTargets() {
  const active = targets.filter((t) => !t.archived_at);
  const archived = targets.filter((t) => t.archived_at);

  $('targets').replaceChildren(...(active.length ? active.map((t, i) => (t.id === editingId ? editRow(t) : viewRow(t, i, active))) : [h('li', { class: 'muted' }, 'No active targets.')]));

  $('archivedcard').classList.toggle('hidden', !archived.length);
  $('archived').replaceChildren(...archived.map((t) => h('li', {},
    h('div', { class: 'info' }, h('div', {}, t.name), h('div', { class: 'meta' }, describe(t))),
    h('button', { class: 'btn', onclick: () => act(`/api/targets/${t.id}/unarchive`, 'POST', null, 'Restored') }, 'Restore'),
  )));
}

function viewRow(t, i, active) {
  const move = (dir) => {
    const ids = active.map((x) => x.id);
    [ids[i], ids[i + dir]] = [ids[i + dir], ids[i]];
    act('/api/targets/order', 'PUT', { ids });
  };
  return h('li', {},
    h('div', { class: 'info' }, h('div', {}, t.name), h('div', { class: 'meta' }, describe(t))),
    h('button', { class: 'iconbtn', disabled: i === 0, 'aria-label': `Move ${t.name} up`, onclick: () => move(-1) }, '↑'),
    h('button', { class: 'iconbtn', disabled: i === active.length - 1, 'aria-label': `Move ${t.name} down`, onclick: () => move(1) }, '↓'),
    h('button', { class: 'btn link', onclick: () => { editingId = t.id; renderTargets(); } }, 'Edit'),
  );
}

function editRow(t) {
  const name = h('input', { type: 'text', value: t.name, maxlength: 40, 'aria-label': 'Name' });
  const unit = t.kind === 'number' ? h('input', { type: 'text', value: t.unit ?? '', maxlength: 12, 'aria-label': 'Unit', placeholder: 'unit' }) : null;
  const goal = h('select', { 'aria-label': 'Goal' }, goalOptions(t.goal_days));
  const save = () => act(`/api/targets/${t.id}`, 'PATCH', { name: name.value, unit: unit?.value, goal_days: Number(goal.value) }, 'Saved').then((ok) => { if (ok) editingId = null; renderTargets(); });
  return h('li', {},
    h('div', { class: 'form', style: 'flex:1' },
      h('label', {}, h('span', {}, 'Name'), name),
      h('div', { class: 'two' },
        unit ? h('label', {}, h('span', {}, 'Unit'), unit) : null,
        h('label', {}, h('span', {}, 'Goal'), goal),
      ),
      h('div', { class: 'row' },
        h('button', { class: 'btn primary', onclick: save }, 'Save'),
        h('button', { class: 'btn link', onclick: () => { editingId = null; renderTargets(); } }, 'Cancel'),
        h('button', {
          class: 'btn link danger', style: 'margin-left:auto',
          onclick: () => confirm(`Retire “${t.name}”? It disappears from this week on; its history stays.`)
            && act(`/api/targets/${t.id}/archive`, 'POST', null, 'Retired').then((ok) => { if (ok) { editingId = null; renderTargets(); } }),
        }, 'Retire'),
      ),
      h('div', { class: 'small muted' }, `${t.kind === 'tick' ? 'Tick' : 'Number'} target (the kind can’t change once created)`),
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
F.goal_days.append(...goalOptions(7));
F.kind.addEventListener('change', () => form.querySelector('.unitfield').classList.toggle('hidden', F.kind.value !== 'number'));
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const ok = await act('/api/targets', 'POST', {
    name: F.name.value, kind: F.kind.value, unit: F.unit.value, goal_days: Number(F.goal_days.value),
  }, 'Added');
  if (ok) { form.reset(); form.querySelector('.unitfield').classList.add('hidden'); }
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
