import { translateDOM, t } from "/src/core/i18n.js";
import { renderIcons } from "/src/core/icon.js";
import {
  getSettings,
  saveSettings,
  getDefaultWallpaperEffects,
} from "/src/core/storageHandler.js";
import { showNotification } from "/src/core/ui.js";
import { createSources } from "../sources/index.js";
import { ITEM_STATE, isMoreItem } from "../stores/carouselSchema.js";
import { SwitcherStore } from "../stores/SwitcherStore.js";
import { migrateCarouselStores } from "../stores/migration.js";
import { SourceTabs } from "../ui/SourceTabs.js";
import { SourceActions } from "../ui/SourceActions.js";
import { CarouselTrack } from "../ui/CarouselTrack.js";

import switcherHtml from "../ui/switcher.html?raw";
import "../ui/switcher.css";

/**
 * WallpaperSwitcher.js
 * ---------------------------------------------------------------------------
 * Standalone bottom Wallpaper Switcher (Alt + W).
 *
 * Thin orchestrator assembling three pieces:
 *   - SourceTabs (./components)     — which source to browse
 *   - CarouselTrack (./components)  — how cards are laid out and navigated
 *   - SourceActions (./components)  — what can be done with the centered item
 *   - Sources (./sources)           — where the wallpapers actually come from
 *
 * Its own job is limited to lifecycle (open/close), keyboard shortcuts, and
 * turning a settled carousel card into an applied wallpaper.
 */

const SELECTED_WIDTH = 600;
const GAP = 12;
/** Must match the `.is_swapping` transition duration in switcher.css. */
const SWAP_OUT_MS = 260;
/** Minimum delay between two fetches from the same source. */
const GROW_COOLDOWN_MS = 3000;
/** Refresh rate of the cooldown countdown shown on the "+" card. */
const COOLDOWN_TICK_MS = 150;

export class WallpaperSwitcher {
  constructor() {
    this.isOpen = false;
    this._applyToken = 0;
    this._isInitialized = false;
    /** True while a source swap animation is in flight. */
    this._isSwapping = false;

    // Per-source rate limit on fetching: source id -> timestamp it expires.
    this._growCooldowns = new Map();
    this._cooldownTimer = null;

    // Source adapters (Collection, Wallhaven, Unsplash, Picre...) — see ./sources/registry.js
    this.sources = createSources();
    /** @type {Map<string, SwitcherStore>} One card window per source. */
    this.stores = new Map();
    // Resolved from the applied wallpaper once the DOM exists (see init).
    this.activeSourceId = null;

    this.container = null;
    this.carouselEl = null;
    this.carousel = null;
    this.sourceTabs = null;
    this.actions = null;
    this.toggleBtn = null;
  }

  async init() {
    this.toggleBtn = document.getElementById("wallpaper_toggle_btn");
    this.container = document.getElementById("wallpaper_switcher");
    if (!this.container || !this.toggleBtn) return;

    // Inject dynamic HTML template
    this.container.innerHTML = switcherHtml;

    this.carouselEl = this.container.querySelector(
      ".wallpaper_carousel_container",
    );

    this.carousel = new CarouselTrack({
      container: this.container,
      track: this.container.querySelector("#wallpaper_carousel_track"),
      selectedWidth: SELECTED_WIDTH,
      gap: GAP,
      onSettle: () => this.handleSettle(),
      onMoreAction: () => this.growSource(),
      onCardThumbError: (card) => this.recoverThumbnail(card),
    });

    this.actions = new SourceActions({
      container: this.container.querySelector("#wallpaper_switcher_actions"),
    });

    this.bindEvents();

    // Card stores: carry the legacy records over once, then collect whatever
    // an earlier run left unreachable (a card dropped mid-write, a list
    // written by an older build...). Awaited on purpose — the sweep reads the
    // stores, so nothing may be writing them at the same time.
    try {
      const report = await migrateCarouselStores();
      if (report.migrated.length || report.failed.length || report.swept) {
        console.info("[WallpaperSwitcher] Card stores:", report);
      }
    } catch (error) {
      console.error("[WallpaperSwitcher] Card store startup failed:", error);
    }

    // Listen for collection changes across the app
    window.addEventListener("wallpaper-collection-updated", () => {
      if (!this.isOpen || this.activeSourceId !== "collection") return;

      const store = this.getStore("collection");
      // The switcher's own upload/delete already refresh the window; doing
      // it again mid-action would redraw a list that is still changing.
      if (store.isMutating || this.activeSource.isLoading) return;

      this.loadSource("collection", { refresh: true });
    });

    // Build the source tab bar, then render the applied source. Resolve the
    // id once and assign it, so the highlighted tab and the loaded source
    // can never disagree.
    const initialSourceId = this.resolveInitialSourceId();
    this.activeSourceId = initialSourceId;

    this.sourceTabs = new SourceTabs({
      container: this.container.querySelector("#wallpaper_source_tabs"),
      sources: this.availableSources,
      activeId: initialSourceId,
      onChange: (id) => this.selectSource(id),
    }).render();

    await this.loadSource(this.activeSourceId);
    this._isInitialized = true;

    renderIcons(this.container);
    translateDOM(this.container);

    // The switcher now owns which wallpaper boots: put the centered card on
    // screen with the entrance animation. `prepare()` no longer applies one.
    await this.applyCurrentWallpaper({ force: true, firstRun: true });
  }
  /** The source adapter currently feeding the carousel. */
  get activeSource() {
    return (
      this.sources.find((source) => source.id === this.activeSourceId) ||
      this.sources[0]
    );
  }

