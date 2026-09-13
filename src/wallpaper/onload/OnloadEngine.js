import { getSettings } from "/src/core/storageHandler.js";
import { EVENTS } from "/src/core/events.js";
import { DEFAULT_PRESET, resolvePresetClass } from "./presets.js";
import { DEFAULT_BG_EASING, OVERLAY_FADE_EASING, resolveEasing } from "./easing.js";

/**
 * OnloadEngine.js
 * ---------------------------------------------------------------------------
 * Runtime half of the startup-animation feature.
 *
 * Counterpart of `particles/EffectsEngine.js` and `motion/WavyEngine.js`:
 *   OnloadEngine  (this file)  ↔ EffectsEngine      — runtime
 *   OnloadEditorUI             ↔ EffectsEditorUI    — settings panel
 *   presets.js                 ↔ particles/registry — pluggable presets
 *
 * The engine owns the DOM elements, the timeout bookkeeping and the actual
 * play/reset cycle. The settings panel never pokes the DOM directly; it asks
 * the engine to `play()` a resolved configuration.
 */

/** Delay before a preview replay starts, letting the overlay fade back in. */
const PREVIEW_LEAD_MS = 420;

/** Overlay fade-in duration used to stage a preview replay (ms). */
const PREVIEW_FADE_MS = 400;

/**
 * Coerce a stored value to the type declared by the preset default, so a
 * malformed save can never poison playback: numbers stay finite, ids stay
 * non-empty strings and flags stay booleans.
 */
function coerceValue(value, fallback) {
    if (typeof fallback === "number") {
        const num = Number(value);
        return Number.isFinite(num) ? num : fallback;
    }
    if (typeof fallback === "boolean") {
        return value === undefined || value === null ? fallback : value === true;
    }
    return typeof value === "string" && value !== "" ? value : fallback;
}

/**
 * Resolve a preset's complete advanced-settings bundle.
 *
 * Named presets own every setting, so their DEFAULTS win — that is what makes
 * "pick a preset, get that whole look" true. The `custom` preset inverts it:
 * saved values always win.
 *
 * @param {string} presetId
 * @param {Object} [stored]
 * @returns {Record<string, number|string|boolean>}
 */
export function resolvePresetConfig(presetId, stored = {}) {
    const PresetClass = resolvePresetClass(presetId);
    const defaults = PresetClass.DEFAULTS || {};
    const useStored = PresetClass.USES_STORED_PARAMS === true;
    const resolved = {};

    for (const [key, fallback] of Object.entries(defaults)) {
        resolved[key] = coerceValue(useStored ? stored[key] : fallback, fallback);
    }

    return resolved;
}

/**
 * Build a complete, normalised playback configuration from saved settings.
 *
 * Shared by the runtime (`apply()`) and the editor (live preview / save), so
 * the two paths can never drift apart.
 *
 * @param {Object} [stored] - A settings-shaped `onload` object.
 */
export function resolvePlayConfig(stored = {}) {
    const presetId = stored.preset || DEFAULT_PRESET;
    const params = resolvePresetConfig(presetId, stored);

    return {
        presetId,
        zoom: params.zoom,
        rotate: params.rotate,
        blur: params.blur,
        speed: params.speed,
        // Only the wallpaper transform is tunable; the fade is hard-wired to an
        // expo-out (see OVERLAY_FADE_EASING).
        bgEasing: resolveEasing(params.bg_easing, DEFAULT_BG_EASING),
        overlaySpeed: params.overlay_speed,
        overlayEasing: resolveEasing(OVERLAY_FADE_EASING),
        widgetImmediate: stored.widget_immediate !== false,
        advanced: stored.advanced === true,
    };
}

export class OnloadEngine {
    constructor() {
        this.frame = null;
        this.overlay = null;
        this._timeouts = new Set();
        this._refreshRefs();
    }

    // ── Element refs ──────────────────────────────────────────────────────────

    /** Re-query the animated elements if they are missing or were replaced. */
    _refreshRefs() {
        if (!this.frame?.isConnected) {
            this.frame = document.querySelector(".onload_animation_frame");
        }
        if (!this.overlay?.isConnected) {
            this.overlay = document.querySelector(".overlay");
        }
        return Boolean(this.frame && this.overlay);
    }

    // ── Timeout bookkeeping ───────────────────────────────────────────────────

    _schedule(fn, delay) {
        const id = setTimeout(() => {
            this._timeouts.delete(id);
            fn();
        }, delay);
        this._timeouts.add(id);
        return id;
    }

    _clearTimeouts() {
        this._timeouts.forEach((id) => clearTimeout(id));
        this._timeouts.clear();
    }

    // ── Reset helpers ─────────────────────────────────────────────────────────

