import { getSettings } from "/src/core/storageHandler.js";

// Neutral value for every filter slider. Shared by the editor (initial values,
// reset button) and the on-load applier so there is a single source of truth.
export const FILTER_DEFAULTS = {
  brightness: 1,
  contrast: 1,
  saturate: 1,
  bloom: 0,
  rgbShift: 0,
};

/** Id of the hidden SVG filter that splits the R/B channels. */
const RGB_FILTER_ID = "wallpaper_rgb_shift";

/** @type {{ svg: SVGElement, red: SVGElement, blue: SVGElement }|null} */
let rgbFilter = null;

/**
 * Build (once) the hidden SVG filter used by the RGB-shift slider.
 *
 * Red is offset by +dx and blue by −dx while green stays centred, then the
 * three channels are screened back together — the classic chromatic
 * aberration look. Keeping it in SVG means the browser runs it on the GPU and
 * still applies to `<video>`; with a shift of 0 the filter is never referenced,
 * so it costs nothing.
 *
 * @returns {{ svg: SVGElement, red: SVGElement, blue: SVGElement }}
 */
function ensureRgbFilter() {
  if (rgbFilter?.svg?.isConnected) return rgbFilter;

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("width", "0");
  svg.setAttribute("height", "0");
  svg.style.cssText =
    "position:absolute;width:0;height:0;overflow:hidden;pointer-events:none";
  svg.innerHTML = `
    <defs>
      <filter id="${RGB_FILTER_ID}" x="-15%" y="-15%" width="130%" height="130%" color-interpolation-filters="sRGB">
        <feColorMatrix in="SourceGraphic" type="matrix"
          values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" result="rgb_red" />
        <feOffset id="rgb_shift_red" in="rgb_red" dx="0" dy="0" result="rgb_red_shifted" />
        <feColorMatrix in="SourceGraphic" type="matrix"
          values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0" result="rgb_green" />
        <feColorMatrix in="SourceGraphic" type="matrix"
          values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0" result="rgb_blue" />
        <feOffset id="rgb_shift_blue" in="rgb_blue" dx="0" dy="0" result="rgb_blue_shifted" />
        <feBlend in="rgb_red_shifted" in2="rgb_green" mode="screen" result="rgb_rg" />
        <feBlend in="rgb_rg" in2="rgb_blue_shifted" mode="screen" />
      </filter>
    </defs>
  `;

  const host = document.querySelector(".background_container") || document.body;
  host.appendChild(svg);

  rgbFilter = {
    svg,
    red: svg.querySelector("#rgb_shift_red"),
    blue: svg.querySelector("#rgb_shift_blue"),
  };
  return rgbFilter;
}

/**
 * Point the shared filter at the requested offset (in px).
 * @param {number} shift
 */
function setRgbShift(shift) {
  const { red, blue } = ensureRgbFilter();
  const dx = Math.max(0, Number(shift) || 0);
  red.setAttribute("dx", String(dx));
  blue.setAttribute("dx", String(-dx));
}

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
  const rgbShift = Math.max(0, Number(config.rgbShift) || 0);

  // The SVG filter is only referenced while the shift is non-zero, so an
  // untouched wallpaper keeps the cheap CSS-only filter chain.
  let shiftPart = "";
  if (rgbShift > 0) {
    setRgbShift(rgbShift);
    shiftPart = ` url(#${RGB_FILTER_ID})`;
  } else if (rgbFilter) {
    // Park the offsets at 0 so a stale dx never lingers in the DOM.
    setRgbShift(0);
  }

  const filterStr = `brightness(${brightness}) contrast(${contrast}) saturate(${saturate})${shiftPart}`;

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
