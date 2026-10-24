'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createAuth } = require('./auth');
const { storageFromEnv, createLock } = require('./storage');
const { HttpError, SECURITY_HEADERS, sendJson, readJson, assertSameOrigin } = require('./http-utils');

const PUBLIC_DIR = path.join(__dirname, 'public');
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_STAY_NIGHTS = 365;
const FORECAST_DAYS = 7;

const COLLECTIONS = ['rooms', 'guests', 'bookings', 'payments'];

// A booking in one of these states holds its room for the nights it covers.
const ACTIVE_STATUSES = ['Confirmed', 'Checked in'];
// Which status a booking may move to from each status (the quick actions use these).
const STATUS_MOVES = {
  Confirmed: ['Checked in', 'Cancelled'],
  'Checked in': ['Checked out'],
  'Checked out': [],
  Cancelled: ['Confirmed'],
};

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

// ---------------------------------------------------------------------------
// Schemas: the only fields a client may set on each collection.
// ---------------------------------------------------------------------------

const SCHEMAS = {
  rooms: {
    number: { type: 'string', required: true },
    type: { type: 'enum', values: ['Standard', 'Twin', 'Deluxe', 'Family', 'Suite'], default: 'Standard' },
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
    status: { type: 'enum', values: ['Confirmed', 'Checked in', 'Checked out', 'Cancelled'], default: 'Confirmed' },
    notes: { type: 'string', long: true },
  },
  payments: {
    bookingId: { type: 'ref', ref: 'bookings', required: true },
    date: { type: 'date', required: true },
    amount: { type: 'number', min: 0.01, required: true },
    method: { type: 'enum', values: ['Card', 'Cash', 'Bank transfer', 'Online', 'Other'], default: 'Card' },
    note: { type: 'string' },
  },
};

