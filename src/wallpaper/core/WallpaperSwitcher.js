import { translateDOM, t } from "/src/core/i18n.js";
import { renderIcons } from "/src/core/icon.js";
import { showNotification } from "/src/core/ui.js";
import {
  getSettings,
  saveSettings,
  getDefaultWallpaperEffects,
} from "/src/core/storageHandler.js";
import { createSources } from "../sources/index.js";
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
    this._pendingSourceId = null;

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
      onThumbError: (item, cardEl) =>
        this.recoverThumbnail(item.card ?? item, cardEl),
    });

    this.carousel.onHardSelect((index, cardEl, item) => {
      this.handleHardSelect(index, item);
    });

    this.carousel.onSoftSelect((index) => {
      dataControl.setSoftIndex(index);
    });

    this.carousel.onStateChange((state) => {
      const isBusy = this._isSwapping || state.status === "deleting" || dataControl.isBusy || dataControl.status !== "idle";
      this.bar?.setBusy(isBusy);
      if (state.status === "moving" || state.status === "deleting" || !state.isSettled) {
        this.bar?.hideActions();
      }
    });

    // Khởi tạo component SwitcherBar thống nhất
    this.bar = new SwitcherBar({
      container: this.container.querySelector(".wallpaper_switcher_inner"),
      dataControl,
      switcher: this,
    }).init();

    this.bindEvents();

    const initialSourceId = dataControl.activeSourceId || this.resolveInitialSourceId();
    this.activeSourceId = initialSourceId;
    if (!dataControl.activeSourceId) {
      dataControl.activeSourceId = initialSourceId;
    }
    this.bar?.syncActiveTab(initialSourceId);
    this.bar?.syncRightSlot(initialSourceId);

    // Subscribe to DataControl events to update Carousel
    dataControl.on("cards:loaded", () => this.renderFromDataControl());
    dataControl.on("card:deleted", () => {
      if (dataControl.items.length === 0) {
        this.syncEmptyState(true);
      }
    });
    dataControl.on("card:added", ({ addedCards, allCards }) => {
      // Sync the carousel using syncItems so only genuinely fresh cards receive the enter animation
      const engineItems = this._toEngineItems();

      const previousCount = (allCards?.length || 0) - (addedCards?.length || 0);
      const isAtLast = previousCount > 0 && (dataControl.currentIndex === previousCount - 1 || this.carousel.hardIndex === previousCount - 1);

      this.carousel.syncItems(engineItems, dataControl.currentIndex, { silent: true });
      this.bar?.syncCounter();

      // When adding cards to an empty source, auto-select the first card and sync empty state
      const wasEmpty = Array.isArray(allCards) && Array.isArray(addedCards) && allCards.length === addedCards.length;
      if (wasEmpty && allCards.length > 0) {
        dataControl.setHardIndex(0);
        this.carousel?.scrollToCard(0);
        this.bar?.renderActions(dataControl.activeCard);
        this.syncEmptyState(false);
      } else if (isAtLast && addedCards && addedCards.length > 0) {
        // Người dùng đang đứng ở ảnh cuối cùng trước khi thêm -> tự động cuộn sang ảnh tiếp theo
        const nextIndex = dataControl.currentIndex + 1;
        this.carousel.scrollToCard(nextIndex);
        this.syncEmptyState(false);
      } else {
        this.syncEmptyState(false);
      }
    });

    dataControl.on("feed:limit_reached", ({ cap }) => {
      showNotification(
        t("wallpaper_switcher.limit_reached", { count: cap }),
        "warning",
      );
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
   *   Pass true to play the card-enter-slot animation.
   */
  renderFromDataControl(animate = true) {
    if (!this.carousel) return;

    this._silentRender = true;
    try {
      this.carousel.setItems(this._toEngineItems(), dataControl.currentIndex, { animate });
    } finally {
      this._silentRender = false;
    }

    this.syncEmptyState((dataControl.items || []).length === 0);
  }

  /**
   * Map store cards to the flat item shape CarouselEngine understands.
   * @returns {Array<Object>}
   */
  _toEngineItems() {
    const source = this.activeSource;
    return (dataControl.items || []).map((item) => ({
      id: item.id,
      name: item.title || item.id,
      sub: item.category || source?.name || "",
      url: item.thumbnailUrl || item.url || "",
      card: item,
    }));
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
      const hintEl = emptyEl.querySelector(".empty-sub");
      if (hintEl) {
        const isCollection = this.activeSourceId === "collection";
        const key = isCollection
          ? "wallpaper_switcher.empty_hint_collection"
          : "wallpaper_switcher.empty_hint_remote";
        hintEl.setAttribute("data-i18n", key);
      }
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
    await dataControl.requestMore();
  }

  /**
   * The carousel came to rest: apply the centered wallpaper to the desktop.
   */
  async handleHardSelect(index, item) {
    if (this._silentRender || this._isSwapping || dataControl.status === "deleting" || this.carousel?.isDeleting) return;
    // Xóa thẻ chạy carousel trước rồi store sau, nên giữa hai bước mảng `items`
    // của store còn giữ bản ghi cũ: một lượt chốt lệch thẻ là chốt của pha dọn
    // dẹp, không phải lựa chọn của người dùng. Bỏ qua ở đây — SwitcherBar chốt
    // lại thẻ kế cận sau khi store xóa xong.
    if (item ? dataControl.items[index]?.id !== item.id : dataControl.items.length > 0) return;
    dataControl.setHardIndex(index);
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

  /**
   * Switch to another source tab immediately.
   * If a swap is currently in flight, queues the latest requested source
   * and executes it safely as soon as the active swap finishes.
   *
   * @param {string} sourceId
   */
  async selectSource(sourceId) {
    if (!this.availableSources.some((source) => source.id === sourceId)) return;
    if (sourceId === this.activeSourceId && !this._pendingSourceId) return;
    if (sourceId === this._pendingSourceId) return;

    // Highlight straight away so the click feels instant and responsive
    this.bar?.syncActiveTab(sourceId);

    // If currently swapping/loading a source, record the desired destination
    if (this._isSwapping) {
      this._pendingSourceId = sourceId;
      return;
    }

    this._pendingSourceId = null;
    await this.swapToSource(sourceId);
  }

  /** Swap the content immediately. */
  async swapToSource(sourceId) {
    if (!this.carouselEl) {
      await this.loadSource(sourceId);
      return;
    }

    this._isSwapping = true;
    this.bar?.setBusy(true);

    const startTime = Date.now();

    try {
      await this.loadSource(sourceId);

      // Neu trong luc load nguon nay ma user da click chon nguon khac (pending)
      // thi khong apply anh trung gian len san khau
      if (this._pendingSourceId && this._pendingSourceId !== sourceId) {
        return;
      }
      if (this.activeSourceId !== sourceId) {
        return;
      }

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
    } finally {
      const elapsed = Date.now() - startTime;
      if (elapsed < 400) {
        await new Promise((r) => setTimeout(r, 400 - elapsed));
      }
      this._isSwapping = false;
      this.bar?.setBusy(false);

      if (this._pendingSourceId && this._pendingSourceId !== this.activeSourceId) {
        const nextSourceId = this._pendingSourceId;
        this._pendingSourceId = null;
        this.selectSource(nextSourceId);
      }
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
    this.toggleBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.toggle();
    });

    // Close button click
    const closeBtn = this.container.querySelector("#wallpaper_switcher_close_btn");
    closeBtn?.addEventListener("click", (e) => {
      e.stopPropagation();
      this.close();
    });

    // Settings button click (opens settings panel)
    const settingsBtn = this.container.querySelector("#wallpaper_switcher_settings_btn");
    settingsBtn?.addEventListener("click", (e) => {
      e.stopPropagation();
      this.close();
      const toggleBtn = document.getElementById("setting_toggle_btn");
      if (toggleBtn) {
        toggleBtn.click();
      }
    });

    // Click outside to close wallpaper switcher
    document.addEventListener("pointerdown", (e) => {
      if (!this.isOpen) return;

      const target = e.target;
      if (
        target.closest(".wallpaper_switcher_inner") ||
        target.closest(".popover_panel") ||
        target.closest(".dropdown") ||
        target.closest(".dialog_root") ||
        target.closest(".notification_container") ||
        this.toggleBtn?.contains(target)
      ) {
        return;
      }

      this.close();
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
        closeBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      }
    }

    // Hide action buttons (Settings & Wallpaper toggle triggers) just like Settings panel
    const actionButtons = document.getElementById("action_buttons");
    actionButtons?.classList.add("wallpaper_switcher_opened");
    actionButtons?.classList.remove("toggle_hidden");

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
    this.bar?.closePopovers?.();
    this.bar?.hideActions();

    this._pendingSourceId = null;

    // Restore action buttons
    const actionButtons = document.getElementById("action_buttons");
    actionButtons?.classList.remove("wallpaper_switcher_opened");
    const isDim = getSettings().hideToggleButton === true;
    if (isDim) {
      actionButtons?.classList.add("toggle_hidden");
    } else {
      actionButtons?.classList.remove("toggle_hidden");
    }

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
