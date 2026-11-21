import { getSettings } from "/src/core/storageHandler.js";

/**
 * @typedef {Object} ActiveMediaMetrics
 * @property {number} width - Rendered layer container width in px.
 * @property {number} height - Rendered layer container height in px.
 * @property {number} naturalWidth - Intrinsic media width in px (0 if unknown).
 * @property {number} naturalHeight - Intrinsic media height in px (0 if unknown).
 * @property {boolean} isVideo - True when the active wallpaper layer is a video.
 * @property {string} fitMode - Current fit mode ("cover" | "contain").
 */

let cachedNaturalSize = {
  width: 0,
  height: 0,
  isVideo: false,
};

/** Cached connected desktop `.image` and `.video` layers to avoid DOM queries during drag. */
let cachedImageLayers = null;
let cachedVideoLayers = null;

function getImageLayers() {
  if (typeof document === "undefined") return [];
  if (
    cachedImageLayers &&
    cachedImageLayers.length > 0 &&
    cachedImageLayers.every((el) => el.isConnected)
  ) {
    return cachedImageLayers;
  }
  cachedImageLayers = Array.from(document.querySelectorAll(".image"));
  return cachedImageLayers;
}

function getVideoLayers() {
  if (typeof document === "undefined") return [];
  if (
    cachedVideoLayers &&
    cachedVideoLayers.length > 0 &&
    cachedVideoLayers.every((el) => el.isConnected)
  ) {
    return cachedVideoLayers;
  }
  cachedVideoLayers = Array.from(document.querySelectorAll(".video"));
  return cachedVideoLayers;
}

/**
 * Record the intrinsic natural dimensions of the currently rendered media.
 * Called by `WallpaperRenderer.apply()` once media metadata/decode is available.
 *
 * @param {{ width?: number, height?: number, isVideo?: boolean }} [size]
 */
export function setActiveMediaNaturalSize({
  width = 0,
  height = 0,
  isVideo = false,
} = {}) {
  cachedNaturalSize = {
    width: Math.max(0, Number(width) || 0),
    height: Math.max(0, Number(height) || 0),
    isVideo: Boolean(isVideo),
  };
}

/**
 * Resolve the active desktop wallpaper DOM element (`.video` when playing, else `.image`).
 * @returns {HTMLElement|null}
 */
function getActiveLayerElement() {
  if (typeof document === "undefined") return null;
  const videos = getVideoLayers();
  for (const v of videos) {
    if (v.style.display !== "none" && v.videoWidth > 0) {
      return v;
    }
  }
  if (document.body?.dataset?.wallpaperType === "video") {
    for (const v of videos) {
      if (v.style.display !== "none") return v;
    }
  }
  return getImageLayers()[0] || null;
}

/**
 * Synchronously return active wallpaper container & intrinsic media metrics.
 * Layer 1 (e.g. Arrange panel) consumes this via `dataControl.getActiveMediaMetrics()`
 * or `backend/index.js` without querying `.image`/`.video` DOM directly.
 *
 * @returns {ActiveMediaMetrics}
 */
export function getActiveMediaMetrics() {
  const layer = getActiveLayerElement();
  const width =
    layer?.clientWidth ||
    (typeof window !== "undefined" ? window.innerWidth : 0) ||
    1;
  const height =
    layer?.clientHeight ||
    (typeof window !== "undefined" ? window.innerHeight : 0) ||
    1;
  const isVideo = layer
    ? layer.tagName === "VIDEO"
    : Boolean(cachedNaturalSize.isVideo);

  const naturalWidth = isVideo
    ? layer?.videoWidth || cachedNaturalSize.width || 0
    : cachedNaturalSize.width || 0;
  const naturalHeight = isVideo
    ? layer?.videoHeight || cachedNaturalSize.height || 0
    : cachedNaturalSize.height || 0;
  const fitMode = getSettings().wallpaperPosition?.mode || "cover";

  return {
    width,
    height,
    naturalWidth,
    naturalHeight,
    isVideo,
    fitMode,
  };
}

