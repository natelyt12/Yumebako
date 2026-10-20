import { getAllKeys, getAllFromStore, removeFromStore } from "/src/core/db.js";
import { getSettings } from "/src/core/storageHandler.js";

/**
 * mediaGC.js
 * ---------------------------------------------------------------------------
 * Background Garbage Collector for the `mediaData` IndexedDB object store.
 * - Collects all active/valid wallpaper IDs from settings, active cards, and appData.
 * - Identifies and removes orphaned Blobs (media:orig:*, media:thumb:*, legacy keys).
 * - Runs asynchronously after page load when the browser is idle to avoid frame drops.
 */

/**
 * Scan the application state and IndexedDB `appData` store to collect all
 * wallpaper IDs that are actively referenced.
 *
 * @returns {Promise<Set<string>|null>} Set of valid ID strings, or null if appData failed to read.
 */
export async function collectValidMediaIds() {
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
    if (window.dataControl?.items && Array.isArray(window.dataControl.items)) {
        for (const card of window.dataControl.items) {
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
 * @returns {Promise<{ deleted: number, kept: number }>}
 */
export async function runMediaGC() {
    // If DataControl is currently busy fetching/swapping, defer GC
    if (window.dataControl?.isBusy) {
        setTimeout(() => runMediaGC(), 4000);
        return { deleted: 0, kept: 0, deferred: true };
    }

    try {
        const mediaKeys = await getAllKeys("mediaData");
        if (!mediaKeys || mediaKeys.length === 0) {
            console.info("[MediaGC] mediaData is empty. Nothing to clean.");
            return { deleted: 0, kept: 0 };
        }

        const validIds = await collectValidMediaIds();
        if (validIds === null) {
            console.warn("[MediaGC] Could not read appData store. Aborting GC to prevent false-positive deletion.");
            return { deleted: 0, kept: 0, aborted: true };
        }

        let deletedCount = 0;
        let keptCount = 0;

        for (const key of mediaKeys) {
            const strKey = String(key);

            // Pattern: media:orig:${id} or media:thumb:${id}
            const match = strKey.match(/^media:(?:orig|thumb):(.+)$/);
            if (match) {
                const id = match[1];
                if (!validIds.has(id)) {
                    await removeFromStore(strKey, "mediaData");
                    deletedCount++;
                } else {
                    keptCount++;
                }
                continue;
            }

            // Purge legacy / orphaned keys
            if (strKey.startsWith("wallpaper_media:")) {
                await removeFromStore(strKey, "mediaData");
                deletedCount++;
            }
        }

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
 * @param {number} [delayMs=2500] Initial delay after load before scheduling idle callback.
 */
export function scheduleMediaGC(delayMs = 2500) {
    if (typeof window === "undefined") return;

    // Expose for testing and manual debugging in DevTools console
    window.runMediaGC = runMediaGC;

    const trigger = () => {
        if ("requestIdleCallback" in window) {
            window.requestIdleCallback(() => runMediaGC(), { timeout: 10000 });
        } else {
            setTimeout(() => runMediaGC(), 1500);
        }
    };

    if (document.readyState === "complete") {
        setTimeout(trigger, delayMs);
    } else {
        window.addEventListener("load", () => setTimeout(trigger, delayMs), { once: true });
    }
}

