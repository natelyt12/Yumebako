import { RemoteSource } from "./RemoteSource.js";
import { fetchWallhavenQueue } from "/src/wallpaper/backend/sources/api/wallhavenAPI.js";
import { getFromStore, saveToStore } from "/src/core/db.js";
import { getSettings } from "/src/core/storageHandler.js";
import { t } from "/src/core/i18n.js";
import {
  formatResolution,
  getResolutionBadge,
  formatFileSize,
  formatNumber,
  escapeHtml,
} from "./cardMeta.js";

/**
 * WallhavenSource.js
 * ---------------------------------------------------------------------------
 * Switcher source that queries the Wallhaven API using the user's saved
 * filters (`wallhavenConfig`).
 *
 * A single API call returns a batch of wallpapers that is kept in the app's
 * `data:wallhaven` queue; the carousel then materializes them one at a time as
 * the user reaches the trailing "+" card, refilling the queue when it runs dry.
 *
 * An unreachable API raises instead of yielding an empty batch, so the item can
 * report a retryable error rather than retiring itself as "nothing left".
 */
export class WallhavenSource extends RemoteSource {
  static id = "wallhaven";
  static label = "Wallhaven";
  static providerId = "wallhaven";
  static storageKey = "provider_state:wallhaven";

  /** Categories, purity, sorting and query all live in Settings. */
  get hasProviderSettings() {
    return true;
  }

  /**
   * A new feed window (app start, source switch, settings reload) starts a new
   * Wallhaven browse session, so pagination restarts from page 1 when the
   * persisted queue has no leftovers.
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

  /** Take the next wallpaper off the persisted queue, refilling it if empty. */
  async fetchItem() {
    const key = this.constructor.storageKey;
    const storeData = (await getFromStore(key)) || { queue: [], applied: null };
    const queue = Array.isArray(storeData.queue) ? storeData.queue : [];
    storeData.queue = queue;

    if (queue.length === 0) {
      const page = Math.max(1, Number(storeData.page) || 1);
      const lastPage = Number(storeData.last_page) || 0;

      // The last batch already was the final page of the result set. This is
      // what makes a Wallhaven query with fewer images than `per_page` (e.g.
      // `total: 5, per_page: 24`) end instead of refetching page 1 forever.
      if (lastPage > 0 && page > lastPage) {
        storeData.queue_total = 0;
        await saveToStore(key, storeData);
        return null;
      }

      // Strict on purpose: a network failure must surface as an error the
      // user can retry, never as "this feed has nothing left".
      const batch = await fetchWallhavenQueue({ strict: true, page });
      const meta = batch?.meta || {};
      const items = Array.isArray(batch) ? [...batch] : [];
      const perPage = Number(meta.per_page) || items.length || 24;
      const reportedLastPage = Number(meta.last_page) || 0;

      // A short or empty page is the end of the feed even if the API did not
      // report `last_page` (both are treated as "no further pages").
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

  // ─── Chip Info (Collapsed & Hover Expand) ─────────────────────────────────

  getChipSummary(card) {
    if (!card) return "";
    const cardQuery = card.query !== undefined ? card.query : card.raw?.query;
    const query =
      typeof cardQuery === "string"
        ? cardQuery.trim()
        : (getSettings()?.wallhavenConfig?.query || "").trim();
    const queryLabel = query || t("sp.meta.random", "Ngẫu nhiên");
    const badge = getResolutionBadge(card.width, card.height);

    const parts = [`<span>${escapeHtml(queryLabel)}</span>`];

    if (badge) {
      parts.push(`<span class="meta_badge">${escapeHtml(badge)}</span>`);
    }

    return parts.join('<span class="card-meta-sep">•</span>');
  }

  getChipDetails(card) {
    if (!card) return [];
    const details = [];

    const cardQuery = card.query !== undefined ? card.query : card.raw?.query;
    const query =
      typeof cardQuery === "string"
        ? cardQuery.trim()
        : (getSettings()?.wallhavenConfig?.query || "").trim();
    details.push({
      label: t("sp.meta.query", "Từ khóa"),
      value: query || t("sp.meta.random", "Ngẫu nhiên"),
    });

    const category = card.category || card.raw?.category;
    if (category) {
      const catKey = `sp.api.wallhaven.cat_${category.toLowerCase()}`;
      details.push({
        label: t("sp.meta.category", "Phân loại"),
        value: t(catKey, category),
      });
    }

    const badge = getResolutionBadge(card.width, card.height);
    const res = formatResolution(card.width, card.height);
    if (res) {
      const badgeHtml = badge
        ? ` <span class="meta_badge">${escapeHtml(badge)}</span>`
        : "";
      details.push({
        label: t("sp.meta.resolution", "Độ phân giải"),
        value: `${escapeHtml(res)}${badgeHtml}`,
        html: true,
      });
    }

    const size = formatFileSize(card.size);
    if (size) {
      details.push({
        label: t("sp.meta.filesize", "Dung lượng"),
        value: size,
      });
    }

    const favs = card.favorites ?? card.raw?.favorites;
    const views = card.views ?? card.raw?.views;
    if (favs !== undefined || views !== undefined) {
      const stats = [];
      if (favs !== undefined) {
        stats.push(
          `<span class="meta_stat_item"><i data-icon="heart"></i> <span>${escapeHtml(formatNumber(favs))}</span></span>`,
        );
      }
      if (views !== undefined) {
        stats.push(
          `<span class="meta_stat_item"><i data-icon="eye"></i> <span>${escapeHtml(formatNumber(views))}</span></span>`,
        );
      }
      details.push({
        label: t("sp.meta.favorites", "Yêu thích"),
        value: stats.join(""),
        html: true,
      });
    }

    details.push({
      label: t("sp.meta.source", "Nguồn ảnh"),
      value: "Wallhaven",
    });

    return details;
  }

  /** Title of the wallpaper restored from its persisted `current` record. */
  getSeedTitle(applied) {
    return applied.category ? `wallhaven • ${applied.category}` : "wallhaven";
  }
}
