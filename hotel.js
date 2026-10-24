'use strict';

// The hotel itself: what records exist, which rules they follow, and how they are read back.
// Both the management API (server.js) and the guest API (portal-api.js) are built on this.

const crypto = require('node:crypto');
const { HttpError } = require('./http-utils');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_STAY_NIGHTS = 365;
const FORECAST_DAYS = 7;

const COLLECTIONS = ['rooms', 'guests', 'bookings', 'payments', 'services', 'serviceOrders', 'inquiries'];
const ROOM_TYPES = ['Standard', 'Twin', 'Deluxe', 'Family', 'Suite'];

// A booking in one of these states holds its room for the nights it covers. A guest's own
// reservation starts as Pending and holds the room until management confirms or declines it.
const HOLDING_STATUSES = ['Pending', 'Confirmed', 'Checked in'];

// Which status a record may move to from each status.
const STATUS_MOVES = {
  bookings: {
    Pending: ['Confirmed', 'Cancelled'],
    Confirmed: ['Checked in', 'Cancelled'],
    'Checked in': ['Checked out'],
    'Checked out': [],
    Cancelled: ['Confirmed'],
  },
  serviceOrders: {
    Requested: ['Confirmed', 'Declined', 'Cancelled'],
    Confirmed: ['Completed', 'Cancelled'],
    Completed: [],
    Declined: ['Requested'],
    Cancelled: ['Requested'],
  },
  inquiries: {
    Open: ['Closed'],
    Answered: ['Closed'],
    Closed: ['Open'],
  },
};

// ---------------------------------------------------------------------------
// Schemas: the only fields a client may set on each collection. Fields the server manages
// itself (a booking's `source`, a guest's `account`, an inquiry's `repliedAt`) are left out on purpose.
// ---------------------------------------------------------------------------

const SCHEMAS = {
  rooms: {
    number: { type: 'string', required: true },
    type: { type: 'enum', values: ROOM_TYPES, default: 'Standard' },
    capacity: { type: 'number', min: 1, max: 20, integer: true, default: 2 },
    rate: { type: 'number', min: 0, required: true },
    status: { type: 'enum', values: ['Active', 'Out of service'], default: 'Active' },
    description: { type: 'string', long: true },
  },
  guests: {
    name: { type: 'string', required: true },
    email: { type: 'string', format: 'email' },
    phone: { type: 'string' },
    notes: { type: 'string', long: true },
  },
  bookings: {
    roomId: { type: 'ref', ref: 'rooms', required: true },
    guestId: { type: 'ref', ref: 'guests', required: true },
    checkIn: { type: 'date', required: true },
    checkOut: { type: 'date', required: true },
    adults: { type: 'number', min: 1, max: 20, integer: true, default: 1 },
    children: { type: 'number', min: 0, max: 20, integer: true, default: 0 },
    nightlyRate: { type: 'number', min: 0 }, // left blank, it becomes the room's rate
    status: { type: 'enum', values: ['Pending', 'Confirmed', 'Checked in', 'Checked out', 'Cancelled'], default: 'Confirmed' },
    guestNotes: { type: 'string', long: true }, // what the guest asked for
    notes: { type: 'string', long: true }, // the hotel's own notes
  },
  payments: {
    bookingId: { type: 'ref', ref: 'bookings', required: true },
    date: { type: 'date', required: true },
    amount: { type: 'number', min: 0.01, required: true },
    method: { type: 'enum', values: ['Card', 'Cash', 'Bank transfer', 'Online', 'Other'], default: 'Card' },
    note: { type: 'string' },
  },
  services: {
    name: { type: 'string', required: true },
    description: { type: 'string', long: true },
    price: { type: 'number', min: 0, required: true },
    unit: { type: 'string' }, // for example "per person" or "per trip"
    status: { type: 'enum', values: ['Available', 'Unavailable'], default: 'Available' },
  },
  serviceOrders: {
    guestId: { type: 'ref', ref: 'guests', required: true },
    serviceId: { type: 'ref', ref: 'services', required: true },
    date: { type: 'date', required: true },
    quantity: { type: 'number', min: 1, max: 50, integer: true, default: 1 },
    unitPrice: { type: 'number', min: 0 }, // left blank, it becomes the service's price
    bookingId: { type: 'ref', ref: 'bookings' }, // the stay it is charged to, if any
    status: { type: 'enum', values: ['Requested', 'Confirmed', 'Declined', 'Completed', 'Cancelled'], default: 'Requested' },
    notes: { type: 'string', long: true },
  },
  inquiries: {
    guestId: { type: 'ref', ref: 'guests', required: true },
    topic: { type: 'enum', values: ['Room', 'Service', 'General'], default: 'General' },
    subject: { type: 'string', required: true },
    message: { type: 'string', long: true, required: true },
    roomType: { type: 'enum', values: ROOM_TYPES },
    serviceName: { type: 'string' },
    checkIn: { type: 'date' },
    checkOut: { type: 'date' },
    status: { type: 'enum', values: ['Open', 'Answered', 'Closed'], default: 'Open' },
    reply: { type: 'string', long: true },
  },
};

