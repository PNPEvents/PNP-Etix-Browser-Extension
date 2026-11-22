(function initialiseFocusedSeatFlash() {
  "use strict";

  const extensionApi = globalThis.browser || globalThis.chrome;
  if (location.hostname !== "boxoffice.etix.com" ||
      !/^\/ticket\/admin\/performanceAdmin\/[^/]+\/unassignedSeat\.spa$/.test(location.pathname)) return;

  const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
  let enabled = false;
  let active = null;
  let sequence = 0;
  let pollTimer = null;
  let stopTimer = null;

  function stop(reason = "idle") {
    clearInterval(pollTimer);
    clearTimeout(stopTimer);
    active?.layer?.remove();
    active?.announcement?.remove();
    active = null;
    pollTimer = null;
    stopTimer = null;
    document.documentElement.setAttribute("data-etix-seat-focus-state", reason);
    if (reason !== "finished") document.documentElement.removeAttribute("data-etix-seat-focus-count");
  }

  function setMotion() {
    if (active?.layer) active.layer.className = `etix-seat-focus-layer${motion.matches ? "" : " etix-seat-focus-pulse"}`;
  }

  function poll() {
    if (!active) return;
    if (!enabled || document.hidden || (!active.layer &&
      (!active.row.isConnected || !active.row.contains(active.link)))) return stop("cancelled");
    if (!active.layer && Date.now() - active.startedAt > 30000) return stop("unavailable");
    active.requestId = ++sequence;
    document.dispatchEvent(new CustomEvent("etix-support:focused-seats-request", {
      detail: JSON.stringify({ id: active.requestId, expectedBooking: active.booking })
    }));
  }

  document.addEventListener("click", (event) => {
    if (!enabled || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    const link = event.target.closest?.('.MuiDataGrid-cell[data-field="seating"] a');
    if (!link) { if (active) stop("cancelled"); return; }
    stop();
    const row = link.closest('[role="row"]');
    const booking = row?.querySelector('[data-field="orderId"] a')?.textContent.trim();
    if (!/^[A-Za-z0-9-]{4,40}$/.test(booking || "")) return;
    active = { row, link, booking, startedAt: Date.now(), requestId: null, layer: null };
    document.documentElement.setAttribute("data-etix-seat-focus-state", "waiting");
    // Let Etix run its own click handler and navigate the map first.
    pollTimer = setInterval(poll, 100);
  }, true);

  document.addEventListener("etix-support:focused-seats-response", (event) => {
    let response;
    try { response = JSON.parse(event.detail); } catch (_error) { return; }
    if (!enabled || !active || response.id !== active.requestId) return;
    if (!response.ready) {
      if (["runtime_loading", "unsupported_modules", "canvas_loading", "booking_loading", "unavailable_interface"].includes(response.reason)) {
        document.documentElement.setAttribute("data-etix-seat-focus-detail", response.reason);
      }
      if (response.differentBooking && active.layer) stop();
      return;
    }
    if (!Array.isArray(response.rectangles) || response.rectangles.length > 2048 ||
        !Number.isFinite(response.width) || !Number.isFinite(response.height) || response.width <= 0 || response.height <= 0) return;
    const rectangles = response.rectangles.filter((rect) =>
      [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) && rect.width > 0 && rect.height > 0 &&
      rect.x + rect.width > 0 && rect.y + rect.height > 0 && rect.x < response.width && rect.y < response.height);
    if (!rectangles.length) return;
    document.documentElement.setAttribute("data-etix-seat-focus-detail", "matched");
    const canvas = document.getElementById("canvas");
    if (!canvas?.isConnected || !canvas.parentElement) return;
    let view = canvas.getBoundingClientRect();
    if (!view.width || !view.height) return;
    if (!active.scrolled) {
      // Bring the train into view before starting the thirty-second highlight.
      // Scroll only once per seating click so polling never fights manual scrolling.
      canvas.scrollIntoView({behavior: "instant", block: "center", inline: "nearest"});
      active.scrolled = true;
      view = canvas.getBoundingClientRect();
    }
    const parentView = canvas.parentElement.getBoundingClientRect();
    if (!view.width || !view.height) return;
    if (active.layer && active.layer.parentElement !== canvas.parentElement) {
      active.layer.remove();
      active.layer = null;
    }
    if (!active.layer) {
      active.layer = document.createElement("div");
      active.layer.setAttribute("data-etix-enhancement-owned", "");
      active.layer.setAttribute("aria-hidden", "true");
      setMotion();
      canvas.parentElement.append(active.layer);
      if (!active.announcement) {
        active.announcement = document.createElement("span");
        active.announcement.className = "etix-seat-focus-announcement";
        active.announcement.setAttribute("data-etix-enhancement-owned", "");
        active.announcement.setAttribute("role", "status");
        active.announcement.textContent = `${rectangles.length} focused seat${rectangles.length === 1 ? "" : "s"} highlighted for up to 30 seconds, or until your next action.`;
        canvas.parentElement.append(active.announcement);
      }
      clearTimeout(stopTimer);
      document.documentElement.setAttribute("data-etix-seat-focus-state", "highlighting");
      document.documentElement.setAttribute("data-etix-seat-focus-count", String(rectangles.length));
      stopTimer = setTimeout(() => stop("finished"), 30000);
    }
    const layer = active.layer;
    layer.style.left = `${view.left - parentView.left}px`;
    layer.style.top = `${view.top - parentView.top}px`;
    layer.style.width = `${view.width}px`;
    layer.style.height = `${view.height}px`;
    layer.replaceChildren();
    const scaleX = view.width / response.width;
    const scaleY = view.height / response.height;
    for (const rect of rectangles) {
      const ring = document.createElement("div");
      ring.className = "etix-seat-focus-ring";
      const padding = Math.max(3, Math.min(8, rect.width * scaleX * 0.2));
      ring.style.left = `${rect.x * scaleX - padding}px`;
      ring.style.top = `${rect.y * scaleY - padding}px`;
      ring.style.width = `${rect.width * scaleX + padding * 2}px`;
      ring.style.height = `${rect.height * scaleY + padding * 2}px`;
      layer.append(ring);
    }
  });

  function configure(stored) {
    enabled = EtixCore.mergeSettings(stored).enhancements.flashFocusedSeats === true;
    if (!enabled) stop();
  }
  motion.addEventListener("change", setMotion);
  // Scrolling to examine the train keeps the highlight; the next click or form
  // interaction ends it. A different seating click starts its own fresh session.
  for (const type of ["input", "change", "submit"]) {
    document.addEventListener(type, () => { if (active) stop("cancelled"); }, true);
  }
  document.addEventListener("keydown", (event) => { if (active && event.key === "Escape") stop("cancelled"); }, true);
  document.addEventListener("visibilitychange", () => { if (document.hidden) stop(); });
  extensionApi.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes["etix.settings"]) configure(changes["etix.settings"].newValue);
  });
  extensionApi.storage.local.get("etix.settings").then((stored) => configure(stored["etix.settings"])).catch(() => {});
})();
