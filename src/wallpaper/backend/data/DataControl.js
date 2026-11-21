import { createSources } from "../sources/registry.js";
import {
  getFromStore,
  saveToStore,
  removeFromStore,
} from "/src/core/db.js";
import { runMediaGC, setMediaGCDataControl } from "./mediaGC.js";
import { uniqueCards, stripCardBlobs } from "./cardUtils.js";
import { describeFetchError } from "./errors.js";
import { t } from "/src/core/i18n.js";
import {
  getCollection,
  updateCollectionItemEffects,
} from "../sources/api/collectionDb.js";
import {
  addCardsBatchToCollection,
  findCollectionEntry,
} from "../sources/sourceActions.js";
import { invalidateEffectStates } from "../effects/effectStates.js";
import {
  getSettings,
  saveSettings,
  subscribe,
  getDefaultWallpaperEffects,
} from "/src/core/storageHandler.js";

export { uniqueCards };

/**
 * Merge partial or legacy card `effects` with `getDefaultWallpaperEffects()` so
 * all five effect groups (`filter`, `position`, `wavy`, `particles`, `onload`)
 * are always complete objects before persisting or saving to settings.
 *
 * @param {Object|null|undefined} rawEffects
 * @returns {ReturnType<typeof getDefaultWallpaperEffects>}
 */
function normalizeWallpaperEffects(rawEffects) {
  const defaults = getDefaultWallpaperEffects();
  if (!rawEffects || typeof rawEffects !== "object") return defaults;

  const filter =
    rawEffects.filter && typeof rawEffects.filter === "object"
      ? { ...defaults.filter, ...rawEffects.filter }
      : defaults.filter;

  const position =
    rawEffects.position && typeof rawEffects.position === "object"
      ? { ...defaults.position, ...rawEffects.position }
      : defaults.position;

  const wavy =
    rawEffects.wavy && typeof rawEffects.wavy === "object"
      ? {
          ...defaults.wavy,
          ...rawEffects.wavy,
          config: {
            ...defaults.wavy.config,
            ...(rawEffects.wavy.config &&
            typeof rawEffects.wavy.config === "object"
              ? rawEffects.wavy.config
              : {}),
            motions: {
              ...defaults.wavy.config.motions,
              ...(rawEffects.wavy.config?.motions &&
              typeof rawEffects.wavy.config.motions === "object"
                ? rawEffects.wavy.config.motions
                : {}),
            },
          },
        }
      : defaults.wavy;

  const particles =
    rawEffects.particles && typeof rawEffects.particles === "object"
      ? {
          ...defaults.particles,
          ...rawEffects.particles,
          dynamic: Array.isArray(rawEffects.particles.dynamic)
            ? rawEffects.particles.dynamic
            : defaults.particles.dynamic,
          static: Array.isArray(rawEffects.particles.static)
            ? rawEffects.particles.static
            : defaults.particles.static,
        }
      : defaults.particles;

  const onload =
    rawEffects.onload && typeof rawEffects.onload === "object"
      ? { ...defaults.onload, ...rawEffects.onload }
      : defaults.onload;

  return {
    ...defaults,
    ...rawEffects,
    filter,
    position,
    wavy,
    particles,
    onload,
  };
}

/**
 * A single wallpaper card item managed by DataControl.
 * Produced by BaseSource.toCarouselItem() and persisted in BakoDB.
 *
 * @typedef {Object} CardItem
 * @property {string}  id           - Unique identifier for the card.
 * @property {string}  source       - The source id that owns this card.
 * @property {string}  url          - Direct URL of the full-size media.
 * @property {string}  sourceUrl    - Canonical page URL (shown by "view source").
 * @property {string}  title        - Display title / file name.
 * @property {string}  category     - Optional tag / category string.
 * @property {"image"|"video"} mediaType - Media type of the card.
 * @property {string|null} thumbnailUrl  - Low-res thumbnail URL (may be a blob:, null when not yet generated).
 * @property {string}  trackUrl     - Analytics or referral tracking URL.
 * @property {boolean} local        - true when the file lives on-device.
 * @property {number}  width        - Original media width in pixels.
 * @property {number}  height       - Original media height in pixels.
 * @property {number}  size         - File size in bytes.
 * @property {number}  addedAt      - Unix timestamp (ms) when the card was added.
 */

/**
 * Named events emitted by DataControl.
 *
 * @typedef {"source:change" | "cards:loaded" | "card:soft" | "card:hard" | "card:effects_changed" | "card:added" | "card:deleted" | "card:pruned" | "collection:updated" | "feed:exhausted" | "feed:limit_reached" | "state:change" | "error"} DataControlEvent
 */

/**
 * Snapshot returned by DataControl.getState().
 *
 * @typedef {Object} DataControlState
 * @property {string}          sourceId        - Active source id.
 * @property {string}          sourceName      - Localized source name.
 * @property {"idle"|"fetching"|"deleting"|"switching"} status - Current busy status.
 * @property {boolean}         isBusy          - True while any async operation is running.
 * @property {number}          currentIndex    - Hard-settled index.
 * @property {number}          softIndex       - Scroll-preview index.
 * @property {CardItem|null}   activeCard      - Hard-settled card (or null).
 * @property {CardItem|null}   softCard        - Scroll-preview card (or null).
 * @property {number}          cardCount       - Total number of cards in the active source.
 * @property {number}          total           - Alias for cardCount.
 * @property {CardItem[]}      items           - Shallow copy of the cards array.
 * @property {boolean}         canGrow         - Whether fetchMore() is available.
 * @property {boolean}         hasExtraSettings - Whether the source has its own settings panel.
 * @property {number}          maxCards        - Max cards capacity for this source (e.g. 20 or Infinity).
 */

/**
 * DataControl.js
 * ---------------------------------------------------------------------------
 * Layer 2: Central Single Source of Truth (SSOT) for Wallpaper Switcher state.
 *
 * Responsibilities:
 *   1. Manage active source, soft/hard indices, and deduplicated card lists.
 *   2. Read and persist sanitized card arrays in `src/core/db.js` (`appData`).
 *   3. Expose the Layer 2 facade API for Layer 1 UI and mediate render payloads
 *      & settings commits for Layer 4 (`WallpaperRenderer`).
 */
