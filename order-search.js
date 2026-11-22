(function initialiseUnassignedOrderSearch() {
  "use strict";

  const extensionApi = globalThis.browser || globalThis.chrome;
  if (location.hostname !== "boxoffice.etix.com" ||
      !/^\/ticket\/admin\/performanceAdmin\/[^/]+\/unassignedSeat\.spa$/.test(location.pathname)) return;

  let enabled = false;
  let control = null;
  let input = null;
  let status = null;
  let query = "";
  let sequence = 0;
  let latestRequest = 0;
  let debounce = null;
  let retry = null;
  let scanTimer = null;
  let attempts = 0;
  let parentStyle = null;
  let currentGrid = null;
  let currentOrderCount = null;
  const observer = new MutationObserver((changes) => {
    if (changes.some((change) => !change.target.closest?.("[data-etix-enhancement-owned]"))) scheduleMount();
  });

  function request(active = enabled) {
    latestRequest = ++sequence;
    document.dispatchEvent(new CustomEvent("etix-support:order-search-request", {
      detail: JSON.stringify({id: latestRequest, enabled: active, query: active ? query : ""})
    }));
  }

  function scheduleMount() {
    if (!enabled || scanTimer !== null) return;
    scanTimer = setTimeout(() => { scanTimer = null; mount(); }, 100);
  }

  function mount() {
    if (!enabled) return;
    const count = (document.body.innerText || document.body.textContent).match(/Total Orders\s*:?\s*([\d,]+)/i)?.[1] || null;
    if (control?.isConnected) {
      const grid = document.querySelector(".MuiDataGrid-root");
      if (grid !== currentGrid || count !== currentOrderCount) {
        currentGrid = grid; currentOrderCount = count; attempts = 0; request();
      }
      return;
    }
    const group = Array.from(document.querySelectorAll(".MuiToggleButtonGroup-root")).find((element) => {
      const labels = Array.from(element.querySelectorAll("button")).map((button) => button.textContent.trim().toLowerCase());
      return ["unassigned", "assigned", "all"].every((label) => labels.includes(label));
    });
    if (!group?.parentElement) return;
    removeControl();
    const parent = group.parentElement;
    const layout = {display: "flex", "flex-direction": "row", "align-items": "center", "flex-wrap": "wrap", gap: "8px"};
    parentStyle = {element: parent, properties: Object.entries(layout).map(([property, applied]) => ({
      property, applied, value: parent.style.getPropertyValue(property), priority: parent.style.getPropertyPriority(property)
    }))};
    for (const [property, value] of Object.entries(layout)) parent.style.setProperty(property, value);
    control = document.createElement("div");
    control.className = "etix-order-search";
    control.setAttribute("data-etix-enhancement-owned", "");
    const label = document.createElement("label");
    label.className = "etix-order-search-label";
    label.htmlFor = "etix-unassigned-order-search";
    label.textContent = "Search orders";
    input = document.createElement("input");
    input.id = "etix-unassigned-order-search";
    input.type = "search";
    input.maxLength = 120;
    input.autocomplete = "off";
    input.placeholder = "Order number or partial name";
    input.value = query;
    input.setAttribute("aria-describedby", "etix-unassigned-order-search-status");
    status = document.createElement("span");
    status.id = "etix-unassigned-order-search-status";
    status.className = "etix-order-search-status";
    status.setAttribute("role", "status");
    status.textContent = "Searches all pages in this view.";
    input.addEventListener("input", () => {
      query = input.value.slice(0, 120);
      attempts = 0;
      clearTimeout(debounce);
      clearTimeout(retry);
      status.textContent = query.trim() ? "Searching all pages…" : "Searches all pages in this view.";
      debounce = setTimeout(() => request(), 150);
    });
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") { event.preventDefault(); clearTimeout(debounce); request(); }
      if (event.key === "Escape") {
        event.preventDefault(); input.value = ""; query = ""; clearTimeout(debounce); request();
      }
    });
    control.append(label, input, status);
    group.insertAdjacentElement("afterend", control);
    currentGrid = document.querySelector(".MuiDataGrid-root");
    currentOrderCount = count;
    attempts = 0;
    request();
  }

  function removeControl() {
    control?.remove();
    control = null; input = null; status = null;
    for (const saved of parentStyle?.properties || []) {
      const style = parentStyle.element.style;
      if (style.getPropertyValue(saved.property) !== saved.applied) continue;
      if (saved.value) style.setProperty(saved.property, saved.value, saved.priority);
      else style.removeProperty(saved.property);
    }
    parentStyle = null;
  }

  document.addEventListener("etix-support:order-search-response", (event) => {
    let response;
    try { response = JSON.parse(event.detail); } catch (_error) { return; }
    if (!enabled || response.id !== latestRequest || !status) return;
    clearTimeout(retry);
    if (!response.supported) {
      if (["loading", "unavailable"].includes(response.reason)) {
        // Loading/re-rendering is temporary. Keep recovering even when Etix takes
        // longer than five seconds; back off rather than abandoning the query.
        retry = setTimeout(() => request(), Math.min(250 * 2 ** Math.min(attempts++, 3), 2000));
        status.textContent = response.reason === "loading"
          ? "Waiting for the order list… Search will resume automatically."
          : "Reconnecting to the order list… Search will resume automatically.";
      } else status.textContent = "Search is unavailable for this order list. Your bookings are unchanged.";
      return;
    }
    attempts = 0;
    if (!response.namesReadable) status.textContent = "Order search is ready; customer names could not be read.";
    else status.textContent = query.trim()
      ? `${response.matches} matching order${response.matches === 1 ? "" : "s"} across all pages of this view.`
      : "Searches all pages in this view.";
  });

  // Recheck counts and restore the search when an assignment tab loads a new row set.
  document.addEventListener("click", (event) => {
    const button = event.target.closest?.(".MuiToggleButtonGroup-root button");
    if (enabled && button && ["unassigned", "assigned", "all"].includes(button.textContent.trim().toLowerCase())) {
      clearTimeout(retry);
      attempts = 0;
      retry = setTimeout(() => request(), 350);
    }
  });

  function configure(stored) {
    enabled = EtixCore.mergeSettings(stored).enhancements.searchUnassignedOrders === true;
    observer.disconnect();
    clearTimeout(debounce); clearTimeout(retry); clearTimeout(scanTimer);
    debounce = null; retry = null; scanTimer = null;
    if (!enabled) { request(false); removeControl(); query = ""; return; }
    mount();
    observer.observe(document.documentElement, {childList: true, characterData: true, subtree: true});
  }
  extensionApi.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes["etix.settings"]) configure(changes["etix.settings"].newValue);
  });
  extensionApi.storage.local.get("etix.settings").then((stored) => configure(stored["etix.settings"])).catch(() => {});
})();