// Records that must be removed before a record can be deleted: [collection, foreign key, noun].
const DEPENDENTS = {
  rooms: [['bookings', 'roomId', 'booking']],
  guests: [['bookings', 'guestId', 'booking']],
  bookings: [['payments', 'bookingId', 'payment']],
  payments: [],
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

const holdsRoom = (booking) => ACTIVE_STATUSES.includes(booking.status);

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

async function saveRecord(store, collection, input, existing) {
  const { data } = store;
  const value = validate(collection, input, data);
  RULES[collection]?.(value, data, existing?.id, existing);
  const now = new Date().toISOString();
  if (existing) {
    Object.assign(existing, value, { updatedAt: now });
    await store.save();
    return existing;
  }
  const record = { id: crypto.randomUUID(), ...value, createdAt: now, updatedAt: now };
  data[collection].push(record);
  await store.save();
  return record;
}

async function removeRecord(store, collection, record) {
  const { data } = store;
  for (const [dep, key, noun] of DEPENDENTS[collection]) {
    const n = data[dep].filter((r) => r[key] === record.id).length;
    if (n > 0) {
      throw new HttpError(409, `Cannot delete: ${n} ${noun}${n === 1 ? '' : 's'} still reference${n === 1 ? 's' : ''} it. Remove ${n === 1 ? 'it' : 'them'} first.`);
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

async function changeBookingStatus(store, record, input) {
  const status = typeof input.status === 'string' ? input.status : '';
  if (!STATUS_MOVES[record.status].includes(status)) {
    const options = STATUS_MOVES[record.status];
    throw new HttpError(409, options.length ? `A ${record.status.toLowerCase()} booking can only become: ${options.join(', ')}` : `A ${record.status.toLowerCase()} booking cannot be changed`);
  }
  // Re-running the rules matters when a cancelled booking is reinstated: its room may have been rebooked.
  const next = { ...record, status };
  RULES.bookings(next, store.data, record.id, record);
  record.status = status;
  record.updatedAt = new Date().toISOString();
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

  const guestName = (id) => guests.get(id)?.name ?? '';
  const roomNumber = (id) => rooms.get(id)?.number ?? '';
  const nightsOf = (b) => daysBetween(b.checkIn, b.checkOut);

  const paidByBooking = new Map();
  for (const p of data.payments) paidByBooking.set(p.bookingId, round2((paidByBooking.get(p.bookingId) ?? 0) + p.amount));

  const held = data.bookings.filter(holdsRoom);
  const tonight = new Map(held.filter((b) => b.checkIn <= today && b.checkOut > today).map((b) => [b.roomId, b]));

  const bookingView = (b) => {
    const total = round2(nightsOf(b) * b.nightlyRate);
    const paid = paidByBooking.get(b.id) ?? 0;
    return {
      ...b,
      label: `${guestName(b.guestId)} · Room ${roomNumber(b.roomId)} · ${b.checkIn} → ${b.checkOut}`,
      guestName: guestName(b.guestId),
      roomNumber: roomNumber(b.roomId),
      roomType: rooms.get(b.roomId)?.type ?? '',
      nights: nightsOf(b),
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
      const upcoming = mine.filter((b) => b.status === 'Confirmed' && b.checkIn >= today).map((b) => b.checkIn).sort();
      const past = mine.filter((b) => b.status === 'Checked out').map((b) => b.checkOut).sort();
      return { ...g, label: g.name, stays: mine.length, nextArrival: upcoming[0] ?? '', lastVisit: past[past.length - 1] ?? '' };
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
  };

  function dashboard() {
    const activeRooms = data.rooms.filter((r) => r.status === 'Active');
    const activeIds = new Set(activeRooms.map((r) => r.id));

    // Occupancy for tonight and the following nights.
    const forecast = Array.from({ length: FORECAST_DAYS }, (_, i) => {
      const date = addDays(today, i);
      const occupied = new Set(held.filter((b) => b.checkIn <= date && b.checkOut > date && activeIds.has(b.roomId)).map((b) => b.roomId)).size;
      return { date, occupied, rooms: activeRooms.length, rate: activeRooms.length ? Math.round((occupied / activeRooms.length) * 100) : 0 };
    });

    const arrivals = data.bookings.filter((b) => b.checkIn === today && holdsRoom(b)).map(bookingView).sort(byRoomNumber);
    const departures = data.bookings
      .filter((b) => b.checkOut === today && (b.status === 'Checked in' || b.status === 'Checked out'))
      .map(bookingView)
      .sort(byRoomNumber);
    const inHouse = data.bookings.filter((b) => b.status === 'Checked in');
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
    };
  }

  return { decorate: (collection, record) => decorators[collection](record), dashboard };
}

// ---------------------------------------------------------------------------
// HTTP layer
// ---------------------------------------------------------------------------

function parseAvailabilityQuery(url) {
  const checkIn = url.searchParams.get('checkIn');
  const checkOut = url.searchParams.get('checkOut');
  if (!isDate(checkIn) || !isDate(checkOut)) throw new HttpError(400, 'Choose valid check-in and check-out dates');
  const nights = daysBetween(checkIn, checkOut);
  if (nights < 1) throw new HttpError(400, 'Check-out must be after check-in');
  if (nights > MAX_STAY_NIGHTS) throw new HttpError(400, `A stay can be at most ${MAX_STAY_NIGHTS} nights`);
  const guests = Number(url.searchParams.get('guests') ?? 1);
  if (!Number.isInteger(guests) || guests < 1 || guests > 40) throw new HttpError(400, 'Guests must be a whole number from 1 to 40');
  return { checkIn, checkOut, guests, nights, excludeId: url.searchParams.get('exclude') || undefined };
}

async function handleApi(req, res, url, store) {
  let parts;
  try {
    parts = url.pathname.split('/').filter(Boolean).slice(1).map(decodeURIComponent);
  } catch {
    throw new HttpError(400, 'Bad request');
  }
  const { method } = req;
  const { data } = store;
  const today = todayFrom(url);
  if (method !== 'GET') assertSameOrigin(req);

  if (parts[0] === 'dashboard' && parts.length === 1) {
    if (method !== 'GET') throw new HttpError(405, 'Method not allowed');
    return sendJson(res, 200, buildView(data, today).dashboard());
  }

  if (parts[0] === 'availability' && parts.length === 1) {
    if (method !== 'GET') throw new HttpError(405, 'Method not allowed');
    const query = parseAvailabilityQuery(url);
    return sendJson(res, 200, { nights: query.nights, rooms: availableRooms(data, query) });
  }

  const [collection, id, action] = parts;
  if (!COLLECTIONS.includes(collection) || parts.length > 3) throw new HttpError(404, 'Not found');
  const present = (record) => buildView(data, today).decorate(collection, record);

  if (id === undefined) {
    if (method === 'GET') {
      const view = buildView(data, today);
      return sendJson(res, 200, data[collection].map((r) => view.decorate(collection, r)));
    }
    if (method === 'POST') {
      const body = await readJson(req);
      const record = collection === 'bookings' ? await createBooking(store, body) : await saveRecord(store, collection, body, null);
      return sendJson(res, 201, present(record));
    }
    throw new HttpError(405, 'Method not allowed');
  }

  const record = data[collection].find((r) => r.id === id);
  if (!record) throw new HttpError(404, 'Record not found');

  if (action !== undefined) {
    if (collection !== 'bookings' || action !== 'status') throw new HttpError(404, 'Not found');
    if (method !== 'POST') throw new HttpError(405, 'Method not allowed');
    return sendJson(res, 200, present(await changeBookingStatus(store, record, await readJson(req))));
  }

  if (method === 'GET') return sendJson(res, 200, present(record));
  if (method === 'PUT') return sendJson(res, 200, present(await saveRecord(store, collection, await readJson(req), record)));
  if (method === 'DELETE') {
    await removeRecord(store, collection, record);
    res.writeHead(204, { 'Cache-Control': 'no-store', ...SECURITY_HEADERS });
    return res.end();
  }
  throw new HttpError(405, 'Method not allowed');
}

// On Vercel the browser files travel inside the function. Each path is written out in full on purpose:
// bundlers work out which files a function needs by reading the code. A new file in public/ must be added here
// (a test fails if one is missing).
function readBundledAssets() {
  const optional = (read) => {
    try {
      return read();
    } catch (err) {
      console.warn(`Browser file missing from the deployment: ${err.message}`);
      return null;
    }
  };
  return new Map(
    [
      ['/index.html', optional(() => fs.readFileSync(path.join(__dirname, 'public', 'index.html')))],
      ['/style.css', optional(() => fs.readFileSync(path.join(__dirname, 'public', 'style.css')))],
      ['/app.js', optional(() => fs.readFileSync(path.join(__dirname, 'public', 'app.js')))],
      ['/theme.js', optional(() => fs.readFileSync(path.join(__dirname, 'public', 'theme.js')))],
    ].filter(([, body]) => body),
  );
}
const BUNDLED_ASSETS = process.env.VERCEL ? readBundledAssets() : null;

async function serveStatic(req, res, url) {
  if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Method not allowed');
  let rel;
  try {
    rel = decodeURIComponent(url.pathname);
  } catch {
    throw new HttpError(400, 'Bad request');
  }
  if (rel.includes('\0')) throw new HttpError(400, 'Bad request');
  if (rel.endsWith('/')) rel += 'index.html';

  let body;
  if (BUNDLED_ASSETS) {
    body = BUNDLED_ASSETS.get(rel);
    if (!body) throw new HttpError(404, 'Not found');
  } else {
    const file = path.join(PUBLIC_DIR, rel);
    if (!file.startsWith(PUBLIC_DIR + path.sep)) throw new HttpError(403, 'Forbidden');
    try {
      body = await fs.promises.readFile(file);
    } catch (err) {
      if (err.code === 'ENOENT' || err.code === 'EISDIR') throw new HttpError(404, 'Not found');
      throw err;
    }
  }
  res.writeHead(200, {
    'Content-Type': MIME[path.extname(rel).toLowerCase()] ?? 'application/octet-stream',
    'Content-Length': body.length,
    'Cache-Control': 'no-cache',
    ...SECURITY_HEADERS,
  });
  res.end(req.method === 'HEAD' ? undefined : body);
}

// Builds the (req, res) handler that serves the API and the browser files, keeping its data in `storage`.
function createRequestHandler(storage) {
  const store = createStore(storage);
  const auth = createAuth(storage);
  const exclusive = createLock();

  return (req, res) =>
    (async () => {
      let url;
      try {
        url = new URL(req.url, 'http://localhost');
      } catch {
        throw new HttpError(400, 'Bad request');
      }
      if (url.pathname === '/api/auth' || url.pathname.startsWith('/api/auth/')) {
        return auth.handle(req, res, url.pathname.slice('/api/auth/'.length));
      }
      if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
        await auth.requireUser(req);
        // One API request at a time per process, so a read-modify-write can't interleave with another.
        return exclusive(async () => {
          await store.load();
          await handleApi(req, res, url, store);
        });
      }
      return serveStatic(req, res, url);
    })().catch((err) => {
      const status = err instanceof HttpError ? err.status : 500;
      if (status === 500) console.error(err);
      if (res.headersSent) return res.destroy();
      sendJson(res, status, { error: status === 500 ? 'Internal server error' : err.message });
    });
}

const createServer = (storage) => http.createServer(createRequestHandler(storage));

// What a serverless host such as Vercel imports: a plain request handler that sets itself up on first use.
// If storage isn't configured it answers with the reason instead of crashing.
let envHandler;
function handler(req, res) {
  if (!envHandler) {
    try {
      envHandler = createRequestHandler(storageFromEnv());
    } catch (err) {
      console.error(err);
      res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8', ...SECURITY_HEADERS });
      return res.end(err.message);
    }
  }
  return envHandler(req, res);
}

module.exports = handler;
Object.assign(handler, { createServer, createRequestHandler, createStore, localDate, readBundledAssets });

if (require.main === module) {
  (async () => {
    const port = Number(process.env.PORT) || 3000;
    // Loopback by default: only this computer can reach it unless HOST says otherwise.
    const host = process.env.HOST || '127.0.0.1';

    let storage;
    try {
      storage = storageFromEnv();
      // Fail now, with a clear message, if stored data can't be read.
      await Promise.all([storage.read('data'), storage.read('users')]);
    } catch (err) {
      console.error(err.message);
      process.exit(1);
    }

    const server = createServer(storage);
    server.on('error', (err) => {
      console.error(err.code === 'EADDRINUSE' ? `Port ${port} is already in use. Set PORT to use another.` : err.message);
      process.exit(1);
    });
    server.listen(port, host, () => {
      console.log(`Hotel PMS running at http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`);
      console.log(`Storing data in ${storage.description}`);
    });
  })();
}
