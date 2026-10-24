'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createServer } = require('../server');
const { fileStorage } = require('../storage');

const CREDENTIALS = { username: 'admin', password: 'test-password-123' };
const JSON_HEADERS = { 'Content-Type': 'application/json' };
const day = (n) => `2030-06-${String(n).padStart(2, '0')}`; // fixed dates, so nothing depends on the real clock

// Every test gets its own app, data directory and signed-in session, so tests can't affect each other.
async function withApp(fn, prepare) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pms-test-'));
  const file = path.join(dir, 'db.json');
  prepare?.(file);
  const server = createServer(fileStorage(file));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  const setup = await fetch(`${base}/api/auth/setup`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(CREDENTIALS) });
  assert.equal(setup.status, 201);
  const cookie = setup.headers.getSetCookie()[0].split(';')[0];

  async function call(method, url, body, headers = {}) {
    const res = await fetch(base + url, {
      method,
      headers: { Cookie: cookie, ...(body ? JSON_HEADERS : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  }
  const room = async (number, extra = {}) => (await call('POST', '/api/rooms', { number, type: 'Standard', capacity: 2, rate: 100, ...extra })).body;
  const guest = async (name = 'Test Guest') => (await call('POST', '/api/guests', { name })).body;
  const book = (roomId, guestId, checkIn, checkOut, extra = {}) =>
    call('POST', '/api/bookings', { roomId, guestId, checkIn, checkOut, adults: 2, ...extra });

  try {
    await fn({ call, base, cookie, dir, file, room, guest, book });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('a stay from booking to payment, and the dashboard that follows it', async () => {
  await withApp(async ({ call, room, guest, book }) => {
    const r = await room('101', { rate: 100 });
    assert.equal(r.status, 'Active');
    const g = await guest('Alice Guest');

    const created = await book(r.id, g.id, day(10), day(13)); // three nights, rate left blank
    assert.equal(created.status, 201);
    const b = created.body;
    assert.equal(b.nightlyRate, 100); // defaulted to the room's rate
    assert.equal(b.nights, 3);
    assert.equal(b.total, 300);
    assert.equal(b.status, 'Confirmed');
    assert.equal(b.guestName, 'Alice Guest');
    assert.equal(b.roomNumber, '101');

    const today = `?today=${day(10)}`;
    assert.equal((await call('GET', `/api/rooms/${r.id}${today}`)).body.today, 'Reserved');

    assert.equal((await call('POST', `/api/bookings/${b.id}/status`, { status: 'Checked in' })).body.status, 'Checked in');
    assert.equal((await call('GET', `/api/rooms/${r.id}${today}`)).body.today, 'Occupied');

    assert.equal((await call('POST', '/api/payments', { bookingId: b.id, date: day(10), amount: 120 })).status, 201);
    const priced = (await call('GET', `/api/bookings/${b.id}`)).body;
    assert.equal(priced.paid, 120);
    assert.equal(priced.balance, 180);

    const dash = (await call('GET', `/api/dashboard${today}`)).body;
    assert.equal(dash.today, day(10));
    assert.equal(dash.activeRooms, 1);
    assert.equal(dash.occupiedTonight, 1);
    assert.equal(dash.occupancyRate, 100);
    assert.equal(dash.inHouseGuests, 2);
    assert.equal(dash.revenueThisMonth, 120);
    assert.equal(dash.outstanding, 180);
    assert.equal(dash.arrivals.length, 1);
    assert.equal(dash.departures.length, 0);
    assert.equal(dash.forecast.length, 7);
    assert.equal(dash.forecast[2].occupied, 1); // the night of the 12th
    assert.equal(dash.forecast[3].occupied, 0); // the 13th is check-out day: the room is free that night

    const leaving = (await call('GET', `/api/dashboard?today=${day(13)}`)).body;
    assert.equal(leaving.departures.length, 1);
    assert.equal(leaving.occupiedTonight, 0);
  });
});

test('validation rejects bad input', async () => {
  await withApp(async ({ call, room, guest }) => {
    const r = await room('1');
    const g = await guest();
    const cases = [
      ['/api/rooms', {}, /Number is required/],
      ['/api/rooms', { number: '2', rate: 50, capacity: 0 }, /Capacity must be at least 1/],
      ['/api/rooms', { number: '2', rate: 50, capacity: 2.5 }, /Capacity must be a whole number/],
      ['/api/rooms', { number: '2', rate: -5 }, /Rate must be at least 0/],
      ['/api/guests', { name: 'X', email: 'nope' }, /valid email/],
      ['/api/bookings', { guestId: g.id, checkIn: day(1), checkOut: day(2) }, /Room is required/],
      ['/api/bookings', { roomId: 'missing', guestId: g.id, checkIn: day(1), checkOut: day(2) }, /Room does not exist/],
      ['/api/bookings', { roomId: r.id, guestId: g.id, checkIn: '2030-02-30', checkOut: day(2) }, /Check in must be a valid date/],
      ['/api/bookings', { roomId: r.id, guestId: g.id, checkIn: day(1), checkOut: day(2), adults: 0 }, /Adults must be at least 1/],
      ['/api/bookings', { roomId: r.id, guestId: g.id, checkIn: day(1), checkOut: day(2), status: 'Lost' }, /Status must be one of/],
      ['/api/payments', { bookingId: 'x', date: day(1), amount: 5 }, /Booking does not exist/],
    ];
    for (const [url, body, message] of cases) {
      const res = await call('POST', url, body);
      assert.equal(res.status, 400, `${url} ${JSON.stringify(body)}`);
      assert.match(res.body.error, message);
    }
  });
});

test('booking rules: overlaps, same-day turnover, dates, capacity, out-of-service rooms', async () => {
  await withApp(async ({ call, room, guest, book }) => {
    const r = await room('201', { capacity: 2 });
    const g = await guest();
    const first = await book(r.id, g.id, day(10), day(13));
    assert.equal(first.status, 201);

    const overlap = await book(r.id, g.id, day(12), day(14));
    assert.equal(overlap.status, 409);
    assert.match(overlap.body.error, /already booked from 2030-06-10 to 2030-06-13/);
    assert.equal((await book(r.id, g.id, day(8), day(11))).status, 409); // overlaps the start
    assert.equal((await book(r.id, g.id, day(11), day(12))).status, 409); // inside the stay

    // One guest leaves the morning the next arrives, and a stay may end the day another begins.
    assert.equal((await book(r.id, g.id, day(13), day(15))).status, 201);
    assert.equal((await book(r.id, g.id, day(8), day(10))).status, 201);

    assert.equal((await book(r.id, g.id, day(20), day(20))).status, 400); // no nights
    assert.equal((await book(r.id, g.id, day(22), day(20))).status, 400); // backwards
    assert.equal((await book(r.id, g.id, day(20), '2032-06-20')).status, 400); // longer than a year

    const crowded = await book(r.id, g.id, day(20), day(21), { adults: 2, children: 1 });
    assert.equal(crowded.status, 400);
    assert.match(crowded.body.error, /sleeps 2 at most/);

    // A cancelled booking frees the room; reinstating it needs the room to still be free.
    assert.equal((await call('POST', `/api/bookings/${first.body.id}/status`, { status: 'Cancelled' })).status, 200);
    const replacement = await book(r.id, g.id, day(11), day(12));
    assert.equal(replacement.status, 201);
    const reinstate = await call('POST', `/api/bookings/${first.body.id}/status`, { status: 'Confirmed' });
    assert.equal(reinstate.status, 409);

    const closed = await room('202', { status: 'Out of service' });
    const refused = await book(closed.id, g.id, day(10), day(11));
    assert.equal(refused.status, 409);
    assert.match(refused.body.error, /out of service/);

    assert.equal((await room('201')).error, 'Room 201 already exists');
  });
});

test('editing a booking re-checks the room, but an in-house stay survives its room closing', async () => {
  await withApp(async ({ call, room, guest, book }) => {
    const a = await room('301');
    const b = await room('302');
    const g = await guest();
    const one = (await book(a.id, g.id, day(10), day(12))).body;
    const two = (await book(a.id, g.id, day(12), day(14))).body;

    const moved = await call('PUT', `/api/bookings/${two.id}`, { ...two, checkIn: day(11) });
    assert.equal(moved.status, 409);
    assert.equal((await call('PUT', `/api/bookings/${two.id}`, { ...two, roomId: b.id, checkIn: day(11) })).status, 200);
    assert.equal((await call('PUT', `/api/bookings/${one.id}`, { ...one, nightlyRate: 80 })).body.total, 160);

    await call('POST', `/api/bookings/${one.id}/status`, { status: 'Checked in' });
    await call('PUT', `/api/rooms/${a.id}`, { ...a, status: 'Out of service' });
    const stillEditable = await call('PUT', `/api/bookings/${one.id}`, { ...(await call('GET', `/api/bookings/${one.id}`)).body, notes: 'Extra pillows' });
    assert.equal(stillEditable.status, 200);
    assert.equal(stillEditable.body.notes, 'Extra pillows');
  });
});

test('availability search honours dates, party size, status and the booking being edited', async () => {
  await withApp(async ({ call, room, guest, book }) => {
    const small = await room('401', { capacity: 2, rate: 90 });
    const big = await room('402', { capacity: 4, rate: 200 });
    await room('403', { status: 'Out of service' });
    const g = await guest();
    const held = (await book(small.id, g.id, day(10), day(13))).body;

    const ids = async (q) => (await call('GET', `/api/availability?${q}`)).body.rooms.map((r) => r.number);
    assert.deepEqual(await ids(`checkIn=${day(10)}&checkOut=${day(12)}&guests=1`), ['402']);
    assert.deepEqual(await ids(`checkIn=${day(13)}&checkOut=${day(15)}&guests=1`), ['401', '402']); // free on the check-out day
    assert.deepEqual(await ids(`checkIn=${day(13)}&checkOut=${day(15)}&guests=3`), ['402']);
    assert.deepEqual(await ids(`checkIn=${day(10)}&checkOut=${day(12)}&guests=1&exclude=${held.id}`), ['401', '402']);

    const priced = (await call('GET', `/api/availability?checkIn=${day(13)}&checkOut=${day(16)}&guests=1`)).body;
    assert.equal(priced.nights, 3);
    assert.equal(priced.rooms.find((r) => r.id === big.id).total, 600);

    for (const q of ['', `checkIn=${day(10)}`, `checkIn=${day(12)}&checkOut=${day(10)}`, `checkIn=bad&checkOut=${day(10)}`, `checkIn=${day(10)}&checkOut=${day(12)}&guests=0`]) {
      assert.equal((await call('GET', `/api/availability?${q}`)).status, 400, q);
    }
  });
});

test('booking status only moves along allowed steps', async () => {
  await withApp(async ({ call, room, guest, book }) => {
    const r = await room('501');
    const g = await guest();
    const b = (await book(r.id, g.id, day(10), day(12))).body;
    const move = async (status) => (await call('POST', `/api/bookings/${b.id}/status`, { status })).status;

    assert.equal(await move('Checked out'), 409); // must check in first
    assert.equal(await move('Lost'), 409);
    assert.equal(await move('Checked in'), 200);
    assert.equal(await move('Cancelled'), 409); // too late to cancel
    assert.equal(await move('Checked out'), 200);
    assert.equal(await move('Confirmed'), 409); // history is final
    assert.equal((await call('POST', '/api/bookings/nope/status', { status: 'Checked in' })).status, 404);
    assert.equal((await call('POST', `/api/rooms/${r.id}/status`, { status: 'Active' })).status, 404);
    assert.equal((await call('GET', `/api/bookings/${b.id}/status`)).status, 405);
  });
});

test('a new guest is saved together with their booking, or not at all', async () => {
  await withApp(async ({ call, room, guest, book }) => {
    const r = await room('601');
    const existing = await guest('Already Here');

    const ok = await call('POST', '/api/bookings', {
      roomId: r.id, checkIn: day(10), checkOut: day(12), adults: 2,
      newGuest: { name: 'Walk In', email: 'walk@example.com', phone: '555' },
    });
    assert.equal(ok.status, 201);
    assert.equal(ok.body.guestName, 'Walk In');
    let guests = (await call('GET', '/api/guests')).body;
    assert.deepEqual(guests.map((x) => x.name).sort(), ['Already Here', 'Walk In']);

    // The room is taken, so the booking fails and the new guest must not be left behind.
    const clash = await call('POST', '/api/bookings', { roomId: r.id, checkIn: day(11), checkOut: day(13), adults: 1, newGuest: { name: 'Ghost' } });
    assert.equal(clash.status, 409);
    const badGuest = await call('POST', '/api/bookings', { roomId: r.id, checkIn: day(20), checkOut: day(21), newGuest: { name: 'Bad', email: 'x' } });
    assert.equal(badGuest.status, 400);
    const noName = await call('POST', '/api/bookings', { roomId: r.id, checkIn: day(20), checkOut: day(21), newGuest: {} });
    assert.equal(noName.status, 400);
    assert.match(noName.body.error, /Name is required/);
    const both = await call('POST', '/api/bookings', { roomId: r.id, guestId: existing.id, checkIn: day(20), checkOut: day(21), newGuest: { name: 'Twice' } });
    assert.equal(both.status, 400);

    guests = (await call('GET', '/api/guests')).body;
    assert.deepEqual(guests.map((x) => x.name).sort(), ['Already Here', 'Walk In']);
    assert.equal((await call('GET', '/api/bookings')).body.length, 1);
    assert.ok(book);
  });
});

test('guests and rooms show what they are doing', async () => {
  await withApp(async ({ call, room, guest, book }) => {
    const r = await room('701');
    const g = await guest('Regular Guest');
    await book(r.id, g.id, day(10), day(12));
    const past = (await book(r.id, g.id, day(1), day(3))).body;
    await call('POST', `/api/bookings/${past.id}/status`, { status: 'Checked in' });
    await call('POST', `/api/bookings/${past.id}/status`, { status: 'Checked out' });

    const view = (await call('GET', `/api/guests/${g.id}?today=${day(5)}`)).body;
    assert.equal(view.stays, 2);
    assert.equal(view.nextArrival, day(10));
    assert.equal(view.lastVisit, day(3));
    assert.equal((await call('GET', `/api/rooms/${r.id}?today=${day(5)}`)).body.today, 'Vacant');
    assert.equal((await call('GET', `/api/rooms/${r.id}?today=${day(11)}`)).body.guestName, 'Regular Guest');
    assert.equal((await call('GET', `/api/rooms/${r.id}?today=not-a-date`)).status, 200); // bad "today" is ignored
  });
});

test('records cannot be deleted while others depend on them', async () => {
  await withApp(async ({ call, room, guest, book }) => {
    const r = await room('801');
    const g = await guest();
    const b = (await book(r.id, g.id, day(10), day(12))).body;
    const p = (await call('POST', '/api/payments', { bookingId: b.id, date: day(10), amount: 50 })).body;

    for (const url of [`/api/rooms/${r.id}`, `/api/guests/${g.id}`, `/api/bookings/${b.id}`]) {
      assert.equal((await call('DELETE', url)).status, 409, url);
    }
    assert.match((await call('DELETE', `/api/rooms/${r.id}`)).body.error, /1 booking still references it/);

    assert.equal((await call('DELETE', `/api/payments/${p.id}`)).status, 204);
    assert.equal((await call('DELETE', `/api/bookings/${b.id}`)).status, 204);
    assert.equal((await call('DELETE', `/api/rooms/${r.id}`)).status, 204);
    assert.equal((await call('DELETE', `/api/guests/${g.id}`)).status, 204);
    assert.equal((await call('GET', `/api/rooms/${r.id}`)).status, 404);
  });
});

test('records can be edited', async () => {
  await withApp(async ({ call, room }) => {
    const r = await room('901', { rate: 80 });
    const updated = await call('PUT', `/api/rooms/${r.id}`, { ...r, rate: 95, type: 'Deluxe', capacity: 3 });
    assert.equal(updated.body.rate, 95);
    assert.equal(updated.body.type, 'Deluxe');
    assert.equal(updated.body.id, r.id);
    assert.equal((await call('PUT', `/api/rooms/${r.id}`, { ...r, number: '' })).status, 400);
  });
});

test('data persists across restarts, and records from other versions are kept', async () => {
  const prepare = (file) =>
    fs.writeFileSync(file, JSON.stringify({ properties: [{ id: 'old', name: 'Rental from the earlier app' }], guests: [] }));
  await withApp(async ({ call, file, cookie }) => {
    await call('POST', '/api/guests', { name: 'Kept' });

    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.deepEqual(saved.guests.map((g) => g.name), ['Kept']);
    assert.deepEqual(saved.properties, [{ id: 'old', name: 'Rental from the earlier app' }]); // not dropped

    // A fresh process reads the same file, and the same signed cookie still works.
    const second = createServer(fileStorage(file));
    await new Promise((resolve) => second.listen(0, '127.0.0.1', resolve));
    const list = await (await fetch(`http://127.0.0.1:${second.address().port}/api/guests`, { headers: { Cookie: cookie } })).json();
    await new Promise((resolve) => second.close(resolve));
    assert.deepEqual(list.map((g) => g.name), ['Kept']);
  }, prepare);
});

test('request hardening', async () => {
  await withApp(async ({ call, base, cookie }) => {
    const raw = (body, headers) => fetch(`${base}/api/guests`, { method: 'POST', headers: { Cookie: cookie, ...headers }, body });

    assert.equal((await raw('{}', { 'Content-Type': 'text/plain' })).status, 415);
    assert.equal((await call('POST', '/api/guests', { name: 'Evil' }, { Origin: 'http://evil.example' })).status, 403);
    assert.equal((await raw(JSON.stringify({ name: 'x'.repeat(100_000) }), JSON_HEADERS)).status, 413);
    assert.equal((await raw('{nope', JSON_HEADERS)).status, 400);
    assert.equal((await call('GET', '/api/__proto__')).status, 404);
    assert.equal((await call('GET', '/api/nothing')).status, 404);
    assert.equal((await call('GET', '/api/rooms/a/b/c')).status, 404);
  });
});

test('static files are served and path traversal is refused', async () => {
  await withApp(async ({ base }) => {
    const index = await fetch(`${base}/`);
    assert.equal(index.status, 200);
    assert.match(await index.text(), /<title>Hotel PMS/);
    assert.match(index.headers.get('content-security-policy'), /default-src 'self'/);

    assert.equal((await fetch(`${base}/app.js`)).status, 200);
    assert.equal((await fetch(`${base}/missing.html`)).status, 404);
    assert.equal((await fetch(`${base}/..%2Fserver.js`)).status, 403);
    assert.equal((await fetch(`${base}/%2e%2e%2f%2e%2e%2fpackage.json`)).status, 403);
  });
});
