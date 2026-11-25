// Hotel PMS: pure function of time. window.seek(t) paints frame t (see lib/motion.js).
// Timing is in beats (u) on the measured grid (92 bpm); docs/shotlist.md is the plan this file follows,
// and audio/vo_phrases.json says when each line of the voice is spoken (lines start on beats 1, 11, 24, 37, 47, 58, 67, 81).
// Every screen is a real capture of the app (assets/shots, positions in assets/shots/anchors.json):
// the hotel's side is a desktop window, the guest's side is a phone drawn here around the real mobile screens.
import * as M from './lib/motion.js';

const { W, H, E, TAU, clamp, lerp, prog, kf, springU, springKeys, SPRING, bump, font, layout, glyph, text, rrect, mix } = M;

const DISPLAY = 'Display', UI = 'UI';
const C = { ink: '#14102e', white: '#ffffff', lav: '#cfc8f6', mute: '#8a82bf', accent: '#7c5cff', accentLt: '#a893ff', night: '#06041a' };
const SNAP = SPRING.snappy, GENTLE = SPRING.gentle, BOUNCY = SPRING.bouncy;
const WHIP = { stiffness: 260, damping: 32 };      // a pan that crosses the frame fast and still lands softly
const LAND = { stiffness: 200, damping: 21 };      // heavy things arriving: one small overshoot

const SHOTS = [
  'm01_dashboard', 'm01d_dashboard_dark', 'm02_calendar', 'm03_bookings_pending', 'm03b_bookings_after_confirm', 'm04_new_booking',
  'm05_reply_dialog', 'm06a_inquiries_before', 'm06_inquiries', 'm07_service_requests_before', 'm08_service_requests',
  'g01_register_empty_full', 'g02_register_filled_full', 'g03_stay_browse_full', 'g04_stay_dates', 'g05_stay_results_full',
  'g06_reserve_dialog', 'g07_trips_pending', 'g08_services', 'g09_service_dialog', 'g10v_requested_view', 'g11a_messages_empty',
  'g11_inquiry_dialog', 'g12_messages_waiting', 'g13a_trips_confirmed_first', 'g13_trips_confirmed', 'g14_messages_reply',
  'g15v_confirmed_view',
];

let A = {};                                         // where things are on each capture (css px), from capture.mjs
const box = (shot, key) => A[shot][key];
const mid = (b) => [b.x + b.w / 2, b.y + b.h / 2];

// ------------------------------------------------------------------ the beat sheet
// Everything that happens on screen, in beats. HITS (below) voices the same numbers.
const EV = {
  hookMeet: -0.2, hookHotel: 1.0, hookPms: 1.8, hookOut: 3.4, morph: [3.5, 5.4],
  runYourHotel: 5.9, delight: 7.5, cursorTheme: 9.2, themeClick: 10.85, lightReveal: [10.95, 11.9],
  glance: 11.5, tour: [15.4, 17.0, 18.8, 20.3], whip: 23.3,
  everyRoom: 24.4, pendingPulse: 27.5, newBookingClick: 28.9, dialogOpen: 29.0, exitHotel: 36.1,
  phoneIn: 36.5, formWipe: [42.3, 42.7, 43.0, 43.3, 43.6, 43.9], submitTap: 44.55, stayPush: 44.9,
  datesWipe: [47.6, 48.2], resultsFade: 48.8, reserveTap: 51.95, reserveOpen: 52.25, sendTap: 54.3, pending: 54.65,
  servicesTap: 57.95, servicesPush: 58.3, requestTap: 60.7, svcDialog: 61.0, svcSendTap: 62.4, requested: 62.7,
  messagesPush: 63.85, newInquiryTap: 64.35, inquiryDialog: 64.65, inquirySendTap: 65.85, waiting: 66.15,
  split: 66.3, confirmClick: 68.3, replyClick: 69.6, sendClick: 70.9, approveClick: 72.2, soloAgain: 76.1,
  end: 81.0,
};

// ------------------------------------------------------------------ text
// Per-glyph rise out of a mask: each letter springs up from its baseline, then leaves upward at `out`.
function rise(ctx, str, x, base, size, u, u0, color, o = {}) {
  const f = font(size, o.weight ?? 800, o.face ?? DISPLAY), track = (o.track ?? -0.03) * size;
  const L = layout(ctx, str, f, track);
  const outU = o.out ?? 1e9;
  ctx.save();
  ctx.beginPath(); ctx.rect(x - size * 0.3, base - size * 1.1, L.width + size * 0.6, size * 1.4); ctx.clip();
  L.glyphs.forEach((g, j) => {
    const k = springU(u, u0 + j * 0.03, o.cfg ?? BOUNCY);
    if (k <= 0.001) return;
    const ex = E.inCubic(prog(u, outU + j * 0.012, outU + 0.55 + j * 0.012));
    if (ex >= 1) return;
    glyph(ctx, g.ch, x + g.cx, base + (1 - k) * size * 0.95 - ex * size * 1.2, f, typeof color === 'function' ? color(u) : color);
  });
  ctx.restore();
  return L.width;
}

// A stack of short lines in the left column. spec: [[text, beat, colour?], ...]; the whole stack
// shrinks to fit maxW so no caption ever reaches the screen it sits beside.
function lines(ctx, u, spec, out, o = {}) {
  if (u < spec[0][1] - 0.2 || u > out + 1.2) return;
  const size0 = o.size ?? 72, maxW = o.maxW ?? 450, x = o.x ?? 96, cy = o.cy ?? 540, lead = o.lead ?? 1.1;
  let widest = 1;
  for (const [t] of spec) widest = Math.max(widest, layout(ctx, t, font(size0, 800, DISPLAY), -0.03 * size0).width);
  const size = Math.floor(Math.min(size0, (size0 * maxW) / widest));
  const base0 = cy - ((spec.length - 1) * size * lead) / 2 + size * 0.36;
  spec.forEach(([t, u0, color], i) => rise(ctx, t, x, base0 + i * size * lead, size, u, u0, color ?? C.white, { out: out + i * 0.08 }));
}

