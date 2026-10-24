'use strict';

// Simulates how the app runs on Vercel: no disk, no memory shared between requests, state in Redis.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { createRequestHandler } = require('../server');
const { redisStorage } = require('../storage');

const CREDS = { username: 'Alice', password: 'correct horse battery' };

// A stand-in for Upstash's REST API: POST / with a JSON command array, Bearer token auth.
async function startFakeRedis(token = 'test-token') {
  const kv = new Map();
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      requests.push(req.headers.authorization);
      setTimeout(() => {
        res.setHeader('Content-Type', 'application/json');
        if (req.headers.authorization !== `Bearer ${token}`) {
          res.statusCode = 401;
          return res.end(JSON.stringify({ error: 'Unauthorized' }));
        }
        const [command, key, value] = JSON.parse(body);
        if (command === 'GET') return res.end(JSON.stringify({ result: kv.has(key) ? kv.get(key) : null }));
        if (command === 'SET') {
          kv.set(key, value);
          return res.end(JSON.stringify({ result: 'OK' }));
        }
        res.statusCode = 400;
        return res.end(JSON.stringify({ error: 'unknown command' }));
      }, 3); // a little latency, so unsynchronised read-modify-write cycles would overlap
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    kv,
    requests,
    token,
    url: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

async function serve(handler) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    base: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

const post = (body, cookie, headers = {}) => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...headers },
  body: JSON.stringify(body),
});
const cookieOf = (res) => res.headers.getSetCookie()[0].split(';')[0];

test('two separate instances sharing one Redis database behave like one app', async () => {
  const redis = await startFakeRedis();
  const storage = () => redisStorage({ url: redis.url, token: redis.token });
  const a = await serve(createRequestHandler(storage()));
  const b = await serve(createRequestHandler(storage()));
  try {
    const setup = await fetch(`${a.base}/api/auth/setup`, post(CREDS));
    assert.equal(setup.status, 201);
    const cookie = cookieOf(setup);

    assert.equal((await fetch(`${a.base}/api/properties`, post({ name: 'Shared', address: '1 St' }, cookie))).status, 201);

    // The other instance has never seen this session or this data, yet accepts the cookie and shows the record.
    const list = await (await fetch(`${b.base}/api/properties`, { headers: { Cookie: cookie } })).json();
    assert.deepEqual(list.map((p) => p.name), ['Shared']);
    assert.equal((await fetch(`${b.base}/api/auth/login`, post(CREDS))).status, 200);

    // Signing out on one instance ends the session on the other.
    await fetch(`${b.base}/api/auth/logout`, post({}, cookie));
    assert.equal((await fetch(`${a.base}/api/properties`, { headers: { Cookie: cookie } })).status, 401);

    assert.deepEqual([...redis.kv.keys()].sort(), ['pms:data', 'pms:users']);
    assert.ok(!redis.kv.get('pms:users').includes(CREDS.password));
  } finally {
    await a.close();
    await b.close();
    await redis.close();
  }
});

test('requests without a session never reach the database', async () => {
  const redis = await startFakeRedis();
  const app = await serve(createRequestHandler(redisStorage({ url: redis.url, token: redis.token })));
  try {
    const before = redis.requests.length;
    assert.equal((await fetch(`${app.base}/api/properties`)).status, 401);
    assert.equal((await fetch(`${app.base}/api/dashboard`, { method: 'GET' })).status, 401);
    assert.equal(redis.requests.length, before);
  } finally {
    await app.close();
    await redis.close();
  }
});

test('simultaneous writes in one instance are not lost', async () => {
  const redis = await startFakeRedis();
  const app = await serve(createRequestHandler(redisStorage({ url: redis.url, token: redis.token })));
  try {
    const cookie = cookieOf(await fetch(`${app.base}/api/auth/setup`, post(CREDS)));
    const created = await Promise.all(
      Array.from({ length: 15 }, (_, i) => fetch(`${app.base}/api/properties`, post({ name: `P${i}`, address: 'x' }, cookie))),
    );
    assert.ok(created.every((r) => r.status === 201));
    const list = await (await fetch(`${app.base}/api/properties`, { headers: { Cookie: cookie } })).json();
    assert.equal(list.length, 15);
  } finally {
    await app.close();
    await redis.close();
  }
});

