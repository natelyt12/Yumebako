import { ALL_EFFECTS } from "./registry.js";
import { ParticleEffect } from "./ParticleEffect.js";
import { getSettings } from "/src/core/storageHandler.js";
import { getWavyParallaxState, getSmoothedMouse } from "/src/wallpaper/backend/effects/motion/index.js";

// ==========================================
// EFFECTS ENGINE — Multi-canvas, 2-layer
// ==========================================
export class EffectsEngine {
    static MAX_PER_LAYER = 5;

    constructor() {
        this.dynamicContainer = document.querySelector(".wallpaper_effect_container");
        this.staticContainer = document.querySelector(".static_effect_container");
        this.dynamicLayers = new Map(); // id -> CanvasEntry
        this.staticLayers = new Map();
        this._resizeTimer = null;
        this._lastStateSignature = null;

        window.addEventListener("resize", () => {
            if (this._resizeTimer) clearTimeout(this._resizeTimer);
            this._resizeTimer = setTimeout(() => {
                this._resizeTimer = null;
                this.resize();
            }, 120);
        });
    }

    _createCanvas(container) {
        const canvas = document.createElement("canvas");
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
        Object.assign(canvas.style, {
            position: "absolute",
            top: "0", left: "0",
            width: "100%", height: "100%",
            pointerEvents: "none",
        });
        container.appendChild(canvas);
        return canvas;
    }

    _getLayerMap(layer) {
        return layer === "static" ? this.staticLayers : this.dynamicLayers;
    }

    _getContainer(layer) {
        return layer === "static" ? this.staticContainer : this.dynamicContainer;
    }

    _renderEntryOnce(entry) {
        if (!entry) return;
        entry.ctx.clearRect(0, 0, entry.canvas.width, entry.canvas.height);
        entry.effect.render();
    }

    _startLoop(id, layer) {
        const layers = this._getLayerMap(layer);
        const entry = layers.get(id);
        if (!entry) return;

        // Static effects without an `update` override only need a single draw (plus redraws on config/resize).
        const isAnimated =
            layer !== "static" ||
            entry.effect.update !== ParticleEffect.prototype.update;
        if (!isAnimated) {
            this._renderEntryOnce(entry);
            return;
        }

        let active = true;
        entry.stop = () => { active = false; };

        const tick = () => {
            if (!active) return;
            const e = layers.get(id);
            if (!e) return;

            const { amplitude } = getWavyParallaxState();
            // Use the wavy engine's already-smoothed mouse — Single Source of Truth for parallax
            const { mouseX, mouseY } = getSmoothedMouse();

            e.ctx.clearRect(0, 0, e.canvas.width, e.canvas.height);
            if (e.effect.setMouse) e.effect.setMouse(mouseX, mouseY, amplitude);
            if (e.effect.update) e.effect.update();
            e.effect.render();
            if (active) {
                e.animId = requestAnimationFrame(tick);
            }
        };
        entry.animId = requestAnimationFrame(tick);
    }

    addEffect(id, layer, type, config) {
        const layers = this._getLayerMap(layer);
        if (layers.size >= EffectsEngine.MAX_PER_LAYER) return false;
        if (layers.has(id)) return false;

        const EffectClass = ALL_EFFECTS[type];
        if (!EffectClass) return false;

        const container = this._getContainer(layer);
        if (!container) return false;

        this._lastStateSignature = null;
        const canvas = this._createCanvas(container);
        const ctx = canvas.getContext("2d");
        const mergedCfg = { ...(EffectClass.DEFAULTS || {}), ...(config || {}) };
        const effect = new EffectClass(canvas, ctx, mergedCfg);
        effect.init();

        layers.set(id, { canvas, ctx, effect, animId: null, stop: null, type, config: mergedCfg, layer });
        this._startLoop(id, layer);
        this._updateZIndices(layer);
        return true;
    }

    removeEffect(id, layer) {
        const layers = this._getLayerMap(layer);
        const entry = layers.get(id);
        if (!entry) return;
        this._lastStateSignature = null;
        entry.stop?.();
        if (entry.animId) cancelAnimationFrame(entry.animId);
        entry.canvas.remove();
        layers.delete(id);
        this._updateZIndices(layer);
    }

