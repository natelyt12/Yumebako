import { BaseSource } from "./BaseSource.js";
import { SOURCE_ACTIONS } from "./sourceActions.js";
import { getFromStore, saveToStore } from "/src/core/db.js";
import {
  getSettings,
  getDefaultWallpaperEffects,
} from "/src/core/storageHandler.js";
import { generateImageThumbnail } from "/src/wallpaper/backend/data/thumbnailGenerator.js";
import {
  NetworkError,
  isNetworkError,
} from "/src/wallpaper/backend/data/errors.js";
import { t } from "/src/core/i18n.js";

/**
 * Resolve once the browser has the image decoded (and ready to paint), or
 * `false` when it never arrived — offline, DNS, a 404, or a dead blob URL.
 *
 * `decode()` rejects on failure; a CSS `background-image` fires no event at
 * all, so this is the only way to distinguish "loading" from "broken" before
 * handing the item to the carousel.
 *
 * @param {string} url
 * @returns {Promise<boolean>}
 */
function preloadImage(url) {
  return new Promise((resolve) => {
    const img = new Image();
    img.src = url;
    if (typeof img.decode === "function") {
      img
        .decode()
        .then(() => resolve(true))
        .catch(() => resolve(false));
    } else {
      img.onload = () => resolve(true);
      img.onerror = () => resolve(false);
    }
  });
}

/**
 * RemoteSource.js
 * ---------------------------------------------------------------------------
 * Base adapter for online wallpaper providers (Wallhaven, Picre, Unsplash, Bing).
 *
 * Implements the Single-Phase Pipeline:
 *   1. Fetch image metadata from the provider API (`fetchItem`).
 *   2. Download the full-size image once and store its Blob in `mediaData` (`media:orig:${id}`).
 *   3. Generate a 16:9 thumbnail and store it in `mediaData` (`media:thumb:${id}`).
 *   4. Hand the completed card with a live thumbnail Object URL to DataControl.
 *   5. Build a pure render payload (`getRenderPayload`) from RAM/DB on apply.
 */
export class RemoteSource extends BaseSource {
  static providerId = "";
  static storageKey = "";
  // Số lượng ảnh gốc tối đa giữ sẵn trong RAM cache để đổi/tải nhanh.
  static maxCachedBlobs = 6;
  // Số thẻ tối đa giữ trong cửa sổ lịch sử của nguồn ảnh online.
  static maxCards = 20;

  constructor() {
    super();
    /** @type {Map<string, Blob>} In-memory full-size Blob cache for instant apply/download. */
    this.blobCache = new Map();
    /** @type {Map<string, string>} Card id -> locally generated thumbnail Object URL. */
    this.thumbCache = new Map();
  }

  /** @returns {string} */
  get providerId() {
    return this.constructor.providerId || this.id;
  }

  /** @returns {Array<Object>} */
  get actions() {
    return [
      SOURCE_ACTIONS.download,
      SOURCE_ACTIONS.source,
      SOURCE_ACTIONS.removeFromCarousel,
      SOURCE_ACTIONS.add,
    ];
  }

  /** @returns {boolean} */
  get canGrow() {
    return true;
  }

  /** @returns {string} */
  get moreLabel() {
    return t("wallpaper_switcher.get_new_image", "Lấy ảnh mới");
  }

  // ─── Single-Phase Card Production ─────────────────────────────────────────

  /**
   * Initialize the source card list from the persisted seed item or fetch one fresh card.
   * @returns {Promise<Array<Object>>}
   */
  async fetchItems() {
    this._releaseAllThumbs();
    this.blobCache.clear();

    const item = (await this.fetchSeedItem()) || (await this.fetchNext());
    return item ? [item] : [];
  }

  /**
   * Fetch one additional card when the user requests more items.
   * @returns {Promise<Array<Object>|null>}
   */
  async fetchMore() {
    if (this.isLoading) return null;
    this.isLoading = true;
    try {
      const item = await this.fetchNext();
      return item ? [item] : [];
    } finally {
      this.isLoading = false;
    }
  }

