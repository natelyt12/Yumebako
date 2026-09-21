import { recoverCollectionBlobs } from "/src/wallpaper/sources/api/collectionDb.js";
import { getAllFromStore, saveToStore, clearStore } from "/src/core/db.js";
import { initDate, initClock } from "/src/core/time.js";

// ─── JSDoc type definitions ───────────────────────────────────────────────────

/**
 * @typedef {Object} WallpaperConfig
 * @property {string}      source              - Active source id (e.g. "picre", "collection").
 * @property {string|null} activeWallpaperId   - Id of the currently applied wallpaper card.
 * @property {string|null} [activeCollectionItemId] - Id within the collection source (when source === "collection").
 * @property {number}      brightness          - CSS filter: brightness multiplier (1 = normal).
 * @property {number}      blur                - CSS filter: blur in px.
 * @property {number}      contrast            - CSS filter: contrast multiplier (1 = normal).
 * @property {number}      saturate            - CSS filter: saturate multiplier (1 = normal).
 * @property {number}      bloom               - Bloom intensity (0–1 range).
 * @property {string}      mode                - Object-fit mode: "cover" | "contain" | "fill" | "none".
 */

/**
 * @typedef {Object} WallpaperSwitcher
 * @property {string}              activeSource   - Fallback source tab id.
 * @property {Record<string, number>} sourceIndices - Last-visited index per source id.
 */

/**
 * @typedef {Object} WavyMotionConfig
 * @property {string}  motionType        - Active motion generator id (e.g. "noise").
 * @property {number}  scale             - Wallpaper upscale factor to hide translation edges (e.g. 1.04).
 * @property {boolean} advanced          - Whether advanced sliders are shown in the editor.
 * @property {number}  parallaxInertia   - Spring inertia for parallax movement.
 * @property {number}  parallaxAmplitude - Max parallax offset in px.
 * @property {Record<string, Record<string, number>>} motions - Per-generator parameter bags, keyed by motion id.
 */

/**
 * @typedef {Object} WavyConfig
 * @property {boolean}        enabled          - Whether the wavy animation is active.
 * @property {boolean}        parallaxEnabled  - Whether mouse-parallax is active.
 * @property {WavyMotionConfig} config         - Motion generator parameters.
 */

/**
 * A single particle effect entry in the particles layer.
 * The exact shape is declared by each ParticleEffect subclass.
 * @typedef {Record<string, any>} ParticleEffectEntry
 */

/**
 * @typedef {Object} ParticlesConfig
 * @property {boolean}               enabled - Whether the particles overlay is active.
 * @property {ParticleEffectEntry[]} dynamic - List of animated particle effects.
 * @property {ParticleEffectEntry[]} static  - List of static particle effects.
 */

/**
 * @typedef {Object} OnloadConfig
 * @property {boolean} enabled         - Whether the entrance animation plays on page load.
 * @property {boolean} widget_immediate - Widgets appear immediately (no delay).
 * @property {string}  preset          - Preset animation id (e.g. "zoom_in_light").
 * @property {number}  zoom            - Zoom factor during the animation.
 * @property {number}  rotate          - Rotation angle in degrees.
 * @property {number}  blur            - Blur intensity in px.
 * @property {number}  speed           - Background animation duration in seconds.
 * @property {number}  overlay_speed   - Overlay fade duration in seconds.
 * @property {string}  bg_easing       - Easing id for the background transition (e.g. "expo_out").
 * @property {boolean} advanced        - Whether advanced sliders are shown in the editor.
 */

/**
 * Widget position using anchor-relative coordinates.
 * ax/ay are percentage-based anchor points (0–100); x/y are pixel offsets from the anchor.
 *
 * @typedef {Object} WidgetPositionConfig
 * @property {number}      ax   - Horizontal anchor percentage (0 = left, 50 = center, 100 = right).
 * @property {number}      ay   - Vertical anchor percentage (0 = top, 50 = center, 100 = bottom).
 * @property {number}      x    - Pixel offset from the horizontal anchor.
 * @property {number}      y    - Pixel offset from the vertical anchor.
 * @property {number|null} [w]  - Fixed width in px, or null for auto.
 * @property {number|null} [h]  - Fixed height in px, or null for auto.
 */

