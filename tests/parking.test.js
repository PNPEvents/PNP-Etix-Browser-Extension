const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const core = require('../shared.js');

const request = (overrides = {}) => ({
  orderNumber: '12345678', mode: 'apply', jobId: 'parking-test',
  quantities: { parking: 1, disabled: 2, comp: 1 },
  registrations: { parking: ['ab12 cde'], disabled: ['CD34 EFG', 'EF56 GHI'], comp: ['GH78 IJK'] },
  ...overrides
});
const experience = (overrides = {}) => ({ status: 'ISSUED', date: '11/12/26 12:25', venue: 'Wensleydale Railway', performance: '2026 THE POLAR EXPRESS™ Train Ride', priceCode: 'Adult (18+)', ...overrides });

test('parking validation requires one plate per selected type and normalises plates', () => {
  const result = core.validateParkingRequest(request());
  assert.equal(result.ok, true);
  assert.equal(result.value.quantity, 4);
  assert.deepEqual(result.value.registrations.parking, ['AB12 CDE']);
  for (const quantities of [ { parking: 0, disabled: 0, comp: 0 }, { parking: -1, disabled: 0, comp: 0 }, { parking: 1.5, disabled: 0, comp: 0 }, { parking: 11, disabled: 0, comp: 0 }, { parking: '', disabled: 0, comp: 0 } ]) {
    assert.equal(core.validateParkingRequest(request({ quantities })).ok, false);
  }
  assert.equal(core.validateParkingRequest(request({ registrations: { parking: ['AB12 CDE'], disabled: ['CD34 EFG'], comp: ['GH78 IJK'] } })).ok, false);
  assert.equal(core.validateParkingRequest(request({ registrations: undefined }), false).ok, true);
  assert.equal(core.validateParkingRequest(request({ registrations: undefined })).ok, false);
});

test('parking venue matching distinguishes the captured Wensleydale and South Devon venues', () => {
  assert.equal(core.parkingVenueMatches('Wensleydale Railway', 'Wensleydale Railway - Parking (Leeming Bar service area)'), true);
  assert.equal(core.parkingVenueMatches('South Devon Railway', 'South Devon Parking'), true);
  assert.equal(core.parkingVenueMatches('Wensleydale Railway', 'South Devon Railway - Parking'), false);
  assert.equal(core.parkingVenueMatches('South Devon Railway', 'South Devon Railway - Ticket Protection'), false);
  assert.equal(core.parkingVenueMatches('Devon Railway', 'South Devon Parking'), false);
  assert.equal(core.chooseParkingOption(['Wensleydale Parking - East', 'Wensleydale Parking - West'], (name) => core.parkingVenueMatches('Wensleydale Railway', name), 'parking venue').status, 'needs_input');
});

test('parking dates use the ticket calendar day, independently of the parking time', () => {
  assert.equal(core.parkingDateKey('11/12/26 12:25'), '2026-12-11');
  assert.equal(core.parkingDateKey('Wensleydale Parking - Leeming Bar - 11/12/2026 - 11 December 2026 00:05'), '2026-12-11');
  assert.equal(core.parkingDateKey('31/02/2026 00:05'), null);
  assert.equal(core.parkingDateKey('11/12/2026 - 12 December 2026 00:05'), null);
});

test('parking target ignores cancelled tickets, parking and protection; rejects multiple dates or venues', () => {
  const tickets = [experience(), experience({ priceCode: 'Child (2-17)' }), experience({ status: 'REFUNDED', date: '12/12/26 12:25' }), experience({ priceCode: 'Ticket Protection' }), experience({ venue: 'Wensleydale Railway - Parking (Leeming Bar service area)', performance: 'Wensleydale Parking', priceCode: 'Parking', date: '11/12/26 00:05' })];
  const result = core.parkingOrderTarget(tickets);
  assert.equal(result.status, 'matched');
  assert.equal(result.experienceCount, 2);
  assert.equal(result.counts.parking, 1);
  assert.equal(core.parkingOrderTarget([...tickets, experience({ date: '12/12/26 12:25' })]).status, 'needs_input');
  assert.equal(core.parkingOrderTarget([...tickets, experience({ venue: 'South Devon Railway' })]).status, 'needs_input');
});

