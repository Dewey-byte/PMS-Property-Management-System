'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const PUBLIC_DIR = path.join(__dirname, 'public');
const MAX_BODY_BYTES = 64 * 1024;
const EXPIRY_WARNING_DAYS = 60;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const COLLECTIONS = ['properties', 'units', 'tenants', 'leases', 'payments', 'maintenance'];
const PRIORITY_RANK = { Urgent: 0, High: 1, Medium: 2, Low: 3 };

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'self'; frame-ancestors 'none'; form-action 'self'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
};

// ---------------------------------------------------------------------------
// Schemas: the only fields a client may set on each collection.
// ---------------------------------------------------------------------------

const SCHEMAS = {
  properties: {
    name: { type: 'string', required: true },
    address: { type: 'string', required: true },
    type: { type: 'enum', values: ['Apartment', 'House', 'Condo', 'Commercial', 'Other'], default: 'Apartment' },
    notes: { type: 'string', long: true },
  },
  units: {
    propertyId: { type: 'ref', ref: 'properties', required: true },
    number: { type: 'string', required: true },
    bedrooms: { type: 'number', min: 0, default: 0 },
    bathrooms: { type: 'number', min: 0, default: 1 },
    rent: { type: 'number', min: 0, required: true },
  },
  tenants: {
    name: { type: 'string', required: true },
    email: { type: 'string', format: 'email' },
    phone: { type: 'string' },
    notes: { type: 'string', long: true },
  },
  leases: {
    unitId: { type: 'ref', ref: 'units', required: true },
    tenantId: { type: 'ref', ref: 'tenants', required: true },
    startDate: { type: 'date', required: true },
    endDate: { type: 'date', required: true },
    rent: { type: 'number', min: 0, required: true },
    deposit: { type: 'number', min: 0, default: 0 },
    status: { type: 'enum', values: ['Active', 'Ended'], default: 'Active' },
  },
  payments: {
    leaseId: { type: 'ref', ref: 'leases', required: true },
    date: { type: 'date', required: true },
    period: { type: 'month', required: true },
    amount: { type: 'number', min: 0.01, required: true },
    method: { type: 'enum', values: ['Bank transfer', 'Cash', 'Check', 'Card', 'Online', 'Other'], default: 'Bank transfer' },
    note: { type: 'string' },
  },
  maintenance: {
    propertyId: { type: 'ref', ref: 'properties', required: true },
    unitId: { type: 'ref', ref: 'units' },
    title: { type: 'string', required: true },
    description: { type: 'string', long: true },
    priority: { type: 'enum', values: ['Low', 'Medium', 'High', 'Urgent'], default: 'Medium' },
    status: { type: 'enum', values: ['Open', 'In Progress', 'Resolved'], default: 'Open' },
    reportedDate: { type: 'date', default: () => localDate() },
    cost: { type: 'number', min: 0, default: 0 },
  },
};

// Records that must be removed before a record can be deleted: [collection, foreign key, noun].
const DEPENDENTS = {
  properties: [['units', 'propertyId', 'unit'], ['maintenance', 'propertyId', 'maintenance request']],
  units: [['leases', 'unitId', 'lease'], ['maintenance', 'unitId', 'maintenance request']],
  tenants: [['leases', 'tenantId', 'lease']],
  leases: [['payments', 'leaseId', 'payment']],
  payments: [],
  maintenance: [],
};

