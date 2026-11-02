import "./customize.css";
import {
  confirmReset,
  createSlider,
  initButtons,
  openSidebarSubmenu,
  setSubmenuDirty,
  showNotification,
} from "/src/core/ui.js";
import { t } from "/src/core/i18n.js";
import { getSettings, saveSettings } from "/src/core/storageHandler.js";
import { cloneData, getWavyController } from "../../motion/WavyEngine.js";

/**
 * Slider spec for the parallax controls. `column` splits the two-column grid:
 * the movement parameters on the left, the shared zoom on the right.
 */
const PARALLAX_SPECS = [
  {
    key: "parallaxAmplitude",
    labelKey: "parallax.amplitude",
    min: -60,
    max: 60,
    step: 1,
    unit: "px",
    tooltipKey: "parallax.tip_amplitude",
    column: 0,
  },
  {
    key: "parallaxInertia",
    labelKey: "parallax.inertia",
    min: 0.005,
    max: 0.1,
    step: 0.005,
    unit: "",
    tooltipKey: "parallax.tip_inertia",
    column: 0,
  },
  {
    key: "scale",
    labelKey: "wavy.scale",
    min: 1.0,
    max: 1.2,
    step: 0.01,
    unit: "x",
    tooltipKey: "parallax.tip_scale",
    column: 1,
  },
];

/**
 * "Parallax Effect" editor (the old `tpl_parallax_settings` editor, ported to
 * the Customize panel).
 *
 * Parallax rides on the wavy animation loop — the cursor offset is added to the
 * same transform — so both features read and write the same controller config.
 *
 * Shared by the switcher's Customize submenu and the Settings panel's row until
 * that row is removed.
 *
 * @param {{ withTitle?: boolean }} [options]
 * @returns {{ el: HTMLElement, isDirty: () => boolean, revert: () => void }}
 */
