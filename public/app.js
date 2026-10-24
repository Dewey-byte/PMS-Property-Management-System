'use strict';

const CURRENCY = 'USD';
const money = new Intl.NumberFormat(undefined, { style: 'currency', currency: CURRENCY });

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const pad = (n) => String(n).padStart(2, '0');
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const fmtDate = (s) =>
  s ? new Date(`${s}T00:00:00`).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '';
const fmtMonth = (s) => {
  if (!s) return '';
  const [y, m] = s.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, { year: 'numeric', month: 'long' });
};
const byLabel = (a, b) => a.label.localeCompare(b.label, undefined, { numeric: true });

const BADGE_COLOR = {
  Paid: 'green', Occupied: 'green', Active: 'green', Resolved: 'green',
  Medium: 'blue', Open: 'blue',
  Partial: 'amber', 'In Progress': 'amber', High: 'amber',
  Unpaid: 'red', Urgent: 'red', Expired: 'red',
  Low: 'gray', Vacant: 'gray', Ended: 'gray',
};
const badge = (text) => `<span class="badge ${BADGE_COLOR[text] ?? 'gray'}">${esc(text)}</span>`;
const PRIORITY_RANK = { Urgent: 0, High: 1, Medium: 2, Low: 3 };

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
  return data;
}

const state = { properties: [], units: [], tenants: [], leases: [], payments: [], maintenance: [] };

async function loadAll() {
  const keys = Object.keys(state);
  const lists = await Promise.all(keys.map((k) => api('GET', `/api/${k}`)));
  keys.forEach((k, i) => (state[k] = lists[i]));
}

// ---------------------------------------------------------------------------
// Entity definitions: each drives its list table and its add/edit form.
//   fields: { key, label, type, required, wide, step, choices | ref | options(ctx), initial, dependsOn }
//   columns: { label, cls, render(row) -> HTML }
// ---------------------------------------------------------------------------

