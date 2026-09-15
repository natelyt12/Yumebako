import { getSettings, saveSettings } from "/src/core/storageHandler.js";
import { getFromStore, saveToStore } from "/src/core/db.js";
import { showNotification, openCustomPopup, openSidebarSubmenu, showConfirm } from "/src/core/ui.js";

export function initDebugSettings() {
    initI18nDebug();
    initPopupTest();
    initNotifTest();
    initSubmenuTest();
    initUnsplashDebug();
}

export function updateUnsplashVisibility() {
    const settings = getSettings();
    const key = settings.unsplashApiKey?.trim();
    const unsplashItems = document.querySelectorAll('.dropdown_item[data-value="unsplash"]');
    unsplashItems.forEach((item) => {
        item.style.display = key ? "" : "none";
    });

    // Nếu không có key mà source đang là unsplash, tự động fallback sang wallhaven
    if (!key && settings.wallpaperConfig?.source === "unsplash") {
        const apiSelector = document.getElementById("API_selector");
        if (apiSelector) {
            document.dispatchEvent(new CustomEvent("dropdownChange", {
                detail: { id: "API_selector", value: "wallhaven" }
            }));
        }
    }
}

function initUnsplashDebug() {
    const unsplashInput = document.getElementById("debug_unsplash_key");
    if (unsplashInput) {
        unsplashInput.value = getSettings().unsplashApiKey || "";
        unsplashInput.addEventListener("input", (e) => {
            saveSettings({ unsplashApiKey: e.target.value.trim() });
            updateUnsplashVisibility();
        });
    }
    updateUnsplashVisibility();
}

function initI18nDebug() {
    const debugToggle = document.getElementById("debug_i18n");
    if (debugToggle) {
        debugToggle.checked = getSettings().debugI18n || false;
        debugToggle.addEventListener("change", (e) => {
            const isChecked = e.target.checked;
            saveSettings({ debugI18n: isChecked });
            location.reload();
        });
    }
}

function initPopupTest() {
    const createContent = (text) => {
        const div = document.createElement("div");
        div.className = "popup_body";
        div.innerHTML = `<p>${text}</p>`;
        return div;
    };

    document.getElementById("test_popup_normal")?.addEventListener("click", (e) => {
        openCustomPopup("Normal Popup", createContent("This is a standard popup for testing cursor anchoring."), "400px", { anchorEvent: e });
    });

    document.getElementById("test_popup_alert")?.addEventListener("click", async (e) => {
        const confirmed = await showConfirm("This is a danger confirmation dialog with standardized button.", {
            title: "Danger Confirm Test",
            okText: "Delete",
            isDanger: true,
            anchor: e
        });
        showNotification(`Confirmed: ${confirmed}`, confirmed ? "success" : "info");
    });

    document.getElementById("test_popup_noclose")?.addEventListener("mousedown", () => {
        const div = document.createElement("div");
        div.className = "popup_body";
        div.innerHTML = `
            <p>This popup has no close button. You must click backdrop (if allowed) or use the button below.</p>
            <button id="manual_close_btn" style="background: var(--accent_2); color: white; margin-top: 10px;">Close this Popup</button>
        `;
        const result = openCustomPopup("No X Button", div, "400px", { canClose: false });

        div.querySelector("#manual_close_btn").addEventListener("mousedown", () => {
            result.closePopup();
        });
    });

    document.getElementById("test_popup_large")?.addEventListener("click", (e) => {
        openCustomPopup("Large Popup", createContent("This is a wide popup (600px) for testing layout responsiveness."), "600px", { anchor: e });
    });
}

function initNotifTest() {
    document.getElementById("test_notif_info")?.addEventListener("mousedown", () => {
        showNotification("Info Notification: Just a friendly update.", "info");
    });

    document.getElementById("test_notif_success")?.addEventListener("mousedown", () => {
        showNotification("Success Notification: Task completed successfully!", "success");
    });

    document.getElementById("test_notif_error")?.addEventListener("mousedown", () => {
        showNotification("Error Notification: Something went wrong!", "error");
    });

    document.getElementById("test_notif_warning")?.addEventListener("mousedown", () => {
        showNotification("Warning Notification: Please check your settings.", "warning");
    });
}

function initSubmenuTest() {
    const createSubmenuContent = (titleText) => {
        const div = document.createElement("div");
        div.className = "setting_section";
        div.innerHTML = `
            <p class="setting_title">${titleText}</p>
            <span class="tooltip">Floating submenu panel: it slides in next to the nav and takes the place of the main menu. Pass a width to make it wider than the sidebar column.</span>
            <div class="setting_options flex_col gap_8">
                <button id="sub_action_1">Test action 1</button>
                <button id="sub_action_2">Test action 2</button>
            </div>
        `;
        div.querySelector("#sub_action_1")?.addEventListener("mousedown", () => {
            showNotification("Test action 1 clicked inside the submenu", "success");
        });
        div.querySelector("#sub_action_2")?.addEventListener("mousedown", () => {
            showNotification("Test action 2 clicked inside the submenu", "info");
        });
        return div;
    };

    document.getElementById("test_sidebar_submenu")?.addEventListener("mousedown", () => {
        const inputVal = document.getElementById("test_submenu_width")?.value.trim();
        const title = inputVal ? `Submenu (${inputVal})` : "Advanced Settings";
        openSidebarSubmenu(title, createSubmenuContent("Advanced Submenu Details"), { width: inputVal, canPreview: true });
    });

    document.getElementById("test_sidebar_submenu_fullscreen")?.addEventListener("mousedown", () => {
        openSidebarSubmenu("Fullscreen Submenu", createSubmenuContent("Fullscreen Submenu Details"), { isFullScreen: true });
    });
}
