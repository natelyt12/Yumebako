import { getSettings } from "/src/core/storageHandler.js";

// Neutral value for every filter slider. Shared by the editor (initial values,
// reset button) and the on-load applier so there is a single source of truth.
export const FILTER_DEFAULTS = {
  brightness: 1,
  contrast: 1,
  saturate: 1,
  bloom: 0,
};

/**
 * True when the desktop wallpaper currently on screen is a video. The renderer
 * stamps it on `<body>` so every filter consumer (on-load applier, editor
 * preview…) agrees without threading the media type through each call.
 * @returns {boolean}
 */
export function isVideoWallpaper() {
  return (
    typeof document !== "undefined" &&
    document.body?.dataset?.wallpaperType === "video"
  );
}

/**
 * Renders a filter config onto the wallpaper media and the bloom layer.
 * Used by both the live preview and the on-load applier.
 *
 * Bloom is image-only: a blurred, screen-blended copy of a playing video is
 * both expensive and visually wrong, so videos always run without it.
 *
 * @param {Object} config
 * @param {{ isVideo?: boolean }} [options]
 */
export function applyFilterConfig(config, { isVideo = isVideoWallpaper() } = {}) {
  const brightness = config.brightness ?? FILTER_DEFAULTS.brightness;
  const contrast = config.contrast ?? FILTER_DEFAULTS.contrast;
  const saturate = config.saturate ?? FILTER_DEFAULTS.saturate;

  const filterStr = `brightness(${brightness}) contrast(${contrast}) saturate(${saturate})`;

  // The bloom layer is a blurred, screen-blended copy of the same media, so it
  // only takes the saturation — running the full chain again would double up.
  document.querySelectorAll(".image, .video").forEach((el) => {
    el.style.filter = el.parentElement?.classList.contains("bloom_container")
      ? `saturate(${saturate})`
      : filterStr;
  });

  const bloomContainer = document.querySelector(".bloom_container");
  if (bloomContainer) {
    bloomContainer.style.opacity = isVideo
      ? "0"
      : String((config.bloom ?? FILTER_DEFAULTS.bloom) / 100);
  }
}

/**
 * Apply the saved filter config on page load.
 * @param {Object} [config]
 * @param {{ isVideo?: boolean }} [options]
 */
export function applyWallpaperFilters(config, options = {}) {
  applyFilterConfig(config || getSettings().wallpaperConfig || {}, options);
}
