import test from "node:test";
import assert from "node:assert/strict";
import {
  extractSeedColorsFromPixels,
  buildM3GlassTokens,
  argbToRgba,
} from "../src/core/materialColor.js";

test("extractSeedColorsFromPixels ranks vibrant dominant hue via Material 3 Score", () => {
  const pixels = [];
  // 80 vibrant cyan-blue pixels, 20 muted gray pixels
  for (let i = 0; i < 80; i++) {
    pixels.push(32, 168, 224, 255);
  }
  for (let i = 0; i < 20; i++) {
    pixels.push(128, 128, 128, 255);
  }

  const result = extractSeedColorsFromPixels(new Uint8ClampedArray(pixels), {
    desired: 3,
  });

  assert.match(result.seed, /^#[0-9a-f]{6}$/i);
  assert.ok(result.colors.length >= 1);
  assert.equal(result.colors[0], result.seed);
  // Extracted seed should stay close to the vibrant cyan-blue input, not neutral gray
  assert.notEqual(result.seed.toLowerCase(), "#808080");
});

test("extractSeedColorsFromPixels skips transparent pixels and falls back safely", () => {
  const transparent = new Uint8ClampedArray([255, 0, 0, 0, 0, 255, 0, 50]);
  const result = extractSeedColorsFromPixels(transparent, {
    fallbackColorARGB: 0xff336699,
  });

  assert.equal(result.seed.toLowerCase(), "#336699");
  assert.equal(result.seedArgb, 0xff336699);
});

test("buildM3GlassTokens produces M3 scheme and rgba glassmorphism tokens", () => {
  const tokens = buildM3GlassTokens("#3b82f6", { isDark: true });

  assert.equal(tokens.isDark, true);
  assert.match(tokens.scheme.primary, /^#[0-9a-f]{6}$/i);
  assert.match(tokens.scheme.surfaceContainer, /^#[0-9a-f]{6}$/i);
  assert.match(tokens.glass.panelBg, /^rgba\(\d+, \d+, \d+, 0\.45\)$/);
  assert.match(tokens.glass.buttonBg, /^rgba\(\d+, \d+, \d+, 0\.12\)$/);
  assert.match(tokens.glass.border, /^rgba\(\d+, \d+, \d+, 0\.22\)$/);
  assert.match(tokens.solid.panelBg, /^#[0-9a-f]{6}$/i);
  assert.match(tokens.solid.buttonBg, /^#[0-9a-f]{6}$/i);
  assert.equal(argbToRgba(0xff102030, 0.5), "rgba(16, 32, 48, 0.5)");
});
