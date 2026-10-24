'use strict';

// The guest's side of the hotel: find a room and reserve it, request services, ask questions,
// and follow what has happened to each. Loaded before app.js and only run by it: the helpers used
// here (api, esc, icon, money, openForm, route, ...) belong to app.js and exist by the time a page is shown.

const PORTAL_NAV = [
  ['stay', 'Book a stay', 'rooms'],
  ['trips', 'My bookings', 'bookings'],
  ['services', 'Services', 'bell'],
  ['messages', 'Messages', 'chat'],
];

const ROOM_KINDS = ['Standard', 'Twin', 'Deluxe', 'Family', 'Suite'];

let stayQuery = { checkIn: '', checkOut: '', adults: 2, children: 0 };
let lastStay = { rooms: [] };
let lastServices = { services: [], orders: [], bookings: [] };
let lastMessages = { inquiries: [], services: [] };
let portalWired = false;

// A failed API call shows as a message on the page, except when the session has ended.
async function orMessage(promise) {
  try {
    return await promise;
  } catch (err) {
    if (err.status === 401) throw err;
    return { error: err.message };
  }
}

const PORTAL_PAGES = {
  stay: {
    title: 'Book a stay',
    subtitle: 'Find a room, then send a reservation request. The hotel confirms it shortly.',
    load: () => orMessage(api('GET', stayUrl())),
    render: renderStay,
  },
  trips: {
    title: 'My bookings',
    subtitle: 'Your reservations, and what has happened to each.',
    add: { label: 'Book a stay', run: () => (location.hash = '#/stay') },
    load: () => api('GET', '/api/portal/bookings'),
    render: renderTrips,
  },
  services: {
    title: 'Services',
    subtitle: 'Extras to make your stay easier.',
    load: async () => {
      const [services, orders, bookings] = await Promise.all([
        api('GET', '/api/portal/services'),
        api('GET', '/api/portal/service-orders'),
        api('GET', '/api/portal/bookings'),
      ]);
      return { services, orders, bookings };
    },
    render: renderServices,
  },
  messages: {
    title: 'Messages',
    subtitle: "Questions you have asked, and the hotel's replies.",
    add: { label: 'New inquiry', run: () => openInquiry({}, lastMessages.services) },
    load: async () => {
      const [inquiries, services] = await Promise.all([api('GET', '/api/portal/inquiries'), api('GET', '/api/portal/services')]);
      return { inquiries, services };
    },
    render: renderMessages,
  },
};

// ---------------------------------------------------------------------------
// Book a stay
// ---------------------------------------------------------------------------

function stayUrl() {
  const q = stayQuery;
  if (!q.checkIn || !q.checkOut) return '/api/portal/rooms';
  const guests = Math.max(1, (Number(q.adults) || 0) + (Number(q.children) || 0));
  return `/api/portal/rooms?${new URLSearchParams({ checkIn: q.checkIn, checkOut: q.checkOut, guests: String(guests) })}`;
}

function roomKindCard(r, dated) {
  const soldOut = dated && r.available === 0;
  return `
    <article class="glass room-card spot rise${soldOut ? ' sold-out' : ''}">
      <div class="room-head type-${esc(r.type.toLowerCase())}">
        <span class="room-no">${esc(r.type)}</span><span class="room-type">Sleeps ${r.capacity}</span>
      </div>
      <div class="room-body">
        <p class="room-desc">${esc(r.description || 'A comfortable room.')}</p>
        <div class="room-meta">
          <span>${dated ? (soldOut ? 'Sold out' : `${esc(countLabel(r.available, 'room', 'rooms'))} left`) : 'Per night'}</span>
          <strong>${money.format(r.rate)}<small> / night</small></strong>
        </div>
        ${dated ? `<div class="stay-total">${esc(plural(r.nights, 'night'))} in total <strong>${money.format(r.total)}</strong></div>` : ''}
      </div>
      <div class="room-actions">
        <button type="button" class="btn small" data-ask-room="${esc(r.type)}">Ask a question</button>
        <button type="button" class="btn small primary" data-reserve="${esc(r.id)}" ${dated && !soldOut ? '' : 'disabled'}>${soldOut ? 'Sold out' : 'Reserve'}</button>
      </div>
    </article>`;
}

