import { NoiseMotion } from "./impl/NoiseMotion.js";
import { OrganicMotion } from "./impl/OrganicMotion.js";

/**
 * Maps a motion type id to its implementation.
 * Same idea as `particles/registry.js` and `providers/registry.js`: the editor
 * and the runtime only ever talk to ids, never to concrete classes.
 */
export const MOTION_REGISTRY = {
    [NoiseMotion.ID]: NoiseMotion,
    [OrganicMotion.ID]: OrganicMotion,
};

/** Display order used to build the motion-type dropdown. */
export const MOTION_ORDER = [NoiseMotion.ID, OrganicMotion.ID];

export const DEFAULT_MOTION = NoiseMotion.ID;

/**
 * Resolve a motion type id to its class, falling back to the default for
 * unknown/legacy values.
 * @param {string} motionType
 * @returns {typeof import("./BaseMotion.js").BaseMotion}
 */
export function resolveMotionClass(motionType) {
    return MOTION_REGISTRY[motionType] || MOTION_REGISTRY[DEFAULT_MOTION];
}
