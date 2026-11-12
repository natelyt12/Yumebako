import "../../shared.css";
import "./style.css";
import panelTemplateHtml from "./template.html?raw";
import {
  createSlider,
  confirmReset,
  showNotification,
  setSubmenuDirty,
} from "/src/core/ui.js";
import { t } from "/src/core/i18n.js";
import { getSettings, saveSettings } from "/src/core/storageHandler.js";
import {
  FILTER_DEFAULTS,
  applyFilterConfig,
  applyWallpaperFilters,
} from "../../../../backend/rendering/filter.js";
import { createSaveState } from "../../state.js";

const STANDARD_SPECS = [
  {
    id: "brightness",
    labelKey: "sp.wallpaper_customization.brightness",
    min: 0.1,
    max: 2.0,
    step: 0.05,
    unit: "×",
  },
  {
    id: "contrast",
    labelKey: "sp.wallpaper_customization.contrast",
    min: 0.1,
    max: 2.0,
    step: 0.05,
    unit: "×",
  },
  {
    id: "saturate",
    labelKey: "sp.wallpaper_customization.saturate",
    min: 0,
    max: 3.0,
    step: 0.1,
    unit: "×",
  },
];

// Everything under here is expensive to render/composite, hence the divider.
// `imageOnly` entries are skipped for video wallpapers.
const HEAVY_SPECS = [
  {
    id: "bloom",
    labelKey: "sp.wallpaper_customization.bloom",
    min: 0,
    max: 100,
    step: 10,
    unit: "%",
    imageOnly: true,
  },
  {
    id: "rgbShift",
    labelKey: "sp.wallpaper_customization.rgb_shift",
    min: 0,
    max: 20,
    step: 1,
    unit: "px",
  },
];

/**
 * Build the "Filters & Colors" editor.
 *
 * Live preview writes straight to the wallpaper media; only Save persists.
 *
 * @param {{ isVideo?: boolean }} [options]
 * @returns {{ el: HTMLElement, isDirty: () => boolean, revert: () => void }}
 */
export function createFiltersPanel({ isVideo = false } = {}) {
  const config = getSettings().wallpaperConfig || {};

  const template = document.createElement("template");
  template.innerHTML = panelTemplateHtml;
  const el = template.content.firstElementChild;

  const slidersHost = document.createElement("div");
  slidersHost.className = "wallpaper_slider_grid w_full";
  el.appendChild(slidersHost);

  /** @type {Record<string, ReturnType<typeof createSlider>>} */
  const sliders = {};

  const renderSpec = (spec) => {
    const slider = createSlider({
      label: t(spec.labelKey),
      dataI18n: spec.labelKey,
      min: spec.min,
      max: spec.max,
      step: spec.step,
      value: config[spec.id] ?? FILTER_DEFAULTS[spec.id],
      defaultValue: FILTER_DEFAULTS[spec.id],
      unit: spec.unit,
      onChange: () => setPreview(),
    });
    slidersHost.appendChild(slider);
    sliders[spec.id] = slider;
  };

  STANDARD_SPECS.forEach(renderSpec);

  // Bloom is a blurred copy of the media, which makes no sense for a playing
  // video — it gets no bloom control at all. RGB shift works on both media.
  const heavySpecs = HEAVY_SPECS.filter(
    (spec) => !(isVideo && spec.imageOnly),
  );
  if (heavySpecs.length > 0) {
    const heavyTitle = document.createElement("p");
    heavyTitle.className = "wallpaper_filter_group_title";
    heavyTitle.dataset.i18n = "sp.wallpaper_customization.heavy_effects";
    heavyTitle.textContent = t(
      "sp.wallpaper_customization.heavy_effects",
      "Hiệu ứng nặng",
    );
    slidersHost.appendChild(heavyTitle);

    heavySpecs.forEach(renderSpec);
  }

  const divider = document.createElement("div");
  divider.className = "section_divider";
  el.appendChild(divider);

  const actions = document.createElement("div");
  actions.className = "wallpaper_panel_actions";

  const resetBtn = document.createElement("button");
  resetBtn.type = "button";
  resetBtn.className = "btn flex_1";
  resetBtn.textContent = t("bg_editor.btn_reset", "Đặt lại");

  const saveBtn = document.createElement("button");
  saveBtn.type = "button";
  saveBtn.className = "btn flex_1";
  saveBtn.textContent = t("wavy.btn_save", "Lưu");

  const saveState = createSaveState(saveBtn);

  actions.append(resetBtn, saveBtn);
  el.appendChild(actions);

  let isDirty = false;

  const syncDirty = (next) => {
    isDirty = next;
    setSubmenuDirty(next);
  };

  const readConfig = () => {
    const values = {};
    for (const [id, slider] of Object.entries(sliders)) {
      values[id] = slider.value;
    }
    return values;
  };

  // The values the panel opened with are the "last saved" baseline.
  saveState.markSaved(readConfig());

  const setPreview = () => {
    const config = readConfig();
    syncDirty(saveState.sync(config));
    applyFilterConfig(config, { isVideo });
  };

  const revert = () => {
    applyWallpaperFilters(undefined, { isVideo });
    syncDirty(false);
  };

  resetBtn.addEventListener("click", async () => {
    if (!(await confirmReset())) return;
    for (const [id, slider] of Object.entries(sliders)) {
      if (id in FILTER_DEFAULTS) {
        slider.value = FILTER_DEFAULTS[id];
      }
    }
    setPreview();
  });

  saveBtn.addEventListener("click", () => {
    const config = readConfig();
    // Videos never carry bloom, even if the shared settings had a value.
    if (isVideo) config.bloom = 0;
    saveSettings({
      wallpaperConfig: {
        ...(getSettings().wallpaperConfig || {}),
        ...config,
      },
    });
    saveState.markSaved(config);
    showNotification(t("common.saved_changes"), "success");
    syncDirty(false);
    applyWallpaperFilters(undefined, { isVideo });
  });

  return { el, isDirty: () => isDirty, revert };
}
