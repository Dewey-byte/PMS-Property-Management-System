'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { createAuth } = require('./auth');
const { storageFromEnv, createLock } = require('./storage');
const { HttpError, SECURITY_HEADERS, sendJson, readJson, assertSameOrigin } = require('./http-utils');
const hotel = require('./hotel');
const { handlePortal } = require('./portal-api');

const {
  COLLECTIONS,
  STATUS_MOVES,
  MAX_STAY_NIGHTS,
  isDate,
  daysBetween,
  todayFrom,
  createStore,
  saveRecord,
  removeRecord,
  createBooking,
  changeStatus,
  replyToInquiry,
  availableRooms,
  buildView,
  localDate,
} = hotel;

const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

// ---------------------------------------------------------------------------
// Management API: everything the hotel's own staff can do (/api/...)
// ---------------------------------------------------------------------------

function parseAvailabilityQuery(url) {
  const checkIn = url.searchParams.get('checkIn');
  const checkOut = url.searchParams.get('checkOut');
  if (!isDate(checkIn) || !isDate(checkOut)) throw new HttpError(400, 'Choose valid check-in and check-out dates');
  const nights = daysBetween(checkIn, checkOut);
  if (nights < 1) throw new HttpError(400, 'Check-out must be after check-in');
  if (nights > MAX_STAY_NIGHTS) throw new HttpError(400, `A stay can be at most ${MAX_STAY_NIGHTS} nights`);
  const guests = Number(url.searchParams.get('guests') ?? 1);
  if (!Number.isInteger(guests) || guests < 1 || guests > 40) throw new HttpError(400, 'Guests must be a whole number from 1 to 40');
  return { checkIn, checkOut, guests, nights, excludeId: url.searchParams.get('exclude') || undefined };
}

async function handleApi(req, res, url, store) {
  let parts;
  try {
    parts = url.pathname.split('/').filter(Boolean).slice(1).map(decodeURIComponent);
  } catch {
    throw new HttpError(400, 'Bad request');
  }
  const { method } = req;
  const { data } = store;
  const today = todayFrom(url);
  if (method !== 'GET') assertSameOrigin(req);

  if (parts[0] === 'dashboard' && parts.length === 1) {
    if (method !== 'GET') throw new HttpError(405, 'Method not allowed');
    return sendJson(res, 200, buildView(data, today).dashboard());
  }

  if (parts[0] === 'availability' && parts.length === 1) {
    if (method !== 'GET') throw new HttpError(405, 'Method not allowed');
    const query = parseAvailabilityQuery(url);
    return sendJson(res, 200, { nights: query.nights, rooms: availableRooms(data, query) });
  }

  const [collection, id, action] = parts;
  if (!COLLECTIONS.includes(collection) || parts.length > 3) throw new HttpError(404, 'Not found');
  const present = (record) => buildView(data, today).decorate(collection, record);

  if (id === undefined) {
    if (method === 'GET') {
      const view = buildView(data, today);
      return sendJson(res, 200, data[collection].map((r) => view.decorate(collection, r)));
    }
    if (method === 'POST') {
      const body = await readJson(req);
      const record = collection === 'bookings' ? await createBooking(store, body) : await saveRecord(store, collection, body, null);
      return sendJson(res, 201, present(record));
    }
    throw new HttpError(405, 'Method not allowed');
  }

  const record = data[collection].find((r) => r.id === id);
  if (!record) throw new HttpError(404, 'Record not found');

  if (action !== undefined) {
    const isStatus = action === 'status' && STATUS_MOVES[collection];
    const isReply = action === 'reply' && collection === 'inquiries';
    if (!isStatus && !isReply) throw new HttpError(404, 'Not found');
    if (method !== 'POST') throw new HttpError(405, 'Method not allowed');
    const body = await readJson(req);
    const changed = isStatus ? await changeStatus(store, collection, record, body) : await replyToInquiry(store, record, body);
    return sendJson(res, 200, present(changed));
  }

  if (method === 'GET') return sendJson(res, 200, present(record));
  if (method === 'PUT') return sendJson(res, 200, present(await saveRecord(store, collection, await readJson(req), record)));
  if (method === 'DELETE') {
    await removeRecord(store, collection, record);
    res.writeHead(204, { 'Cache-Control': 'no-store', ...SECURITY_HEADERS });
    return res.end();
  }
  throw new HttpError(405, 'Method not allowed');
}

// ---------------------------------------------------------------------------
// Browser files
// ---------------------------------------------------------------------------

// On Vercel the browser files travel inside the function. Each path is written out in full on purpose:
// bundlers work out which files a function needs by reading the code. A new file in public/ must be added here
// (a test fails if one is missing).
function readBundledAssets() {
  const optional = (read) => {
    try {
      return read();
    } catch (err) {
      console.warn(`Browser file missing from the deployment: ${err.message}`);
      return null;
    }
  };
  return new Map(
    [
      ['/index.html', optional(() => fs.readFileSync(path.join(__dirname, 'public', 'index.html')))],
      ['/style.css', optional(() => fs.readFileSync(path.join(__dirname, 'public', 'style.css')))],
      ['/app.js', optional(() => fs.readFileSync(path.join(__dirname, 'public', 'app.js')))],
      ['/portal.js', optional(() => fs.readFileSync(path.join(__dirname, 'public', 'portal.js')))],
      ['/theme.js', optional(() => fs.readFileSync(path.join(__dirname, 'public', 'theme.js')))],
    ].filter(([, body]) => body),
  );
}
const BUNDLED_ASSETS = process.env.VERCEL ? readBundledAssets() : null;

