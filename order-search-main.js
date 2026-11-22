(function initialiseOrderSearchAdapter() {
  "use strict";
  if (location.hostname !== "boxoffice.etix.com" ||
      !/^\/ticket\/admin\/performanceAdmin\/[^/]+\/unassignedSeat\.spa$/.test(location.pathname)) return;

  const FILTER_ID = "etix-support-order-search";
  const OPERATOR = "isAnyOf";
  let session = null;

  const text = (value) => typeof value === "string" || typeof value === "number" ? String(value) : "";
  const normalise = (value) => text(value).normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

  function asApi(value) {
    const candidate = value && (value.current || value);
    return candidate && ["getRowModels", "getColumn", "setFilterModel", "setPage"]
      .every((key) => typeof candidate[key] === "function") ? candidate : null;
  }

  function findGridApi() {
    const grid = document.querySelector(".MuiDataGrid-root");
    if (!grid) return null;
    const fibreKey = Object.keys(grid).find((key) => key.startsWith("__reactFiber$") || key.startsWith("__reactInternalInstance$"));
    // Locate MUI's existing API context. React state and props are never rewritten.
    let fibre = fibreKey && grid[fibreKey];
    let paginationMode = null;
    for (let depth = 0; fibre && depth < 100; depth++, fibre = fibre.return) {
      const props = fibre.memoizedProps || {};
      paginationMode = props.paginationMode || paginationMode;
      if (props.value?.paginationMode) paginationMode = props.value.paginationMode;
      for (const value of [props.value, props.apiRef, props.privateApiRef]) {
        const api = asApi(value);
        if (api) return {grid, api, props: {paginationMode}};
      }
      for (let context = fibre.dependencies?.firstContext, count = 0; context && count < 30; context = context.next, count++) {
        const api = asApi(context.memoizedValue);
        if (api) return {grid, api, props: {paginationMode}};
      }
    }
    return null;
  }

  function cellText(api, row, id, field) {
    let value = "";
    try { value = text(api.getCellValue?.(id, field)); } catch (_error) {}
    if (!value) {
      try { value = text(api.getCellParams?.(id, field)?.formattedValue); } catch (_error) {}
    }
    return value || text(row[field]);
  }

  function record(api, row, id) {
    const customer = row.customer || {};
    return {
      order: cellText(api, row, id, "orderId") || text(row.orderNumber) || text(id),
      name: cellText(api, row, id, "customerName") || text(row.customerFullName) ||
        [row.firstName || row.customerFirstName || customer.firstName,
          row.lastName || row.customerLastName || customer.lastName].map(text).filter(Boolean).join(" ")
    };
  }

  function matches(entry, query) {
    const needle = normalise(query);
    if (!needle) return true;
    return normalise(entry.order).includes(needle) ||
      needle.split(" ").every((part) => normalise(entry.name).includes(part));
  }

  function originalModel(api) {
    return api.state?.filter?.filterModel || {items: []};
  }

  function createSession(found) {
    const {api, grid} = found;
    const column = api.getColumn("orderId");
    if (!column?.filterOperators?.some((item) => item.value === OPERATOR) || !api.getColumn("customerName")) return null;
    const baseline = originalModel(api);
    const state = {api, grid, baseline, query: "", applying: false, requestId: null, unsubscribe: null};
    if (typeof api.subscribeEvent === "function") {
      const unsubscribers = [];
      unsubscribers.push(api.subscribeEvent("filterModelChange", (model) => {
        if (state.applying) return;
        if (model.items?.some((item) => item.id === FILTER_ID)) {
          state.baseline = {...model, items: state.baseline.items};
          return;
        }
        state.baseline = model;
        if (state.query) applySearch(state, state.query);
      }));
      unsubscribers.push(api.subscribeEvent("rowsSet", () => {
        Promise.resolve().then(() => {
          if (session === state && state.requestId !== null && state.grid.isConnected) {
            try {
              if (state.query) applySearch(state, state.query, false);
              publish(state.requestId, summary(state));
            } catch (_error) { publish(state.requestId, {supported: false, reason: "unavailable"}); }
          }
        });
      }));
      state.unsubscribe = () => unsubscribers.forEach((unsubscribe) => unsubscribe?.());
    }
    return state;
  }

  function baselineMatcher(state) {
    const {api, baseline: model} = state;
    const legacy = "linkOperator" in model && !("logicOperator" in model);
    const filters = (model.items || []).map((filter) => {
      const field = filter.field || filter.columnField;
      const col = api.getColumn(field);
      const operator = col?.filterOperators?.find((option) => option.value === (filter.operator || filter.operatorValue));
      const apply = operator?.getApplyFilterFn(filter, col, {current: api});
      return typeof apply === "function" ? {apply, field, col} : null;
    }).filter(Boolean);
    return (row, id) => {
      if (!filters.length) return true;
      const results = filters.map(({apply, field, col}) => {
        const params = api.getCellParams?.(id, field) || {id, field, row, value: api.getCellValue?.(id, field)};
        return legacy ? apply(params) : apply(params.value, row, col, {current: api});
      });
      return (model.logicOperator || model.linkOperator) === "or" ? results.some(Boolean) : results.every(Boolean);
    };
  }

  function applySearch(state, query, resetPage = true) {
    state.query = query;
    state.applying = true;
    try {
      // Use MUI's built-in operator. Etix replaces column definitions during
      // renders, so a custom operator can disappear mid-render and crash the grid.
      const orders = [];
      if (query) {
        const keep = baselineMatcher(state);
        state.api.getRowModels().forEach((row, id) => {
          const entry = record(state.api, row, id);
          if (matches(entry, query) && keep(row, id)) orders.push(entry.order);
        });
      }
      state.api.setFilterModel(query ? {...state.baseline, items: [{
        id: FILTER_ID, field: "orderId", columnField: "orderId",
        operator: OPERATOR, operatorValue: OPERATOR,
        // An empty isAnyOf value disables filtering, so use a non-order sentinel.
        value: orders.length ? orders : ["__etix_support_no_matching_order__"]
      }]} : state.baseline);
      if (resetPage) state.api.setPage(0);
    } finally { state.applying = false; }
  }

  function restore() {
    if (!session) return;
    const state = session;
    session = null;
    state.unsubscribe?.();
    if (state.grid.isConnected) {
      state.applying = true;
      state.api.setFilterModel(state.baseline);
      state.api.setPage(0);
    }
  }

  function summary(state) {
    const rows = state.api.getRowModels();
    const lookup = state.api.state?.filter?.filteredRowsLookup || state.api.state?.filter?.visibleRowsLookup;
    let matchesCount = 0;
    let readableNames = 0;
    rows.forEach((row, id) => {
      const entry = record(state.api, row, id);
      if (entry.name) readableNames++;
      if (matches(entry, state.query) && (!lookup || lookup[id] !== false)) matchesCount++;
    });
    return {supported: true, total: rows.size, matches: matchesCount, namesReadable: readableNames > 0 || rows.size === 0};
  }

  function publish(id, result, query = session?.query || "") {
    document.documentElement.setAttribute("data-etix-order-search-state", result.supported ? (query ? "filtered" : "ready") : result.reason);
    if (result.total !== undefined) document.documentElement.setAttribute("data-etix-order-search-total", String(result.total));
    document.dispatchEvent(new CustomEvent("etix-support:order-search-response", {detail: JSON.stringify({id, ...result})}));
  }

  document.addEventListener("etix-support:order-search-request", (event) => {
    let request;
    try { request = JSON.parse(event.detail); } catch (_error) { return; }
    if (!Number.isSafeInteger(request?.id) || typeof request.query !== "string" || request.query.length > 120 || typeof request.enabled !== "boolean") return;
    let result;
    try {
      if (!request.enabled) { restore(); result = {supported: true, cleared: true}; }
      else {
        const found = findGridApi();
        const noOrders = /Total Orders\s*:?\s*0\b/i.test(document.body.innerText || document.body.textContent);
        if (noOrders && (!found || found.api.getRowModels().size === 0)) {
          if (session && found?.api === session.api) {
            session.requestId = request.id;
            applySearch(session, request.query.trim());
          }
          result = {supported: true, total: 0, matches: 0, namesReadable: true};
        } else if (!found) result = {supported: false, reason: "loading"};
        else if (found.api.state?.pagination?.paginationMode === "server" || found.props.paginationMode === "server" ||
          found.api.state?.rows?.totalRowCount > found.api.getRowModels().size) {
          result = {supported: false, reason: "server_pagination"};
        } else {
          if (!session || session.api !== found.api || session.grid !== found.grid) {
            restore();
            session = createSession(found);
          }
          if (!session) result = {supported: false, reason: "unsupported_columns"};
          else {
            session.requestId = request.id;
            applySearch(session, request.query.trim());
            result = summary(session);
          }
        }
      }
    } catch (_error) { result = {supported: false, reason: "unavailable"}; }
    publish(request.id, result, request.query);
  });
})();