/**
 * Measure active wallpaper metrics, probing the computed background image once
 * if natural dimensions are not yet cached.
 *
 * @returns {Promise<ActiveMediaMetrics>}
 */
export async function measureActiveMediaMetrics() {
  const metrics = getActiveMediaMetrics();
  if (
    metrics.isVideo ||
    (metrics.naturalWidth > 0 && metrics.naturalHeight > 0) ||
    typeof document === "undefined" ||
    typeof Image === "undefined"
  ) {
    return metrics;
  }

  const layer = getActiveLayerElement();
  const bg =
    layer && typeof getComputedStyle === "function"
      ? getComputedStyle(layer).backgroundImage
      : "";
  const match = bg && bg.match(/url\(["']?(.*?)["']?\)/);
  if (!match?.[1]) return metrics;

  const probed = await new Promise((resolve) => {
    const probe = new Image();
    probe.onload = () =>
      resolve({
        width: probe.naturalWidth || 0,
        height: probe.naturalHeight || 0,
      });
    probe.onerror = () => resolve(null);
    probe.src = match[1];
  });

  if (probed && probed.width > 0 && probed.height > 0) {
    setActiveMediaNaturalSize({
      width: probed.width,
      height: probed.height,
      isVideo: false,
    });
  }

  return getActiveMediaMetrics();
}

/**
 * Compute cover-fitted painted dimensions and signed viewport overflow for a given zoom.
 * Falls back to 16:9 aspect ratio when natural dimensions are unavailable.
 *
 * @param {Partial<ActiveMediaMetrics>} metrics
 * @param {number} [zoom=1]
 * @returns {{ renderedWidth: number, renderedHeight: number, containerWidth: number, containerHeight: number, overflowX: number, overflowY: number }}
 */
export function computeCoverOverflow(metrics, zoom = 1) {
  const cw = Number(metrics?.width) || 1;
  const ch = Number(metrics?.height) || 1;
  const hasNatural =
    Number(metrics?.naturalWidth) > 0 && Number(metrics?.naturalHeight) > 0;
  const nw = hasNatural ? Number(metrics.naturalWidth) : 16;
  const nh = hasNatural ? Number(metrics.naturalHeight) : 9;
  const z = Number(zoom) || 1;

  const coverScale = Math.max(cw / nw, ch / nh);
  const renderedWidth = nw * coverScale;
  const renderedHeight = nh * coverScale;

  return {
    renderedWidth,
    renderedHeight,
    containerWidth: cw,
    containerHeight: ch,
    overflowX: z * renderedWidth - cw,
    overflowY: z * renderedHeight - ch,
  };
}

/**
 * Apply saved position, zoom, and fit mode to image and video layers.
 * @param {Object} [customState]
 */
export function applyWallpaperPosition(customState) {
  const settings = getSettings();
  const state = customState ||
    settings.wallpaperPosition || { x: 50, y: 50, zoom: 1, mode: "cover" };
  const realLayers = getImageLayers();
  const videoLayers = getVideoLayers();

  const mode = state.mode || "cover";

  realLayers.forEach((realLayer) => {
    realLayer.style.backgroundSize = mode;

    if (mode === "contain") {
      realLayer.style.backgroundPosition = "center";
      realLayer.style.transformOrigin = "center";
      realLayer.style.transform = "scale(1)";
    } else {
      realLayer.style.transformOrigin = `${state.x}% ${state.y}%`;
      realLayer.style.backgroundPosition = `${state.x}% ${state.y}%`;
      realLayer.style.transform = `scale(${state.zoom})`;
    }
  });

  videoLayers.forEach((videoLayer) => {
    videoLayer.style.objectFit = mode;

    if (mode === "contain") {
      videoLayer.style.objectPosition = "center";
      videoLayer.style.transformOrigin = "center";
      videoLayer.style.transform = "scale(1)";
    } else {
      videoLayer.style.transformOrigin = `${state.x}% ${state.y}%`;
      videoLayer.style.objectPosition = `${state.x}% ${state.y}%`;
      videoLayer.style.transform = `scale(${state.zoom})`;
    }
  });
}
