import "./shared.css";
import { createFiltersPanel } from "./panels/filters/index.js";
import { createParticlesPanel } from "./panels/particles/index.js";
import { createOnloadPanel } from "./panels/onload/index.js";
import { createWavyPanel } from "./panels/wavy/index.js";

export { openPositionEditorPopup } from "./panels/arrange/index.js";

export const CUSTOMIZE_TABS = [
  {
    id: "filters",
    icon: "filterSettings",
    labelKey: "sp.wallpaper_customization.filters",
    label: "Bộ lọc & màu sắc",
  },
  {
    id: "particles",
    icon: "particlesSettings",
    labelKey: "sp.wallpaper_customization.particles_settings",
    label: "Hiệu ứng nền",
  },
  {
    id: "onload",
    icon: "onloadSettings",
    labelKey: "sp.wallpaper_customization.onload_settings",
    label: "Hoạt ảnh mở trang",
  },
  {
    id: "wavy",
    icon: "wavySettings",
    labelKey: "sp.wallpaper_customization.wavy_parallax",
    label: "Wavy + Parallax",
  },
];

const PANEL_FACTORIES = {
  filters: createFiltersPanel,
  particles: createParticlesPanel,
  onload: createOnloadPanel,
  wavy: createWavyPanel,
};

export function hasCustomizePanel(id) {
  return Boolean(PANEL_FACTORIES[id]);
}

export function createCustomizePanel(id) {
  return PANEL_FACTORIES[id]?.() || null;
}
