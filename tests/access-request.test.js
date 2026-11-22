const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const core = require("../shared.js");
const FIELD = "etixDoorAccessRequest";
const QUESTION = "Do you or any member of your party have a disability and would prefer to sit closer to the doors of the carriage for ease of access? We will try to accommodate this request.";

function page({enabled = true, isolatedFirst = false} = {}) {
  const handlers = new Map();
  const timers = new Map();
  const subscribers = new Map();
  const events = [];
  const columns = new Map(["orderId", "customerName", "seating"].map((field) => [field, {field, renderCell: () => "native"}]));
  const originals = [...columns.values()];
  const rows = new Map(Array.from({length: 106}, (_, index) => [index, {orderId: index,
    orderLevelMiscInfos: [{name: `<div>${QUESTION}</div>`, response: index === 105 ? "<div>Yes</div>" : "<div>No</div>"}]}]));
  let order = [...columns.keys()];
  let counter = 0;
  let storageChanged;
  const element = () => ({textContent: "", attrs: {}, getAttribute(key) {return this.attrs[key] ?? null;},
    setAttribute(key, value) {this.attrs[key] = value;}, removeAttribute(key) {delete this.attrs[key];}});
  const header = element();
  const cell = element();
  const api = {
    state: {columns: {columnVisibilityModel: {}}, pagination: {page: 1}},
    getRowModels: () => rows, getColumn: (field) => columns.get(field),
    getAllColumns: () => order.map((field) => columns.get(field)),
    updateColumns(updates) { for (const col of updates) {columns.set(col.field, col); if (!order.includes(col.field)) order.push(col.field);} },
    setColumnVisibility(field, visible) { api.state.columns.columnVisibilityModel[field] = visible; },
    setColumnIndex(field, index) {order = order.filter((item) => item !== field); order.splice(index, 0, field);},
    subscribeEvent(name, callback) {subscribers.set(name, callback); return () => subscribers.delete(name);}
  };
  const grid = {isConnected: true, __reactFiber$fixture: {memoizedProps: {value: {current: api}}},
    querySelector: () => columns.has(FIELD) ? header : null, querySelectorAll: () => columns.has(FIELD) ? [cell] : []};
  const doc = {documentElement: {}, querySelector: () => grid,
    addEventListener(name, callback) {handlers.set(name, callback);},
    dispatchEvent(event) {events.push(event); handlers.get(event.type)?.(event);}};
  const sandbox = {EtixCore: core, document: doc,
    location: {hostname: "boxoffice.etix.com", pathname: "/ticket/admin/performanceAdmin/12345678/unassignedSeat.spa"},
    MutationObserver: class {observe() {} disconnect() {}},
    CustomEvent: class {constructor(type, options) {this.type = type; this.detail = options.detail;}},
    setTimeout(callback) {const id = ++counter; timers.set(id, () => {timers.delete(id); callback();}); return id;}, clearTimeout(id) {timers.delete(id);},
    setInterval(callback) {const id = ++counter; timers.set(id, callback); return id;}, clearInterval(id) {timers.delete(id);},
    chrome: {storage: {local: {get: async () => ({"etix.settings": {enhancements: {doorAccessColumn: enabled}}})},
      onChanged: {addListener(callback) {storageChanged = callback;}}}}
  };
  vm.createContext(sandbox);
  const load = (filename) => vm.runInContext(fs.readFileSync(path.join(__dirname, "..", filename), "utf8"), sandbox);
  load(isolatedFirst ? "access-request.js" : "access-request-main.js");
  if (!isolatedFirst) load("access-request.js");
  return {api, rows, columns, originals, events, timers, header, cell,
    order: () => order,
    loadMain: () => load("access-request-main.js"),
    tick() {for (const callback of [...timers.values()]) callback();},
    configure(value) {storageChanged({"etix.settings": {newValue: {enhancements: {doorAccessColumn: value}}}}, "local");},
    refreshColumns() {columns.delete(FIELD); order = order.filter((field) => field !== FIELD); subscribers.get("columnsChange")?.();},
    icon(row, modern = false) {return modern ? columns.get(FIELD).valueGetter(undefined, row) : columns.get(FIELD).valueGetter({row});}
  };
}

