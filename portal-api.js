'use strict';

// What a guest account can do, under /api/portal: look at rooms and services, reserve a room, request a
// service, ask a question, and see or cancel their own bookings and requests. A guest never sees
// another guest's records, the hotel's internal notes, or room numbers they have not been given.

const crypto = require('node:crypto');
const { HttpError, sendJson, readJson, assertSameOrigin } = require('./http-utils');
const {
  isDate,
  daysBetween,
  round2,
  todayFrom,
  clashingBooking,
  holdsRoom,
  validate,
  saveRecord,
  changeStatus,
  buildView,
} = require('./hotel');

const MAX_GUEST_STAY_NIGHTS = 30;
// Guests create accounts themselves, so each may only have so many things waiting on the hotel at once.
const LIMITS = { pendingBookings: 3, openServiceRequests: 10, openInquiries: 5 };

const byNumber = (a, b) => String(a.number).localeCompare(String(b.number), undefined, { numeric: true });
const newest = (a, b) => b.createdAt.localeCompare(a.createdAt);

// ---------------------------------------------------------------------------
// The guest's own record in the hotel's guest list. It is created the first time they ask for something.
// It is linked by account name, never by email: anyone can register with any email address.
// ---------------------------------------------------------------------------

const findGuest = (data, user) => data.guests.find((g) => g.account === user.username);

async function withGuest(store, user, fn) {
  const { data } = store;
  let guest = findGuest(data, user);
  const created = !guest;
  if (created) {
    const now = new Date().toISOString();
    guest = {
      id: crypto.randomUUID(),
      name: user.name || user.username,
      email: user.email,
      phone: user.phone,
      notes: '',
      account: user.username,
      createdAt: now,
      updatedAt: now,
    };
    data.guests.push(guest);
  }
  try {
    return await fn(guest);
  } catch (err) {
    if (created) data.guests = data.guests.filter((g) => g !== guest);
    throw err;
  }
}

function assertWithinLimit(count, limit, what) {
  if (count >= limit) throw new HttpError(429, `You already have ${limit} ${what} waiting for the hotel. Please wait for a reply or cancel one first.`);
}

function futureDate(value, label, today) {
  if (!isDate(value)) throw new HttpError(400, `${label} must be a valid date`);
  if (value < today) throw new HttpError(400, `${label} cannot be in the past`);
}

// ---------------------------------------------------------------------------
// Rooms: guests choose a kind of room, and the hotel assigns the room itself.
// ---------------------------------------------------------------------------

function parseStay(url, today) {
  const checkIn = url.searchParams.get('checkIn');
  const checkOut = url.searchParams.get('checkOut');
  if (!checkIn && !checkOut) return null; // just browsing
  futureDate(checkIn, 'Check-in', today);
  if (!isDate(checkOut)) throw new HttpError(400, 'Check-out must be a valid date');
  const nights = daysBetween(checkIn, checkOut);
  if (nights < 1) throw new HttpError(400, 'Check-out must be after check-in');
  if (nights > MAX_GUEST_STAY_NIGHTS) throw new HttpError(400, `Online stays can be at most ${MAX_GUEST_STAY_NIGHTS} nights. Please send an inquiry for a longer stay.`);
  const guests = Number(url.searchParams.get('guests') ?? 1);
  if (!Number.isInteger(guests) || guests < 1 || guests > 40) throw new HttpError(400, 'Guests must be a whole number from 1 to 40');
  return { checkIn, checkOut, guests, nights };
}

// Rooms that are alike (same type, capacity and rate) are shown once, with how many are free.
function roomGroups(data, stay) {
  const groups = new Map();
  for (const room of data.rooms.filter((r) => r.status === 'Active').sort(byNumber)) {
    if (stay && room.capacity < stay.guests) continue;
    const key = `${room.type}|${room.capacity}|${room.rate}`;
    let group = groups.get(key);
    if (!group) {
      group = { id: room.id, type: room.type, capacity: room.capacity, rate: room.rate, description: '', available: stay ? 0 : null };
      groups.set(key, group);
    }
    if (!group.description && room.description) group.description = room.description;
    if (stay && !clashingBooking(data, room.id, stay.checkIn, stay.checkOut)) group.available += 1;
  }
  return [...groups.values()].map((g) => ({ ...g, nights: stay?.nights ?? null, total: stay ? round2(g.rate * stay.nights) : null }));
}

