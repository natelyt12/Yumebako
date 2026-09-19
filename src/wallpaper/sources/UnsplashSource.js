import { RemoteSource } from "./RemoteSource.js";
import { fetchUnsplashQueue } from "/src/wallpaper/sources/api/unsplashAPI.js";
import { getFromStore, saveToStore } from "/src/core/db.js";
import { getSettings } from "/src/core/storageHandler.js";
import { t } from "/src/core/i18n.js";

/**
 * UnsplashSource.js
 * ---------------------------------------------------------------------------
 * Switcher source for Unsplash. Requires an Access Key, configured in the
 * Debug tab (`unsplashApiKey`).
 *
 * Like Wallhaven it keeps the batch returned by one API call in the app's
 * `data:unsplash` queue and materializes items one at a time.
 */
export class UnsplashSource extends RemoteSource {
  static id = "unsplash";
  static label = "Unsplash";
  static providerId = "unsplash";
  static storageKey = "data:unsplash";

  /** The Access Key is entered in the Debug tab, so there is something to open. */
  get hasProviderSettings() {
    return true;
  }

  /** Take the next photo off the persisted queue, refilling it if empty. */
  async fetchItem() {
    const apiKey = getSettings().unsplashApiKey;
    if (!apiKey) {
      throw new Error(
        t(
          "sp.api.unsplash.no_key",
          "Vui lòng nhập Access Key trong tab Debug.",
        ),
      );
    }

    const key = this.constructor.storageKey;
    const storeData = (await getFromStore(key)) || { queue: [], current: null };
    const queue = Array.isArray(storeData.queue) ? storeData.queue : [];

    if (queue.length === 0) {
      queue.push(...(await fetchUnsplashQueue(apiKey)));
      storeData.queue_total = queue.length;
    }

    const entry = queue.shift();
    if (!entry?.urls?.regular) return null;

    storeData.queue = queue;
    await saveToStore(key, storeData);

    return this.toCarouselItem(entry, {
      id: String(entry.id),
      url: entry.urls.full || entry.urls.regular,
      sourceUrl: entry.links?.html || "https://unsplash.com",
      title: entry.user?.name ? `Unsplash • ${entry.user.name}` : "Unsplash",
      category: "Unsplash",
      thumbnailUrl: entry.urls.small || entry.urls.regular,
      trackUrl: entry.links?.download_location || "",
      width: entry.width || 0,
      height: entry.height || 0,
      size: 0,
    });
  }

  /** Unsplash is unusable until an Access Key is configured in the Debug tab. */
  get isAvailable() {
    return Boolean(getSettings().unsplashApiKey);
  }

  /**
   * Unsplash's API guidelines require hitting the download endpoint whenever
   * a photo is used, otherwise the account can be rate-limited.
   */
  async apply(item, options) {
    await super.apply(item, options);

    const apiKey = getSettings().unsplashApiKey;
    if (item.trackUrl && apiKey) {
      fetch(`${item.trackUrl}&client_id=${apiKey}`).catch(() => {});
    }
  }
}