function renderStay(data, fresh) {
  view.dataset.entity = '';
  wirePortal();
  lastStay = data;
  const q = stayQuery;
  const dated = Boolean(q.checkIn && q.checkOut) && !data.error;
  const rooms = data.rooms ?? [];
  const nights = dated ? daysBetween(q.checkIn, q.checkOut) : 0;

  view.innerHTML = `
    <form class="glass stay-search rise" id="stay-form" novalidate>
      <label class="field"><span class="field-label">Check-in</span><input type="date" name="checkIn" min="${today()}" value="${esc(q.checkIn)}" required></label>
      <label class="field"><span class="field-label">Check-out</span><input type="date" name="checkOut" min="${today()}" value="${esc(q.checkOut)}" required></label>
      <label class="field"><span class="field-label">Adults</span><input type="number" name="adults" min="1" max="20" step="1" value="${esc(q.adults)}"></label>
      <label class="field"><span class="field-label">Children</span><input type="number" name="children" min="0" max="20" step="1" value="${esc(q.children)}"></label>
      <button type="submit" class="btn primary">${icon('search')}<span>Search rooms</span></button>
    </form>
    <p class="stay-error form-error" role="alert">${esc(data.error ?? '')}</p>
    <p class="stay-summary rise">${
      dated
        ? `${esc(plural(nights, 'night'))}, ${esc(fmtShort(q.checkIn))} → ${esc(fmtShort(q.checkOut))}`
        : 'Choose your dates to see what is available. These are the kinds of rooms we have.'
    }</p>
    ${
      rooms.length
        ? `<div class="room-grid">${rooms.map((r) => roomKindCard(r, dated)).join('')}</div>`
        : `<div class="glass card rise"><div class="empty">${icon('rooms')}<p>${dated ? 'No rooms fit those dates and that many guests. Try other dates, or ask us a question.' : 'No rooms are listed yet.'}</p></div></div>`
    }`;
  afterRender(fresh);
}

function openReserve(roomId) {
  const room = lastStay.rooms.find((r) => r.id === roomId);
  const q = stayQuery;
  if (!room || !q.checkIn || !q.checkOut) return;
  const booking = { roomId, checkIn: q.checkIn, checkOut: q.checkOut, adults: Number(q.adults) || 1, children: Number(q.children) || 0 };

  openForm({
    singular: 'Reservation',
    saveLabel: 'Send reservation request',
    toast: 'Request sent. The hotel will confirm it shortly.',
    title: () => `Reserve a ${room.type.toLowerCase()} room`,
    intro: () => `
      <div class="quote-box">
        <strong>${esc(room.type)} room · ${esc(plural(room.nights, 'night'))}</strong>
        <p>${esc(fmtDate(q.checkIn))} → ${esc(fmtDate(q.checkOut))}<br>${esc(guestsLine(booking))}</p>
        <p class="total-line">Total ${money.format(room.total)} <span class="sub">(${money.format(room.rate)} per night)</span></p>
        <span class="sub">Nothing is charged online. We hold the room while we confirm, then arrange payment with you.</span>
      </div>`,
    fields: [{ key: 'notes', label: 'Special requests (optional)', type: 'textarea', wide: true }],
    submit: (body) => api('POST', '/api/portal/bookings', { ...booking, notes: body.notes }),
    afterSave: () => {
      location.hash = '#/trips';
    },
  });
}

// ---------------------------------------------------------------------------
// My bookings
// ---------------------------------------------------------------------------

