const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const core = require("../shared.js");
const cvd = require("../colourblind-core.js");
const tritanopia = core.COLOUR_BLIND_MODES.find((mode) => mode.id === "tritanopia");

test("colour-blind enhancement starts off, with Tritanopia selected and invalid profiles repaired", () => {
  assert.ok(core.ENHANCEMENTS.some((item) => item.id === "colourBlindMode"));
  assert.equal(core.mergeSettings().enhancements.colourBlindMode, false);
  assert.equal(core.mergeSettings().colourBlindMode, "tritanopia");
  assert.equal(core.mergeSettings({ colourBlindMode: "not-a-mode" }).colourBlindMode, "tritanopia");
  assert.equal(core.mergeSettings({ enhancements: { colourBlindMode: "false" } }).enhancements.colourBlindMode, false);
});

test("colour codes identify the original RGB consistently across modes without collisions", () => {
  const colours = ["#ff9999", "#1d92ab", "#22bbcc", "#cc9933"].map(cvd.parseColour);
  const codes = colours.map((rgb) => cvd.describeColour(rgb, tritanopia).code);
  assert.equal(new Set(codes).size, colours.length);
  for (const mode of core.COLOUR_BLIND_MODES) {
    assert.deepEqual(colours.map((rgb) => cvd.describeColour(rgb, mode).code), codes);
    for (const rgb of colours) {
      const adapted = cvd.describeColour(rgb, mode);
      assert.ok(Math.abs(cvd.luminance(rgb) - cvd.luminance(adapted.colour)) < 0.005);
    }
  }
  assert.deepEqual(cvd.parseColour("rgb(255, 153, 153)"), colours[0]);
  assert.equal(cvd.parseColour("rgba(0,0,0,0)"), null);
});

test("canvas conversion preserves source data, alpha and neutral seat text while adapting solid fills", () => {
  const source = new Uint8ClampedArray(16 * 16 * 4);
  for (let offset = 0; offset < source.length; offset += 4) source.set([255, 153, 153, 255], offset);
  source.set([0, 0, 0, 255], 0);
  source.set([255, 255, 255, 255], 4);
  source.set([55, 90, 220, 70], 8);
  const original = new Uint8ClampedArray(source);
  const result = cvd.transformPixels(source, 16, tritanopia);
  assert.deepEqual(source, original);
  assert.deepEqual(result.pixels.slice(0, 12), source.slice(0, 12));
  assert.notDeepEqual(result.pixels.slice(12), source.slice(12));
  assert.equal(result.colours.get(0xff9999).code, cvd.describeColour([255, 153, 153], tritanopia).code);
});

test("all pattern styles add deterministic non-colour distinctions", () => {
  const signatures = new Set();
  for (let pattern = 0; pattern < 5; pattern++) {
    signatures.add(Array.from({length: 64}, (_, index) => cvd.patternAt(pattern, index % 8, Math.floor(index / 8))).join());
  }
  assert.equal(signatures.size, 5);
});

test("small blue/yellow edges are adapted even when too small for a pattern", () => {
  const source = new Uint8ClampedArray([255,255,0,255, 0,0,255,255]);
  const result = cvd.transformPixels(source, 2, tritanopia);
  assert.notDeepEqual(result.pixels.slice(0,3), source.slice(0,3));
  assert.notDeepEqual(result.pixels.slice(4,7), source.slice(4,7));
  assert.equal(result.colours.size, 0);
});

