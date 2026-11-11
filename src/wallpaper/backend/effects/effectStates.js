import {
  getSettings,
  getDefaultWallpaperEffects,
} from "/src/core/storageHandler.js";

const FILTER_KEYS = ["brightness", "contrast", "saturate", "bloom", "blur"];
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
  return particles.dynamicEnabled === true || particles.staticEnabled === true;
}

function onloadAdded(settings, defaults) {
  return differs(settings.onload || {}, defaults.onload, ONLOAD_KEYS);
}

function wavyAdded(settings) {
  const wavy = settings.wavy || {};
  return wavy.enabled === true || wavy.parallaxEnabled === true;
}

function arrangeAdded(settings, defaults) {
  const position = settings.wallpaperPosition || {};
  return differs(position, defaults.position, ["x", "y", "zoom", "mode"]);
}

function effectStatesFor(settings, defaults) {
  return {
    arrange: arrangeAdded(settings, defaults),
    filters: filtersAdded(settings, defaults),
    particles: particlesAdded(settings),
    onload: onloadAdded(settings, defaults),
    wavy: wavyAdded(settings),
  };
}

// The default profile is immutable and only read for comparisons, so build it
// once instead of allocating a fresh deep object on every state check (this
// runs once per card while sorting the collection/grid).
let comparisonDefaults = null;
function getComparisonDefaults() {
  return (comparisonDefaults ??= getDefaultWallpaperEffects());
}

/** The five effect categories, in the same order as the UI catalog. */
const STATE_KEYS = ["arrange", "filters", "particles", "onload", "wavy"];

/** Build the state object for one card-specific effects profile. */
function computeEffectStates(effects) {
  const defaults = getComparisonDefaults();
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

/**
 * Per-effects state cache.
 *
 * A card's `effects` object is a stable identity for as long as it is not
 * replaced, so a WeakMap keyed by it turns the O(n) recompute into a single
 * computation per card. Replacing `card.effects` with a new object invalidates
 * automatically (the old key becomes unreachable); in-place mutations must call
 * `invalidateEffectStates(effects)` (DataControl does this).
 *
 * @type {WeakMap<object, ReturnType<typeof effectStatesFor>>}
 */
const effectsStateCache = new WeakMap();

/**
 * Drop the cached state for an effects profile after it was mutated in place.
 *
 * @param {object|null|undefined} effects
 */
export function invalidateEffectStates(effects) {
  if (effects && typeof effects === "object") effectsStateCache.delete(effects);
}

/**
 * Returns which effect categories currently hold a non-default configuration.
 *
 * @param {Object|null} [effects=null] Card-specific effects object. If null, checks active desktop settings.
 * @returns {{ arrange: boolean, filters: boolean, particles: boolean, onload: boolean, wavy: boolean }}
 */
export function getEffectStates(effects = null) {
  if (!effects || typeof effects !== "object") {
    return effectStatesFor(getSettings(), getComparisonDefaults());
  }

  const cached = effectsStateCache.get(effects);
  if (cached) return cached;

  const states = Object.freeze(computeEffectStates(effects));
  effectsStateCache.set(effects, states);
  return states;
}

/**
 * Counts how many effect categories on a card differ from defaults.
 *
 * @param {Object} card
 * @param {boolean} [isActive=false]
 * @returns {number}
 */
export function countCardCustomizations(card, isActive = false) {
  if (!card) return 0;

  // Prefer the card's own profile (it is the authoritative, cached source);
  // fall back to live settings only when the card carries no profile.
  const effects = card.effects || card.raw?.effects;
  const states = effects
    ? getEffectStates(effects)
    : isActive
      ? getEffectStates()
      : null;

  if (!states) return 0;
  let count = 0;
  for (const key of STATE_KEYS) {
    if (states[key]) count++;
  }
  return count;
}

/**
 * Sắp xếp danh sách hình nền: ưu tiên hình nền có nhiều tùy chỉnh nhất lên đầu.
 * Sắp xếp ổn định (stable sort): giữ nguyên thứ tự tương đối ban đầu nếu cùng số lượng tùy chỉnh.
 *
 * @param {Array<Object>} cards
 * @param {string|number|null} [activeId=null]
 * @returns {Array<Object>}
 */
export function sortCardsByCustomizations(cards, activeId = null) {
  if (!Array.isArray(cards) || cards.length <= 1) return cards || [];

  const countMap = new Map();
  for (const card of cards) {
    const isActive = activeId != null && String(card?.id) === String(activeId);
    countMap.set(card, countCardCustomizations(card, isActive));
  }

  const hasAnyCustoms = Array.from(countMap.values()).some((c) => c > 0);
  if (!hasAnyCustoms) return [...cards];

  return [...cards].sort((a, b) => {
    const countA = countMap.get(a) || 0;
    const countB = countMap.get(b) || 0;
    return countB - countA;
  });
}