function tripCard(b) {
  return `
    <article class="glass trip rise">
      <div class="trip-head">
        <div>
          <h3>${esc(b.roomType)} room${b.roomNumber ? ` · Room ${esc(b.roomNumber)}` : ''}</h3>
          <p class="sub">${esc(fmtDate(b.checkIn))} → ${esc(fmtDate(b.checkOut))} · ${esc(plural(b.nights, 'night'))} · ${esc(guestsLine(b))}</p>
        </div>
        ${badge(b.status)}
      </div>
      ${b.status === 'Pending' ? '<p class="trip-note">Waiting for the hotel to confirm. Your room is held in the meantime.</p>' : ''}
      ${b.status === 'Cancelled' ? '<p class="trip-note muted">This booking was cancelled.</p>' : ''}
      ${
        b.status === 'Cancelled'
          ? ''
          : `<div class="trip-money">
              <div><span class="sub">Total</span><strong>${money.format(b.total)}</strong></div>
              <div><span class="sub">Paid</span><strong>${money.format(b.paid)}</strong></div>
              <div><span class="sub">To pay</span><strong class="${b.balance > 0 ? 'due' : ''}">${money.format(b.balance)}</strong></div>
            </div>`
      }
      ${b.guestNotes ? `<p class="sub clamp">“${esc(b.guestNotes)}”</p>` : ''}
      ${b.canCancel ? `<div class="trip-actions"><button type="button" class="btn small danger" data-cancel-booking="${esc(b.id)}">Cancel booking</button></div>` : ''}
    </article>`;
}

function renderTrips(bookings, fresh) {
  view.dataset.entity = '';
  wirePortal();
  if (!bookings.length) {
    view.innerHTML = `<div class="glass card rise"><div class="empty">${icon('bookings')}<p>You have no bookings yet. <a href="#/stay">Find a room</a> to get started.</p></div></div>`;
    afterRender(fresh);
    return;
  }
  const current = bookings.filter((b) => ['Pending', 'Confirmed', 'Checked in'].includes(b.status));
  const earlier = bookings.filter((b) => !current.includes(b));
  view.innerHTML = `
    ${current.length ? `<div class="trip-list">${current.map(tripCard).join('')}</div>` : ''}
    ${earlier.length ? `<h2 class="section-title rise">Earlier</h2><div class="trip-list">${earlier.map(tripCard).join('')}</div>` : ''}`;
  afterRender(fresh);
}

// ---------------------------------------------------------------------------
// Services
// ---------------------------------------------------------------------------

const unitText = (unit) => (unit ? (unit.startsWith('per ') ? unit : `per ${unit}`) : '');

function serviceCard(s) {
  return `
    <article class="glass room-card service-card spot rise">
      <div class="service-head"><span class="service-icon">${icon('sparkle')}</span><h3>${esc(s.name)}</h3></div>
      <div class="room-body">
        ${s.description ? `<p class="room-desc">${esc(s.description)}</p>` : ''}
        <div class="room-meta"><span></span><strong>${money.format(s.price)}<small> ${esc(unitText(s.unit))}</small></strong></div>
      </div>
      <div class="room-actions">
        <button type="button" class="btn small" data-ask-service="${esc(s.id)}">Ask a question</button>
        <button type="button" class="btn small primary" data-request-service="${esc(s.id)}">Request</button>
      </div>
    </article>`;
}

function renderServices(data, fresh) {
  view.dataset.entity = '';
  wirePortal();
  lastServices = data;
  const orders = data.orders;
  view.innerHTML = `
    ${
      data.services.length
        ? `<div class="room-grid">${data.services.map(serviceCard).join('')}</div>`
        : `<div class="glass card rise"><div class="empty">${icon('bell')}<p>No services are offered online right now. Ask us a question and we will help.</p></div></div>`
    }
    ${
      orders.length
        ? `<h2 class="section-title rise">Your requests</h2>
          <div class="glass card rise"><div class="table-wrap"><table>
            <thead><tr><th>Service</th><th>For</th><th class="num">Total</th><th>Status</th><th></th></tr></thead>
            <tbody>${orders
              .map(
                (o) => `<tr>
                  <td><strong>${esc(o.serviceName)}</strong><div class="sub">${esc(`${o.quantity} × ${money.format(o.unitPrice)}`)}${o.stay ? ` · on your stay ${esc(o.stay.replace(/\d{4}-\d{2}-\d{2}/g, (d) => fmtShort(d)))}` : ''}</div></td>
                  <td>${esc(fmtDate(o.date))}</td>
                  <td class="num">${money.format(o.total)}</td>
                  <td>${badge(o.status)}</td>
                  <td class="actions">${o.canCancel ? `<button type="button" class="btn small danger" data-cancel-order="${esc(o.id)}">Cancel</button>` : ''}</td>
                </tr>`,
              )
              .join('')}</tbody>
          </table></div></div>`
        : ''
    }`;
  afterRender(fresh);
}

