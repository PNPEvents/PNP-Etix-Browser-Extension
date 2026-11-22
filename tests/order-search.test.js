const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const core = require("../shared.js");

function searchGrid({legacy = false, baselineItems = [], server = false, contextDependency = false} = {}) {
  const handlers = new Map();
  const subscriptions = new Map();
  const attributes = new Map();
  const columns = new Map(["orderId", "customerName", "seating"].map((field) => [field, {
    field, filterable: true, renderCell: (params) => `Native link for ${params.value}`, filterOperators: [{value: "contains", getApplyFilterFn: (item) => legacy
      ? (params) => String(params.value).includes(item.value)
      : (value) => String(value).includes(item.value)},
      {value: "isAnyOf", getApplyFilterFn: (item) => !item.value?.length ? null : legacy
        ? (params) => item.value.map(String).includes(String(params.value))
        : (value) => item.value.map(String).includes(String(value))}]
  }]));
  const rows = new Map(Array.from({length: 106}, (_, index) => [index + 1, {
    id: index + 1, orderId: String(470000001 + index), customerName: `Customer ${index + 1}`, seating: "Door A"
  }]));
  rows.get(106).customerName = "García, Taylor";
  rows.get(105).customerName = "Taylor, Morgan";
  const originalRows = JSON.stringify(Array.from(rows));
  const originalOperators = columns.get("orderId").filterOperators;
  const originalRenderer = columns.get("orderId").renderCell;
  const initialModel = legacy ? {items: baselineItems, linkOperator: "and"} : {items: baselineItems, logicOperator: "and"};
  const api = {
    state: {filter: {filterModel: initialModel, filteredRowsLookup: {}}, pagination: {page: 1},
      rows: {totalRowCount: server ? 300 : 106}, sorting: {sortModel: [{field: "orderId", sort: "asc"}]}},
    getRowModels: () => rows,
    getColumn: (field) => columns.get(field),
    getRowId: (row) => row.id,
    getCellValue: (id, field) => rows.get(id)?.[field],
    getCellParams: (id, field) => ({id, field, row: rows.get(id), value: rows.get(id)?.[field], formattedValue: rows.get(id)?.[field]}),
    updateColumns(updates) {
      throw new Error("Search must never alter native column definitions");
    },
    setRows() { throw new Error("Search must never replace native row data"); },
    setPage(page) { api.state.pagination.page = page; },
    setFilterModel(model) {
      api.state.filter.filterModel = model;
      const filters = (model.items || []).map((item) => {
        const col = columns.get(item.field || item.columnField);
        return {item, col, apply: col.filterOperators.find((operator) => operator.value === (item.operator || item.operatorValue)).getApplyFilterFn(item, col)};
      });
      const lookup = {};
      for (const [id, row] of rows) {
        lookup[id] = filters.every(({item, col, apply}) => !apply || (legacy
          ? apply(api.getCellParams(id, item.columnField || item.field))
          : apply(api.getCellValue(id, item.field || item.columnField), row, col, {current: api})));
      }
      api.state.filter.filteredRowsLookup = lookup;
      for (const callback of subscriptions.get("filterModelChange") || []) callback(model);
    },
    subscribeEvent(name, callback) {
      if (!subscriptions.has(name)) subscriptions.set(name, new Set());
      subscriptions.get(name).add(callback);
      return () => subscriptions.get(name).delete(callback);
    }
  };
  const grid = {isConnected: true};
  grid.__reactFiber$fixture = contextDependency
    ? {memoizedProps: {}, dependencies: {firstContext: {memoizedValue: {current: api}}}}
    : {memoizedProps: {}, return: {memoizedProps: {value: {current: api}}}};
  const doc = {
    body: {textContent: "Total Orders: 106"}, documentElement: {setAttribute: (name, value) => attributes.set(name, value)},
    querySelector: () => grid,
    addEventListener(name, callback) { handlers.set(name, callback); },
    dispatchEvent(event) { const callback = handlers.get(event.type); if (callback) callback(event); }
  };
  let response;
  handlers.set("etix-support:order-search-response", (event) => { response = JSON.parse(event.detail); });
  const sandbox = {
    document: doc,
    location: {hostname: "boxoffice.etix.com", pathname: "/ticket/admin/performanceAdmin/12345678/unassignedSeat.spa"},
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } }
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../order-search-main.js"), "utf8"), sandbox);
  let id = 0;
  return {api, rows, columns, grid, doc, originalRows, originalOperators, originalRenderer, attributes,
    search(query, enabled = true) {
      doc.dispatchEvent({type: "etix-support:order-search-request", detail: JSON.stringify({id: ++id, query, enabled})});
      return response;
    },
    visible: () => [...rows.values()].filter((row) => api.state.filter.filteredRowsLookup[row.id] !== false),
    rowsUpdated() { api.setFilterModel(api.state.filter.filterModel); for (const callback of subscriptions.get("rowsSet") || []) callback(); },
    refreshColumns(notify = true) {
      columns.set("orderId", {...columns.get("orderId"), filterOperators: originalOperators, filterable: false});
      // MUI evaluates the active model during the render, before subscribers can
      // repair a removed custom operator. This must be safe synchronously.
      api.setFilterModel(api.state.filter.filterModel);
      if (notify) for (const callback of subscriptions.get("columnsChange") || []) callback();
    },
    latestResponse: () => response
  };
}

