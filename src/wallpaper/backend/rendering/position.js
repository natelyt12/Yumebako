import { getSettings } from "/src/core/storageHandler.js";

/** Apply saved position, zoom, and fit mode to image and video layers. */
export function applyWallpaperPosition(customState) {
  const settings = getSettings();
  const state = customState ||
    settings.wallpaperPosition || { x: 50, y: 50, zoom: 1, mode: "cover" };
  const realLayers = document.querySelectorAll(".image");
  const videoLayers = document.querySelectorAll(".video");

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
