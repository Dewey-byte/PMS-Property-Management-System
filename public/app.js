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
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

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
// Icons (inline SVG, drawn with the current text colour)
// ---------------------------------------------------------------------------

const ICON_PATHS = {
  dashboard: '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
  properties: '<path d="M4 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16"/><path d="M16 9h2a2 2 0 0 1 2 2v10"/><path d="M3 21h18"/><path d="M8 7h4M8 11h4M8 15h4"/>',
  units: '<path d="M5 21V4a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v17"/><path d="M3 21h18"/><circle cx="15" cy="12" r="1"/>',
  tenants: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><circle cx="17" cy="9" r="2.5"/><path d="M17.5 14.2A5 5 0 0 1 21.5 19"/>',
  leases: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M9 13h6M9 17h6"/>',
  payments: '<rect x="2.5" y="5" width="19" height="14" rx="2.5"/><path d="M2.5 10h19"/><path d="M6.5 15h3"/>',
  maintenance: '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.2L3.5 17.3a2 2 0 0 0 2.8 2.8l5.8-5.8a4 4 0 0 0 5.2-5.4l-2.6 2.6-2.4-.6-.6-2.4z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  trash: '<path d="M3 6h18"/><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/>',
  check: '<circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.7 2.7L16 9.5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>',
  alert: '<path d="M10.3 4L2.5 18a2 2 0 0 0 1.7 3h15.6a2 2 0 0 0 1.7-3L13.7 4a2 2 0 0 0-3.4 0z"/><path d="M12 9.5v4.5M12 17.5v.01"/>',
  inbox: '<path d="M3 13l2.5-7.5A2 2 0 0 1 7.4 4h9.2a2 2 0 0 1 1.9 1.5L21 13"/><path d="M3 13v5a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5h-5.5a2.5 2.5 0 0 1-5 0H3z"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  lock: '<rect x="4.5" y="10.5" width="15" height="10" rx="2.5"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/>',
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  'eye-off': '<path d="M3 3l18 18"/><path d="M10.6 6.2A9.8 9.8 0 0 1 12 6c6.4 0 10 6 10 6a17 17 0 0 1-3.2 3.9M6.6 7.7A17 17 0 0 0 2 12s3.6 7 10 7a9.6 9.6 0 0 0 4.1-.9"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
};
const icon = (name) =>
  `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON_PATHS[name]}</svg>`;

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
  if (!res.ok) {
    // A 401 from a data endpoint means the session is gone; the sign-in endpoints report their own errors.
    if (res.status === 401 && !url.startsWith('/api/auth/')) endSession('Your session has expired. Please sign in again.');
    throw Object.assign(new Error(data?.error || `Request failed (${res.status})`), { status: res.status });
  }
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
      { label: 'Unit', cls: 'wrap', render: (r) => esc(r.unitLabel) },
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
      { label: 'Unit', cls: 'wrap', render: (r) => esc(r.unitLabel) },
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
// Shell: theme, nav, toast, sign-in state
// ---------------------------------------------------------------------------

const bootEl = $('#boot');
const authEl = $('#auth');
const shell = $('#shell');
const view = $('#view');
const titleEl = $('#title');
const subtitleEl = $('#subtitle');
const searchWrap = $('#search-wrap');
const searchEl = $('#search');
const addBtn = $('#add');
const dialog = $('#dialog');
const toastEl = $('#toast');

let currentUser = null;

for (const el of document.querySelectorAll('[data-icon]')) el.innerHTML = icon(el.dataset.icon);
$('#logout').innerHTML = icon('logout');

const NAV = [['dashboard', 'Dashboard'], ...Object.entries(ENTITIES).map(([k, e]) => [k, e.plural])];
$('#nav').innerHTML = NAV.map(([k, label]) => `<a href="#/${k}" data-nav="${k}">${icon(k)}<span>${esc(label)}</span></a>`).join('');

