import { t } from "/src/core/i18n.js";
import { DEFAULT_BG_EASING } from "./easing.js";

/**
 * presets.js
 * ---------------------------------------------------------------------------
 * Every startup-animation preset lives in this single file, together with the
 * shared abstract base and the id → preset registry.
 *
 * A preset owns *every* advanced setting — the wallpaper transform and its
 * easing curve. Picking a preset in the panel therefore snaps the whole panel at
 * once, and any manual tweak afterwards switches the selection to `custom` so
 * the deviation is never lost on reload.
 *
 * Presets are pure data: a `DEFAULTS` bag plus a localized label, so adding one
 * is a one-file change — append a class below and register it in
 * `PRESET_REGISTRY` / `PRESET_ORDER`.
 */

// ===========================================================================
// BASE
// ===========================================================================

/**
 * Settings every preset inherits unless it overrides them. The overlay fade is
 * not tunable — it is hard-wired to an expo-out — so only the wallpaper
 * transform exposes parameters.
 */
const SHARED_DEFAULTS = {
    bg_easing: DEFAULT_BG_EASING,
};

/**
 * Abstract base class for every preset.
 *
 * Contract
 * --------
 *  - `DEFAULTS` is the preset's *complete* advanced-settings bundle, and its
 *    value types act as the schema: numbers are coerced to finite numbers,
 *    strings to registry ids, booleans to flags (see `resolvePresetConfig`).
 *    Presets own no runtime state — the engine plays the animation.
 *  - `USES_STORED_PARAMS` flags the `custom` pseudo-preset, whose values come
 *    from the saved settings instead of `DEFAULTS`.
 */
export class BasePreset {
    /** Registry id, e.g. "zoom_in_light". */
    static ID = "";

    /** i18n key for the dropdown label. */
    static LABEL_KEY = "";

    /** When true, saved values win over DEFAULTS (used by `custom`). */
    static USES_STORED_PARAMS = false;

    /** @type {Record<string, number|string|boolean>} Full settings bundle. */
    static DEFAULTS = { ...SHARED_DEFAULTS };

    /**
     * Slider spec consumed by the generic editor. `group` routes the control to
     * the right container (`bg` for the wallpaper transform, `overlay` for the
     * fade) and `defaultValue` is the slider's reset target.
     *
     * @returns {Array<Object>}
     */
    static getSettingsSpec() {
        return [
            { key: "zoom", group: "bg", label: t("onload_anim.zoom_label"), dataI18n: "onload_anim.zoom_label", min: 1, max: 3, step: 0.1, unit: "x", defaultValue: 1 },
            { key: "blur", group: "bg", label: t("onload_anim.blur_label"), dataI18n: "onload_anim.blur_label", min: 0, max: 30, step: 1, unit: "px", defaultValue: 0 },
            { key: "rotate", group: "bg", label: t("onload_anim.rotate_label"), dataI18n: "onload_anim.rotate_label", min: -45, max: 45, step: 1, unit: "deg", defaultValue: 0 },
            { key: "speed", group: "bg", label: t("onload_anim.speed_label"), dataI18n: "onload_anim.speed_label", min: 0.5, max: 5, step: 0.5, unit: "s", defaultValue: 1 },
            { key: "overlay_speed", group: "overlay", label: t("onload_anim.overlay_speed_label"), dataI18n: "onload_anim.overlay_speed_label", min: 0, max: 5, step: 0.1, unit: "s", defaultValue: 0.8 },
        ];
    }

    /** Fresh copy of the preset's parameter bundle. */
    static getDefaults() {
        return { ...this.DEFAULTS };
    }
}

// ===========================================================================
// PRESETS
// ===========================================================================

/** No-transform preset: the wallpaper simply fades in behind the overlay. */
export class DefaultPreset extends BasePreset {
    static ID = "default";
    static LABEL_KEY = "onload_anim.default_preset";
    static DEFAULTS = { ...SHARED_DEFAULTS, zoom: 1, rotate: 0, blur: 0, speed: 1, overlay_speed: 0.8 };
}

