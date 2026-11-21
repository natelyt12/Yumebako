import { RemoteSource } from "./RemoteSource.js";
import {
  fetchUnsplashQueue,
  clearUnsplashQueue,
  trackDownloadOnce,
  withUnsplashUtm,
} from "/src/wallpaper/backend/sources/api/unsplashAPI.js";
import { getFromStore, saveToStore } from "/src/core/db.js";
import { t } from "/src/core/i18n.js";
import {
  formatResolution,
  getResolutionBadge,
  formatFileSize,
  formatNumber,
} from "./cardMeta.js";

/**
 * Extract a clean location string from a string or Unsplash location object,
 * avoiding `"[object Object]"` rendering artifacts.
 *
 * @param {string|Object|null} loc
 * @returns {string}
 */
function formatLocation(loc) {
  if (!loc) return "";
  if (typeof loc === "string") {
    const trimmed = loc.trim();
    return trimmed === "[object Object]" ? "" : trimmed;
  }
  if (typeof loc === "object") {
    if (typeof loc.name === "string" && loc.name) return loc.name.trim();
    const parts = [loc.city, loc.country].filter(Boolean);
    if (parts.length > 0) return parts.join(", ").trim();
  }
  return "";
}

/**
 * UnsplashSource.js
 * ---------------------------------------------------------------------------
 * Switcher source for Unsplash.
 * Uses a Cloudflare Worker proxy to fetch curated, high-res photos
 * and keep the queue in IndexedDB.
 */
export class UnsplashSource extends RemoteSource {
  static id = "unsplash";
  static label = "Unsplash";
  static providerId = "unsplash";
  static storageKey = "provider_state:unsplash";

  /** Unsplash options (query, topics, orientation) in sidebar. */
  get hasProviderSettings() {
    return true;
  }

  /**
   * Take the next photo off the persisted queue, refilling it if empty.
   * @returns {Promise<Object|null>}
   */
  async fetchItem() {
    const key = this.constructor.storageKey;
    const storeData = (await getFromStore(key)) || { queue: [], applied: null };
    const queue = Array.isArray(storeData.queue) ? storeData.queue : [];

    if (queue.length === 0) {
      queue.push(...(await fetchUnsplashQueue()));
      storeData.queue_total = queue.length;
    }

    const entry = queue.shift();
    if (!entry?.urls?.regular && !entry?.urls?.full) return null;

    storeData.queue = queue;
    await saveToStore(key, storeData);

    return this.toCarouselItem(entry, {
      id: String(entry.id),
      url: entry.urls.full || entry.urls.regular,
      sourceUrl: entry.links?.html || "https://unsplash.com",
      title: entry.user?.name ? `Unsplash • ${entry.user.name}` : "Unsplash",
      category: "Unsplash",
      thumbnailUrl: entry.urls.thumb || entry.urls.regular,
      trackUrl: entry.links?.download_location || "",
      width: entry.width || 0,
      height: entry.height || 0,
      size: 0,
      views: entry.views ?? entry.raw?.views ?? 0,
      downloads: entry.downloads ?? entry.raw?.downloads ?? 0,
      likes: entry.likes ?? entry.raw?.likes ?? 0,
      exif: entry.exif || entry.raw?.exif || null,
      user: entry.user
        ? {
            name: entry.user.name || "",
            username: entry.user.username || "",
            link: entry.user.link || entry.user.links?.html || "",
          }
        : null,
      location: formatLocation(
        entry.location ||
          entry.raw?.location ||
          entry.user?.location ||
          entry.raw?.user?.location,
      ),
      raw: entry,
    });
  }

  /**
   * Clear the cached Unsplash queue in IndexedDB.
   * @returns {Promise<void>}
   */
  async clearCache() {
    await clearUnsplashQueue();
  }

  // ─── Pure Structured Metadata ─────────────────────────────────────────────

  /**
   * Return pure structured summary metadata for an Unsplash card (zero HTML).
   * @param {Object} card
   * @returns {import("./BaseSource.js").MetaData|null}
   */
  getMetaData(card) {
    if (!card) return null;
    const authorName =
      card.user?.name ||
      (card.title?.startsWith("Unsplash • ") ? card.title.slice(11) : "");
    const badge = getResolutionBadge(card.width, card.height);
    const resolution = formatResolution(card.width, card.height);
    const size = formatFileSize(card.size);

    const segments = [];
    if (authorName) {
      segments.push({
        type: "author",
        prefix: t("sp.meta.photo_by", "Photo by"),
        name: authorName,
      });
    } else {
      segments.push({ type: "text", text: "Unsplash" });
    }

    if (badge) {
      segments.push({ type: "badge", text: badge });
    }

    return { segments, badge, resolution, size };
  }

