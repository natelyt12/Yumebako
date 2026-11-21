import {
  getEffectStates,
  countCardCustomizations,
  sortCardsByCustomizations,
} from "../../backend/effects/effectStates.js";
import { EFFECT_CATALOG } from "./catalog.js";
import { t } from "/src/core/i18n.js";

export { getEffectStates, countCardCustomizations, sortCardsByCustomizations };

/**
 * Returns a list of customizations currently applied to a wallpaper card that differ from defaults.
 *
 * @param {Object} card
 * @param {boolean} [isActive=false] - Whether this card is the currently active desktop wallpaper
 * @returns {Array<{ id: string, icon: string, label: string }>}
 */
export function getCardCustomizations(card, isActive = false) {
  if (!card) return [];
  // Prefer the card's own effect profile: it is the authoritative and immediate
  // source, and it is already populated for the active card. Reading the global
  // settings first would show the *previous* wallpaper's icons during a switch,
  // until the renderer finishes persisting the new card's effects.
  const effects = card.effects || card.raw?.effects;
  const states = effects
    ? getEffectStates(effects)
    : isActive
      ? getEffectStates()
      : null;

  if (!states) return [];

  // The catalog owns the display order, icon and labels; here we only keep the
  // categories whose state is active.
  return EFFECT_CATALOG.filter((def) => states[def.id]).map((def) => ({
    id: def.id,
    icon: def.icon,
    label: t(def.labelKey, def.label),
  }));
}

// Độ trễ gom thao tác kéo slider (ms) trước khi tự động lưu xuống storage.
const AUTO_SAVE_DEBOUNCE_MS = 200;

/**
 * Coalesce rapid live-preview tweaks (e.g. slider drags) into a single
 * persisted write, while supporting immediate commits and disposal flushes.
 *
 * @param {() => void} persistFn - Callback writing the current panel state.
 * @param {number} [delayMs=AUTO_SAVE_DEBOUNCE_MS]
 * @returns {{ schedule: () => void, flush: () => void, cancel: () => void, now: () => void }}
 */
export function createAutoSaver(persistFn, delayMs = AUTO_SAVE_DEBOUNCE_MS) {
  let timer = null;
  let dirty = false;

  const clear = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  return {
    schedule() {
      dirty = true;
      clear();
      timer = setTimeout(() => {
        timer = null;
        if (!dirty) return;
        dirty = false;
        persistFn();
      }, delayMs);
    },
    flush() {
      clear();
      if (!dirty) return;
      dirty = false;
      persistFn();
    },
    cancel() {
      clear();
      dirty = false;
    },
    now() {
      clear();
      dirty = false;
      persistFn();
    },
  };
}
