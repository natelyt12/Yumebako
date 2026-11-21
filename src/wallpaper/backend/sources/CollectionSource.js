import { BaseSource } from "./BaseSource.js";
import { SOURCE_ACTIONS } from "./sourceActions.js";
import { sortCardsByCustomizations } from "../effects/effectStates.js";
import {
  addBatchToCollection,
  getCollection,
  getCollectionBlob,
  getCollectionItem,
  removeFromCollection,
  removeMultipleFromCollection,
} from "/src/wallpaper/backend/sources/api/collectionDb.js";
import {
  getSettings,
  getDefaultWallpaperEffects,
  DEFAULT_COLLECTION_SOURCE_ORDER,
} from "/src/core/storageHandler.js";
import {
  generateImageThumbnail,
  generateVideoThumbnail,
  getImageDimensions,
} from "/src/wallpaper/backend/data/thumbnailGenerator.js";
import { t } from "/src/core/i18n.js";
import {
  formatResolution,
  getResolutionBadge,
  formatFileSize,
  formatDate,
  formatNumber,
  getPicreSourceLabel,
} from "./cardMeta.js";
import { withUnsplashUtm } from "./api/unsplashAPI.js";

const FALLBACK_THUMB = "/image/fallback.jpg";
// Giới hạn dung lượng tối đa cho phép tải lên video cục bộ (500 MB).
const VIDEO_HARD_LIMIT = 500 * 1024 * 1024;
// Ngưỡng cảnh báo khi tải lên video dung lượng lớn (100 MB).
const VIDEO_WARN_LIMIT = 100 * 1024 * 1024;

/** Ordering modes offered by the Collection source settings. */
const SORT_MODES = new Set(["effects", "video", "date", "source"]);

/**
 * True when the collection entry holds a video.
 * @param {Object} item
 * @returns {boolean}
 */
function isVideoItem(item) {
  return item?.mediaType === "video" || Boolean(item?.type?.includes("video"));
}

/**
 * Upload date of a collection item, in ms.
 * Newer records embed the save timestamp in their id (`<ms>_<rand>`).
 * Items with no date sort as 0 so they never masquerade as the newest.
 *
 * @param {Object} item
 * @returns {number}
 */
function itemAddedAt(item) {
  const meta = item?.metadata || item?.raw?.metadata || {};
  const idStamp = Number(String(item?.id ?? "").split("_")[0]);
  const candidates = [
    Number(meta.addedAt),
    Number.isFinite(idStamp) ? idStamp : NaN,
    Number(item?.raw?.addedAt),
    Number(item?.addedAt),
  ];
  const stamp = candidates.find((value) => Number.isFinite(value) && value > 0);
  return stamp ?? 0;
}

/**
 * Group id used by `sortMode: "source"`; local uploads belong to `collection`.
 * @param {Object} item
 * @returns {string}
 */
function itemGroupId(item) {
  const provider = String(
    item?.metadata?.provider || item?.raw?.metadata?.provider || "",
  ).toLowerCase();
  if (!provider || provider === "local" || provider === "collection") {
    return "collection";
  }
  return provider;
}

/**
 * CollectionSource.js
 * ---------------------------------------------------------------------------
 * Headless Switcher source backed by the personal IndexedDB collection.
 *
 * Produces cached Object URLs from each entry's stored thumbnail (the list entry
 * carries no full-size blob — see `collectionDb.js`), imports user-selected media
 * files headlessly (`importFiles(files)`), and builds pure render payloads and
 * structured metadata descriptors.
 */
export class CollectionSource extends BaseSource {
  static id = "collection";
  static label = "Bộ sưu tập";

  /** Object URL per collection record, so a refresh reuses them (see `_resolveThumb`). */
  _thumbUrls = new Map();

  /** @returns {Array<Object>} */
  get actions() {
    return [
      SOURCE_ACTIONS.download,
      SOURCE_ACTIONS.source,
      SOURCE_ACTIONS.remove,
    ];
  }

  /** @returns {boolean} */
  get canGrow() {
    return true;
  }