export class DataControl {
  constructor() {
    /** @type {Map<string, import("../sources/BaseSource.js").BaseSource>} */
    this.sources = new Map();
    /** @type {string|null} */
    this.activeSourceId = null;

    /** Active source wallpaper card array. @type {CardItem[]} */
    this.items = [];
    /** Hard index — settled when scrolling stops. @type {number} */
    this.currentIndex = 0;
    /** Soft index — previewed during scroll. @type {number} */
    this.softIndex = 0;

    /** @type {boolean} */
    this.isBusy = false;
    /** Guard flag set while committing active card effects into settings to prevent feedback loops. */
    this.isApplyingCardEffects = false;
    /** @type {"idle" | "fetching" | "deleting" | "switching"} */
    this.status = "idle";

    /** @type {Map<string, Set<Function>>} */
    this._listeners = new Map();

    this._switchToken = 0;
    /** @type {(() => Object)|null} */
    this._mediaMetricsProvider = null;
    /** @type {(() => Promise<Object>)|null} */
    this._mediaMetricsMeasurer = null;
    /** @type {Set<string>} */
    this._cleanedDynamicCarouselKeys = new Set();

    this._initSources();
  }

  /* ── Event Emitter (Pub / Sub) ─────────────────────────────────────────── */

  /**
   * Subscribe to a DataControl event.
   * @param {DataControlEvent} event
   * @param {(payload: any) => void} callback
   * @returns {() => void} Unsubscribe function.
   */
  on(event, callback) {
    if (!this._listeners.has(event)) {
      this._listeners.set(event, new Set());
    }
    this._listeners.get(event).add(callback);
    return () => this.off(event, callback);
  }

  /**
   * Unsubscribe a previously registered callback.
   * @param {DataControlEvent} event
   * @param {(payload: any) => void} callback
   */
  off(event, callback) {
    const set = this._listeners.get(event);
    if (set) set.delete(callback);
  }

  /**
   * Emit an event to all registered listeners.
   * @param {DataControlEvent} event
   * @param {any} payload
   */
  emit(event, payload) {
    const set = this._listeners.get(event);
    if (set) {
      set.forEach((cb) => {
        try {
          cb(payload);
        } catch (err) {
          console.error(
            `[DataControl] Error in listener for event "${event}":`,
            err,
          );
        }
      });
    }
  }

  /* ── Initialization ────────────────────────────────────────────────────── */

  /** @private */
  _initSources() {
    const sourceList = createSources();
    sourceList.forEach((src) => this.sources.set(src.id, src));
  }

  /**
   * Initialize DataControl with the saved active source and register settings listeners.
   * @returns {Promise<DataControl>}
   */
  async init() {
    const settings = getSettings();
    const defaultSource = settings.wallpaperConfig?.source || "bing";
    const initialSourceId = this.sources.has(defaultSource)
      ? defaultSource
      : "bing";

    await this.switchSource(initialSourceId);

    // Sync active card effects whenever Customize UI updates global settings.
    // Guard the synchronous initial callback that `subscribe()` fires so startup
    // does not trigger 5 redundant `updateActiveCardEffects()` writes before `card:hard`.
    let isInitialSubscribe = true;
    try {
      subscribe("wallpaperConfig", (conf) => {
        if (isInitialSubscribe || this.isApplyingCardEffects || !conf) return;
        this.updateActiveCardEffects({
          filter: {
            brightness: conf.brightness,
            blur: conf.blur,
            contrast: conf.contrast,
            saturate: conf.saturate,
            bloom: conf.bloom,
            rgbShift: conf.rgbShift,
          },
        });
      });

      subscribe("wallpaperPosition", (pos) => {
        if (isInitialSubscribe || this.isApplyingCardEffects || !pos) return;
        this.updateActiveCardEffects({ position: pos });
      });

      subscribe("wavy", (wavy) => {
        if (isInitialSubscribe || this.isApplyingCardEffects || !wavy) return;
        this.updateActiveCardEffects({ wavy });
      });

      subscribe("particles", (particles) => {
        if (isInitialSubscribe || this.isApplyingCardEffects || !particles)
          return;
        this.updateActiveCardEffects({ particles });
      });

      subscribe("onload", (onload) => {
        if (isInitialSubscribe || this.isApplyingCardEffects || !onload) return;
        this.updateActiveCardEffects({ onload });
      });
    } finally {
      isInitialSubscribe = false;
    }

    // Trigger initial desktop wallpaper render with entrance animation.
    const initialCard = this.activeCard;
    if (initialCard) {
      this.emit("card:hard", {
        index: this.currentIndex,
        card: initialCard,
        sourceId: this.activeSourceId,
        firstRun: true,
      });
    }

    return this;
  }

  /* ── State Getters ─────────────────────────────────────────────────────── */

  /** @returns {import("../sources/BaseSource.js").BaseSource|null} */
  get activeSource() {
    return this.sources.get(this.activeSourceId) || null;
  }

  /** @returns {CardItem|null} */
  get activeCard() {
    return this.items[this.currentIndex] || null;
  }

  /** @returns {CardItem|null} */
  get softCard() {
    return this.items[this.softIndex] || null;
  }

  /** @returns {number} */
  get cardCount() {
    return this.items.length;
  }

  /** @returns {Array<{ id: string, name: string, canGrow: boolean, hasExtraSettings: boolean }>} */
  get tabs() {
    return Array.from(this.sources.values()).map((src) => ({
      id: src.id,
      name: src.name,
      canGrow: src.canGrow,
      hasExtraSettings: Boolean(src.hasProviderSettings),
    }));
  }

  /**
   * Snapshot of the current DataControl state for UI monitors and action controls.
   * @returns {DataControlState}
   */
  getState() {
    return {
      sourceId: this.activeSourceId,
      sourceName: this.activeSource?.name || "",
      status: this.status,
      isBusy: this.isBusy,
      currentIndex: this.currentIndex,
      softIndex: this.softIndex,
      activeCard: this.activeCard,
      softCard: this.softCard,
      cardCount: this.cardCount,
      total: this.cardCount,
      items: [...this.items],
      canGrow: Boolean(this.activeSource?.canGrow),
      hasExtraSettings: Boolean(this.activeSource?.hasProviderSettings),
      maxCards: Number(this.activeSource?.maxCards ?? Infinity),
    };
  }

  /* ── Layer 4 Renderer Adapter & Metrics Contracts ──────────────────────── */

  /**
   * Register the Layer 4 active media geometry provider without importing `rendering/`.
   * Called by `WallpaperRenderer.bindDataControl(dataControl)`.
   *
   * @param {(() => import("../rendering/position.js").ActiveMediaMetrics)|null} provider
   */
  setMediaMetricsProvider(provider) {
    this._mediaMetricsProvider =
      typeof provider === "function" ? provider : null;
  }

