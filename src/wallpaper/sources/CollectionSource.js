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
import { getSettings } from "/src/core/storageHandler.js";
import { showNotification } from "/src/core/ui.js";
import {
  generateImageThumbnail,
  generateVideoThumbnail,
  getImageDimensions,
} from "/src/core/utils/thumbnailGenerator.js";
import { t } from "/src/core/i18n.js";

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
 * That is why this source reports `showsMoreItem = false`: the trailing "+" of
 * the carousel would just be a second, weaker door to the same room, taking a
 * card's worth of room to say what the bar already says.
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

  /** The upload button owns this verb; there is no "+" card to label. */
  get showsMoreItem() {
    return false;
  }

  /** Uploads land in the collection from anywhere in the app, not just here. */
  get isVolatile() {
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
    if (item.thumbnailUrl) return item.thumbnailUrl;

    item.thumbnailUrl = this._resolveThumb(await getCollectionItem(item.id));
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
    await wallpaperRenderer.apply(
      { ...raw, id: item.id, type: isVideo ? "video" : "image" },
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

    return this.toCarouselItem(raw, {
      id: String(raw.id),
      sourceUrl,
      title: this._buildTitle(raw),
      mediaType: this.isVideo(raw) ? "video" : "image",
      thumbnailUrl: this._resolveThumb(raw),
      local: true,
      width: metadata.width || 0,
      height: metadata.height || 0,
      size: metadata.size || (raw.blob instanceof Blob ? raw.blob.size : 0),
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
}