/**
 * A single widget's persisted state.
 * @typedef {Object} WidgetEntry
 * @property {boolean}            enabled  - Whether this widget is rendered.
 * @property {WidgetPositionConfig} position - Position on the widget canvas.
 * @property {Record<string, any>} config  - Widget-specific configuration.
 */

/**
 * @typedef {Object} WidgetsConfig
 * @property {boolean}     enabled      - Master toggle for the widget layer.
 * @property {number}      grid_size    - Snap grid size in px.
 * @property {number}      grid_padding - Canvas edge padding in px.
 * @property {WidgetEntry} clock        - Analog/digital clock widget.
 * @property {WidgetEntry} date         - Date display widget.
 * @property {WidgetEntry} lunar        - Lunar calendar widget.
 * @property {WidgetEntry} weather      - Weather widget.
 */

/**
 * Full merged application settings object, combining bako_settings and bako_wallpaper.
 *
 * @typedef {Object} AppSettings
 * @property {WallpaperConfig}   wallpaperConfig    - Active wallpaper and filter settings.
 * @property {WallpaperSwitcher} wallpaperSwitcher  - Switcher browsing state.
 * @property {{x:number, y:number, zoom:number, mode:string}} wallpaperPosition - Position/zoom of the wallpaper.
 * @property {WavyConfig}        wavy               - Wavy motion settings.
 * @property {ParticlesConfig}   particles          - Particle effect settings.
 * @property {OnloadConfig}      onload             - Page-load entrance animation settings.
 * @property {Array<any>}        wallpapers         - Legacy wallpaper list (unused, kept for migration).
 * @property {string}            tabTitle           - Custom browser tab title.
 * @property {boolean}           presentationMode   - Hide UI chrome for presentations.
 * @property {string}            language           - Locale id (e.g. "en", "vi").
 * @property {{query:string, categories:Object, resolution:string, sorting:string, topRange:string}} wallhavenConfig - Wallhaven search parameters.
 * @property {string}            unsplashApiKey     - User-supplied Unsplash API key.
 * @property {boolean}           debugI18n          - Highlight missing i18n keys.
 * @property {boolean}           hideToggleButton   - Hide the settings toggle button.
 * @property {WidgetsConfig}     widgets            - Widget layer configuration.
 */

const WALLPAPER_KEYS = ["wallpaperConfig", "wallpaperSwitcher", "wallpaperPosition", "wavy", "particles", "onload", "wallpapers"];


/**
 * Factory for generating default per-wallpaper effect profile.
 */
export function getDefaultWallpaperEffects() {
    return {
        position: { x: 50, y: 50, zoom: 1, mode: "cover" },
        filter: { brightness: 1, blur: 0, contrast: 1, saturate: 1, bloom: 0 },
        wavy: {
            enabled: false,
            parallaxEnabled: false,
            config: {
                motionType: "noise",
                scale: 1.04,
                advanced: false,
                parallaxInertia: 0.03,
                parallaxAmplitude: -30,
                motions: {},
            },
        },
        particles: {
            enabled: false,
            dynamic: [],
            static: [],
        },
        onload: {
            enabled: false,
            widget_immediate: true,
            preset: "zoom_in_light",
            zoom: 1.2,
            rotate: 0,
            blur: 10,
            speed: 3,
            overlay_speed: 1,
            bg_easing: "expo_out",
            advanced: false,
        },
    };
}

