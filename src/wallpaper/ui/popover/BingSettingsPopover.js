import "./bing_popover.css";
import { t, translateDOM } from "/src/core/i18n.js";
import { renderIcons } from "/src/core/icon.js";
import { getSettings, saveSettings } from "/src/core/storageHandler.js";
import { createPopover, showNotification, confirmReset } from "/src/core/ui.js";
import { initButtons } from "/src/core/ui/button.js";
import { setDropdownValue } from "/src/core/ui/dropdown.js";
import { clearBingCache } from "/src/wallpaper/sources/api/bingAPI.js";

/**
 * BingSettingsPopover.js
 * ---------------------------------------------------------------------------
 * Popover form for Bing provider settings (Resolution selection).
 */
export function createBingSettingsPopover({ trigger, switcher, dataControl }) {
    if (!trigger) return null;

    const form = document.createElement("div");
    form.className = "bing_settings_form";

    form.innerHTML = `
        <div class="bing_section">
            <span class="bing_section_title" data-i18n="sp.api.bing.resolution"></span>
            <select class="native_select" id="bing_popover_resolution">
                <option value="1080p" data-i18n="sp.api.bing.res_1080p"></option>
                <option value="uhd" data-i18n="sp.api.bing.res_uhd"></option>
            </select>
        </div>

        <div class="bing_actions">
            <button type="button" class="btn" id="bing_popover_btn_reset">
                <i data-icon="arrow-counter-clockwise"></i>
                <span class="btn_title" data-i18n="common.reset"></span>
            </button>
            <button type="button" class="btn" id="bing_popover_btn_apply" disabled>
                <i data-icon="floppy-disk-back"></i>
                <span class="btn_title" data-i18n="common.save"></span>
            </button>
        </div>
    `;

    translateDOM(form);
    renderIcons(form);

    // Query native select BEFORE upgrade to keep direct reference
    const resSelect = form.querySelector("#bing_popover_resolution");

    initButtons(form);

    const resetBtn = form.querySelector("#bing_popover_btn_reset");
    const applyBtn = form.querySelector("#bing_popover_btn_apply");

    let savedConfig = {
        resolution: "1080p",
    };

    function getFormValues() {
        return {
            resolution: resSelect.value || "1080p",
        };
    }

    function checkDirty() {
        const cur = getFormValues();
        const isDirty = cur.resolution !== savedConfig.resolution;
        applyBtn.disabled = !isDirty;
    }

    function syncFromSettings() {
        const cfg = getSettings().bingConfig || {};
        savedConfig = {
            resolution: cfg.resolution || "1080p",
        };
        setDropdownValue(resSelect, savedConfig.resolution);
        checkDirty();
    }

    resSelect.addEventListener("change", checkDirty);

    document.addEventListener("dropdownChange", (e) => {
        if (e.detail?.id === "bing_popover_resolution") {
            checkDirty();
        }
    });

    resetBtn.addEventListener("click", async () => {
        if (!(await confirmReset())) return;
        setDropdownValue(resSelect, "1080p");
        checkDirty();
    });

    const popover = createPopover({
        trigger,
        content: form,
        placement: "up",
        align: "end",
        manualTrigger: true,
        onOpen: () => syncFromSettings(),
    });

    applyBtn.addEventListener("click", async () => {
        const newValues = getFormValues();
        applyBtn.disabled = true;
        try {
            saveSettings({
                bingConfig: newValues,
            });
            savedConfig = newValues;

            await clearBingCache();

            popover.close();
            await switcher?.loadSource?.("bing");
            showNotification(t("common.saved_changes", "Đã lưu thay đổi"), "success");
        } catch (err) {
            console.error("[BingSettingsPopover] Failed to apply settings:", err);
            showNotification(err?.message || "Lỗi khi áp dụng cài đặt", "error");
            checkDirty();
        }
    });

    return popover;
}