async function reserve(store, user, body, today) {
  const { data } = store;
  const wanted = data.rooms.find((r) => r.id === body.roomId && r.status === 'Active');
  if (!wanted) throw new HttpError(400, 'Choose a room');
  if (!isDate(body.checkIn) || !isDate(body.checkOut)) throw new HttpError(400, 'Choose valid check-in and check-out dates');
  futureDate(body.checkIn, 'Check-in', today);
  if (daysBetween(body.checkIn, body.checkOut) > MAX_GUEST_STAY_NIGHTS) {
    throw new HttpError(400, `Online stays can be at most ${MAX_GUEST_STAY_NIGHTS} nights. Please send an inquiry for a longer stay.`);
  }

  return withGuest(store, user, async (guest) => {
    assertWithinLimit(
      data.bookings.filter((b) => b.guestId === guest.id && b.status === 'Pending').length,
      LIMITS.pendingBookings,
      'reservations',
    );
    // Check every field the way the hotel's own bookings are checked.
    const fields = validate(
      'bookings',
      { roomId: wanted.id, guestId: guest.id, checkIn: body.checkIn, checkOut: body.checkOut, adults: body.adults, children: body.children, status: 'Pending', guestNotes: body.notes },
      data,
    );
    const party = fields.adults + fields.children;
    if (party > wanted.capacity) throw new HttpError(400, `This kind of room sleeps ${wanted.capacity} at most, but you have ${party} guests.`);
    // Any free room that is just like the one shown will do.
    const room = data.rooms
      .filter((r) => r.status === 'Active' && r.type === wanted.type && r.capacity === wanted.capacity && r.rate === wanted.rate)
      .sort(byNumber)
      .find((r) => party <= r.capacity && !clashingBooking(data, r.id, fields.checkIn, fields.checkOut));
    if (!room) throw new HttpError(409, 'Sorry, that kind of room is no longer available for those dates.');

    return saveRecord(store, 'bookings', { ...fields, roomId: room.id, guestId: guest.id }, null, { source: 'Guest portal' });
  });
}

// ---------------------------------------------------------------------------
// What a guest sees of their own records (only these fields leave the server).
// ---------------------------------------------------------------------------

function bookingForGuest(view, b) {
  const v = view.bookingView(b);
  return {
    id: v.id,
    status: v.status,
    checkIn: v.checkIn,
    checkOut: v.checkOut,
    nights: v.nights,
    adults: v.adults,
    children: v.children,
    roomType: v.roomType,
    // The room number is given once the hotel has confirmed the booking.
    roomNumber: v.status === 'Pending' || v.status === 'Cancelled' ? '' : v.roomNumber,
    nightlyRate: v.nightlyRate,
    roomTotal: v.roomTotal,
    servicesTotal: v.servicesTotal,
    total: v.total,
    paid: v.paid,
    balance: v.balance,
    guestNotes: v.guestNotes,
    createdAt: v.createdAt,
    canCancel: v.status === 'Pending' || v.status === 'Confirmed',
  };
}

function serviceOrderForGuest(view, o) {
  const v = view.decorate('serviceOrders', o);
  return {
    id: v.id,
    serviceName: v.serviceName,
    serviceUnit: v.serviceUnit,
    date: v.date,
    quantity: v.quantity,
    unitPrice: v.unitPrice,
    total: v.total,
    status: v.status,
    notes: v.notes,
    stay: v.stay,
    createdAt: v.createdAt,
    canCancel: v.status === 'Requested' || v.status === 'Confirmed',
  };
}

const inquiryForGuest = (i) => ({
  id: i.id,
  topic: i.topic,
  subject: i.subject,
  message: i.message,
  roomType: i.roomType,
  serviceName: i.serviceName,
  checkIn: i.checkIn,
  checkOut: i.checkOut,
  status: i.status,
  reply: i.reply,
  repliedAt: i.repliedAt ?? null,
  createdAt: i.createdAt,
});

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

