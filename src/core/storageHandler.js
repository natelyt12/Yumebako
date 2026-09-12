import { recoverCollectionBlobs } from "/src/wallpaper/providers/impl/collection/collectionDb.js";
import { getAllFromStore, saveToStore, clearStore } from "/src/core/db.js";
import { initDate, initClock } from "/src/core/time.js";

const STORAGE_KEY = "bako_settings";
const WALLPAPER_KEYS = ["wallpaperConfig", "wallpaperPosition", "wavy", "particles", "onload"];

// Legacy flat wavy params, back when the classic wave generator existed. That
// generator was removed, so the values are carried over to WAVY_DEFAULT_MOTION.
const WAVY_LEGACY_MOTION_KEYS = ["amplitudeX", "speedX", "amplitudeY", "speedY", "amplitudeRotate", "speedRotate"];
const WAVY_DEFAULT_MOTION = "noise";

// Define default data structure
// NOTE: When adding a new module that requires settings, add its default key here.
const defaultSettings = {
    // ==========================================
    // WALLPAPER & EFFECTS (Aesthetics)
    // ==========================================
    wallpaperConfig: {
        source: "wallhaven",
        brightness: 1,
        blur: 0,
        contrast: 1,
        saturate: 1,
        chroma: 0,
        bloom: 0,
        mode: "cover",
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
            // Per-motion-type parameter bags, keyed by motion id. Each generator
            // declares its own defaults in its class (see src/wallpaper/motion),
            // so only the container lives here — same approach as `particles`.
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
        bg_easing: "var(--expo_out)",
        overlay_easing: "var(--sine_in_out)"
    },

    // ==========================================
    // SYSTEM & STARTPAGE (Utility)
    // ==========================================
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
 * Utility for deep merging settings objects automatically
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
 * @returns {Object} The merged configuration object.
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
        // Migrate legacy string rotation strings to numbers (Support users with old settings)
        if (mergedStored.wallpaperConfig && typeof mergedStored.wallpaperConfig.rotation === "string") {
            const LEGACY_ROTATION_MAP = { never: 0, "15min": 1, "30min": 2, "1hour": 3, "2hour": 4 };
            mergedStored.wallpaperConfig.rotation = LEGACY_ROTATION_MAP[mergedStored.wallpaperConfig.rotation] ?? 0;
        }

        // The classic wave generator was removed. Carry its parameters (the old
        // flat keys and/or the legacy `motions.sine` bag) over to the new default
        // generator so users keep their tuning — existing target values win.
        const legacyWavyConfig = mergedStored.wavy?.config;
        if (legacyWavyConfig) {
            if (!legacyWavyConfig.motions) legacyWavyConfig.motions = {};

            const carried = { ...(legacyWavyConfig.motions.sine || {}) };
            WAVY_LEGACY_MOTION_KEYS.forEach((key) => {
                if (legacyWavyConfig[key] !== undefined) {
                    carried[key] = legacyWavyConfig[key];
                    delete legacyWavyConfig[key];
                }
            });
            delete legacyWavyConfig.motions.sine;

            if (Object.keys(carried).length > 0) {
                legacyWavyConfig.motions[WAVY_DEFAULT_MOTION] = {
                    ...carried,
                    ...(legacyWavyConfig.motions[WAVY_DEFAULT_MOTION] || {}),
                };
            }

            if (legacyWavyConfig.motionType === "sine") {
                legacyWavyConfig.motionType = WAVY_DEFAULT_MOTION;
            }
        }

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
 * @param {Object} partialSettings - Partial object containing new updates.
 */
export function saveSettings(partialSettings) {
    const current = getSettings();
    // Use shallow merge on save to prevent accidentally merging removed arrays.
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

    // Notify key listeners
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
 * @param {string} key - The settings key to listen to.
 * @param {Function} callback - Callback function receiving (newValue, allSettings).
 * @returns {Function} Unsubscribe function.
 */
export function subscribe(key, callback) {
    if (!keyListeners.has(key)) {
        keyListeners.set(key, new Set());
    }
    keyListeners.get(key).add(callback);

    // Immediately trigger with current value for initial setup
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
        // Exclude local API data (heavy images, videos) from backup file
        const filteredIdbData = idbData ? idbData.filter((item) => item.key !== "local_image_data" && item.key !== "local_video_data") : [];

        // Exclude blob objects from backup to reduce JSON export size
        for (let item of filteredIdbData) {
            if (item.key === "wallhaven_data" && item.value?.current?.blob) {
                delete item.value.current.blob;
            }
            if (item.key === "picre_data" && item.value?.blob) {
                delete item.value.blob;
            }
            if (item.key === "background_collection" && Array.isArray(item.value)) {
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
        let importedLS = importedData.localStorage || importedData; // fallback old format

        // Restore IndexedDB & Weather Cache if they are present in the backup (i.e. 'all' or 'system' backup)
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

            // Attempt to recover blobs from background_collection
            try {

                await recoverCollectionBlobs();
            } catch (err) {
                console.error("Failed to recover collection blobs during import:", err);
            }
        }

        // Distribute the imported local storage data back to bako_settings and bako_wallpaper
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

        // Update settingsCache and notify all registered key listeners
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
