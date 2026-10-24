'use strict';

// Fills the data store with a demo hotel, with dates relative to today so the dashboard looks alive.
// Usage: npm run seed [-- --force]   (refuses to touch a store that already has records)
// It uses the same storage as the server: files by default, or Redis when KV_REST_API_URL/TOKEN are set.

const crypto = require('node:crypto');
const { createStore, localDate } = require('./server');
const { storageFromEnv } = require('./storage');

const shift = (days) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return localDate(d);
};

function fill(data) {
  const now = new Date().toISOString();
  const add = (collection, fields) => {
    const record = { id: crypto.randomUUID(), ...fields, createdAt: now, updatedAt: now };
    data[collection].push(record);
    return record.id;
  };

  const room = (number, type, capacity, rate, status = 'Active', description = '') =>
    add('rooms', { number, type, capacity, rate, status, description });
  const r101 = room('101', 'Standard', 2, 95, 'Active', 'Queen bed, garden view.');
  const r102 = room('102', 'Standard', 2, 95);
  const r103 = room('103', 'Twin', 2, 105, 'Active', 'Two single beds.');
  room('104', 'Twin', 2, 105, 'Out of service', 'Air conditioning being repaired.');
  const r105 = room('105', 'Deluxe', 3, 145, 'Active', 'King bed, balcony, sofa bed.');
  const r106 = room('106', 'Deluxe', 3, 145, 'Active', 'King bed, balcony.');
  const r201 = room('201', 'Standard', 2, 99);
  const r202 = room('202', 'Twin', 2, 109);
  const r203 = room('203', 'Deluxe', 3, 155, 'Active', 'King bed, city view.');
  const r204 = room('204', 'Family', 5, 185, 'Active', 'Two double beds and a sofa bed.');
  const r205 = room('205', 'Family', 5, 185);
  const r301 = room('301', 'Suite', 4, 279, 'Active', 'Top-floor suite with lounge and sea view.');

  const guest = (name, email, phone, notes = '') => add('guests', { name, email, phone, notes });
  const alice = guest('Alice Johnson', 'alice.johnson@example.com', '555-0101', 'Prefers a quiet room.');
  const ben = guest('Ben Carter', 'ben.carter@example.com', '555-0102');
  const chloe = guest('Chloe Nguyen', 'chloe.nguyen@example.com', '555-0103', 'Travelling with two children.');
  const diego = guest('Diego Ramirez', 'diego.ramirez@example.com', '555-0104');
  const emma = guest('Emma Wilson', 'emma.wilson@example.com', '555-0105');
  const farid = guest('Farid Haddad', 'farid.haddad@example.com', '555-0106', 'Late arrival expected.');
  const grace = guest('Grace Okafor', 'grace.okafor@example.com', '555-0107');
  const hiro = guest('Hiro Tanaka', 'hiro.tanaka@example.com', '555-0108');
  const isabel = guest('Isabel Rossi', 'isabel.rossi@example.com', '555-0109');
  const jonas = guest('Jonas Berg', 'jonas.berg@example.com', '555-0110');

  // booking(room, guest, first night offset from today, nights, status, adults, children, rate, notes, extra)
  const booking = (roomId, guestId, from, nights, status, adults = 2, children = 0, rate = null, notes = '', extra = {}) => {
    const rooms = data.rooms;
    const nightlyRate = rate ?? rooms.find((r) => r.id === roomId).rate;
    return add('bookings', { roomId, guestId, checkIn: shift(from), checkOut: shift(from + nights), adults, children, nightlyRate, status, guestNotes: '', notes, ...extra });
  };

  // In the house now
  const bAlice = booking(r101, alice, -2, 4, 'Checked in');
  const bBen = booking(r105, ben, -1, 3, 'Checked in', 2, 1);
  const bChloe = booking(r204, chloe, -3, 5, 'Checked in', 2, 2);
  // Leaving today
  const bDiego = booking(r102, diego, -3, 3, 'Checked in', 1);
  const bEmma = booking(r202, emma, -2, 2, 'Checked in');
  // Arriving today
  const bFarid = booking(r103, farid, 0, 2, 'Confirmed', 2, 0, null, 'Late arrival, after 10pm.');
  const bGrace = booking(r301, grace, 0, 3, 'Confirmed', 2, 0, 259, 'Anniversary: champagne on arrival.');
  // Coming up
  const bHiro = booking(r101, hiro, 3, 2, 'Confirmed', 1);
  booking(r105, isabel, 4, 2, 'Confirmed');
  const bJonas = booking(r203, jonas, 1, 4, 'Confirmed', 2);
  booking(r204, alice, 6, 3, 'Confirmed', 3, 1);
  booking(r301, ben, 8, 2, 'Confirmed');
  booking(r106, chloe, 2, 3, 'Confirmed', 2);
  // Past stays
  const bPastDiego = booking(r106, diego, -8, 3, 'Checked out');
  const bPastEmma = booking(r201, emma, -6, 2, 'Checked out');
  const bPastFarid = booking(r103, farid, -10, 4, 'Checked out');
  const bPastGrace = booking(r205, grace, -7, 3, 'Checked out', 3, 1);
  // Cancelled
  const bCancelled = booking(r102, hiro, 1, 2, 'Cancelled', 1, 0, null, 'Cancelled by guest, deposit kept.');

  const pay = (bookingId, daysAgo, amount, method = 'Card', note = '') =>
    add('payments', { bookingId, date: shift(-daysAgo), amount, method, note });
  pay(bAlice, 5, 100, 'Online', 'Deposit');
  pay(bAlice, 2, 150, 'Card', 'Paid at check-in');
  pay(bBen, 6, 200, 'Online', 'Deposit');
  pay(bChloe, 10, 400, 'Bank transfer', 'Deposit');
  pay(bChloe, 3, 300, 'Card', 'Paid at check-in');
  pay(bDiego, 6, 100, 'Online', 'Deposit');
  pay(bEmma, 2, 218, 'Card', 'Paid in full at check-in');
  pay(bFarid, 4, 50, 'Online', 'Deposit');
  pay(bGrace, 9, 200, 'Bank transfer', 'Deposit');
  pay(bHiro, 1, 50, 'Online', 'Deposit');
  pay(bJonas, 2, 150, 'Card', 'Deposit');
  pay(bPastDiego, 5, 435, 'Card', 'Paid in full');
  pay(bPastEmma, 4, 198, 'Cash', 'Paid in full');
  pay(bPastFarid, 6, 300, 'Card', 'Balance still owed');
  pay(bPastGrace, 4, 555, 'Card', 'Paid in full');
  pay(bCancelled, 3, 60, 'Online', 'Deposit kept after cancellation');

  // A reservation a guest sent from their own account, waiting for the management to confirm it.
  booking(r201, emma, 4, 2, 'Pending', 2, 0, null, '', { source: 'Guest portal', guestNotes: 'A quiet room away from the lift, please.' });

  // Services the hotel offers, and what guests have asked for.
  const service = (name, description, price, unit, status = 'Available') => add('services', { name, description, price, unit, status });
  const breakfast = service('Breakfast', 'Buffet breakfast served from 7 to 10.', 12, 'person');
  const pickup = service('Airport pickup', 'A private car meets you at arrivals.', 35, 'trip');
  const spa = service('Spa massage', 'Sixty minutes with a licensed therapist. Booking ahead is recommended.', 65, 'session');
  const laundry = service('Laundry', 'Washed, dried and folded within 24 hours.', 15, 'bag');
  service('Late check-out', 'Keep your room until 4pm.', 25, 'room', 'Unavailable');

  const order = (guestId, serviceId, from, quantity, price, status, bookingId = null, notes = '') =>
    add('serviceOrders', { guestId, serviceId, date: shift(from), quantity, unitPrice: price, bookingId, status, notes });
  order(alice, breakfast, -1, 4, 12, 'Confirmed', bAlice, 'Two breakfasts each morning.');
  order(ben, pickup, 2, 1, 35, 'Requested', bBen, 'Flight arrives 18:40.');
  order(chloe, spa, 1, 2, 65, 'Requested', null, 'For two adults, late afternoon.');
  order(grace, pickup, 0, 1, 35, 'Confirmed', bGrace);
  order(emma, laundry, -1, 1, 15, 'Completed', bEmma);

  // Questions guests have sent, one of them already answered.
  const inquiry = (guestId, topic, subject, message, extra = {}) =>
    add('inquiries', { guestId, topic, subject, message, roomType: null, serviceName: '', checkIn: null, checkOut: null, status: 'Open', reply: '', ...extra });
  inquiry(isabel, 'General', 'Parking for a van', 'Is there parking for a camper van, and is there a height limit?');
  inquiry(jonas, 'Room', 'Suite for an anniversary', 'We would like a suite for our anniversary. Is one free that weekend?', {
    roomType: 'Suite',
    checkIn: shift(8),
    checkOut: shift(10),
  });
  inquiry(hiro, 'Service', 'Spa opening hours', 'What time does the spa open, and can we book a couple’s massage?', {
    serviceName: 'Spa massage',
    status: 'Answered',
    reply: 'The spa is open from 10 to 8. A couple’s massage is possible; just request it under Services and we will confirm a time.',
    repliedAt: new Date().toISOString(),
  });

  // Safety net for the demo data: no room may be held by two bookings on the same night.
  const holding = data.bookings.filter((b) => b.status === 'Pending' || b.status === 'Confirmed' || b.status === 'Checked in');
  for (const a of holding) {
    for (const b of holding) {
      if (a.id < b.id && a.roomId === b.roomId && a.checkIn < b.checkOut && b.checkIn < a.checkOut) {
        throw new Error('Demo data has overlapping bookings; fix seed.js');
      }
    }
  }
}

async function main() {
  const storage = storageFromEnv();
  const store = createStore(storage);
  await store.load();

  const { data } = store;
  if (Object.values(data).some((list) => list.length > 0) && !process.argv.includes('--force')) {
    console.error(`${storage.description} already has records. Re-run with --force to replace them.`);
    process.exit(1);
  }
  for (const key of Object.keys(data)) data[key] = [];

  fill(data);
  await store.save();
  const counts = Object.entries(data).map(([k, v]) => `${v.length} ${k}`).join(', ');
  console.log(`Seeded ${storage.description}: ${counts}`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
