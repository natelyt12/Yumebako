import { getDefaultWallpaperEffects } from "/src/core/storageHandler.js";
import { t } from "/src/core/i18n.js";
import {
  formatResolution,
  getResolutionBadge,
  formatFileSize,
} from "./cardMeta.js";

/** @typedef {import("/src/wallpaper/backend/data/DataControl.js").CardItem} CardItem */

/**
 * @typedef {Object} MetaSegment
 * @property {"text"|"author"|"badge"} type
 * @property {string} [text]
 * @property {string} [prefix]
 * @property {string} [name]
 */

/**
 * @typedef {Object} MetaData
 * @property {MetaSegment[]} segments
 * @property {string} badge
 * @property {string} resolution
 * @property {string} size
 */

/**
 * @typedef {Object} MetaDetailRow
 * @property {"text"|"link"|"resolution"|"stats"} kind
 * @property {string} key
 * @property {string} label
 * @property {string} [value]
 * @property {boolean} [stacked]
 * @property {string} [text]
 * @property {string} [url]
 * @property {string} [badge]
 * @property {Array<{ metric: string, icon: string, value: string }>} [items]
 */

/**
 * BaseSource.js
 * ---------------------------------------------------------------------------
 * Headless data-adapter contract for the Wallpaper Switcher.
 *
 * A Source knows nothing about the DOM or the desktop renderer: it produces
 * `CardItem` entries, builds pure render payloads (`getRenderPayload`), and
 * returns structured metadata descriptors (`getMetaData`, `getMetaDetails`).
 * Item lists, ordering, and persistence are managed by Layer 2 (`DataControl`).
 */
export class BaseSource {
  /** @type {string} Unique source id, also used as the i18n key suffix. */
  static id = "base";
  /** @type {string} Fallback label when no locale entry exists. */
  static label = "Source";
  /**
   * Whether items need a thumbnail generated from the full image. Enabled for
   * services without a thumbnail endpoint, so the carousel never has to decode
   * full-size bitmaps just to draw an item.
   */
  static generateThumbnail = false;

  /**
   * Maximum number of cards kept in this source's window. Remote feeds can be
   * re-fetched, so they cap their window; the local collection is user data and
   * stays unbounded.
   */
  static maxCards = Infinity;

  /** @returns {number} */
  get maxCards() {
    return this.constructor.maxCards ?? Infinity;
  }

  constructor() {
    /** @type {boolean} Guard against concurrent fetches. */
    this.isLoading = false;
    /** @type {Set<string>} Object URLs owned by this source. */
    this._objectUrls = new Set();
  }

  /** @returns {string} */
  get id() {
    return this.constructor.id;
  }

  /** Localized display name for the source tab. */
  get name() {
    return t(`wallpaper_switcher.source.${this.id}`, this.constructor.label);
  }

  /** Actions offered in the bottom button row, in display order. */
  get actions() {
    return [];
  }

  /** Whether `fetchMore()` can still produce items. */
  get canGrow() {
    return false;
  }

  /** Label of the "get more" control in the bottom bar, telling what it will do. */
  get moreLabel() {
    return "";
  }

  /**
   * Whether this provider has settings of its own (filters, an API key...)
   * that the Switcher can offer to open.
   */
  get hasProviderSettings() {
    return false;
  }

  /**
   * Whether the window must be re-read every time it is shown. Local feeds
   * (the collection) and rotating daily feeds (`bing`) change independently;
   * static remote feeds keep the window they materialized.
   */
  get isDynamic() {
    return false;
  }

  /**
   * Whether the source can be browsed right now.
   */
  get isAvailable() {
    return true;
  }

  // ─── Producing items ──────────────────────────────────────────────────────

  /**
   * @abstract
   * First item(s) of a window that has nothing yet.
   * @returns {Promise<CardItem[]>} Items, in display order.
   */
  async fetchItems() {
    return [];
  }

  /**
   * @abstract
   * Next item(s), requested when the user reaches the trailing "+".
   * @returns {Promise<CardItem[]|null>}
   */
  async fetchMore() {
    return null;
  }

  /**
   * Ensure the item has a drawable thumbnail URL.
   * @param {CardItem} item
   * @returns {Promise<string|null>} The item's `thumbnailUrl`.
   */
  async prepareThumb(item) {
    return item?.thumbnailUrl || null;
  }

  /**
   * Release a cached thumbnail Object URL for `itemId` so recovery can rebuild it.
   * @param {string|number} _itemId
   */
  releaseThumb(_itemId) {}

  /**
   * Canonical ordering for this source's window.
   * @param {CardItem[]} items
   * @returns {CardItem[]}
   */
  sortItems(items) {
    return Array.isArray(items) ? items : [];
  }

  // ─── Render Payloads & Lifecycle ──────────────────────────────────────────

