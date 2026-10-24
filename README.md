# Hotel PMS

A simple, modern hotel booking system for a small hotel or guesthouse. Take bookings by choosing dates and an available room, see the whole hotel on an availability calendar, check guests in and out, and keep track of what they owe.

It has no dependencies: just Node.js 18 or newer. Run it on your own computer with data kept in files, or deploy it to Vercel with a Redis database.

## Quick start (on your computer)

```bash
npm start
```

Open <http://localhost:3000>. The first time, you are asked to **create your account**; after that you sign in with it.

To try it with a demo hotel first (12 rooms, guests arriving and leaving today, and bookings around today's date):

```bash
npm run seed
npm start
```

## What it does

| Page | Purpose |
| --- | --- |
| **Dashboard** | Tonight's occupancy, today's arrivals and departures (check guests in and out with one click), guests in house, this month's revenue, what is still owed, and a forecast of the next 7 nights. |
| **Calendar** | Every room across the next two weeks. Booking bars show who is staying when. Click an empty night to start a booking for that room; click a bar to edit it. |
| **Bookings** | All bookings, filterable by Upcoming, In house, Past and Cancelled. Check in, check out, cancel, reinstate or record a payment from the row. |
| **Rooms** | Room cards with type, capacity, rate and tonight's status. Mark a room out of service to stop it being booked. |
| **Guests** | Contact details, number of stays, next arrival and last visit. |
| **Payments** | Deposits and payments received against bookings. |

**Making a booking:** pick check-in and check-out, and the number of adults and children. The form lists only the rooms that are free for those nights and big enough for the party, fills in the room's rate, and shows the total. Choose an existing guest or add a new one on the spot.

Rules the app enforces:

- A room cannot be booked twice for the same night. A guest can check out the morning the next one arrives.
- Check-out must be after check-in, and a stay is at most 365 nights.
- A booking cannot have more guests than the room sleeps.
- Rooms that are out of service cannot be booked.
- Room numbers are unique.
- Bookings move along sensible steps: Confirmed → Checked in → Checked out, or Confirmed → Cancelled (and a cancelled booking can be reinstated if its room is still free).
- A record cannot be deleted while others depend on it (a room or guest with bookings, a booking with payments).

## Deploying to Vercel

Vercel runs the app as short-lived serverless functions with no lasting disk, so the data and the account must live in a database. The app uses **Upstash Redis**, which Vercel offers with a free plan.

1. Put the project on GitHub and import it into Vercel. Leave the preset on **Node**, which Vercel detects on its own; no build command is needed. (The Vercel GitHub app must be allowed to see the repository.)
2. In the Vercel project, open **Storage** (or the Marketplace), add **Upstash Redis**, and connect it to the project. This adds the variables `KV_REST_API_URL` and `KV_REST_API_TOKEN`.
3. **Redeploy.** Variables only apply to new deployments.
4. Open the site and create your account.

If the page says *No Redis database is connected*, step 2 or 3 is missing. Nothing else needs configuring: the key that signs sign-in cookies is generated on first setup and stored in the database.

Your data is stored as two Redis keys, `pms:data` and `pms:users`. You can also point a local run at the same database by setting the two variables, but then you are editing your live data.

## Signing in

Every page of data and every API call requires a session. Only the sign-in screen itself is public.

- **First run:** with no account yet, the app shows a *Create your account* screen (username, and a password of at least 8 characters). Once that account exists, the screen is closed. On a new deployment, create the account promptly: until it exists, the first visitor can.
- **Sessions** are signed cookies, so they work across restarts and across serverless instances. The cookie is hidden from page scripts (`HttpOnly`), never sent cross-site (`SameSite=Strict`), marked `Secure` on HTTPS, and lasts 7 days. **Sign out ends every session for the account**, on all your devices.
- **Passwords** are never stored as typed. They are hashed with scrypt and kept apart from your data (`data/db.users.json` locally, `pms:users` in Redis).
- **Guessing is slowed down:** after 5 wrong passwords in a row, that address is locked out for 15 minutes. Unknown usernames and wrong passwords get the same error message.

**Forgot your password?** Remove the account record and create it again. Your hotel data is untouched.

- On your computer: stop the server, delete `data/db.users.json`, start it again.
- On Vercel: in the Upstash console's data browser, delete the key `pms:users`.

(This works because anyone with access to the files or the database already has access to everything.)

## Appearance

A frosted-glass interface over a softly moving gradient background, with entrance animations, counting numbers and animated charts. The sun/moon button switches between light and dark themes and remembers your choice; the first visit follows your system setting. If your system is set to reduce motion, the animations are turned off. It works on phones too.

## Configuration

Set these environment variables before `npm start`:

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `3000` | Port to listen on. |
| `HOST` | `127.0.0.1` | Address to bind. Left on loopback so only this computer can reach it. See the note below before changing it. |
| `DATA_FILE` | `data/db.json` | Where records are stored when no Redis database is configured. Accounts go beside it, in `db.users.json`. Back both up. |
| `KV_REST_API_URL`, `KV_REST_API_TOKEN` | not set | Use a Redis database (Upstash) instead of files. Vercel sets these when you connect the database. `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` work too. |

The currency is the `CURRENCY` constant at the top of `public/app.js`.

**Time zones:** "today" (for arrivals, departures and tonight's occupancy) is taken from the browser, not the server, so it follows your hotel's local date even when the server runs in another time zone.

**If you expose a self-run copy beyond your own computer** (by changing `HOST`), serve it over HTTPS, for example behind a reverse proxy that sets `X-Forwarded-Proto: https` so the session cookie is marked `Secure`. Without HTTPS, passwords and sessions travel in the clear. Behind your own proxy the failed-sign-in lockout is counted per proxy address, so it is shared by all users. (On Vercel the real client address is used.)

## Development

```bash
npm test
```

runs the API, sign-in and serverless tests (Node's built-in test runner). The serverless tests run the app against a fake Redis server, with two separate instances sharing it.

```
server.js        Request handler, REST API, booking rules, availability. Exports a handler function for Vercel.
auth.js          Accounts, signed-cookie sessions, sign-in lockout
storage.js       Where data lives: files locally, Redis on Vercel
http-utils.js    Shared request/response helpers and security headers
seed.js          Demo hotel loader (uses the same storage as the server)
vercel.json      Security headers for Vercel
public/          Browser UI (plain HTML, CSS and JavaScript, no build step)
test/            API, sign-in and serverless tests
```

When you add a file to `public/`, also list it in `readBundledAssets()` in `server.js` (a test fails if you forget). That list is how the files get packaged into the Vercel function.

The API is REST-style under `/api`:

- `GET/POST /api/<collection>` and `GET/PUT/DELETE /api/<collection>/<id>`, where the collection is `rooms`, `guests`, `bookings` or `payments`.
- `GET /api/availability?checkIn=&checkOut=&guests=[&exclude=<bookingId>]` lists the rooms free for those nights.
- `POST /api/bookings/<id>/status` with `{ "status": "Checked in" }` moves a booking along (also `Checked out`, `Cancelled`, `Confirmed`).
- `POST /api/bookings` may include `newGuest: { name, email, phone }` instead of `guestId`; the guest and booking are saved together.
- `GET /api/dashboard`. Reads accept `?today=YYYY-MM-DD`.
- Sign-in: `GET /api/auth/status` and `POST /api/auth/setup`, `/login` and `/logout`.

## Limitations

- **Staff use only.** There is no public page for guests to book for themselves; bookings are entered by whoever signs in.
- **One account.** The UI creates only the first account; there is no screen for adding more people or changing a password (see "Forgot your password?" above).
- **Built for one person at a time.** All hotel data is stored as a single record. Within one running copy, requests are handled one at a time so nothing is lost. If two separate serverless instances save at the same instant, the later save wins. Check your Redis plan's limits on the size of a single value if you expect very large amounts of data.
- **No emails or online payments:** payments are recorded by hand, and confirmations are not sent.
- Each request reads the data from storage, which adds a little delay on Vercel compared with running locally.
- This version replaced an earlier rental-property version of the app. Records saved by that version are left in storage untouched, but this version does not show them.