  /** Uploads land in the collection from anywhere in the app, not just here. */
  get isDynamic() {
    return true;
  }

  /**
   * Import user-selected files into the personal collection without touching the DOM
   * or showing UI toast notifications.
   *
   * @param {File[]|FileList} files
   * @returns {Promise<{ addedCards: Array<Object>, warnings: Array<{ file: string, code: string }>, errors: Array<{ file: string, code: string, cause?: unknown }> }>}
   */
  async importFiles(files) {
    const fileList = Array.from(files || []).filter(Boolean);
    if (fileList.length === 0 || this.isLoading) {
      return { addedCards: [], warnings: [], errors: [] };
    }

    this.isLoading = true;
    try {
      const preparedList = [];
      const warnings = [];
      const errors = [];

      for (const file of fileList) {
        const result = await this._prepareLocalFile(file);
        if (result.warning) warnings.push(result.warning);
        if (result.error) errors.push(result.error);
        if (result.record) preparedList.push(result.record);
      }

      if (preparedList.length === 0) {
        return { addedCards: [], warnings, errors };
      }

      // Persist the entire batch in one IndexedDB transaction.
      const savedRecords = await addBatchToCollection(preparedList);
      const addedCards = savedRecords.map((raw) => this._toCarouselItem(raw));
      return { addedCards, warnings, errors };
    } finally {
      this.isLoading = false;
    }
  }

  /**
   * Headless continuation hook: imports `files` when supplied by Layer 1/2,
   * otherwise returns `null` (Layer 3 never opens `<input type="file">`).
   *
   * @param {File[]|FileList|null} [files=null]
   * @returns {Promise<Array<Object>|null>}
   */
  async fetchMore(files = null) {
    if (!files || (Array.isArray(files) && files.length === 0)) {
      return null;
    }
    const { addedCards } = await this.importFiles(files);
    return addedCards.length > 0 ? addedCards : null;
  }

  /**
   * Validate size constraints and generate metadata + thumbnail for one uploaded file.
   * @param {File} file
   * @returns {Promise<{ record: Object|null, warning: { file: string, code: string }|null, error: { file: string, code: string, cause?: unknown }|null }>}
   * @private
   */
  async _prepareLocalFile(file) {
    const isVideo = Boolean(file?.type?.startsWith("video/"));
    let warning = null;

    if (isVideo && file.size > VIDEO_HARD_LIMIT) {
      return {
        record: null,
        warning: null,
        error: { file: file.name, code: "video_too_large" },
      };
    }
    if (isVideo && file.size > VIDEO_WARN_LIMIT) {
      warning = { file: file.name, code: "video_large_warning" };
    }

    try {
      const thumbnail = isVideo
        ? await generateVideoThumbnail(file)
        : await generateImageThumbnail(file);
      const { width, height } = isVideo
        ? { width: 0, height: 0 }
        : await getImageDimensions(file);

      return {
        record: {
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
        },
        warning,
        error: null,
      };
    } catch (err) {
      console.error(`[Collection] Failed to process "${file.name}":`, err);
      return {
        record: null,
        warning,
        error: { file: file.name, code: "upload_error", cause: err },
      };
    }
  }

  /**
   * Read the collection from IndexedDB and reuse live cached thumbnail Object URLs,
   * revoking only URLs whose entries were removed.
   * @returns {Promise<Array<Object>>}
   */
  async fetchItems() {
    const collection = await getCollection();
    const items = collection.map((raw) => this._toCarouselItem(raw));

    this._releaseUnusedThumbs(new Set(items.map((item) => item.id)));
    return this.sortItems(items);
  }