function openServiceRequest(serviceId) {
  const service = lastServices.services.find((s) => s.id === serviceId);
  if (!service) return;
  const stays = lastServices.bookings.filter((b) => ['Pending', 'Confirmed', 'Checked in'].includes(b.status));

  openForm({
    singular: 'Request',
    saveLabel: 'Send request',
    toast: 'Request sent. The hotel will confirm it.',
    title: () => `Request: ${service.name}`,
    intro: () => `
      <div class="quote-box">
        <strong>${esc(service.name)}</strong>
        ${service.description ? `<p>${esc(service.description)}</p>` : ''}
        <span class="sub">${esc(money.format(service.price))} ${esc(unitText(service.unit))}. The hotel confirms every request.</span>
      </div>`,
    fields: [
      { key: 'date', label: 'Date', type: 'date', required: true, initial: today, minDate: today },
      { key: 'quantity', label: 'How many?', type: 'number', step: '1', min: 1, required: true, initial: () => 1 },
      {
        key: 'bookingId',
        label: 'Add to one of your stays (optional)',
        wide: true,
        blank: 'No, I will pay for this separately',
        options: () => stays.map((b) => ({ value: b.id, label: `${fmtShort(b.checkIn)} – ${fmtShort(b.checkOut)} · ${b.roomType} room` })),
      },
      { key: 'notes', label: 'Anything we should know?', type: 'textarea', wide: true },
    ],
    submit: (body) => api('POST', '/api/portal/service-orders', { ...body, serviceId: service.id }),
    afterSave: () => route(),
  });
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

function messageCard(i) {
  const about = [i.roomType && `${i.roomType} room`, i.serviceName, i.checkIn && `${fmtShort(i.checkIn)} → ${fmtShort(i.checkOut)}`].filter(Boolean).join(' · ');
  return `
    <article class="glass message rise">
      <div class="trip-head">
        <div><h3>${esc(i.subject)}</h3><p class="sub">${esc(fmtDate(i.createdAt.slice(0, 10)))}${about ? ` · ${esc(about)}` : ''}</p></div>
        ${badge(i.status)}
      </div>
      <p class="message-text">${esc(i.message)}</p>
      ${
        i.reply
          ? `<div class="reply-box"><span class="sub">Reply from the hotel${i.repliedAt ? ` · ${esc(fmtDate(i.repliedAt.slice(0, 10)))}` : ''}</span><p>${esc(i.reply)}</p></div>`
          : '<p class="sub">Waiting for a reply from the hotel.</p>'
      }
    </article>`;
}

function renderMessages(data, fresh) {
  view.dataset.entity = '';
  wirePortal();
  lastMessages = data;
  view.innerHTML = data.inquiries.length
    ? `<div class="trip-list">${data.inquiries.map(messageCard).join('')}</div>`
    : `<div class="glass card rise"><div class="empty">${icon('chat')}<p>You have not sent any questions yet. Use <strong>New inquiry</strong> to ask the hotel about a room, a service, or anything else.</p></div></div>`;
  afterRender(fresh);
}

// `prefill` can set the topic, subject, room kind, service and dates, for the "Ask a question" buttons.
function openInquiry(prefill = {}, services = []) {
  const sync = (form) => {
    const topic = form.elements.namedItem('topic').value;
    for (const el of form.querySelectorAll('[data-group="room"]')) el.hidden = topic !== 'Room';
    for (const el of form.querySelectorAll('[data-group="service"]')) el.hidden = topic !== 'Service';
  };
  openForm(
    {
      singular: 'Inquiry',
      saveLabel: 'Send question',
      toast: 'Sent. The hotel will reply here.',
      title: () => 'Ask the hotel',
      fields: [
        { key: 'topic', label: 'About', choices: ['General', 'Room', 'Service'], initial: () => 'General' },
        { key: 'subject', label: 'Subject', required: true, wide: true },
        { key: 'roomType', label: 'Kind of room', group: 'room', hidden: true, blank: 'Any', options: () => ROOM_KINDS.map((k) => ({ value: k, label: k })) },
        {
          key: 'serviceId',
          label: 'Service',
          group: 'service',
          hidden: true,
          blank: 'Any',
          options: () => services.map((s) => ({ value: s.id, label: s.name })),
        },
        { key: 'checkIn', label: 'Check-in (optional)', type: 'date', group: 'room', hidden: true },
        { key: 'checkOut', label: 'Check-out (optional)', type: 'date', group: 'room', hidden: true },
        { key: 'message', label: 'Your question', type: 'textarea', required: true, wide: true, rows: 4 },
      ],
      afterOpen: (form) => sync(form),
      onChange: (key, form) => key === 'topic' && sync(form),
      toBody: (body) => {
        const out = { ...body };
        if (out.topic !== 'Room') Object.assign(out, { roomType: '', checkIn: '', checkOut: '' });
        if (out.topic !== 'Service') out.serviceId = '';
        return out;
      },
      submit: (body) => api('POST', '/api/portal/inquiries', body),
      afterSave: () => {
        if (location.hash === '#/messages') route();
        else location.hash = '#/messages';
      },
    },
    null,
    prefill,
  );
}

// ---------------------------------------------------------------------------
// Clicks and the search form on the guest pages
// ---------------------------------------------------------------------------

async function cancelWithConfirm(url, question, done) {
  if (!confirm(question)) return;
  try {
    await api('POST', url);
    toast(done);
    await route();
  } catch (err) {
    if (err.status !== 401) toast(err.message, true);
  }
}

// Wired once, on the first guest page (view belongs to app.js and does not exist when this file loads).
function wirePortal() {
  if (portalWired) return;
  portalWired = true;

  view.addEventListener('submit', (e) => {
    if (e.target.id !== 'stay-form') return;
    e.preventDefault();
    const f = e.target.elements;
    stayQuery = { checkIn: f.checkIn.value, checkOut: f.checkOut.value, adults: f.adults.value, children: f.children.value };
    if (stayQuery.checkIn && f.checkOut.value && stayQuery.checkOut <= stayQuery.checkIn) {
      $('.stay-error').textContent = 'Check-out must be after check-in.';
      return;
    }
    route();
  });

  view.addEventListener('click', (e) => {
    const target = (sel) => e.target.closest(sel);
    let el;
    if ((el = target('[data-reserve]'))) return openReserve(el.dataset.reserve);
    if ((el = target('[data-ask-room]'))) {
      return openInquiry({
        topic: 'Room',
        roomType: el.dataset.askRoom,
        subject: `Question about a ${el.dataset.askRoom.toLowerCase()} room`,
        checkIn: stayQuery.checkIn,
        checkOut: stayQuery.checkOut,
      });
    }
    if ((el = target('[data-request-service]'))) return openServiceRequest(el.dataset.requestService);
    if ((el = target('[data-ask-service]'))) {
      const service = lastServices.services.find((s) => s.id === el.dataset.askService);
      return openInquiry({ topic: 'Service', serviceId: service.id, subject: `Question about ${service.name}` }, lastServices.services);
    }
    if ((el = target('[data-cancel-booking]'))) {
      return cancelWithConfirm(`/api/portal/bookings/${el.dataset.cancelBooking}/cancel`, 'Cancel this booking?', 'Booking cancelled');
    }
    if ((el = target('[data-cancel-order]'))) {
      return cancelWithConfirm(`/api/portal/service-orders/${el.dataset.cancelOrder}/cancel`, 'Cancel this request?', 'Request cancelled');
    }
    return undefined;
  });
}
