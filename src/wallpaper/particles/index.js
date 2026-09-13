import { subscribe } from "/src/core/storageHandler.js";
import { EffectsEngine } from "./EffectsEngine.js";
import { EffectsEditorUI } from "./EffectsEditorUI.js";

export { ParticleEffect } from "./ParticleEffect.js";
export { SnowEffect } from "./dynamic/SnowEffect.js";
export { RainEffect } from "./dynamic/RainEffect.js";
export { DustEffect } from "./dynamic/DustEffect.js";
export { PetalsEffect } from "./dynamic/PetalsEffect.js";
export { FirefliesEffect } from "./dynamic/FirefliesEffect.js";

export { NoiseEffect } from "./static/NoiseEffect.js";
export { VignetteEffect } from "./static/VignetteEffect.js";
export { CinematicEffect } from "./static/CinematicEffect.js";

export { DYNAMIC_EFFECTS, STATIC_EFFECTS, ALL_EFFECTS } from "./registry.js";
export { EffectsEngine } from "./EffectsEngine.js";
export { EffectsEditorUI } from "./EffectsEditorUI.js";

const engine = new EffectsEngine();
const editor = new EffectsEditorUI(engine);

// Subscribe reactively to "particles" configuration
subscribe("particles", (particlesConfig) => {
    engine.loadState(particlesConfig);
});

export function initializeParticles() {
    editor.initialize();
}

