/**
 * Public entry point for the wavy feature.
 *
 * Mirrors `src/wallpaper/particles/index.js`: the folder owns the implementation and
 * this barrel is the only thing the rest of the app imports.
 *
 *   motion/
 *     WavyEngine.js       runtime: controller, animation loop, parallax state
 *     WavyEditorUI.js     settings panels + sidebar toggles
 *     BaseMotion.js       abstract generator
 *     registry.js         id -> generator class
 *     MotionEngine.js     id -> resolved config -> sampler instance
 *     noise.js            shared noise primitives
 *     impl/               NoiseMotion, OrganicMotion
 */
export { getWavyParallaxState, getSmoothedMouse, getWavyController } from "./WavyEngine.js";
export { initializeWavySettings, toggleWavyVisibility } from "./WavyEditorUI.js";

// Motion generators — exported for consumers that want to reason about the
// available algorithms without reaching into the folder internals.
export { BaseMotion, MAX_DT } from "./BaseMotion.js";
export { MOTION_REGISTRY, MOTION_ORDER, DEFAULT_MOTION, resolveMotionClass } from "./registry.js";
export { createMotionSampler, resolveMotionConfig } from "./MotionEngine.js";
export { fbm1D, valueNoise1D, hash1 } from "./noise.js";
export { NoiseMotion } from "./impl/NoiseMotion.js";
export { OrganicMotion } from "./impl/OrganicMotion.js";
