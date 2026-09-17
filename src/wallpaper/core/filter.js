import { openSidebarSubmenu, closeSidebarSubmenu, setSubmenuDirty, showNotification, createSlider, initSubsectionSvg } from "/src/core/ui.js";
import { t, translateDOM } from "/src/core/i18n.js";
import { getSettings, saveSettings } from "/src/core/storageHandler.js";

// Neutral value for every filter slider. Shared by the editor (initial values,
// reset button) and the on-load applier so there is a single source of truth.
const FILTER_DEFAULTS = { brightness: 1, contrast: 1, saturate: 1, bloom: 0 };

/**
 * Renders a filter config onto the wallpaper media and the bloom layer.
 * Used by both the live preview and the on-load applier.
 */
function applyFilterConfig(config) {
    const brightness = config.brightness ?? FILTER_DEFAULTS.brightness;
    const contrast = config.contrast ?? FILTER_DEFAULTS.contrast;
    const saturate = config.saturate ?? FILTER_DEFAULTS.saturate;

    const filterStr = `brightness(${brightness}) contrast(${contrast}) saturate(${saturate})`;

    // The bloom layer is a blurred, screen-blended copy of the same media, so it
    // only takes the saturation — running the full chain again would double up.
    document.querySelectorAll(".image, .video").forEach((el) => {
        el.style.filter = el.parentElement?.classList.contains("bloom_container")
            ? `saturate(${saturate})`
            : filterStr;
    });

    const bloomContainer = document.querySelector(".bloom_container");
    if (bloomContainer) {
        bloomContainer.style.opacity = (config.bloom ?? FILTER_DEFAULTS.bloom) / 100;
    }
}


class FilterSettingsEditor {
    constructor() {
        this.isDirty = false;
    }

    initialize() {
        const editBtn = document.getElementById("edit_filter_settings");
        if (editBtn) {
            editBtn.addEventListener("mousedown", () => this.openEditor());
        }
    }

    openEditor() {
        const template = document.getElementById("tpl_filter_settings");
        if (!template) return;

        this.isDirty = false;
        this.clone = template.content.cloneNode(true);
        translateDOM(this.clone);

        this.bindElements();
        this.setupBindings();

        const windowTitle = t("sp.wallpaper_customization.filters");
        openSidebarSubmenu(windowTitle, this.clone, {
            width: "420px",
            canPreview: true,
            isDirty: () => this.isDirty,
            onCancel: () => {
                if (this.isDirty) {
                    applyWallpaperFilters();
                    this.isDirty = false;
                }
            }
        });

        initSubsectionSvg();
    }

    bindElements() {
        const container = this.clone.querySelector("#filter_sliders_container");
        const config = getSettings().wallpaperConfig || {};

        const standardSpecs = [
            { id: "brightness", label: t("sp.wallpaper_customization.brightness"), min: 0.1, max: 2.0, step: 0.05, unit: "%" },
            { id: "contrast", label: t("sp.wallpaper_customization.contrast"), min: 0.1, max: 2.0, step: 0.05, unit: "%" },
            { id: "saturate", label: t("sp.wallpaper_customization.saturate"), min: 0, max: 3.0, step: 0.1, unit: "%" },
        ];

        // Everything under here is expensive to render/composite, hence the divider.
        const heavySpecs = [
            { id: "bloom", label: t("sp.wallpaper_customization.bloom"), min: 0, max: 100, step: 10, unit: "%" },
        ];

        this.sliders = {};
        if (container) {
            container.innerHTML = "";

            const renderSpec = (spec) => {
                const sliderComponent = createSlider({
                    label: spec.label,
                    min: spec.min,
                    max: spec.max,
                    step: spec.step,
                    value: config[spec.id] ?? FILTER_DEFAULTS[spec.id],
                    defaultValue: FILTER_DEFAULTS[spec.id],
                    unit: spec.unit,
                    onChange: () => this.applyPreview()
                });
                container.appendChild(sliderComponent);
                this.sliders[spec.id] = sliderComponent;
            };

            // 1. Standard Sliders
            standardSpecs.forEach(renderSpec);

            // 2. Heavy Effects Divider
            const divider = document.createElement("div");
            divider.className = "section_divider";
            divider.setAttribute("data-i18n", "sp.wallpaper_customization.heavy_effects");
            divider.textContent = t("sp.wallpaper_customization.heavy_effects", "Hiệu ứng nặng");
            container.appendChild(divider);

            // 3. Heavy Effect Sliders
            heavySpecs.forEach(renderSpec);
        }

        this.btnReset = this.clone.querySelector("#btn_filter_reset");
        this.btnSave = this.clone.querySelector("#btn_filter_save");
    }

    setupBindings() {
        if (this.btnReset) {
            this.btnReset.addEventListener("mousedown", () => this.handleReset());
        }

        if (this.btnSave) {
            this.btnSave.addEventListener("mousedown", () => this.handleSave());
        }
    }

    /** Current slider values as a plain config object. */
    readConfig() {
        const config = {};
        for (const [id, slider] of Object.entries(this.sliders)) {
            config[id] = slider.value;
        }
        return config;
    }

    applyPreview() {
        this.isDirty = true;
        setSubmenuDirty(true);
        applyFilterConfig(this.readConfig());
    }

    handleReset() {
        for (const [id, slider] of Object.entries(this.sliders)) {
            if (id in FILTER_DEFAULTS) {
                slider.value = FILTER_DEFAULTS[id];
            }
        }
        this.applyPreview();
    }

    handleSave() {
        const config = this.readConfig();

        const currentConf = getSettings().wallpaperConfig || {};
        const newConf = { ...currentConf, ...config };

        saveSettings({ wallpaperConfig: newConf });
        showNotification(t("common.saved_changes"), "success");
        this.isDirty = false;
        setSubmenuDirty(false);

        applyWallpaperFilters();
    }
}

const editor = new FilterSettingsEditor();

export function initializeFilterSettings() {
    editor.initialize();
}

/**
 * Apply the saved filter config on page load.
 */
export function applyWallpaperFilters() {
    applyFilterConfig(getSettings().wallpaperConfig || {});
}
