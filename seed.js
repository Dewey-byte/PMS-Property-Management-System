'use strict';

// Fills the data store with demo records, with dates relative to today so the dashboard looks alive.
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
const month = (offset) => {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() + offset);
  return localDate(d).slice(0, 7);
};

function fill(data) {
  const now = new Date().toISOString();
  const add = (collection, fields) => {
    const record = { id: crypto.randomUUID(), ...fields, createdAt: now, updatedAt: now };
    data[collection].push(record);
    return record.id;
  };

  const maple = add('properties', { name: 'Maple Court', address: '14 Maple Street, Springfield', type: 'Apartment', notes: 'Six-unit building, shared laundry in the basement.' });
  const river = add('properties', { name: 'Riverside Duplex', address: '88 River Road, Springfield', type: 'House', notes: '' });
  const oak = add('properties', { name: 'Oak Street House', address: '3 Oak Street, Springfield', type: 'House', notes: 'Detached, with garage.' });

  const unit = (propertyId, number, bedrooms, bathrooms, rent) => add('units', { propertyId, number, bedrooms, bathrooms, rent });
  const m101 = unit(maple, '101', 1, 1, 950);
  const m102 = unit(maple, '102', 1, 1, 975);
  const m201 = unit(maple, '201', 2, 1, 1250);
  unit(maple, '202', 2, 1.5, 1325);
  const m301 = unit(maple, '301', 3, 2, 1650);
  const rA = unit(river, 'A', 2, 1, 1400);
  const rB = unit(river, 'B', 2, 1, 1400);
  const o1 = unit(oak, 'Main', 4, 2.5, 2100);

  const tenant = (name, email, phone) => add('tenants', { name, email, phone, notes: '' });
  const alice = tenant('Alice Johnson', 'alice.johnson@example.com', '555-0101');
  const ben = tenant('Ben Carter', 'ben.carter@example.com', '555-0102');
  const chloe = tenant('Chloe Nguyen', 'chloe.nguyen@example.com', '555-0103');
  const diego = tenant('Diego Ramirez', 'diego.ramirez@example.com', '555-0104');
  const emma = tenant('Emma Wilson', 'emma.wilson@example.com', '555-0105');
  const farid = tenant('Farid Haddad', 'farid.haddad@example.com', '555-0106');

  const lease = (unitId, tenantId, startDate, endDate, rent, status = 'Active') =>
    add('leases', { unitId, tenantId, startDate, endDate, rent, deposit: rent, status });
  const lAlice = lease(m101, alice, shift(-200), shift(165), 950);
  const lBen = lease(m102, ben, shift(-340), shift(25), 975);
  const lChloe = lease(m201, chloe, shift(-120), shift(245), 1250);
  const lDiego = lease(m301, diego, shift(-400), shift(-5), 1650); // lapsed but never closed out
  const lEmma = lease(rA, emma, shift(-60), shift(305), 1400);
  lease(rB, farid, shift(-500), shift(-135), 1350, 'Ended');
  lease(o1, farid, shift(-30), shift(335), 2100);

  const pay = (leaseId, offset, amount, method = 'Bank transfer') => {
    const period = month(offset);
    add('payments', { leaseId, date: `${period}-0${offset === 0 ? 3 : 4}`, period, amount, method, note: '' });
  };
  for (const [id, rent] of [[lAlice, 950], [lBen, 975], [lChloe, 1250], [lDiego, 1650], [lEmma, 1400]]) pay(id, -1, rent);
  pay(lAlice, 0, 950);
  pay(lChloe, 0, 1250, 'Check');
  pay(lEmma, 0, 700, 'Cash'); // partial this month

  const request = (propertyId, unitId, title, priority, status, daysAgo, cost, description) =>
    add('maintenance', { propertyId, unitId, title, description, priority, status, reportedDate: shift(-daysAgo), cost });
  request(maple, m201, 'Kitchen faucet leaking', 'High', 'Open', 3, 0, 'Steady drip under the sink; tenant has placed a bucket.');
  request(maple, null, 'Basement laundry dryer not heating', 'Medium', 'In Progress', 9, 0, 'Technician booked for later this week.');
  request(river, rB, 'No hot water', 'Urgent', 'Open', 1, 0, 'Water heater pilot will not stay lit.');
  request(oak, o1, 'Replace smoke detector batteries', 'Low', 'Resolved', 20, 18.5, '');
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