async function handlePortal(req, res, url, store, user) {
  let parts;
  try {
    parts = url.pathname.split('/').filter(Boolean).slice(2).map(decodeURIComponent);
  } catch {
    throw new HttpError(400, 'Bad request');
  }
  const [resource, id, action] = parts;
  const { method } = req;
  const { data } = store;
  const today = todayFrom(url);
  if (method !== 'GET') assertSameOrigin(req);

  const guest = findGuest(data, user);
  const mine = (collection) => (guest ? data[collection].filter((r) => r.guestId === guest.id) : []);
  const view = () => buildView(data, today);
  const only = (...allowed) => {
    if (!allowed.includes(method)) throw new HttpError(405, 'Method not allowed');
  };

  switch (resource) {
    case 'rooms':
      only('GET');
      return sendJson(res, 200, { rooms: roomGroups(data, parseStay(url, today)) });

    case 'services':
      only('GET');
      return sendJson(
        res,
        200,
        data.services
          .filter((s) => s.status === 'Available')
          .map((s) => ({ id: s.id, name: s.name, description: s.description, price: s.price, unit: s.unit }))
          .sort((a, b) => a.name.localeCompare(b.name)),
      );

    case 'bookings': {
      if (id === undefined) {
        only('GET', 'POST');
        if (method === 'GET') {
          const v = view();
          return sendJson(res, 200, mine('bookings').map((b) => bookingForGuest(v, b)).sort((a, b) => b.checkIn.localeCompare(a.checkIn)));
        }
        const record = await reserve(store, user, await readJson(req), today);
        return sendJson(res, 201, bookingForGuest(view(), record));
      }
      const record = mine('bookings').find((b) => b.id === id);
      if (!record) throw new HttpError(404, 'Booking not found');
      if (action !== 'cancel') throw new HttpError(404, 'Not found');
      only('POST');
      if (!holdsRoom(record) || record.status === 'Checked in') throw new HttpError(409, 'This booking can no longer be cancelled here. Please contact the hotel.');
      return sendJson(res, 200, bookingForGuest(view(), await changeStatus(store, 'bookings', record, { status: 'Cancelled' })));
    }

    case 'service-orders': {
      if (id === undefined) {
        only('GET', 'POST');
        if (method === 'GET') {
          const v = view();
          return sendJson(res, 200, mine('serviceOrders').map((o) => serviceOrderForGuest(v, o)).sort(newest));
        }
        const body = await readJson(req);
        const service = data.services.find((s) => s.id === body.serviceId && s.status === 'Available');
        if (!service) throw new HttpError(400, 'That service is not available');
        futureDate(body.date, 'Date', today);
        const record = await withGuest(store, user, async (g) => {
          assertWithinLimit(data.serviceOrders.filter((o) => o.guestId === g.id && o.status === 'Requested').length, LIMITS.openServiceRequests, 'service requests');
          const linked = body.bookingId ? data.bookings.find((b) => b.id === body.bookingId && b.guestId === g.id && holdsRoom(b)) : null;
          if (body.bookingId && !linked) throw new HttpError(400, 'Choose one of your own current bookings');
          return saveRecord(
            store,
            'serviceOrders',
            { guestId: g.id, serviceId: service.id, date: body.date, quantity: body.quantity, bookingId: linked?.id ?? '', notes: body.notes, status: 'Requested' },
            null,
          );
        });
        return sendJson(res, 201, serviceOrderForGuest(view(), record));
      }
      const record = mine('serviceOrders').find((o) => o.id === id);
      if (!record) throw new HttpError(404, 'Request not found');
      if (action !== 'cancel') throw new HttpError(404, 'Not found');
      only('POST');
      return sendJson(res, 200, serviceOrderForGuest(view(), await changeStatus(store, 'serviceOrders', record, { status: 'Cancelled' })));
    }

    case 'inquiries': {
      if (id !== undefined) throw new HttpError(404, 'Not found');
      only('GET', 'POST');
      if (method === 'GET') return sendJson(res, 200, mine('inquiries').map(inquiryForGuest).sort(newest));
      const body = await readJson(req);
      let serviceName = '';
      if (body.serviceId) {
        const service = data.services.find((s) => s.id === body.serviceId);
        if (!service) throw new HttpError(400, 'That service does not exist');
        serviceName = service.name;
      }
      const record = await withGuest(store, user, async (g) => {
        assertWithinLimit(data.inquiries.filter((i) => i.guestId === g.id && i.status === 'Open').length, LIMITS.openInquiries, 'questions');
        return saveRecord(
          store,
          'inquiries',
          {
            guestId: g.id,
            topic: body.topic,
            subject: body.subject,
            message: body.message,
            roomType: body.roomType,
            serviceName,
            checkIn: body.checkIn,
            checkOut: body.checkOut,
            status: 'Open',
          },
          null,
        );
      });
      return sendJson(res, 201, inquiryForGuest(record));
    }

    default:
      throw new HttpError(404, 'Not found');
  }
}

module.exports = { handlePortal };