// Records that must be removed before a record can be deleted: [collection, foreign key, noun, plural].
const DEPENDENTS = {
  rooms: [['bookings', 'roomId', 'booking']],
  guests: [
    ['bookings', 'guestId', 'booking'],
    ['serviceOrders', 'guestId', 'service request'],
    ['inquiries', 'guestId', 'inquiry', 'inquiries'],
  ],
  bookings: [
    ['payments', 'bookingId', 'payment'],
    ['serviceOrders', 'bookingId', 'service request'],
  ],
  services: [['serviceOrders', 'serviceId', 'service request']],
  payments: [],
  serviceOrders: [],
  inquiries: [],
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const pad = (n) => String(n).padStart(2, '0');
const localDate = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const round2 = (n) => Math.round(n * 100) / 100;
const sumBy = (items, fn) => round2(items.reduce((total, item) => total + fn(item), 0));
const byRoomNumber = (a, b) => String(a.roomNumber).localeCompare(String(b.roomNumber), undefined, { numeric: true });

function addDays(dateStr, n) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function daysBetween(from, to) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
}

function isDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function fieldLabel(key) {
  const s = key.replace(/Id$/, '').replace(/([A-Z])/g, ' $1').toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// "Today" comes from the browser, so arrivals and departures follow the hotel's own time zone even
// though a serverless host runs in UTC. Without it (or if it is invalid) the server's date is used.
function todayFrom(url) {
  const asked = url.searchParams.get('today');
  return isDate(asked) ? asked : localDate();
}

const holdsRoom = (booking) => HOLDING_STATUSES.includes(booking.status);

// A stay covers the nights from check-in up to, but not including, the check-out day,
// so one guest can leave the morning the next arrives.
function clashingBooking(data, roomId, checkIn, checkOut, excludeId) {
  return data.bookings.find(
    (b) => b.id !== excludeId && b.roomId === roomId && holdsRoom(b) && b.checkIn < checkOut && b.checkOut > checkIn,
  );
}

// ---------------------------------------------------------------------------
// Business rules, checked after field validation.
// ---------------------------------------------------------------------------

const RULES = {
  rooms(v, data, id) {
    const clash = data.rooms.find((r) => r.id !== id && r.number.toLowerCase() === v.number.toLowerCase());
    if (clash) throw new HttpError(409, `Room ${v.number} already exists`);
  },
  bookings(v, data, id, existing) {
    const nights = daysBetween(v.checkIn, v.checkOut);
    if (nights < 1) throw new HttpError(400, 'Check-out must be after check-in');
    if (nights > MAX_STAY_NIGHTS) throw new HttpError(400, `A stay can be at most ${MAX_STAY_NIGHTS} nights`);

    const room = data.rooms.find((r) => r.id === v.roomId);
    if (v.nightlyRate === null) v.nightlyRate = room.rate;
    if (!holdsRoom(v)) return; // checked-out and cancelled bookings no longer hold the room

    const party = v.adults + v.children;
    if (party > room.capacity) {
      throw new HttpError(400, `Room ${room.number} sleeps ${room.capacity} at most, but this booking has ${party} guests`);
    }
    if (room.status !== 'Active' && existing?.roomId !== v.roomId) {
      throw new HttpError(409, `Room ${room.number} is out of service`);
    }
    const clash = clashingBooking(data, v.roomId, v.checkIn, v.checkOut, id);
    if (clash) throw new HttpError(409, `Room ${room.number} is already booked from ${clash.checkIn} to ${clash.checkOut}`);
  },
  serviceOrders(v, data) {
    if (v.unitPrice === null) v.unitPrice = data.services.find((s) => s.id === v.serviceId).price;
    if (v.bookingId) {
      const booking = data.bookings.find((b) => b.id === v.bookingId);
      if (booking.guestId !== v.guestId) throw new HttpError(400, 'That booking belongs to a different guest');
    }
  },
  inquiries(v) {
    if (v.checkIn && v.checkOut && v.checkOut <= v.checkIn) throw new HttpError(400, 'Check-out must be after check-in');
  },
};

// ---------------------------------------------------------------------------
// Store: the hotel's data, held in memory for the length of one request.
// ---------------------------------------------------------------------------

function createStore(storage) {
  const data = Object.fromEntries(COLLECTIONS.map((c) => [c, []]));
  let extra = {};
  return {
    data,
    // Re-read before every request: another serverless instance may have saved since the last one.
    async load() {
      const saved = (await storage.read('data')) ?? {};
      for (const c of COLLECTIONS) data[c] = Array.isArray(saved[c]) ? saved[c] : [];
      // Anything else already in storage (such as records from an earlier version of the app) is
      // carried along untouched, never silently dropped by the next save.
      extra = Object.fromEntries(Object.entries(saved).filter(([key]) => !COLLECTIONS.includes(key)));
    },
    save: () => storage.write('data', { ...extra, ...data }),
  };
}

// ---------------------------------------------------------------------------
// Validation and CRUD
// ---------------------------------------------------------------------------

function validate(collection, input, data) {
  const out = {};
  for (const [key, spec] of Object.entries(SCHEMAS[collection])) {
    const label = fieldLabel(key);
    let v = input[key];
    if (typeof v === 'string') v = v.trim();

    if (v === undefined || v === null || v === '') {
      if (spec.default !== undefined) out[key] = typeof spec.default === 'function' ? spec.default() : spec.default;
      else if (spec.required) throw new HttpError(400, `${label} is required`);
      else out[key] = spec.type === 'string' ? '' : null;
      continue;
    }

    switch (spec.type) {
      case 'string': {
        if (typeof v === 'number') v = String(v);
        if (typeof v !== 'string') throw new HttpError(400, `${label} must be text`);
        const max = spec.long ? 2000 : 200;
        if (v.length > max) throw new HttpError(400, `${label} must be at most ${max} characters`);
        if (spec.format === 'email' && !EMAIL_RE.test(v)) throw new HttpError(400, `${label} is not a valid email address`);
        out[key] = v;
        break;
      }
      case 'number': {
        const n = typeof v === 'number' || typeof v === 'string' ? Number(v) : NaN;
        if (!Number.isFinite(n)) throw new HttpError(400, `${label} must be a number`);
        if (spec.integer && !Number.isInteger(n)) throw new HttpError(400, `${label} must be a whole number`);
        if (spec.min !== undefined && n < spec.min) throw new HttpError(400, `${label} must be at least ${spec.min}`);
        if (n > (spec.max ?? 1e9)) throw new HttpError(400, `${label} must be at most ${spec.max ?? 1e9}`);
        out[key] = round2(n);
        break;
      }
      case 'date':
        if (!isDate(v)) throw new HttpError(400, `${label} must be a valid date (YYYY-MM-DD)`);
        out[key] = v;
        break;
      case 'enum':
        if (!spec.values.includes(v)) throw new HttpError(400, `${label} must be one of: ${spec.values.join(', ')}`);
        out[key] = v;
        break;
      case 'ref':
        if (typeof v !== 'string' || !data[spec.ref].some((r) => r.id === v)) throw new HttpError(400, `${label} does not exist`);
        out[key] = v;
        break;
    }
  }
  return out;
}

// `extra` carries fields the server sets itself when a record is created (they are not in the schema).
async function saveRecord(store, collection, input, existing, extra = {}) {
  const { data } = store;
  const value = validate(collection, input, data);
  RULES[collection]?.(value, data, existing?.id, existing);
  const now = new Date().toISOString();
  if (existing) {
    Object.assign(existing, value, { updatedAt: now });
    await store.save();
    return existing;
  }
  const record = { id: crypto.randomUUID(), ...value, ...extra, createdAt: now, updatedAt: now };
  data[collection].push(record);
  await store.save();
  return record;
}

async function removeRecord(store, collection, record) {
  const { data } = store;
  for (const [dep, key, noun, plural] of DEPENDENTS[collection]) {
    const n = data[dep].filter((r) => r[key] === record.id).length;
    if (n > 0) {
      const what = n === 1 ? noun : (plural ?? `${noun}s`);
      throw new HttpError(409, `Cannot delete: ${n} ${what} still reference${n === 1 ? 's' : ''} it. Remove ${n === 1 ? 'it' : 'them'} first.`);
    }
  }
  data[collection] = data[collection].filter((r) => r !== record);
  await store.save();
}

// A new booking may bring its guest along: the guest and the booking are saved together or not at all.
async function createBooking(store, body) {
  const { data } = store;
  if (body.newGuest === undefined) return saveRecord(store, 'bookings', body, null);

  if (body.guestId) throw new HttpError(400, 'Choose an existing guest or enter a new one, not both');
  const input = body.newGuest && typeof body.newGuest === 'object' && !Array.isArray(body.newGuest) ? body.newGuest : {};
  const now = new Date().toISOString();
  const guest = { id: crypto.randomUUID(), ...validate('guests', input, data), createdAt: now, updatedAt: now };
  data.guests.push(guest);
  try {
    return await saveRecord(store, 'bookings', { ...body, guestId: guest.id }, null);
  } catch (err) {
    data.guests = data.guests.filter((g) => g !== guest);
    throw err;
  }
}

async function changeStatus(store, collection, record, input) {
  const status = typeof input.status === 'string' ? input.status : '';
  const allowed = STATUS_MOVES[collection][record.status] ?? [];
  if (!allowed.includes(status)) {
    throw new HttpError(409, `This cannot go from "${record.status}" to "${status}".${allowed.length ? ` It can become: ${allowed.join(', ')}.` : ' It is final.'}`);
  }
  // Re-running the rules matters when a cancelled booking is reinstated: its room may have been rebooked.
  if (collection === 'bookings') RULES.bookings({ ...record, status }, store.data, record.id, record);
  record.status = status;
  record.updatedAt = new Date().toISOString();
  await store.save();
  return record;
}

async function replyToInquiry(store, record, input) {
  const reply = typeof input.reply === 'string' ? input.reply.trim() : '';
  if (!reply) throw new HttpError(400, 'Write a reply first');
  if (reply.length > 2000) throw new HttpError(400, 'A reply can be at most 2000 characters');
  Object.assign(record, { reply, repliedAt: new Date().toISOString(), status: 'Answered', updatedAt: new Date().toISOString() });
  await store.save();
  return record;
}

// ---------------------------------------------------------------------------
// Read model: adds display fields to records, answers availability, builds the dashboard.
// ---------------------------------------------------------------------------

function availableRooms(data, { checkIn, checkOut, guests, excludeId }) {
  return data.rooms
    .filter((r) => r.status === 'Active' && r.capacity >= guests && !clashingBooking(data, r.id, checkIn, checkOut, excludeId))
    .sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true }))
    .map((r) => ({
      id: r.id,
      number: r.number,
      type: r.type,
      capacity: r.capacity,
      rate: r.rate,
      label: `Room ${r.number}`,
      total: round2(r.rate * daysBetween(checkIn, checkOut)),
    }));
}

