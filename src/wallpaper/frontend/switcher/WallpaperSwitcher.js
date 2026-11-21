import { translateDOM, t } from "/src/core/i18n.js";
import { renderIcons } from "/src/core/icon.js";
import {
  showNotification,
  attemptCloseSubmenu,
  closeSubmenu,
} from "/src/core/ui.js";
import { getSettings } from "/src/core/storageHandler.js";
import { dataControl } from "../../backend/data/DataControl.js";
import { describeFetchError } from "../../backend/data/errors.js";
import { SwitcherBar } from "./bar/SwitcherBar.js";
import { CarouselEngine } from "./carousel/CarouselEngine.js";

import switcherHtml from "./switcher.html?raw";
import "./switcher.css";
import "./customize.css";
import "./meta.css";
import "./bar/bar.css";
import "./carousel/carousel.css";

/**
 * WallpaperSwitcher.js
 * ---------------------------------------------------------------------------
 * Standalone bottom Wallpaper Switcher (Alt + W).
 *
 * Thin orchestrator assembling:
 *   - SwitcherBar (./bar)             — tabs, counter, actions and upload controls
 *   - CarouselEngine (./carousel)     — 3D card layout and physics navigation
 *   - DataControl (backend/data)      — single source of truth & data orchestration
 *   - Sources (backend/sources)       — wallpaper data adapters
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
    /** True while a source swap animation is in flight. */
    this._isSwapping = false;
    /** True while Layer 2 is importing uploaded collection files. */
    this._isImporting = false;
    this._pendingSourceId = null;

    // Resolved from the applied wallpaper once the DOM exists (see init).
    this.activeSourceId = null;

    this.container = null;
    this.carouselEl = null;
    this.carousel = null;
    this.bar = null;
    this.toggleBtn = null;
    this._innerEl = null;
    this._emptyEl = null;
    this._emptyHintEl = null;
    this._emptyHintKey = null;
  }

  async init() {
    this.toggleBtn = document.getElementById("wallpaper_toggle_btn");
    this.container = document.getElementById("wallpaper_switcher");
    if (!this.container || !this.toggleBtn) return;

    // Inject dynamic HTML template
    this.container.innerHTML = switcherHtml;

    this._innerEl = this.container.querySelector(".wallpaper_switcher_inner");
    this._emptyEl = this.container.querySelector("#wallpaper_carousel_empty");
    this._emptyHintEl = this._emptyEl?.querySelector(".empty-sub") || null;
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
      // Khi dải đang lướt, đang xóa hoặc chưa settle: ẩn ngay cụm action (Master Visibility)
      if (
        state.status === "moving" ||
        state.status === "deleting" ||
        !state.isSettled
      ) {
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

    const initialSourceId =
      dataControl.activeSourceId || this.resolveInitialSourceId();
    this.activeSourceId = initialSourceId;
    if (!dataControl.activeSourceId) {
      dataControl.activeSourceId = initialSourceId;
    }
    this.bar?.syncActiveTab(initialSourceId);
    this.bar?.syncRightSlot(initialSourceId);

    // Subscribe to DataControl events to update Carousel
    dataControl.on("cards:loaded", () => this.renderFromDataControl());
    dataControl.on("card:deleted", () => {
      // Deletions can also arrive from the manage grid, i.e. without the
      // carousel's drop animation. Reconcile by id so a removed record never
      // leaves a ghost slot behind.
      this.carousel?.syncItems(
        this._toEngineItems(),
        dataControl.currentIndex,
        { silent: true, animate: false },
      );
      this.syncEmptyState(dataControl.items.length === 0);
    });
    dataControl.on("card:effects_changed", () => {
      this.carousel?.syncItems(
        this._toEngineItems(),
        dataControl.currentIndex,
        { silent: true, animate: false },
      );
      this.bar?.syncCounter();
    });
    dataControl.on("card:added", ({ addedCards, allCards }) => {
      // Sync the carousel using syncItems so only genuinely fresh cards receive the enter animation
      const engineItems = this._toEngineItems();

      const previousCount = (allCards?.length || 0) - (addedCards?.length || 0);
      const isAtLast =
        previousCount > 0 &&
        (dataControl.currentIndex === previousCount - 1 ||
          this.carousel.hardIndex === previousCount - 1);

      this.carousel.syncItems(engineItems, dataControl.currentIndex, {
        silent: true,
      });
      this.bar?.syncCounter();

      // When adding cards to an empty source, auto-select the first card and sync empty state
      const wasEmpty =
        Array.isArray(allCards) &&
        Array.isArray(addedCards) &&
        allCards.length === addedCards.length;
      if (wasEmpty && allCards.length > 0) {
        dataControl.setHardIndex(0);
        this.carousel?.scrollToCard(0);
        this.bar?.renderActions(dataControl.activeCard);
        this.syncEmptyState(false);
      } else if (
        isAtLast &&
        addedCards &&
        addedCards.length > 0 &&
        this.isCarouselViewActive()
      ) {
        // Người dùng đang đứng ở ảnh cuối cùng trước khi thêm -> tự động cuộn sang ảnh tiếp theo.
        // Chỉ khi carousel đang hiển thị: lấy ảnh mới từ lưới quản lý không được
        // đổi hình nền desktop sau lưng người dùng.
        const nextIndex = dataControl.currentIndex + 1;
        this.carousel.scrollToCard(nextIndex, { skipCommitDelay: true });
        this.syncEmptyState(false);
      } else {
        this.syncEmptyState(false);
      }
    });

    dataControl.on("card:pruned", ({ total }) => {
      showNotification(
        t("wallpaper_switcher.pruned_notice", { count: total }),
        "info",
      );
    });

    dataControl.on("feed:limit_reached", ({ cap }) => {
      showNotification(
        t("wallpaper_switcher.limit_reached", { count: cap }),
        "warning",
      );
    });

    // A feed with nothing left used to end silently, so pressing "fetch more"
    // (or hitting the trailing "+") looked broken. Prefer the source-specific
    // "no results" copy when it exists, otherwise the generic explanation.
    dataControl.on("feed:exhausted", ({ sourceId }) => {
      const specificKey = `sp.api.${sourceId}.no_result`;
      const specific = t(specificKey);
      showNotification(
        specific && specific !== specificKey
          ? specific
          : t("wallpaper_switcher.feed_exhausted"),
        "info",
      );
    });

    // Fetch failures (network down, blocked request, expired API key...) used to
    // only reach the console, leaving the "+" button silently doing nothing.
    dataControl.on("error", ({ message }) => {
      showNotification(message || t("wallpaper_switcher.fetch_error"), "error");
    });

    this.renderFromDataControl();

    renderIcons(this.container);
    translateDOM(this.container);
    this.bar?.syncRightSlot(this.activeSourceId);
  }
  /** Canonical source adapters owned by Layer 2 (`DataControl`). */
  get sources() {
    return Array.from(dataControl.sources.values());
  }

  /** The source adapter currently feeding the carousel. */
  get activeSource() {
    return (
      dataControl.sources.get(this.activeSourceId) ||
      dataControl.activeSource ||
      this.sources[0]
    );
  }

  /** Source the user most recently requested, including a queued switch. */
  get requestedSourceId() {
    return this._pendingSourceId || this.activeSourceId;
  }

  /** True while the carousel is fading/loading a different source. */
  get isSourceTransitioning() {
    return this._isSwapping;
  }

  /**
   * True when the carousel (main view) is what the user is looking at. False
   * while a submenu — the manage grid or the wallpaper customization panel —
   * covers it, so actions taken there never switch the desktop wallpaper.
   * @returns {boolean}
   */
  isCarouselViewActive() {
    const host =
      this._innerEl || this.container?.querySelector(".wallpaper_switcher_inner");
    return Boolean(host) && !host.classList.contains("submenu_active");
  }

  /** Sources the user can actually browse right now (see `BaseSource.isAvailable`). */
  get availableSources() {
    return this.sources.filter((source) => source.isAvailable);
  }

  /**
   * The tab to open on: the source that owns the current desktop wallpaper,
   * so the carousel opens with that exact image selected. Bing is the
   * fallback, matching the default `wallpaperConfig.source`.
   */
  resolveInitialSourceId() {
    const available = this.availableSources;
    const applied = getSettings().wallpaperConfig?.source || "bing";
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
  renderFromDataControl(animate = false) {
    if (!this.carousel) return;

    this.carousel.setItems(this._toEngineItems(), dataControl.currentIndex, {
      animate,
      silent: true,
    });

    this.syncEmptyState((dataControl.items || []).length === 0);
  }

  /**
   * Move the strip to a card that was applied outside the carousel (manage
   * grid). DataControl already owns the switch, so this only re-centres the
   * layout silently instead of emitting another hard-select event.
   * @param {number} index
   */
  syncCarouselIndex(index) {
    if (!this.carousel || !Number.isInteger(index) || index < 0) return;

    this.carousel.syncItems(this._toEngineItems(), index, {
      silent: true,
      animate: false,
    });
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
    const emptyEl =
      this._emptyEl || this.container?.querySelector("#wallpaper_carousel_empty");
    if (!emptyEl) return;
    emptyEl.classList.toggle("is-visible", isEmpty);
    if (isEmpty) {
      const hintEl = this._emptyHintEl || emptyEl.querySelector(".empty-sub");
      const key =
        this.activeSourceId === "collection"
          ? "wallpaper_switcher.empty_hint_collection"
          : "wallpaper_switcher.empty_hint_remote";
      if (hintEl && this._emptyHintKey !== key) {
        this._emptyHintKey = key;
        hintEl.setAttribute("data-i18n", key);
        renderIcons(emptyEl);
        translateDOM(emptyEl);
      }
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
        describeFetchError(error, t) ||
          t("sp.api.error", { provider: source.name }),
        "error",
      );
    }
  }

  /**
   * Open a native file picker inside the user gesture and resolve with chosen files
   * (empty array when cancelled).
   *
   * @returns {Promise<File[]>}
   * @private
   */
  _pickMediaFiles() {
    return new Promise((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "image/*,video/*";
      input.multiple = true;

      input.addEventListener(
        "change",
        () => resolve(Array.from(input.files || [])),
        { once: true },
      );
      input.addEventListener("cancel", () => resolve([]), { once: true });

      input.click();
    });
  }

  /**
   * Display toast notifications for warnings, errors, and imported cards
   * returned by `dataControl.importCollectionFiles(files)`.
   *
   * @param {{ addedCards?: Array<Object>, warnings?: Array<{ file: string, code: string }>, errors?: Array<{ file: string, code: string }> }} result
   * @private
   */
  _notifyImportResult({ addedCards = [], warnings = [], errors = [] } = {}) {
    for (const warning of warnings) {
      if (warning?.code === "video_large_warning") {
        showNotification(t("sp.api.local.video_large_warning"), "warning");
      }
    }

    for (const error of errors) {
      if (error?.code === "video_too_large") {
        showNotification(t("sp.api.local.video_too_large"), "error");
      } else if (error?.code === "upload_error") {
        showNotification(
          t("sp.api.collection.upload_error", { file: error.file || "" }),
          "error",
        );
      }
    }

    if (addedCards.length > 0) {
      showNotification(
        t("sp.api.collection.upload_success", { count: addedCards.length }),
        "success",
      );
    }
  }

  /**
   * Bar's right-hand button: pick local media files for Collection or ask the
   * active remote source for more items.
   * @returns {Promise<void>}
   */
  async requestUpload() {
    if (dataControl.activeSourceId !== "collection") {
      await dataControl.requestMore({
        onPruneActive: async () => {
          this.bar?.hideActions();
          if (this.carousel) {
            await this.carousel.deleteActiveCard();
          }
        },
      });
      return;
    }

    if (this._isImporting || this.bar?.isDataBusy()) return;

    const files = await this._pickMediaFiles();
    if (!files || files.length === 0) return;

    this._isImporting = true;
    this.bar?.setBusy(true);
    try {
      const result = await dataControl.importCollectionFiles(files);
      this._notifyImportResult(result);
    } catch (err) {
      console.error(
        "[WallpaperSwitcher] Failed to import collection files:",
        err,
      );
      showNotification(
        t("sp.api.collection.upload_error", { file: files[0]?.name || "" }),
        "error",
      );
    } finally {
      this._isImporting = false;
      this.bar?.setBusy(false);
      this.syncEmptyState((dataControl.items || []).length === 0);
    }
  }

  /**
   * The carousel came to rest: apply the centered wallpaper to the desktop.
   */
  async handleHardSelect(index, item) {
    if (
      this._isSwapping ||
      dataControl.status === "deleting" ||
      this.carousel?.isDeleting
    )
      return;
    // Xóa thẻ chạy carousel trước rồi store sau, nên giữa hai bước mảng `items`
    // của store còn giữ bản ghi cũ: một lượt chốt lệch thẻ là chốt của pha dọn
    // dẹp, không phải lựa chọn của người dùng. Bỏ qua ở đây — SwitcherBar chốt
    // lại thẻ kế cận sau khi store xóa xong.
    if (
      item
        ? dataControl.items[index]?.id !== item.id
        : dataControl.items.length > 0
    )
      return;
    dataControl.setHardIndex(index);
  }

  /**
   * Rebuild a card's thumbnail after the one it was drawn with failed to load.
   * Routes through `dataControl.recoverThumbnail(card)` so the canonical source
   * adapter evicts stale cached URLs before regenerating the thumbnail.
   *
   * @param {Object} card
   * @param {HTMLElement} [cardEl] - Thẻ đang hiển thị, để gán ảnh mới vào.
   * @returns {Promise<string|null>}
   */
  async recoverThumbnail(card, cardEl) {
    if (!card?.id) return null;

    const url = await dataControl.recoverThumbnail(card);

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
    this.bar?.hideActions();

    const FADE_DURATION_MS = 200;
    const startTime = Date.now();

    // Fade out carousel wrapper before swapping content
    this.carouselEl.classList.add("is-swapping");

    try {
      // Wait for fadeout animation to complete
      await new Promise((r) => setTimeout(r, FADE_DURATION_MS));

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

      const hasNext =
        this._pendingSourceId && this._pendingSourceId !== this.activeSourceId;

      if (!hasNext) {
        // Fade in new source content
        this.carouselEl.classList.remove("is-swapping");
      }

      this._isSwapping = false;
      this.bar?.setBusy(false);

      if (hasNext) {
        const nextSourceId = this._pendingSourceId;
        this._pendingSourceId = null;
        this.selectSource(nextSourceId);
      }
    }
  }

  bindEvents() {
    // Toggle button click
    this.toggleBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.toggle();
    });

    // Close button click
    const closeBtn = this.container.querySelector(
      "#wallpaper_switcher_close_btn",
    );
    closeBtn?.addEventListener("click", (e) => {
      e.stopPropagation();
      this.close();
    });

    // Click outside to close wallpaper switcher
    document.addEventListener("pointerdown", (e) => {
      if (!this.isOpen) return;
      // The position editor is a fullscreen modal over the switcher: pointer
      // gestures there must not close the switcher (which would otherwise pop
      // the action-button pill back in the middle of a grab).
      if (document.body.classList.contains("wallpaper_position_editing"))
        return;

      const target = e.target;
      if (
        target.closest(".wallpaper_switcher_inner") ||
        target.closest(".submenu_view") ||
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
      // Let the position editor own the keyboard while it is open.
      if (document.body.classList.contains("wallpaper_position_editing"))
        return;

      if (this.hasActiveSubmenu()) {
        // Esc only backs out of the submenu; Alt+W and the carousel keys must
        // not tear down the switcher underneath it.
        if (e.key === "Escape" || e.key === "Esc") {
          e.preventDefault();
          attemptCloseSubmenu();
        }
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
    if (this._actionButtonsTimer) {
      clearTimeout(this._actionButtonsTimer);
      this._actionButtonsTimer = null;
    }
    const actionButtons = document.getElementById("action_buttons");
    actionButtons?.classList.add("wallpaper_switcher_opened");
    actionButtons?.classList.remove("toggle_hidden");

    // Re-sync the active source
    this.bar?.renderTabs();
    await this.loadSource(this.activeSourceId);

    this.isOpen = true;
    if (this.container.classList.contains("preload")) {
      void this.container.offsetWidth;
      this.container.classList.remove("preload");
    }
    this.container.classList.add("active");
    this.toggleBtn.classList.add("active");
    this.carousel?.setActive(true);
    this.bar?.bindPreviewHold?.();

    // Let the slide-in transition settle the layout, then snap the carousel
    // into place. Deliberately no settle notification: merely opening the
    // switcher must not change the user's wallpaper.
    requestAnimationFrame(() => {
      this.carousel?.recenter();
    });
  }

  /**
   * True while the manage/customize submenu owns the switcher view. Alt+W and
   * Esc must then act on the submenu instead of the carousel underneath it.
   * @returns {boolean}
   */
  hasActiveSubmenu() {
    const inner =
      this._innerEl || this.container?.querySelector(".wallpaper_switcher_inner");
    return Boolean(
      inner?.classList.contains("submenu_active") ||
        this.container?.classList.contains("submenu_active"),
    );
  }

  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    if (this.hasActiveSubmenu()) {
      closeSubmenu(true);
    }
    this.bar?.closeSidebar?.();
    this.bar?.hideActions();

    this._pendingSourceId = null;
    this.carouselEl?.classList.remove("is-swapping");

    // Restore action buttons only after the switcher has fully slid away.
    const actionButtons = document.getElementById("action_buttons");
    if (this._actionButtonsTimer) {
      clearTimeout(this._actionButtonsTimer);
    }
    this._actionButtonsTimer = setTimeout(() => {
      this._actionButtonsTimer = null;
      actionButtons?.classList.remove("wallpaper_switcher_opened");
      const isDim = getSettings().hideToggleButton === true;
      if (isDim) {
        actionButtons?.classList.add("toggle_hidden");
      } else {
        actionButtons?.classList.remove("toggle_hidden");
      }
    }, 450);

    // Input is gated on the engine being active: while the switcher is hidden,
    // wheel and drag events must not reach it at all.
    this.carousel?.setActive(false);
    this.container?.classList.remove("active");
    this.bar?.unbindPreviewHold?.();
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