function chip(ctx, str, x, y, u, u0, size = 34) {
  const k = springU(u, u0, BOUNCY);
  if (k <= 0.001) return;
  ctx.save();
  ctx.font = font(size, 700, UI);
  const w = ctx.measureText(str).width + size * 1.3, h = size * 1.8;
  ctx.translate(x, y); ctx.scale(k, k);
  rrect(ctx, -w / 2, -h / 2, w, h, h / 2); ctx.fillStyle = C.accent; ctx.fill();
  text(ctx, str, 0, size * 0.36, font(size, 700, UI), C.white, 'center');
  ctx.restore();
}

// ------------------------------------------------------------------ shapes
function background(ctx) {
  const g = ctx.createLinearGradient(W, 0, 0, H);
  g.addColorStop(0, '#1b1546'); g.addColorStop(1, '#0f0b24');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
}
function shadowRect(ctx, x, y, w, h, r, color) {
  ctx.save();
  ctx.shadowColor = 'rgba(4,2,20,0.62)'; ctx.shadowBlur = 64; ctx.shadowOffsetY = 34;
  rrect(ctx, x, y, w, h, r); ctx.fillStyle = color; ctx.fill();
  ctx.restore();
}
// The brand mark: the app's bed icon (24 x 24 grid), drawn as strokes.
const BED = ['M3 19V6', 'M3 15h18v4', 'M21 15v-3a3 3 0 0 0-3-3h-8v6'];
function bedIcon(ctx, cx, cy, size, color = C.white, alpha = 1) {
  if (alpha <= 0.001) return;
  ctx.save();
  ctx.translate(cx - size / 2, cy - size / 2); ctx.scale(size / 24, size / 24);
  ctx.globalAlpha *= alpha; ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (const d of BED) ctx.stroke(new Path2D(d));
  ctx.beginPath(); ctx.arc(6.5, 11, 1.7, 0, TAU); ctx.stroke();
  ctx.restore();
}
// A dimmed layer with a clear window cut out of it: where to look, without drawing on the UI.
function spotlight(ctx, b, a, pad = 10, r = 18) {
  if (a <= 0.01) return;
  ctx.save();
  ctx.beginPath(); ctx.rect(-80, -80, 1700, 1100);
  ctx.roundRect(b[0] - pad, b[1] - pad, b[2] + 2 * pad, b[3] + 2 * pad, r);
  ctx.fillStyle = `rgba(16,12,40,${a})`; ctx.fill('evenodd');
  ctx.restore();
}
const boxArr = (b) => [b.x, b.y, b.w, b.h];

