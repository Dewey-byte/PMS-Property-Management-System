'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createServer, localDate } = require('../server');

let server;
let base;
let dir;

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pms-test-'));
  server = createServer(path.join(dir, 'db.json'));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(dir, { recursive: true, force: true });
});

async function call(method, url, body, headers = {}) {
  const res = await fetch(base + url, {
    method,
    headers: body ? { 'Content-Type': 'application/json', ...headers } : headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

const shift = (days) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return localDate(d);
};

test('full rental workflow and dashboard figures', async () => {
  const prop = (await call('POST', '/api/properties', { name: 'Test Court', address: '1 Test St' })).body;
  assert.equal(prop.type, 'Apartment');

  const unit = (await call('POST', '/api/units', { propertyId: prop.id, number: '101', rent: '1000' })).body;
  assert.equal(unit.rent, 1000);
  assert.equal(unit.occupancy, 'Vacant');

  const tenant = (await call('POST', '/api/tenants', { name: 'Tess Tenant', email: 'tess@example.com' })).body;
  const lease = await call('POST', '/api/leases', {
    unitId: unit.id, tenantId: tenant.id, startDate: shift(-30), endDate: shift(30), rent: 1000,
  });
  assert.equal(lease.status, 201);
  assert.equal(lease.body.label, 'Tess Tenant — Test Court · 101');

  assert.equal((await call('GET', `/api/units/${unit.id}`)).body.occupancy, 'Occupied');

  await call('POST', '/api/payments', { leaseId: lease.body.id, date: shift(0), period: localDate().slice(0, 7), amount: 400 });
  const dash = (await call('GET', '/api/dashboard')).body;
  assert.equal(dash.occupancyRate, 100);
  assert.equal(dash.monthlyRent, 1000);
  assert.equal(dash.collected, 400);
  assert.equal(dash.outstanding, 600);
  assert.equal(dash.rentRoll[0].status, 'Partial');
  assert.equal(dash.expiringLeases.length, 1);
});

test('validation rejects bad input', async () => {
  const cases = [
    ['/api/properties', {}, /Name is required/],
    ['/api/tenants', { name: 'X', email: 'nope' }, /valid email/],
    ['/api/units', { propertyId: 'missing', number: '1', rent: 5 }, /Property does not exist/],
    ['/api/payments', { leaseId: 'x', date: '2026-02-30', period: '2026-02', amount: 5 }, /Lease does not exist/],
  ];
  for (const [url, body, message] of cases) {
    const res = await call('POST', url, body);
    assert.equal(res.status, 400, url);
    assert.match(res.body.error, message);
  }
});

test('business rules: duplicate unit, overlapping lease, bad dates, referential integrity', async () => {
  const prop = (await call('POST', '/api/properties', { name: 'Rules Plaza', address: '2 Rule St' })).body;
  const unit = (await call('POST', '/api/units', { propertyId: prop.id, number: 'A', rent: 500 })).body;
  assert.equal((await call('POST', '/api/units', { propertyId: prop.id, number: 'a', rent: 500 })).status, 409);

  const t1 = (await call('POST', '/api/tenants', { name: 'One' })).body;
  const t2 = (await call('POST', '/api/tenants', { name: 'Two' })).body;
  const term = { unitId: unit.id, startDate: '2030-01-01', endDate: '2030-12-31', rent: 500 };

  const first = await call('POST', '/api/leases', { ...term, tenantId: t1.id });
  assert.equal(first.status, 201);
  assert.equal((await call('POST', '/api/leases', { ...term, tenantId: t2.id, startDate: '2030-06-01' })).status, 409);
  assert.equal((await call('POST', '/api/leases', { ...term, tenantId: t2.id, startDate: '2031-01-01', endDate: '2030-01-01' })).status, 400);

  // Ending the first lease frees the unit for a new one.
  await call('PUT', `/api/leases/${first.body.id}`, { ...term, tenantId: t1.id, status: 'Ended' });
  assert.equal((await call('POST', '/api/leases', { ...term, tenantId: t2.id })).status, 201);

  const blocked = await call('DELETE', `/api/properties/${prop.id}`);
  assert.equal(blocked.status, 409);
  assert.match(blocked.body.error, /1 unit still references it/);
  assert.equal((await call('DELETE', `/api/tenants/${t1.id}`)).status, 409);
});

test('records can be edited and deleted', async () => {
  const prop = (await call('POST', '/api/properties', { name: 'Old name', address: 'Somewhere' })).body;
  const updated = await call('PUT', `/api/properties/${prop.id}`, { name: 'New name', address: 'Somewhere' });
  assert.equal(updated.body.name, 'New name');
  assert.equal(updated.body.id, prop.id);
  assert.equal((await call('DELETE', `/api/properties/${prop.id}`)).status, 204);
  assert.equal((await call('GET', `/api/properties/${prop.id}`)).status, 404);
});

test('maintenance unit must belong to the chosen property', async () => {
  const a = (await call('POST', '/api/properties', { name: 'A', address: 'a' })).body;
  const b = (await call('POST', '/api/properties', { name: 'B', address: 'b' })).body;
  const unitB = (await call('POST', '/api/units', { propertyId: b.id, number: '1', rent: 1 })).body;
  const res = await call('POST', '/api/maintenance', { propertyId: a.id, unitId: unitB.id, title: 'Leak' });
  assert.equal(res.status, 400);
  const ok = await call('POST', '/api/maintenance', { propertyId: a.id, title: 'Leak' });
  assert.equal(ok.status, 201);
  assert.equal(ok.body.status, 'Open');
  assert.equal(ok.body.reportedDate, localDate());
});

test('data persists across restarts', async () => {
  const file = path.join(dir, 'persist.json');
  const first = createServer(file);
  await new Promise((resolve) => first.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${first.address().port}/api/properties`;
  await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Kept', address: 'x' }) });
  await new Promise((resolve) => first.close(resolve));

  const second = createServer(file);
  await new Promise((resolve) => second.listen(0, '127.0.0.1', resolve));
  const list = await (await fetch(`http://127.0.0.1:${second.address().port}/api/properties`)).json();
  await new Promise((resolve) => second.close(resolve));
  assert.deepEqual(list.map((p) => p.name), ['Kept']);
});

test('request hardening', async () => {
  const wrongType = await fetch(`${base}/api/properties`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{}' });
  assert.equal(wrongType.status, 415);

  const crossOrigin = await call('POST', '/api/properties', { name: 'Evil', address: 'x' }, { Origin: 'http://evil.example' });
  assert.equal(crossOrigin.status, 403);

  const huge = await fetch(`${base}/api/properties`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'x'.repeat(100_000) }) });
  assert.equal(huge.status, 413);

  const badJson = await fetch(`${base}/api/properties`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{nope' });
  assert.equal(badJson.status, 400);

  assert.equal((await call('GET', '/api/__proto__')).status, 404);
  assert.equal((await call('GET', '/api/nothing')).status, 404);
});

test('static files are served and path traversal is refused', async () => {
  const index = await fetch(`${base}/`);
  assert.equal(index.status, 200);
  assert.match(await index.text(), /<title>PMS/);
  assert.match(index.headers.get('content-security-policy'), /default-src 'self'/);

  assert.equal((await fetch(`${base}/app.js`)).status, 200);
  assert.equal((await fetch(`${base}/missing.html`)).status, 404);
  assert.equal((await fetch(`${base}/..%2Fserver.js`)).status, 403);
  assert.equal((await fetch(`${base}/%2e%2e%2f%2e%2e%2fpackage.json`)).status, 403);
});