  /**
   * Sort collection cards according to `collectionConfig.sortMode`
   * (`effects`, `video`, `date`, or `source`).
   *
   * @param {Array<Object>} items
   * @returns {Array<Object>}
   */
  sortItems(items) {
    if (!Array.isArray(items)) return [];

    const cfg = getSettings().collectionConfig || {};
    const mode = SORT_MODES.has(cfg.sortMode) ? cfg.sortMode : "effects";

    if (mode === "date") {
      const oldestFirst = cfg.sortOldestFirst === true;
      return [...items].sort((a, b) =>
        oldestFirst
          ? itemAddedAt(a) - itemAddedAt(b)
          : itemAddedAt(b) - itemAddedAt(a),
      );
    }

    if (mode === "source") {
      const order =
        Array.isArray(cfg.sourceOrder) && cfg.sourceOrder.length > 0
          ? cfg.sourceOrder
          : DEFAULT_COLLECTION_SOURCE_ORDER;

      /** @type {Map<string, Array<Object>>} */
      const buckets = new Map();
      for (const item of items) {
        const group = itemGroupId(item);
        if (!buckets.has(group)) buckets.set(group, []);
        buckets.get(group).push(item);
      }

      const ordered = [];
      for (const group of order) {
        const bucket = buckets.get(group);
        if (!bucket) continue;
        // Inside a group the default effect ordering still applies.
        ordered.push(...sortCardsByCustomizations(bucket));
        buckets.delete(group);
      }

      // Providers outside the configured order keep their effect order last.
      const rest = [];
      buckets.forEach((bucket) => rest.push(...bucket));
      return [...ordered, ...sortCardsByCustomizations(rest)];
    }

    const videos = [];
    const images = [];
    for (const item of items) {
      (isVideoItem(item) ? videos : images).push(item);
    }

    if (mode === "video") {
      return [
        ...sortCardsByCustomizations(videos),
        ...sortCardsByCustomizations(images),
      ];
    }

    // `effects`: most customized first; stable sort keeps videos-then-images base order.
    return sortCardsByCustomizations([...videos, ...images]);
  }

  /**
   * Revoke cached thumbnail URLs for records that left the collection.
   * @param {Set<string>} liveIds
   * @protected
   */
  _releaseUnusedThumbs(liveIds) {
    this._thumbUrls.forEach((url, id) => {
      if (liveIds.has(id)) return;
      URL.revokeObjectURL(url);
      this._thumbUrls.delete(id);
    });
  }

  /**
   * Evict a cached thumbnail Object URL so `prepareThumb` can rebuild it.
   * @param {string|number} itemId
   */
  releaseThumb(itemId) {
    if (itemId === undefined || itemId === null) return;
    const key = String(itemId);
    const url = this._thumbUrls.get(key);
    if (!url) return;
    URL.revokeObjectURL(url);
    this._thumbUrls.delete(key);
  }

  /**
   * Ensure `item.thumbnailUrl` points to a valid live Object URL or non-blob fallback.
   * @param {Object} item
   * @returns {Promise<string>}
   */
  async prepareThumb(item) {
    if (!item?.id) return FALLBACK_THUMB;
    const idStr = String(item.id);

    // 1. Live Object URL already cached in this session.
    if (this._thumbUrls.has(idStr)) {
      item.thumbnailUrl = this._thumbUrls.get(idStr);
      return item.thumbnailUrl;
    }

    // 2. Non-blob remote URL.
    if (
      typeof item.thumbnailUrl === "string" &&
      !item.thumbnailUrl.startsWith("blob:")
    ) {
      return item.thumbnailUrl;
    }

    // 3. Rebuild Object URL from the entry's stored thumbnail Blob.
    const raw = item.raw || (await getCollectionItem(item.id));
    item.thumbnailUrl = this._resolveThumb(raw);
    return item.thumbnailUrl;
  }

  /**
   * Return whether `item` is the currently active desktop wallpaper.
   * @param {Object} item
   * @returns {boolean}
   */
  isActive(item) {
    const config = getSettings().wallpaperConfig || {};
    return (
      config.source === this.constructor.id &&
      (config.activeCollectionItemId === item.id ||
        config.activeWallpaperId === item.id)
    );
  }