// Add new settings keys here when introducing new modules.
const defaultSettings = {
    // ==========================================
    // WALLPAPER & EFFECTS (Aesthetics)
    // ==========================================
    wallpaperConfig: {
        source: "picre",
        activeWallpaperId: null,
        brightness: 1,
        blur: 0,
        contrast: 1,
        saturate: 1,
        bloom: 0,
        mode: "cover",
    },
    // Standalone Wallpaper Switcher (Alt + W) browsing state.
    // The tab actually opened is the one owning the current desktop wallpaper.
    // See src/wallpaper/sources/registry.js for tab resolution logic.
    wallpaperSwitcher: {
        activeSource: "picre",
        sourceIndices: {},
    },
    wallpaperPosition: { x: 50, y: 50, zoom: 1, mode: "cover" },
    wavy: {
        enabled: false,
        parallaxEnabled: false,
        config: {
            motionType: "noise",
            scale: 1.04,
            advanced: false,
            parallaxInertia: 0.03,
            parallaxAmplitude: -30,
            // Each generator declares its own defaults in its class (src/wallpaper/motion).
            // Only the container bag lives here — same pattern as `particles`.
            motions: {}
        }
    },
    particles: {
        enabled: true,
        dynamic: [],
        static: []
    },
    onload: {
        enabled: false,
        widget_immediate: true,
        preset: "zoom_in_light",
        zoom: 1.2,
        rotate: 0,
        blur: 10,
        speed: 3,
        overlay_speed: 1,
        // Easing id resolved to a CSS var(--token) at play time. See src/wallpaper/onload/easing.js.
        bg_easing: "expo_out",
        advanced: false,
    },
    wallpapers: [],

    // ── System & Startpage ───────────────────────────────────────────────────
    tabTitle: "",
    presentationMode: false,
    language: "en",
    wallhavenConfig: {
        query: "neko, catgirl",
        categories: { general: false, anime: true, people: false },
        resolution: "1920x1080",
        sorting: "random",
        topRange: "1M"
    },
    unsplashApiKey: "",
    debugI18n: false,
    hideToggleButton: false,
    widgets: {
        enabled: false,
        grid_size: 10,
        grid_padding: 0,
        clock: {
            enabled: false,
            position: { ax: 0, ay: 100, x: 0, y: 0, w: null, h: null },
            config: {
                format: "24h",
                add_zero_hour: false,
                show_seconds: false,
                show_ampm: true,
                font: ""
            }
        },
        date: {
            enabled: false,
            position: { ax: 0, ay: 100, x: 0, y: -80, w: null, h: null },
            config: {}
        },
        lunar: {
            enabled: false,
            position: { ax: 0, ay: 100, x: 0, y: -120, w: null, h: null },
            config: {}
        },
        weather: {
            enabled: false,
            position: { ax: 100, ay: 0, x: -20, y: 20, w: null, h: null },
            config: {
                fahrenheit: false,
                manual_location: null
            }
        }
    }
};

/**
 * Returns true if the value is a plain (non-array) object.
 * @param {unknown} item
 * @returns {boolean}
 */
function isObject(item) {
    return item && typeof item === "object" && !Array.isArray(item);
}

function deepMerge(target, source) {
    if (!isObject(target) || !isObject(source)) {
        return source;
    }

    const output = { ...target };
    Object.keys(source).forEach((key) => {
        if (isObject(source[key]) && isObject(target[key])) {
            output[key] = deepMerge(target[key], source[key]);
        } else {
            output[key] = source[key];
        }
    });
    return output;
}

let settingsCache = null;
const keyListeners = new Map();

/**
 * Retrieve all settings from LocalStorage.
 * Automatically merges with defaultSettings to avoid missing keys.
 * @returns {AppSettings} The merged configuration object.
 */
export function getSettings() {
    if (settingsCache) return settingsCache;

    const storedSystem = localStorage.getItem("bako_settings");
    const storedWallpaper = localStorage.getItem("bako_wallpaper");
    
    if (!storedSystem && !storedWallpaper) {
        settingsCache = JSON.parse(JSON.stringify(defaultSettings));
        return settingsCache;
    }

    let mergedStored = {};
    
    if (storedSystem) {
        try {
            mergedStored = { ...mergedStored, ...JSON.parse(storedSystem) };
        } catch (e) {
            console.error("Settings: Error parsing bako_settings", e);
        }
    }
    
    if (storedWallpaper) {
        try {
            mergedStored = { ...mergedStored, ...JSON.parse(storedWallpaper) };
        } catch (e) {
            console.error("Settings: Error parsing bako_wallpaper", e);
        }
    } else if (storedSystem) {
        // Migration logic: split old bako_settings into two keys
        const wallpaperMigrate = {};
        const systemMigrate = { ...mergedStored };
        let didMigrate = false;
        
        WALLPAPER_KEYS.forEach(k => {
            if (systemMigrate[k] !== undefined) {
                wallpaperMigrate[k] = systemMigrate[k];
                delete systemMigrate[k];
                didMigrate = true;
            }
        });
        
        if (didMigrate) {
            localStorage.setItem("bako_settings", JSON.stringify(systemMigrate));
            localStorage.setItem("bako_wallpaper", JSON.stringify(wallpaperMigrate));
        }
    }

    try {
        settingsCache = deepMerge(defaultSettings, mergedStored);
        return settingsCache;
    } catch (e) {
        console.error("Settings: Error deep merging storage, using defaults", e);
        settingsCache = JSON.parse(JSON.stringify(defaultSettings));
        return settingsCache;
    }
}