    updateEffectConfig(id, layer, config) {
        const layers = this._getLayerMap(layer);
        const entry = layers.get(id);
        if (!entry) return;
        this._lastStateSignature = null;
        entry.config = { ...entry.config, ...config };
        entry.effect.config = entry.config;

        // If 'count' (density) changed, re-initialize the effect to update particle array
        if (config.count !== undefined) {
            entry.effect.init();
        }
        if (layer === "static" && entry.effect.update === ParticleEffect.prototype.update) {
            this._renderEntryOnce(entry);
        }
    }

    reorderEffect(id, layer, direction) {
        const layers = this._getLayerMap(layer);
        const keys = [...layers.keys()];
        const idx = keys.indexOf(id);
        if (idx < 0) return;

        this._lastStateSignature = null;

        if (direction === "up" && idx > 0) {
            [keys[idx - 1], keys[idx]] = [keys[idx], keys[idx - 1]];
        } else if (direction === "down" && idx < keys.length - 1) {
            [keys[idx], keys[idx + 1]] = [keys[idx + 1], keys[idx]];
        } else {
            return;
        }

        const newMap = new Map(keys.map(k => [k, layers.get(k)]));
        if (layer === "static") this.staticLayers = newMap;
        else this.dynamicLayers = newMap;
        this._updateZIndices(layer);
    }

    reorderLayers(layer, orderOfIds) {
        const layers = this._getLayerMap(layer);
        this._lastStateSignature = null;
        const newMap = new Map();
        orderOfIds.forEach(id => {
            if (layers.has(id)) {
                newMap.set(id, layers.get(id));
            }
        });
        for (const [id, entry] of layers) {
            if (!newMap.has(id)) {
                newMap.set(id, entry);
            }
        }
        if (layer === "static") this.staticLayers = newMap;
        else this.dynamicLayers = newMap;
        this._updateZIndices(layer);
    }

    _updateZIndices(layer) {
        const layers = this._getLayerMap(layer);
        let z = layers.size;
        for (const [, entry] of layers) {
            entry.canvas.style.zIndex = z--;
        }
    }

    resize() {
        const resizeLayer = (map, layer) => {
            for (const [, entry] of map) {
                entry.canvas.width = window.innerWidth;
                entry.canvas.height = window.innerHeight;
                entry.effect.init?.();
                if (layer === "static" && entry.effect.update === ParticleEffect.prototype.update) {
                    this._renderEntryOnce(entry);
                }
            }
        };
        resizeLayer(this.dynamicLayers, "dynamic");
        resizeLayer(this.staticLayers, "static");
    }

    stopAll() {
        this._lastStateSignature = null;
        const clearLayer = (map) => {
            for (const [, entry] of map) {
                entry.stop?.();
                if (entry.animId) cancelAnimationFrame(entry.animId);
                entry.canvas.remove();
            }
            map.clear();
        };
        clearLayer(this.dynamicLayers);
        clearLayer(this.staticLayers);
    }

    _computeStateSignature(data, enabled) {
        const isMasterEnabled = Boolean(data) && (enabled !== undefined ? enabled : (data.enabled !== false));
        if (!isMasterEnabled) return "disabled";
        return JSON.stringify({
            enabled: true,
            dynamicEnabled: data.dynamicEnabled !== false,
            staticEnabled: data.staticEnabled !== false,
            dynamic: (data.dynamic || []).filter((e) => e.enabled !== false),
            static: (data.static || []).filter((e) => e.enabled !== false),
        });
    }

    /**
     * Record the current engine state as already synced with `data` so a
     * matching `loadState(data)` triggered by settings listeners does not
     * tear down and respawn running canvases.
     *
     * @param {Object} data
     * @param {boolean} [enabled]
     */
    markStateSynced(data, enabled) {
        this._lastStateSignature = this._computeStateSignature(data, enabled);
    }

    loadState(data, enabled) {
        const signature = this._computeStateSignature(data, enabled);

        if (this._lastStateSignature !== null && this._lastStateSignature === signature) {
            return;
        }

        this.stopAll();
        this._lastStateSignature = signature;
        if (signature === "disabled") return;

        if (data.dynamicEnabled !== false) {
            (data.dynamic || []).forEach(e => {
                if (e.enabled !== false) {
                    this.addEffect(e.id, "dynamic", e.type, e.config);
                }
            });
        }
        if (data.staticEnabled !== false) {
            (data.static || []).forEach(e => {
                if (e.enabled !== false) {
                    this.addEffect(e.id, "static", e.type, e.config);
                }
            });
        }
        this._lastStateSignature = signature;
    }
}
