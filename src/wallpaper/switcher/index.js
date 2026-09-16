/**
 * Wallpaper Switcher module barrel.
 * ---------------------------------------------------------------------------
 * Public entry point for the standalone switcher (Alt + W):
 *   - wallpaperSwitcher — the orchestrator singleton
 *   - WallpaperSwitcher  — its class, for anything that needs to build its own
 *
 * Everything else (card stores, sources, carousel) is internal to the module.
 */
export { WallpaperSwitcher, wallpaperSwitcher } from "./WallpaperSwitcher.js";
