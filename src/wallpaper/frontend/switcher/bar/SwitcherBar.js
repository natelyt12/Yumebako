import "./bar.css";
import { renderIcons } from "/src/core/icon.js";
import { t } from "/src/core/i18n.js";
import {
  showConfirm,
  showNotification,
  openSubmenu,
  closeSubmenu,
} from "/src/core/ui.js";
import {
  getSettings,
  saveSettings,
  subscribe,
} from "/src/core/storageHandler.js";
import {
  resolveCardMeta,
  escapeHtml,
} from "../../../backend/sources/cardMeta.js";
import { SwitcherSidebar } from "../sidebar/SwitcherSidebar.js";
import { createManageGrid } from "../manage/manageGrid.js";
import {
  CUSTOMIZE_TABS,
  EFFECT_CATALOG,
  EFFECT_SETTING_KEYS,
  createCustomizePanel,
  hasCustomizePanel,
  openPositionEditorPopup,
} from "../../customize/index.js";
import {
  getEffectStates,
  getCardCustomizations,
} from "../../customize/state.js";

/** Sources whose wallpaper window is browsable/manageable in the grid. */
const MANAGE_SOURCES = new Set([
  "collection",
  "picre",
  "wallhaven",
  "unsplash",
]);

/**
 * SwitcherBar.js
 * ---------------------------------------------------------------------------
 * Component thống nhất quản lý toàn bộ thanh đáy (Bottom Bar) của WallpaperSwitcher.
 * Bao gồm:
 *   - Source Tabs: Chuyển đổi giữa các nguồn hình nền (Collection, Wallhaven, Picre...)
 *   - Counter: Bộ đếm vị trí thẻ mềm (softIndex) / tổng số thẻ
 *   - Action Buttons: Các nút hành động cho thẻ hiện tại (Download, View Source, Add to Collection, Delete)
 *   - Top Bar: nút cài đặt nguồn (icon) nằm bên trái tab nguồn
 *   - Right Slot: Nút tải lên (Collection)
 *
 * Hoạt động Reactive 100% theo State của DataControl.
 */
export class SwitcherBar {
  /**
   * @param {Object} options
   * @param {HTMLElement} options.container - Element .wallpaper_switcher_bar
   * @param {import("../../../backend/data/DataControl.js").DataControl} options.dataControl
   * @param {import("../WallpaperSwitcher.js").WallpaperSwitcher} options.switcher
   */
  constructor({ container, dataControl, switcher }) {
    this.container = container;
    this.dataControl = dataControl;
    this.switcher = switcher;

    this.tabsWrapper = container.querySelector(
      "#wallpaper_source_tabs_wrapper",
    );
    this.tabsContainer = container.querySelector("#wallpaper_source_tabs");
    this.counterEl = container.querySelector("#wallpaper_switcher_counter");
    this.loaderEl = container.querySelector("#wallpaper_switcher_loader");
    this.metaWrapperEl = container.querySelector(
      "#wallpaper_switcher_meta_wrapper",
    );
    this.metaSizerEl = container.querySelector(
      "#wallpaper_switcher_meta_sizer",
    );
    this.metaCardEl = container.querySelector("#wallpaper_switcher_meta_card");
    this.metaHeaderEl = container.querySelector(
      "#wallpaper_switcher_meta_header",
    );
    this.metaBodyEl = container.querySelector("#wallpaper_switcher_meta_body");
    this.actionsContainer = container.querySelector(
      "#wallpaper_switcher_actions",
    );
    this.topCenterEl = container.querySelector(
      "#wallpaper_switcher_top_center",
    );
    this.topEffectsEl = container.querySelector("#wallpaper_top_effect_list");
    this.manageBtn = container.querySelector("#wallpaper_manage_btn");
    this.customizeBtn = container.querySelector("#wallpaper_customize_btn");
    this.fetchBtn = container.querySelector("#wallpaper_fetch_btn");
    this.uploadBtn = container.querySelector("#wallpaper_upload_btn");
    this.settingsBtn = container.querySelector("#wallpaper_source_settings");

    this.tabButtons = new Map();
    this.sidebar = null;
    this.manageGrid = null;
    /** Active Customize section panel (`{ el, isDirty, revert }`), if any. */
    this._customizePanel = null;
    /** Teardown for the "hold V to preview" listeners, if bound. */
    this._previewKeyCleanup = null;
    this._token = 0;
    this._isBusy = false;
    /** Pending timer that clears the action row after it has faded out. */
    this._actionsClearTimer = null;
    /** Timer delaying the cleanup of customize submenu styles until closing animation ends. */
    this._customizeCloseTimer = null;
    /** Unsubscribers for the tab effect indicators. */
    this._customizeDotUnsubs = [];
    /** Unsubscribers for the center top bar effect indicators. */
    this._topEffectsUnsubs = [];
    /** Active effect ids currently painted in the center top bar. */
    this._topEffectsSignature = "";
    /** Coalesce the effect-key subscriptions into one dot refresh per tick. */
    this._customizeDotsScheduled = false;
    /** Coalesce the effect-key subscriptions into one top-bar refresh per tick. */
    this._topEffectsScheduled = false;
  }

  /**
   * Initialize and subscribe to DataControl.
   */
  init() {
    const inner = this.container.closest(".wallpaper_switcher_inner");
    if (inner) {
      this.sidebar = new SwitcherSidebar({
        container: inner,
        dataControl: this.dataControl,
        switcher: this.switcher,
        settingsBtn: this.settingsBtn,
      });
      this.sidebar.init();
    }

    this._bindEvents();
    this.renderTabs();
    this.bindTopBarEffects();
    this.syncState(this.dataControl.getState(), true);
    if (this.metaWrapperEl) {
      this.metaWrapperEl.addEventListener("mouseenter", () => {
        this._updateMetaExpandedHeight();
      });
    }
    if (this.dataControl.activeCard) {
      this.syncMetaInfo(this.dataControl.activeCard);
      this.renderActions(this.dataControl.activeCard);
    }
    renderIcons(this.container);

    // Subscribe to DataControl events
    this.dataControl.on("state:change", (state) => this.syncState(state));
    this.dataControl.on("card:soft", ({ card }) => {
      this.syncMetaInfo(card);
      this.hideActions();
      this._setTopEffectsVisible(false);
    });
    this.dataControl.on("card:hard", ({ card }) => {
      this.syncMetaInfo(card);
      this.renderActions(card);
      this._setTopEffectsVisible(Boolean(card), card);
    });
    this.dataControl.on("source:change", ({ sourceId }) => {
      this.closeSidebar();
      this.syncActiveTab(sourceId);
      this.syncRightSlot(sourceId);
      this.syncMetaInfo(null);
      this.hideActions();
      this.renderActions(null);
      this._setTopEffectsVisible(false);
    });
    this.dataControl.on("cards:loaded", () => {
      const card = this.dataControl.activeCard;
      this.syncRightSlot(this.dataControl.activeSourceId);
      this.syncMetaInfo(card);
      this.renderActions(card);
      this._setTopEffectsVisible(Boolean(card), card);
    });

    return this;
  }