// Small DOM fixture for the inspected Etix controls. Click callbacks simulate
// server updates; the real content script is exercised through its message API.
class Element {
  constructor(tag, attributes = {}, children = []) {
    this.tagName = tag.toUpperCase(); Object.assign(this, attributes);
    this.children = children; this.value = attributes.value || ''; this.type = attributes.type || '';
    this.id = attributes.id || ''; this.checked = Boolean(attributes.checked); this.disabled = false;
    this.labels = attributes.label ? [{ textContent: attributes.label }] : [];
    for (const child of children) child.parentElement = this;
  }
  get textContent() { return this.text || this.children.map((child) => child.textContent).join(' '); }
  get options() { return this.tagName === 'SELECT' ? this.children : []; }
  get selectedOptions() { return this.options.filter((option) => option.value === this.value); }
  get innerText() { return this.textContent; }
  querySelectorAll(selector) {
    const descendants = this.children.flatMap((child) => [child, ...child.querySelectorAll('*')]);
    return descendants.filter((child) => selector.split(',').some((part) => child.matches(part.trim())));
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  matches(selector) {
    if (selector === '*') return true;
    const match = selector.match(/^(\w+)?(?:\[([\w-]+)(\^=|\*=|=)'([^']*)'\])?$/);
    if (!match) throw new Error(`Unsupported fixture selector: ${selector}`);
    if (match[1] && this.tagName !== match[1].toUpperCase()) return false;
    if (!match[2]) return true;
    const actual = String(this[match[2]] || '');
    return match[3] === '^=' ? actual.startsWith(match[4]) : match[3] === '*=' ? actual.includes(match[4]) : actual === match[4];
  }
  closest(tag) { let current = this.parentElement; while (current) { if (current.matches(tag)) return current; current = current.parentElement; } return null; }
  getBoundingClientRect() { return { width: this.hidden ? 0 : 100, height: this.hidden ? 0 : 20 }; }
  dispatchEvent() {}
  click() { if (this.type === 'radio') this.checked = true; if (this.type === 'checkbox') this.checked = !this.checked; if (this.onClick) this.onClick(); }
}
const el = (tag, props, children) => new Element(tag, props, children);
const option = (label, value = label) => el('option', { text: label, value });
const select = (id, labels, selected) => el('select', { id, value: selected || labels[0] }, labels.map((label) => option(label)));
const table = (headers, rows) => el('table', {}, [el('tr', {}, headers.map((text) => el('th', { text }))), ...rows.map((cells) => el('tr', {}, cells.map((cell) => typeof cell === 'string' ? el('td', { text: cell }) : el('td', {}, [cell]))))]);

function pageHarness({ tickets = [experience()], venue = 'Wensleydale Railway', cartOrder = ['disabled', 'parking', 'comp', 'disabled'] } = {}) {
  let listener; let body = el('body'); let cartTypes = []; let popup = false;
  const clicks = { purchase: 0, submit: 0, email: 0, search: 0 };
  const location = { hostname: 'boxoffice.etix.com', pathname: '/ticket/boxoffice/orderDetails.vw' };
  const document = {
    get body() { return body; }, documentElement: {},
    querySelectorAll: (selector) => body.querySelectorAll(selector),
    querySelector: (selector) => body.querySelector(selector),
    getElementById: (id) => body.querySelectorAll('*').find((node) => node.id === id) || null,
    getElementsByName: (name) => body.querySelectorAll('*').filter((node) => node.name === name)
  };
  const parkingVenue = `${venue} - Parking${venue.includes('Wensleydale') ? ' (Leeming Bar service area)' : ''}`;
  const performance = `${venue.replace(' Railway', '')} Parking - 11/12/2026 - 11 December 2026 00:05`;
  const get = document.getElementById;
  function order() {
    location.pathname = '/ticket/boxoffice/orderDetails.vw';
    body = el('body', {}, [el('h1', { text: 'Order Details: 12345678' }),
      table(['Status', 'Serial #', 'Date', 'Performance', 'Venue', 'Price Code'], tickets.map((t, i) => [t.status, String(i), t.date, t.performance, t.venue, t.priceCode])),
      el('a', { id: 'orderDetails:j_idt76', text: 'Add Tickets', onClick: sale }),
      el('a', { text: 'Resend Email', onClick: () => { clicks.email++; } }), el('a', { href: 'mailto:customer@example.com' })]);
  }
  function sale() {
    location.pathname = '/ticket/sale3z/boxoffice/singlePage.vw';
    const venueSelect = select('singlePage:venueSelect', [venue, parkingVenue, 'Other Railway - Parking']);
    const eventSelect = select('singlePage:switchEventSelect', ['Please Select An Event', performance]);
    const qtys = core.PARKING_TYPES.map((t) => el('input', { type: 'number', label: t.label, id: `quantity-${t.key}`, value: '0' }));
    const cash = el('input', { type: 'radio', name: 'singlePage:paymentMethod', label: 'Cash' });
    const cart = table(['Name', 'Seat', 'Status', 'Note', 'Price Code', 'Price', 'Fee', 'Total', 'Remove'], []);
    const total = el('input', { type: 'hidden', id: 'singlePage:totalOrderPrice', value: '0' });
    const add = el('input', { type: 'submit', id: 'singlePage:addSeats', value: 'Add Seats', onClick: () => {
      cartTypes = cartOrder.filter((type, index, array) => array.slice(0, index + 1).filter((t) => t === type).length <= Number(get(`quantity-${type}`).value));
      // Also supports a one-type test without changing the fixture's cart order.
      for (const t of core.PARKING_TYPES) while (cartTypes.filter((key) => key === t.key).length < Number(get(`quantity-${t.key}`).value)) cartTypes.push(t.key);
      const rows = cartTypes.map((type, index) => [performance, 'General Admission', 'O', '', select(`singlePage:shoppingCart:${index}:j_idt272`, core.PARKING_TYPES.map((t) => t.label), core.PARKING_TYPES.find((t) => t.key === type).label), '£6.67', '£1.33', type === 'comp' ? '£0.00' : '£8.00', el('a', { id: `singlePage:shoppingCart:${index}:removeSeat_1` })]);
      const updated = table(['Name', 'Seat', 'Status', 'Note', 'Price Code', 'Price', 'Fee', 'Total', 'Remove'], rows);
      cart.children = updated.children; total.value = String(cartTypes.filter((t) => t !== 'comp').length * 8);
    } });
    const purchase = el('input', { type: 'submit', id: 'purchase', value: 'Purchase', onClick: () => {
      clicks.purchase++; popup = true;
      const fields = cartTypes.map((_t, i) => el('input', { type: 'text', id: `singlePage:j_idt1236:0:j_idt1281:j_idt1282:${i}:j_idt1285:1:j_idt1293` }));
      const submit = el('input', { type: 'submit', id: 'singlePage:collectMiscBtn', value: 'Submit', onClick: () => {
        clicks.submit++; popup = false;
        for (const type of cartTypes) tickets.push(experience({ venue: parkingVenue, performance, date: '11/12/26 00:05', priceCode: core.PARKING_TYPES.find((t) => t.key === type).label }));
        order();
      } });
      body.children.push(...fields, submit);
    } });
    body = el('body', {}, [el('input', { id: 'singlePage:addingTickets', value: 'true' }), venueSelect, eventSelect, ...qtys, add, cart, cash, el('input', { id: 'singlePage:processorFeeOnCash', type: 'text', label: 'Cash Tender' }), total, el('input', { id: 'automatic-email', name: 'singlePage:j_idt900', type: 'checkbox', label: 'Send confirmation email?', checked: true }), purchase]);
  }
  const sandbox = {
    EtixCore: core, document, location, Event: class {},
    chrome: { runtime: { onMessage: { addListener: (handler) => { listener = handler; } } } },
    getComputedStyle: () => ({ display: 'block', visibility: 'visible' }),
    setTimeout: (callback) => setTimeout(callback, 0), clearTimeout,
    setInterval: () => 0, clearInterval: () => {}, MutationObserver: class { observe() {} disconnect() {} }
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../content-script.js'), 'utf8'), sandbox);
  order();
  return {
    document, location, clicks, get, tickets, get popup() { return popup; }, parkingVenue, performance,
    refreshOrder: order,
    send: (payload) => new Promise((resolve) => listener({ type: 'RUN_ETIX_PARKING_STEP', payload }, null, resolve)),
    wrongOrder() {
      body = el('body', {}, [el('h1', { text: 'Order Details: 99999999' }), el('input', { name: 'order_id', type: 'text' }), el('button', { id: 'top-nav-order-search-submit-button', onClick: () => { clicks.search++; order(); } })]);
    }
  };
}

async function drive(page, payload, until) {
  payload = { ...payload, context: payload.context || {} };
  for (let i = 0; i < 30; i++) {
    const result = await page.send(payload);
    payload.context = { ...payload.context, ...result.contextPatch };
    if (until && until(result, payload)) return { result, payload };
    if (!['continue', 'navigating'].includes(result.status)) return { result, payload };
  }
  throw new Error('Fixture workflow did not settle.');
}

test('preview finds a booking by its number without opening Add Tickets or purchasing', async () => {
  const page = pageHarness(); page.wrongOrder();
  const { result } = await drive(page, request({ mode: 'preview', registrations: undefined }));
  assert.equal(page.clicks.search, 1);
  assert.equal(result.status, 'ready');
  assert.equal(result.parkingDate, '2026-12-11');
  assert.equal(page.clicks.purchase, 0);
});

test('mixed parking quantities map registrations to actual cart order and verify before confirmation', async () => {
  const page = pageHarness();
  const paused = await drive(page, request({ sendConfirmation: true }), (result) => result.contextPatch?.parkingPhase === 'submit_parking_registrations');
  assert.equal(page.clicks.purchase, 1);
  assert.equal(page.clicks.submit, 0);
  const values = page.document.querySelectorAll("input[type='text']").filter((input) => input.id.includes('j_idt1236')).map((input) => input.value);
  assert.deepEqual(values, ['CD34 EFG', 'AB12 CDE', 'GH78 IJK', 'EF56 GHI']);
  assert.equal(page.get('singlePage:processorFeeOnCash').value, '24.00');
  assert.equal(page.get('automatic-email').checked, false);
  assert.equal(page.clicks.email, 0);
  const { result } = await drive(page, paused.payload);
  assert.equal(result.status, 'completed', JSON.stringify(result));
  assert.equal(result.emailSendInvoked, true);
  assert.equal(page.clicks.purchase, 1);
  assert.equal(page.clicks.submit, 1);
  assert.equal(page.clicks.email, 1);
  assert.equal(page.tickets.length, 5);
});

test('South Devon chooses its own parking venue and does not email when unchecked', async () => {
  const page = pageHarness({ venue: 'South Devon Railway', tickets: [experience({ venue: 'South Devon Railway' })] });
  const { result } = await drive(page, request());
  assert.equal(result.status, 'completed', JSON.stringify(result));
  assert.equal(result.parkingVenue, 'South Devon Railway - Parking');
  assert.equal(page.clicks.email, 0);
});

test('a changed venue prevents a purchase', async () => {
  const page = pageHarness();
  const paused = await drive(page, request(), (result) => result.contextPatch?.parkingPhase === 'purchase_parking');
  assert.equal(paused.payload.context.purchaseAttempted, true);
  assert.equal(page.clicks.purchase, 0);
  page.get('singlePage:venueSelect').value = 'Other Railway - Parking';
  const { result } = await drive(page, paused.payload);
  assert.equal(result.stopCode, 'parking_selection_changed');
  assert.equal(page.clicks.purchase, 0);
});

test('cart tampering and missing registration fields stop without submitting', async () => {
  const page = pageHarness();
  const paused = await drive(page, request(), (result) => result.contextPatch?.parkingPhase === 'purchase_parking');
  page.get('singlePage:shoppingCart:0:j_idt272').value = 'Parking Comp';
  const { result } = await drive(page, paused.payload);
  assert.equal(result.stopCode, 'parking_cart_mismatch');
  assert.equal(page.clicks.purchase, 0);
  const other = pageHarness();
  const popup = await drive(other, request(), (result) => result.contextPatch?.parkingPhase === 'fill_parking_registrations');
  other.get('singlePage:j_idt1236:0:j_idt1281:j_idt1282:1:j_idt1285:1:j_idt1293').hidden = true;
  popup.payload.context.parkingWaits = 12;
  const outcome = await other.send(popup.payload);
  assert.equal(outcome.stopCode, 'parking_update_timeout');
  assert.equal(other.clicks.submit, 0);
});

test('failed parking verification never sends confirmation', async () => {
  const page = pageHarness();
  const paused = await drive(page, request({ sendConfirmation: true }), (result) => result.contextPatch?.parkingPhase === 'verify_parking');
  page.tickets.pop();
  page.refreshOrder();
  const { result } = await drive(page, paused.payload);
  assert.equal(result.stopCode, 'parking_verification_failed');
  assert.equal(page.clicks.email, 0);
});

test('single-space and complimentary-only purchases use exact quantities and cash totals', async () => {
  for (const [quantities, registrations, total] of [
    [{ parking: 1, disabled: 0, comp: 0 }, { parking: ['AB12 CDE'], disabled: [], comp: [] }, 8],
    [{ parking: 0, disabled: 2, comp: 0 }, { parking: [], disabled: ['CD34 EFG', 'EF56 GHI'], comp: [] }, 16],
    [{ parking: 0, disabled: 0, comp: 1 }, { parking: [], disabled: [], comp: ['GH78 IJK'] }, 0]
  ]) {
    const page = pageHarness();
    const { result } = await drive(page, request({ quantities, registrations }));
    assert.equal(result.status, 'completed', JSON.stringify(result));
    assert.equal(result.parkingTotal, total);
    assert.equal(page.clicks.purchase, 1);
  }
});