  /**
   * Register the Layer 4 active media async measurer without importing `rendering/`.
   * Called by `WallpaperRenderer.bindDataControl(dataControl)`.
   *
   * @param {(() => Promise<import("../rendering/position.js").ActiveMediaMetrics>)|null} measurer
   */
  setMediaMetricsMeasurer(measurer) {
    this._mediaMetricsMeasurer =
      typeof measurer === "function" ? measurer : null;
  }

  /**
   * Return active desktop media dimensions and fit mode via Layer 4 provider.
   * @returns {import("../rendering/position.js").ActiveMediaMetrics}
   */
  getActiveMediaMetrics() {
    if (this._mediaMetricsProvider) {
      return this._mediaMetricsProvider();
    }
    return {
      width: 0,
      height: 0,
      naturalWidth: 0,
      naturalHeight: 0,
      isVideo: false,
      fitMode: getSettings().wallpaperPosition?.mode || "cover",
    };
  }

  /**
   * Measure active desktop media dimensions (probing natural image size if needed)
   * via Layer 4 without Layer 1 querying `.image` / `.video` DOM directly.
   *
   * @returns {Promise<import("../rendering/position.js").ActiveMediaMetrics>}
   */
  async measureActiveMediaMetrics() {
    if (this._mediaMetricsMeasurer) {
      return this._mediaMetricsMeasurer();
    }
    return this.getActiveMediaMetrics();
  }

  /**
   * Resolve a pure render payload from Layer 3 for `WallpaperRenderer.apply()`.
   *
   * @param {CardItem} card
   * @param {string} [sourceId=this.activeSourceId]
   * @returns {Promise<Object|null>}
   */
  async resolveRenderPayload(card, sourceId = this.activeSourceId) {
    const source = this.sources.get(sourceId) || this.activeSource;
    if (!source || !card) return null;

    const payload = await source.getRenderPayload(card);
    if (
      payload &&
      !payload.credit &&
      typeof source.getAttribution === "function"
    ) {
      payload.credit = source.getAttribution(card);
    }
    return payload;
  }

  /**
   * Commit a rendered wallpaper payload into `storageHandler.js` settings and
   * notify the owning Layer 3 source (`source.onApplied`).
   * Runs inside `isApplyingCardEffects` guard to prevent reactive write-backs.
   *
   * @param {CardItem} card
   * @param {Object} payload
   * @param {string} [sourceId=this.activeSourceId]
   * @returns {Promise<void>}
   */
  async commitAppliedCard(card, payload, sourceId = this.activeSourceId) {
    if (!card || !payload) return;

    const source = this.sources.get(sourceId) || this.activeSource;
    const resolvedSourceId = source?.id || sourceId || this.activeSourceId;
    const effects = normalizeWallpaperEffects(payload.effects || card.effects);
    const isVideo = payload.type === "video";

    this.isApplyingCardEffects = true;
    try {
      const currentConf = getSettings().wallpaperConfig || {};
      saveSettings({
        wallpaperPosition: effects.position,
        wallpaperConfig: {
          ...currentConf,
          source: resolvedSourceId || currentConf.source,
          activeWallpaperId: payload.id,
          activeCollectionItemId:
            resolvedSourceId === "collection"
              ? payload.id
              : currentConf.activeCollectionItemId,
          brightness: effects.filter?.brightness ?? 1,
          contrast: effects.filter?.contrast ?? 1,
          saturate: effects.filter?.saturate ?? 1,
          // Bloom is image-only: videos always run with it disabled.
          bloom: isVideo ? 0 : effects.filter?.bloom ?? 0,
          rgbShift: effects.filter?.rgbShift ?? 0,
          blur: effects.filter?.blur ?? 0,
          mode: effects.position?.mode || currentConf.mode || "cover",
        },
        wavy: effects.wavy,
        particles: effects.particles,
        onload: effects.onload,
      });
    } finally {
      this.isApplyingCardEffects = false;
    }

    if (typeof source?.onApplied === "function") {
      await source.onApplied(card, payload);
    }
  }

  /* ── Layer 2 Facade APIs (for Layer 1 UI) ──────────────────────────────── */

  /**
   * Recover a failed card thumbnail by evicting stale cached URLs and delegating
   * reconstruction to the owning Layer 3 source.
   *
   * @param {CardItem} card
   * @returns {Promise<string|null>}
   */
  async recoverThumbnail(card) {
    const source = this.sources.get(card?.source) || this.activeSource;
    if (!source || !card?.id) return null;

    card.thumbnailUrl = null;
    if (typeof source.releaseThumb === "function") {
      source.releaseThumb(card.id);
    }

    const url = await source.prepareThumb(card);
    return url || null;
  }

  /**
   * Clear provider-level cached queues or snapshots via the source's `clearCache()`.
   *
   * @param {string} [sourceId=this.activeSourceId]
   * @returns {Promise<boolean>}
   */
  async clearSourceCache(sourceId = this.activeSourceId) {
    const source = this.sources.get(sourceId);
    if (!source || typeof source.clearCache !== "function") return false;
    await source.clearCache();
    return true;
  }

  /**
   * Build a `Set<string>` containing all known identifiers (`entry.id`,
   * `entry.metadata.id`, `entry.metadata.wallpaperId`) present in the personal collection.
   *
   * @returns {Promise<Set<string>>}
   */
  async getCollectionIdSet() {
    const ids = new Set();
    try {
      const collection = await getCollection();
      for (const entry of collection) {
        if (!entry) continue;
        if (entry.id !== undefined && entry.id !== null && entry.id !== "") {
          ids.add(String(entry.id));
        }
        const metaId = entry.metadata?.id;
        if (metaId !== undefined && metaId !== null && metaId !== "") {
          ids.add(String(metaId));
        }
        const legacyId = entry.metadata?.wallpaperId;
        if (legacyId !== undefined && legacyId !== null && legacyId !== "") {
          ids.add(String(legacyId));
        }
      }
    } catch (err) {
      console.error("[DataControl] Failed to build collection ID set:", err);
    }
    return ids;
  }