const ENTITIES = {
  properties: {
    singular: 'Property',
    plural: 'Properties',
    fields: [
      { key: 'name', label: 'Name', required: true },
      { key: 'type', label: 'Type', choices: ['Apartment', 'House', 'Condo', 'Commercial', 'Other'] },
      { key: 'address', label: 'Address', required: true, wide: true },
      { key: 'notes', label: 'Notes', type: 'textarea', wide: true },
    ],
    columns: [
      { label: 'Name', render: (r) => `<strong>${esc(r.name)}</strong>` },
      { label: 'Address', render: (r) => esc(r.address) },
      { label: 'Type', render: (r) => esc(r.type) },
      { label: 'Units', cls: 'num', render: (r) => state.units.filter((u) => u.propertyId === r.id).length },
    ],
    sort: byLabel,
  },

  units: {
    singular: 'Unit',
    plural: 'Units',
    needs: ['properties'],
    fields: [
      { key: 'propertyId', label: 'Property', ref: 'properties', required: true, wide: true },
      { key: 'number', label: 'Unit number', required: true },
      { key: 'rent', label: 'Monthly rent', type: 'number', step: '0.01', required: true },
      { key: 'bedrooms', label: 'Bedrooms', type: 'number', step: '1', initial: () => 1 },
      { key: 'bathrooms', label: 'Bathrooms', type: 'number', step: '0.5', initial: () => 1 },
    ],
    columns: [
      { label: 'Property', render: (r) => esc(r.propertyName) },
      { label: 'Unit', render: (r) => `<strong>${esc(r.number)}</strong>` },
      { label: 'Beds / baths', render: (r) => `${esc(r.bedrooms)} bd / ${esc(r.bathrooms)} ba` },
      { label: 'Rent', cls: 'num', render: (r) => money.format(r.rent) },
      { label: 'Status', render: (r) => badge(r.occupancy) },
      { label: 'Tenant', render: (r) => esc(r.tenantName) },
    ],
    sort: byLabel,
  },

  tenants: {
    singular: 'Tenant',
    plural: 'Tenants',
    fields: [
      { key: 'name', label: 'Full name', required: true, wide: true },
      { key: 'email', label: 'Email', type: 'email' },
      { key: 'phone', label: 'Phone', type: 'tel' },
      { key: 'notes', label: 'Notes', type: 'textarea', wide: true },
    ],
    columns: [
      { label: 'Name', render: (r) => `<strong>${esc(r.name)}</strong>` },
      { label: 'Email', render: (r) => esc(r.email) },
      { label: 'Phone', render: (r) => esc(r.phone) },
      { label: 'Current unit', render: (r) => esc(r.currentUnits) || '<span class="sub">—</span>' },
    ],
    sort: byLabel,
  },

  leases: {
    singular: 'Lease',
    plural: 'Leases',
    needs: ['units', 'tenants'],
    fields: [
      { key: 'unitId', label: 'Unit', ref: 'units', required: true, wide: true },
      { key: 'tenantId', label: 'Tenant', ref: 'tenants', required: true, wide: true },
      { key: 'startDate', label: 'Start date', type: 'date', required: true, initial: today },
      { key: 'endDate', label: 'End date', type: 'date', required: true },
      { key: 'rent', label: 'Monthly rent', type: 'number', step: '0.01', required: true },
      { key: 'deposit', label: 'Security deposit', type: 'number', step: '0.01', initial: () => 0 },
      { key: 'status', label: 'Status', choices: ['Active', 'Ended'] },
    ],
    columns: [
      { label: 'Tenant', render: (r) => `<strong>${esc(r.tenantName)}</strong>` },
      { label: 'Unit', render: (r) => esc(r.unitLabel) },
      { label: 'Term', render: (r) => `${fmtDate(r.startDate)} → ${fmtDate(r.endDate)}` },
      { label: 'Rent', cls: 'num', render: (r) => money.format(r.rent) },
      { label: 'Deposit', cls: 'num', render: (r) => money.format(r.deposit) },
      { label: 'Status', render: (r) => badge(r.expired ? 'Expired' : r.status) },
    ],
    sort: (a, b) => b.startDate.localeCompare(a.startDate),
    actions: [
      {
        id: 'end',
        label: 'End lease',
        when: (r) => r.status === 'Active',
        confirm: 'End this lease? The unit will show as vacant.',
        run: (r) => ({ ...r, status: 'Ended' }),
        done: 'Lease ended',
      },
    ],
    onChange(key, form, isNew) {
      if (key !== 'unitId' || !isNew) return;
      const unit = state.units.find((u) => u.id === form.elements.namedItem('unitId').value);
      if (unit) form.elements.namedItem('rent').value = unit.rent;
    },
  },

  payments: {
    singular: 'Payment',
    plural: 'Payments',
    needs: ['leases'],
    fields: [
      {
        key: 'leaseId',
        label: 'Lease',
        required: true,
        wide: true,
        options: ({ rec }) =>
          state.leases
            .filter((l) => l.status === 'Active' || l.id === rec.leaseId)
            .sort(byLabel)
            .map((l) => ({ value: l.id, label: l.label })),
      },
      { key: 'date', label: 'Date received', type: 'date', required: true, initial: today },
      { key: 'period', label: 'Rent for month', type: 'month', required: true, initial: () => today().slice(0, 7) },
      { key: 'amount', label: 'Amount', type: 'number', step: '0.01', required: true },
      { key: 'method', label: 'Method', choices: ['Bank transfer', 'Cash', 'Check', 'Card', 'Online', 'Other'] },
      { key: 'note', label: 'Note', wide: true },
    ],
    columns: [
      { label: 'Date', render: (r) => fmtDate(r.date) },
      { label: 'Rent for', render: (r) => fmtMonth(r.period) },
      { label: 'Tenant', render: (r) => `<strong>${esc(r.tenantName)}</strong>` },
      { label: 'Unit', render: (r) => esc(r.unitLabel) },
      { label: 'Amount', cls: 'num', render: (r) => money.format(r.amount) },
      { label: 'Method', render: (r) => esc(r.method) },
      { label: 'Note', render: (r) => esc(r.note) },
    ],
    sort: (a, b) => b.date.localeCompare(a.date),
    onChange(key, form, isNew) {
      if (key !== 'leaseId' || !isNew) return;
      const lease = state.leases.find((l) => l.id === form.elements.namedItem('leaseId').value);
      if (lease) form.elements.namedItem('amount').value = lease.rent;
    },
  },

  maintenance: {
    singular: 'Request',
    plural: 'Maintenance',
    needs: ['properties'],
    fields: [
      { key: 'title', label: 'Title', required: true, wide: true },
      { key: 'propertyId', label: 'Property', ref: 'properties', required: true },
      {
        key: 'unitId',
        label: 'Unit',
        dependsOn: 'propertyId',
        options: ({ val }) =>
          state.units
            .filter((u) => !val('propertyId') || u.propertyId === val('propertyId'))
            .sort(byLabel)
            .map((u) => ({ value: u.id, label: val('propertyId') ? u.number : u.label })),
      },
      { key: 'priority', label: 'Priority', choices: ['Low', 'Medium', 'High', 'Urgent'], initial: () => 'Medium' },
      { key: 'status', label: 'Status', choices: ['Open', 'In Progress', 'Resolved'] },
      { key: 'reportedDate', label: 'Reported', type: 'date', initial: today },
      { key: 'cost', label: 'Cost', type: 'number', step: '0.01', initial: () => 0 },
      { key: 'description', label: 'Description', type: 'textarea', wide: true },
    ],
    columns: [
      { label: 'Request', render: (r) => `<strong>${esc(r.title)}</strong>` },
      { label: 'Location', render: (r) => esc(r.unitNumber ? `${r.propertyName} · ${r.unitNumber}` : r.propertyName) },
      { label: 'Priority', render: (r) => badge(r.priority) },
      { label: 'Status', render: (r) => badge(r.status) },
      { label: 'Reported', render: (r) => fmtDate(r.reportedDate) },
      { label: 'Cost', cls: 'num', render: (r) => money.format(r.cost) },
    ],
    sort: (a, b) =>
      Number(a.status === 'Resolved') - Number(b.status === 'Resolved') ||
      PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] ||
      b.reportedDate.localeCompare(a.reportedDate),
    actions: [
      {
        id: 'resolve',
        label: 'Resolve',
        when: (r) => r.status !== 'Resolved',
        run: (r) => ({ ...r, status: 'Resolved' }),
        done: 'Marked as resolved',
      },
    ],
  },
};