function syncThemeIcons() {
  const dark = document.documentElement.dataset.theme === 'dark';
  for (const b of document.querySelectorAll('.theme-toggle')) {
    b.innerHTML = icon(dark ? 'sun' : 'moon');
    b.title = dark ? 'Switch to light theme' : 'Switch to dark theme';
  }
}
document.addEventListener('click', (e) => {
  if (!e.target.closest('.theme-toggle')) return;
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try {
    localStorage.setItem('pms-theme', next);
  } catch {
    // Storage may be blocked; the choice just won't persist.
  }
  syncThemeIcons();
});
syncThemeIcons();

// A soft highlight on glass cards that follows the pointer.
document.addEventListener('pointermove', (e) => {
  const el = e.target.closest?.('.spot');
  if (!el) return;
  const r = el.getBoundingClientRect();
  el.style.setProperty('--mx', `${e.clientX - r.left}px`);
  el.style.setProperty('--my', `${e.clientY - r.top}px`);
});

let toastTimer;
function toast(message, isError = false) {
  toastEl.textContent = message;
  toastEl.className = `toast show${isError ? ' error' : ''}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 3500);
}

// ---------------------------------------------------------------------------
// Sign in / first-run setup
// ---------------------------------------------------------------------------

function showAuth(mode, notice = '') {
  const setup = mode === 'setup';
  bootEl.hidden = true;
  shell.hidden = true;
  authEl.hidden = false;
  document.title = `${setup ? 'Create account' : 'Sign in'} · PMS`;

  authEl.innerHTML = `
    <button type="button" class="icon-btn theme-toggle theme-corner" aria-label="Switch colour theme"></button>
    <div class="glass auth-card spot">
      <div class="auth-logo">
        <span class="logo">${icon('properties')}</span>
        <h1>${setup ? 'Create your account' : 'Welcome back'}</h1>
        <p>${setup ? 'Set up the first account to start managing your properties.' : 'Sign in to manage your properties.'}</p>
      </div>
      ${notice ? `<p class="notice" role="status">${esc(notice)}</p>` : ''}
      <form class="auth-form" novalidate>
        <label class="field"><span class="field-label">Username</span>
          <span class="input-wrap">${icon('user')}<input name="username" autocomplete="username" autocapitalize="none" spellcheck="false" maxlength="32" required></span>
        </label>
        <label class="field"><span class="field-label">Password</span>
          <span class="input-wrap">${icon('lock')}<input class="has-eye" type="password" name="password" autocomplete="${setup ? 'new-password' : 'current-password'}" maxlength="128" required>
            <button type="button" class="icon-btn eye" aria-label="Show password">${icon('eye')}</button></span>
        </label>
        ${
          setup
            ? `<label class="field"><span class="field-label">Confirm password</span>
          <span class="input-wrap">${icon('lock')}<input type="password" name="confirm" autocomplete="new-password" maxlength="128" required></span></label>`
            : ''
        }
        <p class="form-error" role="alert"></p>
        <button type="submit" class="btn primary block"><span>${setup ? 'Create account' : 'Sign in'}</span><span class="spinner" aria-hidden="true"></span></button>
      </form>
      ${setup ? '<p class="auth-hint">Use at least 8 characters. This account is the one you will sign in with from now on.</p>' : ''}
    </div>`;
  syncThemeIcons();

  const card = $('.auth-card', authEl);
  const form = $('form', authEl);
  const errorEl = $('.form-error', form);
  const submitBtn = $('button[type="submit"]', form);
  const field = (name) => form.elements.namedItem(name);

  const fail = (message) => {
    errorEl.textContent = message;
    card.classList.remove('shake');
    void card.offsetWidth; // restart the animation if it already ran
    card.classList.add('shake');
  };

  const eye = $('.eye', form);
  eye.addEventListener('click', () => {
    const show = field('password').type === 'password';
    field('password').type = show ? 'text' : 'password';
    eye.innerHTML = icon(show ? 'eye-off' : 'eye');
    eye.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorEl.textContent = '';
    const username = field('username').value.trim();
    const password = field('password').value;
    if (!username || !password) return fail('Enter your username and password.');
    if (setup && password.length < 8) return fail('Use at least 8 characters for the password.');
    if (setup && password !== field('confirm').value) return fail('The passwords do not match.');

    form.classList.add('is-busy');
    submitBtn.disabled = true;
    try {
      const { user } = await api('POST', setup ? '/api/auth/setup' : '/api/auth/login', { username, password });
      await enterApp(user);
    } catch (err) {
      fail(err.message);
      if (!setup) {
        field('password').value = '';
        field('password').focus();
      }
    } finally {
      form.classList.remove('is-busy');
      submitBtn.disabled = false;
    }
  });

  field('username').focus();
}

async function enterApp(user) {
  currentUser = user;
  for (const key of Object.keys(state)) state[key] = [];
  bootEl.hidden = true;
  authEl.hidden = true;
  authEl.innerHTML = '';
  shell.hidden = false;
  $('#username').textContent = user.username;
  $('#avatar').textContent = user.username.charAt(0).toUpperCase();
  shownName = null;
  if (!location.hash) history.replaceState(null, '', '#/dashboard');
  await route();
}

function endSession(notice = '') {
  if (!currentUser) return;
  currentUser = null;
  if (dialog.open) dialog.close();
  showAuth('login', notice);
}

$('#logout').addEventListener('click', async () => {
  try {
    await api('POST', '/api/auth/logout');
  } catch {
    // Even if the request fails, drop the local session view.
  }
  endSession('You have been signed out.');
});

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

let shownName = null;
let routeSeq = 0;

const greeting = () => {
  const h = new Date().getHours();
  return h < 5 ? 'Working late' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
};

const skeleton = () => `
  <div class="stats">${'<div class="glass stat"><div class="sk sk-line big"></div></div>'.repeat(3)}</div>
  <div class="glass card">${'<div class="sk sk-row"></div>'.repeat(5)}</div>`;

async function route() {
  if (!currentUser) return;
  const name = location.hash.replace(/^#\//, '') || 'dashboard';
  if (name !== 'dashboard' && !ENTITIES[name]) {
    location.hash = '#/dashboard';
    return;
  }
  const seq = ++routeSeq;
  const fresh = name !== shownName;
  if (fresh) {
    searchEl.value = '';
    shownName = name;
    view.innerHTML = skeleton();
    view.classList.add('no-anim');
  }
  for (const a of document.querySelectorAll('#nav a')) {
    if (a.dataset.nav === name) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }

  const isList = name !== 'dashboard';
  titleEl.textContent = isList ? ENTITIES[name].plural : `${greeting()}, ${currentUser.username}`;
  subtitleEl.textContent = isList
    ? ''
    : new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  searchWrap.hidden = addBtn.hidden = !isList;
  if (isList) addBtn.innerHTML = `${icon('plus')}<span>Add ${esc(ENTITIES[name].singular.toLowerCase())}</span>`;
  document.title = `${isList ? ENTITIES[name].plural : 'Dashboard'} · PMS`;

  try {
    if (isList) {
      await loadAll();
      if (seq === routeSeq) renderList(name, fresh);
    } else {
      const data = await api('GET', '/api/dashboard');
      if (seq === routeSeq) renderDashboard(data, fresh);
    }
  } catch (err) {
    if (err.status === 401) return; // the sign-in screen is already showing
    if (seq === routeSeq) view.innerHTML = `<div class="glass card"><div class="empty">${icon('alert')}<p>Could not load data: ${esc(err.message)}</p></div></div>`;
  }
}

// ---------------------------------------------------------------------------
// Entrance animation helpers
// ---------------------------------------------------------------------------

const RING_C = 2 * Math.PI * 26;
const FORMAT = {
  money: (n) => money.format(n),
  int: (n) => String(Math.round(n)),
  pct: (n) => `${Math.round(n)}%`,
};

function afterRender(fresh) {
  view.classList.toggle('no-anim', !fresh);

  if (fresh) {
    view.querySelectorAll('.rise').forEach((el, i) => (el.style.animationDelay = `${Math.min(i, 9) * 60}ms`));
    [...view.querySelectorAll('tbody tr')].slice(0, 16).forEach((tr, i) => (tr.style.animationDelay = `${120 + i * 28}ms`));
  }

  // Bars and the ring grow from empty to their value.
  const grow = () => {
    for (const el of view.querySelectorAll('[data-pct]')) {
      const pct = Number(el.dataset.pct);
      if (el.classList.contains('ring-bar')) el.style.strokeDashoffset = RING_C * (1 - pct / 100);
      else el.style.width = `${pct}%`;
    }
  };
  if (fresh) requestAnimationFrame(() => requestAnimationFrame(grow));
  else grow();

  // Numbers count up from zero.
  if (!fresh || reducedMotion()) return;
  for (const el of view.querySelectorAll('[data-count]')) {
    const target = Number(el.dataset.count);
    const format = FORMAT[el.dataset.fmt];
    const start = performance.now();
    const tick = (now) => {
      const p = Math.min(1, (now - start) / 1000);
      el.textContent = format(target * (1 - (1 - p) ** 3));
      if (p < 1 && el.isConnected) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

function renderDashboard(d, fresh) {
  view.dataset.entity = '';
  if (!d.totalProperties) {
    view.innerHTML = `
      <div class="glass welcome rise">
        <h2>Welcome to PMS</h2>
        <p class="sub">Get set up in a few steps:</p>
        <ol>
          <li><a href="#/properties">Add a property</a></li>
          <li><a href="#/units">Add its units</a> with their monthly rent</li>
          <li><a href="#/tenants">Add your tenants</a></li>
          <li><a href="#/leases">Create a lease</a> linking a tenant to a unit</li>
          <li><a href="#/payments">Record rent payments</a> as they arrive</li>
        </ol>
      </div>`;
    afterRender(fresh);
    return;
  }

  const counter = (value, fmt) => `data-count="${value}" data-fmt="${fmt}"`;
  const stat = (label, value, fmt, sub, iconName, tone) => `
    <div class="glass stat spot rise">
      <div class="stat-icon tone-${tone}">${icon(iconName)}</div>
      <div class="stat-body">
        <div class="stat-label">${esc(label)}</div>
        <div class="stat-value" ${counter(value, fmt)}>${FORMAT[fmt](value)}</div>
        <div class="stat-sub">${esc(sub)}</div>
      </div>
    </div>`;

  const occupancy = `
    <div class="glass stat spot rise">
      <div class="ring-wrap">
        <svg class="ring" viewBox="0 0 64 64" aria-hidden="true">
          <defs><linearGradient id="ringGrad" x1="0" y1="0" x2="1" y2="1"><stop class="rs1" offset="0"/><stop class="rs2" offset="1"/></linearGradient></defs>
          <circle class="ring-track" cx="32" cy="32" r="26"/>
          <circle class="ring-bar" cx="32" cy="32" r="26" stroke-dasharray="${RING_C}" stroke-dashoffset="${RING_C}" data-pct="${d.occupancyRate}"/>
        </svg>
        <span class="ring-text" ${counter(d.occupancyRate, 'pct')}>${d.occupancyRate}%</span>
      </div>
      <div class="stat-body">
        <div class="stat-label">Occupancy</div>
        <div class="stat-value" ${counter(d.occupiedUnits, 'int')}>${d.occupiedUnits}</div>
        <div class="stat-sub">of ${d.totalUnits} units occupied</div>
      </div>
    </div>`;

  const panel = (title, iconName, table, emptyText, wide = false) => `
    <section class="glass card rise${wide ? ' wide' : ''}">
      <div class="panel-head">${icon(iconName)}<h2>${esc(title)}</h2></div>
      ${table ? `<div class="table-wrap">${table}</div>` : `<div class="empty">${icon('inbox')}<p>${esc(emptyText)}</p></div>`}
    </section>`;

  const table = (heads, rows) =>
    `<table><thead><tr>${heads.map(([h, cls]) => `<th class="${cls ?? ''}">${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table>`;

  const expected = d.rentRoll.reduce((sum, r) => sum + r.rent, 0);
  const received = d.rentRoll.reduce((sum, r) => sum + Math.min(r.paid, r.rent), 0);
  const collectedPct = expected ? Math.round((received / expected) * 100) : 0;
  const hero = d.rentRoll.length
    ? `<section class="glass hero spot rise">
        <div class="hero-head">
          <div><h2>Rent collection · ${esc(fmtMonth(d.period))}</h2><p class="sub">${esc(money.format(received))} of ${esc(money.format(expected))} received from current leases</p></div>
          <div class="hero-pct" ${counter(collectedPct, 'pct')}>${collectedPct}%</div>
        </div>
        <div class="bar"><span class="bar-fill" data-pct="${collectedPct}"></span></div>
      </section>`
    : '';

  const rentRoll = d.rentRoll.length
    ? table(
        [['Tenant'], ['Unit'], ['Rent', 'num'], ['Paid', 'num'], ['Balance', 'num'], ['Status']],
        d.rentRoll
          .map((r) => {
            const pct = r.rent ? Math.min(100, Math.round((r.paid / r.rent) * 100)) : 100;
            return `<tr><td><strong>${esc(r.tenantName)}</strong></td><td>${esc(r.unitLabel)}</td>
              <td class="num">${money.format(r.rent)}</td>
              <td class="num">${money.format(r.paid)}<div class="meter"><span data-pct="${pct}"></span></div></td>
              <td class="num">${money.format(r.balance)}</td><td>${badge(r.status)}</td></tr>`;
          })
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
      ${occupancy}
      ${stat('Monthly rent roll', d.monthlyRent, 'money', 'From current leases', 'payments', 'violet')}
      ${stat(`Collected · ${fmtMonth(d.period)}`, d.collected, 'money', 'Payments for this month', 'check', 'fresh')}
      ${stat('Outstanding', d.outstanding, 'money', 'Still due this month', 'clock', 'rose')}
      ${stat('Open requests', d.openMaintenance, 'int', `${d.urgentMaintenance} urgent`, 'maintenance', 'warm')}
      ${stat('Properties', d.totalProperties, 'int', `${d.totalUnits} units in total`, 'properties', 'cool')}
    </div>
    ${hero}
    <div class="panels">
      ${panel(`Rent · ${fmtMonth(d.period)}`, 'payments', rentRoll, 'No current leases.', true)}
      ${panel('Leases ending soon', 'leases', expiring, 'No leases ending in the next 60 days.')}
      ${panel('Open maintenance', 'maintenance', requests, 'No open maintenance requests.')}
    </div>`;
  afterRender(fresh);
}

// ---------------------------------------------------------------------------
// List view
// ---------------------------------------------------------------------------

function renderList(name, fresh) {
  const ent = ENTITIES[name];
  view.dataset.entity = name;
  const rows = [...state[name]].sort(ent.sort);
  subtitleEl.textContent = `${rows.length} ${(rows.length === 1 ? ent.singular : ent.plural).toLowerCase()}`;

  if (!rows.length) {
    view.innerHTML = `<div class="glass card rise"><div class="empty">${icon('inbox')}<p>No ${esc(ent.plural.toLowerCase())} yet. Use <strong>Add ${esc(ent.singular.toLowerCase())}</strong> to create one.</p></div></div>`;
    afterRender(fresh);
    return;
  }

  const actionButtons = (r) =>
    [
      ...(ent.actions ?? [])
        .filter((a) => a.when(r))
        .map((a) => `<button type="button" class="btn small accent" data-act="${a.id}" data-id="${esc(r.id)}">${esc(a.label)}</button>`),
      `<button type="button" class="icon-btn" data-act="edit" data-id="${esc(r.id)}" aria-label="Edit ${esc(ent.singular.toLowerCase())}" title="Edit">${icon('edit')}</button>`,
      `<button type="button" class="icon-btn danger" data-act="delete" data-id="${esc(r.id)}" aria-label="Delete ${esc(ent.singular.toLowerCase())}" title="Delete">${icon('trash')}</button>`,
    ].join('');

  view.innerHTML = `
    <div class="glass card list-card rise">
      <div class="table-wrap"><table>
        <thead><tr>${ent.columns.map((c) => `<th class="${c.cls ?? ''}">${esc(c.label)}</th>`).join('')}<th></th></tr></thead>
        <tbody>${rows
          .map(
            (r) =>
              `<tr>${ent.columns.map((c) => `<td class="${c.cls ?? ''}">${c.render(r)}</td>`).join('')}<td class="actions"><div class="row-actions">${actionButtons(r)}</div></td></tr>`,
          )
          .join('')}</tbody>
      </table></div>
      <div class="empty" id="no-match" hidden>${icon('search')}<p>Nothing matches your search.</p></div>
    </div>`;
  afterRender(fresh);
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
    if (err.status !== 401) toast(err.message, true);
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
  return `<label class="field${f.wide ? ' wide' : ''}"><span class="field-label">${esc(f.label)}${f.required ? ' *' : ''}</span>${control}</label>`;
}

let closeTimer;
function closeDialog() {
  if (!dialog.open || dialog.classList.contains('closing')) return;
  dialog.classList.add('closing');
  closeTimer = setTimeout(() => {
    dialog.close();
    dialog.classList.remove('closing');
  }, 200);
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
        <button type="submit" class="btn primary"><span>Save</span><span class="spinner" aria-hidden="true"></span></button>
      </div>
    </form>`;

  const form = $('#form', dialog);
  const errorEl = $('.form-error', form);
  const submitBtn = $('button[type="submit"]', form);
  $('[data-close]', form).addEventListener('click', closeDialog);

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
    form.classList.add('is-busy');
    submitBtn.disabled = true;
    try {
      const body = Object.fromEntries(new FormData(form));
      await api(isNew ? 'POST' : 'PUT', `/api/${name}${isNew ? '' : `/${rec.id}`}`, body);
      closeDialog();
      toast(isNew ? `${ent.singular} added` : 'Changes saved');
      await route();
    } catch (err) {
      if (err.status !== 401) errorEl.textContent = err.message;
    } finally {
      form.classList.remove('is-busy');
      submitBtn.disabled = false;
    }
  });

  clearTimeout(closeTimer);
  dialog.classList.remove('closing');
  if (!dialog.open) dialog.showModal();
}

// Escape and backdrop clicks close the dialog with its exit animation.
dialog.addEventListener('cancel', (e) => {
  e.preventDefault();
  closeDialog();
});
dialog.addEventListener('click', (e) => {
  if (e.target === dialog) closeDialog();
});

window.addEventListener('hashchange', route);

// ---------------------------------------------------------------------------
// Start: ask the server whether anyone is signed in, or whether this is a fresh install.
// ---------------------------------------------------------------------------

(async function boot() {
  try {
    const status = await api('GET', '/api/auth/status');
    if (status.user) await enterApp(status.user);
    else showAuth(status.setupRequired ? 'setup' : 'login');
  } catch (err) {
    bootEl.innerHTML = `<div class="glass empty">${icon('alert')}<p>Cannot reach the server. ${esc(err.message)}</p></div>`;
  }
})();
