import { openSidebarSubmenu, setSubmenuDirty, showNotification, createSlider, setDropdownValue } from "/src/core/ui.js";
import { t, translateDOM } from "/src/core/i18n.js";
import { getSettings, saveSettings } from "/src/core/storageHandler.js";
import { BasePreset, CUSTOM_PRESET, DEFAULT_PRESET, PRESET_ORDER, isCustomPreset, resolvePresetClass } from "./presets.js";
import { resolvePlayConfig, resolvePresetConfig } from "./OnloadEngine.js";
import { DEFAULT_BG_EASING, EASING_ORDER, normalizeEasingId } from "./easing.js";

/**
 * OnloadEditorUI.js
 * ---------------------------------------------------------------------------
 * The settings-panel half of the startup-animation feature.
 * Counterpart of `particles/EffectsEditorUI.js` / `motion/WavyEditorUI.js`: it
 * renders every control from the preset registry (`BasePreset.getSettingsSpec()`
 * + `LABEL_KEY`), so shipping a new preset needs no editor change.
 */

export class OnloadEditorUI {
    constructor(engine) {
        this.engine = engine;
        this.isDirty = false;
        this.isInitializing = false;
        this.isPreviewing = false;
    }

    initialize() {
        const editBtn = document.getElementById("edit_onload_settings");
        if (!editBtn) return;
        editBtn.addEventListener("mousedown", () => this.openEditor());
    }

    openEditor() {
        const template = document.getElementById("tpl_onload_settings");
        if (!template) return;

        this.isInitializing = true;
        this.isDirty = false;
        this.isPreviewing = false;

        // Working copy — every edit is previewed live but only persisted on Save.
        this.working = { ...(getSettings().onload || {}) };
        this.spec = BasePreset.getSettingsSpec();

        this.clone = template.content.cloneNode(true);
        translateDOM(this.clone);

        this.bindElements();
        this.buildDropdowns();
        this.renderSliders();
        this.setupBindings();
        this.syncControls();

        openSidebarSubmenu(t("onload_anim.window_title"), this.clone, {
            width: "420px",
            canPreview: true,
            isDirty: () => this.isDirty,
            onCancel: () => {
                this.engine.reset();
                this.isPreviewing = false;
                this.isDirty = false;
                setSubmenuDirty(false);
            },
        });

        this.isInitializing = false;
        this.isDirty = false;
        setSubmenuDirty(false);
    }

    // ── Element refs ──────────────────────────────────────────────────────────

    bindElements() {
        this.bgContainer = this.clone.querySelector("#onload_bg_sliders");
        this.overlayContainer = this.clone.querySelector("#onload_overlay_sliders");
        this.presetBtn = this.clone.querySelector("#onload_preset");
        this.presetDropdown = this.clone.querySelector("#onload_preset_dropdown");
        this.bgEasingBtn = this.clone.querySelector("#onload_bg_easing");
        this.bgEasingDropdown = this.clone.querySelector("#onload_bg_easing_dropdown");
        this.advancedToggle = this.clone.querySelector("#onload_advanced_toggle");
        this.advancedSection = this.clone.querySelector("#onload_advanced_section");
        this.widgetImmediate = this.clone.querySelector("#widget_immediate");
        this.btnPreview = this.clone.querySelector("#btn_preview");
        this.btnSave = this.clone.querySelector("#btn_save");

        this.sliders = {};
    }

    // ── Dropdowns ───────────────────────────────────────────────────────────

    buildDropdowns() {
        const presetOptions = PRESET_ORDER.map((id) => this._presetOption(id));
        presetOptions.push(this._presetOption(CUSTOM_PRESET));
        this._fillDropdown(this.presetDropdown, presetOptions, { dividerBeforeIndex: PRESET_ORDER.length });

        const easingOptions = EASING_ORDER.map((id) => ({ value: id, labelKey: `common.easing.${id}` }));
        this._fillDropdown(this.bgEasingDropdown, easingOptions);
    }

    _presetOption(presetId) {
        const PresetClass = resolvePresetClass(presetId);
        return { value: PresetClass.ID, labelKey: PresetClass.LABEL_KEY };
    }

    /**
     * Render `options` as dropdown items.
     * `dividerBeforeIndex` inserts a `.section_divider` before that entry — used
     * to separate the `custom` pseudo-preset from the named ones.
     */
    _fillDropdown(dropdown, options, { dividerBeforeIndex = -1 } = {}) {
        if (!dropdown) return;
        dropdown.innerHTML = "";

        options.forEach((option, index) => {
            if (index === dividerBeforeIndex) {
                const divider = document.createElement("div");
                divider.className = "section_divider";
                dropdown.appendChild(divider);
            }

            const item = document.createElement("div");
            item.className = "dropdown_item btn_liked";
            item.dataset.value = option.value;
            item.setAttribute("data-i18n", option.labelKey);
            item.textContent = t(option.labelKey);
            dropdown.appendChild(item);
        });
    }

    // ── Sliders ───────────────────────────────────────────────────────────────

    renderSliders() {
        const containers = {
            bg: this.bgContainer,
            overlay: this.overlayContainer,
        };

        Object.values(containers).forEach((container) => {
            if (container) container.innerHTML = "";
        });

        this.sliders = {};
        const params = resolvePresetConfig(this.working.preset || DEFAULT_PRESET, this.working);

        // Keep the working copy aligned with what the sliders actually show, so
        // a preset whose DEFAULTS changed since the last save cannot silently
        // re-persist a stale value.
        this.working = { ...this.working, ...params };

        this.spec.forEach((item) => {
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
                    this.working[item.key] = value;
                    this.markAsCustom();
                },
            });

