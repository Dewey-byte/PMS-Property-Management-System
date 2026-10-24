'use strict';

// Two kinds of account: the hotel's management, and guests who sign themselves up.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createServer } = require('../server');
const { fileStorage } = require('../storage');

const JSON_HEADERS = { 'Content-Type': 'application/json' };
const MANAGER = { username: 'Manager', password: 'a long manager password' };
const GINA = { username: 'gina', password: 'a long guest password', name: 'Gina Guest', email: 'gina@example.com', phone: '555-0100' };

async function withApp(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pms-roles-'));
  const dataFile = path.join(dir, 'db.json');
  const server = createServer(fileStorage(dataFile));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (action, body, headers = {}) =>
    fetch(`${base}/api/auth/${action}`, { method: 'POST', headers: { ...JSON_HEADERS, ...headers }, body: JSON.stringify(body) });
  const cookieOf = (res) => ({ Cookie: res.headers.getSetCookie()[0].split(';')[0] });
  const status = (url, headers) => fetch(base + url, { headers }).then((r) => r.status);
  try {
    await fn({ base, post, cookieOf, status, dataFile });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('guests can sign up only after the hotel has a management account', async () => {
  await withApp(async ({ post }) => {
    const early = await post('register', GINA);
    assert.equal(early.status, 409);
    assert.match((await early.json()).error, /not been set up/);

    assert.equal((await post('setup', MANAGER)).status, 201);
    assert.equal((await post('register', GINA)).status, 201);
  });
});

test('sign-up checks the details and keeps usernames unique', async () => {
  await withApp(async ({ post }) => {
    await post('setup', MANAGER);
    const bad = [
      [{ ...GINA, name: '' }, /Enter your name/],
      [{ ...GINA, email: 'nope' }, /valid email/],
      [{ ...GINA, email: '' }, /valid email/],
      [{ ...GINA, password: 'short' }, /at least 8 characters/],
      [{ ...GINA, username: 'x y' }, /Username must be/],
      [{ ...GINA, name: 'n'.repeat(101) }, /at most 100/],
    ];
    for (const [body, message] of bad) {
      const res = await post('register', body);
      assert.equal(res.status, 400, JSON.stringify(body));
      assert.match((await res.json()).error, message);
    }

    assert.equal((await post('register', GINA)).status, 201);
    assert.equal((await post('register', { ...GINA, username: 'GINA' })).status, 409); // another guest's name
    assert.equal((await post('register', { ...GINA, username: 'manager' })).status, 409); // the management's name
  });
});

test('a guest account is a guest, whatever the sign-up asks for, and stores no plain password', async () => {
  await withApp(async ({ post, base, cookieOf, dataFile }) => {
    await post('setup', MANAGER);
    const res = await post('register', { ...GINA, role: 'management' });
    assert.equal(res.status, 201);
    assert.deepEqual((await res.json()).user, { username: 'gina', role: 'guest', name: 'Gina Guest' });

    const status = await (await fetch(`${base}/api/auth/status`, { headers: cookieOf(res) })).json();
    assert.equal(status.user.role, 'guest');

    const stored = fs.readFileSync(dataFile.replace(/\.json$/, '.users.json'), 'utf8');
    assert.ok(!stored.includes(GINA.password));
    assert.match(stored, /"role": "guest"/);
  });
});

test('each kind of account reaches only its own part of the API', async () => {
  await withApp(async ({ post, cookieOf, status }) => {
    const manager = cookieOf(await post('setup', MANAGER));
    const guest = cookieOf(await post('register', GINA));

    // Management
    assert.equal(await status('/api/rooms', manager), 200);
    assert.equal(await status('/api/dashboard', manager), 200);
    assert.equal(await status('/api/pulse', manager), 200);
    assert.equal(await status('/api/portal/rooms', manager), 403);
    assert.equal(await status('/api/portal/bookings', manager), 403);
    assert.equal(await status('/api/portal/pulse', manager), 403);

    // Guest
    assert.equal(await status('/api/portal/rooms', guest), 200);
    assert.equal(await status('/api/portal/bookings', guest), 200);
    assert.equal(await status('/api/portal/pulse', guest), 200);
    for (const url of ['/api/rooms', '/api/guests', '/api/bookings', '/api/payments', '/api/dashboard', '/api/pulse', '/api/services', '/api/inquiries', '/api/availability?checkIn=2030-01-01&checkOut=2030-01-02']) {
      assert.equal(await status(url, guest), 403, url);
    }

    // Nobody signed in
    assert.equal(await status('/api/portal/rooms'), 401);
    assert.equal(await status('/api/portal/pulse'), 401);
    assert.equal(await status('/api/rooms'), 401);
    assert.equal(await status('/api/pulse'), 401);
  });
});

test('a guest can sign in again and gets the guest role', async () => {
  await withApp(async ({ post }) => {
    await post('setup', MANAGER);
    await post('register', GINA);
    const login = await post('login', { username: 'GINA', password: GINA.password });
    assert.equal(login.status, 200);
    assert.equal((await login.json()).user.role, 'guest');
    assert.equal((await post('login', { username: 'gina', password: 'wrong password' })).status, 401);
  });
});

test('sign-ups from one address are limited', async () => {
  await withApp(async ({ post }) => {
    await post('setup', MANAGER);
    for (let i = 0; i < 5; i += 1) {
      assert.equal((await post('register', { ...GINA, username: `guest${i}` })).status, 201);
    }
    const sixth = await post('register', { ...GINA, username: 'guest5' });
    assert.equal(sixth.status, 429);
    assert.match((await sixth.json()).error, /Too many accounts/);
  });
});

test('accounts made before roles existed count as management', async () => {
  await withApp(async ({ post, cookieOf, status, dataFile }) => {
    const manager = cookieOf(await post('setup', MANAGER));
    const file = dataFile.replace(/\.json$/, '.users.json');
    const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
    for (const user of doc.users) delete user.role;
    fs.writeFileSync(file, JSON.stringify(doc));

    assert.equal(await status('/api/rooms', manager), 200);
    assert.equal(await status('/api/portal/rooms', manager), 403);
  });
});

test('sign-up refuses cross-site requests', async () => {
  await withApp(async ({ post }) => {
    await post('setup', MANAGER);
    assert.equal((await post('register', GINA, { Origin: 'http://evil.example' })).status, 403);
  });
});
