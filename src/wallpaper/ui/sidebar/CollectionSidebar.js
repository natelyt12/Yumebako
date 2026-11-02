import { t, translateDOM } from "/src/core/i18n.js";
import { getSettings, saveSettings } from "/src/core/storageHandler.js";
import { initButtons } from "/src/core/ui/button.js";
import { createSlider } from "/src/core/ui/slider.js";

/**
 * CollectionSidebar.js
 * ---------------------------------------------------------------------------
 * Form panel for Collection provider settings (video sound toggle & volume).
 * Changes take effect and persist immediately without requiring an Apply button.
 */
export function createCollectionSidebar({ dataControl }) {
    const form = document.createElement("div");
    form.className = "source_sidebar_form collection_sidebar_form";

    form.innerHTML = `
        <div class="source_sidebar_section">
            <span class="source_sidebar_section_title" data-i18n="sp.api.collection.settings_title"></span>
            <label class="btn" data-action="toggle">
                <div class="btn_body">
                    <span class="btn_title" data-i18n="sp.api.collection.video_sound"></span>
                    <span class="btn_desc" data-i18n="sp.api.collection.video_sound_desc"></span>
                </div>
                <input type="checkbox" id="coll_sidebar_video_sound" />
            </label>
        </div>
        <div class="source_sidebar_section" id="coll_sidebar_volume_section"></div>
    `;

    const volumeSection = form.querySelector("#coll_sidebar_volume_section");
    const soundCheckbox = form.querySelector("#coll_sidebar_video_sound");

    function saveCurrentConfig(volumeVal = volumeSlider.value) {
        saveSettings({
            collectionConfig: {
                videoSound: soundCheckbox.checked,
                videoVolume: volumeVal / 100,
            },
        });
    }

    function updateVolumeDisabledState(enabled) {
        volumeSection.classList.toggle("disabled_section", !enabled);
        volumeSlider.setDisabled(!enabled);
    }

    const volumeSlider = createSlider({
        label: t("sp.api.collection.video_volume", "Âm lượng video"),
        dataI18n: "sp.api.collection.video_volume",
        min: 0,
        max: 100,
        step: 5,
        value: 100,
        defaultValue: 100,
        unit: "%",
        onCommit: (val) => {
            saveCurrentConfig(val);
        },
    });
    volumeSection.appendChild(volumeSlider);

    translateDOM(form);
    initButtons(form);

    soundCheckbox.addEventListener("change", () => {
        updateVolumeDisabledState(soundCheckbox.checked);
        saveCurrentConfig();
    });

    function syncFromSettings() {
        const cfg = getSettings().collectionConfig || {};
        const sound = Boolean(cfg.videoSound);
        const vol = typeof cfg.videoVolume === "number" ? cfg.videoVolume : 1;
        soundCheckbox.checked = sound;
        volumeSlider.setValueNoAnim(Math.round(vol * 100));
        updateVolumeDisabledState(sound);
    }

    return {
        el: form,
        onOpen: syncFromSettings,
        onClose: () => {},
    };
}

