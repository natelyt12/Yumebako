import { openSidebarSubmenu, setSubmenuDirty, showNotification, createSlider, setDropdownValue } from "/src/core/ui.js";
import { saveSettings, getSettings } from "/src/core/storageHandler.js";
import { t, translateDOM } from "/src/core/i18n.js";
import { MOTION_ORDER, DEFAULT_MOTION, resolveMotionClass } from "./registry.js";
import { resolveMotionConfig } from "./MotionEngine.js";
import { getWavyController, cloneData } from "./WavyEngine.js";

/**
 * WavyEditorUI.js
 * ---------------------------------------------------------------------------
 * The settings-panel half of the wavy feature. Counterpart of
 * `particles/EffectsEditorUI.js`: it renders controls purely from the motion
 * registry (`getSettingsSpec()`), so a new generator needs no UI code here.
 */

/**
 * Group a flat slider spec (see BaseMotion.getSettingsSpec) into render groups.
 * Consecutive entries sharing a `group` render together, separated by a divider
 * from the next group. Each entry carries its own `tooltipKey`.
 */
function buildSliderGroups(specs, defaultsMap = {}) {
    const groups = [];
    let current = null;

    specs.forEach((spec) => {
        const groupId = spec.group || spec.key;
        if (!current || current.id !== groupId) {
            current = { id: groupId, sliders: [] };
            groups.push(current);
        }
        current.sliders.push({
            id: spec.key,
            label: spec.label,
            min: spec.min,
            max: spec.max,
            step: spec.step,
            unit: spec.unit,
            tooltipKey: spec.tooltipKey,
            defaultValue: spec.defaultValue !== undefined ? spec.defaultValue : defaultsMap[spec.key],
        });
    });

    return groups;
}

/** Random value inside a spec's range, snapped to its step. */
function randomInRange(min, max, step) {
    const steps = Math.floor(Math.random() * (Math.round((max - min) / step) + 1));
    const decimals = (String(step).split(".")[1] || "").length;
    return parseFloat((min + steps * step).toFixed(decimals));
}

function renderSliderGroups(targetContainer, groups, slidersObj, startConfig, onChange) {
    if (!targetContainer) return;
    targetContainer.innerHTML = "";
    groups.forEach((group, index) => {
        const groupDiv = document.createElement("div");
        groupDiv.className = "wavy_control_group";

        group.sliders.forEach(spec => {
            // Each control and its tooltip share a tight wrapper, so the tooltip
            // reads as belonging to that slider and not to the next one.
            const itemDiv = document.createElement("div");
            itemDiv.className = "wavy_control_item";

            const sliderComponent = createSlider({
                label: spec.label,
                min: spec.min,
                max: spec.max,
                step: spec.step,
                value: startConfig[spec.id] ?? spec.defaultValue,
                defaultValue: spec.defaultValue,
                unit: spec.unit,
                onChange: (value) => onChange(spec.id, value)
            });
            itemDiv.appendChild(sliderComponent);
            slidersObj[spec.id] = sliderComponent;

            if (spec.tooltipKey) {
                const tooltipSpan = document.createElement("span");
                tooltipSpan.className = "tooltip";
                tooltipSpan.setAttribute("data-i18n", spec.tooltipKey);
                tooltipSpan.innerText = t(spec.tooltipKey);
                itemDiv.appendChild(tooltipSpan);
            }

            groupDiv.appendChild(itemDiv);
        });

        targetContainer.appendChild(groupDiv);

        if (index < groups.length - 1) {
            const divider = document.createElement("div");
            divider.className = "section_divider";
            targetContainer.appendChild(divider);
        }
    });
}

