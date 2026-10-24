'use strict';

// What guests can do for themselves, and what the management then sees and answers.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createServer } = require('../server');
const { fileStorage } = require('../storage');

const JSON_HEADERS = { 'Content-Type': 'application/json' };
const day = (n) => `2030-06-${String(n).padStart(2, '0')}`; // far in the future, so "not in the past" always holds

async function withHotel(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pms-portal-'));
  const server = createServer(fileStorage(path.join(dir, 'db.json')));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  const auth = (action, body) => fetch(`${base}/api/auth/${action}`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(body) });
  const caller = (cookie) => async (method, url, body) => {
    const res = await fetch(base + url, {
      method,
      headers: { Cookie: cookie, ...(body ? JSON_HEADERS : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };

  const setup = await auth('setup', { username: 'manager', password: 'a long manager password' });
  const manager = caller(setup.headers.getSetCookie()[0].split(';')[0]);
  const guest = async (username, name = `${username} Guest`) => {
    const res = await auth('register', { username, password: 'a long guest password', name, email: `${username}@example.com`, phone: '555' });
    assert.equal(res.status, 201);
    return caller(res.headers.getSetCookie()[0].split(';')[0]);
  };
  const room = async (number, extra = {}) =>
    (await manager('POST', '/api/rooms', { number, type: 'Standard', capacity: 2, rate: 100, ...extra })).body;

  try {
    await fn({ manager, guest, room });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const stay = (roomId, extra = {}) => ({ roomId, checkIn: day(10), checkOut: day(13), adults: 2, children: 0, ...extra });

test('guests browse kinds of room, and see what is free for their dates', async () => {
  await withHotel(async ({ guest, room }) => {
    await room('101');
    await room('102');
    await room('301', { type: 'Suite', capacity: 4, rate: 300, description: 'Sea view.' });
    await room('104', { type: 'Twin', status: 'Out of service' });
    const gina = await guest('gina');

    const browse = (await gina('GET', '/api/portal/rooms')).body.rooms;
    assert.deepEqual(browse.map((r) => r.type).sort(), ['Standard', 'Suite']); // like rooms are shown once, closed rooms not at all
    assert.ok(browse.every((r) => r.available === null && r.total === null));
    assert.ok(browse.every((r) => !('number' in r) && !('status' in r)), 'room numbers stay private');
    assert.equal(browse.find((r) => r.type === 'Suite').description, 'Sea view.');

    const dated = (await gina('GET', `/api/portal/rooms?checkIn=${day(10)}&checkOut=${day(13)}&guests=2`)).body.rooms;
    const standard = dated.find((r) => r.type === 'Standard');
    assert.equal(standard.available, 2);
    assert.equal(standard.nights, 3);
    assert.equal(standard.total, 300);
    assert.equal(dated.find((r) => r.type === 'Suite').available, 1);

    const big = (await gina('GET', `/api/portal/rooms?checkIn=${day(10)}&checkOut=${day(13)}&guests=3`)).body.rooms;
    assert.deepEqual(big.map((r) => r.type), ['Suite']);

    const bad = (q) => gina('GET', `/api/portal/rooms?${q}`);
    assert.equal((await bad(`checkIn=${day(13)}&checkOut=${day(10)}`)).status, 400);
    assert.equal((await bad(`checkIn=${day(10)}&checkOut=${day(10)}`)).status, 400);
    assert.equal((await bad(`checkIn=2030-06-01&checkOut=2030-08-01`)).status, 400); // over 30 nights online
    assert.equal((await bad(`checkIn=${day(10)}&checkOut=${day(12)}&guests=0`)).status, 400);
    const past = await bad(`checkIn=2030-06-10&checkOut=2030-06-12&today=2030-06-11`);
    assert.equal(past.status, 400);
    assert.match(past.body.error, /cannot be in the past/);
  });
});

test('a reservation is pending, takes any free room of that kind, and holds it', async () => {
  await withHotel(async ({ manager, guest, room }) => {
    const first = await room('101');
    await room('102');
    const gina = await guest('gina', 'Gina Guest');
    const hugo = await guest('hugo', 'Hugo Guest');

    const made = await gina('POST', '/api/portal/bookings', stay(first.id, { notes: 'Quiet floor please', status: 'Confirmed', nightlyRate: 1, source: 'Staff' }));
    assert.equal(made.status, 201);
    assert.equal(made.body.status, 'Pending'); // not confirmed by the guest
    assert.equal(made.body.nightlyRate, 100); // priced by the hotel, not by the guest
    assert.equal(made.body.total, 300);
    assert.equal(made.body.roomNumber, ''); // not told until confirmed
    assert.equal(made.body.canCancel, true);

    // The hotel sees it, with the guest's own details and where it came from.
    const seen = (await manager('GET', '/api/bookings')).body;
    assert.equal(seen.length, 1);
    assert.equal(seen[0].source, 'Guest portal');
    assert.equal(seen[0].guestName, 'Gina Guest');
    assert.equal(seen[0].roomNumber, '101');
    assert.equal(seen[0].guestNotes, 'Quiet floor please');

    // Another guest asking for the same kind of room gets the other one; then none are left.
    const second = await hugo('POST', '/api/portal/bookings', stay(first.id));
    assert.equal(second.status, 201);
    assert.equal((await manager('GET', '/api/bookings')).body.find((b) => b.guestName === 'Hugo Guest').roomNumber, '102');
    const sold = await guest('ivy');
    const refused = await sold('POST', '/api/portal/bookings', stay(first.id));
    assert.equal(refused.status, 409);
    assert.match(refused.body.error, /no longer available/);
    assert.equal((await manager('GET', '/api/guests')).body.some((g) => g.name === 'ivy Guest'), false, 'a failed reservation leaves no guest record behind');

    const rooms = (await gina('GET', `/api/portal/rooms?checkIn=${day(10)}&checkOut=${day(13)}&guests=2`)).body.rooms;
    assert.equal(rooms[0].available, 0);

    // Once the hotel confirms, the guest is told the room.
    await manager('POST', `/api/bookings/${made.body.id}/status`, { status: 'Confirmed' });
    const mine = (await gina('GET', '/api/portal/bookings')).body;
    assert.equal(mine.length, 1);
    assert.equal(mine[0].status, 'Confirmed');
    assert.equal(mine[0].roomNumber, '101');
    assert.ok(!('notes' in mine[0]) && !('guestId' in mine[0]) && !('source' in mine[0]), 'internal fields stay private');
  });
});

test('guests can only reserve within sensible limits', async () => {
  await withHotel(async ({ guest, room }) => {
    const r = await room('101');
    const gina = await guest('gina');
    const reserve = (extra) => gina('POST', '/api/portal/bookings', { ...stay(r.id), ...extra });

    const past = await reserve({ checkIn: '2030-06-10', checkOut: '2030-06-12', today: '2030-06-11' });
    assert.equal(past.status, 201); // a body cannot set "today"; only the query can
    assert.equal((await gina('POST', '/api/portal/bookings?today=2030-06-11', stay(r.id, { checkIn: day(10), checkOut: day(12) }))).status, 400);

    assert.equal((await reserve({ roomId: 'nope' })).status, 400);
    assert.equal((await reserve({ checkOut: day(10) })).status, 400);
    assert.equal((await reserve({ checkIn: '2030-06-01', checkOut: '2030-08-01' })).status, 400);
    assert.equal((await reserve({ adults: 0 })).status, 400);
    const crowded = await reserve({ adults: 2, children: 1, checkIn: day(20), checkOut: day(21) });
    assert.equal(crowded.status, 400);
    assert.match(crowded.body.error, /sleeps 2 at most/);
  });
});

test('a guest can have only a few reservations waiting at once', async () => {
  await withHotel(async ({ guest, room }) => {
    const r = await room('101');
    await room('102');
    await room('103');
    await room('104');
    const gina = await guest('gina');
    for (let i = 0; i < 3; i += 1) {
      assert.equal((await gina('POST', '/api/portal/bookings', stay(r.id, { checkIn: day(10 + i * 3), checkOut: day(12 + i * 3) }))).status, 201);
    }
    const fourth = await gina('POST', '/api/portal/bookings', stay(r.id, { checkIn: day(25), checkOut: day(26) }));
    assert.equal(fourth.status, 429);
    assert.match(fourth.body.error, /3 reservations/);
  });
});

test('guests cancel their own bookings until they check in, and nobody else can', async () => {
  await withHotel(async ({ manager, guest, room }) => {
    const r = await room('101');
    const gina = await guest('gina');
    const hugo = await guest('hugo');
    const booking = (await gina('POST', '/api/portal/bookings', stay(r.id))).body;

    assert.equal((await hugo('POST', `/api/portal/bookings/${booking.id}/cancel`)).status, 404); // not Hugo's
    assert.equal((await hugo('GET', '/api/portal/bookings')).body.length, 0);

    const cancelled = await gina('POST', `/api/portal/bookings/${booking.id}/cancel`);
    assert.equal(cancelled.status, 200);
    assert.equal(cancelled.body.status, 'Cancelled');
    assert.equal(cancelled.body.canCancel, false);
    assert.equal((await gina('POST', `/api/portal/bookings/${booking.id}/cancel`)).status, 409); // already cancelled
    assert.equal((await gina('GET', `/api/portal/rooms?checkIn=${day(10)}&checkOut=${day(13)}`)).body.rooms[0].available, 1); // room is free again

    const again = (await gina('POST', '/api/portal/bookings', stay(r.id))).body;
    await manager('POST', `/api/bookings/${again.id}/status`, { status: 'Confirmed' });
    await manager('POST', `/api/bookings/${again.id}/status`, { status: 'Checked in' });
    assert.equal((await gina('POST', `/api/portal/bookings/${again.id}/cancel`)).status, 409); // staying now: ask the hotel
  });
});

test('guests request services; the management confirms, and confirmed services join the bill', async () => {
  await withHotel(async ({ manager, guest, room }) => {
    const r = await room('101');
    const pickup = (await manager('POST', '/api/services', { name: 'Airport pickup', description: 'Private car', price: 30, unit: 'per trip' })).body;
    const spa = (await manager('POST', '/api/services', { name: 'Spa', price: 80, status: 'Unavailable' })).body;
    const gina = await guest('gina');
    const hugo = await guest('hugo');
    const stayId = (await gina('POST', '/api/portal/bookings', stay(r.id))).body.id;

    const catalog = (await gina('GET', '/api/portal/services')).body;
    assert.deepEqual(catalog.map((s) => s.name), ['Airport pickup']); // unavailable services are not offered
    assert.ok(!('status' in catalog[0]));

    const ask = (body, who = gina) => who('POST', '/api/portal/service-orders', { serviceId: pickup.id, date: day(10), quantity: 2, ...body });
    const made = await ask({ bookingId: stayId, notes: 'Flight BA123' });
    assert.equal(made.status, 201);
    assert.equal(made.body.status, 'Requested');
    assert.equal(made.body.unitPrice, 30);
    assert.equal(made.body.total, 60);

    assert.equal((await ask({ serviceId: spa.id })).status, 400); // unavailable
    assert.equal((await ask({ serviceId: 'nope' })).status, 400);
    assert.equal((await ask({ date: '2020-01-01' })).status, 400); // in the past
    assert.equal((await ask({ quantity: 0 })).status, 400);
    assert.equal((await ask({ bookingId: stayId }, hugo)).status, 400); // someone else's stay
    assert.equal((await hugo('GET', '/api/portal/service-orders')).body.length, 0);
    assert.equal((await hugo('POST', `/api/portal/service-orders/${made.body.id}/cancel`)).status, 404);

    // Not charged until the hotel agrees.
    assert.equal((await manager('GET', `/api/bookings/${stayId}`)).body.servicesTotal, 0);
    const orders = (await manager('GET', '/api/serviceOrders')).body;
    assert.equal(orders[0].guestName, 'gina Guest');
    assert.equal(orders[0].serviceName, 'Airport pickup');
    await manager('POST', `/api/serviceOrders/${made.body.id}/status`, { status: 'Confirmed' });

    const bill = (await manager('GET', `/api/bookings/${stayId}`)).body;
    assert.equal(bill.servicesTotal, 60);
    assert.equal(bill.total, 360); // 3 nights at 100, plus the pickup
    assert.equal((await gina('GET', '/api/portal/bookings')).body[0].total, 360);
    assert.equal((await gina('GET', '/api/portal/service-orders')).body[0].status, 'Confirmed');

    const cancelled = await gina('POST', `/api/portal/service-orders/${made.body.id}/cancel`);
    assert.equal(cancelled.body.status, 'Cancelled');
    assert.equal((await manager('GET', `/api/bookings/${stayId}`)).body.servicesTotal, 0); // no longer charged
  });
});

test('guests send questions and read the management reply', async () => {
  await withHotel(async ({ manager, guest }) => {
    const spa = (await manager('POST', '/api/services', { name: 'Spa', price: 80 })).body;
    const gina = await guest('gina');
    const hugo = await guest('hugo');

    const room = await gina('POST', '/api/portal/inquiries', {
      topic: 'Room', subject: 'Suite for a wedding', message: 'Is the suite free in June?', roomType: 'Suite', checkIn: day(10), checkOut: day(13), status: 'Closed', reply: 'forged',
    });
    assert.equal(room.status, 201);
    assert.equal(room.body.status, 'Open'); // a guest cannot close or answer their own question
    assert.equal(room.body.reply, '');
    const service = await gina('POST', '/api/portal/inquiries', { topic: 'Service', subject: 'Spa hours', message: 'When does the spa open?', serviceId: spa.id });
    assert.equal(service.body.serviceName, 'Spa');

    for (const body of [
      { subject: 'No message' },
      { message: 'No subject' },
      { topic: 'Gossip', subject: 's', message: 'm' },
      { subject: 's', message: 'm', roomType: 'Castle' },
      { subject: 's', message: 'm', serviceId: 'nope' },
      { subject: 's', message: 'x'.repeat(2001) },
      { subject: 's', message: 'm', checkIn: day(13), checkOut: day(10) },
    ]) {
      assert.equal((await gina('POST', '/api/portal/inquiries', body)).status, 400, JSON.stringify(body).slice(0, 60));
    }

    // The hotel sees them, with who asked.
    const inbox = (await manager('GET', '/api/inquiries')).body;
    assert.equal(inbox.length, 2);
    assert.ok(inbox.every((i) => i.guestName === 'gina Guest' && i.status === 'Open'));
    assert.equal((await manager('GET', '/api/dashboard')).body.requests.inquiries, 2);

    const noReply = await manager('POST', `/api/inquiries/${room.body.id}/reply`, { reply: '   ' });
    assert.equal(noReply.status, 400);
    const answered = await manager('POST', `/api/inquiries/${room.body.id}/reply`, { reply: 'Yes, the suite is free. We have held it for you.' });
    assert.equal(answered.status, 200);
    assert.equal(answered.body.status, 'Answered');
    assert.equal((await manager('GET', '/api/dashboard')).body.requests.inquiries, 1);

    const mine = (await gina('GET', '/api/portal/inquiries')).body.find((i) => i.id === room.body.id);
    assert.equal(mine.status, 'Answered');
    assert.match(mine.reply, /held it for you/);
    assert.ok(mine.repliedAt);
    assert.equal((await hugo('GET', '/api/portal/inquiries')).body.length, 0);
    assert.equal((await manager('POST', `/api/inquiries/${room.body.id}/status`, { status: 'Closed' })).status, 200);
  });
});

test('a guest can have only a few questions open at once', async () => {
  await withHotel(async ({ guest }) => {
    const gina = await guest('gina');
    for (let i = 0; i < 5; i += 1) {
      assert.equal((await gina('POST', '/api/portal/inquiries', { subject: `Q${i}`, message: 'Hello' })).status, 201);
    }
    assert.equal((await gina('POST', '/api/portal/inquiries', { subject: 'Q6', message: 'Hello' })).status, 429);
  });
});

test('a guest account is never linked to a guest the hotel already knows, even with the same email', async () => {
  await withHotel(async ({ manager, guest, room }) => {
    const r = await room('101');
    const known = (await manager('POST', '/api/guests', { name: 'Known Guest', email: 'gina@example.com' })).body;
    await manager('POST', '/api/bookings', { roomId: r.id, guestId: known.id, checkIn: day(20), checkOut: day(22), adults: 1 });

    const gina = await guest('gina'); // registers with gina@example.com
    assert.equal((await gina('GET', '/api/portal/bookings')).body.length, 0, 'sees nothing that belongs to the earlier guest');
    await gina('POST', '/api/portal/bookings', stay(r.id));

    const guests = (await manager('GET', '/api/guests')).body;
    assert.equal(guests.length, 2);
    assert.equal(guests.find((g) => g.name === 'gina Guest').hasAccount, true);
    assert.equal(guests.find((g) => g.name === 'Known Guest').hasAccount, false);
    assert.equal((await gina('GET', '/api/portal/bookings')).body.length, 1);
  });
});

test('a guest\'s pulse follows only their own records, so the page can say what the hotel did', async () => {
  await withHotel(async ({ manager, guest, room }) => {
    const apart = () => new Promise((resolve) => setTimeout(resolve, 5)); // records are stamped to the millisecond
    const r = await room('101');
    const spa = (await manager('POST', '/api/services', { name: 'Spa', price: 80 })).body;
    const gina = await guest('gina');
    const hugo = await guest('hugo');
    const pulse = async (who) => (await who('GET', '/api/portal/pulse')).body;

    const empty = await pulse(gina);
    assert.deepEqual([empty.bookings, empty.serviceOrders, empty.inquiries], [{}, {}, {}]);

    await apart();
    const booking = (await gina('POST', '/api/portal/bookings', stay(r.id))).body;
    const order = (await gina('POST', '/api/portal/service-orders', { serviceId: spa.id, date: day(11), quantity: 1, bookingId: booking.id })).body;
    const question = (await gina('POST', '/api/portal/inquiries', { subject: 'Late arrival', message: 'Is that fine?' })).body;
    const hugoBefore = await pulse(hugo);
    const waiting = await pulse(gina);
    assert.notEqual(waiting.version, empty.version);
    assert.deepEqual(waiting.bookings, { [booking.id]: 'Pending' });
    assert.deepEqual(waiting.serviceOrders, { [order.id]: 'Requested' });
    assert.deepEqual(waiting.inquiries, { [question.id]: 'Open' });

    // The hotel answers; the guest's reading shows each new status.
    await apart();
    await manager('POST', `/api/bookings/${booking.id}/status`, { status: 'Confirmed' });
    await manager('POST', `/api/serviceOrders/${order.id}/status`, { status: 'Declined' });
    await manager('POST', `/api/inquiries/${question.id}/reply`, { reply: 'Yes, any time.' });
    const answered = await pulse(gina);
    assert.notEqual(answered.version, waiting.version);
    assert.deepEqual(answered.bookings, { [booking.id]: 'Confirmed' });
    assert.deepEqual(answered.serviceOrders, { [order.id]: 'Declined' });
    assert.deepEqual(answered.inquiries, { [question.id]: 'Answered' });

    // A payment on their booking is something to show them too.
    await apart();
    const paid = await manager('POST', '/api/payments', { bookingId: booking.id, date: day(1), amount: 50 });
    assert.equal(paid.status, 201);
    assert.notEqual((await pulse(gina)).version, answered.version);

    // None of it is visible to another guest.
    assert.deepEqual(await pulse(hugo), hugoBefore);
  });
});

test('pending reservations are flagged for the management and can be confirmed or declined', async () => {
  await withHotel(async ({ manager, guest, room }) => {
    const r = await room('101');
    await room('102');
    const gina = await guest('gina');
    const a = (await gina('POST', '/api/portal/bookings', stay(r.id))).body;
    const b = (await gina('POST', '/api/portal/bookings', stay(r.id, { checkIn: day(20), checkOut: day(21) }))).body;

    const dash = (await manager('GET', `/api/dashboard?today=${day(1)}`)).body;
    assert.equal(dash.requests.bookings, 2);
    assert.deepEqual(dash.pendingBookings.map((x) => x.id), [a.id, b.id]); // soonest stay first
    assert.equal(dash.arrivals.length, 0); // a pending booking is not yet an arrival

    assert.equal((await manager('POST', `/api/bookings/${a.id}/status`, { status: 'Confirmed' })).status, 200);
    assert.equal((await manager('POST', `/api/bookings/${b.id}/status`, { status: 'Cancelled' })).status, 200);
    assert.equal((await manager('GET', '/api/dashboard')).body.requests.bookings, 0);
    assert.equal((await gina('GET', '/api/portal/bookings')).body.find((x) => x.id === b.id).status, 'Cancelled');
  });
});