  /** Card window of a source, created on first use. */
  getStore(sourceId) {
    if (!this.stores.has(sourceId)) {
      const source =
        this.sources.find((entry) => entry.id === sourceId) ||
        this.activeSource;
      this.stores.set(sourceId, new SwitcherStore(source));
    }
    return this.stores.get(sourceId);
  }

  /** Sources the user can actually browse right now (see `BaseSource.isAvailable`). */
  get availableSources() {
    return this.sources.filter((source) => source.isAvailable);
  }

  /**
   * Rebuild the tab bar. Sources may become available mid-session (e.g. the
   * Unsplash API key is entered in the Debug tab), so re-render on every open.
   * `loadSource` corrects the highlight if the active id is gone.
   */
  _refreshTabs() {
    if (!this.sourceTabs) return;
    this.sourceTabs.sources = this.availableSources;
    this.sourceTabs.activeId = this.activeSourceId;
    this.sourceTabs.render();
  }

  /**
   * The tab to open on: the source that owns the current desktop wallpaper,
   * so the carousel opens with that exact image selected. Wallhaven is the
   * fallback, matching the default `wallpaperConfig.source`.
   */
  resolveInitialSourceId() {
    const available = this.availableSources;
    const applied = getSettings().wallpaperConfig?.source || "wallhaven";
    const stored = getSettings().wallpaperSwitcher?.activeSource;

    if (available.some((source) => source.id === applied)) return applied;
    if (available.some((source) => source.id === stored)) return stored;
    return available[0]?.id || this.sources[0].id;
  }

  /**
   * Open a source's window and show it.
   *
   * A window already loaded is reused as-is: switching back to a tab neither
   * refetches the API batch nor loses the browsing position. `refresh` is for
   * feeds whose content lives locally and can change behind our back (the
   * collection).
   *
   * @param {string} sourceId
   * @param {Object} [options]
   * @param {boolean} [options.refresh=false] - Re-pull the whole window.
   */
  async loadSource(sourceId, { refresh = false } = {}) {
    const available = this.availableSources;
    const source =
      available.find((item) => item.id === sourceId) ||
      available[0] ||
      this.sources[0];
    this.activeSourceId = source.id;
    this.sourceTabs?.setActive(source.id);

    const store = this.getStore(source.id);
    try {
      // A volatile feed (the collection) is re-read every time it is shown;
      // a remote feed keeps the window it already materialized.
      if (refresh || source.isVolatile) await store.refresh();
      else if (!store.isOpen) await store.open();
    } catch (error) {
      console.error(
        `[WallpaperSwitcher] Failed to load source [${source.id}]:`,
        error,
      );
      showNotification(
        error?.message || t("sp.api.error", { provider: source.name }),
        "error",
      );
    }

    // Per-wallpaper effect profiles only exist for Collection items.
    if (source.id === "collection") this.syncWallpapersStorage(store.items);

    this._renderCarousel(store);
    this._refreshActions();
  }

