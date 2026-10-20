import { getFromStore, saveToStore } from "/src/core/db.js";
import { getSettings } from "/src/core/storageHandler.js";

export const BING_STORAGE_KEY = "provider_state:bing";

/**
 * Fetch 8 daily wallpapers from Bing HPImageArchive.
 *
 * @param {Object} [options]
 * @param {string} [options.resolution]
 * @param {boolean} [options.strict=false]
 * @returns {Promise<Array>}
 */
export async function fetchBingDaily8({ resolution, strict = false } = {}) {
    try {
        const settings = getSettings();
        const config = settings.bingConfig || {};
        const effectiveResolution = resolution || config.resolution || "uhd";

        const url = "https://www.bing.com/HPImageArchive.aspx?format=js&idx=0&n=8";

        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Bing API returned HTTP ${response.status}`);
        }

        const data = await response.json();
        const rawImages = Array.isArray(data?.images) ? data.images : [];

        if (rawImages.length === 0) {
            return [];
        }

        const isUhd = effectiveResolution === "uhd";

        return rawImages.map((item) => {
            const urlBase = item.urlbase || "";

            const origUrl = urlBase
                ? `https://www.bing.com${urlBase}_${isUhd ? "UHD" : "1920x1080"}.jpg`
                : (item.url ? `https://www.bing.com${item.url}` : "");

            const thumbUrl = urlBase
                ? `https://www.bing.com${urlBase}_800x480.jpg`
                : origUrl;

            let sourceUrl = item.copyrightlink || "https://www.bing.com";
            if (sourceUrl && !sourceUrl.startsWith("http")) {
                sourceUrl = `https://www.bing.com${sourceUrl.startsWith("/") ? "" : "/"}${sourceUrl}`;
            }

            const cleanTitle = item.title?.trim()
                || (item.copyright ? item.copyright.split("(")[0].trim() : "Bing Wallpaper");

            return {
                id: item.hsh || (urlBase ? urlBase.replace(/^\/th\?id=/, "") : item.startdate),
                url: origUrl,
                thumbnailUrl: thumbUrl,
                sourceUrl,
                title: cleanTitle,
                category: "Bing",
                copyright: item.copyright || "",
                startDate: item.startdate || "",
                width: isUhd ? 3840 : 1920,
                height: isUhd ? 2160 : 1080,
                size: 0,
            };
        });
    } catch (err) {
        console.error("[bingAPI] Failed to fetch 8 daily wallpapers from Bing:", err);
        if (strict) throw err;
        return [];
    }
}

/**
 * Clear Bing cached items so next access refreshes from API.
 */
export async function clearBingCache() {
    const storeData = (await getFromStore(BING_STORAGE_KEY)) || {};
    storeData.items = [];
    storeData.lastDate = null;
    await saveToStore(BING_STORAGE_KEY, storeData);
}
