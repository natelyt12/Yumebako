import { getSettings, subscribe } from "/src/core/storageHandler.js";
import { DEFAULT_MOTION } from "./registry.js";
import { createMotionSampler, resolveMotionConfig } from "./MotionEngine.js";

/**
 * WavyEngine.js
 * ---------------------------------------------------------------------------
 * The runtime half of the wavy feature: owns the wallpaper animation loop, the
 * single controller instance and the smoothed mouse state that every parallax
 * consumer reads.
 *
 * Counterpart of `particles/EffectsEngine.js`:
 *   WavyEngine      (this file)      ↔ EffectsEngine      — runtime
 *   WavyEditorUI                     ↔ EffectsEditorUI    — settings panel
 *   motion/registry  + motion/impl   ↔ particles/registry — pluggable modules
 *
 * The settings panel never touches the controller directly; it goes through
 * `getWavyController()`.
 */

/** Deep copy for plain-JSON config bags (never share references with settings). */
export const cloneData = (value) => JSON.parse(JSON.stringify(value ?? {}));

let wavyInstance = null;

function createWavyController(element, initialConfig = null) {
    // Shared across every motion type. Per-motion parameters live in `motions`,
    // keyed by motion id — each generator declares its own defaults in its class.
    const DEFAULT_CONFIG = {
        motionType: DEFAULT_MOTION,
        scale: 1.04,
        // Whether the per-motion parameter sliders are expanded in the panel.
        advanced: false,
        parallaxInertia: 0.03,
        parallaxAmplitude: -30,
        motions: {},
    };

    let config = {
        ...DEFAULT_CONFIG,
        ...(initialConfig || {}),
        motions: cloneData(initialConfig?.motions ?? DEFAULT_CONFIG.motions),
    };
    let animationId = null;
    let lastTimestamp = null;
    let isActive = false;

    // Motion sampler (see MotionEngine.js). Rebuilt only when the motion type or
    // the seed changes; plain parameter edits are swapped in place so the
    // generator's internal state (spring velocity, phase) never resets.
    let sampler = null;
    let samplerMode = null;
    let samplerSeed = Math.floor(Math.random() * 1e6);
    let builtSeed = null;
    let samplerSource = null;

    function ensureSampler() {
        const mode = config.motionType || DEFAULT_MOTION;
        const stored = config.motions?.[mode];

        if (sampler && samplerMode === mode && builtSeed === samplerSeed) {
            // Parameter bags are replaced wholesale on every edit, so an identity
            // check is enough — nothing gets allocated on the animation hot path.
            if (samplerSource !== stored) {
                sampler.setConfig(resolveMotionConfig(mode, stored));
                samplerSource = stored;
            }
            return;
        }

        samplerMode = mode;
        builtSeed = samplerSeed;
        samplerSource = stored;
        sampler = createMotionSampler({ motionType: mode, motions: config.motions, seed: samplerSeed });
    }

    let targetMouseX = 0;
    let targetMouseY = 0;
    let mouseX = 0;
    let mouseY = 0;

    // pointermove fires reliably even when a mouse button is held down on another element,
    // unlike mousemove which can be blocked by pointer capture during mousedown.
    window.addEventListener("pointermove", (e) => {
        if (e.pointerType !== "mouse") return; // ignore touch/pen to avoid conflicts
        targetMouseX = (e.clientX / window.innerWidth - 0.5) * 2;
        targetMouseY = (e.clientY / window.innerHeight - 0.5) * 2;
    });

    function animate(timestamp) {
        if (lastTimestamp === null) lastTimestamp = timestamp;
        let dt = (timestamp - lastTimestamp) / 1000;
        lastTimestamp = timestamp;
        if (!(dt > 0)) dt = 0;      // guard against NaN / clock going backwards
        if (dt > 0.05) dt = 0.05;   // clamp after tab switches to keep the integrator stable

        const inertia = config.parallaxInertia !== undefined ? config.parallaxInertia : 0.025;
        mouseX += (targetMouseX - mouseX) * inertia;
        mouseY += (targetMouseY - mouseY) * inertia;

        const isWavyOn = config.enabled !== false;
        const isParallaxOn = config.parallaxEnabled === true;

        ensureSampler();
        const motion = sampler.update(dt);

        const x = isWavyOn ? motion.x : 0;
        const y = isWavyOn ? motion.y : 0;
        const rot = isWavyOn ? motion.rot : 0;

        // Dynamic Wallpaper Mouse Parallax Shift
        const parallaxAmp = isParallaxOn ? (config.parallaxAmplitude !== undefined ? config.parallaxAmplitude : -15) : 0;
        const parallaxX = mouseX * parallaxAmp;
        const parallaxY = mouseY * (parallaxAmp * 0.65);

        const totalX = x + parallaxX;
        const totalY = y + parallaxY;

        element.style.transform = `
            translate(calc(-50% + ${totalX}px), calc(-50% + ${totalY}px)) 
            rotate(${rot}deg) 
            scale(${config.scale})
        `;

        if (isActive) {
            animationId = requestAnimationFrame(animate);
        }
    }

    function start() {
        if (isActive) return;
        isActive = true;
        lastTimestamp = null;
        if (sampler) sampler.reset();
        animationId = requestAnimationFrame(animate);
    }

    function stop(resetPosition = true) {
        isActive = false;
        if (animationId) {
            cancelAnimationFrame(animationId);
            animationId = null;
        }
        if (resetPosition) {
            element.style.transform = "translate(-50%, -50%) scale(1) rotate(0deg)";
        }
    }

    function updateConfig(newConfig) {
        const next = { ...newConfig };
        if (next.motions) next.motions = cloneData(next.motions);
        config = { ...config, ...next };
    }

    function getConfig() {
        return { ...config, motions: cloneData(config.motions) };
    }

    function getDefaultConfig() {
        return { ...DEFAULT_CONFIG };
    }

    return {
        start,
        stop,
        updateConfig,
        getConfig,
        getDefaultConfig,
        // Roll a new noise seed so "randomize" produces a genuinely different
        // motion shape instead of only scaling the same curve.
        reseed() { samplerSeed = Math.floor(Math.random() * 1e6); },
        get isActive() { return isActive; },
        // Single Source of Truth: smoothed mouse state for all parallax consumers
        getSmoothedMouse() { return { mouseX, mouseY }; }
    };
}

