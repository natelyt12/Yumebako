import "./customize.css";
import {
  createSlider,
  initButtons,
  openSidebarSubmenu,
  setDropdownValue,
  setSubmenuDirty,
  showNotification,
} from "/src/core/ui.js";
import { t } from "/src/core/i18n.js";
import { renderIcons } from "/src/core/icon.js";
import { getSettings, saveSettings } from "/src/core/storageHandler.js";
import {
  BasePreset,
  CUSTOM_PRESET,
  DEFAULT_PRESET,
  PRESET_ORDER,
  isCustomPreset,
  resolvePresetClass,
} from "../../onload/presets.js";
import {
  resolvePlayConfig,
  resolvePresetConfig,
} from "../../onload/OnloadEngine.js";
import {
  DEFAULT_BG_EASING,
  EASING_ORDER,
  normalizeEasingId,
} from "../../onload/easing.js";
import { getOnloadEngine } from "../../onload/index.js";

/**
 * "Startup Animation" editor (the old OnloadEditorUI, ported to the Customize
 * panel). Every control comes from the preset registry
 * (`BasePreset.getSettingsSpec()` + `LABEL_KEY`), so shipping a new preset needs
 * no editor change.
 *
 * Shared by the switcher's Customize submenu and the Settings panel's row until
 * that row is removed.
 *
 * @param {{ withTitle?: boolean }} [options]
 * @returns {{ el: HTMLElement, isDirty: () => boolean, revert: () => void }}
 */
