import "./shared.css";
import { createFiltersPanel } from "./panels/filters/index.js";
import { createParticlesPanel } from "./panels/particles/index.js";
import { createOnloadPanel } from "./panels/onload/index.js";
import { createWavyPanel } from "./panels/wavy/index.js";

export { openPositionEditorPopup } from "./panels/arrange/index.js";

// The effect catalog is the single source of truth for ids/icons/labels used by
// the top-bar chips, the Customize tabs and every icon list in the switcher.
export {
  EFFECT_CATALOG,
  EFFECT_IDS,
  EFFECT_SETTING_KEYS,
  CUSTOMIZE_TABS,
} from "./catalog.js";

const PANEL_FACTORIES = {
  filters: createFiltersPanel,
  particles: createParticlesPanel,
  onload: createOnloadPanel,
  wavy: createWavyPanel,
};

export function hasCustomizePanel(id) {
  return Boolean(PANEL_FACTORIES[id]);
}

/**
 * @param {string} id - Panel id from `CUSTOMIZE_TABS`.
 * @param {{ isVideo?: boolean }} [context] - Media facts the panel needs to
 *   offer only the controls that make sense for the wallpaper being edited.
 */
export function createCustomizePanel(id, context = {}) {
  return PANEL_FACTORIES[id]?.(context) || null;
}
