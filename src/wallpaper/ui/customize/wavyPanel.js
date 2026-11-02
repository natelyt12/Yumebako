import "./customize.css";
import {
  confirmReset,
  createSlider,
  initButtons,
  openSidebarSubmenu,
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
} from "../../motion/registry.js";
import { resolveMotionConfig } from "../../motion/MotionEngine.js";
import { cloneData, getWavyController } from "../../motion/WavyEngine.js";
import { initializeParallaxSettings } from "./parallaxPanel.js";

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

/**
 * "Wavy Animation" editor (the old WavyEditorUI, ported to the Customize panel).
 *
 * Controls are derived from the motion registry (`getSettingsSpec()`), so a new
 * generator needs no editor change here. Sliders sit in two columns: the axis
 * groups (X, Y, rotation) on the left and the shape parameters (detail/spring)
 * on the right.
 *
 * Shared by the switcher's Customize submenu and the Settings panel's row until
 * that row is removed.
 *
 * @param {{ withTitle?: boolean }} [options]
 * @returns {{ el: HTMLElement, isDirty: () => boolean, revert: () => void }}
 */
export function createWavyPanel({ withTitle = false } = {}) {
  const wavy = getWavyController();
  const el = document.createElement("div");
  el.className = "wallpaper_wavy_panel";

  const isInitializing = { value: true };
  let isDirty = false;

  const savedWavy = () => getSettings().wavy || {};
  const isParallaxOn = () => savedWavy().parallaxEnabled === true;

  // Snapshot restored when the panel is left with unsaved edits.
  let startConfig = wavy ? cloneData(wavy.getConfig()) : {};
  const sharedDefaults = wavy ? wavy.getDefaultConfig() : { scale: 1.04 };

  // Working copy — every edit is previewed live but only persisted on Save.
  const working = {
    enabled: savedWavy().enabled !== false,
    motionType: startConfig.motionType || DEFAULT_MOTION,
    scale: Number(startConfig.scale) || sharedDefaults.scale,
    advanced: startConfig.advanced === true,
    motions: cloneData(startConfig.motions),
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

  /** Slider + its (optional) tooltip, kept together like the Settings panel. */
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

  // ── Structure ────────────────────────────────────────────────────────────

  const enabledToggle = toggleRow(
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

  const sharedHost = document.createElement("div");
  sharedHost.className = "wallpaper_wavy_shared";

  const content = document.createElement("div");
  content.className = "wallpaper_wavy_content";
  content.append(
    sectionTitle("wavy.motion_type_label", "Kiểu chuyển động"),
    motionSelect,
    advancedToggle.label,
    advancedSection,
    sectionTitle("wavy.shared_section_label", "Tùy chỉnh chung"),
    sharedHost,
  );

  const divider = document.createElement("div");
  divider.className = "section_divider";

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

  if (withTitle) {
    const title = document.createElement("p");
    title.className = "setting_title";
    title.dataset.i18n = "wavy.window_title";
    title.textContent = t("wavy.window_title", "Wavy Animation");
    el.appendChild(title);
  }

  el.append(enabledToggle.label, content, divider, actions);

  // ── Live preview plumbing ────────────────────────────────────────────────

  const syncDirty = (next) => {
    isDirty = next;
    setSubmenuDirty(next);
  };

  const markDirty = () => {
    if (isInitializing.value) return;
    syncDirty(true);
  };

  /** Start the loop when either of its two consumers is switched on. */
  const ensureStarted = () => {
    if (!wavy) return;
    if (!wavy.isActive && (working.enabled || isParallaxOn())) wavy.start();
  };

  const applyLivePreview = () => {
    if (isInitializing.value) return;
    wavy?.updateConfig({
      enabled: working.enabled,
      motionType: working.motionType,
      scale: working.scale,
      advanced: working.advanced,
      motions: working.motions,
    });
    if (working.enabled || isParallaxOn()) ensureStarted();
    markDirty();
  };

  const applyEnabledVisibility = () => {
    // A disabled feature has nothing to reset or save, so the action row goes
    // away with the controls.
    [content, divider, actions].forEach((node) =>
      node.classList.toggle("hidden", !working.enabled),
    );
  };

  // ── Sliders ──────────────────────────────────────────────────────────────

  /** @type {Record<string, ReturnType<typeof createSlider>>} */
  let motionSliderMap = {};
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

    // Consecutive specs sharing a `group` stay in one block.
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

    // Left column: the axis sliders (horizontal, vertical, rotation).
    // Right column: everything shaping the motion (detail / spring).
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
    renderSharedSlider();
  };

  // ── Controls sync ────────────────────────────────────────────────────────

  const syncControls = () => {
    enabledToggle.input.checked = working.enabled;
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
        config: {
          ...(wavyData.config || {}),
          motionType: working.motionType,
          scale: working.scale,
          advanced: working.advanced,
          motions: cloneData(working.motions),
        },
      },
    });
  };

  const save = () => {
    wavy?.updateConfig({
      enabled: working.enabled,
      motionType: working.motionType,
      scale: working.scale,
      advanced: working.advanced,
      motions: working.motions,
    });
    persistConfig();
    startConfig = cloneData(wavy?.getConfig() ?? working);
    showNotification(t("common.saved_changes"), "success");
    syncDirty(false);
  };

  /** Discard the working copy and restore the settings the panel opened with. */
  const revert = () => {
    working.enabled = savedWavy().enabled !== false;
    working.motionType = startConfig.motionType || DEFAULT_MOTION;
    working.scale = Number(startConfig.scale) || sharedDefaults.scale;
    working.advanced = startConfig.advanced === true;
    working.motions = cloneData(startConfig.motions);

    wavy?.updateConfig({
      enabled: working.enabled,
      motionType: working.motionType,
      scale: working.scale,
      advanced: working.advanced,
      motions: working.motions,
    });
    if (working.enabled || isParallaxOn()) {
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

  enabledToggle.input.addEventListener("change", () => {
    working.enabled = enabledToggle.input.checked;
    applyEnabledVisibility();

    wavy?.updateConfig({ enabled: working.enabled });
    if (working.enabled || isParallaxOn()) {
      ensureStarted();
    } else {
      wavy?.stop();
    }

    // The master switch is not a tunable value: persist it right away.
    saveSettings({ wavy: { ...savedWavy(), enabled: working.enabled } });
  });

  advancedToggle.input.addEventListener("change", () => {
    working.advanced = advancedToggle.input.checked;
    advancedSection.classList.toggle("hidden", !working.advanced);

    // Expanding/collapsing is a view preference, so it is persisted at once and
    // kept out of the dirty state.
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
      // Assigning `.value` does not fire onChange, so the preview below reads
      // the updated `working` bag explicitly.
      if (motionSliderMap[key]) motionSliderMap[key].value = value;
    });
    working.scale = sharedDefaults.scale;
    if (scaleSlider) scaleSlider.value = sharedDefaults.scale;

    applyLivePreview();
    showNotification(t("wavy.reset_success"), "success");
  });

  randomBtn.addEventListener("click", () => {
    // Randomise every exposed parameter, so this keeps working for any motion
    // type registered later.
    const { MotionClass, stored } = activeMotion();
    MotionClass.getSettingsSpec().forEach((spec) => {
      const value = randomInRange(spec.min, spec.max, spec.step);
      stored[spec.key] = value;
      if (motionSliderMap[spec.key]) motionSliderMap[spec.key].value = value;
    });
    // Roll a new seed too, so the noise-based generators produce a genuinely
    // different shape instead of rescaling the same curve.
    wavy?.reseed();
    applyLivePreview();
  });

  saveBtn.addEventListener("click", save);

  // ── Initial paint ────────────────────────────────────────────────────────

  renderAll();
  syncControls();
  isInitializing.value = false;
  // Injects the shared toggle tracks; must run after the markup exists.
  initButtons(el);
  syncDirty(false);

  return { el, isDirty: () => isDirty, revert };
}

let settingsBound = false;

/**
 * Wire the Settings panel's "Wavy Animation" and "Parallax" rows while those
 * rows still exist there. Idempotent.
 */
export function initializeWavySettings() {
  const editBtn = document.getElementById("edit_wavy_settings");
  if (editBtn && !settingsBound) {
    settingsBound = true;
    editBtn.addEventListener("click", () => {
      const panel = createWavyPanel({ withTitle: true });
      openSidebarSubmenu(t("wavy.window_title", "Wavy Animation"), panel.el, {
        width: "420px",
        isDirty: () => panel.isDirty(),
        onCancel: () => panel.revert(),
      });
    });
  }

  initializeParallaxSettings();
}