test("the door-access column is a separate enhancement and starts disabled", async () => {
  assert.ok(core.ENHANCEMENTS.some((entry) => entry.id === "doorAccessColumn"));
  assert.notEqual(core.mergeSettings().enhancements.doorAccessColumn, true);
  const view = page({enabled: false});
  await new Promise(setImmediate);
  assert.equal(view.columns.has(FIELD), false);
  assert.equal(view.timers.size, 0);
});

test("only an explicit Yes to the exact order-level question gets an icon, including beyond page one", async () => {
  const view = page();
  await new Promise(setImmediate);
  assert.equal(view.columns.get(FIELD).headerName, "♿︎");
  for (const modern of [false, true]) {
    assert.equal(view.icon(view.rows.get(105), modern), "♿︎");
    assert.equal(view.icon(view.rows.get(0), modern), "");
    assert.equal(view.icon({orderLevelMiscInfos: [{name: "Another question", response: "Yes"}]}), "");
    assert.equal(view.icon({ticketLevelMiscInfos: [{name: QUESTION, response: "Yes"}]}), "");
    assert.equal(view.icon({orderLevelMiscInfos: [{name: QUESTION, response: "Not yes"}]}), "");
    assert.equal(view.icon({}), "");
  }
  assert.equal(view.icon({orderLevelMiscInfos: [{name: `<p>${QUESTION}</p>`, response: "<p>&nbsp;Y&#101;s </p>"}]}), "♿︎");
});

test("native column refreshes and disabling retain rows, pagination and native renderers", async () => {
  const view = page();
  await new Promise(setImmediate);
  const rowsBefore = JSON.stringify([...view.rows]);
  assert.deepEqual(view.order(), ["orderId", "customerName", FIELD, "seating"]);
  assert.equal(view.columns.get(FIELD).filterable, false);
  assert.equal(view.columns.get(FIELD).sortable, false);
  assert.equal(view.columns.get(FIELD).disableExport, true);
  view.refreshColumns(); view.tick();
  assert.equal(view.icon(view.rows.get(105)), "♿︎");
  view.configure(false);
  assert.equal(view.api.state.columns.columnVisibilityModel[FIELD], false);
  assert.equal(view.icon(view.rows.get(105)), "");
  assert.equal(view.timers.size, 0);
  view.configure(true);
  assert.equal(view.api.state.columns.columnVisibilityModel[FIELD], true);
  assert.equal(view.icon(view.rows.get(105)), "♿︎");
  for (const col of view.originals) assert.equal(view.columns.get(col.field), col);
  assert.equal(view.api.state.pagination.page, 1);
  assert.equal(JSON.stringify([...view.rows]), rowsBefore);
});

test("icon cells have explanatory labels and recycled No cells do not keep a Yes tooltip", async () => {
  const view = page();
  await new Promise(setImmediate);
  view.cell.textContent = "♿︎"; view.tick();
  assert.match(view.header.attrs["aria-label"], /Closer to carriage doors requested/);
  assert.match(view.cell.attrs.title, /Yes/);
  view.cell.textContent = ""; view.tick();
  assert.equal(view.cell.attrs.title, undefined);
  assert.equal(view.cell.attrs["aria-label"], undefined);
  assert.ok(view.events.every((event) => !event.detail.includes(QUESTION)));
});

test("configuration recovers when the MAIN script loads after the settings script", async () => {
  const view = page({isolatedFirst: true});
  await new Promise(setImmediate);
  assert.equal(view.columns.has(FIELD), false);
  view.loadMain(); view.tick();
  assert.equal(view.icon(view.rows.get(105)), "♿︎");
  assert.equal(view.timers.size, 1); // Only the MAIN grid-recovery timer remains.
});
