import "./switcher_sidebar.css";
import { t } from "/src/core/i18n.js";
import { renderIcons } from "/src/core/icon.js";
import { createWallhavenSidebar } from "./WallhavenSidebar.js";
import { createCollectionSidebar } from "./CollectionSidebar.js";
import { createBingSidebar } from "./BingSidebar.js";
import { createUnsplashSidebar } from "./UnsplashSidebar.js";
import { createPicreSidebar } from "./PicreSidebar.js";

/**
 * SwitcherSidebar.js
 * ---------------------------------------------------------------------------
 * Coordinates the full-height drawer panel inside WallpaperSwitcher.
 * Mounts and switches between provider configuration views (Wallhaven,
 * Collection, Bing, Picre), managing open/close state, title, and key listeners.
 */
export class SwitcherSidebar {
  /**
   * @param {Object} options
   * @param {HTMLElement} options.container - Element .wallpaper_switcher_inner
   * @param {import("../../core/DataControl.js").DataControl} options.dataControl
   * @param {import("../../core/WallpaperSwitcher.js").WallpaperSwitcher} options.switcher
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
    this.currentSourceId = null;
    this._isOpen = false;
    this._onKeyDown = this._onKeyDown.bind(this);
  }

  init() {
    if (!this.sidebarEl || !this.bodyEl) return;

    // Initialize source views
    this.views.set(
      "wallhaven",
      createWallhavenSidebar({ dataControl: this.dataControl, sidebar: this }),
    );
    this.views.set(
      "collection",
      createCollectionSidebar({ dataControl: this.dataControl, sidebar: this }),
    );
    this.views.set(
      "bing",
      createBingSidebar({ dataControl: this.dataControl, sidebar: this }),
    );
    this.views.set(
      "unsplash",
      createUnsplashSidebar({ dataControl: this.dataControl, sidebar: this }),
    );
    this.views.set(
      "picre",
      createPicreSidebar({ dataControl: this.dataControl, sidebar: this }),
    );

    // Keep each view's action row for the drawer footer. Mounting it outside
    // the scrolling body keeps the buttons pinned to the bottom while content
    // scrolls, without layering another tinted surface behind them.
    for (const view of this.views.values()) {
      const actions = view.el.querySelector(".source_sidebar_actions");
      if (actions) {
        view.actionsEl = actions;
        actions.remove();
      }
    }

    // Bind events: the header close button and the invisible overlay both close the drawer
    this.closeBtn?.addEventListener("click", () => this.close());
    this.overlayEl?.addEventListener("click", () => this.close());

    renderIcons(this.sidebarEl);
  }

  get isOpen() {
    return this._isOpen;
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

    const view = this.views.get(sourceId);
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
    if (this.titleEl) {
      this.titleEl.textContent = titleText;
    }

    // Open state
    this._isOpen = true;
    this.sidebarEl.removeAttribute("inert");
    this.sidebarEl.classList.add("is-open");
    this.sidebarEl.removeAttribute("aria-hidden");
    this.overlayEl?.classList.add("is-open");
    this.settingsBtn?.classList.add("is-active");

    // Sync view state
    view.onOpen?.();

    // Listen for Escape
    document.addEventListener("keydown", this._onKeyDown);
  }

  close() {
    if (!this._isOpen) return;

    this._isOpen = false;

    // Chromium refuses to apply aria-hidden while a descendant still owns
    // focus (and logs an accessibility warning). Put focus back on the trigger
    // before hiding / inerting the drawer.
    this._restoreFocus();

    this.sidebarEl?.classList.remove("is-open");
    this.sidebarEl?.setAttribute("aria-hidden", "true");
    // `inert` also removes the closed panel from the tab order and from AT.
    this.sidebarEl?.setAttribute("inert", "");
    this.overlayEl?.classList.remove("is-open");
    this.settingsBtn?.classList.remove("is-active");

    if (this.currentSourceId) {
      const view = this.views.get(this.currentSourceId);
      view?.onClose?.();
    }

    document.removeEventListener("keydown", this._onKeyDown);
  }

  toggle(sourceId = this.dataControl.activeSourceId) {
    if (this._isOpen) {
      if (this.currentSourceId === sourceId) {
        this.close();
      } else {
        this.open(sourceId);
      }
    } else {
      this.open(sourceId);
    }
  }

  _restoreFocus() {
    if (!this.sidebarEl?.contains(document.activeElement)) return;

    this.settingsBtn?.focus({ preventScroll: true });

    // The trigger can be hidden for some sources; never leave focus trapped in
    // a panel that is about to become aria-hidden.
    if (this.sidebarEl.contains(document.activeElement)) {
      document.activeElement.blur();
    }
  }

  _onKeyDown(e) {
    if (e.key === "Escape" && this._isOpen) {
      e.preventDefault();
      e.stopPropagation();
      this.close();
    }
  }
}
