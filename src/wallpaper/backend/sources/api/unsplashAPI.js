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

/**
 * Report an Unsplash download event per API guidelines (Unsplash Download Tracking).
 * @param {string} downloadLocationUrl
 * @returns {Promise<void>}
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

/** UTM params Unsplash requires on every link back to their site. */
export const UNSPLASH_UTM = "utm_source=yumebako&utm_medium=referral";

/**
 * Append the Unsplash UTM params to a URL (profile / photo page / homepage).
 * @param {string} url
 * @returns {string}
 */
export function withUnsplashUtm(url) {
  if (!url) return "";
  return `${url}${url.includes("?") ? "&" : "?"}${UNSPLASH_UTM}`;
}

/* ── At-most-once tracking ──────────────────────────────────────────────────
   Keys are the Unsplash photo id (`raw.id`, or the card id for seed/collection
   copies) so the same photo is never reported twice, no matter how many card
   instances exist. Persisted alongside the Unsplash provider state. */

const TRACKED_LIMIT = 1000;
const trackedIds = new Set();
let trackedLoaded = false;
let trackedLoadPromise = null;
let trackedPersistTimer = null;

async function ensureTrackedLoaded() {
  if (trackedLoaded) return;
  if (!trackedLoadPromise) {
    trackedLoadPromise = (async () => {
      try {
        const storeData = (await getFromStore(UNSPLASH_STORAGE_KEY)) || {};
        if (Array.isArray(storeData.trackedIds)) {
          storeData.trackedIds.forEach((id) => trackedIds.add(String(id)));
        }
      } catch (err) {
        console.warn("[unsplashAPI] Failed to load tracked ids:", err);
      } finally {
        trackedLoaded = true;
      }
    })();
  }
  await trackedLoadPromise;
}

function scheduleTrackedPersist() {
  if (trackedPersistTimer) return;
  trackedPersistTimer = setTimeout(async () => {
    trackedPersistTimer = null;
    try {
      // Keep storage bounded: drop the oldest keys beyond the cap.
      while (trackedIds.size > TRACKED_LIMIT) {
        trackedIds.delete(trackedIds.values().next().value);
      }
      const storeData = (await getFromStore(UNSPLASH_STORAGE_KEY)) || {};
      storeData.trackedIds = [...trackedIds];
      await saveToStore(UNSPLASH_STORAGE_KEY, storeData);
    } catch (err) {
      console.warn("[unsplashAPI] Failed to persist tracked ids:", err);
    }
  }, 600);
}

/**
 * Report a real Unsplash "use" (download / apply / save) **at most once** per photo.
 *
 * Unsplash only needs to know the photo was used once; re-sending while the user
 * browses or re-applies would inflate their counts and burn our rate limit. The
 * id is recorded synchronously (before the request) so rapid clicks cannot slip
 * a second call through the async gap.
 *
 * Safe for any source: cards without a `trackUrl` (everything but Unsplash) are
 * ignored.
 *
 * @param {Object} card
 */
export async function trackDownloadOnce(card) {
  if (!card) return;
  const trackUrl = card.trackUrl || card.raw?.links?.download_location;
  if (!trackUrl) return;

  const key = String(card.raw?.id ?? card.id ?? trackUrl);
  if (card.downloadTracked) return;

  await ensureTrackedLoaded();
  if (trackedIds.has(key)) {
    card.downloadTracked = true;
    return;
  }

  card.downloadTracked = true;
  trackedIds.add(key);
  scheduleTrackedPersist();

  await trackUnsplashDownload(trackUrl);
}

/**
 * Fetch a batch of curated Unsplash photos from the Cloudflare Worker proxy.
 * Reads `query`, `topic`, and `orientation` from `unsplashConfig`.
 *
 * @returns {Promise<Array>} Normalized Unsplash photo records.
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
        throw new Error(
          t(
            "sp.api.unsplash.access_denied",
            "Không có quyền truy cập Unsplash",
          ),
        );
      }
      if (response.status === 429) {
        throw new Error(
          t(
            "sp.api.unsplash.rate_limit",
            "Vượt quá giới hạn lượt gọi Unsplash",
          ),
        );
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

/**
 * Clear the persisted Unsplash photo queue so the next fetch queries fresh results.
 * @returns {Promise<void>}
 */
export async function clearUnsplashQueue() {
  let storeData = (await getFromStore(UNSPLASH_STORAGE_KEY)) || {
    queue: [],
    applied: null,
  };
  storeData.queue = [];
  await saveToStore(UNSPLASH_STORAGE_KEY, storeData);
}