            this.sliders[item.key] = slider;
            container.appendChild(slider);
        });
    }

    // ── Bindings ──────────────────────────────────────────────────────────────

    setupBindings() {
        if (this.advancedToggle) {
            this.advancedToggle.addEventListener("change", (e) => {
                const checked = e.target.checked;
                this.working.advanced = checked;
                this.advancedSection?.classList.toggle("hidden", !checked);

                // Expanding/collapsing is a view preference, not a tunable value:
                // persist it right away so it never marks the panel dirty.
                const current = getSettings().onload || {};
                saveSettings({ onload: { ...current, advanced: checked } });
            });
        }

        if (this.widgetImmediate) {
            this.widgetImmediate.addEventListener("change", () => {
                this.working.widget_immediate = this.widgetImmediate.checked;
                this.markDirty();
            });
        }

        // Dropdown listeners are scoped to the cloned subtree, so they are disposed
        // together with the submenu content — no document-level cleanup needed.
        this._onDropdownSelect(this.presetDropdown, (value) => this.selectPreset(value));
        this._onDropdownSelect(this.bgEasingDropdown, (value) => this.selectEasing("bg_easing", value, this.bgEasingBtn));

        this.btnPreview?.addEventListener("mousedown", () => this.handlePreview());
        this.btnSave?.addEventListener("mousedown", () => this.handleSave());
    }

    _onDropdownSelect(dropdown, handler) {
        dropdown?.addEventListener("mousedown", (e) => {
            const item = e.target.closest(".dropdown_item");
            if (item) handler(item.dataset.value);
        });
    }

    /** Push the working state into the input controls (called once per open). */
    syncControls() {
        setDropdownValue(this.presetBtn, this.working.preset || DEFAULT_PRESET);
        setDropdownValue(this.bgEasingBtn, normalizeEasingId(this.working.bg_easing, DEFAULT_BG_EASING));

        if (this.widgetImmediate) this.widgetImmediate.checked = this.working.widget_immediate !== false;

        const isAdvanced = this.working.advanced === true;
        if (this.advancedToggle) this.advancedToggle.checked = isAdvanced;
        this.advancedSection?.classList.toggle("hidden", !isAdvanced);
    }

    // ── Dirty state ───────────────────────────────────────────────────────────

    markDirty() {
        if (this.isInitializing) return;
        this.isDirty = true;
        setSubmenuDirty(true);
    }

    /**
     * Any manual tweak leaves the named presets behind: switch the dropdown to
     * `custom` so the deviation is persisted instead of being overwritten by the
     * preset's bundle on the next load.
     */
    markAsCustom() {
        if (this.isInitializing) return;
        if (!isCustomPreset(this.working.preset)) {
            this.working.preset = CUSTOM_PRESET;
            setDropdownValue(this.presetBtn, CUSTOM_PRESET);
        }
        this.markDirty();
    }

    selectPreset(presetId) {
        const PresetClass = resolvePresetClass(presetId);
        const isCustom = isCustomPreset(PresetClass.ID);

        this.working.preset = PresetClass.ID;

        // A preset owns every advanced setting, so picking one snaps the whole
        // bundle at once: the sliders and the background easing curve.
        // `custom` instead keeps whatever the panel currently shows.
        if (!isCustom) {
            const bundle = resolvePresetConfig(PresetClass.ID, this.working);
            Object.assign(this.working, bundle);
            Object.entries(bundle).forEach(([key, value]) => {
                if (this.sliders[key]) this.sliders[key].value = value;
            });
        }

        this.syncControls();
        this.markDirty();
    }

    /** Store the background easing id ("expo_out", …). */
    selectEasing(key, easingId, button) {
        this.working[key] = easingId;
        setDropdownValue(button, easingId);
        this.markAsCustom();
    }

    // ── Preview / Save ────────────────────────────────────────────────────────

    handlePreview() {
        if (this.isPreviewing || this.btnPreview?.disabled) return;

        this.isPreviewing = true;
        if (this.btnPreview) this.btnPreview.disabled = true;
        if (this.btnSave) this.btnSave.disabled = true;

        const wrapper = document.getElementById("setting_wrapper");
        if (wrapper) {
            wrapper.style.transition = "opacity 0.3s ease";
            wrapper.style.opacity = "0";
            wrapper.style.pointerEvents = "none";
        }

        this.engine.play({
            ...resolvePlayConfig(this.working),
            isPreview: true,
            onComplete: () => {
                this.isPreviewing = false;
                if (this.btnPreview) this.btnPreview.disabled = false;
                if (this.btnSave) this.btnSave.disabled = false;

                if (wrapper) {
                    wrapper.style.opacity = "1";
                    wrapper.style.pointerEvents = "";
                    setTimeout(() => {
                        wrapper.style.transition = "";
                    }, 300);
                }
            },
        });
    }

    handleSave() {
        const current = getSettings().onload || {};
        const next = {
            ...current,
            ...this.working,
            preset: this.working.preset || DEFAULT_PRESET,
            widget_immediate: this.working.widget_immediate !== false,
            advanced: this.working.advanced === true,
        };

        saveSettings({ onload: next });
        showNotification(t("common.saved_changes"), "success");

        this.isDirty = false;
        setSubmenuDirty(false);
    }
}
