'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createServer } = require('../server');
const { fileStorage } = require('../storage');

const JSON_HEADERS = { 'Content-Type': 'application/json' };
const ALICE = { username: 'Alice', password: 'correct horse battery' };

// Each test gets its own server and data directory, so lockouts and accounts never leak between tests.
async function withServer(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pms-auth-'));
  const dataFile = path.join(dir, 'db.json');
  const server = createServer(fileStorage(dataFile));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (action, body, headers = {}) =>
    fetch(`${base}/api/auth/${action}`, { method: 'POST', headers: { ...JSON_HEADERS, ...headers }, body: JSON.stringify(body) });
  try {
    await fn({ base, post, dir, dataFile });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const sessionCookie = (res) => res.headers.getSetCookie()[0];
const cookieHeader = (res) => ({ Cookie: sessionCookie(res).split(';')[0] });

test('the API requires a session, but the page itself does not', async () => {
  await withServer(async ({ base }) => {
    for (const url of ['/api/properties', '/api/dashboard', '/api/nothing']) {
      assert.equal((await fetch(base + url)).status, 401, url);
    }
    assert.equal((await fetch(`${base}/api/properties`, { method: 'POST', headers: JSON_HEADERS, body: '{}' })).status, 401);
    assert.equal((await fetch(`${base}/`)).status, 200);

    const status = await (await fetch(`${base}/api/auth/status`)).json();
    assert.deepEqual(status, { setupRequired: true, user: null });
  });
});

test('first-run setup creates the account, signs in, and then closes', async () => {
  await withServer(async ({ base, post, dataFile }) => {
    assert.equal((await post('setup', { username: 'ab', password: ALICE.password })).status, 400);
    assert.equal((await post('setup', { username: 'bad name!', password: ALICE.password })).status, 400);
    assert.equal((await post('setup', { username: ALICE.username, password: 'short' })).status, 400);

    const res = await post('setup', ALICE);
    assert.equal(res.status, 201);
    const cookie = sessionCookie(res);
    assert.match(cookie, /^pms_session=[\w-]+\.[\w-]+;/);
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Strict/);

    const headers = cookieHeader(res);
    assert.equal((await fetch(`${base}/api/properties`, { headers })).status, 200);
    const status = await (await fetch(`${base}/api/auth/status`, { headers })).json();
    assert.deepEqual(status, { setupRequired: false, user: { username: 'Alice' } });

    assert.equal((await post('setup', { username: 'mallory', password: 'another password' })).status, 409);

    // The password is stored only as a salted hash, in a file separate from the data.
    const stored = fs.readFileSync(dataFile.replace(/\.json$/, '.users.json'), 'utf8');
    assert.match(stored, /scrypt\$/);
    assert.ok(!stored.includes(ALICE.password));
  });
});

test('login accepts the right password and rejects the wrong one with one generic message', async () => {
  await withServer(async ({ base, post }) => {
    await post('setup', ALICE);

    const wrongPassword = await post('login', { username: 'alice', password: 'not the password' });
    const wrongUser = await post('login', { username: 'nobody', password: ALICE.password });
    assert.equal(wrongPassword.status, 401);
    assert.equal(wrongUser.status, 401);
    assert.deepEqual(await wrongPassword.json(), await wrongUser.json());

    const ok = await post('login', { username: 'ALICE', password: ALICE.password }); // names are case-insensitive
    assert.equal(ok.status, 200);
    assert.equal((await ok.json()).user.username, 'Alice');
    assert.equal((await fetch(`${base}/api/dashboard`, { headers: cookieHeader(ok) })).status, 200);

    assert.equal((await post('login', {})).status, 400);
    assert.equal((await fetch(`${base}/api/auth/login`, { method: 'GET' })).status, 405);
  });
});

test('logout ends the session on the server, not just in the browser', async () => {
  await withServer(async ({ base, post }) => {
    const headers = cookieHeader(await post('setup', ALICE));
    const out = await post('logout', {}, headers);
    assert.equal(out.status, 200);
    assert.match(sessionCookie(out), /Max-Age=0/);
    assert.equal((await fetch(`${base}/api/properties`, { headers })).status, 401);
  });
});

test('signing out ends every session for the account', async () => {
  await withServer(async ({ base, post }) => {
    const laptop = cookieHeader(await post('setup', ALICE));
    const phone = cookieHeader(await post('login', ALICE));
    assert.equal((await fetch(`${base}/api/properties`, { headers: laptop })).status, 200);
    assert.equal((await fetch(`${base}/api/properties`, { headers: phone })).status, 200);

    await post('logout', {}, phone);
    assert.equal((await fetch(`${base}/api/properties`, { headers: laptop })).status, 401);

    // Signing in again works and gets a working session.
    const again = cookieHeader(await post('login', ALICE));
    assert.equal((await fetch(`${base}/api/properties`, { headers: again })).status, 200);
  });
});

test('forged, tampered and expired session cookies are rejected', async () => {
  await withServer(async ({ base, post, dataFile }) => {
    const res = await post('setup', ALICE);
    const token = sessionCookie(res).split(';')[0].slice('pms_session='.length);
    const [body, mac] = token.split('.');
    const status = (cookie) => fetch(`${base}/api/properties`, { headers: { Cookie: `pms_session=${cookie}` } }).then((r) => r.status);

    assert.equal(await status(token), 200);
    assert.equal(await status(`${body}.${mac.slice(0, -2)}AA`), 401); // signature altered
    assert.equal(await status(`${body}x.${mac}`), 401); // payload altered
    assert.equal(await status(body), 401); // signature missing
    assert.equal(await status('garbage'), 401);

    // Signed with the wrong key, or correctly signed but already past its expiry.
    const sign = (secret, payload) => {
      const b = Buffer.from(JSON.stringify(payload)).toString('base64url');
      return `${b}.${crypto.createHmac('sha256', secret).update(b).digest('base64url')}`;
    };
    const live = { u: 'Alice', v: 0, e: Date.now() + 60_000 };
    assert.equal(await status(sign('not the secret', live)), 401);

    const { secret } = JSON.parse(fs.readFileSync(dataFile.replace(/\.json$/, '.users.json'), 'utf8'));
    assert.equal(await status(sign(secret, live)), 200);
    assert.equal(await status(sign(secret, { ...live, e: Date.now() - 1 })), 401);
    assert.equal(await status(sign(secret, { ...live, u: 'Mallory' })), 401);
  });
});

test('repeated failed logins lock the address out, even for the right password', async () => {
  await withServer(async ({ post }) => {
    await post('setup', ALICE);
    for (let i = 0; i < 5; i += 1) {
      assert.equal((await post('login', { username: 'alice', password: `wrong ${i}` })).status, 401);
    }
    const locked = await post('login', ALICE);
    assert.equal(locked.status, 429);
    assert.match((await locked.json()).error, /Too many failed attempts/);
  });
});

test('a successful login resets the failure count', async () => {
  await withServer(async ({ post }) => {
    await post('setup', ALICE);
    for (let i = 0; i < 4; i += 1) await post('login', { username: 'alice', password: `wrong ${i}` });
    assert.equal((await post('login', ALICE)).status, 200);
    for (let i = 0; i < 4; i += 1) assert.equal((await post('login', { username: 'alice', password: `wrong ${i}` })).status, 401);
    assert.equal((await post('login', ALICE)).status, 200);
  });
});

test('auth endpoints refuse cross-site and non-JSON requests', async () => {
  await withServer(async ({ base, post }) => {
    assert.equal((await post('setup', ALICE, { Origin: 'http://evil.example' })).status, 403);
    assert.equal((await post('setup', ALICE)).status, 201);
    assert.equal((await post('login', ALICE, { Origin: 'http://evil.example' })).status, 403);

    const res = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{}' });
    assert.equal(res.status, 415);
  });
});