  /**
   * Build a pure render payload (`{ id, blob, type, width, height, effects, credit }`)
   * without touching DOM elements or `wallpaperRenderer`.
   *
   * @param {Object} item
   * @returns {Promise<Object|null>}
   */
  async getRenderPayload(item) {
    if (!item?.id) return null;

    // Media lives in its own record, so applying reads exactly one Blob.
    const blob = await this.getBlob(item);
    if (!blob) return null;

    const isVideo =
      blob.type.startsWith("video/") ||
      item.mediaType === "video" ||
      item.raw?.type === "local_video" ||
      item.raw?.type === "video";

    return {
      id: item.id,
      blob,
      type: isVideo ? "video" : "image",
      width: item.width || 0,
      height: item.height || 0,
      effects:
        item.effects || item.raw?.effects || getDefaultWallpaperEffects(),
      credit: this.getAttribution(item),
    };
  }

  /**
   * Resolve the full-size media Blob from `mediaData`.
   * @param {Object} item
   * @returns {Promise<Blob|null>}
   */
  async getBlob(item) {
    return getCollectionBlob(item?.id);
  }

  /**
   * Delete a single entry from the collection store and revoke its cached thumbnail URL.
   * @param {Object} card
   * @returns {Promise<void>}
   */
  async deleteItem(card) {
    if (!card?.id) return;
    await removeFromCollection(card.id);
    this.releaseThumb(card.id);
  }

  /**
   * Batch deletion: revoke cached thumbs and rewrite the collection array once.
   * @param {Array<Object>} cards
   * @returns {Promise<void>}
   */
  async deleteItems(cards = []) {
    if (!Array.isArray(cards) || cards.length === 0) return;

    const ids = cards.map((card) => card?.id).filter(Boolean);
    if (ids.length === 0) return;

    ids.forEach((id) => this.releaseThumb(id));
    await removeMultipleFromCollection(ids);
  }

