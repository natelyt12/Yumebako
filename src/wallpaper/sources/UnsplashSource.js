import { RemoteSource } from "./RemoteSource.js";
import { fetchUnsplashQueue } from "/src/wallpaper/sources/api/unsplashAPI.js";
import { getFromStore, saveToStore } from "/src/core/db.js";
import { getSettings } from "/src/core/storageHandler.js";
import { t } from "/src/core/i18n.js";
import {
  formatResolution,
  getResolutionBadge,
  formatFileSize,
  escapeHtml,
} from "./cardMeta.js";

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
  static storageKey = "provider_state:unsplash";

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
    const storeData = (await getFromStore(key)) || { queue: [], applied: null };
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
      user: entry.user ? {
        name: entry.user.name || "",
        username: entry.user.username || "",
        link: entry.user.links?.html || "",
      } : null,
      location: entry.location?.name || entry.user?.location || "",
      raw: entry,
    });
  }

  // ─── Chip Info (Collapsed & Hover Expand) ─────────────────────────────────

  getChipSummary(card) {
    if (!card) return "";
    const authorName = card.user?.name || (card.title?.startsWith("Unsplash • ") ? card.title.slice(11) : "");
    const photoByPrefix = t("sp.meta.photo_by", "Photo by");
    const badge = getResolutionBadge(card.width, card.height);

    const parts = [];
    if (authorName) {
      parts.push(`<span>${escapeHtml(photoByPrefix)} <strong>${escapeHtml(authorName)}</strong></span>`);
    } else {
      parts.push(`<span>Unsplash</span>`);
    }

    if (badge) {
      parts.push(`<span class="meta_badge">${escapeHtml(badge)}</span>`);
    }

    return parts.join('<span class="card-meta-sep">•</span>');
  }

  getChipDetails(card) {
    if (!card) return [];
    const details = [];

    const authorName = card.user?.name || (card.title?.startsWith("Unsplash • ") ? card.title.slice(11) : "");
    const username = card.user?.username;
    if (authorName) {
      details.push({
        label: t("sp.meta.author", "Tác giả"),
        value: username ? `${authorName} (@${username})` : authorName,
      });
    }

    const loc = card.location || card.raw?.location?.name || card.user?.location;
    if (loc) {
      details.push({
        label: t("sp.meta.location", "Địa điểm"),
        value: loc,
      });
    }

    const badge = getResolutionBadge(card.width, card.height);
    const res = formatResolution(card.width, card.height);
    if (res) {
      const badgeHtml = badge ? ` <span class="meta_badge">${escapeHtml(badge)}</span>` : "";
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

    details.push({
      label: t("sp.meta.source", "Nguồn ảnh"),
      value: "Unsplash",
    });

    return details;
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
