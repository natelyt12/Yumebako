import { t } from "/src/core/i18n.js";

/** @typedef {import("/src/wallpaper/core/DataControl.js").CardItem} CardItem */

/**
 * BaseSource.js
 * ---------------------------------------------------------------------------
 * Headless data-adapter contract for the Wallpaper Switcher.
 *
 * A Source knows nothing about the DOM and owns no list: it just *produces*
 * items and knows how to apply one of them as background. Which items exist,
 * in what order, for how long — that is managed by DataControl (../core/DataControl.js)
 * and persisted directly into BakoDB (src/core/db.js).
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

  constructor() {
    /** @type {boolean} Guard against concurrent fetches. */
    this.isLoading = false;
    /** @type {Set<string>} Object URLs owned by this source. */
    this._objectUrls = new Set();
  }

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

  /** Label printed on the trailing "+" item, telling what it will do. */
  get moreLabel() {
    return "";
  }

  /**
   * Whether the "+" item must be clicked to produce anything. Sources that
   * open a native file picker need this: settling on the item stays inert and
   * only a real click (a user gesture) may open the dialog.
   */
  get moreNeedsGesture() {
    return false;
  }

  /**
   * Whether the carousel should render the trailing "+" item at all.
   *
   * A source that produces items through its own control — the collection's
   * upload button in the bottom bar — gains nothing from the slot: it would
   * only take a card's worth of room to advertise an action the bar already
   * does better. The flag lives on the source, next to the other capability
   * flags; the Switcher enforces it while building the carousel's list, so the
   * engine never has to learn about provider quirks.
   */
  get showsMoreItem() {
    return true;
  }

  /**
   * Whether this provider has settings of its own (filters, an API key...)
   * that the Switcher can offer to open. Sources without any report `false` so
   * the button does not sit there doing nothing.
   */
  get hasProviderSettings() {
    return false;
  }

  /**
   * Whether the window must be re-read every time it is shown. Local feeds
   * (the collection) change from other parts of the app; remote feeds keep the
   * window they already materialized.
   */
  get isVolatile() {
    return false;
  }

  /**
   * Whether the source can be browsed right now. Sources that need user
   * configuration (e.g. an API key) report false and their tab is hidden.
   */
  get isAvailable() {
    return true;
  }

  // ─── Producing items ──────────────────────────────────────────────────────

  /**
   * @abstract
   * First item(s) of a window that has nothing yet. Usually one item: the
   * wallpaper the user already has, or a fresh one when there is none.
   * @returns {Promise<CardItem[]>} Items, in display order.
   */
  async fetchItems() {
    return [];
  }

  /**
   * @abstract
   * Next item(s), requested when the user reaches the trailing "+".
   * @returns {Promise<CardItem[]|null>} Items to append, `[]` when the feed
   *     has nothing left to give (the "+" item retires) or `null` when this
   *     round was aborted and may simply be retried (a cancelled file picker).
   */
  async fetchMore() {
    return null;
  }

  /**
   * Make sure the item can be drawn: the carousel only ever renders
   * thumbnails, never full-size images.
   * @param {CardItem} item
   * @returns {Promise<string|null>} The item's `thumbnailUrl`.
   */
  async prepareThumb(item) {
    return item?.thumbnailUrl || null;
  }

  // ─── Applying ─────────────────────────────────────────────────────────────

  /**
   * @abstract
   * Apply the given card item as the desktop background.
   * @param {CardItem} _item
   * @param {Object} [_options]
   * @param {boolean} [_options.firstRun] - Play the entrance animation instead of a fade.
   * @returns {Promise<void>}
   */
  async apply(_item, _options) {
    throw new Error(`[${this.id}] apply() must be implemented by the source.`);
  }

  /** Whether the given item is currently the applied background. */
  isActive(_item) {
    return false;
  }

  // ─── Item helpers (used by the action buttons) ────────────────────────────

  /**
   * Release whatever per-item cache this source holds. Called by the store
   * when an item leaves the window, so nothing outlives the item.
   * @param {string} _itemId
   */
  releaseItem(_itemId) {}

  /**
   * @abstract
   * Resolve the item's media as a Blob, for download / add-to-collection.
   * @param {CardItem} _item
   * @returns {Promise<Blob|null>}
   */
  async getBlob(_item) {
    return null;
  }

  /** Canonical page URL of an item, opened by the "view source" action. */
  getSourceUrl(item) {
    return item?.sourceUrl || "";
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  /**
   * Build an item in the persisted shape for carousel cards.
   * @param {Record<string, any>} raw - Raw data from the provider API.
   * @param {Partial<CardItem>}  [overrides] - Fields to override on the default card shape.
   * @returns {CardItem}
   */
  toCarouselItem(raw, overrides = {}) {
    return {
      id: String(raw?.id ?? ""),
      kind: "item",
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
      ...overrides,
    };
  }

  /** Create (and track) an object URL for a blob, or null if not a blob. */
  _createObjectUrl(blob) {
    if (!(blob instanceof Blob)) return null;
    const url = URL.createObjectURL(blob);
    this._objectUrls.add(url);
    return url;
  }
}
