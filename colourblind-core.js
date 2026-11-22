(function initialiseColourBlindCore(scope) {
  "use strict";

  const linear = Array.from({ length: 256 }, (_, channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  const luminance = (rgb) => 0.2126 * linear[rgb[0]] + 0.7152 * linear[rgb[1]] + 0.0722 * linear[rgb[2]];
  const encode = (value) => Math.round(255 * (value <= 0.0031308 ? 12.92 * value : 1.055 * value ** (1 / 2.4) - 0.055));
  const packed = (rgb) => (rgb[0] << 16) | (rgb[1] << 8) | rgb[2];
  const unpack = (value) => [value >> 16 & 255, value >> 8 & 255, value & 255];

  function parseColour(value) {
    const text = String(value || "").trim();
    const hex = text.match(/^#([\da-f]{6}|[\da-f]{3})$/i);
    if (hex) {
      const full = hex[1].length === 3 ? hex[1].split("").map((c) => c + c).join("") : hex[1];
      return unpack(parseInt(full, 16));
    }
    const rgb = text.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)$/i);
    return rgb && rgb.slice(1, 4).every((v) => Number(v) <= 255) && (rgb[4] === undefined || Number(rgb[4]) === 1)
      ? rgb.slice(1, 4).map(Number) : null;
  }

  function describeColour(rgb, mode) {
    const key = packed(rgb);
    const hash = Math.imul(key ^ (key >>> 9), 0x45d9f3b) >>> 0;
    const high = Math.max(...rgb);
    const range = high - Math.min(...rgb);
    let hue = range === 0 ? 0 : high === rgb[0] ? (rgb[1] - rgb[2]) / range
      : high === rgb[1] ? (rgb[2] - rgb[0]) / range + 2 : (rgb[0] - rgb[1]) / range + 4;
    hue = (hue * 60 + 360) % 360;
    const slot = Math.floor((hue + 30) / 60) % 6;
    const base = parseColour(mode.colours[mode.hueSlots ? mode.hueSlots[slot] : 0]);
    const target = luminance(rgb);
    const current = luminance(base);
    // Preserve lightness so existing black/white seat numbers keep their contrast.
    const colour = base.map((channel) => encode(target < current
      ? linear[channel] * target / current
      : linear[channel] + (1 - linear[channel]) * (target - current) / (1 - current)));
    return {
      key,
      code: `C${key.toString(36).padStart(5, "0").toUpperCase()}`,
      original: `#${key.toString(16).padStart(6, "0").toUpperCase()}`,
      colour,
      pattern: (hash >>> 8) % 5,
      ink: target > 0.35 ? [0, 0, 0] : [255, 255, 255]
    };
  }

  function patternAt(pattern, x, y) {
    if (pattern === 0) return false;
    if (pattern === 1) return (x + y) % 8 < 2;
    if (pattern === 2) return y % 8 < 2;
    if (pattern === 3) return x % 8 < 2 && y % 8 < 2;
    return x % 8 < 1 || y % 8 < 1;
  }

  function cssPattern(description) {
    const ink = `rgba(${description.ink.join(",")},0.22)`;
    return ["none", `repeating-linear-gradient(135deg,${ink} 0 2px,transparent 2px 8px)`,
      `repeating-linear-gradient(0deg,${ink} 0 2px,transparent 2px 8px)`,
      `radial-gradient(${ink} 1.5px,transparent 1.5px)`,
      `linear-gradient(${ink} 1px,transparent 1px),linear-gradient(90deg,${ink} 1px,transparent 1px)`][description.pattern];
  }

  function transformPixels(source, width, mode, knownColours = []) {
    const counts = new Map();
    for (let i = 0; i < source.length; i += 4) {
      if (source[i + 3] < 250) continue;
      const high = Math.max(source[i], source[i + 1], source[i + 2]);
      const low = Math.min(source[i], source[i + 1], source[i + 2]);
      if (high - low < 30) continue;
      const key = (source[i] << 16) | (source[i + 1] << 8) | source[i + 2];
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    // Solid fills get a pattern and a hover code. Small colour edges get the same
    // hue family without a pattern, avoiding speckles around seat numbers.
    const colours = new Map();
    for (const rgb of knownColours) colours.set(packed(rgb), describeColour(rgb, mode));
    for (const [key, count] of counts) {
      if (count >= 32) colours.set(key, describeColour(unpack(key), mode));
    }
    const output = new Uint8ClampedArray(source);
    const edges = new Map();
    for (let i = 0; i < source.length; i += 4) {
      const key = (source[i] << 16) | (source[i + 1] << 8) | source[i + 2];
      let description = colours.get(key);
      if (source[i + 3] < 250) continue;
      if (!description) {
        const high = Math.max(source[i], source[i + 1], source[i + 2]);
        const low = Math.min(source[i], source[i + 1], source[i + 2]);
        if (high - low < 30) continue;
        description = edges.get(key);
        if (!description) {
          description = describeColour(unpack(key), mode);
          edges.set(key, description);
        }
      }
      const pixel = i / 4;
      const patterned = colours.has(key) && patternAt(description.pattern, pixel % width, Math.floor(pixel / width));
      for (let channel = 0; channel < 3; channel++) {
        output[i + channel] = patterned
          ? Math.round(description.colour[channel] * 0.78 + description.ink[channel] * 0.22)
          : description.colour[channel];
      }
    }
    return { pixels: output, colours };
  }

  const api = { parseColour, describeColour, patternAt, cssPattern, transformPixels, luminance };
  scope.EtixColourBlind = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(globalThis);
