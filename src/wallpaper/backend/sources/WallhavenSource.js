import { RemoteSource } from "./RemoteSource.js";
import {
  fetchWallhavenQueue,
  clearWallhavenQueue,
} from "/src/wallpaper/backend/sources/api/wallhavenAPI.js";
import { getFromStore, saveToStore } from "/src/core/db.js";
import { getSettings } from "/src/core/storageHandler.js";
import { t } from "/src/core/i18n.js";
import {
  formatResolution,
  getResolutionBadge,
  formatFileSize,
  formatNumber,
} from "./cardMeta.js";

/**
 * WallhavenSource.js
 * ---------------------------------------------------------------------------
 * Switcher source that queries the Wallhaven API using the user's saved
 * filters (`wallhavenConfig`).
 *
 * A single API call returns a batch of wallpapers kept in `provider_state:wallhaven`;
 * the carousel materializes them one at a time on `fetchMore()`, refilling when empty.
 */
export class WallhavenSource extends RemoteSource {
  static id = "wallhaven";
  static label = "Wallhaven";
  static providerId = "wallhaven";
  static storageKey = "provider_state:wallhaven";

  /** Categories, purity, sorting and query all live in provider settings. */
  get hasProviderSettings() {
    return true;
  }

  /**
   * Reset pagination back to page 1 when starting a new browse session with
   * an empty persisted queue.
   * @returns {Promise<Array<Object>>}
   */
  async fetchItems() {
    const key = this.constructor.storageKey;
    const storeData = (await getFromStore(key)) || { queue: [], applied: null };
    if (!Array.isArray(storeData.queue) || storeData.queue.length === 0) {
      storeData.page = 1;
      storeData.last_page = null;
      storeData.queue_total = 0;
      await saveToStore(key, storeData);
    }
    return super.fetchItems();
  }

  /**
   * Take the next wallpaper off the persisted queue, refilling it if empty.
   * @returns {Promise<Object|null>}
   */
  async fetchItem() {
    const key = this.constructor.storageKey;
    const storeData = (await getFromStore(key)) || { queue: [], applied: null };
    const queue = Array.isArray(storeData.queue) ? storeData.queue : [];
    storeData.queue = queue;

    if (queue.length === 0) {
      const page = Math.max(1, Number(storeData.page) || 1);
      const lastPage = Number(storeData.last_page) || 0;

      if (lastPage > 0 && page > lastPage) {
        storeData.queue_total = 0;
        await saveToStore(key, storeData);
        return null;
      }

      const batch = await fetchWallhavenQueue({ strict: true, page });
      const meta = batch?.meta || {};
      const items = Array.isArray(batch) ? [...batch] : [];
      const perPage = Number(meta.per_page) || items.length || 24;
      const reportedLastPage = Number(meta.last_page) || 0;
      const isLastPage = items.length === 0 || items.length < perPage;

      storeData.page = page + 1;
      storeData.last_page = reportedLastPage || (isLastPage ? page : 0);
      storeData.queue_total = items.length;

      if (items.length === 0) {
        await saveToStore(key, storeData);
        return null;
      }

      queue.push(...items);
      storeData.queue_total = queue.length;
    }

    const entry = queue.shift();
    if (!entry?.path) return null;

    storeData.queue = queue;
    await saveToStore(key, storeData);

    const appliedQuery =
      entry.query !== undefined
        ? entry.query
        : (getSettings()?.wallhavenConfig?.query || "").trim();

    return this.toCarouselItem(entry, {
      id: String(entry.id),
      url: entry.path,
      sourceUrl: entry.short_url || entry.path,
      title: `${entry.category || "wallhaven"} • ${entry.dimension_x}×${entry.dimension_y}`,
      category: entry.category || "wallhaven",
      thumbnailUrl: entry.thumbs?.large || entry.thumbs?.original || entry.path,
      width: entry.dimension_x || 0,
      height: entry.dimension_y || 0,
      size: entry.file_size || 0,
      views: entry.views,
      favorites: entry.favorites,
      query: appliedQuery,
      raw: entry,
    });
  }

