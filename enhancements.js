(function initialiseEtixEnhancements() {
  "use strict";

  const extensionApi = globalThis.browser || globalThis.chrome;

  const root = document.documentElement;
  const swatches = new Map();
  const maps = new Map();
  let mode = null;
  let timer = null;
  let pending = null;
  let knownColours = [];
  let tooltip = null;
  const observer = new MutationObserver((changes) => {
    if (changes.some((change) => !change.target.closest?.("[data-etix-enhancement-owned]"))) scheduleScan();
  });

  function scheduleScan() {
    if (!mode || pending !== null) return;
    pending = setTimeout(() => { pending = null; scan(); }, 100);
  }

  function setStyle(element, property, value) {
    if (element.style.getPropertyValue(property) !== value) element.style.setProperty(property, value);
  }

  function restoreSwatch(element, saved) {
    element.removeAttribute("data-etix-cvd-swatch");
    element.removeAttribute("data-etix-cvd-code");
    element.style.removeProperty("--etix-cvd-swatch-colour");
    element.style.removeProperty("--etix-cvd-swatch-pattern");
    if (element.getAttribute("title") === saved.addedTitle) {
      if (saved.title === null) element.removeAttribute("title");
      else element.setAttribute("title", saved.title);
    }
  }

  function scan() {
    if (!mode) return;
    knownColours = [];
    for (const [element, saved] of swatches) {
      if (!element.isConnected) { restoreSwatch(element, saved); swatches.delete(element); }
    }
    // Observed Etix MUI booking-colour cells, plus native seat and legend swatches.
    const candidates = document.querySelectorAll(
      '.MuiDataGrid-cell[data-field="color"] .MuiAvatar-root, .circleSeat, #statusColor [style*="background"]'
    );
    for (const element of candidates) {
      // Read Etix's current colour, including when React recycles a row for another booking.
      element.removeAttribute("data-etix-cvd-swatch");
      const rgb = EtixColourBlind.parseColour(getComputedStyle(element).backgroundColor);
      if (!rgb) {
        const saved = swatches.get(element);
        if (saved) restoreSwatch(element, saved);
        swatches.delete(element);
        continue;
      }
      knownColours.push(rgb);
      const description = EtixColourBlind.describeColour(rgb, mode);
      const saved = swatches.get(element) || { title: element.getAttribute("title") };
      saved.addedTitle = `Colour group ${description.code}; original ${description.original}`;
      swatches.set(element, saved);
      setStyle(element, "--etix-cvd-swatch-colour", `rgb(${description.colour.join(",")})`);
      setStyle(element, "--etix-cvd-swatch-pattern", EtixColourBlind.cssPattern(description));
      element.setAttribute("data-etix-cvd-code", description.code);
      element.setAttribute("data-etix-cvd-swatch", "");
      element.setAttribute("title", saved.addedTitle);
    }
    for (const [canvas, state] of maps) {
      if (!canvas.isConnected) { removeMap(canvas, state); maps.delete(canvas); }
    }
    for (const canvas of document.querySelectorAll("canvas.lower-canvas, canvas.upper-canvas")) {
      if (!maps.has(canvas)) addMap(canvas);
    }
    paintMaps();
  }

  function addMap(canvas) {
    const copy = document.createElement("canvas");
    copy.className = "etix-cvd-map-copy";
    copy.setAttribute("data-etix-enhancement-owned", "");
    copy.setAttribute("aria-hidden", "true");
    let note = canvas.parentElement.querySelector(".etix-cvd-map-note");
    const ownsNote = !note;
    if (!note) {
      note = document.createElement("div");
      note.className = "etix-cvd-map-note";
      note.hidden = true;
      note.setAttribute("data-etix-enhancement-owned", "");
      note.style.setProperty("z-index", "2147483645", "important");
      note.style.setProperty("background", "#fff", "important");
      canvas.parentElement.append(note);
    }
    canvas.insertAdjacentElement("afterend", copy);
    const scratch = document.createElement("canvas");
    const state = { copy, note, ownsNote, scratch, context: scratch.getContext("2d", { willReadFrequently: true }),
      pixels: null, colours: new Map(), failed: false, hoverTarget: canvas.parentElement };
    state.move = (event) => showColourAt(event, canvas, state);
    state.leave = hideTooltip;
    if (ownsNote) {
      state.hoverTarget.addEventListener("pointermove", state.move, { passive: true });
      state.hoverTarget.addEventListener("pointerleave", state.leave, { passive: true });
    }
    maps.set(canvas, state);
  }

  function removeMap(canvas, state) {
    canvas.removeAttribute("data-etix-cvd-source");
    state.copy.remove();
    if (state.ownsNote) state.note.remove();
    state.hoverTarget.removeEventListener("pointermove", state.move);
    state.hoverTarget.removeEventListener("pointerleave", state.leave);
  }

  function paintMaps() {
    if (!mode || document.hidden) return;
    for (const [canvas, state] of maps) {
      if (state.failed || !canvas.isConnected || !canvas.width || !canvas.height) continue;
      const rect = canvas.getBoundingClientRect();
      if (!rect.width || !rect.height || rect.bottom < 0 || rect.top > innerHeight) continue;
      try {
        if (canvas.width * canvas.height > 4000000) throw new Error("map too large");
        if (state.scratch.width !== canvas.width || state.scratch.height !== canvas.height) {
          state.scratch.width = canvas.width;
          state.scratch.height = canvas.height;
        }
        // Read into our own surface; never write to Etix's canvas or its drawing context.
        state.context.clearRect(0, 0, canvas.width, canvas.height);
        state.context.drawImage(canvas, 0, 0);
        const image = state.context.getImageData(0, 0, canvas.width, canvas.height);
        let changed = state.mode !== mode.id || !state.pixels || state.pixels.length !== image.data.length;
        if (!changed) {
          const before = new Uint32Array(state.pixels.buffer);
          const after = new Uint32Array(image.data.buffer);
          for (let i = 0; i < after.length; i++) { if (before[i] !== after[i]) { changed = true; break; } }
        }
        for (const property of ["left", "top", "width", "height", "transform", "transform-origin"]) {
          setStyle(state.copy, property, canvas.style.getPropertyValue(property));
        }
        if (!changed) continue;
        const result = EtixColourBlind.transformPixels(image.data, canvas.width, mode, knownColours);
        state.pixels = new Uint8ClampedArray(image.data);
        state.colours = result.colours;
        state.mode = mode.id;
        image.data.set(result.pixels);
        state.copy.width = canvas.width;
        state.copy.height = canvas.height;
        state.copy.getContext("2d").putImageData(image, 0, 0);
        if (!state.copy.isConnected) canvas.insertAdjacentElement("afterend", state.copy);
        // Hide the source only after a readable, adapted copy is ready.
        canvas.setAttribute("data-etix-cvd-source", "");
      } catch (_error) {
        state.failed = true;
        canvas.removeAttribute("data-etix-cvd-source");
        state.copy.remove();
        state.note.textContent = "Colour-blind mode: this map cannot be adapted safely in this browser. Its original colours remain visible; use the seating labels and booking details.";
      }
    }
    for (const state of maps.values()) {
      if (state.ownsNote) state.note.hidden = !Array.from(maps.values()).some((layer) =>
        layer.hoverTarget === state.hoverTarget && layer.failed);
    }
  }

  function hideTooltip() { if (tooltip) tooltip.hidden = true; }

  function showColourAt(event, canvas, state) {
    let colour = null;
    // The transparent interaction layer must not hide a group on the lower layer.
    const layers = Array.from(maps).filter(([, layer]) => layer.hoverTarget === state.hoverTarget).reverse();
    for (const [source, layer] of layers) {
      if (!layer.pixels || layer.failed) continue;
      const rect = source.getBoundingClientRect();
      const x = Math.floor((event.clientX - rect.left) * source.width / rect.width);
      const y = Math.floor((event.clientY - rect.top) * source.height / rect.height);
      if (x < 0 || y < 0 || x >= source.width || y >= source.height) continue;
      const offset = (y * source.width + x) * 4;
      if (layer.pixels[offset + 3] < 250) continue;
      const key = (layer.pixels[offset] << 16) | (layer.pixels[offset + 1] << 8) | layer.pixels[offset + 2];
      colour = layer.colours.get(key);
      if (colour) break;
    }
    if (!colour) return hideTooltip();
    if (!tooltip) {
      tooltip = document.createElement("div");
      tooltip.className = "etix-cvd-map-tooltip";
      tooltip.setAttribute("data-etix-enhancement-owned", "");
      tooltip.setAttribute("role", "status");
      document.body.append(tooltip);
    }
    tooltip.hidden = false;
    tooltip.textContent = `Colour group ${colour.code} · original ${colour.original}`;
    tooltip.style.left = `${Math.max(4, Math.min(event.clientX + 16, innerWidth - 280))}px`;
    tooltip.style.top = `${Math.max(4, Math.min(event.clientY + 20, innerHeight - 60))}px`;
  }

  function configure(stored) {
    const settings = EtixCore.mergeSettings(stored);
    const nextMode = settings.enhancements.colourBlindMode
      ? EtixCore.COLOUR_BLIND_MODES.find((profile) => profile.id === settings.colourBlindMode) : null;
    observer.disconnect();
    clearInterval(timer);
    clearTimeout(pending);
    timer = null;
    pending = null;
    mode = nextMode;
    if (!mode) {
      root.removeAttribute("data-etix-cvd");
      for (const [element, saved] of swatches) restoreSwatch(element, saved);
      swatches.clear();
      for (const [canvas, state] of maps) removeMap(canvas, state);
      maps.clear();
      tooltip?.remove();
      tooltip = null;
      return;
    }
    root.setAttribute("data-etix-cvd", mode.id);
    for (const state of maps.values()) { state.mode = null; state.failed = false; }
    scan();
    observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "style", "width", "height"] });
    timer = setInterval(paintMaps, 250);
  }

  extensionApi.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes["etix.settings"]) configure(changes["etix.settings"].newValue);
  });
  extensionApi.storage.local.get("etix.settings").then((stored) => configure(stored["etix.settings"])).catch(() => {});
})();