export function createParallaxPanel({ withTitle = false } = {}) {
  const wavy = getWavyController();
  const el = document.createElement("div");
  el.className = "wallpaper_parallax_panel";

  const isInitializing = { value: true };
  let isDirty = false;

  const savedWavy = () => getSettings().wavy || {};
  const isWavyOn = () => savedWavy().enabled !== false;

  // Snapshot restored when the panel is left with unsaved edits.
  let startConfig = wavy ? cloneData(wavy.getConfig()) : {};
  const defaults = wavy ? wavy.getDefaultConfig() : {};

  const initialValue = (key, fallback) => {
    const value = Number(startConfig[key] ?? fallback);
    return Number.isFinite(value) ? value : fallback;
  };

  // Working copy — every edit is previewed live but only persisted on Save.
  const working = {
    enabled: savedWavy().parallaxEnabled === true,
    parallaxAmplitude: initialValue("parallaxAmplitude", -30),
    parallaxInertia: initialValue("parallaxInertia", 0.03),
    scale: initialValue("scale", 1.04),
  };

  // ── Markup ───────────────────────────────────────────────────────────────

  const toggleRow = (titleKey, descKey, inputId) => {
    const label = document.createElement("label");
    label.className = "btn";
    label.setAttribute("data-action", "toggle");

    const body = document.createElement("div");
    body.className = "btn_body";
    const title = document.createElement("span");
    title.className = "btn_title";
    title.dataset.i18n = titleKey;
    title.textContent = t(titleKey);
    body.appendChild(title);
    if (descKey) {
      const desc = document.createElement("span");
      desc.className = "btn_desc";
      desc.dataset.i18n = descKey;
      desc.textContent = t(descKey);
      body.appendChild(desc);
    }

    const input = document.createElement("input");
    input.type = "checkbox";
    input.id = inputId;

    label.append(body, input);
    return { label, input };
  };

  /** Slider + its (optional) tooltip, kept together like the Settings panel. */
  const sliderItem = (spec, value) => {
    const item = document.createElement("div");
    item.className = "wavy_control_item";
    const slider = createSlider({
      label: t(spec.labelKey),
      dataI18n: spec.labelKey,
      min: spec.min,
      max: spec.max,
      step: spec.step,
      value,
      defaultValue: defaults[spec.key] ?? value,
      unit: spec.unit,
      onChange: (next) => {
        working[spec.key] = next;
        applyLivePreview();
      },
    });
    item.appendChild(slider);

    if (spec.tooltipKey) {
      const tooltip = document.createElement("span");
      tooltip.className = "tooltip";
      tooltip.dataset.i18n = spec.tooltipKey;
      tooltip.textContent = t(spec.tooltipKey);
      item.appendChild(tooltip);
    }
    return { item, slider };
  };

  const enabledToggle = toggleRow(
    "sp.wallpaper_customization.toggle_parallax",
    "sp.wallpaper_customization.parallax_settings_tooltip",
    "parallax_panel_enabled",
  );

  const sliderGrid = document.createElement("div");
  sliderGrid.className = "wallpaper_slider_grid";

  const content = document.createElement("div");
  content.className = "wallpaper_parallax_content";
  content.appendChild(sliderGrid);

  const divider = document.createElement("div");
  divider.className = "section_divider";

  const actions = document.createElement("div");
  actions.className = "flex_row gap_8 w_full";

  const resetBtn = document.createElement("button");
  resetBtn.type = "button";
  resetBtn.className = "btn flex_1";
  resetBtn.textContent = t("parallax.btn_default", "Mặc định");

  const saveBtn = document.createElement("button");
  saveBtn.type = "button";
  saveBtn.className = "btn flex_1";
  saveBtn.textContent = t("parallax.btn_save", "Lưu");

  actions.append(resetBtn, saveBtn);

  if (withTitle) {
    const title = document.createElement("p");
    title.className = "setting_title";
    title.dataset.i18n = "sp.wallpaper_customization.toggle_parallax";
    title.textContent = t(
      "sp.wallpaper_customization.toggle_parallax",
      "Hiệu ứng Parallax",
    );
    el.appendChild(title);
  }

  el.append(enabledToggle.label, content, divider, actions);

  // ── Live preview plumbing ────────────────────────────────────────────────

  /** @type {Record<string, ReturnType<typeof createSlider>>} */
  const sliders = {};

  const syncDirty = (next) => {
    isDirty = next;
    setSubmenuDirty(next);
  };

  const markDirty = () => {
    if (isInitializing.value) return;
    syncDirty(true);
  };

  /** Start the shared loop if either of its two consumers is switched on. */
  const ensureStarted = () => {
    if (!wavy) return;
    if (!wavy.isActive && (working.enabled || isWavyOn())) wavy.start();
  };

  const applyLivePreview = () => {
    if (isInitializing.value) return;
    wavy?.updateConfig({
      parallaxAmplitude: working.parallaxAmplitude,
      parallaxInertia: working.parallaxInertia,
      scale: working.scale,
    });
    if (working.enabled || isWavyOn()) ensureStarted();
    markDirty();
  };

  const applyEnabledVisibility = () => {
    // A disabled feature has nothing to tune, reset or save.
    [content, divider, actions].forEach((node) =>
      node.classList.toggle("hidden", !working.enabled),
    );
  };

  const renderSliders = () => {
    sliderGrid.replaceChildren();
    const columns = [
      document.createElement("div"),
      document.createElement("div"),
    ];
    columns.forEach((column) => {
      column.className = "wallpaper_slider_col";
    });

    PARALLAX_SPECS.forEach((spec) => {
      const { item, slider } = sliderItem(spec, working[spec.key]);
      sliders[spec.key] = slider;
      columns[spec.column].appendChild(item);
    });

    columns.forEach((column) => {
      if (column.childElementCount) sliderGrid.appendChild(column);
    });
  };

  const syncControls = () => {
    enabledToggle.input.checked = working.enabled;
    applyEnabledVisibility();
  };

  // ── Persistence ──────────────────────────────────────────────────────────

  const persistConfig = () => {
    const wavyData = savedWavy();
    saveSettings({
      wavy: {
        ...wavyData,
        parallaxEnabled: working.enabled,
        config: {
          ...(wavyData.config || {}),
          parallaxAmplitude: working.parallaxAmplitude,
          parallaxInertia: working.parallaxInertia,
          scale: working.scale,
        },
      },
    });
  };

  const save = () => {
    applyLivePreview();
    persistConfig();
    startConfig = wavy ? cloneData(wavy.getConfig()) : startConfig;
    showNotification(t("common.saved_changes"), "success");
    syncDirty(false);
  };

  /** Discard the working copy and restore the settings the panel opened with. */
  const revert = () => {
    working.enabled = savedWavy().parallaxEnabled === true;
    working.parallaxAmplitude = Number(startConfig.parallaxAmplitude ?? -30);
    working.parallaxInertia = Number(startConfig.parallaxInertia ?? 0.03);
    working.scale = Number(startConfig.scale ?? 1.04);

    wavy?.updateConfig({
      parallaxAmplitude: working.parallaxAmplitude,
      parallaxInertia: working.parallaxInertia,
      scale: working.scale,
      parallaxEnabled: working.enabled,
    });
    if (working.enabled || isWavyOn()) {
      ensureStarted();
    } else {
      wavy?.stop();
    }

    isInitializing.value = true;
    renderSliders();
    syncControls();
    isInitializing.value = false;
    syncDirty(false);
  };

  // ── Bindings ─────────────────────────────────────────────────────────────

  enabledToggle.input.addEventListener("change", () => {
    working.enabled = enabledToggle.input.checked;
    applyEnabledVisibility();

    wavy?.updateConfig({ parallaxEnabled: working.enabled });
    if (working.enabled || isWavyOn()) {
      ensureStarted();
    } else {
      wavy?.stop();
    }

    // The master switch is not a tunable value: persist it right away.
    saveSettings({ wavy: { ...savedWavy(), parallaxEnabled: working.enabled } });
  });

  resetBtn.addEventListener("click", async () => {
    if (!(await confirmReset())) return;
    working.parallaxAmplitude = defaults.parallaxAmplitude ?? -30;
    working.parallaxInertia = defaults.parallaxInertia ?? 0.03;
    working.scale = defaults.scale ?? 1.04;

    // Assigning `.value` does not fire onChange, so the preview below reads the
    // updated `working` bag explicitly.
    PARALLAX_SPECS.forEach((spec) => {
      if (sliders[spec.key]) sliders[spec.key].value = working[spec.key];
    });
    applyLivePreview();
    showNotification(t("parallax.reset_success"), "success");
  });

  saveBtn.addEventListener("click", save);

  // ── Initial paint ────────────────────────────────────────────────────────

  renderSliders();
  syncControls();
  isInitializing.value = false;
  // Injects the shared toggle track; must run after the markup exists.
  initButtons(el);
  syncDirty(false);

  return { el, isDirty: () => isDirty, revert };
}

let settingsBound = false;

/**
 * Wire the Settings panel's "Parallax" row to the shared editor while that row
 * still exists there. Idempotent.
 */
export function initializeParallaxSettings() {
  if (settingsBound) return;
  const editBtn = document.getElementById("edit_parallax_settings");
  if (!editBtn) return;
  settingsBound = true;

  editBtn.addEventListener("click", () => {
    const panel = createParallaxPanel({ withTitle: true });
    openSidebarSubmenu(
      t("sp.wallpaper_customization.toggle_parallax", "Hiệu ứng Parallax"),
      panel.el,
      {
        width: "420px",
        isDirty: () => panel.isDirty(),
        onCancel: () => panel.revert(),
      },
    );
  });
}
