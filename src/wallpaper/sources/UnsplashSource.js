import { RemoteSource } from "./RemoteSource.js";
import {
  fetchUnsplashQueue,
  trackDownloadOnce,
  withUnsplashUtm,
} from "/src/wallpaper/sources/api/unsplashAPI.js";
import { getFromStore, saveToStore } from "/src/core/db.js";
import { t } from "/src/core/i18n.js";
import {
  formatResolution,
  getResolutionBadge,
  formatFileSize,
  formatNumber,
  escapeHtml,
} from "./cardMeta.js";

/**
 * Trích xuất chuỗi địa điểm sạch từ object hoặc string, tránh render [object Object].
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
 * Uses a Cloudflare Worker proxy to safely fetch curated, high-res photos
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

  /** Take the next photo off the persisted queue, refilling it if empty. */
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

  // ─── Chip Info (Collapsed & Hover Expand) ─────────────────────────────────

  getChipSummary(card) {
    if (!card) return "";
    const authorName =
      card.user?.name ||
      (card.title?.startsWith("Unsplash • ") ? card.title.slice(11) : "");
    const photoByPrefix = t("sp.meta.photo_by", "Photo by");
    const badge = getResolutionBadge(card.width, card.height);

    const parts = [];
    if (authorName) {
      parts.push(
        `<span>${escapeHtml(photoByPrefix)} <strong>${escapeHtml(authorName)}</strong></span>`,
      );
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

    // 1. Tác giả có liên kết (clickable link)
    const authorName =
      card.user?.name ||
      (card.title?.startsWith("Unsplash • ") ? card.title.slice(11) : "");
    const username = card.user?.username;
    const authorLink = card.user?.link;

    if (authorName) {
      const authorDisplay = username
        ? `${escapeHtml(authorName)} (@${escapeHtml(username)})`
        : escapeHtml(authorName);
      const authorHtml = authorLink
        ? `<a href="${escapeHtml(withUnsplashUtm(authorLink))}" target="_blank" rel="noopener noreferrer">${authorDisplay}</a>`
        : authorDisplay;

      details.push({
        label: t("sp.meta.author", "Tác giả"),
        value: authorHtml,
        html: true,
      });
    }

    // 2. Địa điểm chụp (chuỗi sạch)
    const loc = formatLocation(
      card.location ||
        card.raw?.location ||
        card.user?.location ||
        card.raw?.user?.location,
    );
    if (loc) {
      details.push({
        label: t("sp.meta.location", "Địa điểm"),
        value: loc,
      });
    }

    // 3. Tên máy ảnh (Camera)
    const exif = card.exif || card.raw?.exif;
    if (exif?.camera) {
      details.push({
        label: t("sp.meta.camera", "Máy ảnh"),
        value: exif.camera,
      });
    }

    // 4. Thông số chụp (Khẩu độ, Tốc độ, Tiêu cự, ISO)
    if (exif) {
      const settings = [];
      if (exif.aperture) settings.push(exif.aperture);
      if (exif.exposure_time) settings.push(exif.exposure_time);
      if (exif.focal_length) settings.push(exif.focal_length);
      if (exif.iso) settings.push(`ISO ${exif.iso}`);

      if (settings.length > 0) {
        details.push({
          label: t("sp.meta.camera_exif", "Thông số"),
          value: settings.join(" • "),
        });
      }
    }

    // 5. Thống kê tương tác (Lượt xem, Lượt tải, Lượt thích)
    const views = card.views ?? card.raw?.views;
    const downloads = card.downloads ?? card.raw?.downloads;
    const likes = card.likes ?? card.raw?.likes;

    if (views || downloads || likes) {
      const stats = [];
      if (views) {
        stats.push(
          `<span class="meta_stat_item" title="${escapeHtml(t("sp.meta.views", "Lượt xem"))}"><i data-icon="eye"></i> <span>${escapeHtml(formatNumber(views))}</span></span>`,
        );
      }
      if (downloads) {
        stats.push(
          `<span class="meta_stat_item" title="${escapeHtml(t("sp.meta.downloads", "Lượt tải"))}"><i data-icon="download"></i> <span>${escapeHtml(formatNumber(downloads))}</span></span>`,
        );
      }
      if (likes) {
        stats.push(
          `<span class="meta_stat_item" title="${escapeHtml(t("sp.meta.favorites", "Yêu thích"))}"><i data-icon="heart"></i> <span>${escapeHtml(formatNumber(likes))}</span></span>`,
        );
      }
      if (stats.length > 0) {
        details.push({
          label: t("sp.meta.stats", "Tương tác"),
          value: stats.join(""),
          html: true,
        });
      }
    }

    // 6. Độ phân giải
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

    // 7. Dung lượng file
    const size = formatFileSize(card.size);
    if (size) {
      details.push({
        label: t("sp.meta.filesize", "Dung lượng"),
        value: size,
      });
    }

    // 8. Nguồn (link đã có ở nút "Xem nguồn ảnh" + credit overlay)
    details.push({
      label: t("sp.meta.source", "Nguồn ảnh"),
      value: "Unsplash",
    });

    return details;
  }

  /**
   * Unsplash requires attribution wherever the photo is shown: photographer
   * name + profile and the photo page, both with UTM parameters.
   * @param {Object} card
   * @returns {{name: string, profileUrl: string, photoUrl: string, unsplashUrl: string}|null}
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
   * Báo cáo download tracking theo quy định của Unsplash khi hình nền được áp dụng.
   */
  async apply(item, options) {
    await super.apply(item, options);

    // Applying the photo is a real "use" event. Tracked at most once per photo.
    void trackDownloadOnce(item);
  }
}
