import { translateDOM, t } from "/src/core/i18n.js";
import { renderIcons } from "/src/core/icon.js";
import { showNotification } from "/src/core/ui.js";
import {
  getSettings,
  saveSettings,
  getDefaultWallpaperEffects,
} from "/src/core/storageHandler.js";
import { createSources } from "../sources/index.js";
import { isActionItem, createActionItem } from "../ui/carousel/items.js";
import { resolveCardMeta } from "../sources/cardMeta.js";
import { SwitcherBar } from "../ui/bar/SwitcherBar.js";
import { CarouselEngine } from "../ui/carousel/CarouselEngine.js";
import { dataControl } from "./DataControl.js";

import switcherHtml from "../ui/switcher.html?raw";
import "../ui/switcher.css";
import "../ui/carousel/carousel.css";

/**
 * WallpaperSwitcher.js
 * ---------------------------------------------------------------------------
 * Standalone bottom Wallpaper Switcher (Alt + W).
 *
 * Thin orchestrator assembling:
 *   - SwitcherBar (./ui/bar)         — tabs, counter, actions and upload controls
 *   - CarouselEngine (./ui/carousel) — 3D card layout and physics navigation
 *   - DataControl (./core)           — single source of truth & data orchestration
 *   - Sources (./sources)            — wallpaper data adapters
 *
 * The carousel owns motion and nothing else: it is handed flat items and gives
 * back a settled index. Everything store/API shaped lives in DataControl.
 *
 * Its own job is limited to lifecycle (open/close), keyboard shortcuts, and
 * coordinating the components.
 */

/** Duration of one carousel snap, in ms. */
const CAROUSEL_DURATION = 600;
/** Must match the `.is_swapping` transition duration in switcher.css. */
const SWAP_OUT_MS = 260;

export class WallpaperSwitcher {
  constructor() {
    this.isOpen = false;
    this._isInitialized = false;
    /** True while a source swap animation is in flight. */
    this._isSwapping = false;
    /**
     * True while the orchestrator itself is redrawing the carousel. A settle
     * raised in that window is bookkeeping, not a user choice, so it must not
     * reach the desktop.
     */
    this._silentRender = false;
    /**
     * True trong lúc một thẻ đang bị gỡ. Thẻ kế cận có thể chính là ô "+", và
     * lượt chốt đó không được hiểu thành "người dùng muốn nạp thêm ảnh".
     */
    this._suppressAutoGrow = false;

    // Source adapters (Collection, Wallhaven, Unsplash, Picre...) — see ./sources/registry.js
    this.sources = createSources();
    // Resolved from the applied wallpaper once the DOM exists (see init).
    this.activeSourceId = null;

    this.container = null;
    this.carouselEl = null;
    this.carousel = null;
    this.bar = null;
    this.toggleBtn = null;
  }

