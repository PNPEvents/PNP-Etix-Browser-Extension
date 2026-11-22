(function initialiseDoorAccessColumn() {
  "use strict";
  if (location.hostname !== "boxoffice.etix.com" ||
      !/^\/ticket\/admin\/performanceAdmin\/[^/]+\/unassignedSeat\.spa$/.test(location.pathname)) return;

  const FIELD = "etixDoorAccessRequest";
  const ICON = "\u267f\ufe0e";
  const LABEL = "Closer to carriage doors requested";
  const QUESTION = "Do you or any member of your party have a disability and would prefer to sit closer to the doors of the carriage for ease of access? We will try to accommodate this request.";
  let enabled = false;
  let session = null;
  let pending = null;
  let timer = null;

  function normalise(value) {
    if (typeof value !== "string") return "";
    return value.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>|<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, " ")
      .replace(/<[^>]*>/g, " ")
      .replace(/&(#x[\da-f]+|#\d+|nbsp|amp|quot|apos|lt|gt);/gi, (match, entity) => {
        const key = entity.toLowerCase();
        if (key[0] !== "#") return {nbsp: " ", amp: "&", quot: '"', apos: "'", lt: "<", gt: ">"}[key];
        const code = key[1] === "x" ? parseInt(key.slice(2), 16) : Number(key.slice(1));
        return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
      }).normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  }

  const questionKey = normalise(QUESTION);
  function requested(row) {
    return Array.isArray(row?.orderLevelMiscInfos) && row.orderLevelMiscInfos.some((answer) =>
      normalise(answer?.name) === questionKey && normalise(answer?.response) === "yes");
  }

  const column = {
    field: FIELD, headerName: ICON, description: `${LABEL}. Icon shown only for a Yes answer to: ${QUESTION}`,
    width: 56, minWidth: 56, maxWidth: 56, align: "center", headerAlign: "center",
    sortable: false, filterable: false, editable: false, resizable: false,
    hideable: false, disableColumnMenu: true, disableExport: true,
    // MUI v5/v6 pass cell params; v7+ pass (value, row).
    valueGetter: (params, row) => enabled && requested(params?.row || row) ? ICON : ""
  };

  function findGrid() {
    const grid = document.querySelector(".MuiDataGrid-root");
    if (!grid) return null;
    const key = Object.keys(grid).find((name) => name.startsWith("__reactFiber$") || name.startsWith("__reactInternalInstance$"));
    for (let fibre = grid[key], depth = 0; fibre && depth < 100; fibre = fibre.return, depth++) {
      const values = [fibre.memoizedProps?.value, fibre.memoizedProps?.apiRef, fibre.memoizedProps?.privateApiRef];
      for (let context = fibre.dependencies?.firstContext, count = 0; context && count < 30; context = context.next, count++) values.push(context.memoizedValue);
      for (const value of values) {
        const api = value?.current || value;
        if (api && ["getRowModels", "getColumn", "updateColumns", "setColumnVisibility"].every((method) => typeof api[method] === "function")) return {api, grid};
      }
    }
    return null;
  }

  function schedule() {
    if (enabled && pending === null) pending = setTimeout(() => { pending = null; scan(); }, 100);
  }
  const observer = new MutationObserver(schedule);

  function release() {
    const previous = session;
    session = null;
    previous?.unsubscribe?.();
    if (previous?.grid.isConnected && previous.api.getColumn(FIELD)) previous.api.setColumnVisibility(FIELD, false);
  }

  function scan() {
    if (!enabled) return;
    try {
      const found = findGrid();
      if (!found) return;
      if (session?.api !== found.api || session.grid !== found.grid) {
        release();
        session = {...found, unsubscribe: found.api.subscribeEvent?.("columnsChange", schedule)};
      }
      const {api} = session;
      if (api.getColumn(FIELD)?.valueGetter !== column.valueGetter) {
        api.updateColumns([column]);
        const index = api.getAllColumns?.().findIndex((item) => item.field === "customerName");
        if (index >= 0) api.setColumnIndex?.(FIELD, index + 1);
      }
      if (api.state?.columns?.columnVisibilityModel?.[FIELD] === false) api.setColumnVisibility(FIELD, true);
      const header = found.grid.querySelector(`[role="columnheader"][data-field="${FIELD}"]`);
      if (header?.getAttribute("aria-label") !== LABEL) header?.setAttribute("aria-label", LABEL);
      for (const cell of found.grid.querySelectorAll(`.MuiDataGrid-cell[data-field="${FIELD}"]`)) {
        const title = cell.textContent.trim() ? `${LABEL} — Yes` : "";
        if (title && cell.getAttribute("title") !== title) cell.setAttribute("title", title);
        else if (!title) cell.removeAttribute("title");
        if (title && cell.getAttribute("aria-label") !== title) cell.setAttribute("aria-label", title);
        else if (!title) cell.removeAttribute("aria-label");
      }
    } catch (_error) { /* A loading or replaced grid is retried without changing its rows. */ }
  }

  document.addEventListener("etix-support:door-access-configure", (event) => {
    let request;
    try { request = JSON.parse(event.detail); } catch (_error) { return; }
    if (!Number.isSafeInteger(request?.id) || typeof request.enabled !== "boolean") return;
    enabled = request.enabled;
    observer.disconnect();
    clearInterval(timer); clearTimeout(pending);
    timer = null; pending = null;
    if (enabled) {
      observer.observe(document.documentElement, {childList: true, characterData: true, subtree: true});
      scan(); timer = setInterval(scan, 1000);
    } else {
      try { release(); } catch (_error) {}
    }
    document.dispatchEvent(new CustomEvent("etix-support:door-access-configured", {detail: JSON.stringify({id: request.id})}));
  });
})();