  /**
   * Bring the carousel's copy of a store's window back in line with the store,
   * without redrawing anything. See `CarouselTrack.syncCards`.
   *
   * @param {import("../stores/SwitcherStore.js").SwitcherStore} store
   * @param {Object} [options]
   * @param {boolean} [options.keepIndex=false] - Leave the centered column where
   *     the view already put it. Used right after an insert: the track has
   *     moved the selection, but the store only learns about it once the new
   *     wallpaper has actually been applied.
   */
  syncCarousel(store, { keepIndex = false } = {}) {
    if (!this.carousel || !store) return;
    this.carousel.syncCards(
      store.carouselItems,
      keepIndex ? undefined : store.index,
    );
  }

  /**
   * Draw the carousel from a store's window.
   *
   * The sentinel is part of that window, except when the feed is exhausted:
   * `CARD_STATE.END` retires the "+" card by leaving it out of the list.
   */
  _renderCarousel(store, index = store.index) {
    const cards =
      store.moreState === ITEM_STATE.END ? store.items : store.carouselItems;
    this.carousel.setCards(cards, index);
    this._syncMore(store);
  }

  /**
   * Presentation of the trailing "+" card, from the source's capabilities and
   * the sentinel's runtime state. The card itself lives in the store's list.
   * @param {import("../stores/SwitcherStore.js").SwitcherStore} store
   * @param {string} [label] - Overrides the source's own label (countdown, retry hint).
   */
  _syncMore(store, label) {
    const source = this.activeSource;
    this.carousel.setMore({
      state: store.moreState,
      label: label ?? source.moreLabel,
      needsGesture: source.moreNeedsGesture,
    });
  }

  /** Re-render the bottom action row for the centered card. */
  _refreshActions() {
    this.actions?.render(this.activeSource, this.carousel?.selectedCard, {
      store: this.getStore(this.activeSourceId),
      switcher: this,
    });
  }

  /**
   * The carousel came to rest: either materialize the next item (the trailing
   * "+" card) or apply the centered wallpaper to the desktop.
   */
  async handleSettle() {
    if (this._isSwapping) return;

    // The buttons act on the centered card, so they must follow the
    // selection — otherwise they would still target whatever card was
    // centered when the row was last rendered.
    this._refreshActions();

    if (this.carousel.selectedIsMore) {
      // Sources whose "+" opens a native dialog are click-only (browsers
      // only allow that from a real gesture), so settling on their card
      // does nothing on its own.
      if (!this.activeSource?.moreNeedsGesture) await this.growSource();
      return;
    }

    await this.applyCurrentWallpaper();
  }

