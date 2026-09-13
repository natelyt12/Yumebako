/**
 * easing.js
 * ---------------------------------------------------------------------------
 * Single source of truth for the easing curves the startup animation is
 * allowed to use.
 *
 * Ids map 1:1 to the `--*` custom properties declared in `src/styles/variables.css`,
 * so settings only ever store the short id ("expo_out") while the engine hands
 * the CSS a stable `var(--expo_out)` token. Keeping the token construction in
 * one place means the UI, the storage schema and the runtime can never drift.
 */

/**
 * id → CSS custom property name (without the leading `--`).
 *
 * `linear` stays as the neutral baseline; the rest are decelerating ("out")
 * curves, because the startup animation always settles into place — an `in` or
 * `in-out` curve would read wrong here.
 */
export const EASING_REGISTRY = {
    linear: "linear",
    ease_out: "ease_out",
    expo_out: "expo_out",
    cubic_out: "cubic_out",
    sine_out: "sine_out",
};

/**
 * Display order for the easing dropdown: the registry's own order, so adding a
 * curve to `EASING_REGISTRY` is all it takes to make it selectable.
 */
export const EASING_ORDER = Object.keys(EASING_REGISTRY);

export const DEFAULT_BG_EASING = "expo_out";

/**
 * Curve applied to the overlay fade. Deliberately fixed — the plain `ease-out`
 * keyword is all this needs, so there is nothing to tune.
 */
export const OVERLAY_FADE_EASING = "ease_out";

/**
 * Normalise a stored value to a registry id.
 * Accepts both the modern short id and the legacy full CSS token
 * (`"var(--expo_out)"` / `"--expo_out"`) so existing saves keep working.
 *
 * @param {string} value
 * @param {string} [fallback]
 * @returns {string}
 */
export function normalizeEasingId(value, fallback = DEFAULT_BG_EASING) {
    if (typeof value !== "string") return fallback;
    const legacy = value.match(/--([a-z0-9_]+)/i);
    const id = legacy ? legacy[1] : value.trim();
    return EASING_REGISTRY[id] ? id : fallback;
}

/**
 * Resolve a stored value to a CSS-ready token.
 * @param {string} value
 * @param {string} [fallback]
 * @returns {string}
 */
export function resolveEasing(value, fallback = DEFAULT_BG_EASING) {
    return `var(--${EASING_REGISTRY[normalizeEasingId(value, fallback)]})`;
}