test("the search enhancement is separate and starts disabled", () => {
  assert.ok(core.ENHANCEMENTS.some((enhancement) => enhancement.id === "searchUnassignedOrders"));
  assert.equal(core.mergeSettings().enhancements.searchUnassignedOrders, undefined);
});

test("order-number search filters the complete row model, including a booking beyond page one", () => {
  for (const legacy of [false, true]) {
    const grid = searchGrid({legacy});
    const target = grid.rows.get(106).orderId;
    const result = grid.search(target);
    assert.equal(result.supported, true);
    assert.equal(result.total, 106);
    assert.equal(result.matches, 1);
    assert.deepEqual(grid.visible().map((row) => row.id), [106]);
    assert.equal(grid.api.state.pagination.page, 0);
    assert.equal(JSON.stringify(Array.from(grid.rows)), grid.originalRows);
    assert.deepEqual(grid.api.state.sorting.sortModel, [{field: "orderId", sort: "asc"}]);
  }
});

test("partial names ignore case and accents and allow first/last names in either order", () => {
  const grid = searchGrid({contextDependency: true});
  assert.equal(grid.search("tAyL").matches, 2);
  assert.deepEqual(grid.visible().map((row) => row.id), [105,106]);
  assert.equal(grid.search("Taylor Garcia").matches, 1);
  assert.deepEqual(grid.visible().map((row) => row.id), [106]);
  assert.equal(grid.search("Door A").matches, 0);
});

test("clearing and disabling restore native filters and column configuration without losing rows", () => {
  for (const legacy of [false, true]) {
    const baseline = legacy ? {columnField: "customerName", operatorValue: "contains", value: "Taylor"}
      : {field: "customerName", operator: "contains", value: "Taylor"};
    const grid = searchGrid({legacy, baselineItems: [baseline]});
    assert.equal(grid.search("Customer").matches, 0);
    grid.search("");
    assert.equal(grid.visible().length, 2);
    grid.search("Garcia");
    grid.search("", false);
    assert.equal(grid.columns.get("orderId").filterOperators, grid.originalOperators);
    assert.deepEqual(grid.api.state.filter.filterModel.items, [baseline]);
    assert.equal(grid.visible().length, 2);
    assert.equal(JSON.stringify(Array.from(grid.rows)), grid.originalRows);
  }
});

test("zero matches keep the native data intact and a new query can recover", () => {
  const grid = searchGrid();
  assert.equal(grid.search("nobody-matches-this").matches, 0);
  assert.equal(grid.visible().length, 0);
  assert.equal(grid.rows.size, 106);
  assert.equal(grid.search("470000106").matches, 1);
  grid.search("");
  assert.equal(grid.visible().length, 106);
});

test("server-paginated data is not presented as a complete all-pages search", () => {
  const grid = searchGrid({server: true});
  const result = grid.search("Taylor");
  assert.equal(result.supported, false);
  assert.equal(result.reason, "server_pagination");
  assert.equal(grid.api.state.pagination.page, 1);
  assert.equal(grid.columns.get("orderId").filterOperators, grid.originalOperators);
});

test("search replies expose only counts and status, never customer records or the search phrase", () => {
  const result = searchGrid().search("Garcia");
  const serialised = JSON.stringify(result);
  assert.equal(result.namesReadable, true);
  assert.doesNotMatch(serialised, /Garcia|García|Taylor|customerName|470000106/);
});

test("native booking renderers survive searching and restoring the column", () => {
  const grid = searchGrid();
  grid.search("Taylor");
  assert.equal(grid.columns.get("orderId").renderCell, grid.originalRenderer);
  grid.search("", false);
  assert.equal(grid.columns.get("orderId").renderCell, grid.originalRenderer);
});

test("assignment-view row updates refresh the result count without replacing native rows", async () => {
  const grid = searchGrid();
  grid.search("Taylor");
  grid.rows.clear();
  grid.rows.set(999, {id: 999, orderId: "12345678", customerName: "Taylor, Alex"});
  grid.rowsUpdated();
  await new Promise(setImmediate);
  assert.equal(grid.latestResponse().total, 1);
  assert.equal(grid.latestResponse().matches, 1);
  assert.equal(grid.visible().length, 1);
});

