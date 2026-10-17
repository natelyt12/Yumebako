import "./collection_popover.css";
import { t, translateDOM } from "/src/core/i18n.js";
import { getSettings, saveSettings } from "/src/core/storageHandler.js";
import { createPopover } from "/src/core/ui.js";
import { initButtons } from "/src/core/ui/button.js";
import { createSlider } from "/src/core/ui/slider.js";

/**
 * CollectionSettingsPopover.js
 * ---------------------------------------------------------------------------
 * Popover form for Collection provider settings (video sound toggle & volume).
 * Changes take effect and persist immediately without requiring an Apply button.
 */
export function createCollectionSettingsPopover({ trigger, switcher, dataControl }) {
    if (!trigger) return null;

    const form = document.createElement("div");
    form.className = "collection_settings_form";

    form.innerHTML = `
        <div class="coll_section">
            <span class="coll_section_title" data-i18n="sp.api.collection.settings_title"></span>
            <label class="btn" data-action="toggle">
                <div class="btn_body">
                    <span class="btn_title" data-i18n="sp.api.collection.video_sound"></span>
                    <span class="btn_desc" data-i18n="sp.api.collection.video_sound_desc"></span>
                </div>
                <input type="checkbox" id="coll_popover_video_sound" />
            </label>
        </div>
        <div class="coll_section" id="coll_popover_volume_section"></div>
    `;

    const volumeSection = form.querySelector("#coll_popover_volume_section");
    const soundCheckbox = form.querySelector("#coll_popover_video_sound");

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
        // Chỉ lưu khi thả tay / gõ số / bấm bước: lưu theo từng bước kéo sẽ ghi
        // storage hàng chục lần cho một cú kéo.
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

    const popover = createPopover({
        trigger,
        content: form,
        placement: "up",
        align: "end",
        manualTrigger: true,
        onOpen: () => syncFromSettings(),
    });

    return popover;
}