  /**
   * Restore the last applied wallpaper as a seed card if recorded in IndexedDB.
   * Migrates legacy inline `applied.blob` records into `media:orig:${id}` on read.
   * @returns {Promise<Object|null>}
   */
  async fetchSeedItem() {
    const key = this.constructor.storageKey;
    if (!key) return null;

    const applied = (await getFromStore(key))?.applied;
    if (!applied?.image) return null;

    const id = String(applied.id ?? applied.image);
    let blob =
      this.blobCache.get(id) ||
      (await getFromStore(`media:orig:${id}`, "mediaData"));

    // Legacy migration: copy inline `applied.blob` from `appData` to `mediaData`.
    if (!(blob instanceof Blob) && applied.blob instanceof Blob) {
      blob = applied.blob;
      await saveToStore(`media:orig:${id}`, blob, "mediaData");
    }

    if (!(blob instanceof Blob)) {
      blob = await this.getBlob({ id, url: applied.image });
    }

    if (blob instanceof Blob) {
      this._cacheBlob(id, blob);
    }

    const item = this.toCarouselItem(applied, {
      id,
      url: applied.image,
      sourceUrl: applied.source || "",
      title: this.getSeedTitle(applied),
      category: applied.category || "",
      thumbnailUrl: applied.image,
      mediaType: "image",
      width: applied.width || 0,
      height: applied.height || 0,
      size: applied.size || blob?.size || 0,
      addedAt: applied.last_updated || Date.now(),
    });

    await this.prepareThumb(item);
    return item;
  }

  /**
   * Build the fallback title for a restored seed card.
   * @param {Object} applied
   * @returns {string}
   */
  getSeedTitle(applied) {
    return applied.category || "";
  }

  /**
   * Fetch the next item and run it through the Single-Phase Pipeline.
   * @returns {Promise<Object|null>}
   */
  async fetchNext() {
    const item = await this.fetchItem();
    if (!item) return null;

    await this.processSinglePhasePipeline(item);
    return item;
  }

  /**
   * @abstract
   * Subclasses override this to pull one raw record from their provider API/queue.
   * @returns {Promise<Object|null>}
   */
  async fetchItem() {
    return null;
  }

  /**
   * Execute the Single-Phase Pipeline:
   * 1. Reuse or fetch the full-size image -> store in `mediaData` (`media:orig:${id}`).
   * 2. Reuse or generate a 16:9 thumbnail -> store in `mediaData` (`media:thumb:${id}`).
   * 3. Assign the live Object URL to `item.thumbnailUrl`.
   *
   * Throws when neither local media nor a reachable fallback URL exists so callers
   * report a fetch error instead of adding a broken blank card.
   *
   * @param {Object} item
   * @throws {import("../data/errors.js").NetworkError|Error}
   */
  async processSinglePhasePipeline(item) {
    if (!item?.id) return;

    let hasLocalMedia = false;
    let pipelineError = null;

    try {
      // 1. Resolve or fetch the full-size image Blob.
      let origBlob =
        this.blobCache.get(item.id) ||
        (await getFromStore(`media:orig:${item.id}`, "mediaData"));

      if (!(origBlob instanceof Blob) && item.url) {
        const response = await fetch(item.url, { mode: "cors" });
        if (!response.ok) {
          throw new Error(
            `HTTP ${response.status} while downloading image [${item.url}]`,
          );
        }
        origBlob = await response.blob();
        await saveToStore(`media:orig:${item.id}`, origBlob, "mediaData");
      }

      if (origBlob instanceof Blob) {
        this._cacheBlob(item.id, origBlob);
        if (!item.size) item.size = origBlob.size;

        // 2. Resolve or generate the 16:9 thumbnail Blob.
        let thumbBlob = await getFromStore(
          `media:thumb:${item.id}`,
          "mediaData",
        );
        if (!(thumbBlob instanceof Blob)) {
          thumbBlob = await generateImageThumbnail(origBlob).catch(() => null);
          if (thumbBlob instanceof Blob) {
            await saveToStore(`media:thumb:${item.id}`, thumbBlob, "mediaData");
          }
        }

        // 3. Create and register the thumbnail Object URL.
        const displayBlob = thumbBlob instanceof Blob ? thumbBlob : origBlob;
        const thumbUrl = this._createObjectUrl(displayBlob);
        if (thumbUrl) {
          hasLocalMedia = true;
          item.thumbnailUrl = thumbUrl;
          this._setThumbCache(item.id, thumbUrl);
        }
      }
    } catch (err) {
      pipelineError = err;
      console.warn(
        `[RemoteSource] Single-Phase Pipeline warning for [${item.id}]:`,
        err,
      );
    }

    const reachable = item.thumbnailUrl
      ? await preloadImage(item.thumbnailUrl)
      : false;

    if (!hasLocalMedia && !reachable) {
      if (pipelineError && !isNetworkError(pipelineError)) {
        throw pipelineError;
      }
      throw new NetworkError(pipelineError);
    }
  }