  /**
   * Materialize the trailing "+" card: fetch exactly one more wallpaper from
   * the source.
   *
   * The card that arrives is painted **into the slot the "+" occupied**, and a
   * fresh "+" appears after it, so the stage never moves. A fetch takes a
   * moment and the user is free to keep browsing meanwhile: if they are still
   * parked on the "+" when the card lands, it is now under their cursor and
   * becomes the wallpaper; if they scrolled away, their position wins and
   * nothing is applied.
   */
  async growSource() {
    const source = this.activeSource;
    if (!source?.canGrow || source.isLoading) return;
    if (this._isGrowCoolingDown(source.id)) return;

    const store = this.getStore(source.id);
    // Where the "+" card sat, so we can tell later whether the user stayed.
    const moreIndex = this.carousel.selectedIsMore
      ? this.carousel.selectedIndex
      : -1;
    const before = store.carouselItems.length;

    // Loading is scoped to the "+" card: the user keeps browsing the cards
    // that are already there while this one works.
    store.setMoreState(ITEM_STATE.LOADING);
    this._syncMore(store);

    let shouldCoolDown = false;
    try {
      const added = await store.fill();

      // null: this round was aborted (a cancelled file picker, a busy
      // source). The "+" card stays as it is and may be tried again.
      if (added === null) {
        store.setMoreState(ITEM_STATE.IDLE);
        this._syncMore(store);
        return;
      }

      // []: the feed has nothing left to give, so the "+" retires. When the
      // user was parked on it, the card that takes that slot becomes the
      // selection — exactly as if they had scrolled onto it.
      if (!added.length) {
        store.setMoreState(ITEM_STATE.END);
        this.carousel.animateRemoveMore();
        this._refreshActions();
        if (moreIndex !== -1) await this.applyCurrentWallpaper();
        return;
      }

      // The user is free to keep browsing while the feed works, so only
      // follow the new card when they are still on the "+" one.
      const following =
        moreIndex !== -1 && this.carousel.selectedIndex === moreIndex;

      // Compute dropped cards if store trimmed oldest items
      const newStoreCardIds = new Set(store.carouselItems.map((c) => c.id));
      const droppedIds = [];
      this.carousel.cards.forEach((c) => {
        if (!isMoreItem(c) && !newStoreCardIds.has(c.id)) {
          droppedIds.push(c.id);
        }
      });

      // A card that is about to be applied keeps its thumbnail veiled until
      // that wallpaper has landed (see `_revealCard`), so the slot grows into
      // a finished-looking card instead of one that pops in half-painted.
      // A card the user has scrolled past is left alone: it is only revealed
      // by an apply, and it may not get one for a long while.
      if (following) added[0].pending = true;

      // Animate card insertion smoothly without wiping DOM!
      await this.carousel.animateInsertCard(added[0], {
        following,
        droppedIds,
      });

      store.setMoreState(ITEM_STATE.IDLE);

      // Persisting rebuilt the store's items, so hand the view the current
      // generation. The selection stays where the track just put it.
      this.syncCarousel(store, { keepIndex: true });

      this._syncMore(store);
      this._refreshActions();

      // Parked on that slot means the new card is under the cursor now.
      if (following) {
        this.applyCurrentWallpaper();
      }

      shouldCoolDown = true;
    } catch (error) {
      console.error(
        `[WallpaperSwitcher] Failed to grow source [${source.id}]:`,
        error,
      );
      showNotification(
        error?.message || t("sp.api.error", { provider: source.name }),
        "error",
      );
      store.setMoreState(ITEM_STATE.ERROR);
      this._syncMore(
        store,
        t("wallpaper_switcher.retry_hint", "Lỗi — bấm để thử lại"),
      );
      // Throttle failures too, otherwise retrying hammers the feed.
      shouldCoolDown = true;
    } finally {
      if (shouldCoolDown) this._startGrowCooldown(source);
    }
  }

  /** Whether a source is still inside its post-fetch cooldown window. */
  _isGrowCoolingDown(sourceId) {
    return (this._growCooldowns.get(sourceId) ?? 0) > performance.now();
  }

  /**
   * Rate limit a source: repeatedly landing on its "+" card would otherwise
   * hammer the feed. While the window lasts the label counts down in realtime.
   * @param {import("../sources/BaseSource.js").BaseSource} source
   */
  _startGrowCooldown(source) {
    this._growCooldowns.set(source.id, performance.now() + GROW_COOLDOWN_MS);
    if (this._cooldownTimer) return;

    this._tickGrowCooldown();
    this._cooldownTimer = setInterval(
      () => this._tickGrowCooldown(),
      COOLDOWN_TICK_MS,
    );
  }

  /** Repaint the "+" label with the active source's remaining cooldown. */
  _tickGrowCooldown() {
    const now = performance.now();
    let activeJustExpired = false;

    for (const [id, until] of this._growCooldowns) {
      if (until > now) continue;
      this._growCooldowns.delete(id);
      if (id === this.activeSourceId) activeJustExpired = true;
    }

    const remaining = (this._growCooldowns.get(this.activeSourceId) ?? 0) - now;
    const store = this.getStore(this.activeSourceId);
    if (remaining > 0) {
      this._syncMore(
        store,
        t("wallpaper_switcher.cooldown", {
          seconds: Math.ceil(remaining / 1000),
        }),
      );
      return;
    }

    this._syncMore(store);

    if (this._growCooldowns.size === 0) {
      clearInterval(this._cooldownTimer);
      this._cooldownTimer = null;
    }

    // The user is still parked on the "+" card: serve them the next
    // wallpaper now that the rate limit is over.
    if (activeJustExpired && this.carousel?.selectedIsMore) this.growSource();
  }

  /**
   * Rebuild a card's thumbnail after the one it was drawn with failed to load.
   * Only the owning source can tell whether that is possible — a thumbnail
   * derived from the stored media — or futile, in which case the carousel falls
   * back to the generic placeholder.
   *
   * @param {Object} card
   * @returns {Promise<string|null>}
   */
  async recoverThumbnail(card) {
    const source =
      this.sources.find((entry) => entry.id === card?.source) ||
      this.activeSource;
    if (!source || !card?.id) return null;

    // Clear the unusable URL, otherwise the source would consider the card as
    // already having a thumbnail to preload.
    card.thumbnailUrl = "";
    return source.prepareThumb(card);
  }