  async init() {
    this.toggleBtn = document.getElementById("wallpaper_toggle_btn");
    this.container = document.getElementById("wallpaper_switcher");
    if (!this.container || !this.toggleBtn) return;

    // Inject dynamic HTML template
    this.container.innerHTML = switcherHtml;

    this.carouselEl = this.container.querySelector("#wallpaper_carousel");

    this.carousel = new CarouselEngine({
      container: this.carouselEl,
      track: this.container.querySelector("#wallpaper_carousel_track"),
      guide: this.container.querySelector(".carousel-guide"),
      viewfinder: this.container.querySelector(".carousel-viewfinder"),
      duration: CAROUSEL_DURATION,
      onAction: () => this.growSource(),
      onThumbError: (item, cardEl) =>
        this.recoverThumbnail(item.card ?? item, cardEl),
      onCardClick: (index, item) =>
        isActionItem(item) && Boolean(this.activeSource?.moreNeedsGesture),
    });

    this.carousel.onHardSelect((index, cardEl, item) => {
      this.handleHardSelect(index, item);
    });

    this.carousel.onSoftSelect((index) => {
      dataControl.setSoftIndex(index);
    });

    this.carousel.onStateChange((state) => {
      this.bar?.setBusy(this._isSwapping || state.status !== "idle");
    });

    // Khởi tạo component SwitcherBar thống nhất
    this.bar = new SwitcherBar({
      container: this.container.querySelector(".wallpaper_switcher_bar"),
      dataControl,
      switcher: this,
    }).init();

    this.bindEvents();

    const initialSourceId = dataControl.activeSourceId || this.resolveInitialSourceId();
    this.activeSourceId = initialSourceId;

    // Lắng nghe các sự kiện từ DataControl để cập nhật Carousel
    dataControl.on("cards:loaded", () => this.renderFromDataControl());
    dataControl.on("card:deleted", () => {
      if (dataControl.items.length === 0) {
        this.syncEmptyState(true);
      }
    });
    dataControl.on("card:added", ({ addedCards, allCards }) => {
      // For Collection (no '+' card) or batch uploads, sync the carousel
      // using syncItems so only genuinely new cards receive the enter animation.
      // setItems / renderFromDataControl would rebuild the whole DOM and fire
      // the animation on every existing card too.
      if (!this.activeSource?.showsMoreItem || (addedCards && addedCards.length > 1)) {
        const source = this.activeSource;
        const engineItems = (dataControl.items || []).map((item) => {
          const meta = resolveCardMeta(this.activeSourceId, item);
          return {
            id: item.id,
            name: item.title || item.id,
            sub: item.category || source?.name || "",
            url: item.thumbnailUrl || item.url || "",
            card: item,
            metaLeft: meta.leftHtml,
            metaRight: meta.rightHtml,
          };
        });

        if (source?.showsMoreItem !== false && source?.canGrow) {
          engineItems.push(createActionItem(this.carousel.actionConfig));
        }

        this.carousel.syncItems(engineItems, dataControl.currentIndex, { silent: true });
        this.bar?.syncCounter();
      }

      // Khi Collection tải lên từ 0 ảnh lên có ảnh: tự động chọn ảnh đầu tiên và áp dụng làm hình nền
      const wasEmpty = Array.isArray(allCards) && Array.isArray(addedCards) && allCards.length === addedCards.length;
      if (this.activeSourceId === "collection" && wasEmpty && allCards.length > 0) {
        dataControl.setHardIndex(0);
        this.carousel?.scrollToCard(0);
        this.bar?.renderActions(dataControl.activeCard);
      }
    });

    this.renderFromDataControl();
    this._isInitialized = true;

    renderIcons(this.container);
    translateDOM(this.container);

    // Khởi động hình nền chốt ở tâm màn hình cùng hiệu ứng entrance animation
    const initialCard = dataControl.activeCard;
    if (initialCard) {
      dataControl.emit("card:hard", {
        index: dataControl.currentIndex,
        card: initialCard,
        sourceId: this.activeSourceId,
        firstRun: true,
      });
    }
  }
  /** The source adapter currently feeding the carousel. */
  get activeSource() {
    return (
      this.sources.find((source) => source.id === this.activeSourceId) ||
      this.sources[0]
    );
  }



