/**
 * Largest integration step accepted, in seconds. Prevents a huge jump after a
 * tab switch / frame stall from destabilising the spring integrator.
 */
export const MAX_DT = 0.05;

/**
 * BaseMotion.js
 * ---------------------------------------------------------------------------
 * Abstract base class for every wavy motion generator.
 *
 * Mirrors the role of `ParticleEffect` for the particles system: each concrete
 * implementation declares its own `ID`, its own `DEFAULTS` and the list of
 * sliders the settings panel should render (`getSettingsSpec()`), while the
 * generic editor in `WavyEditorUI.js` stays completely unaware of the physics.
 *
 * Adding a new motion type therefore means: create a subclass, register it in
 * `registry.js`. No template and no editor change required.
 *
 * Contract
 * --------
 *  - `update(dt)` MUST return `{ x, y, rot }` already expressed in the units the
 *    CSS transform consumes (px for translation, degrees for rotation). Each
 *    generator owns its own amplitude handling, exactly like a ParticleEffect
 *    owns its own rendering.
 *  - `reset()` restarts the generator (new phase / integrator state). Called on
 *    start and whenever the mode or seed changes.
 *  - `setConfig(config)` swaps the parameter bag WITHOUT resetting internal
 *    state, so live slider edits never make the motion jump.
 */
export class BaseMotion {
    /**
     * @param {Object} config - Resolved parameter bag (DEFAULTS merged with user values).
     * @param {number} seed - Deterministic seed, used by the noise-based generators.
     */
    constructor(config = {}, seed = 0) {
        this.config = config;
        this.seed = seed;
    }

    /** Swap parameters while keeping the running state intact. */
    setConfig(config) {
        this.config = config;
    }

    /** Advance by `dt` seconds and return { x, y, rot } in px / degrees. */
    update(dt) {
        return { x: 0, y: 0, rot: 0 };
    }

    /** Restart the generator. */
    reset() { }

    /** Read a parameter, falling back to the class defaults. */
    param(key) {
        const value = this.config?.[key];
        if (value === undefined || value === null || Number.isNaN(value)) {
            return this.constructor.DEFAULTS?.[key];
        }
        return value;
    }

    /**
     * Slider spec consumed by the generic settings editor.
     * Each entry: { key, label, min, max, step, unit, group?, tooltipKey? }
     * Entries sharing a `group` are rendered together, with `tooltipKey` shown
     * once at the end of the group.
     * @returns {Array<Object>}
     */
    static getSettingsSpec() {
        return [];
    }
}