  /** Switch to another source tab, animate the swap and remember the choice. */
  async selectSource(sourceId) {
    if (this._isSwapping) return;
    if (sourceId === this.activeSourceId) return;
    if (!this.availableSources.some((source) => source.id === sourceId)) return;

    const settings = getSettings();
    saveSettings({
      wallpaperSwitcher: {
        ...settings.wallpaperSwitcher,
        activeSource: sourceId,
      },
    });

    // Highlight straight away so the click feels instant; `loadSource`
    // re-applies it once the swap is done.
    this.sourceTabs?.setActive(sourceId);
    await this.swapToSource(sourceId);
  }

  /**
   * Slide the carousel down and out, swap the content while it is hidden, then
   * let it glide back up (cubic-in going down, expo-out coming back).
   * @param {string} sourceId
   */
  async swapToSource(sourceId) {
    if (!this.carouselEl) {
      await this.loadSource(sourceId);
      return;
    }

    this._isSwapping = true;
    try {
      this.carouselEl.classList.add("is_swapping");

      await new Promise((resolve) => setTimeout(resolve, SWAP_OUT_MS));
      await this.loadSource(sourceId);

      // Reflect the newly centered wallpaper straight away. Not awaited:
      // a remote full-size download must not hold up the reveal.
      this.applyCurrentWallpaper();
    } finally {
      this._isSwapping = false;
      this.carouselEl.classList.remove("is_swapping");
    }
  }

  /**
   * Synchronize collection items with the per-wallpaper profiles stored in LocalStorage.
   * @param {Array<Object>} items - Normalized collection card items.
   */
  syncWallpapersStorage(items) {
    const settings = getSettings();
    const storedWallpapers = Array.isArray(settings.wallpapers)
      ? [...settings.wallpapers]
      : [];
    let updated = false;

    items.forEach((item) => {
      const exists = storedWallpapers.some((w) => w.id === item.id);
      if (!exists) {
        storedWallpapers.push({
          id: item.id,
          title: item.title || "",
          type: item.mediaType || "image",
          source: item.sourceUrl || "local",
          createdAt: Date.now(),
          effects: getDefaultWallpaperEffects(),
        });
        updated = true;
      }
    });

    if (updated) {
      saveSettings({ wallpapers: storedWallpapers });
    }
  }

