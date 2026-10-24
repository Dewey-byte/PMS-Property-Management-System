# Hotel PMS

A simple, modern hotel booking system for a small hotel or guesthouse, with two kinds of account:

- **Management** runs the hotel: takes bookings, sees availability on a calendar, checks guests in and out, answers guests, and tracks what is owed.
- **Guests** create their own account to find a room, send a reservation request, request services, and ask the hotel questions.

It has no dependencies: just Node.js 18 or newer. Run it on your own computer with data kept in files, or deploy it to Vercel with a Redis database.

## Quick start (on your computer)

```bash
npm start
```

Open <http://localhost:3000>. The first time, you are asked to **create the management account**. After that, guests can create their own accounts from the sign-in screen ("New guest? Create an account").

To try it with a demo hotel first (12 rooms, guests arriving and leaving today, a reservation waiting for approval, service requests and questions):

```bash
npm run seed
npm start
```

## The two accounts

| | Management | Guest |
| --- | --- | --- |
| **Created** | On first run. Only one, and the screen then closes. | By the guest, on the sign-in screen. |
| **Sees** | Everything: bookings, rooms, guests, payments, requests. | Only their own bookings, requests and messages, plus the rooms and services on offer. |
| **Can** | Do all of the hotel's work (below). | Reserve, request, ask, and cancel their own pending or confirmed items. |

Each account type has its own part of the system, enforced on the server, not just hidden in the page: a guest account gets a "not allowed" answer from every management page and endpoint, and the management account is not used for the guest pages.

### What guests do

| Page | Purpose |
| --- | --- |
| **Book a stay** | Choose dates and the number of guests, see which kinds of room are free and what the stay costs, then reserve. Room numbers are not shown; the hotel assigns the room. |
| **My bookings** | Every reservation and its status, what has been paid, and what is still to pay. A pending or confirmed booking can be cancelled. |
| **Services** | The extras the hotel offers (breakfast, airport pickup, spa…). Request one for a date, optionally added to a stay. |
| **Messages** | Ask the hotel about a room, a service, or anything else, and read its reply. |

A reservation from a guest starts as **Pending**. It already holds the room, so nobody else can take it, but it only becomes a real booking when the management confirms it (or the management declines it, which frees the room). Nothing is charged online.

### What the management does

| Page | Purpose |
| --- | --- |
| **Dashboard** | What needs attention (reservation requests, new inquiries, service requests), tonight's occupancy, today's arrivals and departures (check in and out with one click), guests in house, this month's revenue, what is still owed, and a 7-night forecast. |
| **Calendar** | Every room across the next two weeks. Click an empty night to start a booking; click a bar to edit it. Pending reservations have their own colour. |
| **Bookings** | All bookings, filterable by Pending, Upcoming, In house, Past and Cancelled. Confirm or decline online reservations, check in and out, cancel, reinstate, record a payment. |
| **Rooms** | Room cards with type, capacity, rate, a description guests will see, and tonight's status. Mark a room out of service to stop it being booked. |
| **Guests** | Contact details, number of stays, next arrival and last visit. Guests with an account are marked. |
| **Payments** | Deposits and payments received against bookings. |
| **Inquiries** | Guests' questions. Reply, close, reopen. The guest sees the reply on their Messages page. |
| **Service requests** | What guests asked for. Confirm, decline, mark done. A confirmed or finished service linked to a stay is **added to that stay's bill**. |
| **Services** | The catalogue of services, with price, and whether it is currently offered to guests. |

The numbers beside Bookings, Inquiries and Service requests in the menu show how many are waiting. They, and the page you are on, update by themselves: every 10 seconds the page checks whether anything changed, and a note appears when a guest sends something new. Guests are told the same way when the hotel confirms a reservation, answers a question or declines a request. Nothing needs reloading.

**Making a booking yourself:** pick check-in and check-out, and the number of adults and children. The form lists only the rooms that are free for those nights and big enough for the party, fills in the room's rate, and shows the total. Choose an existing guest or add a new one on the spot.

### Rules the app enforces

- A room cannot be booked twice for the same night. A guest can check out the morning the next one arrives.
- Check-out must be after check-in; a stay is at most 365 nights (30 for a guest booking online).
- A booking cannot have more guests than the room sleeps. Rooms out of service cannot be booked.
- Bookings move along sensible steps: Pending → Confirmed → Checked in → Checked out, or cancelled along the way. A cancelled booking can be reinstated if its room is still free.
- A record cannot be deleted while others depend on it (a room, guest or service that is in use).
- Guests cannot set their own price, status, or room number, and they cannot see each other's records. Each guest can only have a few things waiting on the hotel at once (3 reservations, 10 service requests, 5 open questions), and sign-ups from one address are limited to 5 an hour.
- A guest account is never linked to a guest record the hotel already has just because the email matches. Anyone can type any email address when signing up, so a match would let a stranger read someone else's history.

## Deploying to Vercel

Vercel runs the app as short-lived serverless functions with no lasting disk, so the data and the accounts must live in a database. The app uses **Upstash Redis**, which Vercel offers with a free plan.

1. Put the project on GitHub and import it into Vercel. Leave the preset on **Node**, which Vercel detects on its own; no build command is needed. (The Vercel GitHub app must be allowed to see the repository.)
2. In the Vercel project, open **Storage** (or the Marketplace), add **Upstash Redis**, and connect it to the project. This adds the variables `KV_REST_API_URL` and `KV_REST_API_TOKEN`.
3. **Redeploy.** Variables only apply to new deployments.
4. Open the site and create the management account.

