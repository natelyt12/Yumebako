import "../../shared.css";
import "./style.css";
import panelTemplateHtml from "./template.html?raw";
import {
  confirmReset,
  createSlider,
  initButtons,
  setDropdownValue,
  setSubmenuDirty,
  showNotification,
} from "/src/core/ui.js";
import { t } from "/src/core/i18n.js";
import { getSettings, saveSettings } from "/src/core/storageHandler.js";
import {
  DEFAULT_MOTION,
  MOTION_ORDER,
  resolveMotionClass,
} from "../../../../backend/effects/motion/registry.js";
import { resolveMotionConfig } from "../../../../backend/effects/motion/MotionEngine.js";
import {
  cloneData,
  getWavyController,
} from "../../../../backend/effects/motion/WavyEngine.js";

/** Motion spec groups that move the wallpaper along an axis. */
const AXIS_GROUP_IDS = new Set(["x", "y", "rot"]);

/** Random value inside a spec's range, snapped to its step. */
function randomInRange(min, max, step) {
  const steps = Math.floor(
    Math.random() * (Math.round((max - min) / step) + 1),
  );
  const decimals = (String(step).split(".")[1] || "").length;
  return parseFloat((min + steps * step).toFixed(decimals));
}

/** Parallax slider specifications. */
const PARALLAX_SPECS = [
  {
    key: "parallaxAmplitude",
    labelKey: "parallax.amplitude",
    min: -60,
    max: 60,
    step: 1,
    unit: "px",
    tooltipKey: "parallax.tip_amplitude",
  },
  {
    key: "parallaxInertia",
    labelKey: "parallax.inertia",
    min: 0.005,
    max: 0.1,
    step: 0.005,
    unit: "",
    tooltipKey: "parallax.tip_inertia",
  },
];

/**
 * Unified "Wavy + Parallax" editor.
 *
 * Combines wavy motion generator controls and mouse-parallax tracking into
 * a single panel since both share the same WavyEngine loop and zoom scale.
 *
 * @returns {{ el: HTMLElement, isDirty: () => boolean, revert: () => void }}
 */
