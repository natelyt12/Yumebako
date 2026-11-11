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
