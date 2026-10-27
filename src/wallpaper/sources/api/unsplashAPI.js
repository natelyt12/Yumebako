import { getFromStore, saveToStore } from "/src/core/db.js";
import { getSettings } from "/src/core/storageHandler.js";
import { t } from "/src/core/i18n.js";

const UNSPLASH_STORAGE_KEY = "provider_state:unsplash";

/**
 * Cấu hình Cloudflare Worker cho Unsplash.
 * Thay thế URL bên dưới bằng URL Worker của bạn sau khi deploy (theo hướng dẫn tại temp/unsplash-proxy/README.md).
 */
export const UNSPLASH_WORKER_URL = "https://ymbproxy.mmbell.workers.dev";
export const UNSPLASH_CLIENT_TOKEN = "AnhBinhDepZai";

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
 * Báo cáo lượt tải về Unsplash theo chính sách API (Unsplash Download Tracking).
 * @param {string} downloadLocationUrl
 */
export async function trackUnsplashDownload(downloadLocationUrl) {
  if (!downloadLocationUrl) return;
  try {
    const endpoint = `${UNSPLASH_WORKER_URL}/api/unsplash/track?url=${encodeURIComponent(downloadLocationUrl)}`;
    await fetch(endpoint, {
      headers: {
        "x-yumebako-token": UNSPLASH_CLIENT_TOKEN,
      },
    });
  } catch (err) {
    console.warn("[unsplashAPI] Failed to report download tracking:", err);
  }
}

/**
 * Tải danh sách ảnh Unsplash từ Cloudflare Worker Proxy.
 * Đọc tham số query, topics, orientation từ unsplashConfig.
 *
 * @returns {Promise<Array>} Danh sách bản ghi ảnh Unsplash đã được chuẩn hóa.
 */
export async function fetchUnsplashQueue() {
  try {
    const settings = getSettings();
    const config = settings.unsplashConfig || {};

    const params = new URLSearchParams({
      count: "30",
      orientation: config.orientation || "landscape",
    });

    if (config.query && config.query.trim()) {
      params.set("query", config.query.trim());
    }
    if (config.topic && config.topic !== "all") {
      params.set("topics", config.topic);
    }

    const url = `${UNSPLASH_WORKER_URL}/api/unsplash/random?${params.toString()}`;
    const response = await fetch(url, {
      headers: {
        "x-yumebako-token": UNSPLASH_CLIENT_TOKEN,
      },
    });

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new Error(t("sp.api.unsplash.access_denied", "Không có quyền truy cập Unsplash"));
      }
      if (response.status === 429) {
        throw new Error(t("sp.api.unsplash.rate_limit", "Vượt quá giới hạn lượt gọi Unsplash"));
      }
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const json = await response.json();
    return Array.isArray(json) ? json : [json];
  } catch (error) {
    console.error("[unsplashAPI] Error fetching unsplash queue:", error);
    throw error;
  }
}

export async function clearUnsplashQueue() {
  let storeData = (await getFromStore(UNSPLASH_STORAGE_KEY)) || {
    queue: [],
    applied: null,
  };
  storeData.queue = [];
  await saveToStore(UNSPLASH_STORAGE_KEY, storeData);
}

export async function getUnsplashData(refresh = false) {
  try {
    let storeData = (await getFromStore(UNSPLASH_STORAGE_KEY)) || {
      queue: [],
      applied: null,
    };
    if (!storeData.queue) storeData.queue = [];

    if (!refresh && storeData.applied) {
      if (
        !storeData.applied.blob ||
        !(storeData.applied.blob instanceof Blob)
      ) {
        const blob = await fetchImageBlob(storeData.applied.image);
        if (!blob) {
          return {
            error: t("sp.api.unsplash.corrupted_data", "Dữ liệu bị hỏng"),
          };
        }
        storeData.applied.blob = blob;
        await saveToStore(UNSPLASH_STORAGE_KEY, storeData);
      }
      return storeData.applied;
    }

    if (storeData.queue.length === 0) {
      try {
        storeData.queue = await fetchUnsplashQueue();
        storeData.queue_total = storeData.queue.length;
      } catch (err) {
        return { error: err.message };
      }
    }

    if (storeData.queue.length === 0) {
      return {
        error: t(
          "sp.api.unsplash.no_result",
          "Không tìm thấy kết quả từ Unsplash.",
        ),
      };
    }

    const nextItem = storeData.queue.shift();
    if (!nextItem || !nextItem.urls || (!nextItem.urls.regular && !nextItem.urls.full)) {
      return { error: t("sp.api.unsplash.corrupted_data", "Dữ liệu bị hỏng") };
    }

    const imageUrl = nextItem.urls.full || nextItem.urls.regular;
    const blob = await fetchImageBlob(imageUrl);
    if (!blob) {
      return { error: t("sp.api.error", "Lỗi tải ảnh từ Unsplash") };
    }

    storeData.applied = {
      image: imageUrl,
      blob: blob,
      source: nextItem.links?.html || "https://unsplash.com",
      width: nextItem.width,
      height: nextItem.height,
      size: blob.size,
      last_updated: Date.now(),
      category: "Unsplash",
      author_name: nextItem.user?.name || "Unknown",
      author_url: nextItem.user?.link || nextItem.user?.links?.html,
      description: nextItem.description || "",
      download_location: nextItem.links?.download_location || "",
      queue_left: storeData.queue.length,
      queue_total: storeData.queue_total || 30,
    };

    await saveToStore(UNSPLASH_STORAGE_KEY, storeData);

    // Kích hoạt download tracking
    if (storeData.applied.download_location) {
      trackUnsplashDownload(storeData.applied.download_location);
    }

    return storeData.applied;
  } catch (error) {
    console.error("[unsplashAPI] Error in getUnsplashData:", error);
    return { error: t("sp.api.error", "Lỗi tải ảnh từ Unsplash") };
  }
}