  /**
   * Return pure structured detail rows for an Unsplash card (zero HTML).
   * @param {Object} card
   * @returns {import("./BaseSource.js").MetaDetailRow[]}
   */
  getMetaDetails(card) {
    if (!card) return [];
    const details = [];

    // 1. Photographer credit with optional UTM profile link
    const authorName =
      card.user?.name ||
      (card.title?.startsWith("Unsplash • ") ? card.title.slice(11) : "");
    const username = card.user?.username;
    const authorLink = card.user?.link;

    if (authorName) {
      const authorDisplay = username
        ? `${authorName} (@${username})`
        : authorName;
      if (authorLink) {
        details.push({
          kind: "link",
          key: "author",
          label: t("sp.meta.author", "Tác giả"),
          text: authorDisplay,
          url: withUnsplashUtm(authorLink),
        });
      } else {
        details.push({
          kind: "text",
          key: "author",
          label: t("sp.meta.author", "Tác giả"),
          value: authorDisplay,
        });
      }
    }

    // 2. Location
    const loc = formatLocation(
      card.location ||
        card.raw?.location ||
        card.user?.location ||
        card.raw?.user?.location,
    );
    if (loc) {
      details.push({
        kind: "text",
        key: "location",
        label: t("sp.meta.location", "Địa điểm"),
        value: loc,
      });
    }

    // 3. Camera model
    const exif = card.exif || card.raw?.exif;
    if (exif?.camera) {
      details.push({
        kind: "text",
        key: "camera",
        label: t("sp.meta.camera", "Máy ảnh"),
        value: exif.camera,
      });
    }

    // 4. Camera exposure EXIF parameters
    if (exif) {
      const settings = [];
      if (exif.aperture) settings.push(exif.aperture);
      if (exif.exposure_time) settings.push(exif.exposure_time);
      if (exif.focal_length) settings.push(exif.focal_length);
      if (exif.iso) settings.push(`ISO ${exif.iso}`);

      if (settings.length > 0) {
        details.push({
          kind: "text",
          key: "camera_exif",
          label: t("sp.meta.camera_exif", "Thông số"),
          value: settings.join(" • "),
        });
      }
    }

    // 5. Interaction stats (views, downloads, likes)
    const views = card.views ?? card.raw?.views;
    const downloads = card.downloads ?? card.raw?.downloads;
    const likes = card.likes ?? card.raw?.likes;

    if (views || downloads || likes) {
      const items = [];
      if (views) {
        items.push({
          metric: "views",
          icon: "eye",
          value: formatNumber(views),
        });
      }
      if (downloads) {
        items.push({
          metric: "downloads",
          icon: "download",
          value: formatNumber(downloads),
        });
      }
      if (likes) {
        items.push({
          metric: "likes",
          icon: "heart",
          value: formatNumber(likes),
        });
      }
      if (items.length > 0) {
        details.push({
          kind: "stats",
          key: "stats",
          label: t("sp.meta.stats", "Tương tác"),
          items,
        });
      }
    }

    // 6. Resolution
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

    // 7. File size
    const size = formatFileSize(card.size);
    if (size) {
      details.push({
        kind: "text",
        key: "filesize",
        label: t("sp.meta.filesize", "Dung lượng"),
        value: size,
      });
    }

    // 8. Source label
    details.push({
      kind: "text",
      key: "source",
      label: t("sp.meta.source", "Nguồn ảnh"),
      value: "Unsplash",
    });

    return details;
  }

  /**
   * Unsplash requires attribution wherever the photo is shown: photographer
   * name + profile and the photo page, both with UTM parameters.
   * @param {Object} card
   * @returns {{ name: string, profileUrl: string, photoUrl: string, unsplashUrl: string }|null}
   */
  getAttribution(card) {
    if (!card) return null;
    const user = card.user || card.raw?.user || null;
    const name = user?.name || "";
    const profile = user?.link || user?.links?.html || "";
    const photo = card.raw?.links?.html || card.sourceUrl || "";
    if (!name && !photo) return null;
    return {
      name,
      profileUrl: withUnsplashUtm(profile),
      photoUrl: withUnsplashUtm(photo),
      unsplashUrl: withUnsplashUtm("https://unsplash.com"),
    };
  }

  /**
   * Persist applied state and report Unsplash download tracking at most once
   * per photo when applied as the desktop wallpaper.
   *
   * @param {Object} item
   * @param {Object} payload
   * @returns {Promise<void>}
   */
  async onApplied(item, payload) {
    await super.onApplied(item, payload);

    // Applying the photo is a real "use" event. Tracked at most once per photo.
    void trackDownloadOnce(item);
  }
}