function openWavyEditor() {
    const wavyInstance = getWavyController();
    if (!wavyInstance) return;

    const template = document.getElementById("tpl_wavy_settings");
    if (!template) return;

    let isDirty = false;
    const markDirty = () => {
        isDirty = true;
        setSubmenuDirty(true);
    };

    const clone = template.content.cloneNode(true);
    translateDOM(clone);

    const motionContainer = clone.querySelector("#wavy_motion_sliders");
    const sharedContainer = clone.querySelector("#wavy_shared_sliders");
    const advancedSection = clone.querySelector("#wavy_advanced_section");
    const advancedToggle = clone.querySelector("#wavy_advanced_toggle");
    const motionBtn = clone.querySelector("#wavy_motion_type");
    const motionDropdown = clone.querySelector("#wavy_motion_dropdown");
    const btnWavyReset = clone.querySelector("#btn_wavy_reset");
    const btnWavyRandom = clone.querySelector("#btn_wavy_random");
    const btnWavySave = clone.querySelector("#btn_wavy_save");

    const startSnapshot = wavyInstance.getConfig();
    const sharedDefaults = wavyInstance.getDefaultConfig();

    // Working copy — every edit is previewed live but only persisted on Save.
    const workingState = {
        motionType: startSnapshot.motionType || DEFAULT_MOTION,
        scale: Number(startSnapshot.scale) || sharedDefaults.scale,
        advanced: startSnapshot.advanced === true,
        motions: cloneData(startSnapshot.motions),
    };

    // Build the mode list from the registry, so shipping a new generator is a
    // registry-only change (same approach as the particles add-effect dropdown).
    MOTION_ORDER.forEach((motionId) => {
        const item = document.createElement("div");
        item.className = "dropdown_item btn_liked";
        item.dataset.value = motionId;
        item.textContent = t(`wavy.motion_${motionId}`);
        motionDropdown.appendChild(item);
    });
    setDropdownValue(motionBtn, workingState.motionType);

    let motionSliders = {};
    let sharedSliders = {};

    const ensureStarted = () => {
        if (!wavyInstance.isActive && (getSettings().wavy?.enabled !== false || getSettings().wavy?.parallaxEnabled !== false)) {
            wavyInstance.start();
        }
    };

    const applyLivePreview = () => {
        wavyInstance.updateConfig({
            motionType: workingState.motionType,
            scale: workingState.scale,
            advanced: workingState.advanced,
            motions: workingState.motions,
        });
        ensureStarted();
        markDirty();
    };

    // Resolve the active generator plus its live parameter bag.
    const activeMotion = () => {
        const id = workingState.motionType;
        if (!workingState.motions[id]) workingState.motions[id] = {};
        return {
            MotionClass: resolveMotionClass(id),
            stored: workingState.motions[id],
        };
    };

    const renderMotionControls = () => {
        const { MotionClass, stored } = activeMotion();
        motionSliders = {};
        const groups = buildSliderGroups(MotionClass.getSettingsSpec(), MotionClass.DEFAULTS);
        renderSliderGroups(motionContainer, groups, motionSliders, resolveMotionConfig(workingState.motionType, stored), (key, value) => {
            stored[key] = value;
            applyLivePreview();
        });
    };

    const renderSharedControls = () => {
        // Shared by every motion type — one zoom for the whole feature.
        const specs = [
            { key: "scale", label: t("wavy.scale"), min: 1.00, max: 1.20, step: 0.01, unit: "x", tooltipKey: "wavy.scale_tooltip" },
        ];
        sharedSliders = {};
        const groups = buildSliderGroups(specs, { scale: sharedDefaults.scale });
        renderSliderGroups(sharedContainer, groups, sharedSliders, { scale: workingState.scale }, (key, value) => {
            workingState.scale = value;
            applyLivePreview();
        });
    };

    renderMotionControls();
    renderSharedControls();

    // "Advanced settings" only controls the visibility of the per-motion sliders;
    // the shared zoom stays visible either way.
    const applyAdvancedVisibility = () => {
        advancedSection.classList.toggle("hidden", !workingState.advanced);
    };

    advancedToggle.checked = workingState.advanced;
    advancedToggle.onchange = (e) => {
        workingState.advanced = e.target.checked;
        applyAdvancedVisibility();
        applyLivePreview();
    };
    applyAdvancedVisibility();

    // Listener is scoped to the cloned subtree, so it is disposed together with
    // the submenu content — no document-level listener to clean up.
    motionDropdown.addEventListener("mousedown", (e) => {
        const item = e.target.closest(".dropdown_item");
        if (!item) return;
        workingState.motionType = item.dataset.value || DEFAULT_MOTION;
        setDropdownValue(motionBtn, workingState.motionType);
        renderMotionControls();
        applyLivePreview();
    });

    const saveCurrentConfig = () => {
        showNotification(t("common.saved_changes"), "success");
        wavyInstance.updateConfig({
            motionType: workingState.motionType,
            scale: workingState.scale,
            advanced: workingState.advanced,
            motions: workingState.motions,
        });

        const currentWavyData = getSettings().wavy || {};
        currentWavyData.config = {
            ...(currentWavyData.config || {}),
            motionType: workingState.motionType,
            scale: workingState.scale,
            advanced: workingState.advanced,
            motions: cloneData(workingState.motions),
        };
        saveSettings({ wavy: currentWavyData });

        isDirty = false;
        setSubmenuDirty(false);
    };

    if (btnWavyReset) {
        btnWavyReset.onmousedown = () => {
            const { MotionClass, stored } = activeMotion();
            Object.entries(MotionClass.DEFAULTS).forEach(([key, value]) => {
                stored[key] = value;
                // Assigning .value does NOT fire onChange, so applyLivePreview()
                // below reads the updated `stored` bag explicitly.
                if (motionSliders[key]) motionSliders[key].value = value;
            });
            workingState.scale = sharedDefaults.scale;
            if (sharedSliders.scale) sharedSliders.scale.value = sharedDefaults.scale;
            applyLivePreview();
            showNotification(t("wavy.reset_success"), "success");
        };
    }

    if (btnWavyRandom) {
        btnWavyRandom.onmousedown = () => {
            // Randomise every exposed parameter of the active generator, so this
            // keeps working for any motion type registered later.
            const { MotionClass, stored } = activeMotion();
            MotionClass.getSettingsSpec().forEach((spec) => {
                const value = randomInRange(spec.min, spec.max, spec.step);
                stored[spec.key] = value;
                if (motionSliders[spec.key]) motionSliders[spec.key].value = value;
            });
            // Roll a new seed too, so the noise-based generators produce a
            // genuinely different shape instead of rescaling the same curve.
            wavyInstance.reseed();
            applyLivePreview();
        };
    }

    if (btnWavySave) {
        btnWavySave.onmousedown = saveCurrentConfig;
    }

    openSidebarSubmenu(t("wavy.window_title"), clone, {
        width: "420px",
        canPreview: true,
        isDirty: () => isDirty,
        onCancel: () => {
            if (isDirty) {
                wavyInstance.updateConfig({
                    motionType: startSnapshot.motionType,
                    scale: startSnapshot.scale,
                    advanced: startSnapshot.advanced,
                    motions: startSnapshot.motions,
                });
                isDirty = false;
                setSubmenuDirty(false);
            }
        }
    });
}