  /**
   * @abstract
   * Build a pure render payload (`{ id, blob, type, effects, credit, ... }`)
   * without touching the DOM or WallpaperRenderer.
   * @param {CardItem} _item
   * @returns {Promise<Object|null>}
   */
  async getRenderPayload(_item) {
    throw new Error(
      `[${this.id}] getRenderPayload() must be implemented by the source.`,
    );
  }

  /**
   * Optional hook invoked by DataControl after the renderer commits `item`.
   * @param {CardItem} _item
   * @param {Object} _payload
   * @returns {Promise<void>|void}
   */
  async onApplied(_item, _payload) {}

  /**
   * Clear any persisted `applied` wallpaper record owned by this source.
   * @returns {Promise<void>}
   */
  async clearApplied() {}

  /**
   * Clear provider-level cached queues or feed snapshots.
   * @returns {Promise<void>}
   */
  async clearCache() {}

  /**
   * Whether the given item is currently the applied background.
   * @param {CardItem} _item
   * @returns {boolean}
   */
  isActive(_item) {
    return false;
  }

  // ─── Item helpers ─────────────────────────────────────────────────────────

  /**
   * Release per-item caches held by this source.
   * @param {string} _itemId
   */
  releaseItem(_itemId) {}

  /**
   * Delete several items at once.
   * @param {CardItem[]} items
   * @returns {Promise<void>}
   */
  async deleteItems(items) {
    if (!Array.isArray(items) || typeof this.deleteItem !== "function") {
      return;
    }
    for (const item of items) {
      await this.deleteItem(item);
    }
  }

  /**
   * @abstract
   * Resolve the item's media as a Blob, for download / add-to-collection.
   * @param {CardItem} _item
   * @returns {Promise<Blob|null>}
   */
  async getBlob(_item) {
    return null;
  }

  /**
   * Canonical page URL of an item, opened by the "view source" action.
   * @param {CardItem} item
   * @returns {string}
   */
  getSourceUrl(item) {
    return item?.sourceUrl || "";
  }

  /**
   * Attribution shown wherever the photo is displayed (e.g. Unsplash).
   * @param {CardItem} _item
   * @returns {{name: string, profileUrl: string, photoUrl: string, unsplashUrl?: string}|null}
   */
  getAttribution(_item) {
    return null;
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  /**
   * Build an item in the persisted shape for carousel cards.
   * @param {Record<string, any>} raw - Raw data from the provider API.
   * @param {Partial<CardItem>} [overrides] - Fields to override on the default card shape.
   * @returns {CardItem}
   */
  toCarouselItem(raw, overrides = {}) {
    const item = {
      id: String(raw?.id ?? ""),
      source: this.id,
      url: "",
      sourceUrl: "",
      title: "",
      category: "",
      mediaType: "image",
      thumbnailUrl: null,
      trackUrl: "",
      local: false,
      width: 0,
      height: 0,
      size: 0,
      addedAt: Date.now(),
      downloadTracked: false,
      effects: raw?.effects
        ? JSON.parse(JSON.stringify(raw.effects))
        : getDefaultWallpaperEffects(),
      ...overrides,
    };

    if (item.mediaType === "video" && item.effects?.filter) {
      item.effects.filter.bloom = 0;
    }

    return item;
  }

  /**
   * Create and track an Object URL for a Blob, or return null if invalid.
   * @param {Blob} blob
   * @returns {string|null}
   * @protected
   */
  _createObjectUrl(blob) {
    if (!(blob instanceof Blob)) return null;
    const url = URL.createObjectURL(blob);
    this._objectUrls.add(url);
    return url;
  }

  // ─── Pure Structured Metadata ─────────────────────────────────────────────

  /**
   * Return pure structured summary metadata for the collapsed chip (zero HTML).
   * @param {CardItem} card
   * @returns {MetaData|null}
   */
  getMetaData(card) {
    if (!card) return null;
    const badge = getResolutionBadge(card.width, card.height);
    const resolution = formatResolution(card.width, card.height);
    const size = formatFileSize(card.size);

    /** @type {MetaSegment[]} */
    const segments = [];
    if (size) segments.push({ type: "text", text: size });
    if (badge) segments.push({ type: "badge", text: badge });
    else if (resolution) segments.push({ type: "text", text: resolution });

    return { segments, badge, resolution, size };
  }

  /**
   * Return pure structured detail rows for the expanded card info view (zero HTML).
   * @param {CardItem} card
   * @returns {MetaDetailRow[]}
   */
  getMetaDetails(card) {
    if (!card) return [];
    /** @type {MetaDetailRow[]} */
    const details = [];

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
      value: this.name,
    });

    return details;
  }

  /**
   * Persist updated `effects` onto cached items owned by a dynamic source.
   * Dynamic sources with their own cache store override this method.
   * @param {(item: CardItem) => boolean} _matchFn
   * @param {Object} _effects
   * @returns {Promise<boolean>}
   */
  async updateCachedEffects(_matchFn, _effects) {
    return false;
  }
}
