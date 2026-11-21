import {
  getAllKeys,
  getAllFromStore,
  removeManyFromStore,
} from "/src/core/db.js";
import { getSettings } from "/src/core/storageHandler.js";

/**
 * mediaGC.js
 * ---------------------------------------------------------------------------
 * Background Garbage Collector for the `mediaData` IndexedDB object store.
 * - Collects all active/valid wallpaper IDs from settings, active cards, and appData.
 * - Identifies and removes orphaned Blobs (media:orig:*, media:thumb:*, legacy keys).
 * - Runs asynchronously after page load when the browser is idle to avoid frame drops.
 */

/** @type {import("./DataControl.js").DataControl|null} */
let dataControlRef = null;

/**
 * Inject the active DataControl instance used by MediaGC without creating a
 * circular static import between `DataControl.js` and `mediaGC.js`.
 *
 * @param {import("./DataControl.js").DataControl|null} dc
 */
export function setMediaGCDataControl(dc) {
    dataControlRef = dc || null;
}

/**
 * Scan the application state and IndexedDB `appData` store to collect all
 * wallpaper IDs that are actively referenced.
 *
 * @param {Object} [options]
 * @param {import("./DataControl.js").DataControl|null} [options.dataControl=dataControlRef]
 * @returns {Promise<Set<string>|null>} Set of valid ID strings, or null if appData failed to read.
 */
export async function collectValidMediaIds({ dataControl = dataControlRef } = {}) {
    const validIds = new Set();

    // 1. Current active wallpaper IDs in settings
    try {
        const settings = getSettings();
        if (settings?.wallpaperConfig?.activeWallpaperId) {
            validIds.add(String(settings.wallpaperConfig.activeWallpaperId));
        }
        if (settings?.wallpaperConfig?.activeCollectionItemId) {
            validIds.add(String(settings.wallpaperConfig.activeCollectionItemId));
        }
    } catch (e) {
        console.warn("[MediaGC] Could not read settings:", e);
    }

    // 2. Currently loaded cards in memory (DataControl)
    if (dataControl?.items && Array.isArray(dataControl.items)) {
        for (const card of dataControl.items) {
            if (card?.id) validIds.add(String(card.id));
        }
    }

    // 3. Scan all appData records (carousel arrays, provider states, collection)
    const allAppData = await getAllFromStore("appData");
    if (allAppData === null) {
        // IDB error: return null to signal safety abort
        return null;
    }

    for (const entry of allAppData) {
        // Dynamic sources (`collection`, `bing`) never persist `carousel:*` snapshots;
        // ignore stale legacy records so orphaned blobs are not pinned.
        if (
            entry?.key === "carousel:collection" ||
            entry?.key === "carousel:bing"
        ) {
            continue;
        }

        const val = entry?.value;
        if (!val) continue;

        // Array stores: carousel:* or data:collection
        if (Array.isArray(val)) {
            for (const item of val) {
                if (item?.id) validIds.add(String(item.id));
            }
        } else if (typeof val === "object") {
            // Provider states: items, queue, applied, current
            if (Array.isArray(val.items)) {
                for (const item of val.items) {
                    if (item?.id) validIds.add(String(item.id));
                }
            }
            if (Array.isArray(val.queue)) {
                for (const item of val.queue) {
                    if (item?.id) validIds.add(String(item.id));
                }
            }
            if (val.applied?.id) validIds.add(String(val.applied.id));
            if (val.current?.id) validIds.add(String(val.current.id));
        }
    }

    return validIds;
}

/**
 * Run a full sweep of the `mediaData` store, purging any orphaned media blobs.
 * Prints a single diagnostic log line to the console upon completion.
 *
 * @param {Object} [options]
 * @param {import("./DataControl.js").DataControl|null} [options.dataControl=dataControlRef]
 * @returns {Promise<{ deleted: number, kept: number, deferred?: boolean, aborted?: boolean, error?: unknown }>}
 */
export async function runMediaGC({ dataControl = dataControlRef } = {}) {
    // If DataControl is currently busy fetching/swapping, defer GC
    if (dataControl?.isBusy) {
        setTimeout(() => runMediaGC({ dataControl }), 4000);
        return { deleted: 0, kept: 0, deferred: true };
    }

    try {
        const mediaKeys = await getAllKeys("mediaData");
        if (!mediaKeys || mediaKeys.length === 0) {
            console.info("[MediaGC] mediaData is empty. Nothing to clean.");
            return { deleted: 0, kept: 0 };
        }

        const validIds = await collectValidMediaIds({ dataControl });
        if (validIds === null) {
            console.warn("[MediaGC] Could not read appData store. Aborting GC to prevent false-positive deletion.");
            return { deleted: 0, kept: 0, aborted: true };
        }

        const keysToDelete = [];
        let keptCount = 0;

        for (const key of mediaKeys) {
            const strKey = String(key);

            // Pattern: media:orig:${id} or media:thumb:${id}
            const match = strKey.match(/^media:(?:orig|thumb):(.+)$/);
            if (match) {
                const id = match[1];
                if (!validIds.has(id)) {
                    keysToDelete.push(strKey);
                } else {
                    keptCount++;
                }
                continue;
            }

            // Purge legacy / orphaned keys
            if (strKey.startsWith("wallpaper_media:")) {
                keysToDelete.push(strKey);
            }
        }

        if (keysToDelete.length > 0) {
            await removeManyFromStore(keysToDelete, "mediaData");
        }
        const deletedCount = keysToDelete.length;

        if (deletedCount > 0) {
            console.info(`[MediaGC] Cleaned up ${deletedCount} orphaned media item(s). Active items: ${keptCount}.`);
        } else {
            console.info(`[MediaGC] Media store clean. Active items: ${keptCount}.`);
        }

        return { deleted: deletedCount, kept: keptCount };
    } catch (err) {
        console.error("[MediaGC] Error during media garbage collection:", err);
        return { deleted: 0, kept: 0, error: err };
    }
}

/**
 * Schedule the Media GC to execute in the background once all startup operations
 * and rendering are complete, utilizing `requestIdleCallback` when available.
 *
 * @param {number} [delayMs=2500] - Initial delay after load before scheduling idle callback.
 * @param {Object} [options]
 * @param {import("./DataControl.js").DataControl|null} [options.dataControl=dataControlRef]
 */
export function scheduleMediaGC(delayMs = 2500, { dataControl = dataControlRef } = {}) {
    if (typeof window === "undefined") return;

    // Expose for testing and manual debugging in DevTools console
    window.runMediaGC = runMediaGC;

    const trigger = () => {
        if ("requestIdleCallback" in window) {
            window.requestIdleCallback(() => runMediaGC({ dataControl }), { timeout: 10000 });
        } else {
            setTimeout(() => runMediaGC({ dataControl }), 1500);
        }
    };

    if (document.readyState === "complete") {
        setTimeout(trigger, delayMs);
    } else {
        window.addEventListener("load", () => setTimeout(trigger, delayMs), { once: true });
    }
}