If the page says *No Redis database is connected*, step 2 or 3 is missing. Nothing else needs configuring: the key that signs sign-in cookies is generated on first setup and stored in the database.

Your data is stored as two Redis keys, `pms:data` and `pms:users`. You can also point a local run at the same database by setting the two variables, but then you are editing your live data.

An account made before guest accounts existed is treated as the management account, so nothing changes for it.

## Signing in

Every page of data and every API call requires a session. Only the sign-in and sign-up screens are public.

- **First run:** with no account yet, the app shows *Create the management account* (username, and a password of at least 8 characters). Once it exists, that screen is closed. On a new deployment, create it promptly: until it exists, the first visitor can.
- **Guests** sign up with a name, email, optional phone, a username and a password. They sign in on the same screen as everyone else.
- **Sessions** are signed cookies, so they work across restarts and across serverless instances. The cookie is hidden from page scripts (`HttpOnly`), never sent cross-site (`SameSite=Strict`), marked `Secure` on HTTPS, and lasts 7 days. **Sign out ends every session for the account**, on all devices.
- **Passwords** are never stored as typed. They are hashed with scrypt and kept apart from the hotel's data (`data/db.users.json` locally, `pms:users` in Redis).
- **Guessing is slowed down:** after 5 wrong passwords in a row, that address is locked out for 15 minutes. Unknown usernames and wrong passwords get the same error message.

**Forgot the management password?** Remove the accounts record and set up again. The hotel's bookings and other data are untouched, but guest accounts are removed too, since they live in the same record.

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

All prices are in Philippine pesos (₱). To use another currency, change the `CURRENCY` code and the locale just below it at the top of `public/app.js`; the amounts you enter are stored as plain numbers either way. The demo hotel's prices are written in pesos too.

**Time zones:** "today" (for arrivals, departures and tonight's occupancy) is taken from the browser, not the server, so it follows your hotel's local date even when the server runs in another time zone.

**If you expose a self-run copy beyond your own computer** (by changing `HOST`), serve it over HTTPS, for example behind a reverse proxy that sets `X-Forwarded-Proto: https` so the session cookie is marked `Secure`. Without HTTPS, passwords and sessions travel in the clear. Behind your own proxy the failed-sign-in lockout and sign-up limit are counted per proxy address, so they are shared by all users. (On Vercel the real client address is used.)

## Development

```bash
npm test
```

runs the API, sign-in, role, guest-portal and serverless tests (Node's built-in test runner). The serverless tests run the app against a fake Redis server, with two separate instances sharing it.

```
server.js        Request handler, routing by account type, management API. Exports a handler function for Vercel.
hotel.js         The hotel itself: record types, rules, availability, the read model and dashboard
portal-api.js    What a guest account can do (/api/portal)
auth.js          Accounts and roles, signed-cookie sessions, sign-in and sign-up limits
storage.js       Where data lives: files locally, Redis on Vercel
http-utils.js    Shared request/response helpers and security headers
seed.js          Demo hotel loader (uses the same storage as the server)
vercel.json      Security headers for Vercel
public/          Browser UI (plain HTML, CSS and JavaScript, no build step):
                 app.js is the shell, sign-in and management pages; portal.js is the guest pages
test/            Tests
```

When you add a file to `public/`, also list it in `readBundledAssets()` in `server.js` (a test fails if you forget). That list is how the files get packaged into the Vercel function.

The API is REST-style under `/api`.

- **Management only** (`/api/...`):
  - `GET/POST /api/<collection>` and `GET/PUT/DELETE /api/<collection>/<id>`, where the collection is `rooms`, `guests`, `bookings`, `payments`, `services`, `serviceOrders` or `inquiries`.
  - `GET /api/availability?checkIn=&checkOut=&guests=[&exclude=<bookingId>]` lists the rooms free for those nights.
  - `POST /api/<bookings|serviceOrders|inquiries>/<id>/status` with `{ "status": "…" }` moves a record along its allowed steps.
  - `POST /api/inquiries/<id>/reply` with `{ "reply": "…" }` answers a guest.
  - `POST /api/bookings` may include `newGuest: { name, email, phone }` instead of `guestId`; the guest and booking are saved together.
  - `GET /api/dashboard`. Reads accept `?today=YYYY-MM-DD`.
  - `GET /api/pulse` is what the page polls: a `version` string that changes whenever any record is added, edited or removed, and the `requests` waiting for an answer.
- **Guest accounts only** (`/api/portal/...`): `rooms` (with optional dates), `services`, `bookings` (+ `/<id>/cancel`), `service-orders` (+ `/<id>/cancel`), `inquiries`, and `pulse` (a `version` for the guest's own records, plus the status of each, so the page can say what the hotel did).
- **Public:** `GET /api/auth/status` and `POST /api/auth/setup`, `/register`, `/login`, `/logout`.

## Limitations

- **One management account.** The UI creates only the first one; there is no screen for adding more staff or changing a password (see "Forgot the management password?" above). Guests cannot edit their profile either.
- **No emails and no online payments.** Guests find replies and confirmations in the app, and payments are recorded by hand. Email addresses are not verified.
- **Service charges** are added to a stay's bill only when a confirmed or finished request is linked to that stay.
- **Built for one hotel desk at a time.** All hotel data is stored as a single record. Within one running copy, requests are handled one at a time so nothing is lost. If two separate serverless instances save at the same instant, the later save wins. Check your Redis plan's limits on the size of a single value if you expect very large amounts of data.
- Each request reads the data from storage, which adds a little delay on Vercel compared with running locally.
- This version replaced an earlier rental-property version of the app. Records saved by that version are left in storage untouched, but this version does not show them.