function buildView(data, today) {
  const byId = (name) => new Map(data[name].map((r) => [r.id, r]));
  const rooms = byId('rooms');
  const guests = byId('guests');
  const bookings = byId('bookings');
  const services = byId('services');

  const guestName = (id) => guests.get(id)?.name ?? '';
  const roomNumber = (id) => rooms.get(id)?.number ?? '';
  const nightsOf = (b) => daysBetween(b.checkIn, b.checkOut);

  const paidByBooking = new Map();
  for (const p of data.payments) paidByBooking.set(p.bookingId, round2((paidByBooking.get(p.bookingId) ?? 0) + p.amount));

  // Services that were confirmed or done are charged to the stay they were linked to.
  const servicesByBooking = new Map();
  for (const o of data.serviceOrders) {
    if (o.bookingId && (o.status === 'Confirmed' || o.status === 'Completed')) {
      servicesByBooking.set(o.bookingId, round2((servicesByBooking.get(o.bookingId) ?? 0) + o.unitPrice * o.quantity));
    }
  }

  const held = data.bookings.filter(holdsRoom);
  const tonight = new Map(held.filter((b) => b.checkIn <= today && b.checkOut > today).map((b) => [b.roomId, b]));

  const bookingView = (b) => {
    const roomTotal = round2(nightsOf(b) * b.nightlyRate);
    const servicesTotal = servicesByBooking.get(b.id) ?? 0;
    const total = round2(roomTotal + servicesTotal);
    const paid = paidByBooking.get(b.id) ?? 0;
    return {
      ...b,
      label: `${guestName(b.guestId)} · Room ${roomNumber(b.roomId)} · ${b.checkIn} → ${b.checkOut}`,
      guestName: guestName(b.guestId),
      roomNumber: roomNumber(b.roomId),
      roomType: rooms.get(b.roomId)?.type ?? '',
      nights: nightsOf(b),
      roomTotal,
      servicesTotal,
      total,
      paid,
      balance: Math.max(0, round2(total - paid)),
    };
  };

  const decorators = {
    rooms: (r) => {
      const b = tonight.get(r.id);
      return {
        ...r,
        label: `Room ${r.number}`,
        today: r.status !== 'Active' ? 'Out of service' : b ? (b.status === 'Checked in' ? 'Occupied' : 'Reserved') : 'Vacant',
        guestName: b ? guestName(b.guestId) : '',
        bookingId: b?.id ?? null,
      };
    },
    guests: (g) => {
      const mine = data.bookings.filter((b) => b.guestId === g.id && b.status !== 'Cancelled');
      const upcoming = mine.filter((b) => (b.status === 'Confirmed' || b.status === 'Pending') && b.checkIn >= today).map((b) => b.checkIn).sort();
      const past = mine.filter((b) => b.status === 'Checked out').map((b) => b.checkOut).sort();
      return {
        ...g,
        label: g.name,
        hasAccount: Boolean(g.account),
        stays: mine.length,
        nextArrival: upcoming[0] ?? '',
        lastVisit: past[past.length - 1] ?? '',
      };
    },
    bookings: bookingView,
    payments: (p) => {
      const b = bookings.get(p.bookingId);
      return {
        ...p,
        guestName: b ? guestName(b.guestId) : '',
        roomNumber: b ? roomNumber(b.roomId) : '',
        stay: b ? `${b.checkIn} → ${b.checkOut}` : '',
      };
    },
    services: (s) => ({ ...s, label: s.name }),
    serviceOrders: (o) => {
      const b = bookings.get(o.bookingId);
      return {
        ...o,
        guestName: guestName(o.guestId),
        serviceName: services.get(o.serviceId)?.name ?? '',
        serviceUnit: services.get(o.serviceId)?.unit ?? '',
        total: round2(o.unitPrice * o.quantity),
        stay: b ? `${b.checkIn} → ${b.checkOut}` : '',
        roomNumber: b ? roomNumber(b.roomId) : '',
      };
    },
    inquiries: (i) => ({ ...i, guestName: guestName(i.guestId) }),
  };

  function dashboard() {
    const activeRooms = data.rooms.filter((r) => r.status === 'Active');
    const activeIds = new Set(activeRooms.map((r) => r.id));

    // Occupancy for tonight and the following nights (a pending reservation already holds its room).
    const forecast = Array.from({ length: FORECAST_DAYS }, (_, i) => {
      const date = addDays(today, i);
      const occupied = new Set(held.filter((b) => b.checkIn <= date && b.checkOut > date && activeIds.has(b.roomId)).map((b) => b.roomId)).size;
      return { date, occupied, rooms: activeRooms.length, rate: activeRooms.length ? Math.round((occupied / activeRooms.length) * 100) : 0 };
    });

    const arrivals = data.bookings
      .filter((b) => b.checkIn === today && (b.status === 'Confirmed' || b.status === 'Checked in'))
      .map(bookingView)
      .sort(byRoomNumber);
    const departures = data.bookings
      .filter((b) => b.checkOut === today && (b.status === 'Checked in' || b.status === 'Checked out'))
      .map(bookingView)
      .sort(byRoomNumber);
    const inHouse = data.bookings.filter((b) => b.status === 'Checked in');
    const pending = data.bookings.filter((b) => b.status === 'Pending');
    const month = today.slice(0, 7);

    return {
      today,
      totalRooms: data.rooms.length,
      activeRooms: activeRooms.length,
      outOfService: data.rooms.length - activeRooms.length,
      occupiedTonight: forecast[0].occupied,
      occupancyRate: forecast[0].rate,
      inHouseGuests: inHouse.reduce((n, b) => n + b.adults + b.children, 0),
      upcomingBookings: data.bookings.filter((b) => b.status === 'Confirmed' && b.checkIn > today).length,
      revenueThisMonth: sumBy(data.payments.filter((p) => p.date.startsWith(month)), (p) => p.amount),
      outstanding: sumBy(
        data.bookings.filter((b) => b.status === 'Checked in' || b.status === 'Checked out').map(bookingView),
        (b) => b.balance,
      ),
      arrivals,
      departures,
      forecast,
      requests: waitingOnHotel(data),
      pendingBookings: pending.map(bookingView).sort((a, b) => a.checkIn.localeCompare(b.checkIn)).slice(0, 8),
    };
  }

  return { decorate: (collection, record) => decorators[collection](record), dashboard, bookingView };
}