  // ─── Thumbnail & Cache Management ─────────────────────────────────────────

  /**
   * Ensure `item.thumbnailUrl` points to a valid live URL after load or reload.
   * @param {Object} item
   * @returns {Promise<string|null>}
   */
  async prepareThumb(item) {
    if (!item?.id) return null;

    // Discard dead blob: URLs persisted from an earlier browser session.
    if (
      typeof item.thumbnailUrl === "string" &&
      item.thumbnailUrl.startsWith("blob:") &&
      !this.thumbCache.has(item.id)
    ) {
      item.thumbnailUrl = null;
    }

    // 1. Live Object URL already cached in RAM.
    if (this.thumbCache.has(item.id)) {
      item.thumbnailUrl = this.thumbCache.get(item.id);
      return item.thumbnailUrl;
    }

    // 2. Thumbnail Blob persisted in IndexedDB.
    const thumbBlob = await getFromStore(`media:thumb:${item.id}`, "mediaData");
    if (thumbBlob instanceof Blob) {
      const url = this._createObjectUrl(thumbBlob);
      item.thumbnailUrl = url;
      this._setThumbCache(item.id, url);
      return url;
    }

    // 3. Regenerate thumbnail from persisted full-size Blob if available.
    const origBlob = await getFromStore(`media:orig:${item.id}`, "mediaData");
    if (origBlob instanceof Blob) {
      const newThumbBlob = await generateImageThumbnail(origBlob).catch(
        () => null,
      );
      if (newThumbBlob instanceof Blob) {
        await saveToStore(`media:thumb:${item.id}`, newThumbBlob, "mediaData");
        const url = this._createObjectUrl(newThumbBlob);
        item.thumbnailUrl = url;
        this._setThumbCache(item.id, url);
        return url;
      }
    }

    // 4. Fallback to remote non-blob URL.
    if (item.url && !item.url.startsWith("blob:")) {
      item.thumbnailUrl = item.url;
      return item.url;
    }

    return null;
  }

  /**
   * Release a cached thumbnail Object URL for `itemId`.
   * @param {string|number} itemId
   */
  releaseThumb(itemId) {
    if (itemId === undefined || itemId === null) return;
    this._releaseThumb(String(itemId));
  }