// A mouse pointer, drawn in window css px at a constant on-screen size (s = css to canvas scale).
function cursor(ctx, x, y, s, press, alpha = 1) {
  if (alpha <= 0.01) return;
  ctx.save();
  ctx.translate(x, y); const k = (1.7 / s) * (1 - 0.1 * press); ctx.scale(k, k);
  ctx.globalAlpha *= alpha;
  if (press > 0.01) { ctx.beginPath(); ctx.arc(0, 0, 8 + 22 * (1 - press), 0, TAU); ctx.strokeStyle = C.accent; ctx.lineWidth = 3; ctx.globalAlpha *= press; ctx.stroke(); ctx.globalAlpha = alpha; }
  ctx.beginPath();
  ctx.moveTo(0, 0); ctx.lineTo(0, 17); ctx.lineTo(4.4, 13.2); ctx.lineTo(7.4, 20); ctx.lineTo(10, 18.8); ctx.lineTo(7.1, 12.2); ctx.lineTo(12.6, 12.2); ctx.closePath();
  ctx.fillStyle = '#111'; ctx.fill(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.6; ctx.stroke();
  ctx.restore();
}
// Positions along a path of [beat, [x, y]] stops, eased between them.
const along = (u, keys) => kf(u, keys, E.inOutCubic);

// ------------------------------------------------------------------ the hotel: a desktop window
const WIN = { x: 560, y: 132, w: 1264 };
WIN.h = WIN.w * 0.625; WIN.s = WIN.w / 1440; WIN.tx = WIN.x + WIN.w / 2; WIN.ty = WIN.y + WIN.h / 2;
const camMap = (rect, cx, cy, z) => { const s = (rect.w / 1440) * z; return { s, ox: rect.tx - s * cx, oy: rect.ty - s * cy }; };

function drawWindow(ctx, img, x = 0, alpha = 1) {
  rrect(ctx, x, 0, 1440, 900, 26); ctx.save(); ctx.clip();
  ctx.globalAlpha *= alpha; ctx.drawImage(img, x, 0, 1440, 900);
  ctx.restore();
}

// the calendar window sits this far right of the dashboard (css px): far enough that the dashboard is fully gone once the whip lands
const GAP = 2080;
// camera: [window-local centre x, y, zoom]; whip carries the world from one window to the next
const CAM = [
  [0, [720, 450, 1]],
  [15.4, [426, 262, 2.1]],      // occupancy
  [17.0, [711, 262, 2.1]],      // arrivals
  [18.8, [996, 262, 2.1]],      // departures
  [20.3, [610, 200, 1.85]],     // everything waiting for a reply: the banner's own words
  [23.3, [720, 450, 1]],        // calendar (the pan carries the window across)
  [25.4, [560, 330, 1.28]],
  [27.3, [900, 260, 1.28]],
  [28.8, [720, 450, 1]],
  [29.4, [720, 430, 1.25]],     // new booking dialog
  [30.1, [720, 300, 2.05]],     // "5 rooms available for 3 nights"
  [31.7, [720, 345, 2.05]],     // the room, priced
  [34.3, [720, 745, 2.05]],     // the total
  [36.0, [720, 450, 1]],
];

function hotelWorld(ctx, u, I) {
  if (u < EV.morph[1] - 0.05 || u > 38) return;
  const cam = springKeys(u, CAM, GENTLE);
  const pan = GAP * springU(u, EV.whip, WHIP);
  const push = kf(u, [[5.2, 1], [15.4, 1.09], [16.0, 1]], E.inOutSine);   // a slow push while the day is described
  const z = cam[2] * push;
  const m = camMap(WIN, cam[0] + pan, cam[1], z);
  const leave = E.inCubic(prog(u, EV.exitHotel, EV.exitHotel + 0.9));
  if (leave >= 1) return;

  ctx.save();
  ctx.translate(-leave * 2600, 0);
  ctx.translate(m.ox, m.oy); ctx.scale(m.s, m.s);

  // window A: the dashboard, dark, then lit by the theme switch
  shadowRect(ctx, 0, 0, 1440, 900, 26, '#d9d3ff');
  ctx.save();
  rrect(ctx, 0, 0, 1440, 900, 26); ctx.clip();
  ctx.drawImage(I.m01d_dashboard_dark, 0, 0, 1440, 900);
  const [tx, ty] = mid(box('m01_dashboard', 'theme'));
  const R = E.inOutCubic(prog(u, EV.lightReveal[0], EV.lightReveal[1])) * 2400;
  if (R > 0) { ctx.save(); ctx.beginPath(); ctx.arc(tx, ty, R, 0, TAU); ctx.clip(); ctx.drawImage(I.m01_dashboard, 0, 0, 1440, 900); ctx.restore(); }
  // where to look while the voice names occupancy, arrivals, departures, replies
  const spotKeys = [[0, boxArr(box('m01_dashboard', 'occupancy'))], [EV.tour[1] - 0.2, boxArr(box('m01_dashboard', 'arrivals'))],
    [EV.tour[2] - 0.2, boxArr(box('m01_dashboard', 'departures'))], [EV.tour[3] - 0.2, boxArr(box('m01_dashboard', 'banner'))]];
  const spotA = 0.68 * clamp(springU(u, EV.tour[0] - 0.3, SNAP) - springU(u, EV.whip - 0.4, SNAP), 0, 1);
  spotlight(ctx, springKeys(u, spotKeys, SNAP), spotA);
  // the pointer that switches the theme
  const cp = along(u, [[EV.cursorTheme - 0.3, [1020, 640]], [EV.themeClick - 0.15, [tx + 2, ty + 2]]]);
  cursor(ctx, cp[0], cp[1], m.s, bump(u, EV.themeClick, 0.4), clamp(prog(u, EV.cursorTheme - 0.3, EV.cursorTheme) - prog(u, EV.themeClick + 0.4, EV.themeClick + 0.9)));
  ctx.restore();

  // window B: the calendar, and the new booking dialog opening over it
  ctx.save(); ctx.translate(GAP, 0);
  shadowRect(ctx, 0, 0, 1440, 900, 26, '#d9d3ff');
  ctx.save();
  rrect(ctx, 0, 0, 1440, 900, 26); ctx.clip();
  ctx.drawImage(I.m02_calendar, 0, 0, 1440, 900);
  const pb = box('m02_calendar', 'pending');
  const pulse = bump(u, EV.pendingPulse, 0.55) + bump(u, EV.pendingPulse + 1.1, 0.55);
  if (pulse > 0.01) { ctx.save(); ctx.globalAlpha = clamp(pulse); ctx.strokeStyle = C.accent; ctx.lineWidth = 6; rrect(ctx, pb.x - 7, pb.y - 7, pb.w + 14, pb.h + 14, 12); ctx.stroke(); ctx.restore(); }
  const dk = springU(u, EV.dialogOpen, SNAP);
  if (dk > 0.001) {
    const d = box('m04_new_booking', 'dialog'), [dx, dy] = mid(d);
    ctx.save(); ctx.globalAlpha = clamp(dk * 1.6); ctx.translate(dx, dy); const sc = 0.92 + 0.08 * Math.min(dk, 1.12); ctx.scale(sc, sc); ctx.translate(-dx, -dy);
    ctx.drawImage(I.m04_new_booking, 0, 0, 1440, 900); ctx.restore();
    const k = [[0, boxArr(box('m04_new_booking', 'hint'))], [31.5, boxArr(box('m04_new_booking', 'room'))], [34.1, boxArr(box('m04_new_booking', 'summary'))]];
    spotlight(ctx, springKeys(u, k, SNAP), 0.62 * clamp(springU(u, 29.9, SNAP) - springU(u, 35.8, SNAP), 0, 1), 8, 12);
  }
  const [bx, by] = mid(box('m02_calendar', 'add'));
  const c2 = along(u, [[EV.pendingPulse + 0.2, [1010, 330]], [EV.newBookingClick - 0.15, [bx + 3, by + 3]]]);
  cursor(ctx, c2[0], c2[1], m.s, bump(u, EV.newBookingClick, 0.4),
    clamp(prog(u, EV.pendingPulse + 0.2, EV.pendingPulse + 0.8) - prog(u, EV.newBookingClick + 0.35, EV.newBookingClick + 0.8)));
  ctx.restore(); ctx.restore();
  ctx.restore();

  // the window slides under the captions when it is zoomed: a shade keeps them legible
  const shade = clamp((z - 1.08) / 0.15) * (1 - leave);
  if (shade > 0.01) {
    const g = ctx.createLinearGradient(0, 0, 780, 0);
    g.addColorStop(0, `rgba(20,16,46,${0.97 * shade})`); g.addColorStop(0.6, `rgba(20,16,46,${0.9 * shade})`); g.addColorStop(1, 'rgba(20,16,46,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 780, H);
  }
  // captions for the hotel half (left column)
  lines(ctx, u, [['Run your', EV.runYourHotel], ['hotel.', EV.runYourHotel + 0.2, C.accentLt], ['Delight', EV.delight], ['every', EV.delight + 0.2], ['guest.', EV.delight + 0.4, C.accentLt]], 10.9);
  lines(ctx, u, [['Your day,', EV.glance], ['at a', EV.glance + 0.25], ['glance.', EV.glance + 0.5, C.accentLt]], 14.4);
  const li = EV.tour, dim = (n) => (uu) => mix(C.white, C.mute, prog(uu, li[n] + 1.2, li[n] + 1.6));
  lines(ctx, u, [['Occupancy', li[0], dim(0)], ['Arrivals', li[1], dim(1)], ['Departures', li[2], dim(2)], ['Replies', li[3], C.accentLt]], 23.0, { size: 74, lead: 1.25 });
  lines(ctx, u, [['Every room,', EV.everyRoom], ['one', EV.everyRoom + 0.4], ['calendar.', EV.everyRoom + 0.6, C.accentLt]], 27.4);
  lines(ctx, u, [['Pick the', 28.6], ['dates.', 28.85, C.accentLt]], 29.3);
  lines(ctx, u, [['Only free', 30.3], ['rooms.', 30.55, C.accentLt]], 32.7);
  lines(ctx, u, [['Priced', 34.0], ['in pesos.', 34.25, C.accentLt]], 35.5);
}

// ------------------------------------------------------------------ the guest: a phone
const PH = { w: 390, h: 872, band: 28 };       // screen in css px: a 28 px status band over the 844 px app screen
const PHONE_REST = { cx: 1290, cy: 540, ps: 1.03 };

// a real mobile screen (3x capture) drawn under the status band; `scroll` is in css px
function shot(ctx, img, scroll = 0) {
  const sMax = Math.max(0, img.height / 3 - 844);
  ctx.drawImage(img, 0, clamp(scroll, 0, sMax) * 3, 1170, 844 * 3, 0, PH.band, 390, 844);
}
const wipe = (ctx, img, scroll, r, p) => {       // reveal `img` over part of a field, left to right, like text arriving
  if (p <= 0) return;
  ctx.save(); ctx.beginPath(); ctx.rect(r.x, r.y - scroll + PH.band, r.w * p, r.h); ctx.clip(); shot(ctx, img, scroll); ctx.restore();
};

// the guest's pages, in order. kind: push (slides in like the app), fade, pop (a dialog opening)
const FIELDS = ['name', 'email', 'phone', 'username', 'password', 'confirm'];
const PAGES = [
  { u0: -1, draw: (ctx, u, I) => {
    const sc = kf(u, [[43.7, 0], [44.5, 150]]);
    shot(ctx, I.g01_register_empty_full, sc);
    FIELDS.forEach((f, i) => wipe(ctx, I.g02_register_filled_full, sc, box('g01_register_empty_full', f), E.outCubic(prog(u, EV.formWipe[i], EV.formWipe[i] + 0.45))));
  } },
  { u0: EV.stayPush, kind: 'push', draw: (ctx, u, I) => {
    shot(ctx, I.g03_stay_browse_full, kf(u, [[45.3, 0], [46.7, 560], [47.45, 0]]));
    ['checkIn', 'checkOut'].forEach((k, i) => wipe(ctx, I.g04_stay_dates, 0, box('g04_stay_dates', k), E.outCubic(prog(u, EV.datesWipe[i], EV.datesWipe[i] + 0.5))));
  } },
  { u0: EV.resultsFade, kind: 'fade', draw: (ctx, u, I) => shot(ctx, I.g05_stay_results_full, kf(u, [[49.3, 0], [51.4, 952]])) },
  { u0: EV.reserveOpen, kind: 'pop', draw: (ctx, u, I) => shot(ctx, I.g06_reserve_dialog) },
  { u0: EV.pending, kind: 'fade', draw: (ctx, u, I) => shot(ctx, I.g07_trips_pending) },
  { u0: EV.servicesPush, kind: 'push', draw: (ctx, u, I) => shot(ctx, I.g08_services) },
  { u0: EV.svcDialog, kind: 'pop', draw: (ctx, u, I) => shot(ctx, I.g09_service_dialog) },
  { u0: EV.requested, kind: 'fade', draw: (ctx, u, I) => shot(ctx, I.g10v_requested_view) },
  { u0: EV.messagesPush, kind: 'push', draw: (ctx, u, I) => shot(ctx, I.g11a_messages_empty) },
  { u0: EV.inquiryDialog, kind: 'pop', draw: (ctx, u, I) => shot(ctx, I.g11_inquiry_dialog) },
  { u0: EV.waiting, kind: 'fade', draw: (ctx, u, I) => shot(ctx, I.g12_messages_waiting) },
  // with the hotel beside it
  { u0: 67.0, kind: 'push', draw: (ctx, u, I) => shot(ctx, I.g07_trips_pending) },
  { u0: 69.25, kind: 'fade', dur: 0.25, draw: (ctx, u, I) => shot(ctx, I.g13a_trips_confirmed_first) },
  { u0: 71.8, kind: 'push', draw: (ctx, u, I) => shot(ctx, I.g14_messages_reply) },
  { u0: 73.1, kind: 'push', draw: (ctx, u, I) => shot(ctx, I.g15v_confirmed_view) },
  { u0: 76.4, kind: 'push', draw: (ctx, u, I) => shot(ctx, I.g13a_trips_confirmed_first) },
  { u0: 77.55, kind: 'fade', dur: 0.3, draw: (ctx, u, I) => shot(ctx, I.g13_trips_confirmed) },
];

function pageLayer(ctx, page, u, I, dx, a, sc = 1) {
  if (a <= 0.003) return;
  ctx.save();
  ctx.beginPath(); ctx.rect(0, PH.band, PH.w, PH.h - PH.band); ctx.clip();
  ctx.globalAlpha *= a;
  ctx.translate(PH.w / 2 + dx, PH.h / 2 + PH.band / 2); ctx.scale(sc, sc); ctx.translate(-PH.w / 2, -(PH.h / 2 + PH.band / 2));
  page.draw(ctx, page.frozen ?? u, I);
  ctx.restore();
}

function phoneScreen(ctx, u, I) {
  // status band: the top rows of the page, stretched, so it always matches the page behind it
  ctx.drawImage(I.g03_stay_browse_full, 0, 0, 1170, 8, 0, 0, 390, PH.band);
  let i = 0;
  for (let n = 0; n < PAGES.length; n++) if (u >= PAGES[n].u0) i = n;
  const cur = PAGES[i], prev = PAGES[i - 1];
  if (!prev) { pageLayer(ctx, cur, u, I, 0, 1); }
  else {
    const t = u - cur.u0, kind = cur.kind;
    const k = kind === 'push' ? springU(u, cur.u0, SNAP) : clamp(t / ((cur.dur ?? 0.35)));
    prev.frozen = Math.min(u, cur.u0);
    if (kind === 'push') {
      pageLayer(ctx, prev, u, I, -110 * k, 1);
      ctx.fillStyle = `rgba(20,16,46,${0.3 * k})`; ctx.fillRect(0, PH.band, PH.w, PH.h);
      pageLayer(ctx, cur, u, I, (1 - k) * PH.w, 1);
    } else {
      pageLayer(ctx, prev, u, I, 0, 1);
      if (kind === 'pop') { ctx.fillStyle = `rgba(20,16,46,${0.18 * k})`; ctx.fillRect(0, PH.band, PH.w, PH.h); }
      pageLayer(ctx, cur, u, I, 0, E.outCubic(k), kind === 'pop' ? 1.04 - 0.04 * E.outCubic(k) : 1);
    }
  }
}

// a finger: arrives, presses, ripples. (x, y) are phone css px
function tap(ctx, u, u0, x, y) {
  const q = u - u0;
  if (q < -0.8 || q > 1.1) return;
  const near = E.outCubic(prog(q, -0.8, 0));
  const fx = x + (1 - near) * 46, fy = y + (1 - near) * 90;
  const a = clamp((q + 0.8) / 0.3) * (1 - prog(q, 0.45, 0.85));
  const press = 1 - 0.18 * bump(q, 0.08, 0.2);
  ctx.save(); ctx.translate(fx, fy);
  ctx.globalAlpha = a * 0.9; ctx.beginPath(); ctx.arc(0, 0, 17 * press, 0, TAU);
  ctx.fillStyle = 'rgba(32,22,90,0.32)'; ctx.fill(); ctx.strokeStyle = 'rgba(255,255,255,0.95)'; ctx.lineWidth = 2; ctx.stroke();
  ctx.restore();
  if (q > 0) { const p = E.outCubic(prog(q, 0, 0.85)); ctx.save(); ctx.globalAlpha = (1 - p) * 0.6; ctx.strokeStyle = C.accent; ctx.lineWidth = 3.5; ctx.beginPath(); ctx.arc(x, y, 17 + 54 * p, 0, TAU); ctx.stroke(); ctx.restore(); }
}

// where the guest taps, in phone css px (page positions come from the captures; the 28 px band sits on top)
const tapSpots = () => {
  const c = (s, k) => mid(box(s, k));
  const [sx, sy] = c('g02_register_filled_full', 'submit'), [rx, ry] = c('g05_stay_results_full', 'reserve');
  const [ex, ey] = c('g06_reserve_dialog', 'send'), [nx, ny] = c('g07_trips_pending', 'nav2'), [qx, qy] = c('g08_services', 'request');
  const [vx, vy] = c('g09_service_dialog', 'send'), [ax, ay] = c('g11a_messages_empty', 'add'), [ix, iy] = c('g11_inquiry_dialog', 'send');
  const [mx, my] = c('g07_trips_pending', 'nav1');
  return [
    [EV.submitTap, sx, sy - 150 + PH.band], [EV.reserveTap, rx, ry - 952 + PH.band], [EV.sendTap, ex, ey + PH.band],
    [EV.servicesTap, nx, ny + PH.band], [EV.requestTap, qx, qy + PH.band], [EV.svcSendTap, vx, vy + PH.band],
    [EV.newInquiryTap, ax, ay + PH.band], [EV.inquirySendTap, ix, iy + PH.band], [66.9, mx, my + PH.band],
  ];
};

// the phone's own camera: [zoom, css x, css y] about a point on its screen
const PHONE_ZOOM = [
  [0, [1, 195, 436]],
  [42.0, [1.25, 195, 470]], [44.3, [1, 195, 436]],       // the form fills in
  [47.2, [1.35, 195, 360]], [49.0, [1, 195, 436]],       // the dates
  [52.6, [1.3, 195, 366]], [54.1, [1, 195, 436]],
  [58.7, [1.3, 195, 360]], [61.3, [1, 195, 436]],        // the airport pickup card
  [55.0, [1.45, 215, 392]], [57.7, [1, 195, 436]],
  [62.8, [1.5, 259, 789]], [63.7, [1, 195, 436]],
  [73.3, [1.4, 259, 789]], [76.2, [1, 195, 436]],
  [76.8, [1.3, 195, 417]], [80.2, [1, 195, 436]],
];

function drawPhone(ctx, cx, cy, ps, rot, zoom, u, I) {
  const [z, fx, fy] = zoom;
  const sw = PH.w * ps, sh = PH.h * ps;
  const px = cx - sw / 2 + fx * ps, py = cy - sh / 2 + fy * ps;
  const ncx = px + z * (cx - px), ncy = py + z * (cy - py), q = ps * z;
  const w = PH.w * q, h = PH.h * q, b = 15 * q;
  ctx.save();
  ctx.translate(ncx, ncy); ctx.rotate(rot);
  shadowRect(ctx, -w / 2 - b, -h / 2 - b, w + 2 * b, h + 2 * b, 62 * q, '#0b0822');
  rrect(ctx, -w / 2 - b, -h / 2 - b, w + 2 * b, h + 2 * b, 62 * q); ctx.strokeStyle = '#3a3375'; ctx.lineWidth = 2.5; ctx.stroke();
  ctx.save();
  ctx.translate(-w / 2, -h / 2); rrect(ctx, 0, 0, w, h, 48 * q); ctx.clip(); ctx.scale(q, q);
  phoneScreen(ctx, u, I);
  for (const [t0, x, y] of tapSpots()) tap(ctx, u, t0, x, y);
  // status bar
  text(ctx, '9:41', 28, 20, font(15, 700, UI), '#1b1646');
  ctx.fillStyle = '#1b1646';
  for (let n = 0; n < 4; n++) { ctx.beginPath(); ctx.roundRect(300 + n * 6, 18 - n * 2.4, 3.6, 4 + n * 2.4, 1); ctx.fill(); }
  rrect(ctx, 330, 11, 26, 12, 3.5); ctx.strokeStyle = '#1b1646'; ctx.lineWidth = 1.4; ctx.stroke(); rrect(ctx, 332, 13, 18, 8, 2); ctx.fill();
  rrect(ctx, 146, 8, 98, 26, 13); ctx.fillStyle = C.night; ctx.fill();
  ctx.restore();
  ctx.restore();
}

// each caption is gone (out + its rise-out) before the next one starts, so two never share the same spot
const PHONE_CAPS = [
  [[['Their own', 37.4], ['app.', 37.65, C.accentLt]], 39.4],
  [[['Right on', 40.2], ['their phone.', 40.45, C.accentLt]], 42.2],
  [[['Sign up', 43.0], ['in a moment.', 43.25, C.accentLt]], 45.2],
  [[['Pick', 47.0], ['your dates.', 47.25, C.accentLt]], 48.2],
  [[["See what's", 49.0], ['available.', 49.25, C.accentLt]], 50.5],
  [[['Reserve.', 51.3, C.accentLt]], 52.6],
  [[['Waits for', 53.8], ['your approval.', 54.05, C.accentLt]], 57.2],
  [[['Order', 58.0], ['extras.', 58.25, C.accentLt]], 59.6],
  [[['Airport pickup,', 60.5], ['breakfast.', 60.75, C.accentLt]], 62.6],
  [[['Ask', 63.4], ['anything.', 63.65, C.accentLt]], 65.7],
  [[['Extras join', 76.7], ['the bill.', 76.95, C.accentLt]], 79.4],
];

// ------------------------------------------------------------------ the hotel confirms; the guest sees it
const SPLIT = { x: 96, y: 322, w: 1130 };
SPLIT.h = SPLIT.w * 0.625; SPLIT.tx = SPLIT.x + SPLIT.w / 2; SPLIT.ty = SPLIT.y + SPLIT.h / 2;
const DESK = [
  { u0: -1, img: 'm03_bookings_pending' }, { u0: 68.5, img: 'm03b_bookings_after_confirm' }, { u0: 68.95, img: 'm06a_inquiries_before' },
  { u0: 69.85, img: 'm05_reply_dialog' }, { u0: 71.05, img: 'm06_inquiries' }, { u0: 71.3, img: 'm07_service_requests_before' },
  { u0: 72.35, img: 'm08_service_requests' },
];
const DESK_CAM = [
  [0, [770, 330, 1.45]], [68.6, [770, 235, 1.45]], [69.7, [720, 440, 1.5]], [71.2, [770, 410, 1.45]], [73.1, [720, 450, 1]],
];
const DESK_CLICKS = [EV.confirmClick, EV.replyClick, EV.sendClick, EV.approveClick];

function splitWorld(ctx, u, I) {
  if (u < EV.split - 0.1 || u > 79.8) return;
  const inK = springU(u, EV.split, GENTLE), outK = springU(u, EV.soloAgain, GENTLE);
  const dx = -(1 - inK) * 1450 - outK * 1450;
  {
    const cam = springKeys(u, DESK_CAM, GENTLE);
    const m = camMap(SPLIT, cam[0], cam[1], cam[2]);
    ctx.save(); ctx.translate(dx, 0);
    // the camera moves inside the window's frame here (the phone sits beside it)
    const s0 = SPLIT.w / 1440;
    shadowRect(ctx, SPLIT.x, SPLIT.y, SPLIT.w, SPLIT.h, 26 * s0, '#d9d3ff');
    rrect(ctx, SPLIT.x, SPLIT.y, SPLIT.w, SPLIT.h, 26 * s0); ctx.clip();
    ctx.translate(m.ox, m.oy); ctx.scale(m.s, m.s);
    ctx.save();
    let i = 0; for (let n = 0; n < DESK.length; n++) if (u >= DESK[n].u0) i = n;
    if (i > 0) ctx.drawImage(I[DESK[i - 1].img], 0, 0, 1440, 900);
    ctx.globalAlpha = i > 0 ? clamp((u - DESK[i].u0) / 0.2) : 1;
    ctx.drawImage(I[DESK[i].img], 0, 0, 1440, 900);
    ctx.globalAlpha = 1;
    // the hotel's pointer
    const st = [[EV.split + 0.3, [1040, 640]], [67.9, [1213, 329]], [68.7, [1213, 329]], [69.45, [1297, 235]], [69.95, [1297, 235]],
      [70.8, [935, 596]], [71.35, [935, 596]], [72.05, [1251, 412]], [73.0, [1251, 412]], [73.6, [1330, 760]]];
    const p = along(u, st);
    const press = Math.max(...DESK_CLICKS.map((c) => bump(u, c, 0.4)));
    cursor(ctx, p[0], p[1], m.s, press, clamp(prog(u, EV.split, EV.split + 0.6) - prog(u, 73.3, 73.9)));
    ctx.restore(); ctx.restore();
  }
  // captions above the window
  const cap = (str, u0, out) => { if (u > u0 - 0.2 && u < out + 1.2) rise(ctx, str, 96, 228, 86, u, u0, C.white, { out }); };
  cap('You confirm.', 66.9, 68.5); cap('You reply.', 69.3, 69.9); cap('You approve.', 70.6, 72.8);
  if (u > 73.6 && u < 77.5) { const w1 = rise(ctx, 'They see it ', 96, 228, 86, u, 73.8, C.white, { out: 75.9 }); rise(ctx, 'instantly.', 96 + w1 * 1.0, 228, 86, u, 74.05, C.accentLt, { out: 75.9 }); }
}

// the pulse that leaves the hotel's click and arrives on the guest's screen
function pulse(ctx, u, u0, from, to) {
  const q = (u - u0) / 0.9;
  if (q < 0 || q > 1.25) return;
  for (let n = 9; n >= 0; n--) {
    const t = clamp(q - n * 0.035, 0, 1), e = E.inOutCubic(t);
    const x = lerp(from[0], to[0], e), y = lerp(from[1], to[1], e) - Math.sin(e * Math.PI) * 120;
    const a = (1 - n / 10) * (1 - clamp((q - 1) / 0.25));
    ctx.save(); ctx.globalAlpha = a; ctx.beginPath(); ctx.arc(x, y, 5 + (10 - n) * 0.9, 0, TAU);
    ctx.fillStyle = C.accent; ctx.fill(); if (n === 0) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 2.5; ctx.stroke(); }
    ctx.restore();
  }
}

function guestWorld(ctx, u, I) {
  if (u < EV.phoneIn - 0.2 || u > 81.2) return;
  const rise_ = springU(u, EV.phoneIn, LAND);
  // pose: centre-right while alone, right edge beside the hotel
  const pose = springKeys(u, [[0, [PHONE_REST.cx, PHONE_REST.ps]], [EV.split, [1592, 1.06]], [EV.soloAgain, [PHONE_REST.cx, PHONE_REST.ps]]], GENTLE);
  const y = PHONE_REST.cy + (1 - rise_) * 1250;
  const rot = (1 - rise_) * -0.11;
  const gone = E.inCubic(prog(u, 79.9, 81.0));
  const zoom = springKeys(u, PHONE_ZOOM, GENTLE);
  ctx.save();
  if (gone > 0) { ctx.translate(255, 305); ctx.scale(1 - gone, 1 - gone); ctx.translate(-255, -305); }   // shrinks into the tile of the end card
  drawPhone(ctx, pose[0], y, pose[1], rot, zoom, u, I);
  chip(ctx, '+ Airport pickup', 1745, 640, u, 77.6, 30);
  ctx.restore();
  if (gone >= 1) return;

  // pulses from the hotel into the phone (split phase)
  if (u > EV.split) {
    const phoneAt = (cssX, cssY) => [pose[0] - (PH.w * pose[1]) / 2 + cssX * pose[1], PHONE_REST.cy - (PH.h * pose[1]) / 2 + (cssY + 0) * pose[1]];
    const deskAt = (cx, cy) => { const m = camMap(SPLIT, ...springKeys(u, DESK_CAM, GENTLE)); return [m.ox + m.s * cx + Math.min(0, -(1 - springU(u, EV.split, GENTLE)) * 1450), m.oy + m.s * cy]; };
    pulse(ctx, u, EV.confirmClick + 0.1, deskAt(1213, 329), phoneAt(260, 330));
    pulse(ctx, u, EV.sendClick + 0.1, deskAt(935, 596), phoneAt(200, 420));
    pulse(ctx, u, EV.approveClick + 0.1, deskAt(1251, 412), phoneAt(260, 780));
  }
  for (const [spec, out] of PHONE_CAPS) lines(ctx, u, spec, out, { size: 96, maxW: 700, cy: 540, lead: 1.08 });
}

// ------------------------------------------------------------------ the hook (u 0..5.4): the violet block grows into the dashboard
function hook(ctx, u, I) {
  if (u > EV.morph[1]) return;
  const k = E.inOutCubic(prog(u, EV.morph[0], EV.morph[1]));
  const B = { x: 1480, y: 230, w: 700, h: 760, r: 96 };
  const rs = springU(u, -0.45, { stiffness: 170, damping: 17 });
  // the block takes a small squash as each word is spoken
  const sq = 0.04 * (M.wobble(u - EV.hookHotel, 2.4, 5) + M.wobble(u - EV.hookPms, 2.4, 5)) * (1 - k);
  const w = lerp(B.w, WIN.w, k) * (1 + sq), h = lerp(B.h, WIN.h, k) * (1 - sq);
  // it arrives from the lower right on a diagonal, already moving on frame 0
  const x = lerp(B.x + (1 - rs) * 520, WIN.x, k) - (w - lerp(B.w, WIN.w, k)) / 2, y = lerp(B.y + (1 - rs) * 620, WIN.y, k) + (lerp(B.h, WIN.h, k) - h), r = lerp(B.r, 26 * WIN.s, k);

  // the three words, one per beat of the voice: Meet / Hotel PMS.
  const size = 232, f = font(size, 800, DISPLAY), track = -0.035 * size;
  const words = [['Meet', 150, 430, EV.hookMeet, C.lav], ['Hotel PMS.', 150, 680, EV.hookHotel, C.white]];
  words.forEach(([str, wx, base, u0, color], i) => {
    const L = layout(ctx, str, f, track);
    ctx.save(); ctx.beginPath(); ctx.rect(0, base - size * 1.05, W, size * 1.35); ctx.clip();
    L.glyphs.forEach((g, j) => {
      const kk = springU(u, u0 + j * 0.05, BOUNCY);
      if (kk <= 0.001) return;
      const isPms = i === 1 && j >= 6;
      const pk = isPms ? springU(u, EV.hookPms + (j - 6) * 0.05, BOUNCY) : kk;
      if (pk <= 0.001) return;
      const ex = E.inBack(prog(u, EV.hookOut + i * 0.1 + j * 0.01, EV.hookOut + 0.65 + i * 0.1 + j * 0.01), 1.4);
      glyph(ctx, g.ch, wx + g.cx, base + (1 - pk) * size * 1.1 - ex * (H * 0.9), f, color, 1, 1);
    });
    ctx.restore();
  });

  shadowRect(ctx, x, y, w, h, r, C.accent);
  ctx.save(); rrect(ctx, x, y, w, h, r); ctx.clip();
  const ia = prog(u, EV.morph[0] + 0.15, EV.morph[0] + 0.9);
  if (ia > 0) { ctx.globalAlpha = ia; const s = Math.max(w / 1440, h / 900); const iw = 1440 * s, ih = 900 * s; ctx.drawImage(I.m01d_dashboard_dark, x + (w - iw) / 2, y + (h - ih) / 2, iw, ih); }
  ctx.restore();
  bedIcon(ctx, x + 220, y + h / 2, 210, C.white, 0.92 * (1 - prog(u, EV.morph[0], EV.morph[0] + 0.7)));
}

// ------------------------------------------------------------------ end card (u 81..95)
function endCard(ctx, u, I) {
  if (u < EV.end - 0.5) return;
  // one screen for each half of the line: the hotel's desktop, then the guest's phone
  const dk = springU(u, 84.2, LAND);
  if (dk > 0.001) {
    const r = { x: 1300, y: 150 + (1 - dk) * 900, w: 780 }; r.h = r.w * 0.625;
    shadowRect(ctx, r.x, r.y, r.w, r.h, 26 * (r.w / 1440), '#d9d3ff');
    ctx.save(); rrect(ctx, r.x, r.y, r.w, r.h, 26 * (r.w / 1440)); ctx.clip();
    ctx.drawImage(I.m01_dashboard, r.x, r.y, r.w, r.h); ctx.restore();
  }
  const pk = springU(u, 88.2, LAND);
  if (pk > 0.001) drawPhone(ctx, 1650, 800 + (1 - pk) * 900, 0.8, (1 - pk) * 0.1, [1, 195, 436], u, I);
  const dur = 95;
  const drift = 1 + 0.02 * prog(u, EV.end, dur);
  ctx.save();
  ctx.translate(W * 0.3, H * 0.55); ctx.scale(drift, drift); ctx.translate(-W * 0.3, -H * 0.55);
  const k = springU(u, EV.end - 0.45, { stiffness: 230, damping: 15 });   // already arriving as the phone folds into it, so the cut frame is never empty
  if (k > 0.001) {
    const size = 230, cx = 140 + size / 2, cy = 190 + size / 2;
    ctx.save(); ctx.translate(cx, cy); ctx.scale(k, k); ctx.rotate((1 - k) * -0.35);
    shadowRect(ctx, -size / 2, -size / 2, size, size, 62, C.accent);
    bedIcon(ctx, 0, 0, 132, C.white, 1);
    ctx.restore();
  }
  rise(ctx, 'Hotel PMS', 128, 700, 214, u, EV.end + 0.3, C.white, { cfg: BOUNCY });
  const gAcc = (u0) => (uu) => mix(C.lav, C.white, prog(uu, u0, u0 + 0.8));
  rise(ctx, 'One system for your hotel.', 136, 806, 62, u, 84.3, gAcc(84.3), { face: UI, weight: 600, track: -0.01, cfg: SPRING.gentle });
  rise(ctx, 'One app for your guests.', 136, 890, 62, u, 88.3, gAcc(88.3), { face: UI, weight: 600, track: -0.01, cfg: SPRING.gentle });
  ctx.restore();
}

// ------------------------------------------------------------------ sound: every accent, in beats
const HITS = [
  [0.05, 'hook lands', 'impact'],
  [0.5, 'Meet', 'pop', { pitch: 'A5' }],
  [EV.hookHotel + 0.1, 'Hotel', 'pop', { pitch: 'D6' }],
  [EV.hookPms + 0.1, 'PMS', 'pop', { pitch: 'F6' }],
  [3.3, 'block grows', 'whoosh', { len: 0.8, from: 500, to: 2600 }],
  [5.4, 'window settles', 'thud'],
  [EV.runYourHotel, 'Run your hotel', 'tick'],
  [EV.delight, 'Delight every guest', 'tick'],
  [EV.themeClick, 'theme click', 'click'],
  [EV.lightReveal[0] + 0.1, 'light comes on', 'whoosh', { len: 0.7, from: 400, to: 2400 }],
  [EV.glance, 'your day', 'tick'],
  [EV.tour[0], 'occupancy', 'pop', { pitch: 'C6' }],
  [EV.tour[1], 'arrivals', 'pop', { pitch: 'E6' }],
  [EV.tour[2], 'departures', 'pop', { pitch: 'G6' }],
  [EV.tour[3], 'replies waiting', 'pop', { pitch: 'C7' }],
  [EV.whip, 'whip to the calendar', 'whoosh', { len: 0.7 }],
  [EV.everyRoom, 'every room', 'tick'],
  [EV.pendingPulse, 'pending request', 'blip', { pitch: 'E6' }],
  [EV.newBookingClick, 'new booking click', 'click'],
  [EV.dialogOpen, 'dialog opens', 'pop', { pitch: 'A5' }],
  [30.1, 'free rooms', 'tick'],
  [31.7, 'the room', 'tick'],
  [34.3, 'priced in pesos', 'bell', { pitch: 'D6' }],
  [EV.exitHotel, 'hotel leaves', 'whoosh', { len: 0.7, from: 2400, to: 500 }],
  [EV.phoneIn + 0.45, 'phone lands', 'thud'],
  [EV.formWipe[0], 'sign-up typing', 'type', { n: 18, len: 1.9 }],
  [EV.submitTap, 'create account', 'click'],
  [EV.stayPush, 'to the stay page', 'tick'],
  [EV.datesWipe[0], 'dates typing', 'type', { n: 8, len: 0.9 }],
  [EV.resultsFade, 'results', 'pop', { pitch: 'C6' }],
  [EV.reserveTap, 'reserve tap', 'click'],
  [EV.reserveOpen, 'reserve dialog', 'pop', { pitch: 'A5' }],
  [EV.sendTap, 'send request', 'click'],
  [EV.pending, 'pending: waits for approval', 'blip', { pitch: 'E6' }],
  [EV.servicesTap, 'services tap', 'click'],
  [EV.requestTap, 'request tap', 'click'],
  [EV.svcDialog, 'service dialog', 'pop', { pitch: 'A5' }],
  [EV.svcSendTap, 'send request', 'click'],
  [EV.requested, 'requested', 'blip', { pitch: 'G6' }],
  [EV.newInquiryTap, 'new inquiry tap', 'click'],
  [EV.inquiryDialog, 'inquiry dialog', 'pop', { pitch: 'A5' }],
  [EV.inquirySendTap, 'send question', 'click'],
  [EV.split - 0.3, 'phone moves aside', 'whoosh', { len: 0.7 }],
  [EV.confirmClick, 'hotel confirms', 'click'],
  [69.2, 'guest sees confirmed', 'bell', { pitch: 'E6' }],
  [EV.replyClick, 'reply', 'click'],
  [EV.sendClick, 'send reply', 'click'],
  [71.8, 'reply arrives', 'pop', { pitch: 'D6' }],
  [EV.approveClick, 'approve service', 'click'],
  [73.1, 'service confirmed', 'bell', { pitch: 'G6' }],
  [EV.soloAgain, 'desktop leaves', 'whoosh', { len: 0.7, from: 2200, to: 500 }],
  [77.55, 'total changes', 'coins'],
  [77.6, 'airport pickup added', 'pop', { pitch: 'C7' }],
  [EV.end, 'phone folds into the mark', 'riser', { len: 1.0 }],
  [EV.end, 'end card', 'impact'],
  [EV.end + 0.35, 'Hotel PMS', 'bell', { pitch: 'D6' }],
  [84.3, 'one system', 'tick'],
  [88.3, 'one app', 'tick'],
];

M.film({
  fonts: [font(100, 800, DISPLAY), font(40, 600, UI), font(40, 700, UI)],
  hits: HITS,
  samples: 10,
  // the captures are big (a few are 8000 px tall): decode them one at a time so a render worker never runs out of memory
  async init(ctx, I) {
    A = await fetch('assets/shots/anchors.json').then((r) => r.json());
    for (const n of SHOTS) {
      const im = new Image(); im.src = `assets/shots/${n}.png`;
      try { await im.decode(); I[n] = im; } catch (e) { console.error(`image "${n}" failed to load: ${e.message}`); }
    }
  },
  draw(ctx, u, t, I) {
    background(ctx);
    hook(ctx, u, I);
    hotelWorld(ctx, u, I);
    splitWorld(ctx, u, I);
    guestWorld(ctx, u, I);
    endCard(ctx, u, I);
  },
});
