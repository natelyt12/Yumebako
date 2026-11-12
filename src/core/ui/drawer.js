import "./drawer.css";
import { renderIcons } from "/src/core/icon.js";

/**
 * Drawer component: a reusable sliding side sheet with Decoupled Layering glassmorphism,
 * dynamic width support, left/right placement, and focus management.
 */
export class Drawer {
  /**
   * @param {Object} options
   * @param {HTMLElement} [options.container] - Container element to mount drawer inside (defaults to document.body).
   * @param {string} [options.title=""] - Drawer title text or HTML.
   * @param {string} [options.width="380px"] - Dynamic width (CSS length, e.g. "380px", "680px").
   * @param {"left"|"right"} [options.placement="left"] - Slide direction ("left" or "right").
   * @param {HTMLElement} [options.triggerBtn=null] - Element to restore focus to upon close.
   * @param {HTMLElement} [options.element=null] - Pre-existing drawer element to bind to (optional).
   * @param {HTMLElement} [options.overlayElement=null] - Pre-existing overlay element to bind to (optional).
   * @param {"transparent"|"dim"} [options.backdrop="transparent"] - Overlay backdrop style.
   * @param {() => void} [options.onOpen=null] - Open lifecycle callback.
   * @param {() => void} [options.onClose=null] - Close lifecycle callback.
   */
  constructor(options = {}) {
    this.container = options.container || document.body;
    this.titleText = options.title || "";
    this.width = options.width || "380px";
    this.placement = options.placement === "right" ? "right" : "left";
    this.triggerBtn = options.triggerBtn || null;
    this.backdrop = options.backdrop || "transparent";
    this.onOpen = options.onOpen || null;
    this.onClose = options.onClose || null;

    this._isOpen = false;
    this._isCustomElement = Boolean(options.element);
    this._onKeyDown = this._onKeyDown.bind(this);

    this._initDOM(options.element, options.overlayElement);
    this._bindEvents();
  }

  /**
   * Initializes or binds DOM elements.
   * @private
   */
  _initDOM(existingDrawer, existingOverlay) {
    // 1. Overlay click-catcher
    if (existingOverlay) {
      this.overlayEl = existingOverlay;
    } else {
      this.overlayEl = document.createElement("div");
      this.overlayEl.className = "ui_drawer_overlay";
      if (this.backdrop === "dim") {
        this.overlayEl.setAttribute("data-backdrop", "dim");
      }
      this.overlayEl.setAttribute("aria-hidden", "true");
      this.container.appendChild(this.overlayEl);
    }

    // 2. Drawer Panel
    if (existingDrawer) {
      this.drawerEl = existingDrawer;
      this.titleEl = this.drawerEl.querySelector(".ui_drawer_title, [data-drawer-title]");
      this.closeBtn = this.drawerEl.querySelector(".ui_drawer_close, [data-drawer-close]");
      this.bodyEl = this.drawerEl.querySelector(".ui_drawer_body, [data-drawer-body]");
      this.footerEl = this.drawerEl.querySelector(".ui_drawer_footer, [data-drawer-footer]");
    } else {
      this.drawerEl = document.createElement("aside");
      this.drawerEl.className = "ui_drawer";
      this.drawerEl.setAttribute("aria-hidden", "true");
      this.drawerEl.setAttribute("inert", "");

      this.drawerEl.innerHTML = `
        <div class="ui_drawer_header">
          <span class="ui_drawer_title"></span>
          <button type="button" class="ui_drawer_close">
            <i data-icon="close"></i>
          </button>
        </div>
        <div class="ui_drawer_body"></div>
        <div class="ui_drawer_footer" hidden></div>
      `;

      this.titleEl = this.drawerEl.querySelector(".ui_drawer_title");
      this.closeBtn = this.drawerEl.querySelector(".ui_drawer_close");
      this.bodyEl = this.drawerEl.querySelector(".ui_drawer_body");
      this.footerEl = this.drawerEl.querySelector(".ui_drawer_footer");

      this.container.appendChild(this.drawerEl);
      renderIcons(this.drawerEl);
    }

    // Apply configuration
    this.setWidth(this.width);
    this.setPlacement(this.placement);
    if (this.titleText) {
      this.setTitle(this.titleText);
    }
  }