  /**
   * Check whether a card object or card ID currently exists in the personal collection.
   *
   * @param {string|number|CardItem} idOrCard
   * @returns {Promise<boolean>}
   */
  async isInCollection(idOrCard) {
    if (idOrCard && typeof idOrCard === "object") {
      return this.isCardInCollection(idOrCard);
    }
    if (idOrCard === undefined || idOrCard === null || idOrCard === "") {
      return false;
    }
    const idSet = await this.getCollectionIdSet();
    return idSet.has(String(idOrCard));
  }

  /**
   * Copy one or more cards into the personal collection, deduplicating against
   * existing entries and within the batch, firing `trackDownloadOnce` when applicable,
   * and emitting `"collection:updated"` if at least one card was stored.
   *
   * @param {CardItem[]} cards
   * @param {import("../sources/BaseSource.js").BaseSource|null} [source=this.activeSource]
   * @returns {Promise<{ addedCount: number, skippedCount: number, failedCount: number }>}
   */
  async addCardsToCollection(cards, source = this.activeSource) {
    const result = await addCardsBatchToCollection(cards, source);
    if (result.addedCount > 0) {
      this.emit("collection:updated", {
        action: "added",
        addedCount: result.addedCount,
      });
    }
    return result;
  }

  /**
   * Import user-selected media files into the Collection via `CollectionSource.importFiles`,
   * updating active state if `"collection"` is open and emitting `"collection:updated"`.
   *
   * @param {File[]|FileList} files
   * @returns {Promise<{ addedCards: CardItem[], warnings: Array<{ file: string, code: string }>, errors: Array<{ file: string, code: string, cause?: unknown }> }>}
   */
  async importCollectionFiles(files) {
    const collectionSource = this.sources.get("collection");
    if (
      !collectionSource ||
      typeof collectionSource.importFiles !== "function"
    ) {
      return { addedCards: [], warnings: [], errors: [] };
    }

    const result = await collectionSource.importFiles(files);
    if (result.addedCards.length > 0) {
      if (this.activeSourceId === "collection") {
        const activeIdBefore = this.activeCard?.id ?? null;
        const merged = uniqueCards([...this.items, ...result.addedCards]);
        this.items =
          typeof collectionSource.sortItems === "function"
            ? collectionSource.sortItems(merged)
            : merged;

        if (activeIdBefore != null) {
          const sortedIndex = this.items.findIndex(
            (item) => String(item.id) === String(activeIdBefore),
          );
          if (sortedIndex >= 0) {
            this.currentIndex = sortedIndex;
            this.softIndex = sortedIndex;
          }
        }

        this.emit("card:added", {
          newCard: result.addedCards[0] || null,
          addedCards: result.addedCards,
          allCards: this.items,
          index: this.items.length - 1,
          prunedCard: null,
        });
        this._notifyState();
      }

      this.emit("collection:updated", {
        action: "imported",
        addedCards: result.addedCards,
      });
    }

    return result;
  }

  /* ── Source Switching ──────────────────────────────────────────────────── */

  /**
   * Switch the active wallpaper source tab to `sourceId`.
   * @param {string} sourceId
   * @param {number|null} [targetIndex=null]
   * @returns {Promise<void>}
   */
  async switchSource(sourceId, targetIndex = null) {
    if (!this.sources.has(sourceId)) {
      console.warn(`[DataControl] Source [${sourceId}] not found.`);
      return;
    }

    const switchToken = ++this._switchToken;

    this.activeSourceId = sourceId;
    this.isBusy = true;
    this.status = "switching";
    this._notifyState();

    this.emit("source:change", {
      sourceId,
      source: this.activeSource,
    });

    let storedItems = [];
    /** Only lists loaded from `carousel:*` should be written back on self-heal. */
    let storedInCarousel = false;

    if (this.activeSource?.isDynamic) {
      // Dynamic sources (`collection`, `bing`) own their authoritative DB store;
      // clean up any legacy `carousel:${sourceId}` snapshot once per session.
      if (!this._cleanedDynamicCarouselKeys.has(sourceId)) {
        this._cleanedDynamicCarouselKeys.add(sourceId);
        void removeFromStore(`carousel:${sourceId}`);
      }

      try {
        const fetched = await this.activeSource.fetchItems();
        if (this._switchToken !== switchToken) return;
        if (Array.isArray(fetched)) {
          storedItems = fetched.filter(Boolean);
        }
      } catch (err) {
        if (this._switchToken !== switchToken) return;
        console.error(
          `[DataControl] Failed to fetch items for volatile source [${sourceId}]:`,
          err,
        );
      }
    } else {
      // Load persisted card list from BakoDB (`appData`).
      const rawStored = await getFromStore(`carousel:${sourceId}`);
      if (this._switchToken !== switchToken) return;
      storedItems = Array.isArray(rawStored) ? rawStored.filter(Boolean) : [];
      storedInCarousel = true;

      // Rebuild valid session Object URLs for card thumbnails.
      if (
        this.activeSource &&
        typeof this.activeSource.prepareThumb === "function"
      ) {
        await Promise.all(
          storedItems.map((item) =>
            this.activeSource.prepareThumb(item).catch(() => null),
          ),
        );
        if (this._switchToken !== switchToken) return;
      }
    }

    if (this._switchToken !== switchToken) return;

    storedItems = storedItems.map((item) => {
      if (item) {
        item.effects = normalizeWallpaperEffects(item.effects);
      }
      return item;
    });

    // Deduplicate card IDs before entering the strip or persisting.
    const unique = uniqueCards(storedItems);

    // Self-heal persisted lists that contained legacy duplicate records.
    if (unique.length !== storedItems.length && storedInCarousel) {
      console.warn(
        `[DataControl] Dropped ${storedItems.length - unique.length} duplicate card(s) from [${sourceId}].`,
      );
      await this._persistCards(sourceId, unique);
      if (this._switchToken !== switchToken) return;
    }

    // Apply canonical source ordering (e.g. Collection sort mode).
    this.items =
      typeof this.activeSource?.sortItems === "function"
        ? this.activeSource.sortItems(unique)
        : unique;

    // Resolve target index.
    let resolvedIndex = targetIndex;
    if (resolvedIndex === null || resolvedIndex === undefined) {
      const settings = getSettings();
      const config = settings.wallpaperConfig || {};
      const switcher = settings.wallpaperSwitcher || {};

      // 1. If this source owns the active desktop wallpaper, focus that card.
      if (config.source === sourceId) {
        const activeId =
          sourceId === "collection"
            ? config.activeCollectionItemId || config.activeWallpaperId
            : config.activeWallpaperId;
        if (activeId) {
          const found = this.items.findIndex((item) => item.id === activeId);
          if (found !== -1) {
            resolvedIndex = found;
          }
        }
      }

      // 2. Otherwise fall back to the saved per-source cursor index.
      if (resolvedIndex === null || resolvedIndex === undefined) {
        const savedIndex = switcher.sourceIndices?.[sourceId];
        if (typeof savedIndex === "number" && savedIndex >= 0) {
          resolvedIndex = savedIndex;
        }
      }

      // 3. Fallback to index 0.
      if (resolvedIndex === null || resolvedIndex === undefined) {
        resolvedIndex = 0;
      }
    }

    // Enforce `maxCards` cap on load so strip and counter match immediately.
    const cursorId = this.items[resolvedIndex]?.id ?? null;
    if (await this._trimToCap(sourceId)) {
      if (cursorId != null) {
        const found = this.items.findIndex(
          (item) => String(item.id) === String(cursorId),
        );
        if (found >= 0) resolvedIndex = found;
      }
    }

    this.currentIndex = Math.max(
      0,
      Math.min(resolvedIndex, Math.max(0, this.items.length - 1)),
    );
    this.softIndex = this.currentIndex;

    this.isBusy = false;
    this.status = "idle";
    this._notifyState();

    this.emit("cards:loaded", {
      sourceId,
      items: this.items,
      selectedIndex: this.currentIndex,
      source: this.activeSource,
    });
  }