test('a database failure is a plain 500 that does not leak the token', async () => {
  const redis = await startFakeRedis();
  const app = await serve(createRequestHandler(redisStorage({ url: redis.url, token: 'wrong-secret-token' })));
  const realError = console.error;
  console.error = () => {};
  try {
    const res = await fetch(`${app.base}/api/auth/status`);
    assert.equal(res.status, 500);
    const text = await res.text();
    assert.equal(JSON.parse(text).error, 'Internal server error');
    assert.ok(!text.includes('wrong-secret-token'));
  } finally {
    console.error = realError;
    await app.close();
    await redis.close();
  }
});

// Loads a fresh copy of server.js under the given environment, as a serverless host would import it.
async function withEnv(env, fn) {
  const saved = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]));
  const restore = () => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    delete require.cache[require.resolve('../server')];
  };
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  delete require.cache[require.resolve('../server')];
  try {
    await fn(require('../server'));
  } finally {
    restore();
  }
}

test('server.js default-exports a request handler, as Vercel requires', async () => {
  await withEnv({ VERCEL: undefined }, async (handler) => {
    assert.equal(typeof handler, 'function');
    assert.equal(handler.length, 2); // (req, res)
    assert.equal(typeof handler.createServer, 'function');
  });
});

test('on Vercel: serves the browser files from the bundle and works from environment variables', async () => {
  const redis = await startFakeRedis();
  await withEnv(
    { VERCEL: '1', KV_REST_API_URL: redis.url, KV_REST_API_TOKEN: redis.token, UPSTASH_REDIS_REST_URL: undefined, UPSTASH_REDIS_REST_TOKEN: undefined },
    async (handler) => {
      const app = await serve(handler);
      try {
        const index = await fetch(`${app.base}/`);
        assert.equal(index.status, 200);
        assert.match(await index.text(), /<title>PMS/);
        assert.equal((await fetch(`${app.base}/app.js`)).status, 200);
        assert.equal((await fetch(`${app.base}/missing.html`)).status, 404);
        assert.equal((await fetch(`${app.base}/..%2Fserver.js`)).status, 404);
        assert.equal((await fetch(`${app.base}/server.js`)).status, 404);

        const status = await (await fetch(`${app.base}/api/auth/status`)).json();
        assert.deepEqual(status, { setupRequired: true, user: null });
        assert.equal((await fetch(`${app.base}/api/auth/setup`, post(CREDS))).status, 201);
        assert.ok(redis.kv.has('pms:users'));
      } finally {
        await app.close();
      }
    },
  );
  await redis.close();
});

test('on Vercel: failed-login lockout follows the client address in X-Forwarded-For', async () => {
  const redis = await startFakeRedis();
  await withEnv(
    { VERCEL: '1', KV_REST_API_URL: redis.url, KV_REST_API_TOKEN: redis.token, UPSTASH_REDIS_REST_URL: undefined, UPSTASH_REDIS_REST_TOKEN: undefined },
    async (handler) => {
      const app = await serve(handler);
      try {
        await fetch(`${app.base}/api/auth/setup`, post(CREDS));
        const login = (password, ip) => fetch(`${app.base}/api/auth/login`, post({ username: 'alice', password }, null, { 'X-Forwarded-For': ip }));

        for (let i = 0; i < 5; i += 1) assert.equal((await login(`wrong ${i}`, '203.0.113.7')).status, 401);
        assert.equal((await login(CREDS.password, '203.0.113.7')).status, 429);
        assert.equal((await login(CREDS.password, '198.51.100.9')).status, 200); // someone else is unaffected
      } finally {
        await app.close();
      }
    },
  );
  await redis.close();
});

test('on Vercel without a database: a clear message instead of a crash', async () => {
  await withEnv(
    { VERCEL: '1', KV_REST_API_URL: undefined, KV_REST_API_TOKEN: undefined, UPSTASH_REDIS_REST_URL: undefined, UPSTASH_REDIS_REST_TOKEN: undefined },
    async (handler) => {
      const app = await serve(handler);
      const realError = console.error;
      console.error = () => {};
      try {
        const res = await fetch(`${app.base}/`);
        assert.equal(res.status, 503);
        assert.match(await res.text(), /No Redis database is connected/);
      } finally {
        console.error = realError;
        await app.close();
      }
    },
  );
});

test('every file in public/ is listed for bundling', async () => {
  await withEnv({ VERCEL: undefined }, async (handler) => {
    const bundled = [...handler.readBundledAssets().keys()].sort();
    const onDisk = fs.readdirSync(path.join(__dirname, '..', 'public')).map((f) => `/${f}`).sort();
    assert.deepEqual(bundled, onDisk);
  });
});