  /**
   * Resolve the full-size media Blob (RAM -> IndexedDB -> network fetch).
   * @param {Object} item
   * @returns {Promise<Blob|null>}
   */
  async getBlob(item) {
    if (!item?.id) return null;
    if (this.blobCache.has(item.id)) return this.blobCache.get(item.id);

    const stored = await getFromStore(`media:orig:${item.id}`, "mediaData");
    if (stored instanceof Blob) return this._cacheBlob(item.id, stored);

    if (!item.url) return null;

    const response = await fetch(item.url, { mode: "cors" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const blob = await response.blob();
    await saveToStore(`media:orig:${item.id}`, blob, "mediaData");
    return this._cacheBlob(item.id, blob);
  }

  /**
   * Release RAM/Object URL caches when an item is deleted from the window.
   * @param {Object} item
   * @returns {Promise<void>}
   */
  async deleteItem(item) {
    if (!item?.id) return;
    this.releaseItem(item.id);
  }

  /**
   * Release both Blob and thumbnail caches for `id`.
   * @param {string} id
   */
  releaseItem(id) {
    this.blobCache.delete(id);
    this._releaseThumb(id);
  }

  /**
   * Store a thumbnail Object URL, revoking any superseded URL for `id`.
   * @param {string} id
   * @param {string} url
   * @protected
   */
  _setThumbCache(id, url) {
    const prev = this.thumbCache.get(id);
    if (prev && prev !== url) {
      URL.revokeObjectURL(prev);
      this._objectUrls.delete(prev);
    }
    this.thumbCache.set(id, url);
  }

  /**
   * Revoke cached thumbnail URLs whose IDs are not present in `activeIds`.
   * @param {Set<string>} activeIds
   * @protected
   */
  _releaseUnusedThumbs(activeIds) {
    for (const [id, url] of this.thumbCache.entries()) {
      if (activeIds.has(String(id))) continue;
      URL.revokeObjectURL(url);
      this._objectUrls.delete(url);
      this.thumbCache.delete(id);
    }
  }

  /**
   * Revoke and delete a single cached thumbnail Object URL.
   * @param {string} id
   * @protected
   */
  _releaseThumb(id) {
    const url = this.thumbCache.get(id);
    if (!url) return;
    URL.revokeObjectURL(url);
    this._objectUrls.delete(url);
    this.thumbCache.delete(id);
  }

  /**
   * Revoke all cached thumbnail Object URLs owned by this source.
   * @protected
   */
  _releaseAllThumbs() {
    this.thumbCache.forEach((url) => {
      URL.revokeObjectURL(url);
      this._objectUrls.delete(url);
    });
    this.thumbCache.clear();
  }

  /**
   * Insert a Blob into the bounded LRU-like RAM cache.
   * @param {string} id
   * @param {Blob} blob
   * @returns {Blob}
   * @protected
   */
  _cacheBlob(id, blob) {
    this.blobCache.set(id, blob);
    while (this.blobCache.size > this.constructor.maxCachedBlobs) {
      this.blobCache.delete(this.blobCache.keys().next().value);
    }
    return blob;
  }

  // ─── Render Payload & Persistence ─────────────────────────────────────────

  /**
   * Return whether `item` matches the currently active desktop wallpaper.
   * @param {Object} item
   * @returns {boolean}
   */
  isActive(item) {
    const config = getSettings().wallpaperConfig || {};
    return (
      config.source === this.providerId && config.activeWallpaperId === item.id
    );
  }

  /**
   * Build a pure render payload (`{ id, blob, type, effects, credit, ... }`)
   * without touching the DOM or WallpaperRenderer.
   *
   * @param {Object} item
   * @returns {Promise<Object|null>}
   */
  async getRenderPayload(item) {
    if (!item) return null;
    const blob = await this.getBlob(item);
    if (!blob) {
      throw new Error(
        t("wallpaper_switcher.error.no_url", "Không tìm thấy dữ liệu ảnh."),
      );
    }

    const payload = this.buildPayload(item, blob);
    payload.credit = this.getAttribution(item);
    return payload;
  }

  /**
   * Persist applied wallpaper metadata once the renderer commits the payload.
   * @param {Object} _item
   * @param {Object} payload
   * @returns {Promise<void>}
   */
  async onApplied(_item, payload) {
    if (!payload) return;
    try {
      await this.persistApplied(payload);
    } catch (error) {
      console.error(`[${this.id}] Failed to persist current wallpaper:`, error);
    }
  }

  /**
   * Clear the persisted `applied` entry in this source's provider state store.
   * @returns {Promise<void>}
   */
  async clearApplied() {
    const key = this.constructor.storageKey;
    if (!key) return;
    const storeData = await getFromStore(key);
    if (storeData && storeData.applied) {
      storeData.applied = null;
      await saveToStore(key, storeData);
    }
  }

  /**
   * Assemble a render payload from a card item and its resolved Blob.
   * @param {Object} item
   * @param {Blob} blob
   * @returns {Object}
   */
  buildPayload(item, blob) {
    return {
      id: item.id,
      blob,
      type: item.mediaType === "video" ? "video" : "image",
      image: item.url,
      source: item.sourceUrl,
      width: item.width,
      height: item.height,
      size: blob.size,
      category: item.category,
      effects: item.effects || getDefaultWallpaperEffects(),
      metadata: {
        provider: this.providerId,
        providerName: this.name,
        source: item.sourceUrl,
        url: item.url,
      },
    };
  }

  /**
   * Persist lightweight metadata for the applied wallpaper in `appData`
   * without duplicating the full-size `Blob` (which lives in `mediaData`).
   *
   * @param {Object} payload
   * @returns {Promise<void>}
   */
  async persistApplied(payload) {
    const key = this.constructor.storageKey;
    if (!key) return;

    const storeData = (await getFromStore(key)) || { queue: [], applied: null };
    storeData.applied = {
      id: payload.id,
      image: payload.image,
      source: payload.source,
      width: payload.width,
      height: payload.height,
      size: payload.size,
      category: payload.category,
      last_updated: Date.now(),
      queue_left: Array.isArray(storeData.queue) ? storeData.queue.length : 0,
      queue_total: storeData.queue_total,
    };
    await saveToStore(key, storeData);
  }
}