  /* ── Navigation & Selection ────────────────────────────────────────────── */

  /**
   * Update `softIndex` while the carousel is scrolling past cards.
   * @param {number} index
   */
  setSoftIndex(index) {
    if (this.softIndex === index) return;

    this.softIndex = index;
    const card =
      index >= 0 && index < this.items.length ? this.items[index] : null;

    this.emit("card:soft", {
      index,
      card,
    });
    this._notifyState();
  }

  /**
   * Settle `currentIndex` and emit `card:hard` so Layer 4 renders the card.
   * @param {number} index
   */
  setHardIndex(index) {
    if (this.items.length === 0 || index < 0 || index >= this.items.length)
      return;

    this.currentIndex = index;
    this.softIndex = index;

    const card = this.items[index] || null;
    if (card && !card.effects) {
      card.effects = getDefaultWallpaperEffects();
    }

    // Persist switcher cursor index; active wallpaper config and effects are
    // committed by `DataControl.commitAppliedCard()` once the renderer finishes
    // fading the overlay and decoding the image.
    const currentSettings = getSettings();
    const currentSwitcher = currentSettings.wallpaperSwitcher || {};
    const sourceIndices = { ...(currentSwitcher.sourceIndices || {}) };
    sourceIndices[this.activeSourceId] = index;

    saveSettings({
      wallpaperSwitcher: {
        ...currentSwitcher,
        activeSource: this.activeSourceId,
        sourceIndices,
      },
    });

    this.emit("card:hard", {
      index,
      card,
      sourceId: this.activeSourceId,
    });
    this._notifyState();
  }

  /* ── Fetch More & FIFO Cap Management ──────────────────────────────────── */

  /**
   * Schedule background Media Garbage Collection in `mediaData`.
   * @private
   */
  _scheduleMediaGC() {
    if (
      typeof window !== "undefined" &&
      typeof window.requestIdleCallback === "function"
    ) {
      window.requestIdleCallback(
        () => runMediaGC({ dataControl: this }),
        { timeout: 4000 },
      );
    } else {
      setTimeout(() => runMediaGC({ dataControl: this }), 1000);
    }
  }

  /**
   * Determine the oldest prunable card index under FIFO eviction,
   * never evicting the card currently applied to the desktop.
   *
   * @returns {number|null} Candidate index, or null if no card can be pruned.
   */
  getPruneCandidateIndex() {
    if (this.items.length === 0) return null;

    const wallpaperConfig = getSettings().wallpaperConfig || {};
    const isDesktopSource = wallpaperConfig.source === this.activeSourceId;
    const appliedId = isDesktopSource
      ? wallpaperConfig.activeWallpaperId ||
        wallpaperConfig.activeCollectionItemId
      : null;

    let pruneIndex = 0;
    if (appliedId && this.items[0]?.id === appliedId && this.items.length > 1) {
      pruneIndex = 1;
    }

    if (appliedId && this.items[pruneIndex]?.id === appliedId) {
      return null;
    }

    return pruneIndex;
  }

  /**
   * Trim the active source's window down to `maxCards` (oldest first).
   *
   * @param {string} sourceId
   * @returns {Promise<boolean>} true when at least one card was dropped.
   * @private
   */
  async _trimToCap(sourceId) {
    const cap = Number(this.activeSource?.maxCards);
    if (!Number.isFinite(cap) || this.items.length <= cap) return false;

    let pruned = 0;
    while (this.items.length > cap) {
      const pruneIndex = this.getPruneCandidateIndex();
      if (
        pruneIndex === null ||
        pruneIndex < 0 ||
        pruneIndex >= this.items.length
      ) {
        break;
      }

      const [candidate] = this.items.splice(pruneIndex, 1);
      if (typeof this.activeSource?.deleteItem === "function") {
        await this.activeSource.deleteItem(candidate);
      }
      pruned++;
    }

    if (pruned === 0) return false;

    await this._persistCards(sourceId, this.items);
    this._scheduleMediaGC();
    return true;
  }

