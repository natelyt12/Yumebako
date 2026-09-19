import { BaseSource } from "./BaseSource.js";
import { SOURCE_ACTIONS } from "./sourceActions.js";
import { getFromStore, saveToStore, removeFromStore } from "/src/core/db.js";
import { getSettings } from "/src/core/storageHandler.js";
import { wallpaperRenderer } from "/src/wallpaper/core/renderer.js";
import { generateImageThumbnail } from "/src/core/utils/thumbnailGenerator.js";
import { t } from "/src/core/i18n.js";

/** Resolve once the browser has the image decoded and ready to paint. */
function preloadImage(url) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = resolve;
    img.onerror = resolve;
    img.src = url;
  });
}

/**
 * RemoteSource.js
 * ---------------------------------------------------------------------------
 * Lớp cơ sở cho các nguồn ảnh trực tuyến (Wallhaven, Picre, Unsplash...).
 *
 * Triển khai Quy trình 1 pha chuẩn hóa (Single-Phase Pipeline):
 *   1. Lấy metadata ảnh từ API nguồn (fetchItem).
 *   2. Tải ảnh gốc 1 lần duy nhất và lưu Blob vào mediaData (`media:orig:${id}`).
 *   3. Tự sinh thumbnail chuẩn 16:9 chất lượng cao và lưu vào mediaData (`media:thumb:${id}`).
 *   4. Bàn giao thẻ hoàn chỉnh với local blob URL cho DataControl và Carousel.
 *   5. Khi chọn thẻ, ảnh gốc đã có sẵn trong DB -> Đổi nền Desktop ngay lập tức (0ms trễ mạng).
 */
export class RemoteSource extends BaseSource {
  static providerId = "";
  static storageKey = "";
  static maxCachedBlobs = 6;

  constructor() {
    super();
    /** @type {Map<string, Blob>} RAM cache cho ảnh gốc để apply/download tức thì */
    this.blobCache = new Map();
    /** @type {Map<string, string>} Item id -> Object URL của thumbnail sinh cục bộ */
    this.thumbCache = new Map();
  }

  get providerId() {
    return this.constructor.providerId || this.id;
  }

  get actions() {
    return [
      SOURCE_ACTIONS.download,
      SOURCE_ACTIONS.source,
      SOURCE_ACTIONS.removeFromCarousel,
      SOURCE_ACTIONS.add,
    ];
  }

  get canGrow() {
    return true;
  }

  get moreLabel() {
    return t("wallpaper_switcher.get_new_image", "Lấy ảnh mới");
  }

  // ─── Sản xuất dữ liệu thẻ (Single-Phase Pipeline) ─────────────────────────

  /**
   * Khởi tạo danh sách thẻ: ưu tiên thẻ đang áp dụng (seed) hoặc nạp 1 thẻ mới đầu tiên.
   */
  async fetchItems() {
    this._releaseAllThumbs();
    this.blobCache.clear();

    const item = (await this.fetchSeedItem()) || (await this.fetchNext());
    return item ? [item] : [];
  }

  /**
   * Nạp thêm 1 thẻ mới khi người dùng đến ô "+" trên Carousel.
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
   * Khôi phục ảnh đã áp dụng gần nhất nếu còn lưu trong DB.
   */
  async fetchSeedItem() {
    const key = this.constructor.storageKey;
    if (!key) return null;

    const current = (await getFromStore(key))?.current;
    if (!current?.image) return null;

    const id = String(current.id ?? current.image);
    let blob = current.blob instanceof Blob ? current.blob : await this.getBlob({ id, url: current.image });
    if (blob instanceof Blob) {
      this.blobCache.set(id, blob);
    }

    const item = this.toCarouselItem(current, {
      id,
      url: current.image,
      sourceUrl: current.source || "",
      title: this.getSeedTitle(current),
      category: current.category || "",
      thumbnailUrl: current.image,
      mediaType: "image",
      width: current.width || 0,
      height: current.height || 0,
      size: current.size || (blob?.size || 0),
      addedAt: current.last_updated || Date.now(),
    });

    await this.prepareThumb(item);
    return item;
  }

  getSeedTitle(current) {
    return current.category || "";
  }

  /**
   * Lấy thẻ kế tiếp và chạy qua Single-Phase Pipeline.
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
   * Phương thức con cần override để gọi API tương ứng.
   * @returns {Promise<Object|null>}
   */
  async fetchItem() {
    return null;
  }