/** Default preset: a gentle zoom-in with a light blur fade. */
export class ZoomInLightPreset extends BasePreset {
    static ID = "zoom_in_light";
    static LABEL_KEY = "onload_anim.zoom_in_light_preset";
    static DEFAULTS = { ...SHARED_DEFAULTS, zoom: 1.2, rotate: 0, blur: 10, speed: 3, overlay_speed: 1 };
}

/** Cinematic preset: a strong zoom + slight rotation and a heavy blur reveal. */
export class ZoomInHeavyPreset extends BasePreset {
    static ID = "zoom_in_heavy";
    static LABEL_KEY = "onload_anim.zoom_in_heavy_preset";
    static DEFAULTS = { ...SHARED_DEFAULTS, zoom: 2.4, rotate: 20, blur: 16, speed: 2.5, overlay_speed: 1 };
}

/** Sleepy preset: slow, heavily blurred entry with a long overlay fade. */
export class SleepyPreset extends BasePreset {
    static ID = "sleepy";
    static LABEL_KEY = "onload_anim.wake_up_preset";
    static DEFAULTS = { ...SHARED_DEFAULTS, zoom: 1.3, rotate: 0, blur: 30, speed: 5, overlay_speed: 2.5 };
}

/** Chill preset: an off-axis zoom-in that settles with a light blur fade. */
export class NaturePreset extends BasePreset {
    static ID = "nature";
    static LABEL_KEY = "onload_anim.nature_preset";
    static DEFAULTS = { ...SHARED_DEFAULTS, zoom: 2, rotate: -10, blur: 15, speed: 5, overlay_speed: 1 };
}

/**
 * Pseudo-preset selected automatically as soon as the user tweaks any advanced
 * setting.
 *
 * It is the only preset that resolves its bundle from the saved settings
 * (`USES_STORED_PARAMS`) instead of `DEFAULTS`; the `DEFAULTS` below are only
 * the safety net for a fresh install where no custom values exist yet.
 */
export class CustomPreset extends BasePreset {
    static ID = "custom";
    static LABEL_KEY = "onload_anim.custom_preset";
    static USES_STORED_PARAMS = true;
    static DEFAULTS = { ...SHARED_DEFAULTS, zoom: 1.2, rotate: 0, blur: 10, speed: 3, overlay_speed: 1 };
}

// ===========================================================================
// REGISTRY
// ===========================================================================

/** Maps a preset id to its implementation. */
export const PRESET_REGISTRY = {
    [DefaultPreset.ID]: DefaultPreset,
    [ZoomInLightPreset.ID]: ZoomInLightPreset,
    [ZoomInHeavyPreset.ID]: ZoomInHeavyPreset,
    [SleepyPreset.ID]: SleepyPreset,
    [NaturePreset.ID]: NaturePreset,
    [CustomPreset.ID]: CustomPreset,
};

/**
 * Display order used to build the preset dropdown. `custom` is intentionally
 * excluded — the editor appends it after a divider.
 */
export const PRESET_ORDER = [
    DefaultPreset.ID,
    ZoomInLightPreset.ID,
    ZoomInHeavyPreset.ID,
    SleepyPreset.ID,
    NaturePreset.ID,
];

export const CUSTOM_PRESET = CustomPreset.ID;

/** Fallback preset for fresh installs and unknown/legacy ids. */
export const DEFAULT_PRESET = ZoomInLightPreset.ID;

/**
 * Resolve a preset id to its class, falling back to the default for
 * unknown/legacy values.
 * @param {string} presetId
 * @returns {typeof BasePreset}
 */
export function resolvePresetClass(presetId) {
    return PRESET_REGISTRY[presetId] || PRESET_REGISTRY[DEFAULT_PRESET];
}

/** @param {string} presetId */
export function isCustomPreset(presetId) {
    return presetId === CUSTOM_PRESET;
}
