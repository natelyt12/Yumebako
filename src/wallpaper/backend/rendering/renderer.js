import { applyOnloadAnimation } from "/src/wallpaper/backend/effects/onload/index.js";
import {
  getSettings,
  subscribe,
  getDefaultWallpaperEffects,
} from "/src/core/storageHandler.js";
import { t } from "/src/core/i18n.js";
import { applyWallpaperFilters } from "./filter.js";
import {
  applyWallpaperPosition,
  getActiveMediaMetrics,
  measureActiveMediaMetrics,
  setActiveMediaNaturalSize,
} from "./position.js";

/**
 * renderer.js
 * ---------------------------------------------------------------------------
 * Stateless Layer 4 desktop renderer for the `.image`, `.video`, and `.overlay`
 * DOM layers. Completely independent from DataControl state persistence and
 * Layer 3 source fetching logic.
 */

// Thời gian mờ dần lớp phủ chuyển cảnh khi đổi hình nền (ms).
const OVERLAY_FADE_MS = 400;

/**
 * Escape HTML special characters for safe credit markup insertion.
 * @param {any} str
 * @returns {string}
 */
function escapeHtml(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Stateless desktop wallpaper renderer.
 */
class WallpaperRenderer {
  constructor() {
    this.globalUI = null;
    this.hasActiveBackground = false;
    this.currentBlobUrl = null;
    this.currentType = null;
    this.currentId = null;
    this.currentCardUrl = null;
    this._renderToken = 0;
    this._applyToken = 0;
    this.isBoundToDataControl = false;
  }

  /**
   * Cache core desktop wallpaper DOM layer references on first use.
   */
  initUI() {
    if (this.globalUI) return;
    this.globalUI = {
      bg: document.querySelector(".image"),
      video: document.querySelector(".video"),
      overlay: document.querySelector(".overlay"),
    };
  }

  /**
   * Fade the transition overlay to full opacity before swapping the wallpaper.
   * @returns {Promise<void>}
   * @private
   */
  async _fadeToOverlay() {
    this.initUI();
    const overlay = this.globalUI?.overlay;
    if (!overlay) return;

    overlay.style.transition = `opacity ${OVERLAY_FADE_MS}ms var(--ease_in_out)`;
    if (Number(getComputedStyle(overlay).opacity) >= 1) return;

    overlay.style.opacity = 1;

    await new Promise((resolve) => {
      let timer = null;
      const finish = () => {
        overlay.removeEventListener("transitionend", onEnd);
        if (timer) clearTimeout(timer);
        resolve();
      };
      const onEnd = (event) => {
        if (event.target === overlay && event.propertyName === "opacity")
          finish();
      };

      overlay.addEventListener("transitionend", onEnd);
      timer = setTimeout(finish, OVERLAY_FADE_MS + 120);
    });
  }

  /**
   * Render a pure wallpaper payload onto the desktop layers.
   *
   * @param {Object} data - Render payload (`{ id, blob, type, effects, width, height }`).
   * @param {Object} [options]
   * @param {boolean} [options.firstRun=false] - Play entrance animation instead of overlay fade.
   * @param {((payload: Object) => void)|null} [options.onCommit=null] - Callback invoked once fade/decode succeeds and the render token is still valid.
   * @returns {Promise<boolean>}
   */
  async apply(data, { firstRun = false, onCommit = null } = {}) {
    this.initUI();
    const ui = this.globalUI;
    if (!ui) return false;

    if (!data || !data.blob) {
      console.error("Invalid wallpaper data", data);
      return false;
    }

    if (
      !firstRun &&
      this.currentId &&
      data.id &&
      this.currentId === data.id &&
      (!data.url || data.url === this.currentCardUrl)
    ) {
      return true;
    }

    const token = ++this._renderToken;

    if (!firstRun) await this._fadeToOverlay();
    // Abort stale render if a newer apply request arrived while fading the overlay.
    if (token !== this._renderToken) return false;

    const oldBlob = this.currentBlobUrl;
    const newBlobUrl = URL.createObjectURL(data.blob);
    let naturalWidth = Number(data.width) || 0;
    let naturalHeight = Number(data.height) || 0;

    // Decode off the main thread to avoid frame hitches when swapping large images.
    if (data.type !== "video" && newBlobUrl) {
      try {
        const decoder = new Image();
        decoder.src = newBlobUrl;
        if (typeof decoder.decode === "function") {
          await decoder.decode();
        }
        if (decoder.naturalWidth > 0 && decoder.naturalHeight > 0) {
          naturalWidth = decoder.naturalWidth;
          naturalHeight = decoder.naturalHeight;
        }
      } catch {
        // Fall back to regular browser decoding if Image.decode() fails.
      }
    }

    // Abort stale render if a newer request superseded this one during decode.
    if (token !== this._renderToken) {
      URL.revokeObjectURL(newBlobUrl);
      return false;
    }

    this.currentId = data.id || null;
    this.currentCardUrl = data.url || null;
    this.currentType = data.type;
    this.currentBlobUrl = newBlobUrl;
    this.hasActiveBackground = true;

    // Apply this card's effect profile while the overlay still covers the viewport.
    const effects = data.effects || getDefaultWallpaperEffects();
    const isVideo = data.type === "video";
    // Filter.js reads this to skip bloom on video wallpapers everywhere.
    document.body.dataset.wallpaperType = isVideo ? "video" : "image";
    applyWallpaperFilters(effects.filter, { isVideo });
    applyWallpaperPosition(effects.position);

    setActiveMediaNaturalSize({
      width: naturalWidth,
      height: naturalHeight,
      isVideo,
    });

    if (typeof onCommit === "function") {
      onCommit(data);
    }

    if (isVideo) {
      const collectionConfig = getSettings().collectionConfig || {};
      const soundEnabled = Boolean(collectionConfig.videoSound);
      const volume = Math.max(
        0,
        Math.min(1, collectionConfig.videoVolume ?? 0.5),
      );

      document.querySelectorAll(".video").forEach((v) => {
        v.style.display = "block";
        v.muted = !soundEnabled;
        v.volume = volume;
        if (newBlobUrl) {
          v.src = newBlobUrl;
          v.play().catch(() => {});
        }
      });
      document.querySelectorAll(".image").forEach((img) => {
        img.style.display = "";
        img.style.backgroundImage = "none";
        img.style.backgroundColor = "";
      });
    } else {
      document.querySelectorAll(".video").forEach((v) => {
        v.style.display = "none";
        v.pause();
        v.removeAttribute("src");
      });

      document.querySelectorAll(".image").forEach((img) => {
        img.style.display = "";
        img.style.backgroundColor = "";
        if (newBlobUrl) {
          img.style.backgroundImage = `url(${newBlobUrl})`;
        } else {
          img.style.backgroundImage = "none";
        }
      });
    }

    if (oldBlob && oldBlob !== newBlobUrl) {
      URL.revokeObjectURL(oldBlob);
    }

    if (firstRun) {
      applyOnloadAnimation();
    } else if (ui.overlay) {
      ui.overlay.style.opacity = 0;
    }

    return true;
  }

  /**
   * Connect this stateless renderer to a DataControl instance without creating
   * a static Layer 4 -> Layer 2 module dependency.
   *
   * @param {Object} dc - DataControl event emitter & payload/commit adapter.
   */
  bindDataControl(dc) {
    if (!dc || this.isBoundToDataControl) return;
    this.isBoundToDataControl = true;

    if (typeof dc.setMediaMetricsProvider === "function") {
      dc.setMediaMetricsProvider(() => getActiveMediaMetrics());
    }
    if (typeof dc.setMediaMetricsMeasurer === "function") {
      dc.setMediaMetricsMeasurer(() => measureActiveMediaMetrics());
    }

    dc.on("card:hard", async ({ card, sourceId, firstRun }) => {
      if (!card) return;
      if (
        !firstRun &&
        this.currentId &&
        card.id &&
        String(this.currentId) === String(card.id) &&
        (!card.url || card.url === this.currentCardUrl)
      ) {
        return;
      }
      const token = ++this._applyToken;
      try {
        const payload = await dc.resolveRenderPayload(card, sourceId);
        if (!payload || token !== this._applyToken) return;
        if (!payload.url && card.url) payload.url = card.url;

        const result = await this.apply(payload, {
          firstRun: Boolean(firstRun),
          onCommit: () => {
            void dc.commitAppliedCard(card, payload, sourceId);
          },
        });
        if (result === false || token !== this._applyToken) return;
        this.updateCredit(payload.credit || null);
      } catch (err) {
        if (token !== this._applyToken) return;
        console.error(
          "[WallpaperRenderer] Error applying wallpaper for card:",
          card.id,
          err,
        );
      }
    });

    dc.on("card:effects_changed", ({ card, effects }) => {
      if (!effects) return;
      if (
        card?.id &&
        this.currentId &&
        String(card.id) !== String(this.currentId)
      ) {
        return;
      }
      const isVideo =
        card?.mediaType === "video" || this.currentType === "video";
      if (effects.filter) {
        applyWallpaperFilters(effects.filter, { isVideo });
      }
      if (effects.position) {
        applyWallpaperPosition(effects.position);
      }
    });
  }

  /**
   * Show or hide the photo attribution overlay on the desktop wallpaper.
   * Accepts either a plain credit descriptor or `(source, card)` for compatibility.
   *
   * @param {{ name?: string, profileUrl?: string, photoUrl?: string, unsplashUrl?: string }|Object|null} creditOrSource
   * @param {Object} [maybeCard]
   */
  updateCredit(creditOrSource, maybeCard) {
    const el = document.getElementById("wallpaper_credit");
    if (!el) return;

    const credit =
      typeof creditOrSource?.getAttribution === "function"
        ? creditOrSource.getAttribution(maybeCard) || null
        : creditOrSource || null;

    if (!credit) {
      el.classList.remove("is-visible");
      el.setAttribute("aria-hidden", "true");
      el.replaceChildren();
      return;
    }

    const photoBy = escapeHtml(t("sp.meta.photo_by", "Photo by"));
    const onWord = escapeHtml(t("sp.meta.on", "on"));
    const authorLabel = escapeHtml(credit.name || "");
    const rawUnsplashUrl = String(
      credit.unsplashUrl || credit.photoUrl || "https://unsplash.com",
    ).trim();
    const unsplash = /^https?:\/\//i.test(rawUnsplashUrl)
      ? `<a href="${escapeHtml(rawUnsplashUrl)}" target="_blank" rel="noopener noreferrer">Unsplash</a>`
      : "Unsplash";

    if (!authorLabel) {
      // No photographer name (e.g. a seed card): link to the source only.
      el.innerHTML = `<span>${unsplash}</span>`;
    } else {
      const rawProfileUrl =
        typeof credit.profileUrl === "string" ? credit.profileUrl.trim() : "";
      const author = /^https?:\/\//i.test(rawProfileUrl)
        ? `<a href="${escapeHtml(rawProfileUrl)}" target="_blank" rel="noopener noreferrer">${authorLabel}</a>`
        : authorLabel;
      el.innerHTML = `<span>${photoBy} ${author} ${onWord} ${unsplash}</span>`;
    }

    el.classList.add("is-visible");
    el.setAttribute("aria-hidden", "false");
  }
}

export const wallpaperRenderer = new WallpaperRenderer();

/**
 * Updates video wallpaper audio (muted state and volume level).
 * @param {Object} [config]
 */
export function updateVideoAudio(config = getSettings().collectionConfig) {
  const soundEnabled = Boolean(config?.videoSound);
  const volume = Math.max(0, Math.min(1, config?.videoVolume ?? 1));
  document.querySelectorAll(".video").forEach((v) => {
    v.muted = !soundEnabled;
    v.volume = volume;
  });
}

subscribe("collectionConfig", (newConfig) => {
  updateVideoAudio(newConfig);
});