async function serveStatic(req, res, url) {
  if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Method not allowed');
  let rel;
  try {
    rel = decodeURIComponent(url.pathname);
  } catch {
    throw new HttpError(400, 'Bad request');
  }
  if (rel.includes('\0')) throw new HttpError(400, 'Bad request');
  if (rel.endsWith('/')) rel += 'index.html';

  let body;
  if (BUNDLED_ASSETS) {
    body = BUNDLED_ASSETS.get(rel);
    if (!body) throw new HttpError(404, 'Not found');
  } else {
    const file = path.join(PUBLIC_DIR, rel);
    if (!file.startsWith(PUBLIC_DIR + path.sep)) throw new HttpError(403, 'Forbidden');
    try {
      body = await fs.promises.readFile(file);
    } catch (err) {
      if (err.code === 'ENOENT' || err.code === 'EISDIR') throw new HttpError(404, 'Not found');
      throw err;
    }
  }
  res.writeHead(200, {
    'Content-Type': MIME[path.extname(rel).toLowerCase()] ?? 'application/octet-stream',
    'Content-Length': body.length,
    'Cache-Control': 'no-cache',
    ...SECURITY_HEADERS,
  });
  res.end(req.method === 'HEAD' ? undefined : body);
}

// ---------------------------------------------------------------------------
// Request handler
// ---------------------------------------------------------------------------

// Builds the (req, res) handler that serves the API and the browser files, keeping its data in `storage`.
//   /api/auth/...    sign in, sign up, sign out (public)
//   /api/portal/...  guest accounts only
//   /api/...         management accounts only
function createRequestHandler(storage) {
  const store = createStore(storage);
  const auth = createAuth(storage);
  const exclusive = createLock();

  return (req, res) =>
    (async () => {
      let url;
      try {
        url = new URL(req.url, 'http://localhost');
      } catch {
        throw new HttpError(400, 'Bad request');
      }
      const { pathname } = url;
      if (pathname === '/api/auth' || pathname.startsWith('/api/auth/')) {
        return auth.handle(req, res, pathname.slice('/api/auth/'.length));
      }
      if (pathname === '/api' || pathname.startsWith('/api/')) {
        const user = await auth.requireUser(req);
        const isPortal = pathname === '/api/portal' || pathname.startsWith('/api/portal/');
        if (isPortal && user.role !== 'guest') throw new HttpError(403, 'This area is for guest accounts');
        if (!isPortal && user.role !== 'management') throw new HttpError(403, 'This area is for the hotel management');
        // One API request at a time per process, so a read-modify-write can't interleave with another.
        return exclusive(async () => {
          await store.load();
          if (isPortal) await handlePortal(req, res, url, store, user);
          else await handleApi(req, res, url, store);
        });
      }
      return serveStatic(req, res, url);
    })().catch((err) => {
      const status = err instanceof HttpError ? err.status : 500;
      if (status === 500) console.error(err);
      if (res.headersSent) return res.destroy();
      sendJson(res, status, { error: status === 500 ? 'Internal server error' : err.message });
    });
}

const createServer = (storage) => http.createServer(createRequestHandler(storage));

// What a serverless host such as Vercel imports: a plain request handler that sets itself up on first use.
// If storage isn't configured it answers with the reason instead of crashing.
let envHandler;
function handler(req, res) {
  if (!envHandler) {
    try {
      envHandler = createRequestHandler(storageFromEnv());
    } catch (err) {
      console.error(err);
      res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8', ...SECURITY_HEADERS });
      return res.end(err.message);
    }
  }
  return envHandler(req, res);
}

module.exports = handler;
Object.assign(handler, { createServer, createRequestHandler, createStore, localDate, readBundledAssets });

if (require.main === module) {
  (async () => {
    const port = Number(process.env.PORT) || 3000;
    // Loopback by default: only this computer can reach it unless HOST says otherwise.
    const host = process.env.HOST || '127.0.0.1';

    let storage;
    try {
      storage = storageFromEnv();
      // Fail now, with a clear message, if stored data can't be read.
      await Promise.all([storage.read('data'), storage.read('users')]);
    } catch (err) {
      console.error(err.message);
      process.exit(1);
    }

    const server = createServer(storage);
    server.on('error', (err) => {
      console.error(err.code === 'EADDRINUSE' ? `Port ${port} is already in use. Set PORT to use another.` : err.message);
      process.exit(1);
    });
    server.listen(port, host, () => {
      console.log(`Hotel PMS running at http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`);
      console.log(`Storing data in ${storage.description}`);
    });
  })();
}