function enhancementPage(initial = {}, withUpperLayer = false) {
  const created = [];
  let changed;
  let tick;
  let blocked = false;
  const element = (tag = "div") => {
    const attributes = new Map();
    const styles = new Map();
    const listeners = new Map();
    const node = { tag, isConnected: true, className: "", textContent: "", width: 16, height: 16,
      attributes, styles, listeners,
      style: { getPropertyValue: (key) => styles.get(key) || "", setProperty: (key, value) => styles.set(key, value), removeProperty: (key) => styles.delete(key) },
      getAttribute: (key) => attributes.has(key) ? attributes.get(key) : null,
      setAttribute: (key, value) => attributes.set(key, value), removeAttribute: (key) => attributes.delete(key),
      addEventListener: (key, value) => listeners.set(key, value), removeEventListener: (key) => listeners.delete(key),
      closest: () => null, remove() { this.isConnected = false; },
      append(target) { target.isConnected = true; this.child = target; },
      querySelector() { return this.child?.isConnected ? this.child : null; },
      insertAdjacentElement: (_position, target) => { target.isConnected = true; },
      getBoundingClientRect: () => ({ top: 0, left: 0, bottom: 16, width: 16, height: 16 })
    };
    node.getContext = () => ({ clearRect() {}, drawImage(target) { node.drawnSource = target; },
      getImageData() {
        if (blocked) throw new Error("SecurityError: canvas is tainted");
        return { data: new Uint8ClampedArray(node.drawnSource.pixels) };
      },
      putImageData(image) { node.output = new Uint8ClampedArray(image.data); }
    });
    return node;
  };
  const root = element();
  const swatch = element();
  swatch.setAttribute("title", "Native title");
  const source = element("canvas");
  source.parentElement = element();
  source.pixels = new Uint8ClampedArray(16 * 16 * 4);
  for (let i = 0; i < source.pixels.length; i += 4) source.pixels.set([255, 153, 153, 255], i);
  const upper = element("canvas");
  upper.parentElement = source.parentElement;
  upper.pixels = new Uint8ClampedArray(source.pixels.length);
  const doc = {
    documentElement: root, hidden: false, body: { append() {} },
    createElement(tag) { const node = element(tag); created.push(node); return node; },
    querySelectorAll: (selector) => selector.startsWith("canvas.lower-canvas") ? (withUpperLayer ? [source, upper] : [source]) : [swatch]
  };
  const sandbox = {
    EtixCore: core, EtixColourBlind: cvd, document: doc, innerHeight: 1000, innerWidth: 1000,
    getComputedStyle: () => ({backgroundColor: "rgb(255, 153, 153)"}),
    MutationObserver: class { observe() {} disconnect() {} },
    setInterval(callback) { tick = callback; return 1; }, clearInterval() {},
    setTimeout, clearTimeout,
    chrome: { storage: {
      local: { get: async () => ({"etix.settings": initial}) },
      onChanged: { addListener(callback) { changed = callback; } }
    } }
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../enhancements.js"), "utf8"), sandbox);
  return {
    root, swatch, source, upper, created,
    configure(settings) { changed({"etix.settings": {newValue: settings}}, "local"); },
    tick: () => tick(), blockCanvas: (value) => { blocked = value; }
  };
}
const enabled = {enhancements: {colourBlindMode: true}};

test("enabling, switching profile and disabling restores the map, swatches and native title", async () => {
  const page = enhancementPage();
  await new Promise(setImmediate);
  assert.equal(page.root.getAttribute("data-etix-cvd"), null);
  assert.equal(page.created.length, 0);
  const original = new Uint8ClampedArray(page.source.pixels);
  page.configure(enabled);
  assert.equal(page.root.getAttribute("data-etix-cvd"), "tritanopia");
  assert.equal(page.source.getAttribute("data-etix-cvd-source"), "");
  assert.equal(page.created.find((node) => node.className === "etix-cvd-map-note").hidden, true);
  assert.equal(page.swatch.getAttribute("data-etix-cvd-code"), cvd.describeColour([255,153,153], tritanopia).code);
  const copy = page.created.find((node) => node.className === "etix-cvd-map-copy");
  assert.ok(copy.output);
  assert.notDeepEqual(copy.output, original);
  page.configure({...enabled, colourBlindMode: "protanopia"});
  assert.equal(page.root.getAttribute("data-etix-cvd"), "protanopia");
  assert.deepEqual(page.source.pixels, original);
  page.configure({enhancements: {colourBlindMode: false}});
  assert.equal(page.source.getAttribute("data-etix-cvd-source"), null);
  assert.equal(page.root.getAttribute("data-etix-cvd"), null);
  assert.equal(page.swatch.getAttribute("title"), "Native title");
  assert.equal(page.swatch.styles.size, 0);
  assert.equal(copy.isConnected, false);
  assert.equal(page.source.parentElement.listeners.size, 0);
});

test("the display copy follows native canvas updates without writing back to Etix", async () => {
  const page = enhancementPage(enabled);
  await new Promise(setImmediate);
  page.source.pixels.set([0, 0, 0, 255], 0);
  page.tick();
  const copy = page.created.find((node) => node.className === "etix-cvd-map-copy");
  assert.deepEqual(Array.from(copy.output.slice(0,4)), [0,0,0,255]);
  assert.deepEqual(Array.from(page.source.pixels.slice(4,8)), [255,153,153,255]);
});

test("unreadable canvases retain their original map and can recover after a profile update", async () => {
  const page = enhancementPage();
  await new Promise(setImmediate);
  page.blockCanvas(true);
  page.configure(enabled);
  assert.equal(page.source.getAttribute("data-etix-cvd-source"), null);
  const note = page.created.find((node) => node.className === "etix-cvd-map-note");
  assert.match(note.textContent, /original colours remain visible/);
  assert.equal(note.hidden, false);
  page.blockCanvas(false);
  page.configure({...enabled, colourBlindMode: "deuteranopia"});
  assert.equal(page.source.getAttribute("data-etix-cvd-source"), "");
  assert.equal(page.created.find((node) => node.className === "etix-cvd-map-copy").isConnected, true);
});

test("both canvas layers adapt, with one caption and colour hovers through a transparent upper layer", async () => {
  const page = enhancementPage(enabled, true);
  await new Promise(setImmediate);
  assert.equal(page.created.filter((node) => node.className === "etix-cvd-map-copy").length, 2);
  assert.equal(page.created.filter((node) => node.className === "etix-cvd-map-note").length, 1);
  assert.equal(page.upper.getAttribute("data-etix-cvd-source"), "");
  page.source.parentElement.listeners.get("pointermove")({clientX: 1, clientY: 1});
  const tooltip = page.created.find((node) => node.className === "etix-cvd-map-tooltip");
  assert.match(tooltip.textContent, new RegExp(cvd.describeColour([255,153,153], tritanopia).code));
  page.configure({enhancements: {colourBlindMode: false}});
  assert.equal(page.upper.getAttribute("data-etix-cvd-source"), null);
  assert.equal(tooltip.isConnected, false);
});
