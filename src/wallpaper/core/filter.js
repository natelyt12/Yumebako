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
 * Renders a filter config onto the wallpaper media and the bloom layer.
 * Used by both the live preview and the on-load applier.
 */
export function applyFilterConfig(config) {
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
    bloomContainer.style.opacity =
      (config.bloom ?? FILTER_DEFAULTS.bloom) / 100;
  }
}

/**
 * Apply the saved filter config on page load.
 */
export function applyWallpaperFilters(config) {
  applyFilterConfig(config || getSettings().wallpaperConfig || {});
}
