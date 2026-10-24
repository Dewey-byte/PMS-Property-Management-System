# PMS Property Management System

A simple web-based property management system for landlords and small property managers. It tracks properties, units, tenants, leases, rent payments and maintenance requests, with a dashboard that shows occupancy and this month's rent at a glance.

It has no dependencies: just Node.js 18 or newer. Data is stored in JSON files.

## Quick start

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

## Signing in

Every page of data and every API call requires a session. Only the sign-in screen itself is public.

- **First run:** with no account yet, the app shows a *Create your account* screen (username, and a password of at least 8 characters). Once that account exists, the screen is closed.
- **Sessions:** a successful sign-in sets a cookie that is hidden from page scripts (`HttpOnly`) and never sent cross-site (`SameSite=Strict`). It lasts 7 days, or until you press **Sign out**, or until the server restarts.
- **Passwords** are never stored as typed. They are hashed with scrypt and kept in `data/db.users.json`, a separate file from your data.
- **Guessing is slowed down:** after 5 wrong passwords in a row, that address is locked out for 15 minutes. Unknown usernames and wrong passwords get the same error message.

**Forgot your password?** Stop the server, delete `data/db.users.json`, and start it again. You will see the *Create your account* screen; your properties and other data are untouched. (This works because anyone with access to the files on the machine already has access to everything.)

## Appearance

A frosted-glass interface over a softly moving gradient background, with entrance animations, counting numbers and animated progress bars. The sun/moon button switches between light and dark themes and remembers your choice; the first visit follows your system setting. If your system is set to reduce motion, the animations are turned off.

## Configuration

Set these environment variables before `npm start`:

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `3000` | Port to listen on. |
| `HOST` | `127.0.0.1` | Address to bind. Left on loopback so only this computer can reach it. See the note below before changing it. |
| `DATA_FILE` | `data/db.json` | Where records are stored. Accounts go beside it, in `db.users.json`. Back both up. |

The currency is the `CURRENCY` constant at the top of `public/app.js`.

**If you expose it beyond your own computer** (by changing `HOST`), serve it over HTTPS, for example behind a reverse proxy that sets `X-Forwarded-Proto: https` so the session cookie is marked `Secure`. Without HTTPS, passwords and sessions travel in the clear. Behind a proxy the failed-sign-in lockout is counted per proxy address, so it is shared by all users.

## Development

```bash
npm test
```

runs the API and sign-in tests (Node's built-in test runner).

```
server.js        HTTP server, REST API, validation, JSON storage
auth.js          Accounts, sessions, sign-in lockout
http-utils.js    Shared request/response helpers and security headers
seed.js          Demo data loader
public/          Browser UI (plain HTML, CSS and JavaScript, no build step)
test/            API and sign-in tests
```

The API is REST-style under `/api`: `GET/POST /api/<collection>` and `GET/PUT/DELETE /api/<collection>/<id>`, where the collection is `properties`, `units`, `tenants`, `leases`, `payments` or `maintenance`, plus `GET /api/dashboard`. Sign-in uses `GET /api/auth/status` and `POST /api/auth/setup`, `/login` and `/logout`.

## Limitations

- **One account.** The UI creates only the first account; there is no screen for adding more people or changing a password (see "Forgot your password?" above).
- A single JSON file is fine for one person managing dozens of units, not for many concurrent users.
- Sessions are kept in memory, so restarting the server signs everyone out.