function openParallaxEditor() {
    const wavyInstance = getWavyController();
    if (!wavyInstance) return;

    const template = document.getElementById("tpl_parallax_settings");
    if (!template) return;

    let isDirty = false;
    const markDirty = () => {
        isDirty = true;
        setSubmenuDirty(true);
    };

    const clone = template.content.cloneNode(true);
    translateDOM(clone);

    const parallaxContainer = clone.querySelector("#parallax_sliders_container");
    const btnParallaxReset = clone.querySelector("#btn_parallax_reset");
    const btnParallaxSave = clone.querySelector("#btn_parallax_save");

    let startConfig = wavyInstance.getConfig();
    const defaults = wavyInstance.getDefaultConfig();
    const sliders = {};

    // Same flat spec shape as the motion generators, so the tooltip always sits
    // under the slider it explains.
    const parallaxSpecs = [
        { key: "parallaxInertia", label: t("wavy.parallax_inertia"), min: 0.005, max: 0.1, step: 0.005, unit: "", group: "parallax" },
        { key: "parallaxAmplitude", label: t("wavy.parallax_amplitude"), min: -60, max: 60, step: 1, unit: "px", group: "parallax" },
        { key: "scale", label: t("wavy.scale"), min: 1.00, max: 1.20, step: 0.01, unit: "x", tooltipKey: "wavy.scale_tooltip" }
    ];
    const parallaxGroups = buildSliderGroups(parallaxSpecs, defaults);

    const ensureStarted = () => {
        if (!wavyInstance.isActive && (getSettings().wavy?.enabled !== false || getSettings().wavy?.parallaxEnabled !== false)) {
            wavyInstance.start();
        }
    };

    const applyValue = (key, value) => {
        wavyInstance.updateConfig({ [key]: value });
        ensureStarted();
        markDirty();
    };

    renderSliderGroups(parallaxContainer, parallaxGroups, sliders, startConfig, applyValue);

    const saveCurrentConfig = () => {
        let finalConfig = {};
        for (const [key, slider] of Object.entries(sliders)) finalConfig[key] = slider.value;
        showNotification(t("common.saved_changes"), "success");
        wavyInstance.updateConfig(finalConfig);
        let currentWavyData = getSettings().wavy || {};
        currentWavyData.config = { ...(currentWavyData.config || {}), ...finalConfig };
        saveSettings({ wavy: currentWavyData });
        startConfig = { ...startConfig, ...finalConfig };
        isDirty = false;
        setSubmenuDirty(false);
    };

    if (btnParallaxReset) {
        btnParallaxReset.onmousedown = () => {
            const resetValues = {
                parallaxInertia: defaults.parallaxInertia,
                parallaxAmplitude: defaults.parallaxAmplitude,
                scale: defaults.scale,
            };
            Object.entries(resetValues).forEach(([key, value]) => {
                if (sliders[key]) sliders[key].value = value;
            });
            wavyInstance.updateConfig(resetValues);
            ensureStarted();
            markDirty();
            showNotification(t("wavy.reset_success"), "success");
        };
    }

    if (btnParallaxSave) {
        btnParallaxSave.onmousedown = saveCurrentConfig;
    }

    openSidebarSubmenu(t("sp.wallpaper_customization.parallax_settings_more") || "Cài đặt Parallax", clone, {
        width: "420px",
        canPreview: true,
        isDirty: () => isDirty,
        onCancel: () => {
            if (isDirty) {
                wavyInstance.updateConfig(startConfig);
                isDirty = false;
                setSubmenuDirty(false);
            }
        }
    });
}