  bindEvents() {
    // Toggle button click
    this.toggleBtn.addEventListener("mousedown", (e) => {
      e.stopPropagation();
      this.toggle();
    });

    // Wheel navigation is owned by the carousel itself

    // Keyboard navigation
    window.addEventListener("keydown", (e) => {
      if (e.altKey && e.code === "KeyW") {
        e.preventDefault();
        this.toggle();
        return;
      }

      if (!this.isOpen) return;

      // ↑/↓ cycle through the source tabs (←/→ drive the carousel)
      if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        e.preventDefault();
        this.sourceTabs?.step(e.key === "ArrowDown" ? 1 : -1);
        return;
      }

      if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        e.preventDefault();
        this.carousel?.stepByKey(e.key === "ArrowRight" ? 1 : -1);
      } else if (e.key === "Enter") {
        e.preventDefault();
        this.handleSettle();
      } else if (e.key === "Escape") {
        e.preventDefault();
        this.close();
      }
    });

    // Re-center on window resize
    window.addEventListener("resize", () => {
      if (this.isOpen) {
        this.carousel?.recenter({ smooth: false, notify: false });
      }
    });
  }

  /**
   * Apply the selected card to the desktop background.
   * Called as soon as the carousel finishes its inertia glide.
   * @param {Object} [options]
   * @param {boolean} [options.force=false] - Re-apply even if it is already active.
   * @param {boolean} [options.firstRun=false] - Play the entrance animation instead of a fade.
   */
  async applyCurrentWallpaper({ force = false, firstRun = false } = {}) {
    const card = this.carousel?.selectedCard;
    if (!card || isMoreItem(card)) return;

    const source = this.activeSource;
    const store = this.getStore(source.id);

    // Settling on a card the desktop already shows costs nothing, but the
    // position is still worth remembering.
    if (!force && source.isActive(card)) {
      await store.remember({ index: this.carousel.selectedIndex });
      this._revealCard(card);
      return;
    }

    // Fast scrolling can settle several times in a row; only the latest
    // attempt is allowed to report a failure.
    const token = ++this._applyToken;
    try {
      await source.apply(card, { firstRun });

      const currentConfig = getSettings().wallpaperConfig || {};
      saveSettings({
        wallpaperConfig: {
          ...currentConfig,
          source: source.id,
          activeWallpaperId: card.id,
          activeCollectionItemId:
            source.id === "collection"
              ? card.id
              : currentConfig.activeCollectionItemId,
        },
      });

      await store.remember({
        index: this.carousel.selectedIndex,
        appliedId: card.id,
      });
    } catch (error) {
      if (token !== this._applyToken) return;
      console.error("[WallpaperSwitcher] Failed to apply wallpaper:", error);
      showNotification(
        error?.message || t("sp.api.error", { provider: source.name }),
        "error",
      );
    } finally {
      // The card was waiting behind a loading veil for this wallpaper; a
      // failed swap must not leave it hidden forever.
      this._revealCard(card);
    }
  }

  /**
   * Lift the loading veil off a card.
   *
   * A card that just materialized stays hidden until its wallpaper has landed
   * (see `growSource`), and is revealed here — with a fade and a slight zoom,
   * driven by the track.
   *
   * @param {Object} card
   */
  _revealCard(card) {
    if (!card?.pending) return;

    card.pending = false;
    this.carousel.refreshCard(card.id);

    // The action row gated its destructive buttons on that flag, so it has to
    // be told they are usable again.
    this._refreshActions();
  }

  /**
   * Remove a card from the carousel with direct animation,
   * immediately falling back to neighbour and applying wallpaper if active.
   * @param {Object} card
   * @param {Object|null} neighbour
   */
  async removeCardAnimated(card, neighbour) {
    const store = this.getStore(this.activeSourceId);
    const wasFocused = this.carousel?.selectedCard?.id === card.id;
    const wasActive = this.activeSource.isActive(card) || wasFocused;

    // If the card being removed is the active desktop wallpaper or was focused,
    // start applying neighbour immediately so desktop transitions concurrently!
    if (wasActive && neighbour) {
      this.activeSource
        .apply(neighbour)
        .then(() => {
          const currentConfig = getSettings().wallpaperConfig || {};
          saveSettings({
            wallpaperConfig: {
              ...currentConfig,
              source: this.activeSource.id,
              activeWallpaperId: neighbour.id,
              activeCollectionItemId:
                this.activeSource.id === "collection"
                  ? neighbour.id
                  : currentConfig.activeCollectionItemId,
            },
          });
          return store.setApplied(neighbour.id);
        })
        .catch((err) => {
          console.error(
            "[WallpaperSwitcher] Error applying neighbour wallpaper:",
            err,
          );
        });
    }

    // Animate out in carousel, handing it the card the desktop fell back to.
    await this.carousel.animateRemoveCard(card.id, { focusId: neighbour?.id });

    // Update actions row for the newly selected card
    this._refreshActions();
  }

  async open() {
    if (this.isOpen) return;

    // Close Settings panel if it is currently open
    const settingsWrapper = document.getElementById("setting_wrapper");
    if (settingsWrapper?.classList.contains("setting_wrapper_opened")) {
      const closeBtn = document.getElementById("setting_close_btn");
      if (closeBtn) {
        closeBtn.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      }
    }

    // Re-sync the active source (the collection is re-read on every open;
    // a remote feed keeps the window it already materialized).
    this._refreshTabs();
    await this.loadSource(this.activeSourceId);

    this.isOpen = true;
    this.container.classList.add("active");
    this.toggleBtn.classList.add("active");

    // Let the slide-in transition settle the layout, then snap the carousel
    // into place. Deliberately no settle notification: merely opening the
    // switcher must not change the user's wallpaper.
    requestAnimationFrame(() => {
      this.carousel.recenter({ smooth: false, notify: false });
    });
  }

  close() {
    if (!this.isOpen) return;
    this.isOpen = false;

    this.carousel?.stop();
    this.container?.classList.remove("no_hover");
    this.container?.classList.remove("active");
    this.toggleBtn?.classList.remove("active");
  }

  toggle() {
    if (this.isOpen) {
      this.close();
    } else {
      this.open();
    }
  }
}

export const wallpaperSwitcher = new WallpaperSwitcher();
