'use strict';

const crypto = require('node:crypto');
const { promisify } = require('node:util');
const { HttpError, sendJson, readJson, assertSameOrigin } = require('./http-utils');
const { createLock } = require('./storage');

const scrypt = promisify(crypto.scrypt);

const SESSION_COOKIE = 'pms_session';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_FAILURES = 5;
const LOCKOUT_MS = 15 * 60 * 1000;
const MAX_TRACKED_ADDRESSES = 500;
const USERNAME_RE = /^[A-Za-z0-9._-]{3,32}$/;
const MIN_PASSWORD = 8;
const MAX_PASSWORD = 128; // scrypt cost grows with input, so cap it

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
}

async function verifyPassword(password, stored) {
  const [scheme, saltHex, keyHex] = stored.split('$');
  if (scheme !== 'scrypt' || !saltHex || !keyHex) return false;
  const expected = Buffer.from(keyHex, 'hex');
  const actual = await scrypt(password, Buffer.from(saltHex, 'hex'), expected.length);
  return crypto.timingSafeEqual(actual, expected);
}

// Checked against when the username is unknown, so response time doesn't reveal which usernames exist.
const DUMMY_HASH = (() => {
  const salt = crypto.randomBytes(16);
  return `scrypt$${salt.toString('hex')}$${crypto.scryptSync('not-a-real-password', salt, 64).toString('hex')}`;
})();

// A session is a signed token carried in the cookie, so no server has to remember it:
//   base64url(JSON{ u: username, v: sessionVersion, e: expiry ms }) . base64url(HMAC-SHA256)
const hmac = (secret, body) => crypto.createHmac('sha256', secret).update(body).digest();