  _bindEvents() {
    // Manage Wallpapers button (left slot): opens fullscreen submenu sliding upwards
    this.manageBtn?.addEventListener("click", (e) => {
      e.stopPropagation();
      this.openManageSubmenu();
    });

    // Wallpaper customization: toggles the Customize submenu. It is a
    // `<div role="button">` (like the effect chips) so it never inherits the
    // shared bare-button chrome — hence the explicit keyboard handling.
    if (this.customizeBtn) {
      const toggleCustomize = (e) => {
        e.stopPropagation();
        if (this.customizeBtn.classList.contains("is-disabled")) return;
        this.toggleCustomizeSubmenu();
      };
      this.customizeBtn.addEventListener("click", toggleCustomize);
      this.customizeBtn.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          toggleCustomize(e);
        }
      });
    }

    // Fetch button (for sources that support fetching more)
    this.fetchBtn?.addEventListener("click", async () => {
      if (this.isDataBusy()) return;
      this.fetchBtn.classList.add("is-loading");
      this.syncLoader();
      try {
        await this.dataControl.requestMore();
      } finally {
        this.fetchBtn.classList.remove("is-loading");
        this.syncLoader();
      }
    });

    // Upload button (for Collection)
    this.uploadBtn?.addEventListener("click", () => {
      if (this.isDataBusy()) return;
      this.switcher?.requestUpload?.();
    });

    // Settings button (for sources with custom settings like Wallhaven & Collection)
    if (this.settingsBtn) {
      this.settingsBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        const activeId = this.dataControl.activeSourceId;
        this.sidebar?.toggle(activeId);
      });
    }
  }

  /**
   * Label for the manage button and its submenu, following the active source:
   * Collection browses its own wallpapers, rolling history sources browse the
   * window of images they have fetched.
   * @param {string} [sourceId]
   * @returns {string}
   */
  getManageLabel(sourceId = this.dataControl.activeSourceId) {
    return sourceId === "collection"
      ? t("wallpaper_switcher.manage_wallpapers")
      : t("wallpaper_switcher.manage_history");
  }

  /**
   * Mở submenu Quản lý hình nền toàn màn hình trượt hướng từ dưới lên trên.
   */
  openManageSubmenu() {
    const host = this.container.closest(".wallpaper_switcher_inner");
    if (!host) return;

    const currentHeight = Math.round(host.getBoundingClientRect().height);
    if (currentHeight > 0) {
      host.style.setProperty("--switcher-inner-height", `${currentHeight}px`);
    }

    this.closeSidebar();
    clearTimeout(this._customizeCloseTimer);
    this._customizeCloseTimer = null;
    host.classList.remove("customization_active", "customization_closing");
    delete host.dataset.submenuType;
    host.style.removeProperty("--switcher-submenu-height");
    this.customizeBtn?.classList.remove("active");

    const manageLabel = this.getManageLabel();
    const content = `
            <div class="wallpaper_manage_submenu_header">
                <span class="wallpaper_manage_submenu_title">${manageLabel}</span>
                <button type="button" class="wallpaper_switcher_icon_btn submenu_back_btn">
                    <i data-icon="close"></i>
                </button>
            </div>
            <div class="wallpaper_manage_submenu_content" id="wallpaper_manage_submenu_content"></div>
        `;

    openSubmenu({
      container: host,
      title: manageLabel,
      content,
      direction: "bottom",
      isFullScreen: true,
      onClose: () => {
        this.manageGrid?.destroy();
        this.manageGrid = null;
      },
    });

    // Card grid is mounted after the submenu has injected its content shell.
    // It only talks to DataControl, so it can be rebuilt safely on every open.
    const mount = host.querySelector("#wallpaper_manage_submenu_content");
    if (mount) {
      this.manageGrid?.destroy();
      this.manageGrid = createManageGrid({
        dataControl: this.dataControl,
        onUpload: () => this.switcher?.requestUpload?.(),
        onFetch: async () => {
          if (this.isDataBusy()) return;
          await this.dataControl.requestMore();
        },
        onApplied: (index) => this.switcher?.syncCarouselIndex?.(index),
        onSettings: () => this.sidebar?.toggle(this.dataControl.activeSourceId),
      });
      mount.appendChild(this.manageGrid.el);
    }
  }

  /**
   * Đóng sidebar cài đặt nguồn nếu đang mở.
   */
  closeSidebar() {
    this.sidebar?.close();
  }

  /**
   * Bật / tắt submenu tùy chỉnh hiệu ứng hình nền (cao 600px).
   */
  toggleCustomizeSubmenu() {
    const host = this.container.closest(".wallpaper_switcher_inner");
    if (!host) return;

    if (this.customizeBtn?.classList.contains("active")) {
      closeSubmenu();
      return;
    }

    this.openCustomizeSubmenu();
  }

  /** Mở submenu Customize cao tối đa bằng viewport, trượt từ dưới lên. */
  openCustomizeSubmenu(initialTabId = null) {
    const host = this.container.closest(".wallpaper_switcher_inner");
    if (!host) return;

    const currentHeight = Math.round(host.getBoundingClientRect().height);
    if (currentHeight > 0) {
      host.style.setProperty("--switcher-inner-height", `${currentHeight}px`);
    }

    this.closeSidebar();

    if (this.manageGrid) {
      this.manageGrid.destroy();
      this.manageGrid = null;
    }

    clearTimeout(this._customizeCloseTimer);
    this._customizeCloseTimer = null;
    host.classList.remove("customization_closing");
    host.classList.add("customization_active");
    host.dataset.submenuType = "customize";
    host.style.setProperty(
      "--switcher-submenu-height",
      "min(calc(var(--switcher-inner-height, 546px) + 200px), 100vh)",
    );
    this.customizeBtn?.classList.add("active");

    const title = t("sp.wallpaper_customization.title", "Tùy chỉnh hình nền");
    const arrangeDef = EFFECT_CATALOG.find((def) => def.action);
    const arrangeTabHtml = arrangeDef
      ? `
        <button
          type="button"
          class="wallpaper_customize_tab customize_action_tab"
          data-customize-action="${arrangeDef.id}"
        >
          <i data-icon="${arrangeDef.icon}"></i>
          <span class="wallpaper_customize_tab_label" data-i18n="${arrangeDef.labelKey}">${escapeHtml(t(arrangeDef.labelKey, arrangeDef.label))}</span>
          <span class="customize_tab_dot" data-tab-dot="${arrangeDef.id}"></span>
        </button>
      `
      : "";
    const tabsHtml =
      arrangeTabHtml +
      CUSTOMIZE_TABS.map((tab, index) => {
        const isSelected = initialTabId ? tab.id === initialTabId : index === 0;
        return `
          <button
            type="button"
            class="wallpaper_customize_tab${isSelected ? " is-active" : ""}"
            role="tab"
            aria-selected="${isSelected}"
            aria-controls="wallpaper_customize_panel"
            data-customize-tab="${tab.id}"
          >
            <i data-icon="${tab.icon}"></i>
            <span class="wallpaper_customize_tab_label" data-i18n="${tab.labelKey}">${escapeHtml(tab.label)}</span>
            <span class="customize_tab_dot" data-tab-dot="${tab.id}"></span>
          </button>
        `;
      }).join("");

    const content = `
      <div class="wallpaper_customize_submenu_header">
        <span class="wallpaper_customize_submenu_title">${title}</span>
        <div class="wallpaper_customize_submenu_tools">
          <span
            class="wallpaper_customize_preview_hint"
            data-i18n="wallpaper_switcher.hold_v_preview"
          >Hold V to preview wallpaper</span>
          <button type="button" class="wallpaper_switcher_icon_btn submenu_back_btn">
            <i data-icon="close"></i>
          </button>
        </div>
      </div>
      <div class="wallpaper_customize_submenu_content" id="wallpaper_customize_submenu_content">
        <aside class="wallpaper_customize_sidebar">
          <div class="wallpaper_customize_preview_block">
            <span
              class="wallpaper_customize_preview_label"
              data-i18n="wallpaper_switcher.currently_editing"
            >Currently editing:</span>
            <div class="manage_detail_figure wallpaper_customize_preview" id="wallpaper_customize_preview"></div>
          </div>
          <div class="wallpaper_customize_tabs" role="tablist">
            ${tabsHtml}
          </div>
          <button
            type="button"
            class="wallpaper_customize_reset_all"
            id="wallpaper_customize_reset_all"
          >
            <i data-icon="trash"></i>
            <span data-i18n="sp.wallpaper_customization.clear_all">${escapeHtml(t("sp.wallpaper_customization.clear_all", "Xóa toàn bộ tùy chỉnh"))}</span>
          </button>
        </aside>
        <section
          class="wallpaper_customize_panel"
          id="wallpaper_customize_panel"
          role="tabpanel"
        ></section>
      </div>
    `;

    openSubmenu({
      container: host,
      title,
      content,
      direction: "bottom",
      isDirty: () => Boolean(this._customizePanel?.isDirty?.()),
      onClose: () => {
        // Closing with an unsaved live preview: restore the saved filters
        // before the panel (and its DOM) goes away.
        if (this._customizePanel?.isDirty?.()) this._customizePanel.revert();
        this._customizePanel?.dispose?.();
        this._customizePanel = null;
        this._unbindCustomizeDots();
        this.customizeBtn?.classList.remove("active");

        host.classList.add("customization_closing");
        // Collapse the sheet back to its resting height in the same beat as the
        // panel sliding home; waiting for the slide first read as a lag.
        host.style.setProperty(
          "--switcher-submenu-height",
          "var(--switcher-inner-height, 546px)",
        );
        clearTimeout(this._customizeCloseTimer);
        this._customizeCloseTimer = setTimeout(() => {
          this._customizeCloseTimer = null;
          host.classList.remove(
            "customization_active",
            "customization_closing",
          );
          host.style.removeProperty("--switcher-submenu-height");
          delete host.dataset.submenuType;
        }, 800);
      },
    });

    this._renderCustomizePreview(
      host.querySelector("#wallpaper_customize_preview"),
    );
    this._bindCustomizeTabs(host, initialTabId);
    this._bindCustomizeDots(host);
  }

  /**
   * "Hold V to preview wallpaper": while V is held the sheet's glass and all
   * views are hidden (instantly) so only the wallpaper remains. Bound for the
   * whole time the switcher is open, and ignored while typing in a field.
   * @param {HTMLElement} host - The `.wallpaper_switcher_inner` element.
   * @private
   */
  _bindPreviewKey(host) {
    this._unbindPreviewKey(host);

    const isSwitcherOpen = () =>
      Boolean(
        host.closest(".wallpaper_switcher")?.classList.contains("active"),
      );

    const setPreview = (active) => {
      host.classList.toggle("wallpaper_preview_active", active);
    };

    const onKeyDown = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key?.toLowerCase() !== "v") return;
      const target = e.target;
      const isTextInput =
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          target.tagName === "TEXTAREA" ||
          (target.tagName === "INPUT" &&
            !/^(checkbox|radio|button|submit|reset|range|color|file|image)$/i.test(
              target.type,
            )));
      if (isTextInput) return;
      if (!isSwitcherOpen()) return;

      e.preventDefault();
      if (e.repeat) return;

      if (document.activeElement && document.activeElement !== document.body) {
        document.activeElement.blur();
      }
      setPreview(true);
    };

    const onKeyUp = (e) => {
      if (e.key?.toLowerCase() !== "v") return;
      if (isSwitcherOpen()) e.preventDefault();
      setPreview(false);
    };

    // A keyup can be lost when the window loses focus mid-hold, so any signal
    // that the hold ended also clears the preview.
    const onBlur = () => setPreview(false);

    this._previewKeyCleanup = () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("visibilitychange", onBlur);
      setPreview(false);
    };

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    document.addEventListener("visibilitychange", onBlur);
  }

  /**
   * Release the "hold V" listeners (safe to call when none are bound).
   * @param {HTMLElement} host
   * @private
   */
  _unbindPreviewKey(host) {
    this._previewKeyCleanup?.();
    this._previewKeyCleanup = null;
    host?.classList.remove("wallpaper_preview_active");
  }

  /** Bind the hold-V preview for as long as the switcher stays open. */
  bindPreviewHold() {
    this._bindPreviewKey(this.container);
  }

  /** Release the hold-V preview (switcher closing). */
  unbindPreviewHold() {
    this._unbindPreviewKey(this.container);
  }

  /**
   * Paint the desktop wallpaper's thumbnail in the Customize sidebar preview,
   * using the same figure as the Manage grid's detail pane.
   * @param {HTMLElement|null} figure
   * @private
   */
  _renderCustomizePreview(figure) {
    if (!figure) return;

    const card = this.dataControl.activeCard;
    const src = card?.thumbnailUrl || card?.url || "";
    const isVideo =
      card?.mediaType === "video" || Boolean(card?.type?.includes("video"));

    const fallback = () => {
      const box = document.createElement("div");
      box.className = "bg_coll_no_thumb";
      box.innerHTML = `<i data-icon="${isVideo ? "videoBadge" : "imageBadge"}"></i>`;
      figure.replaceChildren(box);
      renderIcons(box);
    };

    if (!src) {
      fallback();
      return;
    }

    const img = document.createElement("img");
    img.src = src;
    img.alt = card?.title || "";
    img.decoding = "async";
    img.addEventListener("error", fallback, { once: true });
    figure.replaceChildren(img);
  }

  /**
   * Vertical tab strip of the Customize panel: one section at a time. The
   * section content lands in `#wallpaper_customize_panel`.
   * @param {HTMLElement} host
   * @private
   */
  _bindCustomizeTabs(host, initialTabId = null) {
    const tabs = Array.from(host.querySelectorAll(".wallpaper_customize_tab"));
    if (tabs.length === 0) return;

    tabs.forEach((tab) => {
      tab.addEventListener("click", async () => {
        // Action row: opens the fullscreen editor, never becomes the active tab.
        if (tab.dataset.customizeAction === "arrange") {
          openPositionEditorPopup();
          return;
        }

        const nextTabId = tab.dataset.customizeTab;
        const activeTabId = host.querySelector(
          ".wallpaper_customize_tab.is-active",
        )?.dataset.customizeTab;
        const isSwitching = Boolean(activeTabId && activeTabId !== nextTabId);

        // Leaving a section with unsaved edits would silently discard them, so
        // ask first (same dirty contract as closing the whole submenu).
        if (isSwitching && this._customizePanel?.isDirty?.()) {
          const proceed = await showConfirm(
            t("sp.wallpaper_customization.discard_changes_on_switch"),
            { isDanger: true },
          );
          if (!proceed) return;
        }

        this._selectCustomizeTab(host, nextTabId);
      });
    });

    const resetAllBtn = host.querySelector("#wallpaper_customize_reset_all");
    resetAllBtn?.addEventListener("click", () =>
      this._resetAllCustomizations(host, resetAllBtn),
    );

    const targetTab = initialTabId
      ? tabs.find((tab) => tab.dataset.customizeTab === initialTabId)
      : null;
    const initial =
      targetTab ||
      tabs.find(
        (tab) =>
          tab.dataset.customizeTab &&
          hasCustomizePanel(tab.dataset.customizeTab),
      ) ||
      tabs.find((tab) => tab.dataset.customizeTab);
    if (initial) this._selectCustomizeTab(host, initial.dataset.customizeTab);
  }

  /**
   * "Xóa toàn bộ tùy chỉnh": wipe every effect category of the wallpaper being
   * edited (position, filters, particles, onload, wavy) after confirmation,
   * then rebuild the open panel so its controls reflect the restored defaults.
   * @param {HTMLElement} host
   * @param {HTMLButtonElement|null} [trigger]
   * @private
   */
  async _resetAllCustomizations(host, trigger = null) {
    if (!this.dataControl.activeCard) return;

    const title = t(
      "sp.wallpaper_customization.clear_all",
      "Xóa toàn bộ tùy chỉnh",
    );
    const proceed = await showConfirm(
      t(
        "sp.wallpaper_customization.clear_all_confirm",
        "Tất cả tùy chỉnh của hình nền này sẽ trở về mặc định. Tiếp tục?",
      ),
      {
        title,
        okText: t("sp.wallpaper_customization.clear_all_ok", "Xóa"),
        isDanger: true,
      },
    );
    if (!proceed) return;

    if (trigger) trigger.disabled = true;
    try {
      await this.dataControl.resetActiveCardEffects();
    } finally {
      if (trigger) trigger.disabled = false;
    }

    // Rebuild the active section on the fresh defaults (also clears any dirty
    // preview) and refresh the "has effect" indicators.
    const activeTabId = host.querySelector(".wallpaper_customize_tab.is-active")
      ?.dataset.customizeTab;
    if (activeTabId) this._selectCustomizeTab(host, activeTabId);
    this._syncCustomizeTabDots(host);
    this.syncTopBarEffects();

    showNotification(
      t(
        "sp.wallpaper_customization.clear_all_done",
        "Đã xóa toàn bộ tùy chỉnh",
      ),
      "success",
    );
  }

  /**
   * Keep the static "has effect" dot on each Customize tab in sync with the
   * saved settings. Dots update live after a save, never animate.
   * @param {HTMLElement} host
   * @private
   */
  _bindCustomizeDots(host) {
    this._syncCustomizeTabDots(host);
    this._unbindCustomizeDots();

    this._customizeDotUnsubs = EFFECT_SETTING_KEYS.map((key) =>
      subscribe(key, () => this._scheduleCustomizeTabDots(host)),
    );
  }

  /**
   * One settings save fires five effect-key subscriptions (wallpaperConfig,
   * wallpaperPosition, particles, onload, wavy). Collapse them into a single
   * dot refresh on the next microtask instead of recomputing five times.
   * @param {HTMLElement} host
   * @private
   */
  _scheduleCustomizeTabDots(host) {
    if (this._customizeDotsScheduled) return;
    this._customizeDotsScheduled = true;
    queueMicrotask(() => {
      this._customizeDotsScheduled = false;
      this._syncCustomizeTabDots(host);
    });
  }

  /** @private */
  _unbindCustomizeDots() {
    this._customizeDotUnsubs?.forEach((unsubscribe) => unsubscribe());
    this._customizeDotUnsubs = [];
    this._customizeDotsScheduled = false;
  }

  /**
   * @param {HTMLElement} host
   * @private
   */
  _syncCustomizeTabDots(host) {
    if (!host?.isConnected) return;
    const states = getEffectStates();
    host.querySelectorAll("[data-tab-dot]").forEach((dot) => {
      dot.classList.toggle("is-on", Boolean(states[dot.dataset.tabDot]));
    });
  }

  /**
   * Keep the center top bar effect indicators in sync with current wallpaper effects.
   */
  bindTopBarEffects() {
    this._topEffectsUnsubs?.forEach((unsub) => unsub());
    this._topEffectsUnsubs = EFFECT_SETTING_KEYS.map((key) =>
      subscribe(key, () => this._scheduleTopBarEffects()),
    );

    this.syncTopBarEffects();
  }

  /**
   * Collapse the five effect-key subscriptions fired by one settings save into
   * a single top-bar refresh on the next microtask.
   * @private
   */
  _scheduleTopBarEffects() {
    if (this._topEffectsScheduled) return;
    this._topEffectsScheduled = true;
    queueMicrotask(() => {
      this._topEffectsScheduled = false;
      this.syncTopBarEffects();
    });
  }

  /**
   * Enable/disable the top-bar "Customize this wallpaper" button. Effects are
   * written back onto the active Collection item, so outside Collection there
   * is nothing to customize: the button stops opening the panel, swaps to a
   * "no entry" icon and explains itself in its tooltip / aria-label.
   * @param {boolean} available
   * @private
   */
  _setCustomizeAvailable(available) {
    const btn = this.customizeBtn;
    if (!btn) return;

    const text = available
      ? t("sp.wallpaper_customization.title", "Tùy chỉnh hình nền")
      : t(
          "sp.wallpaper_customization.collection_only_hint",
          "Hãy thêm ảnh vào bộ sưu tập để tùy chỉnh",
        );

    btn.classList.toggle("is-disabled", !available);
    if (btn.getAttribute("aria-disabled") !== String(!available)) {
      btn.setAttribute("aria-disabled", String(!available));
    }
    // Only the accessible name — a native `title` tooltip would fight the label
    // that already opens on hover.
    if (btn.getAttribute("aria-label") !== text) {
      btn.setAttribute("aria-label", text);
    }

    const label = btn.querySelector(".wallpaper_top_effect_text");
    if (label && label.textContent !== text) label.textContent = text;

    this._setCustomizeIcon(available ? "plus" : "prohibit");
  }

  /**
   * Swap the customize button's icon. `renderIcons()` replaces `<i data-icon>`
   * with a bare `<svg>`, so the placeholder has to be rebuilt before rendering.
   * @param {string} name
   * @private
   */
  _setCustomizeIcon(name) {
    const btn = this.customizeBtn;
    if (!btn || btn.dataset.customizeIcon === name) return;
    btn.dataset.customizeIcon = name;
    btn.querySelector("svg, i[data-icon]")?.remove();
    btn.insertAdjacentHTML("afterbegin", `<i data-icon="${name}"></i>`);
    renderIcons(btn);
  }

  syncTopBarEffects(card = null) {
    if (!this.topEffectsEl) return;
    const states = getEffectStates(card?.effects);
    const activeDefs = EFFECT_CATALOG.filter((def) => Boolean(states[def.id]));

    // Re-rendering identical content would drop the pill's hover state (it
    // would collapse under the cursor) every time a setting that does not
    // change the active effect set is saved.
    const signature = activeDefs.map((def) => def.id).join(",");
    if (signature === this._topEffectsSignature) return;
    this._topEffectsSignature = signature;

    this.topEffectsEl.innerHTML = activeDefs
      .map(
        (def) => `
        <div
          class="wallpaper_top_effect_tab"
          role="button"
          tabindex="0"
          aria-label="${escapeHtml(t(def.labelKey, def.label))}"
          data-effect-id="${def.id}"
        >
          <i data-icon="${def.icon}"></i>
          <span class="wallpaper_top_effect_text">${escapeHtml(t(def.labelKey, def.label))}</span>
        </div>
      `,
      )
      .join("");

    renderIcons(this.topEffectsEl);

    this.topEffectsEl
      .querySelectorAll(".wallpaper_top_effect_tab")
      .forEach((el) => {
        const trigger = (e) => {
          e.stopPropagation();
          const effectId = el.dataset.effectId;
          if (effectId === "arrange") {
            openPositionEditorPopup();
          } else {
            const host = this.container.closest(".wallpaper_switcher_inner");
            if (host?.classList.contains("customization_active")) {
              this._selectCustomizeTab(host, effectId);
            } else {
              this.openCustomizeSubmenu(effectId);
            }
          }
        };

        el.addEventListener("click", trigger);
        el.addEventListener("keydown", (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            trigger(e);
          }
        });
      });
  }

  /**
   * Fade the whole effect pill out/in with the card, mirroring the action row
   * (`.wallpaper_source_actions`): a pure opacity fade, and `pointer-events`
   * blocked while hidden so the chips under the cursor cannot be hit.
   * @param {boolean} visible
   * @param {Object|null} [card] Wallpaper being settled; its own effects are the
   *   truth until the renderer mirrors them into the settings (which only
   *   happens after the new image has decoded).
   * @private
   */
  _setTopEffectsVisible(visible, card = null) {
    if (!this.topCenterEl) return;
    // Refresh the chips *before* the pill is painted: the fade-in must already
    // show the new set, never the previous one for a frame.
    if (visible) this.syncTopBarEffects(card);
    this.topCenterEl.classList.toggle("is-hidden", !visible);
  }

  /**
   * Activate one Customize section and mount its panel into the right column.
   * Reverts any unsaved live preview of the section being left.
   * @param {HTMLElement} host
   * @param {string} tabId
   * @private
   */
  _selectCustomizeTab(host, tabId) {
    const tabs = Array.from(host.querySelectorAll(".wallpaper_customize_tab"));

    tabs.forEach((tab) => {
      if (tab.dataset.customizeAction) return;
      const isActive = tab.dataset.customizeTab === tabId;
      tab.classList.toggle("is-active", isActive);
      tab.setAttribute("aria-selected", String(isActive));
    });

    const panelHost = host.querySelector("#wallpaper_customize_panel");
    if (!panelHost) return;

    if (this._customizePanel?.isDirty?.()) {
      this._customizePanel.revert();
    }
    this._customizePanel?.dispose?.();
    this._customizePanel = null;
    panelHost.replaceChildren();

    const panel = createCustomizePanel(tabId);
    if (!panel) {
      const tabDef = CUSTOMIZE_TABS.find((t) => t.id === tabId);
      const placeholder = document.createElement("div");
      placeholder.className = "wallpaper_customize_placeholder";
      placeholder.innerHTML = `
        <div class="customize_placeholder_icon">
          <i data-icon="${tabDef?.icon || "settings"}"></i>
        </div>
        <span class="customize_placeholder_title">${escapeHtml(t(tabDef?.labelKey, tabDef?.label || tabId))}</span>
        <span class="customize_placeholder_desc">${escapeHtml(t("common.coming_soon", "Đang hoàn thiện..."))}</span>
      `;
      panelHost.appendChild(placeholder);
      renderIcons(placeholder);
      return;
    }

    this._customizePanel = panel;
    panelHost.appendChild(panel.el);
  }

  /**
   * @deprecated Alias for backward compatibility
   */
  closePopovers() {
    this.closeSidebar();
  }

  /**
   * Đồng bộ giao diện tổng thể theo State của DataControl.
   * @param {Object} state
   * @param {boolean} [immediate=false]
   */
  syncState(state, immediate = false) {
    this.setBusy(state.isBusy || state.status !== "idle");
    this.syncCounter(state);
    this.syncLoader(state);
    this.syncMetaInfo(state.softCard || state.activeCard);
    this.syncActiveTab(state.sourceId);
    this.syncRightSlot(state.sourceId, immediate);
    if (!state.cardCount || state.cardCount === 0 || !state.activeCard) {
      this.renderActions(null);
    }
  }

  /* ── Source Tabs ───────────────────────────────────────────────────────── */

  /**
   * Dựng danh sách các tab nguồn khả dụng.
   */
  renderTabs() {
    if (!this.tabsContainer) return;
    this.tabsContainer.innerHTML = "";
    this.tabButtons.clear();

    const sources = this.switcher?.availableSources || [];
    const activeId = this.dataControl.activeSourceId;

    sources.forEach((source) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `wallpaper_source_tab${source.id === activeId ? " active" : ""}`;
      btn.dataset.source = source.id;

      const label = document.createElement("span");
      label.dataset.i18n = `wallpaper_switcher.source.${source.id}`;
      label.textContent = source.name;
      btn.appendChild(label);

      btn.addEventListener("click", () => {
        this.switcher?.selectSource(source.id);
      });

      this.tabsContainer.appendChild(btn);
      this.tabButtons.set(source.id, btn);
    });

    this.syncCompactTabsWidth();
    renderIcons(this.tabsContainer);
  }

  /**
   * Đồng bộ footprint chiều rộng của wrapper ở trạng thái thu gọn,
   * giúp các element kế bên (counter, loader) không bị dịch chuyển khi hover mở rộng.
   */
  syncCompactTabsWidth() {
    if (!this.tabsWrapper || !this.tabsContainer) return;

    requestAnimationFrame(() => {
      const activeTab = this.tabsContainer.querySelector(
        ".wallpaper_source_tab.active",
      );
      if (activeTab) {
        const activeRect = activeTab.getBoundingClientRect();
        const activeW = activeRect.width || 80;
        // Container padding: 3px left + 3px right = 6px
        const totalW = Math.ceil(activeW + 6);
        this.tabsWrapper.style.width = totalW + "px";
      }
    });
  }

  /**
   * Cập nhật highlight cho tab đang active.
   */
  syncActiveTab(activeSourceId) {
    this.tabButtons.forEach((btn, id) => {
      btn.classList.toggle("active", id === activeSourceId);
    });
    this.syncCompactTabsWidth();
  }

  /* ── Counter ───────────────────────────────────────────────────────────── */

  /**
   * Cập nhật vị trí soft index / tổng số thẻ.
   */
  syncCounter(state = this.dataControl.getState()) {
    if (!this.counterEl) return;

    const total =
      state.total ?? state.cardCount ?? this.dataControl.items.length;
    const currentNum = !total || total === 0 ? 0 : state.softIndex + 1;
    const maxCards = Number(
      state.maxCards ?? this.dataControl.activeSource?.maxCards ?? Infinity,
    );
    const limitSuffix = Number.isFinite(maxCards) ? ` | ${maxCards}` : "";

    const text = `${currentNum} / ${total}${limitSuffix}`;

    // `state:change` bắn rất thường, mà gán `textContent` là một lần ghi DOM
    // (thay text node) — chỉ ghi khi chuỗi thật sự đổi.
    if (this.counterEl.textContent !== text) this.counterEl.textContent = text;
  }

  /* ── Loader ────────────────────────────────────────────────────────────── */

  /**
   * Đồng bộ trạng thái hiển thị của loader spinner cạnh counter.
   * @param {Object} [state]
   */
  syncLoader(state = this.dataControl?.getState()) {
    if (!this.loaderEl) return;
    const status = state?.status ?? this.dataControl?.status;
    const isLoading =
      status === "fetching" ||
      status === "switching" ||
      Boolean(this.switcher?._isSwapping);

    this.loaderEl.classList.toggle("is-hidden", !isLoading);
    this.loaderEl.setAttribute("aria-hidden", String(!isLoading));
  }

  /* ── Meta Info (Top Bar) ───────────────────────────────────────────────── */

  /**
   * Đồng bộ thông tin ảnh đang chọn lên Top Bar.
   * Sử dụng kiến trúc Morphing Container (biến hình từ chip thu gọn sang panel chi tiết khi hover).
   * @param {Object|null} [card]
   */
  syncMetaInfo(
    card = this.dataControl.softCard || this.dataControl.activeCard,
  ) {
    if (!this.metaWrapperEl) return;
    if (!card) {
      if (this.metaHeaderEl) this.metaHeaderEl.innerHTML = "";
      if (this.metaSizerEl) this.metaSizerEl.innerHTML = "";
      if (this.metaBodyEl) this.metaBodyEl.innerHTML = "";
      this.metaWrapperEl.classList.add("is-empty");
      return;
    }

    this.metaWrapperEl.classList.remove("is-empty");

    const source =
      this.dataControl.activeSource ||
      this.dataControl.sources.get(this.dataControl.activeSourceId);
    let summaryHtml = "";
    if (source && typeof source.getChipSummary === "function") {
      summaryHtml = source.getChipSummary(card);
    }

    // Fallback tương thích nếu nguồn chưa định nghĩa getChipSummary
    if (!summaryHtml) {
      const meta = resolveCardMeta(this.dataControl.activeSourceId, card);
      const parts = [];
      if (meta.leftHtml)
        parts.push(`<div class="wallpaper_meta_part">${meta.leftHtml}</div>`);
      if (meta.rightHtml)
        parts.push(`<div class="wallpaper_meta_part">${meta.rightHtml}</div>`);
      summaryHtml = parts.join('<span class="wallpaper_meta_sep">•</span>');
    }

    const summaryContentHtml = `<div class="meta_summary_content">${summaryHtml}</div>`;
    if (
      this.metaHeaderEl &&
      this.metaHeaderEl.innerHTML !== summaryContentHtml
    ) {
      this.metaHeaderEl.innerHTML = summaryContentHtml;
    }
    if (this.metaSizerEl && this.metaSizerEl.innerHTML !== summaryContentHtml) {
      this.metaSizerEl.innerHTML = summaryContentHtml;
    }

    // Tạo nội dung chi tiết cho phần thân morph khi hover
    if (this.metaBodyEl) {
      const details =
        source && typeof source.getChipDetails === "function"
          ? source.getChipDetails(card)
          : [];

      if (details.length > 0) {
        const rowsHtml = details
          .map((item) => {
            const stackedClass = item.stacked ? " is-stacked" : "";
            const valueHtml = item.html ? item.value : escapeHtml(item.value);
            return `
                        <div class="meta_detail_row${stackedClass}">
                            <span class="meta_label">${escapeHtml(item.label)}</span>
                            <span class="meta_value">${valueHtml}</span>
                        </div>
                    `;
          })
          .join("");

        const bodyHtml = `<div class="meta_details_list">${rowsHtml}</div>`;
        if (this.metaBodyEl.innerHTML !== bodyHtml) {
          this.metaBodyEl.innerHTML = bodyHtml;
        }

        this._updateMetaExpandedHeight();
      } else {
        this.metaBodyEl.innerHTML = "";
      }
    }

    renderIcons(this.metaWrapperEl);
  }

  /**
   * Cập nhật kích thước mở rộng (rộng + cao) của thẻ morph dựa trên nội dung chi tiết.
   * Tự động tính toán bề rộng để các dòng thông tin (Author, Camera, Stats...)
   * luôn nằm trọn trên 1 dòng, trừ các dòng multiline/stacked (như bản quyền Bing).
   */
  _updateMetaExpandedHeight() {
    if (!this.metaBodyEl || !this.metaCardEl) return;
    const update = () => {
      // 1. Tính toán bề rộng cần thiết cho các dòng 1 hàng (bỏ qua dòng is-stacked)
      const rows = this.metaBodyEl.querySelectorAll(
        ".meta_detail_row:not(.is-stacked)",
      );
      let maxRowWidth = 0;
      rows.forEach((row) => {
        const labelEl = row.querySelector(".meta_label");
        const valEl = row.querySelector(".meta_value");
        const labelW = labelEl ? labelEl.scrollWidth : 0;
        const valW = valEl ? valEl.scrollWidth : 0;
        // label + gap (12px) + value
        const total = labelW + 12 + valW;
        if (total > maxRowWidth) maxRowWidth = total;
      });

      // Padding trái (14px) + phải (14px) = 28px, viền 2px, đệm an toàn 6px = 36px
      const minW = 260;
      const maxW = Math.min(480, Math.floor(window.innerWidth * 0.45));
      const neededW = maxRowWidth > 0 ? Math.ceil(maxRowWidth + 36) : minW;
      const finalW = Math.min(maxW, Math.max(minW, neededW));

      this.metaCardEl.style.setProperty("--meta-expanded-w", `${finalW}px`);
      if (this.metaWrapperEl) {
        this.metaWrapperEl.style.setProperty(
          "--meta-expanded-w",
          `${finalW}px`,
        );
      }

      // 2. Đo chiều cao thực tế sau khi bề rộng mới đã được áp dụng
      const h = this.metaBodyEl.offsetHeight;
      if (h > 0) {
        // Viền trên 1px + viền dưới 1px = 2px
        this.metaCardEl.style.setProperty("--meta-expanded-h", `${h + 2}px`);
      }
    };
    update();
    requestAnimationFrame(update);
  }

  /* ── Action Buttons ────────────────────────────────────────────────────── */

  /**
   * Ẩn cụm nút action với hiệu ứng fade out.
   *
   * The DOM is only cleared *after* the fade so the buttons slide away
   * smoothly instead of snapping out of existence. Clearing is cancelled by
   * the next `renderActions` call, which then fades the row back in.
   */
  hideActions() {
    if (!this.actionsContainer) return;
    // Invalidate any in-flight render so it cannot repopulate the row after
    // this hide was requested (e.g. a soft-select during an awaited action).
    this._token++;
    this.actionsContainer.classList.add("is-hidden");
    clearTimeout(this._actionsClearTimer);
    this._actionsClearTimer = setTimeout(() => {
      this._actionsClearTimer = null;
      if (!this.actionsContainer.classList.contains("is-hidden")) return;
      this.actionsContainer.innerHTML = "";
      this.actionsContainer.classList.add("hidden");
    }, 220);
  }

  /**
   * Render action buttons for active settled card.
   *
   * The row is **instance-scoped**: it belongs to the wallpaper on stage, so
   * the whole row fades out while the carousel moves and fades back in once a
   * card settles. Source-scoped controls (manage / customize / fetch / upload /
   * settings) are handled separately and animate one by one.
   * @param {Object|null} card
   */
  async renderActions(card = this.dataControl.activeCard) {
    if (!this.actionsContainer) return;

    const token = ++this._token;
    // A fresh render supersedes the pending post-fade DOM clear.
    clearTimeout(this._actionsClearTimer);
    this._actionsClearTimer = null;

    const source = this.switcher?.activeSource;
    const actions = source?.actions || [];

    if (!card || actions.length === 0) {
      // Let the current row fade out and clear itself after the transition.
      this.hideActions();
      return;
    }

    // Kiểm tra tính khả dụng của từng action
    const context = {
      source,
      dataControl: this.dataControl,
      switcher: this.switcher,
    };
    const states = await Promise.all(
      actions.map(async (action) => {
        const verdict = action.isAvailable
          ? await action.isAvailable(card, context)
          : true;
        const resolved =
          verdict === false || !action.resolveState
            ? null
            : await action.resolveState(card, context);
        return { verdict, resolved };
      }),
    );

    if (token !== this._token) return;

    // Build into a fragment so the row swaps atomically (no half-painted list).
    const frag = document.createDocumentFragment();
    actions.forEach((action, index) => {
      const { verdict, resolved } = states[index];
      if (verdict === false) return;

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn wallpaper_action";
      if (action.danger) btn.setAttribute("data-variant", "danger");
      btn.innerHTML = `<i data-icon="${resolved?.icon ?? action.icon}"></i><span></span>`;
      const label = t(
        resolved?.labelKey ?? action.labelKey,
        resolved?.fallback ?? action.fallback,
      );
      btn.querySelector("span").textContent = label;

      if (verdict?.disabled) {
        btn.dataset.blocked = "1";
        btn.dataset.blockReason = verdict.reason || "";
        btn.disabled = true;
      }

      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        this._executeAction(action, card, btn);
      });

      frag.appendChild(btn);
    });

    if (!frag.childElementCount) {
      this.hideActions();
      return;
    }

    const wasHidden =
      this.actionsContainer.classList.contains("is-hidden") ||
      this.actionsContainer.classList.contains("hidden");

    this.actionsContainer.innerHTML = "";
    this.actionsContainer.appendChild(frag);
    this.actionsContainer.classList.remove("hidden");
    renderIcons(this.actionsContainer);
    this._applyBusyToActions();

    if (wasHidden) {
      // Commit the collapsed state before transitioning the new row in.
      this.actionsContainer.classList.add("is-hidden");
      void this.actionsContainer.offsetWidth;
      requestAnimationFrame(() => {
        if (token === this._token) {
          this.actionsContainer.classList.remove("is-hidden");
        }
      });
    } else {
      this.actionsContainer.classList.remove("is-hidden");
    }
  }

  /**
   * Thực thi một hành động trên thẻ.
   */
  async _executeAction(action, card, triggerBtn = null) {
    const source = this.switcher?.activeSource;
    const context = {
      source,
      dataControl: this.dataControl,
      switcher: this.switcher,
    };

    try {
      if (action.id === "remove") {
        await this._handleDeleteCard(card, true, triggerBtn);
      } else if (action.id === "removeFromCarousel") {
        await this._handleDeleteCard(card, false, triggerBtn);
      } else if (typeof action.run === "function") {
        await action.run(card, context);
        // Sau khi thêm vào BST, cập nhật lại trạng thái nút
        if (action.id === "add") {
          this.renderActions(card);
        }
      }
    } catch (err) {
      console.error(
        `[SwitcherBar] Error executing action [${action.id}]:`,
        err,
      );
    }
  }

  /**
   * Xóa / Gỡ thẻ khỏi danh sách thông qua DataControl.
   * @param {Object} card
   * @param {boolean} isPermanent - true: xóa vĩnh viễn khỏi Collection, false: gỡ khỏi carousel
   * @param {HTMLElement|null} [triggerBtn=null]
   */
  async _handleDeleteCard(card, isPermanent, triggerBtn = null) {
    if (isPermanent) {
      const isActive =
        String(this.dataControl.activeCard?.id) === String(card?.id);
      const customs = getCardCustomizations(card, isActive);
      let msg = t(
        "sp.api.collection.delete_msg",
        "Bạn có chắc chắn muốn xóa hình nền này khỏi bộ sưu tập?",
      );
      if (customs.length > 0) {
        const customNames = customs.map((c) => `• ${c.label}`).join("\n");
        msg += `\n\n${t("sp.api.collection.delete_customizations_warning", "Hình nền này hiện đang sở hữu các tùy chỉnh sau:")}\n${customNames}`;
      }
      const confirmed = await showConfirm(msg, {
        title: t("sp.api.collection.delete_title", "Xác nhận xóa"),
        okText: t("sp.api.collection.delete_btn", "Xóa"),
        isDanger: true,
        anchor: triggerBtn || this.actionsContainer,
        placement: "top-right",
      });
      if (!confirmed) return;
    }

    // Lấy đúng vị trí thẻ cần xóa TRƯỚC KHI animation rơi thẻ
    const targetIndex = this.dataControl.currentIndex;
    if (targetIndex < 0 || targetIndex >= this.dataControl.items.length) return;

    // Ẩn cụm nút thao tác ngay lập tức (fade out)
    this.hideActions();

    this.setBusy(true);
    try {
      // 1. Chạy animation rơi thẻ trên Carousel (tự thu hẹp DOM và chốt sang thẻ kế cận)
      const removed = this.switcher?.carousel
        ? await this.switcher.carousel.deleteActiveCard()
        : true;

      // Thẻ chưa rời DOM thì không được xóa dữ liệu: làm vậy sẽ để lại một
      // thẻ "ma" trên dải trong khi store đã mất bản ghi.
      if (!removed) {
        console.warn(
          "[SwitcherBar] Carousel từ chối xóa thẻ đang chốt; bỏ qua.",
        );
        return;
      }

      // 2. Xóa trong DataControl (cập nhật mảng items sạch & IndexedDB)
      await this.dataControl.deleteCard(targetIndex);

      // 3. Lượt hard-select trong lúc carousel dọn thẻ chạy khi store còn giữ
      // bản ghi cũ, nên nó không đưa thẻ kế cận lên desktop. Chốt lại theo
      // mảng đã xóa để desktop và carousel khớp nhau.
      if (this.dataControl.items.length > 0) {
        this.dataControl.setHardIndex(this.dataControl.currentIndex);
      }
    } finally {
      this.setBusy(false);
      this.syncCounter();
      this.renderActions(this.dataControl.activeCard);
      this.switcher?.syncEmptyState?.();
    }
  }

  /* ── Right Slot (Upload & Extra Settings) ───────────────────────────────── */

  /**
   * Show/hide a source-scoped control.
   *
   * Intentionally instant — no animation. The source swap already fades the
   * carousel; animating these controls individually fought with layout reflow
   * and the async load, so they simply appear/disappear as they originally did.
   * @param {HTMLElement|null} btn
   * @param {boolean} visible
   */
  _setButtonVisible(btn, visible) {
    if (!btn) return;
    btn.classList.toggle("hidden", !visible);
    btn.classList.remove("is-hidden");
  }

  /**
   * Synchronize right slot controls according to current source capabilities:
   * - Fetch button: visible when source.canGrow is true (for remote sources)
   * - Upload button: visible for Collection
   * - Settings button: visible when source has provider settings
   *
   * @param {string} [sourceId]
   * @param {boolean} [immediate=false]
   */
  syncRightSlot(sourceId = this.dataControl.activeSourceId, immediate = false) {
    const id =
      sourceId ||
      this.dataControl.activeSourceId ||
      this.switcher?.activeSourceId;
    const source =
      (this.switcher?.sources &&
        this.switcher.sources.find((s) => s.id === id)) ||
      this.dataControl.sources.get(id) ||
      this.switcher?.activeSource;

    const isCollection = id === "collection";
    const canGrow = !isCollection && Boolean(source?.canGrow);
    const hasExtraSettings =
      isCollection ||
      id === "wallhaven" ||
      Boolean(source?.hasProviderSettings);

    // Only sources with a browsable window get the manage view (Bing does not).
    if (this.manageBtn) {
      this._setButtonVisible(this.manageBtn, MANAGE_SOURCES.has(id), immediate);
      const manageLabel = this.getManageLabel(id);
      const manageSpan = this.manageBtn.querySelector("span");
      if (manageSpan && manageSpan.textContent !== manageLabel) {
        manageSpan.textContent = manageLabel;
      }
    }

    // Wallpaper customization is written back onto the active Collection item,
    // so every other source gets the button in its disabled, self-explaining
    // state instead of a dead click.
    this._setCustomizeAvailable(isCollection);
    if (this.fetchBtn) {
      this._setButtonVisible(this.fetchBtn, canGrow, immediate);
      const labelSpan = this.fetchBtn.querySelector("span");
      const label =
        source?.moreLabel ||
        t("wallpaper_switcher.get_new_image", "Lấy ảnh mới");
      // Cùng lý do như `syncCounter`: đừng thay text node khi chuỗi không đổi.
      if (labelSpan && labelSpan.textContent !== label) {
        labelSpan.textContent = label;
      }
    }
    if (this.uploadBtn) {
      this._setButtonVisible(this.uploadBtn, isCollection, immediate);
    }
    if (this.settingsBtn) {
      this._setButtonVisible(this.settingsBtn, hasExtraSettings, immediate);
    }
  }

  /* ── Busy State ────────────────────────────────────────────────────────── */

  /**
   * Kiểm tra xem hệ thống có đang thực hiện thao tác dữ liệu / CRUD hay không
   * (thêm thẻ, xóa thẻ, dọn dẹp mảng thẻ, tải lên, đổi nguồn).
   * @returns {boolean}
   */
  isDataBusy() {
    return Boolean(
      this._isBusy ||
      this.dataControl?.isBusy ||
      (this.dataControl?.status && this.dataControl.status !== "idle") ||
      this.switcher?._isSwapping ||
      this.switcher?.carousel?.isDeleting,
    );
  }

  /**
   * Set busy state across the switcher bar.
   * @param {boolean} busy
   */
  setBusy(busy) {
    this._isBusy = Boolean(busy);
    const dataBusy = this.isDataBusy();

    this.syncLoader();

    if (this.fetchBtn) {
      const isFetching = this.dataControl?.status === "fetching";
      this.fetchBtn.classList.toggle("is-loading", isFetching);
      this.fetchBtn.disabled = dataBusy;
    }

    if (this.uploadBtn) {
      this.uploadBtn.disabled = dataBusy;
    }

    this._applyBusyToActions();
  }

  _applyBusyToActions() {
    if (!this.actionsContainer || !this.actionsContainer.childElementCount)
      return;
    this.actionsContainer.querySelectorAll("button").forEach((btn) => {
      const blocked = btn.dataset.blocked === "1";
      const disabled = this._isBusy || blocked;
      if (btn.disabled !== disabled) btn.disabled = disabled;
    });
  }
}
