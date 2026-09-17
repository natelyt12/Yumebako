import { getFromStore, saveToStore } from "/src/core/db.js";
import { getSettings } from "/src/core/storageHandler.js";
import { t } from "/src/core/i18n.js";

const WALLHAVEN_STORAGE_KEY = "data:wallhaven";

async function fetchImageBlob(url) {
    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        return await response.blob();
    } catch (error) {
        console.error("[wallhavenAPI] Error fetching image blob:", error);
        return null;
    }
}

/**
 * Fetch a fresh batch of wallpapers matching the user's Wallhaven filters.
 * Exported so the Switcher's WallhavenSource can build its own card list.
 *
 * @param {Object} [options]
 * @param {boolean} [options.strict=false] - Rethrow on failure instead of
 *     swallowing it into an empty batch. The Switcher needs to tell "the API is
 *     unreachable" (an error the user can retry) apart from "the filters match
 *     nothing" (a feed with nothing left), and an empty batch cannot say which.
 * @returns {Promise<Array>} Raw Wallhaven wallpaper records.
 */
export async function fetchWallhavenQueue({ strict = false } = {}) {
    try {
        const s = getSettings().wallhavenConfig || {};
        const categories = s.categories || { general: true, anime: true, people: false };
        const sorting = s.sorting || "random";
        const topRange = s.topRange || "1M";
        const query = s.query || "";
        const resolution = s.resolution || "any";

        const cats = `${categories.general ? '1' : '0'}${categories.anime ? '1' : '0'}${categories.people ? '1' : '0'}`;

        const params = new URLSearchParams({
            sorting: sorting,
            categories: cats,
            purity: '100',
            ratios: 'landscape'
        });

        if (sorting === 'toplist') {
            params.append('topRange', topRange);
        }

        if (query) params.append("q", query);
        if (resolution && resolution !== "any") params.append("atleast", resolution);

        const url = `https://wallhaven.cc/api/v1/search?${params.toString()}`;
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        const json = await response.json();
        return json.data || [];
    } catch (error) {
        console.error("[wallhavenAPI] Error fetching wallhaven queue:", error);
        if (strict) throw error;
        return [];
    }
}

export async function clearWallhavenQueue() {
    let storeData = await getFromStore(WALLHAVEN_STORAGE_KEY) || { queue: [], current: null };
    storeData.queue = [];
    await saveToStore(WALLHAVEN_STORAGE_KEY, storeData);
}

export async function getWallhavenData(refresh = false) {
    try {
        let storeData = await getFromStore(WALLHAVEN_STORAGE_KEY) || { queue: [], current: null };
        if (!storeData.queue) storeData.queue = [];

        if (!refresh && storeData.current) {
            if (!storeData.current.blob || !(storeData.current.blob instanceof Blob)) {
                const blob = await fetchImageBlob(storeData.current.image);
                if (!blob) return { error: t("sp.api.wallhaven.corrupted_data") };
                storeData.current.blob = blob;
                await saveToStore(WALLHAVEN_STORAGE_KEY, storeData);
            }
            return storeData.current;
        }

        if (storeData.queue.length === 0) {
            storeData.queue = await fetchWallhavenQueue();
            storeData.queue_total = storeData.queue.length;
        }

        if (storeData.queue.length === 0) {
            return { error: t("sp.api.wallhaven.no_result") };
        }

        const nextItem = storeData.queue.shift();
        if (!nextItem || !nextItem.path) {
            return { error: t("sp.api.wallhaven.corrupted_data") };
        }

        const blob = await fetchImageBlob(nextItem.path);
        if (!blob) {
            return { error: t("sp.api.error") };
        }

        storeData.current = {
            image: nextItem.path,
            blob: blob,
            source: nextItem.short_url,
            width: nextItem.dimension_x,
            height: nextItem.dimension_y,
            size: nextItem.file_size,
            last_updated: Date.now(),
            category: nextItem.category,
            queue_left: storeData.queue.length,
            queue_total: storeData.queue_total || 24
        };

        await saveToStore(WALLHAVEN_STORAGE_KEY, storeData);
        return storeData.current;
    } catch (error) {
        console.error("[wallhavenAPI] Error in getWallhavenData:", error);
        return { error: t("sp.api.error") };
    }
}
