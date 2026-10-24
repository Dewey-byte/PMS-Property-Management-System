'use strict';

const fs = require('node:fs');
const path = require('node:path');

/**
 * A storage backend keeps two JSON documents by name: "data" (properties, leases, ...) and "users".
 *   read(name)        -> the document, or null if it has never been written
 *   write(name, doc)  -> replaces the document
 *
 * Locally everything lives in files. On a serverless host such as Vercel the disk is read-only and
 * wiped between runs, so the same two documents are kept in a Redis database instead.
 */

function fileStorage(dataFile) {
  // The accounts file sits beside the data file: db.json -> db.users.json
  const fileFor = (name) => (name === 'users' ? `${dataFile.replace(/\.json$/i, '')}.users.json` : dataFile);
  return {
    description: `files at ${dataFile}`,
    async read(name) {
      const file = fileFor(name);
      try {
        return JSON.parse(await fs.promises.readFile(file, 'utf8'));
      } catch (err) {
        if (err.code === 'ENOENT') return null;
        throw new Error(`Cannot read ${file}: ${err.message}`);
      }
    },
    async write(name, doc) {
      const file = fileFor(name);
      await fs.promises.mkdir(path.dirname(file), { recursive: true });
      const tmp = `${file}.tmp`;
      await fs.promises.writeFile(tmp, JSON.stringify(doc, null, 2), { mode: 0o600 });
      await fs.promises.rename(tmp, file);
    },
  };
}

// Talks to Upstash Redis through its REST API: one POST per command, body is the command as a JSON array.
function redisStorage({ url, token, prefix = 'pms' }) {
  async function command(...args) {
    let res;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(args),
        signal: AbortSignal.timeout(10_000),
      });
    } catch (err) {
      throw new Error(`Cannot reach the Redis database: ${err.message}`);
    }
    const body = await res.json().catch(() => ({}));
    if (!res.ok || body.error) throw new Error(`Redis request failed (${res.status}): ${body.error ?? 'no details'}`);
    return body.result;
  }
  return {
    description: 'a Redis database',
    async read(name) {
      const raw = await command('GET', `${prefix}:${name}`);
      return raw === null || raw === undefined ? null : JSON.parse(raw);
    },
    async write(name, doc) {
      await command('SET', `${prefix}:${name}`, JSON.stringify(doc));
    },
  };
}

// Redis when the Vercel/Upstash variables are present; otherwise files (never on Vercel, where they would be lost).
function storageFromEnv(env = process.env) {
  const url = env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL;
  const token = env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN;
  if (url && token) return redisStorage({ url, token });
  if (env.VERCEL) {
    throw new Error(
      'No Redis database is connected. In Vercel, open the project, go to Storage, add an Upstash Redis database, ' +
        'connect it to this project, then redeploy. (Expected KV_REST_API_URL and KV_REST_API_TOKEN.)',
    );
  }
  return fileStorage(env.DATA_FILE || path.join(__dirname, 'data', 'db.json'));
}

// Runs async tasks one at a time, so two requests in one process can't overwrite each other's changes.
function createLock() {
  let tail = Promise.resolve();
  return (task) => {
    const run = tail.then(task);
    tail = run.then(() => {}, () => {});
    return run;
  };
}

module.exports = { fileStorage, redisStorage, storageFromEnv, createLock };
