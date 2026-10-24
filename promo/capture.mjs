// Captures real screenshots of the running app for the film: the hotel's desktop screens and the
// guest's phone screens. Run against a freshly seeded local copy:  node capture.mjs
// Everything is clicked through the real interface, so what the film shows is what the app does.
// It also records where the buttons and panels are (anchors.json) so the film can aim taps and zooms exactly.
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const BASE = process.env.BASE || 'http://localhost:3100';
const OUT = 'hotel-pms/assets/shots';
mkdirSync(OUT, { recursive: true });

const MANAGER = { username: 'manager', password: 'promo-manager-test-9051' };
const GUEST = { name: 'Maria Santos', email: 'maria.santos@example.com', phone: '0917 555 0142', username: 'maria', password: 'promo-guest-test-7720' };

const browser = await chromium.launch();
// Reduced motion: the app skips its entrance animations, so every capture is the finished screen.
const common = { baseURL: BASE, reducedMotion: 'reduce', colorScheme: 'light' };
const desktop = await browser.newContext({ ...common, viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
const phone = await browser.newContext({ ...common, viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });

const setup = await desktop.request.post('/api/auth/setup', { data: MANAGER });
if (!setup.ok()) throw new Error(`setup failed: ${setup.status()} (start from freshly seeded data)`);
const mgr = await desktop.newPage();
const guest = await phone.newPage();

// anchors[shot][key] = { x, y, w, h } in CSS pixels of that screenshot (page coordinates for full-page shots)
const anchors = {};
async function mark(page, name, marks, fullPage) {
  // A viewport screenshot is measured from the viewport; a full-page one from the top of the document.
  const [sx, sy] = fullPage ? await page.evaluate(() => [scrollX, scrollY]) : [0, 0];
  for (const [key, selector] of Object.entries(marks)) {
    const box = await page.locator(selector).first().boundingBox().catch(() => null);
    if (!box) { console.warn(`  no box for ${name}.${key} (${selector})`); continue; }
    (anchors[name] ??= {})[key] = { x: box.x + sx, y: box.y + sy, w: box.width, h: box.height };
  }
}
async function shot(page, name, opts = {}, marks = {}) {
  await page.waitForTimeout(900);
  await mark(page, name, marks, opts.fullPage);
  await page.screenshot({ path: `${OUT}/${name}.png`, animations: 'disabled', ...opts });
  console.log('captured', name);
}
const go = async (page, hash, ms = 1300) => {
  await page.evaluate((h) => { location.hash = h; }, hash);
  await page.waitForTimeout(ms);
};
const plusDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };

// ---------------------------------------------------------------- the guest, on a phone
await guest.goto('/');
await guest.waitForSelector('.auth-card');
await guest.click('[data-switch="register"]');
await guest.waitForSelector('input[name="confirm"]');
const FIELDS = {
  name: 'input[name="name"]', email: 'input[name="email"]', phone: 'input[name="phone"]',
  username: 'input[name="username"]', password: 'input[name="password"]', confirm: 'input[name="confirm"]',
  submit: '.auth-form button[type="submit"]',
};
await shot(guest, 'g01_register_empty');
await shot(guest, 'g01_register_empty_full', { fullPage: true }, FIELDS);
await guest.fill('input[name="name"]', GUEST.name);
await guest.fill('input[name="email"]', GUEST.email);
await guest.fill('input[name="phone"]', GUEST.phone);
await guest.fill('input[name="username"]', GUEST.username);
await guest.fill('input[name="password"]', GUEST.password);
await guest.fill('input[name="confirm"]', GUEST.password);
await shot(guest, 'g02_register_filled');
await shot(guest, 'g02_register_filled_full', { fullPage: true }, FIELDS);
await guest.click('.auth-form button[type="submit"]');
await guest.waitForSelector('.room-card');
const NAV = { nav0: '#nav a >> nth=0', nav1: '#nav a >> nth=1', nav2: '#nav a >> nth=2' };
const DATES = { checkIn: 'input[name="checkIn"]', checkOut: 'input[name="checkOut"]', search: '#stay-form button[type="submit"]' };
await shot(guest, 'g03_stay_browse', {}, { ...DATES, ...NAV });
await shot(guest, 'g03_stay_browse_full', { fullPage: true });

await guest.fill('input[name="checkIn"]', plusDays(12));
await guest.fill('input[name="checkOut"]', plusDays(15));
await shot(guest, 'g04_stay_dates', {}, DATES);
await guest.click('#stay-form button[type="submit"]');
await guest.waitForSelector('.stay-total');
await shot(guest, 'g05_stay_results', {}, { reserve: '.room-card >> nth=0 >> [data-reserve]' });
await shot(guest, 'g05_stay_results_full', { fullPage: true }, {
  reserve: '.room-card:has(.room-no:text-is("Deluxe")) >> nth=0 >> [data-reserve]',
  deluxe: '.room-card:has(.room-no:text-is("Deluxe")) >> nth=0',
  total: '.room-card:has(.room-no:text-is("Deluxe")) >> nth=0 >> .stay-total',
});

await guest.click('.room-card:has(.room-no:text-is("Deluxe")) >> nth=0 >> [data-reserve]');
await guest.waitForSelector('dialog[open] textarea[name="notes"]');
await guest.fill('dialog textarea[name="notes"]', 'We arrive in the evening. A quiet room would be lovely.');
await shot(guest, 'g06_reserve_dialog', {}, { send: 'dialog button[type="submit"]', summary: 'dialog .quote-box' });
await guest.click('dialog button[type="submit"]');
await guest.waitForSelector('.trip');
await shot(guest, 'g07_trips_pending', {}, { card: '.trip', note: '.trip-note', badge: '.trip .badge', money: '.trip-money', ...NAV });

await go(guest, '#/services');
await guest.waitForSelector('.service-card');
await shot(guest, 'g08_services', {}, {
  request: '.service-card:has(h3:text-is("Airport pickup")) [data-request-service]',
  card: '.service-card:has(h3:text-is("Airport pickup"))',
});
await shot(guest, 'g08_services_full', { fullPage: true }, {
  request: '.service-card:has(h3:text-is("Airport pickup")) [data-request-service]',
  card: '.service-card:has(h3:text-is("Airport pickup"))',
});
await guest.click('.service-card:has(h3:text-is("Airport pickup")) [data-request-service]');
await guest.waitForSelector('dialog[open] input[name="date"]');
await guest.fill('dialog input[name="date"]', plusDays(12));
await guest.selectOption('dialog select[name="bookingId"]', { index: 1 });
await guest.fill('dialog textarea[name="notes"]', 'Flight PR 104, landing at 6:40 pm.');
await shot(guest, 'g09_service_dialog', {}, { send: 'dialog button[type="submit"]' });
await guest.click('dialog button[type="submit"]');
await guest.waitForSelector('tbody tr');
// The requests table is wider than the phone, so the guest swipes it to see the status column.
const toEnd = () => guest.evaluate(() => { scrollTo(0, document.documentElement.scrollHeight); document.querySelector('.table-wrap').scrollLeft = 260; });
await toEnd();
// the toast would sit on top of the status badge, so this frame is taken once it is out of the way
await guest.evaluate(() => document.querySelectorAll('.toast').forEach((el) => { el.style.visibility = 'hidden'; }));
await shot(guest, 'g10v_requested_view', {}, { row: 'tbody tr', badge: 'tbody tr .badge' });
await guest.evaluate(() => { scrollTo(0, 0); document.querySelector('.table-wrap').scrollLeft = 0; });
await shot(guest, 'g10_services_requested', { fullPage: true }, { row: 'tbody tr', badge: 'tbody tr .badge' });

await go(guest, '#/messages');
await shot(guest, 'g11a_messages_empty', {}, { add: '#add' });
await guest.click('#add');
await guest.waitForSelector('dialog[open] input[name="subject"]');
await guest.fill('dialog input[name="subject"]', 'Early check-in?');
await guest.fill('dialog textarea[name="message"]', 'Our flight lands early. Could we check in around 11 am?');
await shot(guest, 'g11_inquiry_dialog', {}, { send: 'dialog button[type="submit"]' });
await guest.click('dialog button[type="submit"]');
await guest.waitForSelector('.message');
await shot(guest, 'g12_messages_waiting', {}, { card: '.message', badge: '.message .badge' });

// ---------------------------------------------------------------- the hotel, on a desktop
await mgr.goto('/#/dashboard');
await mgr.waitForSelector('.attention');
await mgr.waitForTimeout(1500);
await shot(mgr, 'm01_dashboard', {}, {
  banner: '.attention',
  occupancy: '.stats .stat >> nth=0',
  arrivals: '.stats .stat >> nth=1',
  departures: '.stats .stat >> nth=2',
  inhouse: '.stats .stat >> nth=3',
  revenue: '.stats .stat >> nth=4',
  outstanding: '.stats .stat >> nth=5',
  forecast: '.hero',
  sidebar: '.sidebar',
  theme: '.sidebar .theme-toggle',
});
await shot(mgr, 'm01_dashboard_full', { fullPage: true }, { requests: '.panels .wide', confirm: '.panels .wide button[data-bstatus="Confirmed"]' });
// the same screen in the dark theme, taken now so its numbers match the light one
await mgr.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
await shot(mgr, 'm01d_dashboard_dark');
await mgr.evaluate(() => { document.documentElement.dataset.theme = 'light'; });

await go(mgr, '#/calendar');
await mgr.waitForSelector('.cal-item');
await shot(mgr, 'm02_calendar', {}, {
  toolbar: '.cal-toolbar', card: '.cal-card', pending: '.cal-item.pending >> nth=0', add: '#add',
  room301: '.cal-row:has-text("301")', legend: '.cal-legend',
});

await go(mgr, '#/bookings');
await mgr.click('[data-filter="pending"]');
await settleOnly(mgr, 600);
await shot(mgr, 'm03_bookings_pending', {}, {
  chips: '.chips', row: 'tbody tr:has-text("Maria Santos")',
  confirm: 'tbody tr:has-text("Maria Santos") button[data-act="confirm"]',
});

// A new booking, made by staff from the calendar: the form shows only the rooms that are really free.
await go(mgr, '#/calendar');
await mgr.waitForSelector('.cal-item');
await mgr.click('#add');
await mgr.waitForSelector('dialog[open] select[name="roomId"]');
await mgr.fill('dialog input[name="checkIn"]', plusDays(2));
await mgr.fill('dialog input[name="checkOut"]', plusDays(5));
await mgr.dispatchEvent('dialog input[name="checkOut"]', 'change');
await mgr.waitForTimeout(1200);
const firstRoom = await mgr.$eval('dialog select[name="roomId"]', (s) => s.options[1]?.value);
await mgr.selectOption('dialog select[name="roomId"]', firstRoom);
await mgr.selectOption('dialog select[name="guestId"]', '__new__');
await mgr.fill('dialog input[name="newGuestName"]', 'Ramon dela Cruz');
await shot(mgr, 'm04_new_booking', {}, {
  dialog: 'dialog', hint: '[data-info="availability"] .hint', room: 'dialog select[name="roomId"]',
  summary: '[data-info="summary"] .hint', save: 'dialog button[type="submit"]',
});
await mgr.keyboard.press('Escape');
await mgr.waitForTimeout(500);

// Confirm Maria's reservation.
await go(mgr, '#/bookings');
await mgr.click('[data-filter="pending"]');
await settleOnly(mgr, 500);
await mgr.click('tbody tr:has-text("Maria Santos") button[data-act="confirm"]');
await mgr.waitForTimeout(1200);
await shot(mgr, 'm03b_bookings_after_confirm', {}, { chips: '.chips' });
// what Maria sees the moment the hotel confirms (before the airport pickup is approved)
await guest.reload();
await guest.waitForSelector('#nav a');
await go(guest, '#/trips');
await guest.waitForSelector('.trip');
await shot(guest, 'g13a_trips_confirmed_first', {}, { card: '.trip', badge: '.trip .badge', money: '.trip-money' });

// Answer her question.
await go(mgr, '#/inquiries');
await shot(mgr, 'm06a_inquiries_before', {}, { row: 'tbody tr:has-text("Maria Santos")', reply: 'tbody tr:has-text("Maria Santos") button[data-act="reply"]' });
await mgr.click('tbody tr:has-text("Maria Santos") button[data-act="reply"]');
await mgr.waitForSelector('dialog[open] textarea[name="reply"]');
await mgr.fill('dialog textarea[name="reply"]', 'Yes, from 11 am. We will have your room ready when you arrive. See you soon!');
await shot(mgr, 'm05_reply_dialog', {}, { dialog: 'dialog', text: 'dialog textarea[name="reply"]', send: 'dialog button[type="submit"]', quote: 'dialog .quote-box' });
await mgr.click('dialog button[type="submit"]');
await mgr.waitForTimeout(1200);
await shot(mgr, 'm06_inquiries', {}, { row: 'tbody tr:has-text("Maria Santos")' });

// Confirm her airport pickup.
await go(mgr, '#/requests');
await shot(mgr, 'm07_service_requests_before', {}, {
  row: 'tbody tr:has-text("Maria Santos")', confirm: 'tbody tr:has-text("Maria Santos") button[data-act="confirm"]',
});
await mgr.click('tbody tr:has-text("Maria Santos") button[data-act="confirm"]');
await mgr.waitForTimeout(1200);
await shot(mgr, 'm08_service_requests', {}, { row: 'tbody tr:has-text("Maria Santos")' });

await go(mgr, '#/rooms');
await mgr.waitForTimeout(800);
await shot(mgr, 'm09_rooms');

await go(mgr, '#/dashboard', 1800);
await shot(mgr, 'm10_dashboard_after', {}, { forecast: '.hero', banner: '.attention' });

// A dark-theme dashboard for the opening.
await mgr.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
await mgr.waitForTimeout(700);
await shot(mgr, 'm11_dashboard_dark', {}, { banner: '.attention', forecast: '.hero', occupancy: '.stats .stat >> nth=0' });
await go(mgr, '#/calendar', 1300);
await shot(mgr, 'm12_calendar_dark');
await mgr.evaluate(() => { document.documentElement.dataset.theme = 'light'; });

// ---------------------------------------------------------------- the guest, after the hotel has answered
await guest.reload();
await guest.waitForSelector('#nav a');
await go(guest, '#/trips');
await guest.waitForSelector('.trip');
await shot(guest, 'g13_trips_confirmed', {}, { card: '.trip', badge: '.trip .badge', money: '.trip-money' });
await go(guest, '#/messages');
await guest.waitForSelector('.reply-box');
await shot(guest, 'g14_messages_reply', {}, { card: '.message', reply: '.reply-box', badge: '.message .badge' });
await go(guest, '#/services');
await guest.waitForSelector('tbody tr');
await toEnd();
await shot(guest, 'g15v_confirmed_view', {}, { row: 'tbody tr', badge: 'tbody tr .badge' });
await guest.evaluate(() => { scrollTo(0, 0); document.querySelector('.table-wrap').scrollLeft = 0; });
await shot(guest, 'g15_services_confirmed', { fullPage: true }, { row: 'tbody tr', badge: 'tbody tr .badge' });

writeFileSync(`${OUT}/anchors.json`, JSON.stringify(anchors, null, 1));
console.log('wrote anchors.json');
await browser.close();
console.log('done');

function settleOnly(page, ms) { return page.waitForTimeout(ms); }