  /**
   * Map one stored collection record onto the standard `CardItem` shape.
   * @param {Object} raw
   * @returns {Object}
   * @private
   */
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
      size: metadata.size || 0,
      addedAt:
        Number(metadata.addedAt) ||
        Number(String(raw.id).split("_")[0]) ||
        Number(raw.addedAt) ||
        Date.now(),
      raw,
    });
  }

  /**
   * Detect whether a stored collection record represents a video.
   * @param {Object} raw
   * @returns {boolean}
   */
  isVideo(raw) {
    return (
      raw?.type === "local_video" ||
      raw?.type === "video" ||
      Boolean(raw?.metadata?.mimeType?.startsWith("video/"))
    );
  }

  /**
   * Resolve or mint a thumbnail Object URL for `raw`.
   * @param {Object} raw
   * @returns {string}
   * @private
   */
  _resolveThumb(raw) {
    if (!raw?.id) return FALLBACK_THUMB;

    const id = String(raw.id);
    const cached = this._thumbUrls.get(id);
    if (cached) return cached;

    if (!(raw.thumbnail instanceof Blob)) return FALLBACK_THUMB;

    const url = URL.createObjectURL(raw.thumbnail);
    this._thumbUrls.set(id, url);
    return url;
  }

  /**
   * Build a readable fallback title for records without an explicit title.
   * @param {Object} raw
   * @returns {string}
   * @private
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

  // ─── Pure Structured Metadata ─────────────────────────────────────────────

  /**
   * Extract a clean Bing title from saved collection metadata.
   * @param {Object} meta
   * @param {Object} card
   * @returns {string}
   * @private
   */
  _getCleanBingTitle(meta, card) {
    const rawTitle = meta?.title?.trim() || card?.title?.trim();
    if (rawTitle && !/^info$/i.test(rawTitle) && !/^bing\b/i.test(rawTitle)) {
      return rawTitle;
    }
    const copyright =
      meta?.copyright || card?.copyright || card?.raw?.copyright;
    if (copyright) {
      const subject = copyright.split("(")[0].trim();
      if (subject && !/^info$/i.test(subject)) return subject;
    }
    return rawTitle && !/^info$/i.test(rawTitle) ? rawTitle : "Bing";
  }

  /**
   * Unsplash credit for a saved collection copy.
   * @param {Object} card
   * @returns {{ name: string, profileUrl: string, photoUrl: string, unsplashUrl: string }|null}
   */
  getAttribution(card) {
    const meta = card?.metadata || {};
    if ((meta.provider || "") !== "unsplash") return null;
    const user = meta.user || card?.user || null;
    const name = user?.name || "";
    const profile = user?.link || "";
    const photo = meta.source || meta.url || "";
    if (!name && !photo) return null;
    return {
      name,
      profileUrl: withUnsplashUtm(profile),
      photoUrl: withUnsplashUtm(photo),
      unsplashUrl: withUnsplashUtm("https://unsplash.com"),
    };
  }

  /**
   * Return pure structured summary metadata for a collection card (zero HTML).
   * @param {Object} card
   * @returns {import("./BaseSource.js").MetaData|null}
   */
  getMetaData(card) {
    if (!card) return null;
    const meta = card.metadata || {};
    const provider = meta.provider || (card.local ? "local" : "");
    const badge = getResolutionBadge(card.width, card.height);
    const resolution = formatResolution(card.width, card.height);
    const size = formatFileSize(card.size);
    const segments = [];

    // Case 1: Saved from an external provider (Unsplash, Bing, Wallhaven, Picre, ...)
    if (provider && provider !== "local") {
      if (provider === "unsplash") {
        const author = meta.user?.name || "";
        if (author) {
          segments.push({
            type: "author",
            prefix: t("sp.meta.photo_by", "Photo by"),
            name: author,
          });
        } else {
          segments.push({ type: "text", text: "Unsplash" });
        }
        if (badge) segments.push({ type: "badge", text: badge });
        return { segments, badge, resolution, size };
      }

      if (provider === "bing") {
        const title = this._getCleanBingTitle(meta, card);
        const dateStr = formatDate(meta.startDate || card.startDate);
        segments.push({ type: "text", text: title });
        if (dateStr) segments.push({ type: "text", text: dateStr });
        else if (badge) segments.push({ type: "badge", text: badge });
        return { segments, badge, resolution, size };
      }

      if (provider === "wallhaven") {
        const query =
          (meta.query && meta.query.trim()) ||
          meta.title ||
          meta.category ||
          t("sp.meta.random", "Ngẫu nhiên");
        segments.push({ type: "text", text: query });
        if (badge) segments.push({ type: "badge", text: badge });
        return { segments, badge, resolution, size };
      }

      if (provider === "picre") {
        const platform = getPicreSourceLabel(meta.source || card.sourceUrl);
        segments.push({ type: "text", text: platform });
        if (badge) segments.push({ type: "badge", text: badge });
        return { segments, badge, resolution, size };
      }

      const name = meta.providerName || provider;
      segments.push({ type: "text", text: name });
      if (badge) segments.push({ type: "badge", text: badge });
      return { segments, badge, resolution, size };
    }

    // Case 2: Uploaded from the user's device
    const isVideo = card.mediaType === "video" || card.type?.includes("video");
    const typeLabel = t(
      `sp.meta.${isVideo ? "type_video" : "type_image"}`,
      isVideo ? "Video" : "Hình ảnh",
    );
    segments.push({ type: "text", text: typeLabel });
    if (badge) segments.push({ type: "badge", text: badge });
    else if (size) segments.push({ type: "text", text: size });

    return { segments, badge, resolution, size };
  }

  /**
   * Return pure structured detail rows for a collection card (zero HTML).
   * @param {Object} card
   * @returns {import("./BaseSource.js").MetaDetailRow[]}
   */
  getMetaDetails(card) {
    if (!card) return [];
    const details = [];
    const meta = card.metadata || {};
    const provider = meta.provider || (card.local ? "local" : "");
    const isVideo = card.mediaType === "video" || card.type?.includes("video");

    // Case 1: Saved from an external provider
    if (provider && provider !== "local") {
      if (provider === "unsplash") {
        const author = meta.user?.name;
        const username = meta.user?.username;
        if (author) {
          const authorLabel = username ? `${author} (@${username})` : author;
          const authorLink = meta.user?.link;
          if (authorLink) {
            details.push({
              kind: "link",
              key: "author",
              label: t("sp.meta.author", "Tác giả"),
              text: authorLabel,
              url: withUnsplashUtm(authorLink),
            });
          } else {
            details.push({
              kind: "text",
              key: "author",
              label: t("sp.meta.author", "Tác giả"),
              value: authorLabel,
            });
          }
        }
        if (meta.user?.location || meta.location) {
          details.push({
            kind: "text",
            key: "location",
            label: t("sp.meta.location", "Địa điểm"),
            value: meta.user?.location || meta.location,
          });
        }
      } else if (provider === "bing") {
        const title = this._getCleanBingTitle(meta, card);
        if (title) {
          details.push({
            kind: "text",
            key: "title",
            label: t("sp.meta.title", "Tiêu đề"),
            value: title,
          });
        }
        const dateStr = formatDate(meta.startDate);
        if (dateStr) {
          details.push({
            kind: "text",
            key: "date_released",
            label: t("sp.meta.date_released", "Ngày phát hành"),
            value: dateStr,
          });
        }
        if (meta.copyright) {
          details.push({
            kind: "text",
            key: "copyright",
            label: t("sp.meta.copyright", "Bản quyền"),
            value: meta.copyright,
            stacked: true,
          });
        }
      } else if (provider === "wallhaven") {
        const queryVal =
          (meta.query && meta.query.trim()) ||
          t("sp.meta.random", "Ngẫu nhiên");
        details.push({
          kind: "text",
          key: "query",
          label: t("sp.meta.query", "Từ khóa"),
          value: queryVal,
        });
        if (meta.category) {
          const catKey = `sp.api.wallhaven.cat_${meta.category.toLowerCase()}`;
          details.push({
            kind: "text",
            key: "category",
            label: t("sp.meta.category", "Phân loại"),
            value: t(catKey, meta.category),
          });
        }
        if (meta.favorites !== undefined || meta.views !== undefined) {
          const items = [];
          if (meta.favorites !== undefined) {
            items.push({
              metric: "favorites",
              icon: "heart",
              value: formatNumber(meta.favorites),
            });
          }
          if (meta.views !== undefined) {
            items.push({
              metric: "views",
              icon: "eye",
              value: formatNumber(meta.views),
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
      } else if (provider === "picre") {
        const platform = getPicreSourceLabel(meta.source || card.sourceUrl);
        if (platform) {
          details.push({
            kind: "text",
            key: "platform",
            label: t("sp.meta.platform", "Nền tảng"),
            value: platform,
          });
        }
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

      details.push({
        kind: "text",
        key: "source",
        label: t("sp.meta.source", "Nguồn ảnh"),
        value: meta.providerName || provider,
      });

      const dateSaved = formatDate(
        meta.addedAt || card.addedAt || Number(String(card.id).split("_")[0]),
      );
      if (dateSaved) {
        details.push({
          kind: "text",
          key: "date_saved",
          label: t("sp.meta.date_saved", "Ngày lưu"),
          value: dateSaved,
        });
      }

      return details;
    }

    // Case 2: Uploaded from the user's device
    const fileName = meta.name || card.title || "";
    if (fileName) {
      details.push({
        kind: "text",
        key: "filename",
        label: t("sp.meta.filename", "Tên file"),
        value: fileName,
      });
    }

    details.push({
      kind: "text",
      key: "media_type",
      label: t("sp.meta.media_type", "Loại media"),
      value: t(
        `sp.meta.${isVideo ? "type_video" : "type_image"}`,
        isVideo ? "Video" : "Hình ảnh",
      ),
    });

    details.push({
      kind: "text",
      key: "source",
      label: t("sp.meta.source", "Nguồn gốc"),
      value: t("sp.meta.local_device", "Trên máy tính"),
    });

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

    const dateAdded = formatDate(
      meta.addedAt || card.addedAt || Number(String(card.id).split("_")[0]),
    );
    if (dateAdded) {
      details.push({
        kind: "text",
        key: "date_added",
        label: t("sp.meta.date_added", "Ngày thêm"),
        value: dateAdded,
      });
    }

    return details;
  }
}