/** The live controller, or null before the engine has booted. */
export function getWavyController() {
    return wavyInstance;
}

export function getWavyParallaxState() {
    if (!wavyInstance) {
        const wavySettings = getSettings().wavy || {};
        const wavyConfig = wavySettings.config || {};
        const isParallaxOn = wavySettings.parallaxEnabled === true;
        return {
            enabled: isParallaxOn,
            inertia: wavyConfig.parallaxInertia !== undefined ? Number(wavyConfig.parallaxInertia) : 0.03,
            amplitude: isParallaxOn ? (wavyConfig.parallaxAmplitude !== undefined ? Number(wavyConfig.parallaxAmplitude) : -30) : 0
        };
    }
    const currentConfig = wavyInstance.getConfig();
    const isParallaxOn = currentConfig.parallaxEnabled === true;
    return {
        enabled: isParallaxOn,
        inertia: currentConfig.parallaxInertia !== undefined ? Number(currentConfig.parallaxInertia) : 0.03,
        amplitude: isParallaxOn ? (currentConfig.parallaxAmplitude !== undefined ? Number(currentConfig.parallaxAmplitude) : -30) : 0
    };
}

/**
 * Returns the already-lerped mouse position from the wavy animation loop.
 * This is the Single Source of Truth for parallax across wallpaper + particles.
 * Always safe to call — returns {0,0} if the wavy controller hasn't started yet.
 */
export function getSmoothedMouse() {
    if (!wavyInstance) return { mouseX: 0, mouseY: 0 };
    return wavyInstance.getSmoothedMouse();
}

// Boot: react to every "wavy" setting change (fires immediately on subscribe).
subscribe("wavy", (wavyConfig) => {
    const wavyLayer = document.querySelector(".wavy");
    if (!wavyLayer) return;

    const fullConfig = {
        ...(wavyConfig.config || {}),
        enabled: wavyConfig.enabled !== false,
        parallaxEnabled: wavyConfig.parallaxEnabled === true
    };

    if (!wavyInstance) {
        wavyInstance = createWavyController(wavyLayer, fullConfig);
    } else {
        wavyInstance.updateConfig(fullConfig);
    }

    if (fullConfig.enabled || fullConfig.parallaxEnabled) {
        wavyInstance.start();
    } else {
        wavyInstance.stop();
    }
});
