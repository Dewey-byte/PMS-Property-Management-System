# PMS Property Management System

A simple web-based property management system for landlords and small property managers. It tracks properties, units, tenants, leases, rent payments and maintenance requests, with a dashboard that shows occupancy and this month's rent at a glance.

It has no dependencies: just Node.js 18 or newer. Data is stored in a single JSON file.

## Quick start

```bash
npm start
```

Then open <http://localhost:3000>.

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

## Configuration

Set these environment variables before `npm start`:

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `3000` | Port to listen on. |
| `HOST` | `127.0.0.1` | Address to bind. Left on loopback because the app has no login; only change it on a network you trust. |
| `DATA_FILE` | `data/db.json` | Where records are stored. Back this file up to back up your data. |

The currency is the `CURRENCY` constant at the top of `public/app.js`.

## Development

```bash
npm test
```

runs the API tests (Node's built-in test runner).

```
server.js        HTTP server, REST API, validation, JSON storage
seed.js          Demo data loader
public/          Browser UI (plain HTML, CSS and JavaScript, no build step)
test/            API tests
```

The API is REST-style under `/api`: `GET/POST /api/<collection>` and `GET/PUT/DELETE /api/<collection>/<id>`, where the collection is `properties`, `units`, `tenants`, `leases`, `payments` or `maintenance`, plus `GET /api/dashboard`.

## Limitations

- **No authentication or user accounts.** Anyone who can reach the server can read and change everything.
- A single JSON file is fine for one person managing dozens of units, not for many concurrent users.