  /**
   * Request more items from the active source, enforcing FIFO cap eviction when needed.
   *
   * @param {Object} [options]
   * @param {(card: CardItem, index: number) => Promise<void>|void} [options.onPruneActive]
   * @returns {Promise<CardItem|null>} First newly added card, or null if exhausted/aborted/errored.
   */
  async requestMore({ onPruneActive } = {}) {
    if (this.isBusy || !this.activeSource?.canGrow) return null;

    const currentSourceId = this.activeSourceId;
    this.isBusy = true;
    this.status = "fetching";
    this._notifyState();

    try {
      const newItems = await this.activeSource.fetchMore();
      if (this.activeSourceId !== currentSourceId) return null;

      if (!newItems || newItems.length === 0) {
        this.emit("feed:exhausted", { sourceId: this.activeSourceId });
        return null;
      }

      const validFresh = newItems.filter(Boolean);

      // Deduplicate against existing cards and within the new batch itself.
      const existingIds = new Set(this.items.map((item) => String(item.id)));
      const uniqueFresh = validFresh.filter((item) => {
        const key = String(item.id);
        if (existingIds.has(key)) return false;
        existingIds.add(key);
        return true;
      });

      if (uniqueFresh.length === 0) {
        this.emit("feed:exhausted", { sourceId: this.activeSourceId });
        return null;
      }

      // Apply FIFO eviction when appending would exceed `maxCards`.
      const cap = Number(this.activeSource?.maxCards);
      let prunedCard = null;
      if (Number.isFinite(cap)) {
        while (
          this.items.length + uniqueFresh.length > cap &&
          this.items.length > 0
        ) {
          const pruneIndex = this.getPruneCandidateIndex();
          if (
            pruneIndex === null ||
            pruneIndex < 0 ||
            pruneIndex >= this.items.length
          )
            break;

          const candidate = this.items[pruneIndex];
          const isPruningCurrent = pruneIndex === this.currentIndex;

          if (isPruningCurrent && typeof onPruneActive === "function") {
            await onPruneActive(candidate, pruneIndex);
          }

          if (typeof this.activeSource?.deleteItem === "function") {
            await this.activeSource.deleteItem(candidate);
          }

          this.items.splice(pruneIndex, 1);
          prunedCard = candidate;

          if (pruneIndex <= this.currentIndex) {
            this.currentIndex = Math.max(0, this.currentIndex - 1);
            this.softIndex = Math.max(0, this.softIndex - 1);
          }
        }
      }

      const activeIdBeforeFetch = this.activeCard?.id ?? null;
      this.items.push(...uniqueFresh);

      // Re-apply source ordering while keeping the cursor pinned to the active card ID.
      if (typeof this.activeSource?.sortItems === "function") {
        this.items = this.activeSource.sortItems(this.items);
        if (activeIdBeforeFetch != null) {
          const sortedIndex = this.items.findIndex(
            (item) => String(item.id) === String(activeIdBeforeFetch),
          );
          if (sortedIndex >= 0) {
            this.currentIndex = sortedIndex;
            this.softIndex = sortedIndex;
          }
        }
      }

      await this._persistCards(this.activeSourceId, this.items);

      if (prunedCard) {
        const currentSwitcher = getSettings().wallpaperSwitcher || {};
        const sourceIndices = { ...(currentSwitcher.sourceIndices || {}) };
        sourceIndices[this.activeSourceId] = this.currentIndex;
        saveSettings({
          wallpaperSwitcher: {
            ...currentSwitcher,
            sourceIndices,
          },
        });

        this._scheduleMediaGC();
        this.emit("card:pruned", {
          prunedCard,
          sourceId: this.activeSourceId,
          total: this.items.length,
        });
      }

      const latestCard = uniqueFresh[0] || null;
      this.emit("card:added", {
        newCard: latestCard,
        addedCards: uniqueFresh,
        allCards: this.items,
        index: this.items.length - 1,
        prunedCard,
      });

      return latestCard;
    } catch (err) {
      console.error(
        `[DataControl] Error fetching more from [${this.activeSourceId}]:`,
        err,
      );
      this.emit("error", {
        action: "fetchMore",
        sourceId: this.activeSourceId,
        error: err,
        message: describeFetchError(err, t) || "Không thể lấy thêm ảnh mới",
      });
      return null;
    } finally {
      this.isBusy = false;
      this.status = "idle";
      this._notifyState();
    }
  }

  /* ── History Cleanup & Deletion ────────────────────────────────────────── */

  /**
   * Clear carousel browse history for a static remote source `sourceId`.
   * Preserves the single card currently applied to the desktop if any.
   * Guarded against dynamic sources (`collection`, `bing`) whose items are not
   * stored in `carousel:*` history.
   *
   * @param {string} [sourceId=this.activeSourceId]
   * @returns {Promise<boolean>}
   */
  async clearSourceHistory(sourceId = this.activeSourceId) {
    if (this.isBusy || !sourceId) return false;

    const source = this.sources.get(sourceId);
    if (!source || source.isDynamic) return false;

    this.isBusy = true;
    this.status = "deleting";
    this._notifyState();

    try {
      const isCurrentlyActive = this.activeSourceId === sourceId;
      let itemsToProcess = [];

      if (isCurrentlyActive) {
        itemsToProcess = [...this.items];
      } else {
        const rawStored = await getFromStore(`carousel:${sourceId}`);
        itemsToProcess = Array.isArray(rawStored)
          ? rawStored.filter(Boolean)
          : [];
      }

      if (itemsToProcess.length === 0) {
        return true;
      }

      const wallpaperConfig = getSettings().wallpaperConfig || {};
      const isDesktopSource = wallpaperConfig.source === sourceId;
      const appliedId = isDesktopSource
        ? wallpaperConfig.activeWallpaperId ||
          wallpaperConfig.activeCollectionItemId
        : null;

      let preservedCard = null;
      if (appliedId) {
        preservedCard = itemsToProcess.find((c) => c?.id === appliedId) || null;
      }

      const removedCards = itemsToProcess.filter((c) => c !== preservedCard);

      for (const card of removedCards) {
        if (typeof source?.deleteItem === "function") {
          await source.deleteItem(card);
        }
      }

      const remainingCards = preservedCard ? [preservedCard] : [];
      await this._persistCards(sourceId, remainingCards);

      this._scheduleMediaGC();

      const currentSwitcher = getSettings().wallpaperSwitcher || {};
      const sourceIndices = { ...(currentSwitcher.sourceIndices || {}) };
      sourceIndices[sourceId] = 0;
      saveSettings({
        wallpaperSwitcher: {
          ...currentSwitcher,
          sourceIndices,
        },
      });

      if (isCurrentlyActive) {
        this.items = remainingCards;
        this.currentIndex = 0;
        this.softIndex = 0;

        this.emit("cards:loaded", {
          sourceId,
          items: this.items,
          currentIndex: 0,
        });
      }

      return true;
    } catch (err) {
      console.error(
        `[DataControl] Error clearing source history for [${sourceId}]:`,
        err,
      );
      this.emit("error", {
        action: "clearSourceHistory",
        sourceId,
        error: err,
        message: err?.message || "Lỗi khi dọn dẹp lịch sử",
      });
      return false;
    } finally {
      this.isBusy = false;
      this.status = "idle";
      this._notifyState();
    }
  }

