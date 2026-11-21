import "../../shared.css";
import "./style.css";
import panelTemplateHtml from "./template.html?raw";
import {
  createSlider,
  confirmReset,
} from "/src/core/ui.js";
import { t } from "/src/core/i18n.js";
import { getSettings, saveSettings } from "/src/core/storageHandler.js";
import {
  FILTER_DEFAULTS,
  applyFilterConfig,
} from "../../../../backend/rendering/filter.js";
import { createAutoSaver } from "../../state.js";

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
 * Every change previews immediately on the wallpaper media and auto-saves.
 *
 * @param {{ isVideo?: boolean }} [options]
 * @returns {{ el: HTMLElement, cancelPending: () => void, dispose: () => void }}
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
      onChange: () => {
        applyFilterConfig(readConfig(), { isVideo });
        autoSave.schedule();
      },
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

  actions.append(resetBtn);
  el.appendChild(actions);

  const readConfig = () => {
    const values = {};
    for (const [id, slider] of Object.entries(sliders)) {
      values[id] = slider.value;
    }
    // Videos never carry bloom, even if the shared settings had a value.
    if (isVideo) values.bloom = 0;
    return values;
  };

  const persistConfig = () => {
    saveSettings({
      wallpaperConfig: {
        ...(getSettings().wallpaperConfig || {}),
        ...readConfig(),
      },
    });
  };

  const autoSave = createAutoSaver(persistConfig);

  resetBtn.addEventListener("click", async () => {
    if (!(await confirmReset())) return;
    for (const [id, slider] of Object.entries(sliders)) {
      if (id in FILTER_DEFAULTS) {
        slider.value = FILTER_DEFAULTS[id];
      }
    }
    applyFilterConfig(readConfig(), { isVideo });
    autoSave.now();
  });

  return {
    el,
    syncFromSettings() {
      autoSave.cancel();
      const latest = getSettings().wallpaperConfig || {};
      for (const [id, slider] of Object.entries(sliders)) {
        slider.value = latest[id] ?? FILTER_DEFAULTS[id];
      }
    },
    cancelPending: () => autoSave.cancel(),
    dispose: () => autoSave.flush(),
  };
}