  /**
   * Bind event listeners for close actions.
   * @private
   */
  _bindEvents() {
    this._onCloseClick = () => this.close();
    this.closeBtn?.addEventListener("click", this._onCloseClick);
    this.overlayEl?.addEventListener("click", this._onCloseClick);
  }

  get isOpen() {
    return this._isOpen;
  }

  /**
   * Sets the drawer title.
   * @param {string|HTMLElement} title
   */
  setTitle(title) {
    if (!this.titleEl) return;
    if (title instanceof HTMLElement) {
      this.titleEl.replaceChildren(title);
    } else {
      this.titleEl.textContent = title;
    }
  }

  /**
   * Sets dynamic width (e.g. "380px", "680px").
   * @param {string} width
   */
  setWidth(width) {
    this.width = width;
    this.drawerEl?.style.setProperty("--drawer-width", width);
  }

  /**
   * Sets placement ("left" or "right").
   * @param {"left"|"right"} placement
   */
  setPlacement(placement) {
    this.placement = placement === "right" ? "right" : "left";
    this.drawerEl?.setAttribute("data-placement", this.placement);
  }

  /**
   * Sets body content.
   * @param {HTMLElement|string} content
   */
  setBody(content) {
    if (!this.bodyEl) return;
    if (content instanceof HTMLElement) {
      this.bodyEl.replaceChildren(content);
    } else {
      this.bodyEl.innerHTML = content;
    }
  }

  /**
   * Sets footer content.
   * @param {HTMLElement|string|null} content
   */
  setFooter(content) {
    if (!this.footerEl) return;
    if (!content) {
      this.footerEl.replaceChildren();
      this.footerEl.hidden = true;
      return;
    }
    if (content instanceof HTMLElement) {
      this.footerEl.replaceChildren(content);
    } else {
      this.footerEl.innerHTML = content;
    }
    this.footerEl.hidden = false;
  }

  /**
   * Opens the drawer.
   */
  open() {
    if (this._isOpen || !this.drawerEl) return;

    this._isOpen = true;
    this.drawerEl.removeAttribute("inert");
    this.drawerEl.removeAttribute("aria-hidden");
    this.overlayEl?.classList.add("is-open");

    // Force layout flush so off-screen initial transform is evaluated before transition
    void this.drawerEl.offsetHeight;
    void window.getComputedStyle(this.drawerEl).transform;

    this.drawerEl.classList.add("is-open");

    this.onOpen?.();

    document.addEventListener("keydown", this._onKeyDown);
  }

  /**
   * Closes the drawer.
   */
  close() {
    if (!this._isOpen || !this.drawerEl) return;

    this._isOpen = false;
    this._restoreFocus();

    this.drawerEl.classList.remove("is-open");
    this.drawerEl.setAttribute("aria-hidden", "true");
    this.drawerEl.setAttribute("inert", "");
    this.overlayEl?.classList.remove("is-open");

    this.onClose?.();

    document.removeEventListener("keydown", this._onKeyDown);
  }

  /**
   * Toggles the drawer open/close state.
   */
  toggle() {
    if (this._isOpen) {
      this.close();
    } else {
      this.open();
    }
  }

  /**
   * Returns focus to trigger button if focus was inside the drawer.
   * @private
   */
  _restoreFocus() {
    if (!this.drawerEl?.contains(document.activeElement)) return;

    this.triggerBtn?.focus?.({ preventScroll: true });

    if (this.drawerEl.contains(document.activeElement)) {
      document.activeElement.blur();
    }
  }

  /**
   * Closes drawer on Escape key.
   * @private
   */
  _onKeyDown(e) {
    if (e.key === "Escape" && this._isOpen) {
      e.preventDefault();
      e.stopPropagation();
      this.close();
    }
  }

  /**
   * Cleanup and remove DOM elements if created automatically.
   */
  destroy() {
    this.close();
    this.closeBtn?.removeEventListener("click", this._onCloseClick);
    this.overlayEl?.removeEventListener("click", this._onCloseClick);
    document.removeEventListener("keydown", this._onKeyDown);

    if (!this._isCustomElement) {
      this.drawerEl?.remove();
      this.overlayEl?.remove();
    }
  }
}