function signToken(secret, payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${hmac(secret, body).toString('base64url')}`;
}

function verifyToken(secret, token) {
  const [body, mac, extra] = token.split('.');
  if (!body || !mac || extra !== undefined) return null;
  const given = Buffer.from(mac, 'base64url');
  const expected = hmac(secret, body);
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    return payload && typeof payload === 'object' ? payload : null;
  } catch {
    return null;
  }
}

function readCookie(req, name) {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

// Behind Vercel the real client address arrives in X-Forwarded-For, which Vercel sets itself.
// Anywhere else that header is client-controlled, so only the socket address is trusted.
function clientAddress(req) {
  if (process.env.VERCEL) {
    const forwarded = String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim();
    if (forwarded) return forwarded;
  }
  return req.socket.remoteAddress ?? 'unknown';
}

function parseCredentials(body, { strict }) {
  const username = typeof body.username === 'string' ? body.username.trim() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  if (!username || !password) throw new HttpError(400, 'Enter your username and password');
  if (password.length > MAX_PASSWORD) throw new HttpError(400, `Password must be at most ${MAX_PASSWORD} characters`);
  if (strict) {
    if (!USERNAME_RE.test(username)) {
      throw new HttpError(400, 'Username must be 3–32 characters: letters, numbers, dot, dash or underscore');
    }
    if (password.length < MIN_PASSWORD) throw new HttpError(400, `Password must be at least ${MIN_PASSWORD} characters`);
  }
  return { username, password };
}

/**
 * Accounts are one stored document (kept apart from the property data):
 *   { users: [{ username, hash, createdAt, sessionVersion }], secret, failures: { address: { count, last, lockUntil } } }
 * `secret` signs session cookies. Signing out bumps the user's sessionVersion, which ends every session they have.
 * The document is read on each request, so any number of serverless instances can share it.
 */
function createAuth(storage) {
  const lock = createLock();

  async function loadDoc() {
    const raw = (await storage.read('users')) ?? {};
    return {
      users: Array.isArray(raw.users) ? raw.users : [],
      secret: typeof raw.secret === 'string' ? raw.secret : '',
      failures: raw.failures && typeof raw.failures === 'object' ? raw.failures : {},
    };
  }
  const saveDoc = (doc) => storage.write('users', doc);

  // Returns the signed-in user for this request, or null.
  function verifySession(doc, req) {
    const token = readCookie(req, SESSION_COOKIE);
    if (!token || !doc.secret) return null;
    const payload = verifyToken(doc.secret, token);
    if (!payload || typeof payload.u !== 'string' || typeof payload.e !== 'number' || payload.e < Date.now()) return null;
    const user = doc.users.find((u) => u.username === payload.u);
    return user && (user.sessionVersion ?? 0) === payload.v ? user : null;
  }

  function cookie(req, value, maxAgeSeconds) {
    const secure = req.socket.encrypted || req.headers['x-forwarded-proto'] === 'https';
    return `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSeconds}${secure ? '; Secure' : ''}`;
  }

  // Call before saving the document: makes sure there is a secret to sign with.
  function sessionCookie(req, doc, user) {
    if (!doc.secret) doc.secret = crypto.randomBytes(32).toString('hex');
    const token = signToken(doc.secret, { u: user.username, v: user.sessionVersion ?? 0, e: Date.now() + SESSION_TTL_MS });
    return cookie(req, token, SESSION_TTL_MS / 1000);
  }

  function assertNotLocked(doc, address) {
    const entry = doc.failures[address];
    if (entry && entry.lockUntil > Date.now()) {
      const minutes = Math.ceil((entry.lockUntil - Date.now()) / 60000);
      throw new HttpError(429, `Too many failed attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`);
    }
  }

  function recordFailure(doc, address) {
    const now = Date.now();
    for (const [key, e] of Object.entries(doc.failures)) if (now - e.last > LOCKOUT_MS) delete doc.failures[key];
    const oldestFirst = Object.entries(doc.failures).sort((a, b) => a[1].last - b[1].last);
    for (const [key] of oldestFirst.slice(0, Math.max(0, oldestFirst.length - MAX_TRACKED_ADDRESSES + 1))) delete doc.failures[key];

    const entry = doc.failures[address] ?? { count: 0, last: now, lockUntil: 0 };
    entry.count += 1;
    entry.last = now;
    if (entry.count >= MAX_FAILURES) entry.lockUntil = now + LOCKOUT_MS;
    doc.failures[address] = entry;
  }

  async function handle(req, res, action) {
    if (action === 'status' && req.method === 'GET') {
      const doc = await loadDoc();
      const user = verifySession(doc, req);
      return sendJson(res, 200, { setupRequired: doc.users.length === 0, user: user ? { username: user.username } : null });
    }
    if (!['setup', 'login', 'logout'].includes(action)) throw new HttpError(404, 'Not found');
    if (req.method !== 'POST') throw new HttpError(405, 'Method not allowed');
    assertSameOrigin(req);

    if (action === 'logout') {
      await lock(async () => {
        const doc = await loadDoc();
        const user = verifySession(doc, req);
        if (!user) return;
        user.sessionVersion = (user.sessionVersion ?? 0) + 1;
        await saveDoc(doc);
      });
      return sendJson(res, 200, { ok: true }, { 'Set-Cookie': cookie(req, '', 0) });
    }

    const { username, password } = parseCredentials(await readJson(req), { strict: action === 'setup' });
    const address = clientAddress(req);

    if (action === 'setup') {
      // The very first account is created here; after that, setup is closed.
      return lock(async () => {
        const doc = await loadDoc();
        if (doc.users.length > 0) throw new HttpError(409, 'An account already exists. Please sign in.');
        const user = { username, hash: await hashPassword(password), createdAt: new Date().toISOString(), sessionVersion: 0 };
        doc.users.push(user);
        const setCookie = sessionCookie(req, doc, user);
        await saveDoc(doc);
        return sendJson(res, 201, { user: { username } }, { 'Set-Cookie': setCookie });
      });
    }

    return lock(async () => {
      const doc = await loadDoc();
      assertNotLocked(doc, address);
      const user = doc.users.find((u) => u.username.toLowerCase() === username.toLowerCase());
      const ok = await verifyPassword(password, user ? user.hash : DUMMY_HASH);
      if (!user || !ok) {
        recordFailure(doc, address);
        await saveDoc(doc);
        throw new HttpError(401, 'Invalid username or password');
      }
      delete doc.failures[address];
      const setCookie = sessionCookie(req, doc, user);
      await saveDoc(doc);
      return sendJson(res, 200, { user: { username: user.username } }, { 'Set-Cookie': setCookie });
    });
  }

  async function requireUser(req) {
    // No cookie at all: refuse without touching the database.
    if (!readCookie(req, SESSION_COOKIE)) throw new HttpError(401, 'Please sign in');
    const user = verifySession(await loadDoc(), req);
    if (!user) throw new HttpError(401, 'Please sign in');
    return user.username;
  }

  return { handle, requireUser };
}

module.exports = { createAuth };