// Cross-record business rules, checked after field validation.
const RULES = {
  units(v, data, id) {
    const clash = data.units.find(
      (u) => u.id !== id && u.propertyId === v.propertyId && u.number.toLowerCase() === v.number.toLowerCase(),
    );
    if (clash) throw new HttpError(409, `Unit ${v.number} already exists in this property`);
  },
  leases(v, data, id) {
    if (v.endDate < v.startDate) throw new HttpError(400, 'End date must be on or after the start date');
    if (v.status !== 'Active') return;
    const overlap = data.leases.find(
      (l) => l.id !== id && l.unitId === v.unitId && l.status === 'Active' && l.startDate <= v.endDate && l.endDate >= v.startDate,
    );
    if (overlap) throw new HttpError(409, 'This unit already has an active lease overlapping those dates');
  },
  maintenance(v, data) {
    if (!v.unitId) return;
    const unit = data.units.find((u) => u.id === v.unitId);
    if (unit.propertyId !== v.propertyId) throw new HttpError(400, 'The selected unit does not belong to the selected property');
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const pad = (n) => String(n).padStart(2, '0');
const localDate = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const round2 = (n) => Math.round(n * 100) / 100;
const sumBy = (items, fn) => round2(items.reduce((total, item) => total + fn(item), 0));

function addDays(dateStr, n) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function daysBetween(from, to) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
}

function isDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

const isCurrent = (lease, today) => lease.status === 'Active' && lease.startDate <= today && lease.endDate >= today;

function fieldLabel(key) {
  const s = key.replace(/Id$/, '').replace(/([A-Z])/g, ' $1').toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ---------------------------------------------------------------------------
// Storage: one JSON file, loaded at startup and rewritten atomically on change.
// ---------------------------------------------------------------------------

function createStore(file) {
  const data = Object.fromEntries(COLLECTIONS.map((c) => [c, []]));
  try {
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    for (const c of COLLECTIONS) if (Array.isArray(saved[c])) data[c] = saved[c];
  } catch (err) {
    if (err.code !== 'ENOENT') throw new Error(`Cannot read ${file}: ${err.message}`);
  }
  return {
    data,
    save() {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const tmp = `${file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
      fs.renameSync(tmp, file);
    },
  };
}

// ---------------------------------------------------------------------------
// Validation and CRUD
// ---------------------------------------------------------------------------

function validate(collection, input, data) {
  const out = {};
  for (const [key, spec] of Object.entries(SCHEMAS[collection])) {
    const label = fieldLabel(key);
    let v = input[key];
    if (typeof v === 'string') v = v.trim();

    if (v === undefined || v === null || v === '') {
      if (spec.default !== undefined) out[key] = typeof spec.default === 'function' ? spec.default() : spec.default;
      else if (spec.required) throw new HttpError(400, `${label} is required`);
      else out[key] = spec.type === 'string' ? '' : null;
      continue;
    }

    switch (spec.type) {
      case 'string': {
        if (typeof v === 'number') v = String(v);
        if (typeof v !== 'string') throw new HttpError(400, `${label} must be text`);
        const max = spec.long ? 2000 : 200;
        if (v.length > max) throw new HttpError(400, `${label} must be at most ${max} characters`);
        if (spec.format === 'email' && !EMAIL_RE.test(v)) throw new HttpError(400, `${label} is not a valid email address`);
        out[key] = v;
        break;
      }
      case 'number': {
        const n = typeof v === 'number' || typeof v === 'string' ? Number(v) : NaN;
        if (!Number.isFinite(n)) throw new HttpError(400, `${label} must be a number`);
        if (spec.min !== undefined && n < spec.min) throw new HttpError(400, `${label} must be at least ${spec.min}`);
        if (n > 1e9) throw new HttpError(400, `${label} is too large`);
        out[key] = round2(n);
        break;
      }
      case 'date':
        if (typeof v !== 'string' || !isDate(v)) throw new HttpError(400, `${label} must be a valid date (YYYY-MM-DD)`);
        out[key] = v;
        break;
      case 'month':
        if (typeof v !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(v)) throw new HttpError(400, `${label} must be a month (YYYY-MM)`);
        out[key] = v;
        break;
      case 'enum':
        if (!spec.values.includes(v)) throw new HttpError(400, `${label} must be one of: ${spec.values.join(', ')}`);
        out[key] = v;
        break;
      case 'ref':
        if (typeof v !== 'string' || !data[spec.ref].some((r) => r.id === v)) throw new HttpError(400, `${label} does not exist`);
        out[key] = v;
        break;
    }
  }
  return out;
}

function saveRecord(store, collection, input, existing) {
  const { data } = store;
  const value = validate(collection, input, data);
  RULES[collection]?.(value, data, existing?.id);
  const now = new Date().toISOString();
  if (existing) {
    Object.assign(existing, value, { updatedAt: now });
    store.save();
    return existing;
  }
  const record = { id: crypto.randomUUID(), ...value, createdAt: now, updatedAt: now };
  data[collection].push(record);
  store.save();
  return record;
}

function removeRecord(store, collection, record) {
  const { data } = store;
  for (const [dep, key, noun] of DEPENDENTS[collection]) {
    const n = data[dep].filter((r) => r[key] === record.id).length;
    if (n > 0) {
      throw new HttpError(409, `Cannot delete: ${n} ${noun}${n === 1 ? '' : 's'} still reference${n === 1 ? 's' : ''} it. Remove ${n === 1 ? 'it' : 'them'} first.`);
    }
  }
  data[collection] = data[collection].filter((r) => r !== record);
  store.save();
}

// ---------------------------------------------------------------------------
// Read model: adds display fields to records and builds the dashboard.
// ---------------------------------------------------------------------------

function buildView(data) {
  const today = localDate();
  const byId = (name) => new Map(data[name].map((r) => [r.id, r]));
  const properties = byId('properties');
  const units = byId('units');
  const tenants = byId('tenants');
  const leases = byId('leases');

  const unitLabel = (unitId) => {
    const u = units.get(unitId);
    return u ? `${properties.get(u.propertyId)?.name ?? '?'} · ${u.number}` : '';
  };
  const tenantName = (tenantId) => tenants.get(tenantId)?.name ?? '';

  const currentLeases = data.leases.filter((l) => isCurrent(l, today));
  const leaseByUnit = new Map(currentLeases.map((l) => [l.unitId, l]));
  const unitsByTenant = new Map();
  for (const l of currentLeases) {
    unitsByTenant.set(l.tenantId, [...(unitsByTenant.get(l.tenantId) ?? []), unitLabel(l.unitId)]);
  }

  const decorators = {
    properties: (r) => ({ ...r, label: r.name }),
    units: (r) => {
      const lease = leaseByUnit.get(r.id);
      return {
        ...r,
        label: unitLabel(r.id),
        propertyName: properties.get(r.propertyId)?.name ?? '',
        occupancy: lease ? 'Occupied' : 'Vacant',
        tenantName: lease ? tenantName(lease.tenantId) : '',
      };
    },
    tenants: (r) => ({ ...r, label: r.name, currentUnits: (unitsByTenant.get(r.id) ?? []).join(', ') }),
    leases: (r) => ({
      ...r,
      label: `${tenantName(r.tenantId)} — ${unitLabel(r.unitId)}`,
      tenantName: tenantName(r.tenantId),
      unitLabel: unitLabel(r.unitId),
      expired: r.status === 'Active' && r.endDate < today,
    }),
    payments: (r) => {
      const lease = leases.get(r.leaseId);
      return { ...r, tenantName: lease ? tenantName(lease.tenantId) : '', unitLabel: lease ? unitLabel(lease.unitId) : '' };
    },
    maintenance: (r) => ({
      ...r,
      propertyName: properties.get(r.propertyId)?.name ?? '',
      unitNumber: units.get(r.unitId)?.number ?? '',
    }),
  };

  function dashboard() {
    const period = today.slice(0, 7);
    const rentRoll = currentLeases.map((l) => {
      const paid = sumBy(data.payments.filter((p) => p.leaseId === l.id && p.period === period), (p) => p.amount);
      return {
        leaseId: l.id,
        tenantName: tenantName(l.tenantId),
        unitLabel: unitLabel(l.unitId),
        rent: l.rent,
        paid,
        balance: Math.max(0, round2(l.rent - paid)),
        status: paid >= l.rent ? 'Paid' : paid > 0 ? 'Partial' : 'Unpaid',
      };
    });

    const cutoff = addDays(today, EXPIRY_WARNING_DAYS);
    const expiringLeases = data.leases
      .filter((l) => l.status === 'Active' && l.endDate <= cutoff)
      .sort((a, b) => a.endDate.localeCompare(b.endDate))
      .map((l) => ({
        leaseId: l.id,
        tenantName: tenantName(l.tenantId),
        unitLabel: unitLabel(l.unitId),
        endDate: l.endDate,
        daysLeft: daysBetween(today, l.endDate),
      }));

    const open = data.maintenance.filter((m) => m.status !== 'Resolved');
    const openRequests = [...open]
      .sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || a.reportedDate.localeCompare(b.reportedDate))
      .slice(0, 8)
      .map((m) => decorators.maintenance(m));

    const totalUnits = data.units.length;
    return {
      today,
      period,
      totalProperties: data.properties.length,
      totalUnits,
      occupiedUnits: leaseByUnit.size,
      occupancyRate: totalUnits ? Math.round((leaseByUnit.size / totalUnits) * 100) : 0,
      monthlyRent: sumBy(currentLeases, (l) => l.rent),
      collected: sumBy(data.payments.filter((p) => p.period === period), (p) => p.amount),
      outstanding: sumBy(rentRoll, (r) => r.balance),
      openMaintenance: open.length,
      urgentMaintenance: open.filter((m) => m.priority === 'Urgent').length,
      rentRoll,
      expiringLeases,
      openRequests,
    };
  }

  return { decorate: (collection, record) => decorators[collection](record), dashboard };
}

// ---------------------------------------------------------------------------
// HTTP layer
// ---------------------------------------------------------------------------

function sendJson(res, status, body) {
  const buf = Buffer.from(JSON.stringify(body));
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': buf.length,
    'Cache-Control': 'no-store',
    ...SECURITY_HEADERS,
  });
  res.end(buf);
}

function readJson(req) {
  if (!/^application\/json\b/i.test(req.headers['content-type'] ?? '')) {
    throw new HttpError(415, 'Content-Type must be application/json');
  }
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size <= MAX_BODY_BYTES) chunks.push(chunk);
    });
    req.on('end', () => {
      if (size > MAX_BODY_BYTES) return reject(new HttpError(413, 'Request body too large'));
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (body === null || typeof body !== 'object' || Array.isArray(body)) throw new Error('not an object');
        resolve(body);
      } catch {
        reject(new HttpError(400, 'Request body must be a JSON object'));
      }
    });
    req.on('error', reject);
  });
}

// Block cross-site requests: browsers always send Origin on cross-site writes.
function assertSameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return;
  let host;
  try {
    host = new URL(origin).host;
  } catch {
    host = null;
  }
  if (host !== req.headers.host) throw new HttpError(403, 'Cross-origin request blocked');
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
  if (method !== 'GET') assertSameOrigin(req);

  if (parts[0] === 'dashboard' && parts.length === 1) {
    if (method !== 'GET') throw new HttpError(405, 'Method not allowed');
    return sendJson(res, 200, buildView(data).dashboard());
  }

  const [collection, id] = parts;
  if (!COLLECTIONS.includes(collection) || parts.length > 2) throw new HttpError(404, 'Not found');
  const present = (record) => buildView(data).decorate(collection, record);

  if (id === undefined) {
    if (method === 'GET') {
      const view = buildView(data);
      return sendJson(res, 200, data[collection].map((r) => view.decorate(collection, r)));
    }
    if (method === 'POST') {
      const record = saveRecord(store, collection, await readJson(req), null);
      return sendJson(res, 201, present(record));
    }
    throw new HttpError(405, 'Method not allowed');
  }

  const record = data[collection].find((r) => r.id === id);
  if (!record) throw new HttpError(404, 'Record not found');

  if (method === 'GET') return sendJson(res, 200, present(record));
  if (method === 'PUT') return sendJson(res, 200, present(saveRecord(store, collection, await readJson(req), record)));
  if (method === 'DELETE') {
    removeRecord(store, collection, record);
    res.writeHead(204, { 'Cache-Control': 'no-store', ...SECURITY_HEADERS });
    return res.end();
  }
  throw new HttpError(405, 'Method not allowed');
}

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

  const file = path.join(PUBLIC_DIR, rel);
  if (!file.startsWith(PUBLIC_DIR + path.sep)) throw new HttpError(403, 'Forbidden');

  let body;
  try {
    body = await fs.promises.readFile(file);
  } catch (err) {
    if (err.code === 'ENOENT' || err.code === 'EISDIR') throw new HttpError(404, 'Not found');
    throw err;
  }
  res.writeHead(200, {
    'Content-Type': MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
    'Content-Length': body.length,
    'Cache-Control': 'no-cache',
    ...SECURITY_HEADERS,
  });
  res.end(req.method === 'HEAD' ? undefined : body);
}

function createServer(dataFile) {
  const store = createStore(dataFile);
  return http.createServer((req, res) => {
    (async () => {
      let url;
      try {
        url = new URL(req.url, 'http://localhost');
      } catch {
        throw new HttpError(400, 'Bad request');
      }
      if (url.pathname === '/api' || url.pathname.startsWith('/api/')) return handleApi(req, res, url, store);
      return serveStatic(req, res, url);
    })().catch((err) => {
      const status = err instanceof HttpError ? err.status : 500;
      if (status === 500) console.error(err);
      if (res.headersSent) return res.destroy();
      sendJson(res, status, { error: status === 500 ? 'Internal server error' : err.message });
    });
  });
}

module.exports = { createServer, createStore, localDate };

if (require.main === module) {
  const port = Number(process.env.PORT) || 3000;
  // Loopback by default: there is no login, so don't expose it to the network unless asked.
  const host = process.env.HOST || '127.0.0.1';
  const dataFile = process.env.DATA_FILE || path.join(__dirname, 'data', 'db.json');

  let server;
  try {
    server = createServer(dataFile);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
  server.on('error', (err) => {
    console.error(err.code === 'EADDRINUSE' ? `Port ${port} is already in use. Set PORT to use another.` : err.message);
    process.exit(1);
  });
  server.listen(port, host, () => {
    console.log(`PMS running at http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`);
    console.log(`Data file: ${dataFile}`);
  });
}