  /**
   * Delete a card from the active list and release its underlying resources.
   *
   * @param {number} [targetIndex=this.currentIndex]
   * @param {Object} [options]
   * @param {boolean} [options.preserveCursor=false] - Keep the active cursor on its
   *   current card when deleting a non-active card (used by Manage Grid).
   * @returns {Promise<boolean>}
   */
  async deleteCard(
    targetIndex = this.currentIndex,
    { preserveCursor = false } = {},
  ) {
    if (this.isBusy || this.items.length === 0) return false;
    if (targetIndex < 0 || targetIndex >= this.items.length) return false;

    this.isBusy = true;
    this.status = "deleting";
    this._notifyState();

    const cardToDelete = this.items[targetIndex];

    try {
      if (typeof this.activeSource?.deleteItem === "function") {
        await this.activeSource.deleteItem(cardToDelete);
      }

      this.items.splice(targetIndex, 1);
      await this._persistCards(this.activeSourceId, this.items);

      // Clear persisted `applied` record when the list becomes empty so deleted cards do not respawn.
      if (
        this.items.length === 0 &&
        typeof this.activeSource?.clearApplied === "function"
      ) {
        await this.activeSource.clearApplied();
      }

      const previousIndex = this.currentIndex;
      let nextIndex;
      if (preserveCursor && targetIndex !== previousIndex) {
        nextIndex =
          targetIndex < previousIndex ? previousIndex - 1 : previousIndex;
      } else {
        nextIndex = targetIndex > 0 ? targetIndex - 1 : 0;
      }
      nextIndex = Math.max(0, Math.min(nextIndex, this.items.length - 1));
      this.currentIndex = nextIndex;
      this.softIndex = nextIndex;

      const currentSwitcher = getSettings().wallpaperSwitcher || {};
      const sourceIndices = { ...(currentSwitcher.sourceIndices || {}) };
      sourceIndices[this.activeSourceId] = nextIndex;
      saveSettings({
        wallpaperSwitcher: {
          ...currentSwitcher,
          sourceIndices,
        },
      });

      this.emit("card:deleted", {
        deletedCard: cardToDelete,
        deletedIndex: targetIndex,
        remainingItems: this.items,
        newIndex: nextIndex,
      });

      if (this.activeSourceId === "collection") {
        this.emit("collection:updated", {
          action: "deleted",
          deletedCard: cardToDelete,
        });
      }

      return true;
    } catch (err) {
      console.error(
        `[DataControl] Error deleting card from [${this.activeSourceId}]:`,
        err,
      );
      this.emit("error", {
        action: "deleteCard",
        sourceId: this.activeSourceId,
        error: err,
        message: err?.message || "Lỗi khi xóa thẻ",
      });
      return false;
    } finally {
      this.isBusy = false;
      this.status = "idle";
      this._notifyState();
    }
  }

  /**
   * Delete multiple cards in a single batch (one source transaction, one persist,
   * one `card:deleted` event).
   *
   * @param {number[]} indices - Card indices to delete from `this.items`.
   * @returns {Promise<boolean>}
   */
  async deleteCards(indices = []) {
    if (this.isBusy || this.items.length === 0) return false;

    const uniqueIndices = [...new Set(indices)]
      .filter(
        (index) =>
          Number.isInteger(index) && index >= 0 && index < this.items.length,
      )
      .sort((a, b) => a - b);
    if (uniqueIndices.length === 0) return false;

    this.isBusy = true;
    this.status = "deleting";
    this._notifyState();

    const activeId = this.activeCard?.id ?? null;
    const cardsToDelete = uniqueIndices.map((index) => this.items[index]);
    const firstRemoved = uniqueIndices[0];

    try {
      if (typeof this.activeSource?.deleteItems === "function") {
        await this.activeSource.deleteItems(cardsToDelete);
      } else if (typeof this.activeSource?.deleteItem === "function") {
        for (const card of cardsToDelete) {
          await this.activeSource.deleteItem(card);
        }
      }

      const removed = new Set(uniqueIndices);
      this.items = this.items.filter((_, index) => !removed.has(index));
      await this._persistCards(this.activeSourceId, this.items);

      if (
        this.items.length === 0 &&
        typeof this.activeSource?.clearApplied === "function"
      ) {
        await this.activeSource.clearApplied();
      }

      let nextIndex;
      if (activeId != null) {
        const stillThere = this.items.findIndex(
          (item) => String(item.id) === String(activeId),
        );
        nextIndex =
          stillThere >= 0 ? stillThere : Math.max(0, firstRemoved - 1);
      } else {
        nextIndex = Math.max(0, firstRemoved - 1);
      }
      nextIndex = Math.max(
        0,
        Math.min(nextIndex, Math.max(0, this.items.length - 1)),
      );
      this.currentIndex = nextIndex;
      this.softIndex = nextIndex;

      const currentSwitcher = getSettings().wallpaperSwitcher || {};
      const sourceIndices = { ...(currentSwitcher.sourceIndices || {}) };
      sourceIndices[this.activeSourceId] = nextIndex;
      saveSettings({
        wallpaperSwitcher: {
          ...currentSwitcher,
          sourceIndices,
        },
      });

      this.emit("card:deleted", {
        deletedCards: cardsToDelete,
        deletedIndices: uniqueIndices,
        remainingItems: this.items,
        newIndex: nextIndex,
      });

      if (this.activeSourceId === "collection") {
        this.emit("collection:updated", {
          action: "deleted",
          deletedCards: cardsToDelete,
        });
      }

      return true;
    } catch (err) {
      console.error(
        `[DataControl] Error deleting cards from [${this.activeSourceId}]:`,
        err,
      );
      this.emit("error", {
        action: "deleteCards",
        sourceId: this.activeSourceId,
        error: err,
        message: err?.message || "Lỗi khi xóa thẻ",
      });
      return false;
    } finally {
      this.isBusy = false;
      this.status = "idle";
      this._notifyState();
    }
  }

  /* ── Collection & Effects Synchronization ──────────────────────────────── */

  /**
   * Locate the collection entry matching `card`, if any.
   *
   * @param {CardItem} card
   * @returns {Promise<Object|null>}
   */
  async findCollectionEntryFor(card) {
    if (!card) return null;

    try {
      const collection = await getCollection();
      if (card.source === "collection") {
        return (
          collection.find((it) => it && String(it.id) === String(card.id)) ||
          null
        );
      }
      const cardSource =
        (card.source && this.sources.get(card.source)) || this.activeSource;
      return findCollectionEntry(card, cardSource, collection);
    } catch (err) {
      console.error("[DataControl] Failed to read collection:", err);
      return null;
    }
  }