// ---------------------------------------------------------------------------
// Shell: nav, toast, routing
// ---------------------------------------------------------------------------

const view = $('#view');
const titleEl = $('#title');
const searchEl = $('#search');
const addBtn = $('#add');
const dialog = $('#dialog');
const toastEl = $('#toast');

const NAV = [['dashboard', 'Dashboard'], ...Object.entries(ENTITIES).map(([k, e]) => [k, e.plural])];
$('#nav').innerHTML = NAV.map(([k, label]) => `<a href="#/${k}" data-nav="${k}">${esc(label)}</a>`).join('');

let toastTimer;
function toast(message, isError = false) {
  toastEl.textContent = message;
  toastEl.className = `toast show${isError ? ' error' : ''}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 3500);
}

let shownName = null;
let routeSeq = 0;

async function route() {
  const name = location.hash.replace(/^#\//, '') || 'dashboard';
  if (name !== 'dashboard' && !ENTITIES[name]) {
    location.hash = '#/dashboard';
    return;
  }
  const seq = ++routeSeq;
  if (name !== shownName) {
    searchEl.value = '';
    shownName = name;
  }
  for (const a of document.querySelectorAll('#nav a')) {
    if (a.dataset.nav === name) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }

  const isList = name !== 'dashboard';
  titleEl.textContent = isList ? ENTITIES[name].plural : 'Dashboard';
  searchEl.hidden = addBtn.hidden = !isList;
  if (isList) addBtn.textContent = `+ Add ${ENTITIES[name].singular.toLowerCase()}`;
  document.title = `${titleEl.textContent} · PMS`;

  try {
    if (isList) {
      await loadAll();
      if (seq === routeSeq) renderList(name);
    } else {
      const data = await api('GET', '/api/dashboard');
      if (seq === routeSeq) renderDashboard(data);
    }
  } catch (err) {
    if (seq === routeSeq) view.innerHTML = `<div class="card"><div class="empty">Could not load data: ${esc(err.message)}</div></div>`;
  }
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

function renderDashboard(d) {
  view.dataset.entity = '';
  if (!d.totalProperties) {
    view.innerHTML = `
      <div class="card"><div class="card-body">
        <h2>Welcome to PMS</h2>
        <p>Get set up in a few steps:</p>
        <ol>
          <li><a href="#/properties">Add a property</a></li>
          <li><a href="#/units">Add its units</a> with their monthly rent</li>
          <li><a href="#/tenants">Add your tenants</a></li>
          <li><a href="#/leases">Create a lease</a> linking a tenant to a unit</li>
          <li><a href="#/payments">Record rent payments</a> as they arrive</li>
        </ol>
      </div></div>`;
    return;
  }

  const stat = (label, value, sub, extra = '') =>
    `<div class="card stat"><div class="stat-label">${esc(label)}</div><div class="stat-value">${esc(value)}</div><div class="stat-sub">${esc(sub)}</div>${extra}</div>`;

  const panel = (title, table, emptyText) =>
    `<section class="card"><div class="card-head"><h2>${esc(title)}</h2></div>${
      table ? `<div class="table-wrap">${table}</div>` : `<div class="empty">${esc(emptyText)}</div>`
    }</section>`;

  const table = (heads, rows) =>
    `<table><thead><tr>${heads.map(([h, cls]) => `<th class="${cls ?? ''}">${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table>`;

  const rentRoll = d.rentRoll.length
    ? table(
        [['Tenant'], ['Unit'], ['Rent', 'num'], ['Paid', 'num'], ['Balance', 'num'], ['Status']],
        d.rentRoll
          .map(
            (r) => `<tr><td><strong>${esc(r.tenantName)}</strong></td><td>${esc(r.unitLabel)}</td>
              <td class="num">${money.format(r.rent)}</td><td class="num">${money.format(r.paid)}</td>
              <td class="num">${money.format(r.balance)}</td><td>${badge(r.status)}</td></tr>`,
          )
          .join(''),
      )
    : '';

  const expiring = d.expiringLeases.length
    ? table(
        [['Tenant'], ['Unit'], ['Ends'], ['']],
        d.expiringLeases
          .map((l) => {
            const when =
              l.daysLeft < 0
                ? `<span class="badge red">Expired ${-l.daysLeft}d ago</span>`
                : `<span class="badge ${l.daysLeft <= 30 ? 'amber' : 'blue'}">${l.daysLeft === 0 ? 'Ends today' : `${l.daysLeft}d left`}</span>`;
            return `<tr><td><strong>${esc(l.tenantName)}</strong></td><td>${esc(l.unitLabel)}</td><td>${fmtDate(l.endDate)}</td><td>${when}</td></tr>`;
          })
          .join(''),
      )
    : '';

  const requests = d.openRequests.length
    ? table(
        [['Request'], ['Location'], ['Priority'], ['Status']],
        d.openRequests
          .map(
            (m) => `<tr><td><strong>${esc(m.title)}</strong></td>
              <td>${esc(m.unitNumber ? `${m.propertyName} · ${m.unitNumber}` : m.propertyName)}</td>
              <td>${badge(m.priority)}</td><td>${badge(m.status)}</td></tr>`,
          )
          .join(''),
      )
    : '';

  view.innerHTML = `
    <div class="stats">
      ${stat('Occupancy', `${d.occupancyRate}%`, `${d.occupiedUnits} of ${d.totalUnits} units occupied`, `<progress max="100" value="${d.occupancyRate}"></progress>`)}
      ${stat('Monthly rent roll', money.format(d.monthlyRent), 'From current leases')}
      ${stat(`Collected · ${fmtMonth(d.period)}`, money.format(d.collected), 'Payments for this month')}
      ${stat('Outstanding', money.format(d.outstanding), 'Still due this month')}
      ${stat('Open requests', String(d.openMaintenance), `${d.urgentMaintenance} urgent`)}
      ${stat('Properties', String(d.totalProperties), `${d.totalUnits} units in total`)}
    </div>
    <div class="panels">
      ${panel(`Rent · ${fmtMonth(d.period)}`, rentRoll, 'No current leases.')}
      ${panel('Leases ending soon', expiring, 'No leases ending in the next 60 days.')}
      ${panel('Open maintenance', requests, 'No open maintenance requests.')}
    </div>`;
}

// ---------------------------------------------------------------------------
// List view
// ---------------------------------------------------------------------------

function renderList(name) {
  const ent = ENTITIES[name];
  view.dataset.entity = name;
  const rows = [...state[name]].sort(ent.sort);

  if (!rows.length) {
    view.innerHTML = `<div class="card"><div class="empty">No ${esc(ent.plural.toLowerCase())} yet. Use <strong>+ Add ${esc(ent.singular.toLowerCase())}</strong> to create one.</div></div>`;
    return;
  }

  const actionButtons = (r) =>
    [
      ...(ent.actions ?? [])
        .filter((a) => a.when(r))
        .map((a) => `<button type="button" class="btn small" data-act="${a.id}" data-id="${esc(r.id)}">${esc(a.label)}</button>`),
      `<button type="button" class="btn small" data-act="edit" data-id="${esc(r.id)}">Edit</button>`,
      `<button type="button" class="btn small danger" data-act="delete" data-id="${esc(r.id)}">Delete</button>`,
    ].join('');

  view.innerHTML = `
    <div class="card">
      <div class="table-wrap"><table>
        <thead><tr>${ent.columns.map((c) => `<th class="${c.cls ?? ''}">${esc(c.label)}</th>`).join('')}<th></th></tr></thead>
        <tbody>${rows
          .map(
            (r) =>
              `<tr>${ent.columns.map((c) => `<td class="${c.cls ?? ''}">${c.render(r)}</td>`).join('')}<td class="actions">${actionButtons(r)}</td></tr>`,
          )
          .join('')}</tbody>
      </table></div>
      <div class="empty" id="no-match" hidden>Nothing matches your search.</div>
    </div>`;
  applySearch();
}

function applySearch() {
  const q = searchEl.value.trim().toLowerCase();
  let shown = 0;
  for (const tr of view.querySelectorAll('tbody tr')) {
    const hit = !q || tr.textContent.toLowerCase().includes(q);
    tr.hidden = !hit;
    if (hit) shown++;
  }
  const none = $('#no-match');
  if (none) none.hidden = shown > 0;
}

searchEl.addEventListener('input', applySearch);

view.addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const name = view.dataset.entity;
  const ent = ENTITIES[name];
  const rec = state[name]?.find((r) => r.id === btn.dataset.id);
  if (!ent || !rec) return;

  const act = btn.dataset.act;
  try {
    if (act === 'edit') return openForm(name, rec);
    if (act === 'delete') {
      if (!confirm(`Delete this ${ent.singular.toLowerCase()}? This cannot be undone.`)) return;
      await api('DELETE', `/api/${name}/${rec.id}`);
      toast(`${ent.singular} deleted`);
    } else {
      const action = ent.actions.find((a) => a.id === act);
      if (action.confirm && !confirm(action.confirm)) return;
      await api('PUT', `/api/${name}/${rec.id}`, action.run(rec));
      toast(action.done);
    }
    await route();
  } catch (err) {
    toast(err.message, true);
  }
});

