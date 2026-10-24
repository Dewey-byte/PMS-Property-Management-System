# PMS Property Management System

A simple web-based property management system for landlords and small property managers. It tracks properties, units, tenants, leases, rent payments and maintenance requests, with a dashboard that shows occupancy and this month's rent at a glance.

It has no dependencies: just Node.js 18 or newer. Run it on your own computer with data kept in files, or deploy it to Vercel with a Redis database.

## Quick start (on your computer)

```bash
npm start
```

Open <http://localhost:3000>. The first time, you are asked to **create your account**; after that you sign in with it.

To try it with sample data first:

```bash
npm run seed
npm start
```

## What it does

| Section | Purpose |
| --- | --- |
| **Dashboard** | Occupancy, monthly rent roll, rent collected and outstanding this month, who has paid, leases ending within 60 days (or already lapsed), and open maintenance. |
| **Properties** | The buildings or houses you manage. |
| **Units** | Rentable units within a property, with bedrooms, bathrooms and asking rent. Shows whether each is occupied or vacant. |
| **Tenants** | Contact details, and which unit each currently rents. |
| **Leases** | Links a tenant to a unit for a term, with rent and deposit. **End lease** frees the unit. |
| **Payments** | Rent received, recorded against a lease and the month it covers. Partial payments are supported. |
| **Maintenance** | Repair requests with priority, status and cost. |

Business rules the app enforces:

- A unit number is unique within its property.
- A unit cannot have two overlapping active leases.
- A lease must end on or after its start date.
- A record cannot be deleted while other records depend on it (for example a property that still has units).

## Deploying to Vercel

Vercel runs the app as short-lived serverless functions with no lasting disk, so the data and the account must live in a database. The app uses **Upstash Redis**, which Vercel offers with a free plan.

1. Put the project on GitHub and import it into Vercel. Leave the preset on **Node**, which Vercel detects on its own; no build command is needed. (The Vercel GitHub app must be allowed to see the repository.)
2. In the Vercel project, open **Storage** (or the Marketplace), add **Upstash Redis**, and connect it to the project for all environments. This adds the variables `KV_REST_API_URL` and `KV_REST_API_TOKEN`.
3. **Redeploy.** Variables only apply to new deployments.
4. Open the site and create your account.

If the page says *No Redis database is connected*, step 2 or 3 is missing. Nothing else needs configuring: the key that signs sign-in cookies is generated on first setup and stored in the database.

Your data is stored as two Redis keys, `pms:data` and `pms:users`. You can also point a local run at the same database by setting the two variables, but then you are editing your live data.

## Signing in

Every page of data and every API call requires a session. Only the sign-in screen itself is public.

- **First run:** with no account yet, the app shows a *Create your account* screen (username, and a password of at least 8 characters). Once that account exists, the screen is closed.
- **Sessions** are signed cookies, so they work across restarts and across serverless instances. The cookie is hidden from page scripts (`HttpOnly`), never sent cross-site (`SameSite=Strict`), marked `Secure` on HTTPS, and lasts 7 days. **Sign out ends every session for the account**, on all your devices.
- **Passwords** are never stored as typed. They are hashed with scrypt and kept apart from your data (`data/db.users.json` locally, `pms:users` in Redis).
- **Guessing is slowed down:** after 5 wrong passwords in a row, that address is locked out for 15 minutes. Unknown usernames and wrong passwords get the same error message.

**Forgot your password?** Remove the account record and create it again. Your properties and other data are untouched.

- On your computer: stop the server, delete `data/db.users.json`, start it again.
- On Vercel: in the Upstash console's data browser, delete the key `pms:users`.

(This works because anyone with access to the files or the database already has access to everything.)

## Appearance

A frosted-glass interface over a softly moving gradient background, with entrance animations, counting numbers and animated progress bars. The sun/moon button switches between light and dark themes and remembers your choice; the first visit follows your system setting. If your system is set to reduce motion, the animations are turned off.

## Configuration

Set these environment variables before `npm start`:

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `3000` | Port to listen on. |
| `HOST` | `127.0.0.1` | Address to bind. Left on loopback so only this computer can reach it. See the note below before changing it. |
| `DATA_FILE` | `data/db.json` | Where records are stored when no Redis database is configured. Accounts go beside it, in `db.users.json`. Back both up. |
| `KV_REST_API_URL`, `KV_REST_API_TOKEN` | not set | Use a Redis database (Upstash) instead of files. Vercel sets these when you connect the database. `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` work too. |

The currency is the `CURRENCY` constant at the top of `public/app.js`.

**If you expose a self-run copy beyond your own computer** (by changing `HOST`), serve it over HTTPS, for example behind a reverse proxy that sets `X-Forwarded-Proto: https` so the session cookie is marked `Secure`. Without HTTPS, passwords and sessions travel in the clear. Behind your own proxy the failed-sign-in lockout is counted per proxy address, so it is shared by all users. (On Vercel the real client address is used.)

## Development

```bash
npm test
```

runs the API, sign-in and serverless tests (Node's built-in test runner). The serverless tests run the app against a fake Redis server, with two separate instances sharing it.

```
server.js        Request handler, REST API, validation. Exports a handler function for Vercel.
auth.js          Accounts, signed-cookie sessions, sign-in lockout
storage.js       Where data lives: files locally, Redis on Vercel
http-utils.js    Shared request/response helpers and security headers
seed.js          Demo data loader (uses the same storage as the server)
vercel.json      Security headers for Vercel
public/          Browser UI (plain HTML, CSS and JavaScript, no build step)
test/            API, sign-in and serverless tests
```

When you add a file to `public/`, also list it in `readBundledAssets()` in `server.js` (a test fails if you forget). That list is how the files get packaged into the Vercel function.

The API is REST-style under `/api`: `GET/POST /api/<collection>` and `GET/PUT/DELETE /api/<collection>/<id>`, where the collection is `properties`, `units`, `tenants`, `leases`, `payments` or `maintenance`, plus `GET /api/dashboard`. Sign-in uses `GET /api/auth/status` and `POST /api/auth/setup`, `/login` and `/logout`.

## Limitations

- **One account.** The UI creates only the first account; there is no screen for adding more people or changing a password (see "Forgot your password?" above).
- **Built for one person at a time.** All property data is stored as a single record. Within one running copy, requests are handled one at a time so nothing is lost. If two separate serverless instances save at the same instant, the later save wins. Check your Redis plan's limits on the size of a single value if you expect very large amounts of data.
- Each request reads the data from storage, which adds a little delay on Vercel compared with running locally.
