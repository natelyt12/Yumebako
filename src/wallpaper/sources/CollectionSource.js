import { BaseSource } from "./BaseSource.js";
import { SOURCE_ACTIONS } from "./sourceActions.js";
import {
  addToCollection,
  addBatchToCollection,
  getCollection,
  getCollectionItem,
  removeFromCollection,
} from "/src/wallpaper/sources/api/collectionDb.js";
import { wallpaperRenderer } from "/src/wallpaper/core/renderer.js";
import { getSettings, getDefaultWallpaperEffects } from "/src/core/storageHandler.js";
import { showNotification } from "/src/core/ui.js";
import {
  generateImageThumbnail,
  generateVideoThumbnail,
  getImageDimensions,
} from "/src/core/utils/thumbnailGenerator.js";
import { t } from "/src/core/i18n.js";
import {
  formatResolution,
  getResolutionBadge,
  formatFileSize,
  formatDate,
  formatNumber,
  getPicreSourceLabel,
  escapeHtml,
} from "./cardMeta.js";

const FALLBACK_THUMB = "/image/fallback.jpg";
const VIDEO_HARD_LIMIT = 500 * 1024 * 1024;
const VIDEO_WARN_LIMIT = 100 * 1024 * 1024;

/** Open a native file picker and resolve with the chosen files (empty on cancel). */
function pickMediaFiles() {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*,video/*";
    input.multiple = true;

    input.addEventListener("change", () =>
      resolve(Array.from(input.files || [])),
    );
    input.addEventListener("cancel", () => resolve([]));

    input.click();
  });
}

/**
 * CollectionSource.js
 * ---------------------------------------------------------------------------
 * Switcher source backed by the personal IndexedDB collection.
 *
 * It produces object URLs from each item's stored thumbnail (falling back to
 * the full blob for legacy entries that have no thumbnail), and applies items
 * through the Collection provider so the per-wallpaper effect profile is kept.
 *
 * Its items grow through one door: the **upload button** in the bottom bar
 * (`WallpaperSwitcher.requestUpload`), which opens the file picker inside a real
 * user gesture — the thing browsers require to show a file dialog.
 *
 * That is why the bottom bar shows this source's upload button instead of the
 * "get more" control: only a real user gesture may open a file dialog, and a
 * card slot cannot provide one.
 */
export class CollectionSource extends BaseSource {
  static id = "collection";
  static label = "Bộ sưu tập";

  /** Object URL per collection record, so a refresh reuses them (see `_resolveThumb`). */
  _thumbUrls = new Map();

  get actions() {
    return [
      SOURCE_ACTIONS.download,
      SOURCE_ACTIONS.source,
      SOURCE_ACTIONS.remove,
    ];
  }

  get canGrow() {
    return true;
  }

  /** Uploads land in the collection from anywhere in the app, not just here. */
  get isDynamic() {
    return true;
  }

  /**
   * Open the file picker and store whatever the user picked.
   * Called from the upload button, i.e. inside a user gesture.
   * @returns {Promise<Array<Object>>} The items that were just added.
   */
  async fetchMore() {
    if (this.isLoading) return null;
    this.isLoading = true;
    try {
      const files = await pickMediaFiles();
      if (files.length === 0) return null;

      const preparedList = [];
      for (const file of files) {
        const record = await this._prepareLocalFile(file);
        if (record) preparedList.push(record);
      }

      if (preparedList.length === 0) return null;

      // Lưu nguyên lô vào IndexedDB cùng một lúc (1 transaction duy nhất)
      const savedRecords = await addBatchToCollection(preparedList);

      showNotification(
        t("sp.api.collection.upload_success", { count: savedRecords.length }),
        "success",
      );

      return savedRecords.map((raw) => this._toCarouselItem(raw));
    } finally {
      this.isLoading = false;
    }
  }

  /**
   * Chuẩn bị metadata và thumbnail cho file tải lên.
   * @returns {Promise<Object|null>}
   */
  async _prepareLocalFile(file) {
    const isVideo = file.type.startsWith("video/");

    if (isVideo && file.size > VIDEO_HARD_LIMIT) {
      showNotification(t("sp.api.local.video_too_large"), "error");
      return null;
    }
    if (isVideo && file.size > VIDEO_WARN_LIMIT) {
      showNotification(t("sp.api.local.video_large_warning"), "warning");
    }

    try {
      const thumbnail = isVideo
        ? await generateVideoThumbnail(file)
        : await generateImageThumbnail(file);
      const { width, height } = isVideo
        ? { width: 0, height: 0 }
        : await getImageDimensions(file);

      return {
        type: isVideo ? "local_video" : "local_image",
        blob: file,
        thumbnail,
        metadata: {
          width,
          height,
          size: file.size,
          source: "local",
          mimeType: file.type,
        },
      };
    } catch (error) {
      console.error(`[Collection] Failed to process "${file.name}":`, error);
      showNotification(
        t("sp.api.collection.upload_error", { file: file.name }),
        "error",
      );
      return null;
    }
  }

  /**
   * Every collection entry becomes an item whose media stays in the app.
   *
   * The window is rebuilt from scratch, but its object URLs are not. The items
   * on screen are never rebuilt along with it, so revoking every URL here would
   * leave their <img> pointing at a dead address and mint a new generation of
   * URLs that nothing ever displays. Each URL is therefore cached per record
   * (see `_resolveThumb`) and only the ones whose record is gone are released.
   */
  async fetchItems() {
    const collection = await getCollection();
    const items = collection.map((raw) => this._toCarouselItem(raw));

    this._releaseUnusedThumbs(new Set(items.map((item) => item.id)));
    return items;
  }

  /**
   * Revoke the cached URL of every record that left the collection.
   * @param {Set<string>} liveIds
   */
  _releaseUnusedThumbs(liveIds) {
    this._thumbUrls.forEach((url, id) => {
      if (liveIds.has(id)) return;
      URL.revokeObjectURL(url);
      this._thumbUrls.delete(id);
    });
  }

  /** Media already lives in IndexedDB, so the thumbnail is free to build. */
  async prepareThumb(item) {
    if (!item?.id) return FALLBACK_THUMB;
    const idStr = String(item.id);

    // 1. Nếu đã có URL còn sống trong session hiện tại
    if (this._thumbUrls.has(idStr)) {
      item.thumbnailUrl = this._thumbUrls.get(idStr);
      return item.thumbnailUrl;
    }

    // 2. Nếu là URL từ xa (không phải blob chết)
    if (typeof item.thumbnailUrl === "string" && !item.thumbnailUrl.startsWith("blob:")) {
      return item.thumbnailUrl;
    }

    // 3. Tái tạo living Object URL từ IndexedDB record
    const raw = await getCollectionItem(item.id);
    item.thumbnailUrl = this._resolveThumb(raw);
    return item.thumbnailUrl;
  }

  isActive(item) {
    const config = getSettings().wallpaperConfig || {};
    return (
      config.source === this.constructor.id &&
      (config.activeCollectionItemId === item.id ||
        config.activeWallpaperId === item.id)
    );
  }

  async apply(item, { firstRun = false } = {}) {
    if (!item?.id) return;
    const raw = await getCollectionItem(item.id);
    if (!raw) return;
    const isVideo =
      raw.type === "local_video" ||
      raw.type === "video" ||
      (raw.blob instanceof Blob && raw.blob.type.startsWith("video/"));
    return await wallpaperRenderer.apply(
      {
        ...raw,
        id: item.id,
        type: isVideo ? "video" : "image",
        effects: item.effects || raw.effects || getDefaultWallpaperEffects(),
      },
      { firstRun },
    );
  }

  /** Media already lives in IndexedDB, so no fetch is needed. */
  async getBlob(item) {
    const raw = await getCollectionItem(item.id);
    return raw?.blob instanceof Blob ? raw.blob : null;
  }

  /** Xóa hoàn toàn thẻ khỏi database bộ sưu tập và giải phóng URL */
  async deleteItem(card) {
    if (!card?.id) return;
    await removeFromCollection(card.id);
    const cachedUrl = this._thumbUrls.get(String(card.id));
    if (cachedUrl) {
      URL.revokeObjectURL(cachedUrl);
      this._thumbUrls.delete(String(card.id));
    }
  }

  /** Map one collection record onto the persisted item shape. */
  _toCarouselItem(raw) {
    const metadata = raw?.metadata || {};
    const sourceUrl = /^https?:\/\//i.test(metadata.source || "")
      ? metadata.source
      : "";
    const isLocal = metadata.provider
      ? metadata.provider === "local"
      : metadata.source === "local" || !sourceUrl;

    return this.toCarouselItem(raw, {
      id: String(raw.id),
      sourceUrl,
      title: this._buildTitle(raw),
      mediaType: this.isVideo(raw) ? "video" : "image",
      thumbnailUrl: this._resolveThumb(raw),
      local: isLocal,
      metadata,
      width: metadata.width || 0,
      height: metadata.height || 0,
      size: metadata.size || (raw.blob instanceof Blob ? raw.blob.size : 0),
      raw,
    });
  }

  /** Collection entries are local files; detect the media type defensively. */
  isVideo(raw) {
    return (
      raw.type === "local_video" ||
      raw.type === "video" ||
      Boolean(raw.blob instanceof Blob && raw.blob.type.startsWith("video/"))
    );
  }

  /** Prefer the dedicated thumbnail, fall back to the full blob. */
  _resolveThumb(raw) {
    if (!raw?.id) return FALLBACK_THUMB;

    const id = String(raw.id);
    const cached = this._thumbUrls.get(id);
    if (cached) return cached;

    const blob = raw.thumbnail instanceof Blob ? raw.thumbnail : raw.blob;
    if (!(blob instanceof Blob)) return FALLBACK_THUMB;

    const url = URL.createObjectURL(blob);
    this._thumbUrls.set(id, url);
    return url;
  }

  /**
   * Build a readable label for a record that has no explicit title, e.g.
   * "Ảnh • Wallhaven" or "Video • Local".
   */
  _buildTitle(raw) {
    if (!raw) return "";
    if (raw.metadata?.title) return raw.metadata.title;
    if (raw.metadata?.name) return raw.metadata.name;

    const isVideo = this.isVideo(raw);
    const mediaType = t(
      `sp.api.collection.${isVideo ? "typeVideo" : "typeImage"}`,
      isVideo ? "Video" : "Ảnh",
    );

    const rawSource = raw.metadata?.source || "";
    const providerKey = raw.metadata?.provider || "";
    const providerName = raw.metadata?.providerName || "";
    let srcVal = "";

    if (providerName && providerKey !== "local") {
      srcVal = providerName;
    } else if (
      rawSource === "local" ||
      providerKey === "local" ||
      raw.type?.startsWith("local")
    ) {
      srcVal = t("sp.api.collection.sourceLocal", "Local");
    } else if (
      providerKey === "wallhaven" ||
      rawSource.includes("wallhaven.cc")
    ) {
      srcVal = "Wallhaven";
    } else if (
      providerKey === "unsplash" ||
      rawSource.includes("unsplash.com")
    ) {
      srcVal = "Unsplash";
    } else if (providerKey === "picre" || rawSource.includes("pic.re")) {
      srcVal = "Picre";
    } else if (rawSource && /^https?:\/\//i.test(rawSource)) {
      try {
        srcVal = new URL(rawSource).hostname.replace(/^www\./, "");
      } catch {
        srcVal = rawSource;
      }
    }

    return srcVal ? `${mediaType} • ${srcVal}` : mediaType;
  }

  // ─── Chip Info (Collapsed & Hover Expand) ─────────────────────────────────

  _getCleanBingTitle(meta, card) {
    const rawTitle = meta?.title?.trim() || card?.title?.trim();
    if (rawTitle && !/^info$/i.test(rawTitle) && !/^bing\b/i.test(rawTitle)) {
      return rawTitle;
    }
    const copyright = meta?.copyright || card?.copyright || card?.raw?.copyright;
    if (copyright) {
      const subject = copyright.split("(")[0].trim();
      if (subject && !/^info$/i.test(subject)) return subject;
    }
    return (rawTitle && !/^info$/i.test(rawTitle)) ? rawTitle : "Bing";
  }

  getChipSummary(card) {
    if (!card) return "";
    const meta = card.metadata || {};
    const provider = meta.provider || (card.local ? "local" : "");
    const badge = getResolutionBadge(card.width, card.height);
    const size = formatFileSize(card.size);

    // TH 1: Ảnh lưu từ bên ngoài (Unsplash, Bing, Wallhaven, Picre...)
    if (provider && provider !== "local") {
      if (provider === "unsplash") {
        const author = meta.user?.name || "";
        const photoBy = t("sp.meta.photo_by", "Photo by");
        const parts = [
          author ? `<span>${escapeHtml(photoBy)} <strong>${escapeHtml(author)}</strong></span>` : `<span>Unsplash</span>`
        ];
        if (badge) parts.push(`<span class="meta_badge">${escapeHtml(badge)}</span>`);
        return parts.join('<span class="card-meta-sep">•</span>');
      }

      if (provider === "bing") {
        const title = this._getCleanBingTitle(meta, card);
        const dateStr = formatDate(meta.startDate || card.startDate);
        const parts = [`<span>${escapeHtml(title)}</span>`];
        if (dateStr) parts.push(`<span>${escapeHtml(dateStr)}</span>`);
        else if (badge) parts.push(`<span class="meta_badge">${escapeHtml(badge)}</span>`);
        return parts.join('<span class="card-meta-sep">•</span>');
      }

      if (provider === "wallhaven") {
        const query = (meta.query && meta.query.trim()) || meta.title || meta.category || t("sp.meta.random", "Ngẫu nhiên");
        const parts = [`<span>${escapeHtml(query)}</span>`];
        if (badge) parts.push(`<span class="meta_badge">${escapeHtml(badge)}</span>`);
        return parts.join('<span class="card-meta-sep">•</span>');
      }

      if (provider === "picre") {
        const platform = getPicreSourceLabel(meta.source || card.sourceUrl);
        const parts = [`<span>${escapeHtml(platform)}</span>`];
        if (badge) parts.push(`<span class="meta_badge">${escapeHtml(badge)}</span>`);
        return parts.join('<span class="card-meta-sep">•</span>');
      }

      const name = meta.providerName || provider;
      const parts = [`<span>${escapeHtml(name)}</span>`];
      if (badge) parts.push(`<span class="meta_badge">${escapeHtml(badge)}</span>`);
      return parts.join('<span class="card-meta-sep">•</span>');
    }

    // TH 2: Tải lên từ máy tính
    const isVideo = card.mediaType === "video" || card.type?.includes("video");
    const typeLabel = t(`sp.meta.${isVideo ? "type_video" : "type_image"}`, isVideo ? "Video" : "Hình ảnh");
    const parts = [`<span>${escapeHtml(typeLabel)}</span>`];
    if (badge) parts.push(`<span class="meta_badge">${escapeHtml(badge)}</span>`);
    else if (size) parts.push(`<span>${escapeHtml(size)}</span>`);

    return parts.join('<span class="card-meta-sep">•</span>');
  }

  getChipDetails(card) {
    if (!card) return [];
    const details = [];
    const meta = card.metadata || {};
    const provider = meta.provider || (card.local ? "local" : "");
    const isVideo = card.mediaType === "video" || card.type?.includes("video");

    // TH 1: Ảnh lưu từ bên ngoài
    if (provider && provider !== "local") {
      if (provider === "unsplash") {
        const author = meta.user?.name;
        const username = meta.user?.username;
        if (author) {
          details.push({
            label: t("sp.meta.author", "Tác giả"),
            value: username ? `${author} (@${username})` : author,
          });
        }
        if (meta.user?.location || meta.location) {
          details.push({
            label: t("sp.meta.location", "Địa điểm"),
            value: meta.user?.location || meta.location,
          });
        }
      } else if (provider === "bing") {
        const title = this._getCleanBingTitle(meta, card);
        if (title) {
          details.push({
            label: t("sp.meta.title", "Tiêu đề"),
            value: title,
          });
        }
        const dateStr = formatDate(meta.startDate);
        if (dateStr) {
          details.push({
            label: t("sp.meta.date_released", "Ngày phát hành"),
            value: dateStr,
          });
        }
        if (meta.copyright) {
          details.push({
            label: t("sp.meta.copyright", "Bản quyền"),
            value: meta.copyright,
            stacked: true,
          });
        }
      } else if (provider === "wallhaven") {
        const queryVal = (meta.query && meta.query.trim()) || t("sp.meta.random", "Ngẫu nhiên");
        details.push({
          label: t("sp.meta.query", "Từ khóa"),
          value: queryVal,
        });
        if (meta.category) {
          const catKey = `sp.api.wallhaven.cat_${meta.category.toLowerCase()}`;
          details.push({
            label: t("sp.meta.category", "Phân loại"),
            value: t(catKey, meta.category),
          });
        }
        if (meta.favorites !== undefined || meta.views !== undefined) {
          const stats = [];
          if (meta.favorites !== undefined) {
            stats.push(`<span class="meta_stat_item"><i data-icon="heart"></i> <span>${escapeHtml(formatNumber(meta.favorites))}</span></span>`);
          }
          if (meta.views !== undefined) {
            stats.push(`<span class="meta_stat_item"><i data-icon="eye"></i> <span>${escapeHtml(formatNumber(meta.views))}</span></span>`);
          }
          details.push({
            label: t("sp.meta.favorites", "Yêu thích"),
            value: stats.join(""),
            html: true,
          });
        }
      } else if (provider === "picre") {
        const platform = getPicreSourceLabel(meta.source || card.sourceUrl);
        if (platform) {
          details.push({
            label: t("sp.meta.platform", "Nền tảng"),
            value: platform,
          });
        }
      }

      // Thông số kỹ thuật & Nguồn lưu
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
        value: meta.providerName || provider,
      });

      const dateSaved = formatDate(meta.addedAt || card.addedAt || Number(String(card.id).split("_")[0]));
      if (dateSaved) {
        details.push({
          label: t("sp.meta.date_saved", "Ngày lưu"),
          value: dateSaved,
        });
      }

      return details;
    }

    // TH 2: Tải lên từ máy tính
    const fileName = meta.name || card.title || "";
    if (fileName) {
      details.push({
        label: t("sp.meta.filename", "Tên file"),
        value: fileName,
      });
    }

    details.push({
      label: t("sp.meta.media_type", "Loại media"),
      value: t(`sp.meta.${isVideo ? "type_video" : "type_image"}`, isVideo ? "Video" : "Hình ảnh"),
    });

    details.push({
      label: t("sp.meta.source", "Nguồn gốc"),
      value: t("sp.meta.local_device", "Trên máy tính"),
    });

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

    const dateAdded = formatDate(meta.addedAt || card.addedAt || Number(String(card.id).split("_")[0]));
    if (dateAdded) {
      details.push({
        label: t("sp.meta.date_added", "Ngày thêm"),
        value: dateAdded,
      });
    }

    return details;
  }
}