addBtn.addEventListener('click', () => {
  const ent = ENTITIES[shownName];
  const missing = ent.needs?.find((k) => !state[k].length);
  if (missing) return toast(`Add a ${ENTITIES[missing].singular.toLowerCase()} first`, true);
  openForm(shownName);
});

// ---------------------------------------------------------------------------
// Add / edit form
// ---------------------------------------------------------------------------

function optionsHtml(f, ctx, selected) {
  let options;
  if (f.options) options = f.options(ctx);
  else if (f.ref) options = [...state[f.ref]].sort(byLabel).map((r) => ({ value: r.id, label: r.label }));
  else options = f.choices.map((c) => ({ value: c, label: c }));

  const blank = f.choices ? '' : `<option value="">${f.required ? 'Select…' : '— None —'}</option>`;
  return (
    blank +
    options.map((o) => `<option value="${esc(o.value)}"${o.value === selected ? ' selected' : ''}>${esc(o.label)}</option>`).join('')
  );
}

function fieldHtml(f, value, ctx) {
  const common = `id="f_${f.key}" name="${f.key}"${f.required ? ' required' : ''}`;
  let control;
  if (f.ref || f.choices || f.options) {
    control = `<select ${common}>${optionsHtml(f, ctx, value)}</select>`;
  } else if (f.type === 'textarea') {
    control = `<textarea ${common} rows="3" maxlength="2000">${esc(value)}</textarea>`;
  } else {
    const type = f.type ?? 'text';
    let attrs = '';
    if (type === 'number') attrs = ` min="0" step="${f.step ?? 'any'}"`;
    else if (type === 'month') attrs = ' pattern="\\d{4}-\\d{2}" placeholder="YYYY-MM"';
    else attrs = ' maxlength="200"';
    control = `<input type="${type}" ${common} value="${esc(value)}"${attrs}>`;
  }
  return `<label class="field${f.wide ? ' wide' : ''}"><span>${esc(f.label)}${f.required ? ' *' : ''}</span>${control}</label>`;
}