/**
 * Save merged settings into LocalStorage.
 * Keys listed in WALLPAPER_KEYS are routed to bako_wallpaper; all others go to bako_settings.
 * @param {Partial<AppSettings>} partialSettings - Partial object containing new updates.
 */
export function saveSettings(partialSettings) {
    const current = getSettings();
    // Shallow merge on save — prevents accidentally clobbering removed array items.
    const updated = { ...current, ...partialSettings };
    
    let currentSystem = {};
    let currentWallpaper = {};
    try {
        currentSystem = JSON.parse(localStorage.getItem("bako_settings")) || {};
        currentWallpaper = JSON.parse(localStorage.getItem("bako_wallpaper")) || {};
    } catch (e) {}

    let systemChanged = false;
    let wallpaperChanged = false;

    Object.keys(partialSettings).forEach(key => {
        if (WALLPAPER_KEYS.includes(key)) {
            currentWallpaper[key] = updated[key];
            wallpaperChanged = true;
        } else {
            currentSystem[key] = updated[key];
            systemChanged = true;
        }
    });

    if (systemChanged) localStorage.setItem("bako_settings", JSON.stringify(currentSystem));
    if (wallpaperChanged) localStorage.setItem("bako_wallpaper", JSON.stringify(currentWallpaper));

    settingsCache = updated;
    console.debug("Settings: Saved and notifying listeners", partialSettings);

    // Notify per-key subscribers.
    Object.keys(partialSettings).forEach((key) => {
        if (keyListeners.has(key)) {
            keyListeners.get(key).forEach((callback) => {
                try {
                    callback(updated[key], updated);
                } catch (e) {
                    console.error(`Error notifying listener for key ${key}:`, e);
                }
            });
        }
    });
}

/**
 * Subscribe to changes on a specific settings key.
 * The callback is immediately fired with the current value.
 * @template {keyof AppSettings} K
 * @param {K} key - The settings key to listen to.
 * @param {(newValue: AppSettings[K], allSettings: AppSettings) => void} callback
 * @returns {() => void} Unsubscribe function.
 */
export function subscribe(key, callback) {
    if (!keyListeners.has(key)) {
        keyListeners.set(key, new Set());
    }
    keyListeners.get(key).add(callback);

    // Fire immediately with the current value so callers can do initial setup
    // without a separate getSettings() call.
    const currentSettings = getSettings();
    try {
        callback(currentSettings[key], currentSettings);
    } catch (e) {
        console.error(`Error in initial callback for key ${key}:`, e);
    }

    return () => {
        const set = keyListeners.get(key);
        if (set) {
            set.delete(callback);
        }
    };
}

/**
 * Export current settings and DB data to a JSON file format.
 * @param {string} type - 'all', 'wallpaper', or 'system'
 * @returns {Promise<void>}
 */
