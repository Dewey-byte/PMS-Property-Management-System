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
// Dates are plain YYYY-MM-DD strings; whole-day arithmetic is done in UTC so daylight saving can't shift it.
const addDays = (s, n) => {
  const d = new Date(`${s}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
const local = (s) => new Date(`${s}T00:00:00`);
const fmtDate = (s) => (s ? local(s).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '');
const fmtShort = (s) => (s ? local(s).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '');
const fmtWeekday = (s) => local(s).toLocaleDateString(undefined, { weekday: 'short' });
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const byLabel = (a, b) => a.label.localeCompare(b.label, undefined, { numeric: true });
const byNumber = (a, b) => String(a.number).localeCompare(String(b.number), undefined, { numeric: true });
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

const BADGE_COLOR = {
  Confirmed: 'blue', 'Checked in': 'green', 'Checked out': 'gray', Cancelled: 'red',
  Occupied: 'green', Reserved: 'amber', Vacant: 'gray', 'Out of service': 'red',
  Paid: 'green', Active: 'green',
};
const badge = (text) => `<span class="badge ${BADGE_COLOR[text] ?? 'gray'}">${esc(text)}</span>`;
const STATUS_TOAST = {
  'Checked in': 'Guest checked in',
  'Checked out': 'Guest checked out',
  Cancelled: 'Booking cancelled',
  Confirmed: 'Booking reinstated',
};

// ---------------------------------------------------------------------------
// Icons (inline SVG, drawn with the current text colour)
// ---------------------------------------------------------------------------

const ICON_PATHS = {
  dashboard: '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
  calendar: '<rect x="3" y="4.5" width="18" height="16" rx="2.5"/><path d="M3 9.5h18M8 3v3M16 3v3"/>',
  bookings: '<rect x="5" y="4" width="14" height="17" rx="2.5"/><path d="M9 4V3h6v1"/><path d="M9 13l2 2 4-4"/>',
  rooms: '<path d="M3 19V6"/><path d="M3 15h18v4"/><path d="M21 15v-3a3 3 0 0 0-3-3h-8v6"/><circle cx="6.5" cy="11" r="1.7"/>',
  guests: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><circle cx="17" cy="9" r="2.5"/><path d="M17.5 14.2A5 5 0 0 1 21.5 19"/>',
  payments: '<rect x="2.5" y="5" width="19" height="14" rx="2.5"/><path d="M2.5 10h19"/><path d="M6.5 15h3"/>',
  arrive: '<path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><path d="M10 17l5-5-5-5"/><path d="M15 12H3"/>',
  depart: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  left: '<path d="M15 6l-6 6 6 6"/>',
  right: '<path d="M9 6l6 6-6 6"/>',
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
  // The browser knows the hotel's local date; the server may be running in another time zone.
  if (method === 'GET' && url.startsWith('/api/') && !url.startsWith('/api/auth/')) {
    url += `${url.includes('?') ? '&' : '?'}today=${today()}`;
  }
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

const state = { rooms: [], guests: [], bookings: [], payments: [] };

async function loadAll() {
  const keys = Object.keys(state);
  const lists = await Promise.all(keys.map((k) => api('GET', `/api/${k}`)));
  keys.forEach((k, i) => (state[k] = lists[i]));
}

// ---------------------------------------------------------------------------
// The booking form: rooms offered depend on the dates and party size, and the guest can be created on the spot.
// ---------------------------------------------------------------------------

let availabilitySeq = 0;

function stayHint(form, text, tone = '') {
  const hint = $('[data-info="availability"] .hint', form);
  hint.textContent = text;
  hint.className = `hint ${tone}`.trim();
}

function updateSummary(form) {
  const el = $('[data-info="summary"] .hint', form);
  const get = (k) => form.elements.namedItem(k).value;
  const nights = get('checkIn') && get('checkOut') ? daysBetween(get('checkIn'), get('checkOut')) : 0;
  const rate = Number(get('nightlyRate'));
  if (nights < 1 || !get('nightlyRate') || Number.isNaN(rate)) {
    el.textContent = '';
    el.className = 'hint';
    return;
  }
  el.innerHTML = `<strong>${esc(plural(nights, 'night'))}</strong> × ${esc(money.format(rate))} = <strong>${esc(money.format(nights * rate))}</strong>`;
  el.className = 'hint total';
}

// When a room is chosen its rate is filled in, unless the receptionist typed a different one.
function applyRoomRate(form) {
  const roomId = form.elements.namedItem('roomId').value;
  const room = form._rooms?.find((r) => r.id === roomId) ?? state.rooms.find((r) => r.id === roomId);
  const input = form.elements.namedItem('nightlyRate');
  if (room && (input.value === '' || input.value === form.dataset.autoRate)) {
    input.value = room.rate;
    form.dataset.autoRate = String(room.rate);
  }
}

async function refreshAvailability(form) {
  const get = (k) => form.elements.namedItem(k).value;
  const select = form.elements.namedItem('roomId');
  const checkIn = get('checkIn');
  const checkOut = get('checkOut');
  if (!checkIn || !checkOut || checkOut <= checkIn) {
    select.innerHTML = '<option value="">Select a room…</option>';
    stayHint(form, 'Choose a check-out date after check-in.', 'warn');
    return;
  }
  const guests = Math.max(1, (Number(get('adults')) || 0) + (Number(get('children')) || 0));
  const query = new URLSearchParams({ checkIn, checkOut, guests: String(guests) });
  if (form._rec?.id) query.set('exclude', form._rec.id);

  const seq = ++availabilitySeq;
  stayHint(form, 'Checking availability…');
  try {
    const { rooms, nights } = await api('GET', `/api/availability?${query}`);
    if (seq !== availabilitySeq || !form.isConnected) return; // a newer search replaced this one
    form._rooms = rooms;
    const want = select.value || form.dataset.wantRoom;
    select.innerHTML =
      '<option value="">Select a room…</option>' +
      rooms
        .map((r) => `<option value="${esc(r.id)}">${esc(`Room ${r.number} · ${r.type} · sleeps ${r.capacity} · ${money.format(r.rate)}/night`)}</option>`)
        .join('');
    select.value = rooms.some((r) => r.id === want) ? want : '';
    stayHint(
      form,
      rooms.length ? `${plural(rooms.length, 'room')} available for ${plural(nights, 'night')}.` : 'No rooms are free for these dates and party size.',
      rooms.length ? 'ok' : 'warn',
    );
    applyRoomRate(form);
    updateSummary(form);
  } catch (err) {
    if (seq === availabilitySeq) stayHint(form, err.message, 'warn');
  }
}

function syncNewGuest(form) {
  const adding = form.elements.namedItem('guestId').value === '__new__';
  for (const el of form.querySelectorAll('[data-group="newguest"]')) el.hidden = !adding;
  form.elements.namedItem('newGuestName').required = adding;
}

// ---------------------------------------------------------------------------
// Entity definitions: each drives its list and its add/edit form.
//   fields: { key, label, type, required, wide, step, min, choices | ref | options(ctx), noBlank, initial, hidden, group }
//   columns: { label, cls, render(row) -> HTML }
//   actions: { id, label | icon+title, when(row), status | open(row), confirm, danger }
// ---------------------------------------------------------------------------

const BOOKING_ORDER = { 'Checked in': 0, Confirmed: 1, 'Checked out': 2, Cancelled: 3 };

const ENTITIES = {
  bookings: {
    singular: 'Booking',
    plural: 'Bookings',
    addLabel: 'New booking',
    saveLabel: 'Save booking',
    needs: ['rooms'],
    fields: [
      { key: 'checkIn', label: 'Check-in', type: 'date', required: true, initial: today },
      { key: 'checkOut', label: 'Check-out', type: 'date', required: true, initial: () => addDays(today(), 1) },
      { key: 'adults', label: 'Adults', type: 'number', step: '1', min: 1, required: true, initial: () => 2 },
      { key: 'children', label: 'Children', type: 'number', step: '1', min: 0, initial: () => 0 },
      { key: 'availability', type: 'info' },
      {
        key: 'roomId',
        label: 'Room',
        required: true,
        wide: true,
        // Only the current choice is known up front; the full list arrives from the availability search.
        options: ({ rec, preset }) => {
          const id = rec.roomId ?? preset?.roomId;
          const room = state.rooms.find((r) => r.id === id);
          return room ? [{ value: room.id, label: `Room ${room.number}` }] : [];
        },
      },
      {
        key: 'guestId',
        label: 'Guest',
        required: true,
        wide: true,
        initial: () => (state.guests.length ? '' : '__new__'),
        options: ({ rec }) => [
          ...(rec.id ? [] : [{ value: '__new__', label: '＋ New guest…' }]),
          ...[...state.guests].sort(byLabel).map((g) => ({ value: g.id, label: g.name })),
        ],
      },
      { key: 'newGuestName', label: 'Guest name', wide: true, group: 'newguest', hidden: true },
      { key: 'newGuestEmail', label: 'Email', type: 'email', group: 'newguest', hidden: true },
      { key: 'newGuestPhone', label: 'Phone', type: 'tel', group: 'newguest', hidden: true },
      { key: 'nightlyRate', label: 'Rate per night', type: 'number', step: '0.01' },
      {
        key: 'status',
        label: 'Status',
        noBlank: true,
        initial: () => 'Confirmed',
        options: ({ rec }) =>
          (rec.id ? ['Confirmed', 'Checked in', 'Checked out', 'Cancelled'] : ['Confirmed', 'Checked in']).map((s) => ({ value: s, label: s })),
      },
      { key: 'summary', type: 'info' },
      { key: 'notes', label: 'Notes', type: 'textarea', wide: true },
    ],
    columns: [
      {
        label: 'Guest',
        render: (r) =>
          `<strong>${esc(r.guestName)}</strong><div class="sub">${esc(`${plural(r.adults, 'adult')}${r.children ? ` · ${r.children} ${r.children === 1 ? 'child' : 'children'}` : ''}`)}</div>`,
      },
      { label: 'Room', render: (r) => `${esc(r.roomNumber)}<div class="sub">${esc(r.roomType)}</div>` },
      { label: 'Stay', render: (r) => `${esc(fmtShort(r.checkIn))} → ${esc(fmtShort(r.checkOut))}<div class="sub">${esc(plural(r.nights, 'night'))}</div>` },
      { label: 'Total', cls: 'num', render: (r) => money.format(r.total) },
      {
        label: 'Balance',
        cls: 'num',
        render: (r) => (r.status === 'Cancelled' ? '<span class="sub">—</span>' : r.balance > 0 ? `<span class="due">${money.format(r.balance)}</span>` : badge('Paid')),
      },
      { label: 'Status', render: (r) => badge(r.status) },
    ],
    sort: (a, b) =>
      BOOKING_ORDER[a.status] - BOOKING_ORDER[b.status] ||
      (BOOKING_ORDER[a.status] < 2 ? a.checkIn.localeCompare(b.checkIn) : b.checkIn.localeCompare(a.checkIn)),
    filters: [
      { id: 'all', label: 'All', test: () => true },
      { id: 'upcoming', label: 'Upcoming', test: (r) => r.status === 'Confirmed' },
      { id: 'inhouse', label: 'In house', test: (r) => r.status === 'Checked in' },
      { id: 'past', label: 'Past', test: (r) => r.status === 'Checked out' },
      { id: 'cancelled', label: 'Cancelled', test: (r) => r.status === 'Cancelled' },
    ],
    actions: [
      { id: 'checkin', label: 'Check in', status: 'Checked in', when: (r) => r.status === 'Confirmed' },
      { id: 'checkout', label: 'Check out', status: 'Checked out', when: (r) => r.status === 'Checked in' },
      { id: 'reinstate', label: 'Reinstate', status: 'Confirmed', when: (r) => r.status === 'Cancelled' },
      {
        id: 'pay',
        icon: 'payments',
        title: 'Record a payment',
        when: (r) => r.status !== 'Cancelled' && r.balance > 0,
        open: (r) => openForm('payments', null, { bookingId: r.id, amount: r.balance }),
      },
      {
        id: 'cancel',
        icon: 'close',
        title: 'Cancel booking',
        danger: true,
        status: 'Cancelled',
        confirm: 'Cancel this booking? The room becomes available again.',
        when: (r) => r.status === 'Confirmed',
      },
    ],
    afterOpen(form, rec, isNew, preset) {
      form._rec = rec;
      form.dataset.wantRoom = rec?.roomId ?? preset.roomId ?? '';
      form.dataset.autoRate = rec ? String(state.rooms.find((r) => r.id === rec.roomId)?.rate ?? '') : '';
      form.addEventListener('input', (e) => {
        if (e.target.name === 'nightlyRate') updateSummary(form);
      });
      syncNewGuest(form);
      updateSummary(form);
      refreshAvailability(form);
    },
    onChange(key, form) {
      const get = (k) => form.elements.namedItem(k).value;
      if (key === 'checkIn' && get('checkIn') && get('checkOut') <= get('checkIn')) {
        form.elements.namedItem('checkOut').value = addDays(get('checkIn'), 1);
      }
      if (['checkIn', 'checkOut', 'adults', 'children'].includes(key)) refreshAvailability(form);
      if (key === 'roomId') {
        form.dataset.wantRoom = get('roomId');
        applyRoomRate(form);
        updateSummary(form);
      }
      if (key === 'guestId') syncNewGuest(form);
      if (key === 'nightlyRate') updateSummary(form);
    },
    toBody(body) {
      const { newGuestName, newGuestEmail, newGuestPhone, ...rest } = body;
      if (rest.guestId === '__new__') {
        delete rest.guestId;
        rest.newGuest = { name: newGuestName, email: newGuestEmail, phone: newGuestPhone };
      }
      return rest;
    },
  },

  rooms: {
    singular: 'Room',
    plural: 'Rooms',
    addLabel: 'Add room',
    view: 'cards',
    fields: [
      { key: 'number', label: 'Room number', required: true },
      { key: 'type', label: 'Type', choices: ['Standard', 'Twin', 'Deluxe', 'Family', 'Suite'] },
      { key: 'capacity', label: 'Sleeps (guests)', type: 'number', step: '1', min: 1, required: true, initial: () => 2 },
      { key: 'rate', label: 'Rate per night', type: 'number', step: '0.01', required: true },
      { key: 'status', label: 'Availability', choices: ['Active', 'Out of service'] },
      { key: 'description', label: 'Description', type: 'textarea', wide: true },
    ],
    sort: byNumber,
    actions: [
      {
        id: 'book',
        label: 'Book',
        when: (r) => r.status === 'Active',
        open: (r) => openForm('bookings', null, { roomId: r.id, checkIn: today(), checkOut: addDays(today(), 1) }),
      },
    ],
  },

  guests: {
    singular: 'Guest',
    plural: 'Guests',
    addLabel: 'Add guest',
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
      { label: 'Stays', cls: 'num', render: (r) => r.stays },
      { label: 'Next arrival', render: (r) => (r.nextArrival ? esc(fmtDate(r.nextArrival)) : '<span class="sub">—</span>') },
      { label: 'Last visit', render: (r) => (r.lastVisit ? esc(fmtDate(r.lastVisit)) : '<span class="sub">—</span>') },
    ],
    sort: byLabel,
    actions: [
      {
        id: 'book',
        icon: 'bookings',
        title: 'New booking for this guest',
        when: () => true,
        open: (r) => openForm('bookings', null, { guestId: r.id }),
      },
    ],
  },

  payments: {
    singular: 'Payment',
    plural: 'Payments',
    addLabel: 'Record payment',
    needs: ['bookings'],
    fields: [
      {
        key: 'bookingId',
        label: 'Booking',
        required: true,
        wide: true,
        options: ({ rec }) =>
          state.bookings
            .filter((b) => b.status !== 'Cancelled' || b.id === rec.bookingId)
            .sort((a, b) => b.checkIn.localeCompare(a.checkIn))
            .map((b) => ({
              value: b.id,
              label: `${b.guestName} · Room ${b.roomNumber} · ${fmtShort(b.checkIn)}–${fmtShort(b.checkOut)} · ${money.format(b.balance)} due`,
            })),
      },
      { key: 'date', label: 'Date received', type: 'date', required: true, initial: today },
      { key: 'amount', label: 'Amount', type: 'number', step: '0.01', required: true },
      { key: 'method', label: 'Method', choices: ['Card', 'Cash', 'Bank transfer', 'Online', 'Other'] },
      { key: 'note', label: 'Note', wide: true },
    ],
    columns: [
      { label: 'Date', render: (r) => esc(fmtDate(r.date)) },
      { label: 'Guest', render: (r) => `<strong>${esc(r.guestName)}</strong>` },
      { label: 'Room', render: (r) => esc(r.roomNumber) },
      { label: 'Stay', render: (r) => esc(r.stay.replace(/\d{4}-\d{2}-\d{2}/g, (d) => fmtShort(d))) },
      { label: 'Amount', cls: 'num', render: (r) => money.format(r.amount) },
      { label: 'Method', render: (r) => esc(r.method) },
      { label: 'Note', render: (r) => esc(r.note) },
    ],
    sort: (a, b) => b.date.localeCompare(a.date),
    onChange(key, form, isNew) {
      if (key !== 'bookingId' || !isNew) return;
      const booking = state.bookings.find((b) => b.id === form.elements.namedItem('bookingId').value);
      if (booking && booking.balance > 0) form.elements.namedItem('amount').value = booking.balance;
    },
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

const NAV = [
  ['dashboard', 'Dashboard'],
  ['calendar', 'Calendar'],
  ['bookings', 'Bookings'],
  ['rooms', 'Rooms'],
  ['guests', 'Guests'],
  ['payments', 'Payments'],
];
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
  document.title = `${setup ? 'Create account' : 'Sign in'} · Hotel PMS`;

  authEl.innerHTML = `
    <button type="button" class="icon-btn theme-toggle theme-corner" aria-label="Switch colour theme"></button>
    <div class="glass auth-card spot">
      <div class="auth-logo">
        <span class="logo">${icon('rooms')}</span>
        <h1>${setup ? 'Create your account' : 'Welcome back'}</h1>
        <p>${setup ? 'Set up the first account to start taking bookings.' : 'Sign in to manage your hotel.'}</p>
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
  calendarStart = null;
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
let calendarStart = null;
const filterState = {};

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
  const ent = ENTITIES[name];
  if (name !== 'dashboard' && name !== 'calendar' && !ent) {
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

  const pageTitle = ent ? ent.plural : name === 'calendar' ? 'Calendar' : 'Dashboard';
  titleEl.textContent = name === 'dashboard' ? `${greeting()}, ${currentUser.username}` : pageTitle;
  subtitleEl.textContent =
    name === 'dashboard'
      ? new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
      : name === 'calendar'
        ? 'Click an empty night to start a booking.'
        : '';
  searchWrap.hidden = !ent;
  addBtn.hidden = false;
  addBtn.innerHTML = `${icon('plus')}<span>${esc(ent ? ent.addLabel : 'New booking')}</span>`;
  document.title = `${pageTitle} · Hotel PMS`;

  try {
    if (ent) {
      await loadAll();
      if (seq === routeSeq) renderList(name, fresh);
    } else if (name === 'calendar') {
      await loadAll();
      if (seq === routeSeq) renderCalendar(fresh);
    } else {
      const [data] = await Promise.all([api('GET', '/api/dashboard'), loadAll()]);
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
    [...view.querySelectorAll('tbody tr, .room-card')].slice(0, 16).forEach((el, i) => (el.style.animationDelay = `${120 + i * 28}ms`));
  }

  // Bars, columns and the ring grow from empty to their value.
  const grow = () => {
    for (const el of view.querySelectorAll('[data-pct]')) {
      const pct = Number(el.dataset.pct);
      if (el.classList.contains('ring-bar')) el.style.strokeDashoffset = RING_C * (1 - pct / 100);
      else if (el.classList.contains('fc-fill')) el.style.height = `${pct}%`;
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
  if (!d.totalRooms) {
    view.innerHTML = `
      <div class="glass welcome rise">
        <h2>Welcome to Hotel PMS</h2>
        <p class="sub">Get set up in a few steps:</p>
        <ol>
          <li><a href="#/rooms">Add your rooms</a> with their type, capacity and nightly rate</li>
          <li>Use <strong>New booking</strong> to pick dates, choose an available room and add the guest</li>
          <li>Check guests in and out from the dashboard or the <a href="#/bookings">bookings list</a></li>
          <li>Record payments as guests settle up</li>
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
        <div class="stat-label">Occupancy tonight</div>
        <div class="stat-value" ${counter(d.occupiedTonight, 'int')}>${d.occupiedTonight}</div>
        <div class="stat-sub">of ${plural(d.activeRooms, 'room')}${d.outOfService ? ` · ${d.outOfService} out of service` : ''}</div>
      </div>
    </div>`;

  const toCheckIn = d.arrivals.filter((b) => b.status === 'Confirmed').length;
  const toCheckOut = d.departures.filter((b) => b.status === 'Checked in').length;
  const average = Math.round(d.forecast.reduce((sum, f) => sum + f.rate, 0) / d.forecast.length);

  const forecast = `
    <section class="glass hero spot rise">
      <div class="hero-head">
        <div><h2>Next 7 nights</h2><p class="sub">Share of rooms booked each night</p></div>
        <div class="hero-pct" ${counter(average, 'pct')}>${average}%</div>
      </div>
      <div class="forecast">
        ${d.forecast
          .map(
            (f, i) => `
          <div class="fc-col">
            <span class="fc-val">${f.rate}%</span>
            <div class="fc-track"><span class="fc-fill${i === 0 ? ' tonight' : ''}" data-pct="${f.rate}"></span></div>
            <span class="fc-day">${i === 0 ? 'Tonight' : esc(fmtWeekday(f.date))}</span>
            <span class="fc-date">${esc(fmtShort(f.date))}</span>
          </div>`,
          )
          .join('')}
      </div>
    </section>`;

  const table = (heads, rows) =>
    `<table><thead><tr>${heads.map(([h, cls]) => `<th class="${cls ?? ''}">${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table>`;
  const panel = (title, iconName, tableHtml, emptyText) => `
    <section class="glass card rise">
      <div class="panel-head">${icon(iconName)}<h2>${esc(title)}</h2></div>
      ${tableHtml ? `<div class="table-wrap">${tableHtml}</div>` : `<div class="empty">${icon('inbox')}<p>${esc(emptyText)}</p></div>`}
    </section>`;
  const guestCell = (b) => `<td><strong>${esc(b.guestName)}</strong><div class="sub">${esc(`${plural(b.adults + b.children, 'guest')} · ${plural(b.nights, 'night')}`)}</div></td>`;
  const balanceCell = (b) => `<td class="num">${b.balance > 0 ? `<span class="due">${money.format(b.balance)}</span>` : badge('Paid')}</td>`;
  const quick = (b, status, label) =>
    `<button type="button" class="btn small accent" data-bstatus="${status}" data-id="${esc(b.id)}">${label}</button>`;

  const arrivals = d.arrivals.length
    ? table(
        [['Guest'], ['Room'], ['Balance', 'num'], ['']],
        d.arrivals
          .map(
            (b) => `<tr>${guestCell(b)}<td>${esc(b.roomNumber)}<div class="sub">${esc(b.roomType)}</div></td>${balanceCell(b)}
              <td class="num">${b.status === 'Confirmed' ? quick(b, 'Checked in', 'Check in') : badge(b.status)}</td></tr>`,
          )
          .join(''),
      )
    : '';
  const departures = d.departures.length
    ? table(
        [['Guest'], ['Room'], ['Balance', 'num'], ['']],
        d.departures
          .map(
            (b) => `<tr>${guestCell(b)}<td>${esc(b.roomNumber)}<div class="sub">${esc(b.roomType)}</div></td>${balanceCell(b)}
              <td class="num">${b.status === 'Checked in' ? quick(b, 'Checked out', 'Check out') : badge(b.status)}</td></tr>`,
          )
          .join(''),
      )
    : '';

  view.innerHTML = `
    <div class="stats">
      ${occupancy}
      ${stat('Arrivals today', d.arrivals.length, 'int', toCheckIn ? `${toCheckIn} still to check in` : 'All checked in', 'arrive', 'cool')}
      ${stat('Departures today', d.departures.length, 'int', toCheckOut ? `${toCheckOut} still to check out` : 'All checked out', 'depart', 'warm')}
      ${stat('Guests in house', d.inHouseGuests, 'int', `${d.upcomingBookings} upcoming bookings`, 'guests', 'violet')}
      ${stat('Revenue this month', d.revenueThisMonth, 'money', 'Payments received', 'payments', 'fresh')}
      ${stat('Outstanding', d.outstanding, 'money', 'Owed on current and past stays', 'clock', 'rose')}
    </div>
    ${forecast}
    <div class="panels">
      ${panel('Arrivals today', 'arrive', arrivals, 'No arrivals today.')}
      ${panel('Departures today', 'depart', departures, 'No departures today.')}
    </div>`;
  afterRender(fresh);
}

// ---------------------------------------------------------------------------
// Calendar: rooms down the side, the next two weeks across
// ---------------------------------------------------------------------------

const CALENDAR_DAYS = 14;

function renderCalendar(fresh) {
  view.dataset.entity = '';
  if (!state.rooms.length) {
    view.innerHTML = `<div class="glass card rise"><div class="empty">${icon('rooms')}<p>Add some <a href="#/rooms">rooms</a> to see availability here.</p></div></div>`;
    afterRender(fresh);
    return;
  }
  calendarStart ??= today();
  const start = calendarStart;
  const end = addDays(start, CALENDAR_DAYS);
  const todayStr = today();
  const days = Array.from({ length: CALENDAR_DAYS }, (_, i) => addDays(start, i));
  const weekend = (d) => [0, 6].includes(local(d).getDay());
  const dayClass = (d) => `${weekend(d) ? ' weekend' : ''}${d === todayStr ? ' today' : ''}`;

  const held = state.bookings.filter((b) => b.status === 'Confirmed' || b.status === 'Checked in');
  const rows = [...state.rooms]
    .sort(byNumber)
    .map((room) => {
      const closed = room.status !== 'Active';
      const cells = days
        .map((d) => {
          const blocked = closed || d < todayStr;
          return `<button type="button" class="cal-cell${dayClass(d)}" data-room="${esc(room.id)}" data-date="${d}" ${blocked ? 'disabled tabindex="-1"' : `aria-label="Book room ${esc(room.number)} on ${esc(fmtShort(d))}"`}></button>`;
        })
        .join('');
      const bars = held
        .filter((b) => b.roomId === room.id && b.checkIn < end && b.checkOut > start)
        .map((b) => {
          const from = Math.max(0, daysBetween(start, b.checkIn));
          const to = Math.min(CALENDAR_DAYS, daysBetween(start, b.checkOut));
          const cutLeft = b.checkIn < start ? ' cut-left' : '';
          const cutRight = b.checkOut > end ? ' cut-right' : '';
          const tone = b.status === 'Checked in' ? 'in' : 'confirmed';
          return `<button type="button" class="cal-item ${tone}${cutLeft}${cutRight}" data-booking="${esc(b.id)}" data-from="${from + 1}" data-to="${to + 1}"
            title="${esc(`${b.guestName} · ${fmtShort(b.checkIn)} → ${fmtShort(b.checkOut)} · ${b.status}`)}"><span>${esc(b.guestName)}</span><small>${esc(plural(b.nights, 'night'))}</small></button>`;
        })
        .join('');
      return `
        <div class="cal-row${closed ? ' closed' : ''}">
          <div class="cal-room"><strong>${esc(room.number)}</strong><span class="sub">${esc(closed ? 'Out of service' : room.type)}</span></div>
          ${cells}
          <div class="cal-bars">${bars}</div>
        </div>`;
    })
    .join('');

  const range = `${fmtShort(start)} – ${fmtDate(addDays(start, CALENDAR_DAYS - 1))}`;
  view.innerHTML = `
    <div class="glass cal-toolbar rise">
      <div class="cal-nav">
        <button type="button" class="icon-btn" data-cal="prev" aria-label="Previous week" title="Previous week">${icon('left')}</button>
        <button type="button" class="btn small" data-cal="today">Today</button>
        <button type="button" class="icon-btn" data-cal="next" aria-label="Next week" title="Next week">${icon('right')}</button>
        <strong class="cal-range">${esc(range)}</strong>
      </div>
      <div class="cal-legend">
        <span><i class="dot confirmed"></i>Confirmed</span>
        <span><i class="dot in"></i>Checked in</span>
        <span><i class="dot closed"></i>Out of service</span>
      </div>
    </div>
    <div class="glass card cal-card rise">
      <div class="cal-scroll">
        <div class="cal">
          <div class="cal-row cal-head">
            <div class="cal-room"><span class="sub">Room</span></div>
            ${days.map((d) => `<div class="cal-day${dayClass(d)}"><span>${esc(fmtWeekday(d))}</span><strong>${local(d).getDate()}</strong></div>`).join('')}
          </div>
          ${rows}
        </div>
      </div>
    </div>`;

  // Each booking bar spans the nights it covers.
  for (const bar of view.querySelectorAll('.cal-item')) bar.style.gridColumn = `${bar.dataset.from} / ${bar.dataset.to}`;
  afterRender(fresh);
}

// ---------------------------------------------------------------------------
// Lists (tables, or cards for rooms)
// ---------------------------------------------------------------------------

function actionButtons(ent, r) {
  const mine = (ent.actions ?? []).filter((a) => a.when(r));
  const text = mine
    .filter((a) => !a.icon)
    .map((a) => `<button type="button" class="btn small accent" data-act="${a.id}" data-id="${esc(r.id)}">${esc(a.label)}</button>`);
  const icons = mine
    .filter((a) => a.icon)
    .map(
      (a) =>
        `<button type="button" class="icon-btn${a.danger ? ' danger' : ''}" data-act="${a.id}" data-id="${esc(r.id)}" title="${esc(a.title)}" aria-label="${esc(a.title)}">${icon(a.icon)}</button>`,
    );
  return [
    ...text,
    ...icons,
    `<button type="button" class="icon-btn" data-act="edit" data-id="${esc(r.id)}" aria-label="Edit ${esc(ent.singular.toLowerCase())}" title="Edit">${icon('edit')}</button>`,
    `<button type="button" class="icon-btn danger" data-act="delete" data-id="${esc(r.id)}" aria-label="Delete ${esc(ent.singular.toLowerCase())}" title="Delete">${icon('trash')}</button>`,
  ].join('');
}

function roomCard(ent, r) {
  return `
    <article class="glass room-card spot rise">
      <div class="room-head type-${esc(r.type.toLowerCase())}">
        <span class="room-no">${esc(r.number)}</span><span class="room-type">${esc(r.type)}</span>
      </div>
      <div class="room-body">
        <div class="room-status">${badge(r.today)}${r.guestName ? `<span class="room-guest">${esc(r.guestName)}</span>` : ''}</div>
        <div class="room-meta"><span>${icon('guests')} Sleeps ${r.capacity}</span><strong>${money.format(r.rate)}<small> / night</small></strong></div>
        ${r.description ? `<p class="room-desc">${esc(r.description)}</p>` : ''}
      </div>
      <div class="room-actions">${actionButtons(ent, r)}</div>
    </article>`;
}

function renderList(name, fresh) {
  const ent = ENTITIES[name];
  view.dataset.entity = name;
  const all = [...state[name]].sort(ent.sort);
  const active = ent.filters ? (ent.filters.find((f) => f.id === filterState[name]) ?? ent.filters[0]) : null;
  const rows = active ? all.filter(active.test) : all;
  subtitleEl.textContent = `${all.length} ${(all.length === 1 ? ent.singular : ent.plural).toLowerCase()}`;

  const chips = ent.filters
    ? `<div class="chips rise">${ent.filters
        .map((f) => `<button type="button" class="chip${f === active ? ' on' : ''}" data-filter="${f.id}">${esc(f.label)}<span>${all.filter(f.test).length}</span></button>`)
        .join('')}</div>`
    : '';

  if (!rows.length) {
    view.innerHTML = `${chips}<div class="glass card rise"><div class="empty">${icon('inbox')}<p>${
      all.length ? 'Nothing in this view.' : `No ${esc(ent.plural.toLowerCase())} yet. Use <strong>${esc(ent.addLabel)}</strong> to create one.`
    }</p></div></div>`;
    afterRender(fresh);
    return;
  }

  if (ent.view === 'cards') {
    view.innerHTML = `${chips}<div class="room-grid">${rows.map((r) => roomCard(ent, r)).join('')}</div>
      <div class="empty" id="no-match" hidden>${icon('search')}<p>Nothing matches your search.</p></div>`;
  } else {
    view.innerHTML = `${chips}
      <div class="glass card list-card rise">
        <div class="table-wrap"><table>
          <thead><tr>${ent.columns.map((c) => `<th class="${c.cls ?? ''}">${esc(c.label)}</th>`).join('')}<th></th></tr></thead>
          <tbody>${rows
            .map(
              (r) =>
                `<tr>${ent.columns.map((c) => `<td class="${c.cls ?? ''}">${c.render(r)}</td>`).join('')}<td class="actions"><div class="row-actions">${actionButtons(ent, r)}</div></td></tr>`,
            )
            .join('')}</tbody>
        </table></div>
        <div class="empty" id="no-match" hidden>${icon('search')}<p>Nothing matches your search.</p></div>
      </div>`;
  }
  afterRender(fresh);
  applySearch();
}

function applySearch() {
  const q = searchEl.value.trim().toLowerCase();
  let shown = 0;
  for (const el of view.querySelectorAll('tbody tr, .room-card')) {
    const hit = !q || el.textContent.toLowerCase().includes(q);
    el.hidden = !hit;
    if (hit) shown++;
  }
  const none = $('#no-match');
  if (none) none.hidden = shown > 0;
}

searchEl.addEventListener('input', applySearch);

async function setBookingStatus(id, status) {
  try {
    await api('POST', `/api/bookings/${id}/status`, { status });
    toast(STATUS_TOAST[status]);
    await route();
  } catch (err) {
    if (err.status !== 401) toast(err.message, true);
  }
}

view.addEventListener('click', async (e) => {
  // Dashboard quick actions
  const quick = e.target.closest('button[data-bstatus]');
  if (quick) return setBookingStatus(quick.dataset.id, quick.dataset.bstatus);

  // Calendar
  const nav = e.target.closest('[data-cal]');
  if (nav) {
    calendarStart = nav.dataset.cal === 'today' ? today() : addDays(calendarStart ?? today(), nav.dataset.cal === 'next' ? 7 : -7);
    return renderCalendar(false);
  }
  const bar = e.target.closest('.cal-item');
  if (bar) {
    const booking = state.bookings.find((b) => b.id === bar.dataset.booking);
    return booking && openForm('bookings', booking);
  }
  const cell = e.target.closest('.cal-cell');
  if (cell && !cell.disabled) {
    return openForm('bookings', null, { roomId: cell.dataset.room, checkIn: cell.dataset.date, checkOut: addDays(cell.dataset.date, 1) });
  }

  // List filters
  const chip = e.target.closest('[data-filter]');
  if (chip) {
    filterState[view.dataset.entity] = chip.dataset.filter;
    return renderList(view.dataset.entity, false);
  }

  // Row and card actions
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
      if (action.open) return action.open(rec);
      if (action.confirm && !confirm(action.confirm)) return;
      return setBookingStatus(rec.id, action.status);
    }
    await route();
  } catch (err) {
    if (err.status !== 401) toast(err.message, true);
  }
});

addBtn.addEventListener('click', () => {
  const name = ENTITIES[shownName] ? shownName : 'bookings';
  const ent = ENTITIES[name];
  const missing = ent.needs?.find((k) => !state[k].length);
  if (missing) return toast(`Add a ${ENTITIES[missing].singular.toLowerCase()} first`, true);
  openForm(name);
});

// ---------------------------------------------------------------------------
// Add / edit form
// ---------------------------------------------------------------------------

function optionsHtml(f, ctx, selected) {
  let options;
  if (f.options) options = f.options(ctx);
  else if (f.ref) options = [...state[f.ref]].sort(byLabel).map((r) => ({ value: r.id, label: r.label }));
  else options = f.choices.map((c) => ({ value: c, label: c }));

  const blank = f.choices || f.noBlank ? '' : `<option value="">${f.required ? 'Select…' : '— None —'}</option>`;
  return (
    blank +
    options.map((o) => `<option value="${esc(o.value)}"${o.value === selected ? ' selected' : ''}>${esc(o.label)}</option>`).join('')
  );
}

function fieldHtml(f, value, ctx) {
  if (f.type === 'info') return `<div class="field wide" data-info="${f.key}"><p class="hint"></p></div>`;

  const common = `id="f_${f.key}" name="${f.key}"${f.required ? ' required' : ''}`;
  let control;
  if (f.ref || f.choices || f.options) {
    control = `<select ${common}>${optionsHtml(f, ctx, value)}</select>`;
  } else if (f.type === 'textarea') {
    control = `<textarea ${common} rows="3" maxlength="2000">${esc(value)}</textarea>`;
  } else {
    const type = f.type ?? 'text';
    let attrs = '';
    if (type === 'number') attrs = ` min="${f.min ?? 0}" step="${f.step ?? 'any'}"`;
    else attrs = ' maxlength="200"';
    control = `<input type="${type}" ${common} value="${esc(value)}"${attrs}>`;
  }
  const group = f.group ? ` data-group="${f.group}"` : '';
  return `<label class="field${f.wide ? ' wide' : ''}"${group}${f.hidden ? ' hidden' : ''}><span class="field-label">${esc(f.label)}${f.required ? ' *' : ''}</span>${control}</label>`;
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

// `preset` fills in a new record, for example the room and night clicked on the calendar.
function openForm(name, rec = null, preset = {}) {
  const ent = ENTITIES[name];
  const isNew = !rec;

  const values = {};
  for (const f of ent.fields) {
    if (f.type === 'info') continue;
    if (rec) values[f.key] = rec[f.key] ?? '';
    else if (f.key in preset) values[f.key] = preset[f.key];
    else values[f.key] = f.initial ? f.initial() : f.choices ? f.choices[0] : '';
  }
  const initialCtx = { rec: rec ?? {}, preset, val: (k) => values[k] };

  dialog.innerHTML = `
    <form id="form">
      <h2>${isNew ? esc(ent.addLabel) : `Edit ${esc(ent.singular.toLowerCase())}`}</h2>
      <div class="fields">${ent.fields.map((f) => fieldHtml(f, values[f.key], initialCtx)).join('')}</div>
      <p class="form-error" role="alert"></p>
      <div class="form-actions">
        <button type="button" class="btn" data-close>Cancel</button>
        <button type="submit" class="btn primary"><span>${esc(ent.saveLabel ?? 'Save')}</span><span class="spinner" aria-hidden="true"></span></button>
      </div>
    </form>`;

  const form = $('#form', dialog);
  const errorEl = $('.form-error', form);
  const submitBtn = $('button[type="submit"]', form);
  $('[data-close]', form).addEventListener('click', closeDialog);

  form.addEventListener('change', (e) => ent.onChange?.(e.target.name, form, isNew));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorEl.textContent = '';
    form.classList.add('is-busy');
    submitBtn.disabled = true;
    try {
      let body = Object.fromEntries(new FormData(form));
      if (ent.toBody) body = ent.toBody(body);
      await api(isNew ? 'POST' : 'PUT', `/api/${name}${isNew ? '' : `/${rec.id}`}`, body);
      closeDialog();
      toast(isNew ? `${ent.singular} saved` : 'Changes saved');
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
  ent.afterOpen?.(form, rec, isNew, preset);
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