  /**
   * Thực thi Single-Phase Pipeline:
   * 1. Kiểm tra / Tải ảnh gốc -> lưu vào mediaData (`media:orig:${id}`)
   * 2. Tự tạo thumbnail 16:9 -> lưu vào mediaData (`media:thumb:${id}`)
   * 3. Gán blob URL vào item.thumbnailUrl
   */
  async processSinglePhasePipeline(item) {
    if (!item?.id) return;

    try {
      // 1. Lấy hoặc tải ảnh gốc
      let origBlob = this.blobCache.get(item.id) || (await getFromStore(`media:orig:${item.id}`, "mediaData"));

      if (!(origBlob instanceof Blob) && item.url) {
        const response = await fetch(item.url, { mode: "cors" });
        if (!response.ok) throw new Error(`HTTP ${response.status} khi tải ảnh gốc [${item.url}]`);
        origBlob = await response.blob();
        await saveToStore(`media:orig:${item.id}`, origBlob, "mediaData");
      }

      if (origBlob instanceof Blob) {
        this._cacheBlob(item.id, origBlob);
        if (!item.size) item.size = origBlob.size;

        // 2. Tạo hoặc lấy thumbnail 16:9 chất lượng cao
        let thumbBlob = await getFromStore(`media:thumb:${item.id}`, "mediaData");
        if (!(thumbBlob instanceof Blob)) {
          thumbBlob = await generateImageThumbnail(origBlob).catch(() => null);
          if (thumbBlob instanceof Blob) {
            await saveToStore(`media:thumb:${item.id}`, thumbBlob, "mediaData");
          }
        }

        // 3. Tạo Object URL cho thumbnail
        const displayBlob = thumbBlob instanceof Blob ? thumbBlob : origBlob;
        const thumbUrl = this._createObjectUrl(displayBlob);
        if (thumbUrl) {
          item.thumbnailUrl = thumbUrl;
          this.thumbCache.set(item.id, thumbUrl);
        }
      }
    } catch (err) {
      console.warn(`[RemoteSource] Single-Phase Pipeline warning for [${item.id}]:`, err);
      // Giữ nguyên thumbnailUrl dự phòng của item nếu có lỗi tải mạng
    }

    if (item.thumbnailUrl) {
      await preloadImage(item.thumbnailUrl).catch(() => {});
    }
  }

  // ─── Thumbnail & Cache Management ─────────────────────────────────────────

  /**
   * Đảm bảo thẻ có thumbnail sẵn sàng vẽ lên Carousel (dùng khi mở lại app hoặc sau reload).
   */
  async prepareThumb(item) {
    if (!item?.id) return null;

    // 1. Đã có URL còn sống trong RAM
    if (this.thumbCache.has(item.id)) {
      item.thumbnailUrl = this.thumbCache.get(item.id);
      return item.thumbnailUrl;
    }

    // 2. Kiểm tra thumbnail blob trong IndexedDB
    const thumbBlob = await getFromStore(`media:thumb:${item.id}`, "mediaData");
    if (thumbBlob instanceof Blob) {
      const url = this._createObjectUrl(thumbBlob);
      item.thumbnailUrl = url;
      this.thumbCache.set(item.id, url);
      return url;
    }

    // 3. Nếu chưa có thumb nhưng có ảnh gốc trong DB -> tự sinh lại thumb
    const origBlob = await getFromStore(`media:orig:${item.id}`, "mediaData");
    if (origBlob instanceof Blob) {
      const newThumbBlob = await generateImageThumbnail(origBlob).catch(() => null);
      if (newThumbBlob instanceof Blob) {
        await saveToStore(`media:thumb:${item.id}`, newThumbBlob, "mediaData");
        const url = this._createObjectUrl(newThumbBlob);
        item.thumbnailUrl = url;
        this.thumbCache.set(item.id, url);
        return url;
      }
    }

    // 4. Dự phòng: dùng URL trực tuyến
    return item.thumbnailUrl || item.url || null;
  }

  /**
   * Lấy Blob ảnh gốc (cho Áp dụng nền, Tải về, Thêm vào BST).
   * Thứ tự: RAM -> IndexedDB -> Tải mạng.
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
   * Xóa thẻ và dọn sạch Blob liên quan khỏi IndexedDB và bộ nhớ.
   */
  async deleteItem(item) {
    if (!item?.id) return;
    this.releaseItem(item.id);
    await removeFromStore(`media:orig:${item.id}`, "mediaData");
    await removeFromStore(`media:thumb:${item.id}`, "mediaData");
  }

  releaseItem(id) {
    this.blobCache.delete(id);
    this._releaseThumb(id);
  }

  _releaseThumb(id) {
    const url = this.thumbCache.get(id);
    if (!url) return;
    URL.revokeObjectURL(url);
    this._objectUrls.delete(url);
    this.thumbCache.delete(id);
  }

  _releaseAllThumbs() {
    this.thumbCache.forEach((url) => {
      URL.revokeObjectURL(url);
      this._objectUrls.delete(url);
    });
    this.thumbCache.clear();
  }

  _cacheBlob(id, blob) {
    this.blobCache.set(id, blob);
    while (this.blobCache.size > this.constructor.maxCachedBlobs) {
      this.blobCache.delete(this.blobCache.keys().next().value);
    }
    return blob;
  }

  // ─── Áp dụng hình nền ───────────────────────────────────────────────────

  isActive(item) {
    const config = getSettings().wallpaperConfig || {};
    return (
      config.source === this.providerId && config.activeWallpaperId === item.id
    );
  }

  async apply(item, { firstRun = false } = {}) {
    // Nhờ Single-Phase Pipeline, ảnh gốc đã có sẵn trong DB/RAM -> getBlob giải quyết tức thì!
    const blob = await this.getBlob(item);
    if (!blob) {
      throw new Error(
        t("wallpaper_switcher.error.no_url", "Không tìm thấy dữ liệu ảnh."),
      );
    }

    const payload = this.buildPayload(item, blob);
    await wallpaperRenderer.apply(payload, { firstRun });

    try {
      await this.persistCurrent(payload);
    } catch (error) {
      console.error(
        `[${this.id}] Failed to persist current wallpaper:`,
        error,
      );
    }
  }

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
      metadata: {
        provider: this.providerId,
        providerName: this.name,
        source: item.sourceUrl,
        url: item.url,
      },
    };
  }

  async persistCurrent(payload) {
    const key = this.constructor.storageKey;
    if (!key) return;

    const storeData = (await getFromStore(key)) || { queue: [], current: null };
    storeData.current = {
      id: payload.id,
      image: payload.image,
      blob: payload.blob,
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