  /** Sources the user can actually browse right now (see `BaseSource.isAvailable`). */
  get availableSources() {
    return this.sources.filter((source) => source.isAvailable);
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
   * Render carousel items directly from DataControl.
   * @param {boolean} [animate=false] - Whether to play the card-enter-slot animation.
   *   Pass true only when genuinely new cards are being introduced (e.g. source
   *   seed on very first open). Most callers should leave this false.
   */
  renderFromDataControl(animate = false) {
    if (!this.carousel) return;
    const source = this.activeSource;
    const items = dataControl.items || [];

    const engineItems = items.map((item) => {
      const meta = resolveCardMeta(this.activeSourceId, item);
      return {
        id: item.id,
        name: item.title || item.id,
        sub: item.category || source?.name || "",
        url: item.thumbnailUrl || item.url || "",
        card: item,
        metaLeft: meta.leftHtml,
        metaRight: meta.rightHtml,
      };
    });

    if (source?.showsMoreItem !== false && source?.canGrow) {
      const actionConfig = {
        name: source.moreLabel || t("wallpaper_switcher.get_new_image", "Lấy ảnh mới"),
        subLabel: source.name,
        loadingText: t(
          "wallpaper_switcher.wait_for_wallpaper",
          "Đang tải hình nền…",
        ),
      };
      this.carousel.setActionCardConfig(actionConfig);
      engineItems.push(createActionItem(actionConfig));
    }

    this._silentRender = true;
    try {
      this.carousel.setItems(engineItems, dataControl.currentIndex, { animate });
    } finally {
      this._silentRender = false;
    }

    this.syncEmptyState(engineItems.length === 0);
  }

  /**
   * Cập nhật trạng thái hiển thị empty state mượt mà (fade in / out).
   * @param {boolean} [isEmpty]
   */
  syncEmptyState(isEmpty = (this.carousel?.count ?? 0) === 0) {
    const emptyEl = this.container?.querySelector("#wallpaper_carousel_empty");
    if (!emptyEl) return;
    emptyEl.classList.toggle("is-visible", isEmpty);
    if (isEmpty) {
      renderIcons(emptyEl);
      translateDOM(emptyEl);
    }
  }

  /**
   * Open a source's window and show it via DataControl.
   *
   * @param {string} sourceId
   */
  async loadSource(sourceId) {
    const available = this.availableSources;
    const source =
      available.find((item) => item.id === sourceId) ||
      available[0] ||
      this.sources[0];
    this.activeSourceId = source.id;

    try {
      await dataControl.switchSource(source.id);
      this.renderFromDataControl();
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

    if (source.id === "collection") this.syncWallpapersStorage(dataControl.items);
  }

  /**
   * Bar's right-hand button: ask the current source for items.
   */
  async requestUpload() {
    if (this.activeSourceId === "collection") {
      await dataControl.requestMore();
    } else {
      await this.carousel?.requestAction(this.carousel.actionIndex);
    }
  }

  /**
   * The carousel came to rest: sync the chrome, materialize the next item when
   * the "+" is centered, or apply the centered wallpaper to the desktop.
   */
  async handleHardSelect(index, item) {
    if (this._silentRender || this._isSwapping || dataControl.status === "deleting" || this.carousel?.isDeleting) return;

    if (isActionItem(item)) {
      if (!this._suppressAutoGrow && !this.activeSource?.moreNeedsGesture) {
        this.carousel.requestAction(index);
      }
      return;
    }

    dataControl.setHardIndex(index);
  }

  /**
   * Materialize the trailing "+" card: fetch via DataControl.
   */
  async growSource() {
    const source = this.activeSource;
    if (!source?.canGrow) return null;

    try {
      const addedItem = await dataControl.requestMore();
      if (!addedItem) return null;

      const meta = resolveCardMeta(this.activeSourceId, addedItem);
      return {
        id: addedItem.id,
        name: addedItem.title || addedItem.id,
        sub: addedItem.category || source.name,
        url: addedItem.thumbnailUrl || addedItem.url || "",
        card: addedItem,
        metaLeft: meta.leftHtml,
        metaRight: meta.rightHtml,
      };
    } catch (error) {
      console.error(
        `[WallpaperSwitcher] Failed to grow source [${source.id}]:`,
        error,
      );
      showNotification(
        error?.message || t("sp.api.error", { provider: source.name }),
        "error",
      );
      throw error;
    }
  }

  /**
   * Rebuild a card's thumbnail after the one it was drawn with failed to load.
   * Only the owning source can tell whether that is possible — a thumbnail
   * derived from the stored media — or futile, in which case the carousel falls
   * back to the generic placeholder.
   *
   * @param {Object} card
   * @param {HTMLElement} [cardEl] - Thẻ đang hiển thị, để gán ảnh mới vào.
   * @returns {Promise<string|null>}
   */
  async recoverThumbnail(card, cardEl) {
    const source =
      this.sources.find((entry) => entry.id === card?.source) ||
      this.activeSource;
    if (!source || !card?.id) return null;

    // Clear the unusable URL, otherwise the source would consider the card as
    // already having a thumbnail to preload.
    card.thumbnailUrl = "";
    const url = await source.prepareThumb(card);

    // The engine painted the broken URL as a `background-image`; swap it in
    // place so the card heals without the row being redrawn.
    if (url && cardEl) this.carousel?.setCardImage(cardEl, url);
    return url;
  }

  /** Switch to another source tab, animate the swap and remember the choice. */
  async selectSource(sourceId) {
    if (this._isSwapping) return;
    if (sourceId === this.activeSourceId) return;
    if (!this.availableSources.some((source) => source.id === sourceId)) return;

    // Highlight straight away so the click feels instant; `loadSource`
    // re-applies it once the swap is done.
    this.bar?.syncActiveTab(sourceId);
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
    this.bar?.setBusy(true);

    try {
      // ── Phase 1: slide down (cubic-in) ──────────────────────────────────
      this.carouselEl.classList.add("is_swapping");
      await new Promise((resolve) => setTimeout(resolve, SWAP_OUT_MS));

      // ── Phase 2: swap content while track is off-screen ─────────────────
      await this.loadSource(sourceId);

      const activeCard = dataControl.activeCard;
      if (activeCard) {
        dataControl.emit("card:hard", {
          index: dataControl.currentIndex,
          card: activeCard,
          sourceId,
        });
      } else {
        this.bar?.renderActions(null);
      }

      // ── Phase 3: slide back up (expo-out) ───────────────────────────────
      // Switch to is_swapping_in first (no transition) to pin the track at
      // the displaced position, then force a reflow so the browser registers
      // the starting state before we kick off the return transition.
      this.carouselEl.classList.remove("is_swapping");
      this.carouselEl.classList.add("is_swapping_in");
      void this.carouselEl.offsetWidth; // force reflow
      this.carouselEl.classList.add("is_animating_in");

      await new Promise((resolve) => {
        const track = this.carouselEl.querySelector(".carousel-track");
        const onEnd = () => {
          track?.removeEventListener("transitionend", onEnd);
          resolve();
        };
        track?.addEventListener("transitionend", onEnd, { once: true });
        // Safety fallback in case transitionend never fires (e.g. reduced-motion).
        setTimeout(resolve, 420);
      });
    } finally {
      this.carouselEl.classList.remove("is_swapping", "is_swapping_in", "is_animating_in");
      this._isSwapping = false;
      this.bar?.setBusy(false);
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

    // Keyboard navigation
    window.addEventListener("keydown", (e) => {
      if (!this.isOpen) return;

      // ↑/↓ cycle through the source tabs (←/→ drive the carousel)
      if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        e.preventDefault();
        this.bar?.stepTab(e.key === "ArrowDown" ? 1 : -1);
        return;
      }

      if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        e.preventDefault();
        this.carousel?.stepByKey(e.key === "ArrowRight" ? 1 : -1);
      } else if (e.key === "Enter") {
        e.preventDefault();
        this.handleHardSelect(
          this.carousel.hardIndex,
          this.carousel.activeItem,
        );
      } else if (e.key === "Escape") {
        e.preventDefault();
        this.close();
      }
    });

    // Re-center on window resize
    window.addEventListener("resize", () => {
      if (this.isOpen) this.carousel?.recenter();
    });
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

    // Re-sync the active source
    this.bar?.renderTabs();
    await this.loadSource(this.activeSourceId);

    this.isOpen = true;
    this.container.classList.add("active");
    this.toggleBtn.classList.add("active");
    this.carousel?.setActive(true);

    // Let the slide-in transition settle the layout, then snap the carousel
    // into place. Deliberately no settle notification: merely opening the
    // switcher must not change the user's wallpaper.
    requestAnimationFrame(() => {
      this.carousel?.recenter();
    });
  }

  close() {
    if (!this.isOpen) return;
    this.isOpen = false;

    this.carousel?.stop();
    // Input is gated on the engine being active: while the switcher is hidden,
    // wheel and drag events must not reach it at all.
    this.carousel?.setActive(false);
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
