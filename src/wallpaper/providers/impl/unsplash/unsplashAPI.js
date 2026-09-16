import { getFromStore, saveToStore } from "/src/core/db.js";
import { getSettings } from "/src/core/storageHandler.js";
import { t } from "/src/core/i18n.js";

const UNSPLASH_STORAGE_KEY = "unsplash_data";

async function fetchImageBlob(url) {
    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        return await response.blob();
    } catch (error) {
        console.error("[unsplashAPI] Error fetching image blob:", error);
        return null;
    }
}

/**
 * Fetch a fresh batch of Unsplash photos.
 * Exported so the Switcher's UnsplashSource can build its own card list.
 * @param {string} apiKey
 * @returns {Promise<Array>} Raw Unsplash photo records.
 */
export async function fetchUnsplashQueue(apiKey) {
    try {
        // Using query=nature,travel to get curated, high-quality backgrounds
        const url = `https://api.unsplash.com/photos/random?count=30&orientation=landscape&query=nature,travel&client_id=${apiKey}`;
        const response = await fetch(url);
        if (!response.ok) {
            if (response.status === 401) throw new Error("Invalid Unsplash API Key");
            if (response.status === 403) throw new Error("Rate Limit Exceeded");
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const json = await response.json();
        // Unsplash returns an array when 'count' is used
        return Array.isArray(json) ? json : [json];
    } catch (error) {
        console.error("[unsplashAPI] Error fetching unsplash queue:", error);
        throw error;
    }
}

export async function clearUnsplashQueue() {
    let storeData = await getFromStore(UNSPLASH_STORAGE_KEY) || { queue: [], current: null };
    storeData.queue = [];
    await saveToStore(UNSPLASH_STORAGE_KEY, storeData);
}

export async function getUnsplashData(refresh = false) {
    try {
        const settings = getSettings();
        const apiKey = settings.unsplashApiKey;
        
        if (!apiKey) {
            return { error: t("sp.api.unsplash.no_key", "Vui lòng nhập Access Key trong tab Debug.") };
        }

        let storeData = await getFromStore(UNSPLASH_STORAGE_KEY) || { queue: [], current: null };
        if (!storeData.queue) storeData.queue = [];

        if (!refresh && storeData.current) {
            if (!storeData.current.blob || !(storeData.current.blob instanceof Blob)) {
                const blob = await fetchImageBlob(storeData.current.image);
                if (!blob) return { error: t("sp.api.unsplash.corrupted_data", "Dữ liệu bị hỏng") };
                storeData.current.blob = blob;
                await saveToStore(UNSPLASH_STORAGE_KEY, storeData);
            }
            return storeData.current;
        }

        if (storeData.queue.length === 0) {
            try {
                storeData.queue = await fetchUnsplashQueue(apiKey);
                storeData.queue_total = storeData.queue.length;
            } catch (err) {
                return { error: err.message };
            }
        }

        if (storeData.queue.length === 0) {
            return { error: t("sp.api.unsplash.no_result", "Không tìm thấy kết quả từ Unsplash.") };
        }

        const nextItem = storeData.queue.shift();
        if (!nextItem || !nextItem.urls || !nextItem.urls.regular) {
            return { error: t("sp.api.unsplash.corrupted_data", "Dữ liệu bị hỏng") };
        }

        const imageUrl = nextItem.urls.full || nextItem.urls.regular;
        const blob = await fetchImageBlob(imageUrl);
        if (!blob) {
            return { error: t("sp.api.error", "Lỗi tải ảnh từ Unsplash") };
        }

        storeData.current = {
            image: imageUrl,
            blob: blob,
            source: nextItem.links?.html || "https://unsplash.com",
            width: nextItem.width,
            height: nextItem.height,
            size: blob.size,
            last_updated: Date.now(),
            category: "Unsplash",
            author_name: nextItem.user?.name || "Unknown",
            author_url: nextItem.user?.links?.html,
            description: nextItem.alt_description || nextItem.description || "",
            download_location: nextItem.links?.download_location || "",
            queue_left: storeData.queue.length,
            queue_total: storeData.queue_total || 30
        };

        await saveToStore(UNSPLASH_STORAGE_KEY, storeData);
        return storeData.current;
    } catch (error) {
        console.error("[unsplashAPI] Error in getUnsplashData:", error);
        return { error: t("sp.api.error", "Lỗi tải ảnh từ Unsplash") };
    }
}