export async function exportSettings(type = 'all') {
    const backupData = { exportType: type };
    let lsData = {};
    
    if (type === 'all' || type === 'system') {
        const sysData = JSON.parse(localStorage.getItem("bako_settings") || "{}");
        lsData = { ...lsData, ...sysData };
        
        const idbData = await getAllFromStore();
        // Exclude local API data (heavy images/videos) — they are never part of a backup.
        const filteredIdbData = idbData ? idbData.filter((item) => item.key !== "local_image_data" && item.key !== "local_video_data") : [];

        // Strip blob fields to keep export file size manageable.
        for (let item of filteredIdbData) {
            if (item.key === "data:wallhaven" && item.value?.current?.blob) {
                delete item.value.current.blob;
            }
            if (item.key === "data:picre" && item.value?.blob) {
                delete item.value.blob;
            }
            if (item.key === "data:collection" && Array.isArray(item.value)) {
                item.value = item.value.filter(bg => bg.type && !bg.type.startsWith("local"));
                item.value.forEach(bg => {
                    delete bg.blob;
                    delete bg.thumbnail;
                });
            }
        }
        
        const weatherCacheData = localStorage.getItem("weather_cache");
        backupData.weatherCache = weatherCacheData ? JSON.parse(weatherCacheData) : null;
        backupData.indexedDB = filteredIdbData;
    }
    
    if (type === 'all' || type === 'wallpaper') {
        const wpData = JSON.parse(localStorage.getItem("bako_wallpaper") || "{}");
        lsData = { ...lsData, ...wpData };
    }
    
    backupData.localStorage = lsData;

    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(backupData, null, 2));
    const downloadAnchorNode = document.createElement("a");

    const d = initDate();
    const t = initClock("24h", true);
    const timestamp = `${d.year}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}_${t.hours}${t.minutes}`;
    
    let prefix = "bako_backup";
    if (type === 'wallpaper') prefix = "bako_wallpaper_preset";
    if (type === 'system') prefix = "bako_startpage_backup";
    const filename = `${prefix}_${timestamp}.json`;

    downloadAnchorNode.setAttribute("href", dataStr);
    downloadAnchorNode.setAttribute("download", filename);
    document.body.appendChild(downloadAnchorNode); // required for firefox
    downloadAnchorNode.click();
    downloadAnchorNode.remove();
}

/**
 * Import settings from JSON string content.
 * @param {string} jsonString - JSON content string.
 * @returns {Promise<boolean>} Resolves to true if imported successfully.
 */
export async function importSettings(jsonString) {
    try {
        const importedData = JSON.parse(jsonString);
        let importedLS = importedData.localStorage || importedData; // fallback: old export format had no wrapper

        // Restore IndexedDB and weather cache when present (full or system backup).
        if (Array.isArray(importedData.indexedDB)) {
            if (importedData.weatherCache) {
                localStorage.setItem("weather_cache", JSON.stringify(importedData.weatherCache));
            } else {
                localStorage.removeItem("weather_cache");
            }

            await clearStore();
            for (const item of importedData.indexedDB) {
                if (item && item.key) {
                    await saveToStore(item.key, item.value);
                }
            }

            // Attempt to recover collection item blobs regenerated from IDB.
            try {
                await recoverCollectionBlobs();
            } catch (err) {
                console.error("Failed to recover collection blobs during import:", err);
            }
        }

        // Distribute imported data back into the two storage keys.
        let currentSystem = {};
        let currentWallpaper = {};
        try {
            currentSystem = JSON.parse(localStorage.getItem("bako_settings")) || {};
            currentWallpaper = JSON.parse(localStorage.getItem("bako_wallpaper")) || {};
        } catch (e) {}

        Object.keys(importedLS).forEach(key => {
            if (WALLPAPER_KEYS.includes(key)) {
                currentWallpaper[key] = importedLS[key];
            } else {
                currentSystem[key] = importedLS[key];
            }
        });

        localStorage.setItem("bako_settings", JSON.stringify(currentSystem));
        localStorage.setItem("bako_wallpaper", JSON.stringify(currentWallpaper));

        // Rebuild cache and notify all active key subscribers.
        settingsCache = deepMerge(defaultSettings, { ...currentSystem, ...currentWallpaper });
        console.debug("Settings: Imported successfully, notifying all listeners");

        keyListeners.forEach((callbacks, key) => {
            callbacks.forEach((callback) => {
                try {
                    callback(settingsCache[key], settingsCache);
                } catch (e) {
                    console.error(`Error notifying listener for key ${key} during import:`, e);
                }
            });
        });

        return true;
    } catch (error) {
        console.error("Settings: Error parsing imported settings:", error);
        return false;
    }
}
