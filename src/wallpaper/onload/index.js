import { OnloadEngine } from "./OnloadEngine.js";
import { OnloadEditorUI } from "./OnloadEditorUI.js";

/**
 * Public entry point for the startup-animation feature.
 *
 * Mirrors `src/wallpaper/particles/index.js` and `src/wallpaper/motion/index.js`:
 * the folder owns the implementation and this barrel is the only thing the rest
 * of the app imports.
 *
 *   onload/
 *     OnloadEngine.js    runtime: DOM refs, timing, play/reset cycle
 *     OnloadEditorUI.js  settings panel + live preview
 *     presets.js         overlay-mode registry + every preset + id → class registry
 *     easing.js          id -> CSS easing token
 */
export { OnloadEngine, resolvePlayConfig, resolvePresetConfig } from "./OnloadEngine.js";
export { OnloadEditorUI } from "./OnloadEditorUI.js";

export {
    BasePreset,
    DefaultPreset,
    ZoomInLightPreset,
    ZoomInHeavyPreset,
    SleepyPreset,
    NaturePreset,
    CustomPreset,
    PRESET_REGISTRY,
    PRESET_ORDER,
    CUSTOM_PRESET,
    DEFAULT_PRESET,
    isCustomPreset,
    resolvePresetClass,
} from "./presets.js";
export {
    EASING_REGISTRY,
    EASING_ORDER,
    DEFAULT_BG_EASING,
    OVERLAY_FADE_EASING,
    normalizeEasingId,
    resolveEasing,
} from "./easing.js";

const engine = new OnloadEngine();
const editor = new OnloadEditorUI(engine);

/** The live engine instance (mirrors `getWavyController()`). */
export function getOnloadEngine() {
    return engine;
}

/** Play the saved startup animation (called once the wallpaper is painted). */
export function applyOnloadAnimation() {
    engine.apply();
}

/** Attach the settings-panel trigger button. */
export function initializeOnloadSettings() {
    editor.initialize();
}
