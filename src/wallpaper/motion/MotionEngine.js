import { resolveMotionClass } from "./registry.js";

/**
 * MotionEngine.js
 * ---------------------------------------------------------------------------
 * Facade the wallpaper layer talks to. Mirrors `ProviderManager` / `EffectsEngine`:
 * it resolves ids from the registry, materialises each generator's parameter bag
 * (class DEFAULTS merged with whatever the user stored) and hands back a running
 * sampler instance.
 */

/**
 * Merge a stored (partial) parameter bag over the generator's DEFAULTS.
 * Non-numeric / nullish entries are ignored so a stale or malformed save can
 * never poison the math.
 *
 * @param {string} motionType
 * @param {Object} [storedConfig]
 * @returns {Object}
 */
export function resolveMotionConfig(motionType, storedConfig) {
    const defaults = resolveMotionClass(motionType).DEFAULTS || {};
    const stored = storedConfig || {};
    const resolved = {};

    for (const key of Object.keys(defaults)) {
        const value = Number(stored[key]);
        resolved[key] = Number.isFinite(value) ? value : defaults[key];
    }

    return resolved;
}

/**
 * Create and reset a motion sampler.
 *
 * @param {Object} options
 * @param {string} options.motionType - Registry id (unknown values fall back to the default).
 * @param {Object} [options.motions] - Per-motion-type parameter bags, keyed by id.
 * @param {number} [options.seed]
 * @returns {{ update: (dt:number) => {x:number,y:number,rot:number}, reset: () => void, setConfig: (c:Object)=>void }}
 */
export function createMotionSampler({ motionType, motions, seed }) {
    const MotionClass = resolveMotionClass(motionType);
    const config = resolveMotionConfig(motionType, motions?.[motionType]);
    const instance = new MotionClass(config, seed);
    instance.reset();
    return instance;
}
