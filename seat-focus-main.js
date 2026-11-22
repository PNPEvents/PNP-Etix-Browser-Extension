(function initialiseFocusedSeatReader() {
  "use strict";
  if (location.hostname !== "boxoffice.etix.com" ||
      !/^\/ticket\/admin\/performanceAdmin\/[^/]+\/unassignedSeat\.spa$/.test(location.pathname)) return;

  let webpackRequire = null;

  function readFocusedSeats(expectedBooking) {
    if (!webpackRequire) {
      const chunks = window.webpackChunketix;
      if (!chunks || typeof chunks.push !== "function") return { ready: false, reason: "runtime_loading" };
      // Capture Etix's existing loader; no modules, application data or requests are replaced.
      chunks.push([["etix-support-focused-seat-reader-v1"], {}, (require) => { webpackRequire = require; }]);
    }
    if (!webpackRequire?.m?.[81161] || !webpackRequire.m[81904]) return { ready: false, reason: "unsupported_modules" };
    // Calibrated Etix modules: current canvas getter and its native focused-booking predicate.
    const canvas = webpackRequire(81161).dX?.();
    const isFocused = webpackRequire(81904).jA;
    if (!canvas || typeof isFocused !== "function" || typeof canvas.getObjects !== "function" ||
        canvas.lowerCanvasEl !== document.getElementById("canvas")) return { ready: false, reason: "canvas_loading" };
    if (String(canvas.highlightOrderId || "") !== expectedBooking) return { ready: false, differentBooking: true, reason: "booking_loading" };
    const width = canvas.getWidth();
    const height = canvas.getHeight();
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return { ready: false };
    const rectangles = [];
    const visit = (objects, depth = 0) => {
      if (depth > 4) return;
      for (const object of objects) {
        if (rectangles.length >= 2048) return;
        if (typeof object.drawAssignedSeatsBgShape === "function" && typeof object.getBoundingRect === "function" && isFocused(object)) {
          const rect = object.getBoundingRect(false, true);
          if ([rect.left, rect.top, rect.width, rect.height].every(Number.isFinite) &&
              rect.width > 0 && rect.height > 0 && rect.left + rect.width > 0 && rect.top + rect.height > 0 &&
              rect.left < width && rect.top < height) {
            rectangles.push({ x: rect.left, y: rect.top, width: rect.width, height: rect.height });
          }
        } else if (typeof object.getObjects === "function") visit(object.getObjects(), depth + 1);
      }
    };
    visit(canvas.getObjects());
    // Only screen geometry crosses to the isolated content script, not customer or seat records.
    return { ready: true, width, height, rectangles };
  }

  document.addEventListener("etix-support:focused-seats-request", (event) => {
    let request;
    try { request = JSON.parse(event.detail); } catch (_error) { return; }
    if (!Number.isSafeInteger(request?.id) || !/^[A-Za-z0-9-]{4,40}$/.test(request.expectedBooking || "")) return;
    let result;
    try { result = readFocusedSeats(request.expectedBooking); } catch (_error) { result = { ready: false, reason: "unavailable_interface" }; }
    document.dispatchEvent(new CustomEvent("etix-support:focused-seats-response", {
      detail: JSON.stringify({ id: request.id, ...result })
    }));
  });
})();
