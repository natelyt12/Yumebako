import {
  getSettings,
  getDefaultWallpaperEffects,
} from "/src/core/storageHandler.js";

/**
 * Shared state helpers for the Customize panels.
 *
 * - `getEffectStates()` tells which Customize tab currently has a non-default
 *   effect configuration, so the tab list can show a static indicator dot.
 * - `createSaveState()` tracks the value snapshot from the last save and keeps
 *   the panel's Save button disabled while the current values still match it.
 */

const FILTER_KEYS = ["brightness", "contrast", "saturate", "bloom", "blur"];

// `advanced` is a view preference (the section is always visible now) and
// `enabled` is not used by the onload engine, so neither marks the tab.
const ONLOAD_KEYS = [
  "preset",
  "zoom",
  "rotate",
  "blur",
  "speed",
  "overlay_speed",
  "bg_easing",
  "widget_immediate",
];

// `motions`, `scale`, `motionType`… are irrelevant for the dot: a Wavy tab only
// counts as "added" when one of its two master switches is on.

function sameValue(a, b) {
  if (typeof a === "number" || typeof b === "number") {
    const na = Number(a);
    const nb = Number(b);
    if (!Number.isFinite(na) && !Number.isFinite(nb)) return true;
    return na === nb;
  }
  if (a && b && typeof a === "object") {
    return JSON.stringify(a) === JSON.stringify(b);
  }
  return a === b;
}

function differs(source = {}, defaults = {}, keys) {
  return keys.some((key) => !sameValue(source[key], defaults[key]));
}

function filtersAdded(settings, defaults) {
  return differs(settings.wallpaperConfig || {}, defaults.filter, FILTER_KEYS);
}

function particlesAdded(settings) {
  const particles = settings.particles || {};
  // Only the two master switches matter; individual effects are irrelevant.
  return particles.dynamicEnabled === true || particles.staticEnabled === true;
}

function onloadAdded(settings, defaults) {
  return differs(settings.onload || {}, defaults.onload, ONLOAD_KEYS);
}

function wavyAdded(settings) {
  const wavy = settings.wavy || {};
  // Same rule as particles: only the Wavy / Parallax switches count.
  return wavy.enabled === true || wavy.parallaxEnabled === true;
}

function arrangeAdded(settings, defaults) {
  const position = settings.wallpaperPosition || {};
  return differs(position, defaults.position, ["x", "y", "zoom", "mode"]);
}

/** Which Customize tabs currently hold a non-default ("added") effect. */
export function getEffectStates(effects = null) {
  const defaults = getDefaultWallpaperEffects();

  // Card-level effects (`card.effects`) are what the renderer is *about to*
  // write into the settings, but that write only happens once the new image has
  // decoded. Reading the card directly lets the UI paint the right icons on the
  // same frame the card settles, instead of flashing the previous set.
  if (effects) {
    return effectStatesFor(
      {
        wallpaperConfig: { ...defaults.filter, ...(effects.filter || {}) },
        wallpaperPosition: { ...defaults.position, ...(effects.position || {}) },
        wavy: { ...defaults.wavy, ...(effects.wavy || {}) },
        particles: effects.particles || {},
        onload: { ...defaults.onload, ...(effects.onload || {}) },
      },
      defaults,
    );
  }

  return effectStatesFor(getSettings(), defaults);
}

/** @param {Object} settings @param {Object} defaults */
function effectStatesFor(settings, defaults) {
  return {
    arrange: arrangeAdded(settings, defaults),
    filters: filtersAdded(settings, defaults),
    particles: particlesAdded(settings),
    onload: onloadAdded(settings, defaults),
    wavy: wavyAdded(settings),
  };
}

/** Structural comparison used for save snapshots. */
export function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || !a || !b) {
    return Number.isNaN(a) && Number.isNaN(b);
  }
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    if (a.length !== b.length) return false;
    return a.every((value, index) => deepEqual(value, b[index]));
  }

  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  return keysA.every(
    (key) =>
      Object.prototype.hasOwnProperty.call(b, key) && deepEqual(a[key], b[key]),
  );
}

const cloneSnapshot = (value) => JSON.parse(JSON.stringify(value));

/**
 * Keep a Save button disabled while `value` equals the last saved snapshot.
 *
 * @param {HTMLButtonElement} saveButton
 */
export function createSaveState(saveButton) {
  let saved = null;

  return {
    /** Record the value that was just persisted. */
    markSaved(value) {
      saved = cloneSnapshot(value);
      if (saveButton) saveButton.disabled = true;
    },
    /** Compare a live value against the last saved snapshot. */
    sync(value) {
      const changed = saved === null || !deepEqual(value, saved);
      if (saveButton) saveButton.disabled = !changed;
      return changed;
    },
  };
}