  /**
   * Whether `card` currently has a copy in the personal collection.
   *
   * @param {CardItem} card
   * @returns {Promise<boolean>}
   */
  async isCardInCollection(card) {
    if (!card) return false;
    return Boolean(await this.findCollectionEntryFor(card));
  }

  /**
   * Mirror a card's effect profile onto its saved collection copy.
   * @param {CardItem} card
   * @private
   */
  async _syncCollectionEffects(card) {
    if (!card?.effects) return;

    try {
      if (this.activeSourceId === "collection") {
        await updateCollectionItemEffects(card.id, card.effects);
        return;
      }
      const entry = await this.findCollectionEntryFor(card);
      if (entry) await updateCollectionItemEffects(entry.id, card.effects);
    } catch (err) {
      console.error(
        "[DataControl] Error syncing collection item effects:",
        err,
      );
    }
  }

  /**
   * Merge partial effect changes into the active card, re-sort, persist,
   * sync to collection, and emit `card:effects_changed`.
   *
   * @param {Object} partialEffects
   * @returns {Promise<void>}
   */
  async updateActiveCardEffects(partialEffects) {
    const card = this.activeCard;
    if (!card) return;

    if (!card.effects) {
      card.effects = getDefaultWallpaperEffects();
    }

    for (const [key, val] of Object.entries(partialEffects)) {
      if (val && typeof val === "object" && !Array.isArray(val)) {
        card.effects[key] = { ...(card.effects[key] || {}), ...val };
      } else {
        card.effects[key] = val;
      }
    }

    // Bloom is image-only: strip it whenever a video profile is updated.
    if (card.mediaType === "video" && card.effects.filter) {
      card.effects.filter.bloom = 0;
    }

    invalidateEffectStates(card.effects);
    this.sortCurrentItems();

    if (this.activeSourceId) {
      await this._persistCards(this.activeSourceId, this.items);
    }

    await this._syncCollectionEffects(card);

    this.emit("card:effects_changed", {
      card,
      effects: card.effects,
      index: this.currentIndex,
    });
  }

  /**
   * Reset all 5 effect groups on the active card to defaults, save into
   * settings under `isApplyingCardEffects`, and emit `card:effects_changed`
   * so Layer 4 (`WallpaperRenderer`) updates filters and position immediately.
   *
   * @returns {Promise<boolean>} `true` when an active card was reset.
   */
  async resetActiveCardEffects() {
    const card = this.activeCard;
    if (!card) return false;

    const defaults = getDefaultWallpaperEffects();
    card.effects = defaults;

    this.sortCurrentItems();

    if (this.activeSourceId) {
      await this._persistCards(this.activeSourceId, this.items);
    }

    await this._syncCollectionEffects(card);

    // Guard against DataControl's own settings subscribers writing back into the card.
    this.isApplyingCardEffects = true;
    try {
      const conf = getSettings().wallpaperConfig || {};
      saveSettings({
        wallpaperConfig: {
          ...conf,
          brightness: defaults.filter.brightness,
          contrast: defaults.filter.contrast,
          saturate: defaults.filter.saturate,
          bloom: defaults.filter.bloom,
          rgbShift: defaults.filter.rgbShift,
          blur: defaults.filter.blur,
        },
        wallpaperPosition: defaults.position,
        particles: defaults.particles,
        wavy: defaults.wavy,
        onload: { ...defaults.onload },
      });
    } finally {
      this.isApplyingCardEffects = false;
    }

    // Layer 4 WallpaperRenderer listens for `card:effects_changed` to apply
    // filter & position CSS without Layer 2 importing rendering modules.
    this.emit("card:effects_changed", {
      card,
      effects: card.effects,
      index: this.currentIndex,
      reset: true,
    });

    return true;
  }

  /**
   * Re-sort `this.items` using the active source's ordering (Collection only)
   * and keep `currentIndex` / `softIndex` aligned with the active card.
   */
  sortCurrentItems() {
    if (!Array.isArray(this.items) || this.items.length <= 1) return;
    if (
      this.activeSourceId !== "collection" ||
      typeof this.activeSource?.sortItems !== "function"
    ) {
      return;
    }

    const currentCard = this.activeCard;
    this.items = this.activeSource.sortItems(this.items);

    if (currentCard) {
      const nextIndex = this.items.findIndex(
        (c) => String(c.id) === String(currentCard.id),
      );
      if (nextIndex !== -1 && nextIndex !== this.currentIndex) {
        this.currentIndex = nextIndex;
        this.softIndex = nextIndex;
        if (this.activeSourceId) {
          const currentSwitcher = getSettings().wallpaperSwitcher || {};
          const sourceIndices = { ...(currentSwitcher.sourceIndices || {}) };
          sourceIndices[this.activeSourceId] = this.currentIndex;
          saveSettings({
            wallpaperSwitcher: {
              ...currentSwitcher,
              sourceIndices,
            },
          });
        }
      }
    }
  }

  /**
   * Re-apply the active source's ordering to the window without re-reading the store.
   * @returns {Promise<void>}
   */
  async sortActiveItems() {
    if (!Array.isArray(this.items) || this.items.length <= 1) return;

    const cursorId = this.activeCard?.id ?? null;
    this.sortCurrentItems();

    if (this.activeSourceId) {
      await this._persistCards(this.activeSourceId, this.items);
    }

    if (cursorId != null) {
      const next = this.items.findIndex(
        (item) => String(item.id) === String(cursorId),
      );
      if (next >= 0) {
        this.currentIndex = next;
        this.softIndex = next;
      }
    }

    this._notifyState();
    this.emit("cards:loaded", {
      sourceId: this.activeSourceId,
      items: this.items,
      selectedIndex: this.currentIndex,
      source: this.activeSource,
    });
  }

  /**
   * Persist deduplicated, blob-free cards to `carousel:${sourceId}` for static sources.
   * Skips dynamic sources (`collection`, `bing`) whose items live in their own DB stores.
   *
   * @param {string} sourceId
   * @param {CardItem[]} cards
   * @returns {Promise<void>}
   * @private
   */
  async _persistCards(sourceId, cards) {
    const source = this.sources.get(sourceId);
    if (source?.isDynamic) return;

    const cleanCards = uniqueCards(cards).map(stripCardBlobs);
    await saveToStore(`carousel:${sourceId}`, cleanCards);
  }

  /** @private */
  _notifyState() {
    this.emit("state:change", this.getState());
  }
}

export const dataControl = new DataControl();
setMediaGCDataControl(dataControl);
