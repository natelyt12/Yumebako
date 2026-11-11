/**
 * Single source of truth for the wallpaper *customization effects*.
 *
 * Every `id` here matches a key of the boolean state object returned by
 * `getEffectStates()` (src/wallpaper/backend/effects/effectStates.js):
 *   arrange | filters | particles | onload | wavy
 *
 * The top-bar effect chips, the Customize submenu tabs, and every "applied
 * customizations" icon list (carousel bar, manage grid, bulk-delete preview)
 * are rendered from this catalog. Adding or renaming an effect is therefore a
 * one-file change instead of editing several parallel id/icon/label lists.
 *
 * @typedef {Object} EffectDef
 * @property {"arrange"|"filters"|"particles"|"onload"|"wavy"} id - state key
 * @property {string}  icon     - Icon registry name (src/core/icon.js)
 * @property {string}  labelKey - i18n key
 * @property {string}  label    - Fallback label used when the key is missing
 * @property {boolean} [tab]    - Rendered as a Customize submenu tab (panel section)
 * @property {boolean} [action] - Rendered as an action row (opens the position editor)
 */

/** @type {EffectDef[]} */
export const EFFECT_CATALOG = [
  {
    id: "arrange",
    icon: "arrangeWallpaper",
    labelKey: "sp.wallpaper_customization.arrange_wallpaper",
    label: "Điều chỉnh vị trí",
    action: true,
  },
  {
    id: "filters",
    icon: "filterSettings",
    labelKey: "sp.wallpaper_customization.filters",
    label: "Bộ lọc & màu sắc",
    tab: true,
  },
  {
    id: "particles",
    icon: "particlesSettings",
    labelKey: "sp.wallpaper_customization.particles_settings",
    label: "Hiệu ứng nền",
    tab: true,
  },
  {
    id: "onload",
    icon: "onloadSettings",
    labelKey: "sp.wallpaper_customization.onload_settings",
    label: "Hoạt ảnh mở trang",
    tab: true,
  },
  {
    id: "wavy",
    icon: "wavySettings",
    labelKey: "sp.wallpaper_customization.wavy_parallax",
    label: "Wavy + Parallax",
    tab: true,
  },
];

/** Catalog ids in display order — handy for signature strings and lookups. */
export const EFFECT_IDS = EFFECT_CATALOG.map((def) => def.id);

/** Catalog entries that own a Customize submenu tab (panel section). */
export const CUSTOMIZE_TABS = EFFECT_CATALOG.filter((def) => def.tab);

/**
 * Settings keys that together describe a wallpaper's effect profile. A change
 * to any of them can change which customization icons are active, so every
 * surface that mirrors the effect state subscribes to all of them.
 */
export const EFFECT_SETTING_KEYS = [
  "wallpaperConfig",
  "wallpaperPosition",
  "particles",
  "onload",
  "wavy",
];
