import "./switcher_sidebar.css";
import { t } from "/src/core/i18n.js";
import { renderIcons } from "/src/core/icon.js";
import { Drawer } from "/src/core/ui.js";
import { createWallhavenSidebar } from "./WallhavenSidebar.js";
import { createCollectionSidebar } from "./CollectionSidebar.js";
import { createBingSidebar } from "./BingSidebar.js";
import { createUnsplashSidebar } from "./UnsplashSidebar.js";
import { createPicreSidebar } from "./PicreSidebar.js";

/**
 * SwitcherSidebar.js
 * ---------------------------------------------------------------------------
 * Coordinates the full-height drawer panel inside WallpaperSwitcher.
 * Powered by the generic Drawer UI primitive.
 * Mounts and switches between provider configuration views (Wallhaven,
 * Collection, Bing, Picre), managing open/close state, title, and key listeners.
 */
export class SwitcherSidebar {
  /**
   * @param {Object} options
   * @param {HTMLElement} options.container - Element .wallpaper_switcher_inner
   * @param {import("../../../backend/data/DataControl.js").DataControl} options.dataControl
   * @param {import("../WallpaperSwitcher.js").WallpaperSwitcher} options.switcher
   * @param {HTMLElement} [options.settingsBtn]
   */
  constructor({ container, dataControl, switcher, settingsBtn }) {
    this.container = container;
    this.dataControl = dataControl;
    this.switcher = switcher;
    this.settingsBtn = settingsBtn;

    this.sidebarEl = container.querySelector("#wallpaper_switcher_sidebar");
    this.titleEl = container.querySelector("#wallpaper_switcher_sidebar_title");
    this.closeBtn = container.querySelector(
      "#wallpaper_switcher_sidebar_close_btn",
    );
    this.overlayEl = container.querySelector(
      "#wallpaper_switcher_sidebar_overlay",
    );
    this.bodyEl = container.querySelector("#wallpaper_switcher_sidebar_body");
    this.footerEl = container.querySelector(
      "#wallpaper_switcher_sidebar_footer",
    );

    this.views = new Map();
    this.viewFactories = new Map();
    this.currentSourceId = null;

    this.drawer = new Drawer({
      container: this.container,
      element: this.sidebarEl,
      overlayElement: this.overlayEl,
      triggerBtn: this.settingsBtn,
      width: "380px",
      placement: "left",
      onOpen: () => {
        if (this.currentSourceId) {
          const view = this.views.get(this.currentSourceId);
          view?.onOpen?.();
        }
      },
      onClose: () => {
        if (this.currentSourceId) {
          const view = this.views.get(this.currentSourceId);
          view?.onClose?.();
        }
      },
    });
  }

  init() {
    if (!this.sidebarEl || !this.bodyEl) return;

    // Register lazy factories so provider sidebar DOM/listeners only mount on first open.
    this.viewFactories.set("wallhaven", () =>
      createWallhavenSidebar({ dataControl: this.dataControl, sidebar: this }),
    );
    this.viewFactories.set("collection", () =>
      createCollectionSidebar({ dataControl: this.dataControl, sidebar: this }),
    );
    this.viewFactories.set("bing", () =>
      createBingSidebar({ dataControl: this.dataControl, sidebar: this }),
    );
    this.viewFactories.set("unsplash", () =>
      createUnsplashSidebar({ dataControl: this.dataControl, sidebar: this }),
    );
    this.viewFactories.set("picre", () =>
      createPicreSidebar({ dataControl: this.dataControl, sidebar: this }),
    );

    renderIcons(this.sidebarEl);
  }

  /**
   * Lazily instantiate and mount a provider sidebar view on first open.
   * @param {string} sourceId
   * @returns {Object|null}
   * @private
   */
  _getOrCreateView(sourceId) {
    if (this.views.has(sourceId)) return this.views.get(sourceId);
    const factory = this.viewFactories.get(sourceId);
    if (!factory) return null;

    const view = factory();
    if (!view) return null;

    // Keep each view's action row for the drawer footer so buttons stay pinned
    // to the bottom while content scrolls.
    const actions = view.el?.querySelector(".source_sidebar_actions");
    if (actions) {
      view.actionsEl = actions;
      actions.remove();
      renderIcons(actions);
    }
    if (view.el) renderIcons(view.el);

    this.views.set(sourceId, view);
    return view;
  }

  get isOpen() {
    return this.drawer.isOpen;
  }

  /**
   * Reload a source through the switcher so freshly saved provider settings are
   * applied. (`DataControl` has no reload hook of its own; the switcher owns the
   * refetch/render flow — this is what the old settings popovers used too.)
   * @param {string} sourceId
   */
  async reload(sourceId) {
    await this.switcher?.loadSource?.(sourceId);
  }

  open(sourceId = this.dataControl.activeSourceId) {
    if (!this.sidebarEl || !this.bodyEl) return;

    const view = this._getOrCreateView(sourceId);
    if (!view) {
      console.warn(
        `[SwitcherSidebar] No view registered for source: ${sourceId}`,
      );
      return;
    }

    // Switch active view content
    if (this.currentSourceId !== sourceId) {
      this.bodyEl.innerHTML = "";
      this.bodyEl.appendChild(view.el);
      this.currentSourceId = sourceId;
    }

    // Mount the view's pinned action row (if it has one)
    this.footerEl?.replaceChildren();
    if (this.footerEl) {
      if (view.actionsEl) {
        this.footerEl.appendChild(view.actionsEl);
        this.footerEl.hidden = false;
      } else {
        this.footerEl.hidden = true;
      }
    }

    // Update title
    const source = this.dataControl.sources.get(sourceId);
    const sourceName = t(
      `wallpaper_switcher.source.${sourceId}`,
      source?.name || sourceId,
    );
    const titleText = t("wallpaper_switcher.extra_settings", {
      source: sourceName,
    });
    this.drawer.setTitle(titleText);

    // Open through Drawer primitive
    this.drawer.open();
  }

  close() {
    this.drawer.close();
  }

  toggle(sourceId = this.dataControl.activeSourceId) {
    if (this.drawer.isOpen) {
      if (this.currentSourceId === sourceId) {
        this.close();
      } else {
        this.open(sourceId);
      }
    } else {
      this.open(sourceId);
    }
  }
}
