import { saveSettings, getSettings, exportSettings, importSettings, subscribe } from "/src/core/storageHandler.js";
import { getFormattedClock as coreGetFormattedClock, initDate } from "/src/core/time.js";
import { showConfirm, showNotification, createSlider } from "/src/core/ui.js";
import { t } from "/src/core/i18n.js";
import { EventBus } from "/src/core/eventBus.js";
import { EVENTS } from "/src/core/events.js";

/**
 * Master initialization function for all application specific utility subsets.
 * Activates Tab Titles, Presentation Mode, Hotkeys, Date/Time, debug options and Backup.
 */
let isAppUtilsInitialized = false;

export function initAppUtils() {
    initTabTitle();
    initPresentationMode();

    if (!isAppUtilsInitialized) {
        isAppUtilsInitialized = true;
        initHotkeys();
    }

    initDebug();
    initBackup();
    initToggleButtonOpacity();
}

function initHotkeys() {
    document.addEventListener("keydown", (event) => {
        if (event.ctrlKey && event.key === "x") {
            const current = getSettings().presentationMode === true;
            saveSettings({ presentationMode: !current });
        }
    });
}

function initBackup() {
    const exportAllBtn = document.getElementById("export_all_btn");
    const exportWallpaperBtn = document.getElementById("export_wallpaper_btn");
    const exportSystemBtn = document.getElementById("export_system_btn");
    const importBtn = document.getElementById("import_settings_btn");
    const importFile = document.getElementById("import_settings_file");

    const setupExportButton = (btn, type, msgKey, originalTextKey) => {
        if (!btn) return;
        btn.addEventListener("mousedown", async (e) => {
            const confirmed = await showConfirm(t(msgKey), {
                title: t("sp.backup.export_title"),
                okText: t("common.confirm"),
                anchor: e
            });
            if (!confirmed) return;

            const textSpan = btn.querySelector("span");
            btn.disabled = true;
            if (textSpan) textSpan.innerText = t("sp.backup.export_loading");
            await exportSettings(type);
            btn.disabled = false;
            if (textSpan) textSpan.innerText = t(originalTextKey);
            showNotification(t("sp.backup.export_success"), "success");
        });
    };

    setupExportButton(exportAllBtn, "all", "sp.backup.export_all_msg", "sp.backup.export_all");
    setupExportButton(exportWallpaperBtn, "wallpaper", "sp.backup.export_wallpaper_msg", "sp.backup.export_wallpaper");
    setupExportButton(exportSystemBtn, "system", "sp.backup.export_system_msg", "sp.backup.export_system");

    const handleImportFile = (fileInput, importFunc) => {
        fileInput.onchange = (e) => {
            const file = e.target.files[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = async (e) => {
                const contents = e.target.result;
                const success = await importFunc(contents);
                if (success) {
                    await showConfirm(t("sp.backup.import_success"), {
                        title: t("sp.backup.import_title"),
                        okText: t("common.reload", "Tải lại"),
                        cancelText: t("common.cancel", "Hủy")
                    });
                    location.reload();
                } else {
                    showNotification(t("sp.backup.import_error"), "error");
                }
            };
            reader.readAsText(file);
        };
    };

    if (importBtn && importFile) {
        importBtn.addEventListener("mousedown", () => {
            importFile.click();
        });
        handleImportFile(importFile, importSettings);
    }
}

function initTabTitle() {
    const tabTitleInput = document.getElementById("tab_title");
    if (tabTitleInput) {
        tabTitleInput.value = getSettings().tabTitle || "";
        tabTitleInput.onchange = (e) => {
            saveSettings({ tabTitle: e.target.value });
        };
    }
}

function initPresentationMode() {
    const presentationToggle = document.getElementById("presentation_mode");
    if (presentationToggle) {
        presentationToggle.checked = getSettings().presentationMode === true;
        presentationToggle.onchange = (e) => {
            saveSettings({ presentationMode: e.target.checked });
        };
    }
}



function initDebug() {
    const resetSettingsBtn = document.getElementById("reset_settings_btn");

    if (resetSettingsBtn) {
        resetSettingsBtn.addEventListener("click", async (e) => {
            const confirmed = await showConfirm(t("sp.danger_zone.reset_msg"), {
                title: t("sp.danger_zone.reset_title"),
                okText: t("sp.danger_zone.reset_settings", "Đặt lại cài đặt"),
                isDanger: true,
                anchor: e
            });

            if (confirmed) {
                const { clearStore } = await import("/src/core/db.js");
                await clearStore();
                localStorage.clear();
                setTimeout(() => {
                    location.reload();
                }, 800);
            }
        });
    }
}

export function getFormattedClock() {
    return coreGetFormattedClock(getSettings());
}

/**
 * Retrieve the fully formatted date string in localized format.
 * @returns {string} The formatted local string for the present day.
 */
export function getFormattedDate() {
    const today = initDate();
    return `${today.day}/${today.month}/${today.year}`;
}

function initToggleButtonOpacity() {
    const actionButtons = document.getElementById("action_buttons");
    const settingToggleBtn = document.getElementById("setting_toggle_btn");
    const target = actionButtons || settingToggleBtn;
    const isDim = getSettings().hideToggleButton === true;

    if (target && isDim) {
        target.classList.add("toggle_hidden");
    }

    const toggleOpacityBox = document.getElementById("toggle_button_opacity");
    if (toggleOpacityBox) {
        toggleOpacityBox.checked = isDim;
        toggleOpacityBox.onchange = (e) => {
            saveSettings({ hideToggleButton: e.target.checked });
        };
    }
}

// ==========================================
// REACTIVE SETTINGS SUBSCRIPTIONS
// ==========================================

subscribe("tabTitle", (newTitle) => {
    document.title = newTitle || t("tab_new") || "New Tab";
    const tabTitleInput = document.getElementById("tab_title");
    if (tabTitleInput) {
        tabTitleInput.value = newTitle || "";
    }
});

subscribe("presentationMode", (isEnabled) => {
    const safemodeBox = document.querySelector(".safemode");
    if (safemodeBox) {
        if (isEnabled) {
            safemodeBox.classList.add("safemode-enabled");
        } else {
            safemodeBox.classList.remove("safemode-enabled");
        }
    }
    const presentationToggle = document.getElementById("presentation_mode");
    if (presentationToggle) {
        presentationToggle.checked = isEnabled === true;
    }
});

subscribe("hideToggleButton", (isDim) => {
    const settingToggleBtn = document.getElementById("setting_toggle_btn");
    const actionButtons = document.getElementById("action_buttons");
    const settingWrapper = document.getElementById("setting_wrapper");
    const isOpened = settingWrapper && settingWrapper.classList.contains("setting_wrapper_opened");
    const target = actionButtons || settingToggleBtn;

    if (target) {
        if (isDim === true && !isOpened) {
            target.classList.add("toggle_hidden");
        } else {
            target.classList.remove("toggle_hidden");
        }
    }

    const toggleOpacityBox = document.getElementById("toggle_button_opacity");
    if (toggleOpacityBox) {
        toggleOpacityBox.checked = isDim === true;
    }
});