export function createOnloadPanel({ withTitle = false } = {}) {
  const engine = getOnloadEngine();
  const el = document.createElement("div");
  el.className = "wallpaper_onload_panel";

  const isInitializing = { value: true };
  let isDirty = false;
  let isPreviewing = false;

  // Working copy — every edit is previewed live but only persisted on Save.
  let working = { ...(getSettings().onload || {}) };
  const spec = BasePreset.getSettingsSpec();

  const section = (titleKey, children) => {
    const group = document.createElement("div");
    group.className = "wallpaper_onload_group";
    if (titleKey) {
      const title = document.createElement("p");
      title.className = "wallpaper_filter_group_title";
      title.dataset.i18n = titleKey;
      title.textContent = t(titleKey);
      group.appendChild(title);
    }
    children.forEach((child) => child && group.appendChild(child));
    return group;
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

  const selectRow = (id) => {
    const select = document.createElement("select");
    select.className = "native_select";
    select.id = id;
    return select;
  };

  // ── Preset + advanced ────────────────────────────────────────────────────
  const presetSelect = selectRow("onload_preset");
  const advancedToggle = toggleRow(
    "onload_anim.advanced_settings",
    null,
    "onload_advanced_toggle",
  );

  const advancedSection = document.createElement("div");
  advancedSection.className = "wallpaper_onload_advanced";
  advancedSection.id = "onload_advanced_section";

  // Zoom / blur / rotation / speed share one 2×2 grid.
  const bgSliders = document.createElement("div");
  bgSliders.className = "wallpaper_slider_grid";
  bgSliders.id = "onload_bg_sliders";

  const easingSelect = selectRow("onload_bg_easing");

  const overlaySliders = document.createElement("div");
  overlaySliders.className = "flex_col gap_12 w_full";
  overlaySliders.id = "onload_overlay_sliders";

  advancedSection.append(
    section("onload_anim.custom_bg_label", [bgSliders]),
    section("onload_anim.bg_easing_label", [easingSelect]),
    section("onload_anim.custom_overlay_label", [overlaySliders]),
  );

  // ── Other settings + actions ─────────────────────────────────────────────
  const widgetImmediate = toggleRow(
    "onload_anim.widget_immediate",
    "onload_anim.widget_immediate_tooltip",
    "widget_immediate",
  );

  const divider = document.createElement("div");
  divider.className = "section_divider";

  const actions = document.createElement("div");
  actions.className = "flex_row gap_8 w_full";

  const previewBtn = document.createElement("button");
  previewBtn.type = "button";
  previewBtn.className = "btn flex_1";
  previewBtn.textContent = t("onload_anim.btn_preview", "Xem trước");

  const saveBtn = document.createElement("button");
  saveBtn.type = "button";
  saveBtn.className = "btn flex_1";
  saveBtn.textContent = t("onload_anim.btn_save", "Lưu");

  actions.append(previewBtn, saveBtn);

  if (withTitle) {
    const title = document.createElement("p");
    title.className = "setting_title";
    title.dataset.i18n = "onload_anim.window_title";
    title.textContent = t("onload_anim.window_title", "Hoạt ảnh mở trang");
    el.appendChild(title);
  }

  el.append(
    section("onload_anim.preset_label", [presetSelect, advancedToggle.label]),
    advancedSection,
    section("onload_anim.other_settings_label", [widgetImmediate.label]),
    divider,
    actions,
  );

  // ── Dropdowns ────────────────────────────────────────────────────────────

  const fillSelect = (select, options) => {
    select.innerHTML = "";
    options.forEach(({ value, labelKey }) => {
      const opt = document.createElement("option");
      opt.value = value;
      opt.dataset.i18n = labelKey;
      opt.textContent = t(labelKey);
      select.appendChild(opt);
    });
  };

  fillSelect(
    presetSelect,
    PRESET_ORDER.map((id) => ({
      value: id,
      labelKey: resolvePresetClass(id).LABEL_KEY,
    })).concat({
      value: CUSTOM_PRESET,
      labelKey: resolvePresetClass(CUSTOM_PRESET).LABEL_KEY,
    }),
  );
  fillSelect(
    easingSelect,
    EASING_ORDER.map((id) => ({ value: id, labelKey: `common.easing.${id}` })),
  );

  // ── Sliders ──────────────────────────────────────────────────────────────

  /** @type {Record<string, ReturnType<typeof createSlider>>} */
  const sliders = {};
  const containers = { bg: bgSliders, overlay: overlaySliders };

  const renderSliders = () => {
    Object.values(containers).forEach((box) => box.replaceChildren());

    const params = resolvePresetConfig(working.preset || DEFAULT_PRESET, working);
    // Keep the working copy aligned with what the sliders actually show, so a
    // preset whose DEFAULTS changed cannot silently re-save a stale value.
    working = { ...working, ...params };

    spec.forEach((item) => {
      const container = containers[item.group];
      if (!container) return;

      const slider = createSlider({
        label: item.label,
        dataI18n: item.dataI18n,
        min: item.min,
        max: item.max,
        step: item.step,
        value: params[item.key] ?? item.defaultValue,
        defaultValue: item.defaultValue,
        unit: item.unit,
        onChange: (value) => {
          working[item.key] = value;
          markAsCustom();
        },
      });

      sliders[item.key] = slider;
      container.appendChild(slider);
    });
  };

  // ── Dirty state ──────────────────────────────────────────────────────────

  const syncDirty = (next) => {
    isDirty = next;
    setSubmenuDirty(next);
  };

  const markDirty = () => {
    if (isInitializing.value) return;
    syncDirty(true);
  };

  /**
   * Any manual tweak leaves the named presets behind: switch the dropdown to
   * `custom` so the deviation is persisted instead of being overwritten by the
   * preset bundle on the next load.
   */
  const markAsCustom = () => {
    if (isInitializing.value) return;
    if (!isCustomPreset(working.preset)) {
      working.preset = CUSTOM_PRESET;
      setDropdownValue(presetSelect, CUSTOM_PRESET);
    }
    markDirty();
  };

  const syncControls = () => {
    setDropdownValue(presetSelect, working.preset || DEFAULT_PRESET);
    setDropdownValue(
      easingSelect,
      normalizeEasingId(working.bg_easing, DEFAULT_BG_EASING),
    );

    widgetImmediate.input.checked = working.widget_immediate !== false;

    const isAdvanced = working.advanced === true;
    advancedToggle.input.checked = isAdvanced;
    advancedSection.classList.toggle("hidden", !isAdvanced);
  };

  const selectPreset = (presetId) => {
    const PresetClass = resolvePresetClass(presetId);
    working.preset = PresetClass.ID;

    // A preset owns every advanced setting, so picking one snaps the whole
    // bundle at once. `custom` instead keeps what the panel currently shows.
    if (!isCustomPreset(PresetClass.ID)) {
      const bundle = resolvePresetConfig(PresetClass.ID, working);
      Object.assign(working, bundle);
      Object.entries(bundle).forEach(([key, value]) => {
        if (sliders[key]) sliders[key].value = value;
      });
    }

    syncControls();
    markDirty();
  };

  // ── Preview / Save ───────────────────────────────────────────────────────

  const stopPreview = () => {
    if (!isPreviewing) return;
    isPreviewing = false;
    previewBtn.disabled = false;
    engine.reset();
  };

  const startPreview = () => {
    if (isPreviewing) engine.reset();

    isPreviewing = true;
    previewBtn.disabled = true;

    engine.play({
      ...resolvePlayConfig(working),
      isPreview: true,
      onComplete: () => stopPreview(),
    });
  };

  const save = () => {
    stopPreview();

    const current = getSettings().onload || {};
    saveSettings({
      onload: {
        ...current,
        ...working,
        preset: working.preset || DEFAULT_PRESET,
        widget_immediate: working.widget_immediate !== false,
        advanced: working.advanced === true,
      },
    });
    showNotification(t("common.saved_changes"), "success");
    syncDirty(false);
  };

  /** Discard the working copy and drop any running preview. */
  const revert = () => {
    stopPreview();
    working = { ...(getSettings().onload || {}) };
    isInitializing.value = true;
    renderSliders();
    syncControls();
    isInitializing.value = false;
    syncDirty(false);
  };

  // ── Bindings ─────────────────────────────────────────────────────────────

  advancedToggle.input.addEventListener("change", () => {
    const checked = advancedToggle.input.checked;
    working.advanced = checked;
    advancedSection.classList.toggle("hidden", !checked);

    // Expanding/collapsing is a view preference, not a tunable value: persist it
    // right away so it never marks the panel dirty.
    const current = getSettings().onload || {};
    saveSettings({ onload: { ...current, advanced: checked } });
  });

  widgetImmediate.input.addEventListener("change", () => {
    working.widget_immediate = widgetImmediate.input.checked;
    markDirty();
  });

  presetSelect.addEventListener("change", (e) => selectPreset(e.target.value));
  easingSelect.addEventListener("change", (e) => {
    working.bg_easing = e.target.value;
    setDropdownValue(easingSelect, e.target.value);
    markAsCustom();
  });

  previewBtn.addEventListener("click", () => {
    if (isPreviewing) stopPreview();
    else startPreview();
  });
  saveBtn.addEventListener("click", save);

  // ── Initial paint ────────────────────────────────────────────────────────

  renderSliders();
  syncControls();
  // Upgrades the native selects to the shared dropdown and injects the toggle
  // tracks. Must run after the markup exists.
  initButtons(el);
  renderIcons(el);
  syncControls();
  isInitializing.value = false;
  syncDirty(false);

  return { el, isDirty: () => isDirty, revert };
}

let settingsBound = false;

/**
 * Wire the Settings panel's "Startup Animation" row to the shared editor while
 * that row still exists there. Idempotent.
 */
export function initializeOnloadSettings() {
  if (settingsBound) return;
  const editBtn = document.getElementById("edit_onload_settings");
  if (!editBtn) return;
  settingsBound = true;

  editBtn.addEventListener("click", () => {
    const panel = createOnloadPanel({ withTitle: true });
    openSidebarSubmenu(t("onload_anim.window_title"), panel.el, {
      width: "420px",
      isDirty: () => panel.isDirty(),
      onCancel: () => panel.revert(),
    });
  });
}