/**
 * Initialize Wavy settings panel and bind to the specific DOM elements.
 */
export function initializeWavySettings() {
    const editWavyBtn = document.getElementById("edit_wavy_settings");
    if (editWavyBtn) {
        editWavyBtn.onmousedown = () => openWavyEditor();
    }
    const editParallaxBtn = document.getElementById("edit_parallax_settings");
    if (editParallaxBtn) {
        editParallaxBtn.onmousedown = () => openParallaxEditor();
    }

    const toggleWavy = document.getElementById("main_wavy_toggle");
    if (toggleWavy) {
        toggleWavy.checked = getSettings().wavy?.enabled !== false;
        toggleWavy.onchange = (e) => {
            const isChecked = e.target.checked;
            const currentWavyData = getSettings().wavy || {};
            currentWavyData.enabled = isChecked;
            saveSettings({ wavy: currentWavyData });
            const wavyInstance = getWavyController();
            if (wavyInstance) {
                wavyInstance.updateConfig({ enabled: isChecked });
                if (isChecked || currentWavyData.parallaxEnabled === true) {
                    if (!wavyInstance.isActive) wavyInstance.start();
                } else {
                    wavyInstance.stop();
                }
            }
        };
    }

    const toggleParallax = document.getElementById("main_parallax_toggle");
    if (toggleParallax) {
        toggleParallax.checked = getSettings().wavy?.parallaxEnabled === true;
        toggleParallax.onchange = (e) => {
            const isChecked = e.target.checked;
            const currentWavyData = getSettings().wavy || {};
            currentWavyData.parallaxEnabled = isChecked;
            saveSettings({ wavy: currentWavyData });
            const wavyInstance = getWavyController();
            if (wavyInstance) {
                wavyInstance.updateConfig({ parallaxEnabled: isChecked });
                if (isChecked || currentWavyData.enabled !== false) {
                    if (!wavyInstance.isActive) wavyInstance.start();
                } else {
                    wavyInstance.stop();
                }
            }
        };
    }
}

export function toggleWavyVisibility(state) {
    const editWavyBtn = document.getElementById("edit_wavy_settings");
    const toggleWavy = document.getElementById("main_wavy_toggle");

    if (editWavyBtn) {
        editWavyBtn.style.display = state ? "inline-flex" : "none";
        if (toggleWavy && toggleWavy.parentElement) {
            toggleWavy.parentElement.style.display = state ? "flex" : "none";
        }
        const tooltipWavy = editWavyBtn.nextElementSibling;
        if (tooltipWavy && tooltipWavy.classList.contains("tooltip")) tooltipWavy.style.display = state ? "block" : "none";
    }

    const editParallaxBtn = document.getElementById("edit_parallax_settings");
    const toggleParallax = document.getElementById("main_parallax_toggle");

    if (editParallaxBtn) {
        editParallaxBtn.style.display = state ? "inline-flex" : "none";
        if (toggleParallax && toggleParallax.parentElement) {
            toggleParallax.parentElement.style.display = state ? "flex" : "none";
        }
        const tooltipParallax = editParallaxBtn.nextElementSibling;
        if (tooltipParallax && tooltipParallax.classList.contains("tooltip")) tooltipParallax.style.display = state ? "block" : "none";
    }
}