  /**
   * Clear the cached Wallhaven queue and reset pagination.
   * @returns {Promise<void>}
   */
  async clearCache() {
    await clearWallhavenQueue();
  }

  // ─── Pure Structured Metadata ─────────────────────────────────────────────

  /**
   * Return pure structured summary metadata for a Wallhaven card (zero HTML).
   * @param {Object} card
   * @returns {import("./BaseSource.js").MetaData|null}
   */
  getMetaData(card) {
    if (!card) return null;
    const cardQuery = card.query !== undefined ? card.query : card.raw?.query;
    const query =
      typeof cardQuery === "string"
        ? cardQuery.trim()
        : (getSettings()?.wallhavenConfig?.query || "").trim();
    const queryLabel = query || t("sp.meta.random", "Ngẫu nhiên");
    const badge = getResolutionBadge(card.width, card.height);
    const resolution = formatResolution(card.width, card.height);
    const size = formatFileSize(card.size);

    const segments = [{ type: "text", text: queryLabel }];
    if (badge) {
      segments.push({ type: "badge", text: badge });
    }

    return { segments, badge, resolution, size };
  }

  /**
   * Return pure structured detail rows for a Wallhaven card (zero HTML).
   * @param {Object} card
   * @returns {import("./BaseSource.js").MetaDetailRow[]}
   */
  getMetaDetails(card) {
    if (!card) return [];
    const details = [];

    const cardQuery = card.query !== undefined ? card.query : card.raw?.query;
    const query =
      typeof cardQuery === "string"
        ? cardQuery.trim()
        : (getSettings()?.wallhavenConfig?.query || "").trim();
    details.push({
      kind: "text",
      key: "query",
      label: t("sp.meta.query", "Từ khóa"),
      value: query || t("sp.meta.random", "Ngẫu nhiên"),
    });

    const category = card.category || card.raw?.category;
    if (category) {
      const catKey = `sp.api.wallhaven.cat_${category.toLowerCase()}`;
      details.push({
        kind: "text",
        key: "category",
        label: t("sp.meta.category", "Phân loại"),
        value: t(catKey, category),
      });
    }

    const badge = getResolutionBadge(card.width, card.height);
    const res = formatResolution(card.width, card.height);
    if (res) {
      details.push({
        kind: "resolution",
        key: "resolution",
        label: t("sp.meta.resolution", "Độ phân giải"),
        value: res,
        ...(badge ? { badge } : {}),
      });
    }

    const size = formatFileSize(card.size);
    if (size) {
      details.push({
        kind: "text",
        key: "filesize",
        label: t("sp.meta.filesize", "Dung lượng"),
        value: size,
      });
    }

    const favs = card.favorites ?? card.raw?.favorites;
    const views = card.views ?? card.raw?.views;
    if (favs !== undefined || views !== undefined) {
      const items = [];
      if (favs !== undefined) {
        items.push({
          metric: "favorites",
          icon: "heart",
          value: formatNumber(favs),
        });
      }
      if (views !== undefined) {
        items.push({
          metric: "views",
          icon: "eye",
          value: formatNumber(views),
        });
      }
      if (items.length > 0) {
        details.push({
          kind: "stats",
          key: "stats",
          label: t("sp.meta.favorites", "Yêu thích"),
          items,
        });
      }
    }

    details.push({
      kind: "text",
      key: "source",
      label: t("sp.meta.source", "Nguồn ảnh"),
      value: "Wallhaven",
    });

    return details;
  }

  /**
   * Title of the wallpaper restored from its persisted `applied` record.
   * @param {Object} applied
   * @returns {string}
   */
  getSeedTitle(applied) {
    return applied.category ? `wallhaven • ${applied.category}` : "wallhaven";
  }
}
