const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const core = require("../shared.js");

function focusPage({ enabled = true, reduced = false, modulesAvailable = true } = {}) {
  const handlers = new Map();
  const intervals = new Map();
  const timeouts = new Map();
  const events = [];
  const nodes = [];
  const scrolls = [];
  let storageChanged;
  let motionChanged;
  let counter = 0;
  let now = 0;
  const node = () => {
    const element = { isConnected: true, children: [], style: {}, className: "", attributes: {}, parentElement: null,
      setAttribute(key, value) { this.attributes[key] = value; },
      removeAttribute(key) { delete this.attributes[key]; },
      append(child) { this.children.push(child); child.parentElement = this; },
      replaceChildren() { this.children = []; },
      remove() { this.isConnected = false; if (this.parentElement) this.parentElement.children = this.parentElement.children.filter((child) => child !== this); },
      scrollIntoView(options) { scrolls.push({element: this, options, highlighting: !!parent.children.find((child) => child.className.includes("etix-seat-focus-layer"))}); },
      getBoundingClientRect: () => ({left: 10, top: 20, width: 200, height: 100})
    };
    nodes.push(element);
    return element;
  };
  const parent = node();
  const canvasElement = node();
  parent.append(canvasElement);
  const orderLink = { textContent: "12345678" };
  const row = { isConnected: true, contains: (link) => link === seatingLink,
    querySelector: () => orderLink };
  const seatingLink = { closest: (selector) => selector === '[role="row"]' ? row : seatingLink };
  const seats = [
    {focused: true, drawAssignedSeatsBgShape() {}, getBoundingRect: () => ({left: 20, top: 10, width: 10, height: 8})},
    {focused: false, drawAssignedSeatsBgShape() {}, getBoundingRect: () => ({left: 50, top: 30, width: 10, height: 8})}
  ];
  const nativeCanvas = { lowerCanvasEl: canvasElement, highlightOrderId: 12345678,
    getWidth: () => 100, getHeight: () => 50, getObjects: () => seats,
    renderAll() { throw new Error("The enhancement must never redraw Etix's canvas"); }
  };
  const require = (id) => id === 81161 ? {dX: () => nativeCanvas} : {jA: (seat) => seat.focused};
  require.m = modulesAvailable ? {81161: true, 81904: true} : {};
  const motion = { matches: reduced, addEventListener(_type, callback) { motionChanged = callback; } };
  const doc = { hidden: false, documentElement: node(),
    getElementById: (id) => id === "canvas" ? canvasElement : null,
    createElement: node,
    addEventListener(type, callback) { if (!handlers.has(type)) handlers.set(type, []); handlers.get(type).push(callback); },
    dispatchEvent(event) {
      events.push(event);
      for (const callback of handlers.get(event.type) || []) callback(event);
      return true;
    }
  };
  const sandbox = {
    EtixCore: core, document: doc,
    location: {hostname: "boxoffice.etix.com", pathname: "/ticket/admin/performanceAdmin/12345678/unassignedSeat.spa"},
    window: {matchMedia: () => motion, webpackChunketix: {push: (chunk) => chunk[2](require)}},
    CustomEvent: class { constructor(type, options = {}) { this.type = type; this.detail = options.detail; } },
    Date: {now: () => now},
    setInterval(callback) { const id = ++counter; intervals.set(id, callback); return id; },
    clearInterval(id) { intervals.delete(id); },
    setTimeout(callback, delay) { const id = ++counter; timeouts.set(id, {callback, delay}); return id; },
    clearTimeout(id) { timeouts.delete(id); },
    chrome: {storage: {
      local: {get: async () => ({"etix.settings": {enhancements: {flashFocusedSeats: enabled}}})},
      onChanged: {addListener(callback) { storageChanged = callback; }}
    }}
  };
  vm.createContext(sandbox);
  for (const filename of ["seat-focus-main.js", "seat-focus.js"]) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, "..", filename), "utf8"), sandbox);
  }
  const click = (overrides = {}) => doc.dispatchEvent({type: "click", target: seatingLink, button: 0, ...overrides});
  return { nodes, events, intervals, timeouts, scrolls, nativeCanvas, seats, row, parent, doc, orderLink, canvasElement,
    click, tick() { for (const callback of [...intervals.values()]) callback(); },
    setTime(value) { now = value; },
    configure(value) { storageChanged({"etix.settings": {newValue: {enhancements: {flashFocusedSeats: value}}}}, "local"); },
    changeMotion(value) { motion.matches = value; motionChanged(); },
    reply(value) { doc.dispatchEvent({type: "etix-support:focused-seats-response", detail: JSON.stringify(value)}); },
    layer: () => parent.children.find((child) => child.className.includes("etix-seat-focus-layer")),
    latestResponse: () => JSON.parse(events.filter((event) => event.type === "etix-support:focused-seats-response").at(-1).detail)
  };
}

test("the focused-seat enhancement is independently available and disabled by default", async () => {
  assert.ok(core.ENHANCEMENTS.some((enhancement) => enhancement.id === "flashFocusedSeats"));
  assert.equal(core.mergeSettings().enhancements.flashFocusedSeats, undefined);
  const page = focusPage({enabled: false});
  await new Promise(setImmediate);
  page.click(); page.tick();
  assert.equal(page.intervals.size, 0);
  assert.equal(page.layer(), undefined);
  assert.equal(page.scrolls.length, 0);
});