// What the management still has to answer.
const waitingOnHotel = (data) => ({
  bookings: data.bookings.filter((b) => b.status === 'Pending').length,
  inquiries: data.inquiries.filter((i) => i.status === 'Open').length,
  serviceOrders: data.serviceOrders.filter((o) => o.status === 'Requested').length,
});

// A short string that changes whenever a record in these lists is added, edited or removed. Browsers compare it
// between polls to learn that something happened, without downloading the records themselves.
const fingerprint = (...lists) =>
  lists.map((records) => `${records.length}:${records.reduce((latest, r) => (r.updatedAt > latest ? r.updatedAt : latest), '')}`).join('|');

// The management's browser polls this to see new requests without a reload: a fingerprint of everything, and what is waiting.
const managementPulse = (data) => ({ version: fingerprint(...COLLECTIONS.map((c) => data[c])), requests: waitingOnHotel(data) });

module.exports = {
  COLLECTIONS,
  ROOM_TYPES,
  HOLDING_STATUSES,
  STATUS_MOVES,
  MAX_STAY_NIGHTS,
  SCHEMAS,
  localDate,
  isDate,
  addDays,
  daysBetween,
  round2,
  todayFrom,
  holdsRoom,
  clashingBooking,
  createStore,
  validate,
  saveRecord,
  removeRecord,
  createBooking,
  changeStatus,
  replyToInquiry,
  availableRooms,
  buildView,
  fingerprint,
  managementPulse,
};
