'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { promisify } = require('node:util');
const { HttpError, sendJson, readJson, assertSameOrigin } = require('./http-utils');

const scrypt = promisify(crypto.scrypt);

const SESSION_COOKIE = 'pms_session';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_FAILURES = 5;
const LOCKOUT_MS = 15 * 60 * 1000;
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

const digest = (token) => crypto.createHash('sha256').update(token).digest('hex');

function readCookie(req, name) {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
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
 * Accounts live in their own file (so the data file never holds password hashes).
 * Sessions are random tokens kept in memory; only their SHA-256 is stored, and they end on restart.
 */
function createAuth(usersFile) {
  let users = [];
  try {
    users = JSON.parse(fs.readFileSync(usersFile, 'utf8')).users ?? [];
  } catch (err) {
    if (err.code !== 'ENOENT') throw new Error(`Cannot read ${usersFile}: ${err.message}`);
  }

  const sessions = new Map(); // sha256(token) -> { username, expires }
  const failures = new Map(); // client address -> { count, last, lockUntil }

  function saveUsers() {
    fs.mkdirSync(path.dirname(usersFile), { recursive: true });
    const tmp = `${usersFile}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ users }, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, usersFile);
  }

  function userFor(req) {
    const token = readCookie(req, SESSION_COOKIE);
    if (!token) return null;
    const key = digest(token);
    const session = sessions.get(key);
    if (!session) return null;
    if (session.expires < Date.now()) {
      sessions.delete(key);
      return null;
    }
    return session.username;
  }

  const cookie = (req, value, maxAgeSeconds) => {
    const secure = req.socket.encrypted || req.headers['x-forwarded-proto'] === 'https';
    return `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSeconds}${secure ? '; Secure' : ''}`;
  };

  function startSession(req, username) {
    const now = Date.now();
    for (const [key, s] of sessions) if (s.expires < now) sessions.delete(key);
    const token = crypto.randomBytes(32).toString('hex');
    sessions.set(digest(token), { username, expires: now + SESSION_TTL_MS });
    return cookie(req, token, SESSION_TTL_MS / 1000);
  }

  function assertNotLocked(address) {
    const entry = failures.get(address);
    if (entry && entry.lockUntil > Date.now()) {
      const minutes = Math.ceil((entry.lockUntil - Date.now()) / 60000);
      throw new HttpError(429, `Too many failed attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`);
    }
  }

  function recordFailure(address) {
    const now = Date.now();
    if (failures.size > 500) for (const [key, e] of failures) if (now - e.last > LOCKOUT_MS) failures.delete(key);
    let entry = failures.get(address);
    if (!entry || now - entry.last > LOCKOUT_MS) entry = { count: 0, last: now, lockUntil: 0 };
    entry.count += 1;
    entry.last = now;
    if (entry.count >= MAX_FAILURES) entry.lockUntil = now + LOCKOUT_MS;
    failures.set(address, entry);
  }

  async function handle(req, res, action) {
    if (action === 'status' && req.method === 'GET') {
      const username = userFor(req);
      return sendJson(res, 200, { setupRequired: users.length === 0, user: username ? { username } : null });
    }
    if (!['setup', 'login', 'logout'].includes(action)) throw new HttpError(404, 'Not found');
    if (req.method !== 'POST') throw new HttpError(405, 'Method not allowed');
    assertSameOrigin(req);

    if (action === 'logout') {
      const token = readCookie(req, SESSION_COOKIE);
      if (token) sessions.delete(digest(token));
      return sendJson(res, 200, { ok: true }, { 'Set-Cookie': cookie(req, '', 0) });
    }

    const address = req.socket.remoteAddress ?? 'unknown';

    if (action === 'setup') {
      // The very first account is created here; after that, setup is closed.
      if (users.length > 0) throw new HttpError(409, 'An account already exists. Please sign in.');
      const { username, password } = parseCredentials(await readJson(req), { strict: true });
      const hash = await hashPassword(password);
      if (users.length > 0) throw new HttpError(409, 'An account already exists. Please sign in.');
      users.push({ username, hash, createdAt: new Date().toISOString() });
      saveUsers();
      return sendJson(res, 201, { user: { username } }, { 'Set-Cookie': startSession(req, username) });
    }

    assertNotLocked(address);
    const { username, password } = parseCredentials(await readJson(req), { strict: false });
    const user = users.find((u) => u.username.toLowerCase() === username.toLowerCase());
    const ok = await verifyPassword(password, user ? user.hash : DUMMY_HASH);
    if (!user || !ok) {
      recordFailure(address);
      throw new HttpError(401, 'Invalid username or password');
    }
    failures.delete(address);
    return sendJson(res, 200, { user: { username: user.username } }, { 'Set-Cookie': startSession(req, user.username) });
  }

  function requireUser(req) {
    const username = userFor(req);
    if (!username) throw new HttpError(401, 'Please sign in');
    return username;
  }

  return { handle, requireUser };
}

module.exports = { createAuth };