function openForm(name, rec = null) {
  const ent = ENTITIES[name];
  const isNew = !rec;

  const values = {};
  for (const f of ent.fields) {
    values[f.key] = rec ? (rec[f.key] ?? '') : f.initial ? f.initial() : f.choices ? f.choices[0] : '';
  }
  const initialCtx = { rec: rec ?? {}, val: (k) => values[k] };

  dialog.innerHTML = `
    <form id="form">
      <h2>${isNew ? 'Add' : 'Edit'} ${esc(ent.singular.toLowerCase())}</h2>
      <div class="fields">${ent.fields.map((f) => fieldHtml(f, values[f.key], initialCtx)).join('')}</div>
      <p class="form-error" role="alert"></p>
      <div class="form-actions">
        <button type="button" class="btn" data-close>Cancel</button>
        <button type="submit" class="btn primary">Save</button>
      </div>
    </form>`;

  const form = $('#form', dialog);
  const errorEl = $('.form-error', form);
  const submitBtn = $('button[type="submit"]', form);
  $('[data-close]', form).addEventListener('click', () => dialog.close());

  // Re-filter dependent selects (e.g. units of the chosen property) and run entity-specific prefills.
  form.addEventListener('change', (e) => {
    const key = e.target.name;
    for (const f of ent.fields) {
      if (f.dependsOn !== key) continue;
      const select = form.elements.namedItem(f.key);
      const liveCtx = { rec: rec ?? {}, val: (k) => form.elements.namedItem(k)?.value ?? '' };
      select.innerHTML = optionsHtml(f, liveCtx, select.value);
    }
    ent.onChange?.(key, form, isNew);
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorEl.textContent = '';
    submitBtn.disabled = true;
    try {
      const body = Object.fromEntries(new FormData(form));
      await api(isNew ? 'POST' : 'PUT', `/api/${name}${isNew ? '' : `/${rec.id}`}`, body);
      dialog.close();
      toast(isNew ? `${ent.singular} added` : 'Changes saved');
      await route();
    } catch (err) {
      errorEl.textContent = err.message;
    } finally {
      submitBtn.disabled = false;
    }
  });

  dialog.showModal();
}

// Clicking the backdrop closes the dialog.
dialog.addEventListener('click', (e) => {
  if (e.target === dialog) dialog.close();
});

window.addEventListener('hashchange', route);
route();