export function createWavyPanel() {
  const wavy = getWavyController();
  const template = document.createElement("template");
  template.innerHTML = panelTemplateHtml;
  const el = template.content.firstElementChild;

  const isInitializing = { value: true };
  let isDirty = false;

  const savedWavy = () => getSettings().wavy || {};

  // Snapshot restored when the panel is left with unsaved edits.
  let startConfig = wavy ? cloneData(wavy.getConfig()) : {};
  const sharedDefaults = wavy
    ? wavy.getDefaultConfig()
    : { scale: 1.04, parallaxInertia: 0.03, parallaxAmplitude: -30 };

  // Working copy — every edit is previewed live but only persisted on Save.
  const working = {
    enabled: savedWavy().enabled !== false,
    parallaxEnabled: savedWavy().parallaxEnabled === true,
    motionType: startConfig.motionType || DEFAULT_MOTION,
    scale: Number(startConfig.scale) || sharedDefaults.scale,
    advanced: startConfig.advanced === true,
    motions: cloneData(startConfig.motions),
    parallaxAmplitude: Number(
      startConfig.parallaxAmplitude ?? sharedDefaults.parallaxAmplitude ?? -30,
    ),
    parallaxInertia: Number(
      startConfig.parallaxInertia ?? sharedDefaults.parallaxInertia ?? 0.03,
    ),
  };

  // ── Markup helpers ───────────────────────────────────────────────────────

  const sectionTitle = (key, fallback) => {
    const title = document.createElement("p");
    title.className = "wallpaper_filter_group_title";
    title.dataset.i18n = key;
    title.textContent = t(key, fallback);
    return title;
  };

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

  const sliderItem = (options, tooltipKey) => {
    const item = document.createElement("div");
    item.className = "wavy_control_item";
    const slider = createSlider(options);
    item.appendChild(slider);
    if (tooltipKey) {
      const tooltip = document.createElement("span");
      tooltip.className = "tooltip";
      tooltip.dataset.i18n = tooltipKey;
      tooltip.textContent = t(tooltipKey);
      item.appendChild(tooltip);
    }
    return { item, slider };
  };

  // ── Structure: Wavy Section ──────────────────────────────────────────────

  const wavySectionTitle = sectionTitle(
    "wavy.wavy_section_label",
    "Sóng động (Wavy)",
  );

  const wavyEnabledToggle = toggleRow(
    "sp.wallpaper_customization.toggle_wavy",
    "sp.wallpaper_customization.wavy_settings_tooltip",
    "wavy_panel_enabled",
  );

  const advancedToggle = toggleRow(
    "wavy.advanced_settings",
    null,
    "wavy_panel_advanced",
  );

  const motionSelect = document.createElement("select");
  motionSelect.className = "native_select";
  motionSelect.id = "wavy_panel_motion_type";

  const motionSliders = document.createElement("div");
  motionSliders.className = "wallpaper_slider_grid";

  const motionTooltip = document.createElement("span");
  motionTooltip.className = "tooltip";
  motionTooltip.dataset.i18n = "wavy.motion_tooltip";
  motionTooltip.textContent = t("wavy.motion_tooltip");

  const randomBtn = document.createElement("button");
  randomBtn.type = "button";
  randomBtn.className = "btn w_full";
  randomBtn.dataset.i18n = "wavy.btn_random";
  randomBtn.textContent = t("wavy.btn_random", "Ngẫu nhiên");

  const advancedSection = document.createElement("div");
  advancedSection.className = "wallpaper_wavy_advanced";
  advancedSection.append(motionSliders, motionTooltip, randomBtn);

  const wavyContent = document.createElement("div");
  wavyContent.className = "wallpaper_wavy_content";
  wavyContent.append(
    sectionTitle("wavy.motion_type_label", "Kiểu chuyển động"),
    motionSelect,
    advancedToggle.label,
    advancedSection,
  );

  // ── Structure: Side-by-side Sections ─────────────────────────────────────
  // Wavy on the left, parallax on the right; they share one engine loop, so
  // pairing them keeps the dependent controls visible at the same time.

  const columns = document.createElement("div");
  columns.className = "wallpaper_wavy_columns";

  const wavyColumn = document.createElement("div");
  wavyColumn.className = "wallpaper_wavy_column";
  wavyColumn.append(wavySectionTitle, wavyEnabledToggle.label, wavyContent);

  // ── Structure: Parallax Section ──────────────────────────────────────────

  const parallaxSectionTitle = sectionTitle(
    "wavy.parallax_section_label",
    "Bám chuột (Parallax)",
  );

  const parallaxEnabledToggle = toggleRow(
    "sp.wallpaper_customization.toggle_parallax",
    "sp.wallpaper_customization.parallax_settings_tooltip",
    "parallax_panel_enabled",
  );

  const parallaxSliders = document.createElement("div");
  parallaxSliders.className = "wallpaper_slider_grid";

  const parallaxContent = document.createElement("div");
  parallaxContent.className = "wallpaper_parallax_content";
  parallaxContent.append(parallaxSliders);

  const parallaxColumn = document.createElement("div");
  parallaxColumn.className = "wallpaper_wavy_column";
  parallaxColumn.append(
    parallaxSectionTitle,
    parallaxEnabledToggle.label,
    parallaxContent,
  );

  columns.append(wavyColumn, parallaxColumn);

  // ── Structure: Shared Zoom (Scale) Section ───────────────────────────────

  const sharedDivider = document.createElement("div");
  sharedDivider.className = "section_divider";

  const sharedSectionTitle = sectionTitle(
    "wavy.shared_section_label",
    "Tùy chỉnh chung",
  );

  const sharedHost = document.createElement("div");
  sharedHost.className = "wallpaper_wavy_shared";

  // ── Structure: Actions ───────────────────────────────────────────────────

  const actionsDivider = document.createElement("div");
  actionsDivider.className = "section_divider";

  const actions = document.createElement("div");
  actions.className = "flex_row gap_8 w_full";

  const resetBtn = document.createElement("button");
  resetBtn.type = "button";
  resetBtn.className = "btn flex_1";
  resetBtn.textContent = t("wavy.btn_default", "Mặc định");

  const saveBtn = document.createElement("button");
  saveBtn.type = "button";
  saveBtn.className = "btn flex_1";
  saveBtn.textContent = t("wavy.btn_save", "Lưu");

  actions.append(resetBtn, saveBtn);

  el.append(
    columns,
    sharedDivider,
    sharedSectionTitle,
    sharedHost,
    actionsDivider,
    actions,
  );

  // ── Live preview plumbing ────────────────────────────────────────────────

  const syncDirty = (next) => {
    isDirty = next;
    setSubmenuDirty(next);
  };

  const markDirty = () => {
    if (isInitializing.value) return;
    syncDirty(true);
  };

  /** Start the loop when either wavy or parallax is switched on. */
  const ensureStarted = () => {
    if (!wavy) return;
    if (!wavy.isActive && (working.enabled || working.parallaxEnabled)) {
      wavy.start();
    }
  };

  const applyLivePreview = () => {
    if (isInitializing.value) return;
    wavy?.updateConfig({
      enabled: working.enabled,
      parallaxEnabled: working.parallaxEnabled,
      motionType: working.motionType,
      scale: working.scale,
      advanced: working.advanced,
      motions: working.motions,
      parallaxAmplitude: working.parallaxAmplitude,
      parallaxInertia: working.parallaxInertia,
    });
    if (working.enabled || working.parallaxEnabled) {
      ensureStarted();
    } else {
      wavy?.stop();
    }
    markDirty();
  };

  const applyEnabledVisibility = () => {
    wavyContent.classList.toggle("hidden", !working.enabled);
    parallaxContent.classList.toggle("hidden", !working.parallaxEnabled);
    const anyEnabled = working.enabled || working.parallaxEnabled;
    sharedDivider.classList.toggle("hidden", !anyEnabled);
    sharedSectionTitle.classList.toggle("hidden", !anyEnabled);
    sharedHost.classList.toggle("hidden", !anyEnabled);
    actionsDivider.classList.toggle("hidden", !anyEnabled);
    actions.classList.toggle("hidden", !anyEnabled);
  };

  // ── Sliders ──────────────────────────────────────────────────────────────

  /** @type {Record<string, ReturnType<typeof createSlider>>} */
  let motionSliderMap = {};
  /** @type {Record<string, ReturnType<typeof createSlider>>} */
  let parallaxSliderMap = {};
  let scaleSlider = null;

  /** Active generator plus its live parameter bag. */
  const activeMotion = () => {
    const id = working.motionType;
    if (!working.motions[id]) working.motions[id] = {};
    return {
      MotionClass: resolveMotionClass(id),
      stored: working.motions[id],
    };
  };

  const renderMotionSliders = () => {
    motionSliders.replaceChildren();
    motionSliderMap = {};

    const { MotionClass, stored } = activeMotion();
    const resolved = resolveMotionConfig(working.motionType, stored);

    const groups = [];
    MotionClass.getSettingsSpec().forEach((spec) => {
      const groupId = spec.group || spec.key;
      const current = groups[groups.length - 1];
      if (!current || current.id !== groupId) {
        groups.push({ id: groupId, specs: [spec] });
      } else {
        current.specs.push(spec);
      }
    });

    const axisColumn = document.createElement("div");
    axisColumn.className = "wallpaper_slider_col";
    const shapeColumn = document.createElement("div");
    shapeColumn.className = "wallpaper_slider_col";

    groups.forEach((group) => {
      const groupEl = document.createElement("div");
      groupEl.className = "wavy_control_group";

      group.specs.forEach((spec) => {
        const { item, slider } = sliderItem(
          {
            label: spec.label,
            dataI18n: spec.dataI18n,
            min: spec.min,
            max: spec.max,
            step: spec.step,
            value: resolved[spec.key] ?? spec.defaultValue,
            defaultValue: spec.defaultValue,
            unit: spec.unit,
            onChange: (value) => {
              stored[spec.key] = value;
              applyLivePreview();
            },
          },
          spec.tooltipKey,
        );
        motionSliderMap[spec.key] = slider;
        groupEl.appendChild(item);
      });

      const column = AXIS_GROUP_IDS.has(group.id) ? axisColumn : shapeColumn;
      column.appendChild(groupEl);
    });

    motionSliders.appendChild(axisColumn);
    if (shapeColumn.childElementCount) motionSliders.appendChild(shapeColumn);
  };

  const renderParallaxSliders = () => {
    parallaxSliders.replaceChildren();
    parallaxSliderMap = {};

    PARALLAX_SPECS.forEach((spec) => {
      const { item, slider } = sliderItem(
        {
          label: t(spec.labelKey),
          dataI18n: spec.labelKey,
          min: spec.min,
          max: spec.max,
          step: spec.step,
          value: working[spec.key],
          defaultValue:
            sharedDefaults[spec.key] ??
            (spec.key === "parallaxAmplitude" ? -30 : 0.03),
          unit: spec.unit,
          onChange: (value) => {
            working[spec.key] = value;
            applyLivePreview();
          },
        },
        spec.tooltipKey,
      );
      parallaxSliderMap[spec.key] = slider;
      parallaxSliders.appendChild(item);
    });
  };

  const renderSharedSlider = () => {
    sharedHost.replaceChildren();
    const { item, slider } = sliderItem(
      {
        label: t("wavy.scale"),
        dataI18n: "wavy.scale",
        min: 1.0,
        max: 1.2,
        step: 0.01,
        value: working.scale,
        defaultValue: sharedDefaults.scale,
        unit: "x",
        onChange: (value) => {
          working.scale = value;
          applyLivePreview();
        },
      },
      "wavy.scale_tooltip",
    );
    scaleSlider = slider;
    sharedHost.appendChild(item);
  };

  const renderAll = () => {
    renderMotionSliders();
    renderParallaxSliders();
    renderSharedSlider();
  };

  // ── Controls sync ────────────────────────────────────────────────────────

  const syncControls = () => {
    wavyEnabledToggle.input.checked = working.enabled;
    parallaxEnabledToggle.input.checked = working.parallaxEnabled;
    advancedToggle.input.checked = working.advanced;
    setDropdownValue(motionSelect, working.motionType);
    advancedSection.classList.toggle("hidden", !working.advanced);
    applyEnabledVisibility();
  };

  // ── Persistence ──────────────────────────────────────────────────────────

  const persistConfig = () => {
    const wavyData = savedWavy();
    saveSettings({
      wavy: {
        ...wavyData,
        enabled: working.enabled,
        parallaxEnabled: working.parallaxEnabled,
        config: {
          ...(wavyData.config || {}),
          motionType: working.motionType,
          scale: working.scale,
          advanced: working.advanced,
          motions: cloneData(working.motions),
          parallaxAmplitude: working.parallaxAmplitude,
          parallaxInertia: working.parallaxInertia,
        },
      },
    });
  };

  const save = () => {
    wavy?.updateConfig({
      enabled: working.enabled,
      parallaxEnabled: working.parallaxEnabled,
      motionType: working.motionType,
      scale: working.scale,
      advanced: working.advanced,
      motions: working.motions,
      parallaxAmplitude: working.parallaxAmplitude,
      parallaxInertia: working.parallaxInertia,
    });
    persistConfig();
    startConfig = cloneData(wavy?.getConfig() ?? working);
    showNotification(t("common.saved_changes"), "success");
    syncDirty(false);
  };

  /** Discard the working copy and restore the settings the panel opened with. */
  const revert = () => {
    working.enabled = savedWavy().enabled !== false;
    working.parallaxEnabled = savedWavy().parallaxEnabled === true;
    working.motionType = startConfig.motionType || DEFAULT_MOTION;
    working.scale = Number(startConfig.scale) || sharedDefaults.scale;
    working.advanced = startConfig.advanced === true;
    working.motions = cloneData(startConfig.motions);
    working.parallaxAmplitude = Number(
      startConfig.parallaxAmplitude ?? sharedDefaults.parallaxAmplitude ?? -30,
    );
    working.parallaxInertia = Number(
      startConfig.parallaxInertia ?? sharedDefaults.parallaxInertia ?? 0.03,
    );

    wavy?.updateConfig({
      enabled: working.enabled,
      parallaxEnabled: working.parallaxEnabled,
      motionType: working.motionType,
      scale: working.scale,
      advanced: working.advanced,
      motions: working.motions,
      parallaxAmplitude: working.parallaxAmplitude,
      parallaxInertia: working.parallaxInertia,
    });
    if (working.enabled || working.parallaxEnabled) {
      ensureStarted();
    } else {
      wavy?.stop();
    }

    isInitializing.value = true;
    renderAll();
    syncControls();
    isInitializing.value = false;
    syncDirty(false);
  };

  // ── Bindings ─────────────────────────────────────────────────────────────

  MOTION_ORDER.forEach((motionId) => {
    const opt = document.createElement("option");
    opt.value = motionId;
    opt.dataset.i18n = `wavy.motion_${motionId}`;
    opt.textContent = t(`wavy.motion_${motionId}`);
    motionSelect.appendChild(opt);
  });

  wavyEnabledToggle.input.addEventListener("change", () => {
    working.enabled = wavyEnabledToggle.input.checked;
    applyEnabledVisibility();

    wavy?.updateConfig({ enabled: working.enabled });
    if (working.enabled || working.parallaxEnabled) {
      ensureStarted();
    } else {
      wavy?.stop();
    }

    saveSettings({ wavy: { ...savedWavy(), enabled: working.enabled } });
  });

  parallaxEnabledToggle.input.addEventListener("change", () => {
    working.parallaxEnabled = parallaxEnabledToggle.input.checked;
    applyEnabledVisibility();

    wavy?.updateConfig({ parallaxEnabled: working.parallaxEnabled });
    if (working.enabled || working.parallaxEnabled) {
      ensureStarted();
    } else {
      wavy?.stop();
    }

    saveSettings({
      wavy: { ...savedWavy(), parallaxEnabled: working.parallaxEnabled },
    });
  });

  advancedToggle.input.addEventListener("change", () => {
    working.advanced = advancedToggle.input.checked;
    advancedSection.classList.toggle("hidden", !working.advanced);

    startConfig.advanced = working.advanced;
    wavy?.updateConfig({ advanced: working.advanced });
    const wavyData = savedWavy();
    saveSettings({
      wavy: {
        ...wavyData,
        config: { ...(wavyData.config || {}), advanced: working.advanced },
      },
    });
  });

  motionSelect.addEventListener("change", (e) => {
    working.motionType = e.target.value || DEFAULT_MOTION;
    renderMotionSliders();
    applyLivePreview();
  });

  resetBtn.addEventListener("click", async () => {
    if (!(await confirmReset())) return;
    const { MotionClass, stored } = activeMotion();
    Object.entries(MotionClass.DEFAULTS).forEach(([key, value]) => {
      stored[key] = value;
      if (motionSliderMap[key]) motionSliderMap[key].value = value;
    });
    working.scale = sharedDefaults.scale;
    if (scaleSlider) scaleSlider.value = sharedDefaults.scale;

    working.parallaxAmplitude = sharedDefaults.parallaxAmplitude ?? -30;
    if (parallaxSliderMap.parallaxAmplitude) {
      parallaxSliderMap.parallaxAmplitude.value = working.parallaxAmplitude;
    }
    working.parallaxInertia = sharedDefaults.parallaxInertia ?? 0.03;
    if (parallaxSliderMap.parallaxInertia) {
      parallaxSliderMap.parallaxInertia.value = working.parallaxInertia;
    }

    applyLivePreview();
    showNotification(t("wavy.reset_success"), "success");
  });

  randomBtn.addEventListener("click", () => {
    const { MotionClass, stored } = activeMotion();
    MotionClass.getSettingsSpec().forEach((spec) => {
      const value = randomInRange(spec.min, spec.max, spec.step);
      stored[spec.key] = value;
      if (motionSliderMap[spec.key]) motionSliderMap[spec.key].value = value;
    });
    wavy?.reseed();
    applyLivePreview();
  });

  saveBtn.addEventListener("click", save);

  // ── Initial paint ────────────────────────────────────────────────────────

  renderAll();
  syncControls();
  isInitializing.value = false;
  initButtons(el);
  syncDirty(false);

  return { el, isDirty: () => isDirty, revert };
}