    _resetOverlay() {
        const { overlay } = this;
        if (!overlay) return;
        overlay.style.transition = "";
        overlay.style.opacity = "0";
        overlay.style.pointerEvents = "none";
    }

    _resetFrame() {
        const { frame } = this;
        if (!frame) return;
        frame.style.transition = "";
        frame.style.filter = "";
        frame.style.transform = "";
    }

    /** Cancel any in-flight animation and restore the initial visual state. */
    reset() {
        this._clearTimeouts();
        this._refreshRefs();
        this._resetOverlay();
        this._resetFrame();
    }

    // ── Public API ────────────────────────────────────────────────────────────

    /**
     * Play the saved startup animation.
     * Called once the wallpaper has been painted (see ProviderManager).
     */
    apply() {
        this.play(resolvePlayConfig(getSettings().onload || {}));
    }

    /**
     * Play a normalised configuration (see `resolvePlayConfig`).
     *
     * @param {Object} [options]
     * @param {number} [options.zoom]
     * @param {number} [options.rotate]
     * @param {number} [options.blur]
     * @param {number} [options.speed] - Background transform duration (s).
     * @param {string} [options.bgEasing] - CSS easing token for the background.
     * @param {number} [options.overlaySpeed] - Overlay fade duration (s).
     * @param {string} [options.overlayEasing] - CSS easing token for the fade.
     * @param {boolean} [options.isPreview] - Stage the overlay before replaying.
     * @param {Function} [options.onComplete] - Fired when the intro is revealed.
     */
    play(options = {}) {
        if (!this._refreshRefs()) return;
        this._clearTimeouts();

        const config = {
            zoom: 1,
            rotate: 0,
            blur: 0,
            speed: 1,
            bgEasing: `var(--${DEFAULT_BG_EASING})`,
            overlaySpeed: 0.8,
            overlayEasing: `var(--${OVERLAY_FADE_EASING})`,
            isPreview: false,
            onComplete: null,
            ...options,
        };

        if (config.isPreview) {
            this._stagePreviewOverlay();
            this._schedule(() => this._start(config), PREVIEW_LEAD_MS);
        } else {
            this._start(config);
        }
    }

    // ── Internal phases ───────────────────────────────────────────────────────

    _stagePreviewOverlay() {
        const { overlay } = this;
        overlay.style.transition = `opacity ${PREVIEW_FADE_MS}ms ease`;
        overlay.style.opacity = "1";
    }

    _start(config) {
        const { frame, overlay } = this;

        frame.style.transition = "none";
        frame.style.filter = config.blur ? `blur(${config.blur}px)` : "none";
        frame.style.transform = `scale(${config.zoom}) rotate(${config.rotate}deg)`;

        // The overlay starts fully opaque and is faded out in `_run`.
        overlay.style.transition = "none";
        overlay.style.opacity = "1";

        // Force a reflow so the browser commits the initial state before the
        // transition is switched on across the next pair of frames.
        void frame.offsetHeight;
        void overlay.offsetHeight;

        this._nextFrame(() => this._nextFrame(() => this._run(config)));
    }

    _run(config) {
        const { frame, overlay } = this;

        frame.style.transition = `transform ${config.speed}s ${config.bgEasing}, filter ${config.speed}s ${config.bgEasing}`;
        frame.style.filter = "blur(0px)";
        frame.style.transform = "scale(1) rotate(0deg)";

        overlay.style.transition = `opacity ${config.overlaySpeed}s ${config.overlayEasing}`;
        overlay.style.opacity = "0";

        const totalDuration = Math.max(config.speed, config.overlaySpeed);
        const totalMs = totalDuration * 1000;
        const earlyMs = (totalDuration > 1 ? totalDuration - 1 : totalDuration) * 1000;

        let completed = false;
        const fireComplete = () => {
            if (completed) return;
            completed = true;
            config.onComplete?.();
        };

        // A preview is self-contained, so it only reports completion at the end.
        // The startup run reveals the UI one second early to hide the tail of the
        // animation behind the widgets.
        if (config.isPreview) {
            this._schedule(fireComplete, totalMs);
        } else {
            this._schedule(fireComplete, earlyMs);
            this._schedule(fireComplete, totalMs);
        }

        this._schedule(() => this._finish(config), totalMs);
    }

    _finish(config) {
        const { frame, overlay } = this;

        frame.style.transition = "";
        overlay.style.transition = "";
        overlay.style.opacity = "0";

        overlay.style.pointerEvents = "none";
        if (!config.isPreview) frame.style.pointerEvents = "none";

        document.dispatchEvent(new CustomEvent(EVENTS.ONLOAD_ANIMATION_COMPLETE));
    }

    _nextFrame(callback) {
        requestAnimationFrame(callback);
    }
}