test("only the native focused booking's seats get thirty seconds of scaled pulse outlines", async () => {
  const page = focusPage();
  await new Promise(setImmediate);
  const originalStyles = {...page.canvasElement.style};
  page.click(); page.tick();
  const layer = page.layer();
  assert.ok(layer.className.includes("etix-seat-focus-pulse"));
  assert.equal(layer.children.length, 1);
  assert.equal(layer.children[0].style.left, "36px");
  assert.equal(layer.children[0].style.top, "16px");
  assert.equal(layer.children[0].style.width, "28px");
  assert.equal(page.latestResponse().rectangles.length, 1);
  assert.deepEqual(page.canvasElement.style, originalStyles);
  assert.equal(page.nativeCanvas.highlightOrderId, 12345678);
  assert.ok(!JSON.stringify(page.latestResponse()).includes("12345678"));
  page.setTime(29000); page.tick();
  assert.equal(page.layer(), layer);
  const expiry = [...page.timeouts.values()].find((item) => item.delay === 30000);
  assert.ok(expiry); expiry.callback();
  assert.equal(page.layer(), undefined);
  assert.equal(page.intervals.size, 0);
});

test("loading another booking never flashes the previously focused seats", async () => {
  const page = focusPage();
  await new Promise(setImmediate);
  page.nativeCanvas.highlightOrderId = 87654321;
  page.click(); page.tick();
  assert.equal(page.layer(), undefined);
  assert.equal(page.latestResponse().differentBooking, true);
  assert.equal(page.scrolls.length, 0);
  page.nativeCanvas.highlightOrderId = 12345678;
  page.tick();
  assert.ok(page.layer());
});

test("a seating click scrolls to the train before flashing, once per click even with reduced motion", async () => {
  for (const reduced of [false, true]) {
    const page = focusPage({reduced});
    await new Promise(setImmediate);
    page.click(); page.tick();
    assert.equal(page.scrolls.length, 1);
    assert.equal(page.scrolls[0].element, page.canvasElement);
    assert.equal(page.scrolls[0].highlighting, false);
    assert.equal(page.scrolls[0].options.behavior, "instant");
    assert.equal(page.scrolls[0].options.block, "center");
    assert.equal(page.scrolls[0].options.inline, "nearest");
    page.tick(); page.tick();
    assert.equal(page.scrolls.length, 1);
    page.click(); page.tick();
    assert.equal(page.scrolls.length, 2);
  }
});

test("a new action or Escape ends the highlight, while page scrolling keeps it", async () => {
  for (const event of [
    {type: "click", button: 0, target: {closest: () => null}},
    {type: "input"}, {type: "change"}, {type: "submit"}, {type: "keydown", key: "Escape"}
  ]) {
    const page = focusPage();
    await new Promise(setImmediate);
    page.click(); page.tick();
    page.doc.dispatchEvent({type: "scroll"});
    page.row.isConnected = false; // The grid may virtualise the row after scrolling to the train.
    page.tick();
    assert.ok(page.layer());
    page.doc.dispatchEvent(event);
    assert.equal(page.layer(), undefined);
    assert.equal(page.intervals.size, 0);
    assert.equal(page.timeouts.size, 0);
  }
});

test("loading time does not shorten the thirty-second highlight", async () => {
  const page = focusPage();
  await new Promise(setImmediate);
  page.nativeCanvas.highlightOrderId = 87654321;
  page.click(); page.tick();
  page.setTime(25000);
  page.nativeCanvas.highlightOrderId = 12345678;
  page.tick();
  const layer = page.layer();
  page.setTime(31000); page.tick();
  assert.equal(page.layer(), layer);
  assert.equal(page.timeouts.size, 1);
  assert.equal([...page.timeouts.values()][0].delay, 30000);
});

test("a new seating click cancels the old pulse and ignores stale responses", async () => {
  const page = focusPage();
  await new Promise(setImmediate);
  page.click(); page.tick();
  const previous = page.latestResponse();
  page.orderLink.textContent = "87654321";
  page.click();
  assert.equal(page.layer(), undefined);
  page.reply(previous);
  assert.equal(page.layer(), undefined);
  page.nativeCanvas.highlightOrderId = 87654321;
  page.tick();
  assert.ok(page.layer());
});

test("reduced motion uses a steady outline and switching off removes it immediately", async () => {
  const page = focusPage({reduced: true});
  await new Promise(setImmediate);
  page.click(); page.tick();
  assert.equal(page.layer().className, "etix-seat-focus-layer");
  page.changeMotion(false);
  assert.ok(page.layer().className.includes("etix-seat-focus-pulse"));
  page.configure(false);
  assert.equal(page.layer(), undefined);
  assert.equal(page.intervals.size, 0);
  assert.equal(page.timeouts.size, 0);
});

test("missing native support and offscreen seats do not create guessed highlights", async () => {
  const unsupported = focusPage({modulesAvailable: false});
  await new Promise(setImmediate);
  unsupported.click(); unsupported.tick();
  assert.equal(unsupported.layer(), undefined);
  unsupported.setTime(30001); unsupported.tick();
  assert.equal(unsupported.intervals.size, 0);
  const page = focusPage();
  await new Promise(setImmediate);
  page.seats[0].getBoundingRect = () => ({left: 200, top: 200, width: 10, height: 10});
  page.click(); page.tick();
  assert.equal(page.layer(), undefined);
});

test("modified clicks, hidden pages and removed booking rows stop pending highlights", async () => {
  const page = focusPage();
  await new Promise(setImmediate);
  page.click({metaKey: true}); page.click({button: 1});
  assert.equal(page.intervals.size, 0);
  page.click(); page.tick();
  page.doc.hidden = true;
  page.doc.dispatchEvent({type: "visibilitychange"});
  assert.equal(page.layer(), undefined);
  page.doc.hidden = false;
  page.click();
  page.row.isConnected = false;
  page.tick();
  assert.equal(page.intervals.size, 0);
});