test("an empty assignment view stays searchable while its grid interface is unmounted", () => {
  const page = searchGrid();
  page.rows.clear();
  page.doc.body.textContent = "Total Orders : 0 Total Tickets : 0";
  delete page.grid.__reactFiber$fixture;
  const empty = page.search("Taylor");
  assert.equal(empty.supported, true);
  assert.equal(empty.total, 0);
  assert.equal(empty.matches, 0);
  page.doc.body.textContent = "Total Orders : 106 Total Tickets : 486";
  const unavailable = page.search("Taylor");
  assert.equal(unavailable.supported, false);
  assert.equal(unavailable.reason, "loading");
});

test("search recovers when Etix replaces column definitions before a query", () => {
  const grid = searchGrid();
  grid.search("");
  grid.refreshColumns(false);
  assert.equal(grid.search("Garcia").supported, true);
  assert.deepEqual(grid.visible().map((row) => row.id), [106]);
  assert.equal(grid.search("Taylor").matches, 2);
  grid.search("", false);
  assert.equal(grid.columns.get("orderId").filterOperators, grid.originalOperators);
  assert.equal(grid.columns.get("orderId").filterable, false);
});

test("native filters survive synchronous column refresh without changing the current page", async () => {
  const grid = searchGrid();
  grid.search("Taylor");
  grid.api.setPage(1);
  grid.refreshColumns();
  await new Promise(setImmediate);
  assert.equal(grid.latestResponse().supported, true);
  assert.equal(grid.latestResponse().matches, 2);
  assert.equal(grid.api.state.pagination.page, 1);
  assert.deepEqual(grid.visible().map((row) => row.id), [105, 106]);
  grid.refreshColumns();
  await new Promise(setImmediate);
  assert.equal(grid.columns.get("orderId").filterOperators, grid.originalOperators);
  assert.equal(grid.api.state.filter.filterModel.items[0].operator, "isAnyOf");
  grid.search("", false);
  assert.equal(JSON.stringify(Array.from(grid.rows)), grid.originalRows);
});

test("a slow order list recovers after the old five-second cutoff and stops retrying on success or disable", async () => {
  const handlers = new Map();
  const timers = new Map();
  const elements = [];
  const requests = [];
  let timerId = 0;
  let elapsed = 0;
  let storageChanged;
  const parent = {style: {getPropertyValue: () => "", getPropertyPriority: () => "", setProperty() {}, removeProperty() {}}};
  const group = {parentElement: parent, querySelectorAll: () => ["Unassigned", "Assigned", "All"].map((textContent) => ({textContent})), insertAdjacentElement() {}};
  const grid = {};
  const doc = {
    body: {textContent: "Total Orders: 106"}, documentElement: {},
    querySelector: () => grid, querySelectorAll: () => [group],
    createElement(tag) {
      const element = {tag, isConnected: true, value: "", setAttribute() {}, addEventListener() {}, append() {}, remove() {this.isConnected = false;}};
      elements.push(element);
      return element;
    },
    addEventListener(name, callback) { handlers.set(name, callback); },
    dispatchEvent(event) {
      if (event.type === "etix-support:order-search-request") requests.push(JSON.parse(event.detail));
      handlers.get(event.type)?.(event);
    }
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../order-search.js"), "utf8"), {
    document: doc, EtixCore: core,
    location: {hostname: "boxoffice.etix.com", pathname: "/ticket/admin/performanceAdmin/12345678/unassignedSeat.spa"},
    MutationObserver: class {observe() {} disconnect() {}},
    CustomEvent: class {constructor(type, options) {this.type = type; this.detail = options.detail;}},
    setTimeout(callback, delay) {const id = ++timerId; timers.set(id, {callback, delay}); return id;},
    clearTimeout(id) {timers.delete(id);},
    chrome: {storage: {local: {get: async () => ({"etix.settings": {enhancements: {searchUnassignedOrders: true}}})},
      onChanged: {addListener(callback) {storageChanged = callback;}}}}
  });
  await new Promise(setImmediate);
  const respond = (result) => doc.dispatchEvent({type: "etix-support:order-search-response", detail: JSON.stringify({id: requests.at(-1).id, ...result})});
  for (let attempt = 0; attempt < 25; attempt++) {
    respond({supported: false, reason: attempt % 2 ? "unavailable" : "loading"});
    assert.equal(timers.size, 1);
    const [id, timer] = [...timers][0];
    timers.delete(id); elapsed += timer.delay; timer.callback();
  }
  assert.ok(elapsed > 5000);
  respond({supported: true, namesReadable: true, total: 106, matches: 106});
  assert.equal(timers.size, 0);
  assert.equal(elements.find((el) => el.tag === "span").textContent, "Searches all pages in this view.");
  respond({supported: false, reason: "loading"});
  assert.equal(timers.size, 1);
  storageChanged({"etix.settings": {newValue: {enhancements: {searchUnassignedOrders: false}}}}, "local");
  assert.equal(timers.size, 0);
  assert.equal(requests.at(-1).enabled, false);
});
