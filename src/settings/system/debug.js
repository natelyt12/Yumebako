import { getSettings, saveSettings } from "/src/core/storageHandler.js";
import { getFromStore, saveToStore } from "/src/core/db.js";
import { showNotification, openSidebarSubmenu, showConfirm, showAlert } from "/src/core/ui.js";

export function initDebugSettings() {
    initI18nDebug();
    initDialogTest();
    initNotifTest();
    initSubmenuTest();
    initUnsplashDebug();
    initDropdownTest();
}

export function updateUnsplashVisibility() {
    const settings = getSettings();
    const key = settings.unsplashApiKey?.trim();
    const unsplashItems = document.querySelectorAll('.dropdown_item[data-value="unsplash"]');
    unsplashItems.forEach((item) => {
        item.style.display = key ? "" : "none";
    });
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

function initDialogTest() {
    const confirmBtn = document.getElementById("test_dialog_confirm");
    confirmBtn?.addEventListener("click", async () => {
        const confirmed = await showConfirm("Đây là hộp thoại xác nhận tiêu chuẩn (Standard Confirm Dialog).", {
            title: "Xác nhận hành động",
            okText: "Đồng ý",
            cancelText: "Hủy"
        });
        showNotification(`Kết quả: ${confirmed ? "Đồng ý" : "Đã hủy"}`, confirmed ? "success" : "info");
    });

    const dangerBtn = document.getElementById("test_dialog_danger");
    dangerBtn?.addEventListener("click", async () => {
        const confirmed = await showConfirm("Hành động này mang tính phá hủy hoặc không thể hoàn tác (Danger Confirm).", {
            title: "Xóa dữ liệu?",
            okText: "Xóa vĩnh viễn",
            isDanger: true
        });
        showNotification(`Xác nhận xóa: ${confirmed}`, confirmed ? "success" : "info");
    });

    const alertBtn = document.getElementById("test_dialog_alert");
    alertBtn?.addEventListener("click", async () => {
        await showAlert("Đây là hộp thoại thông báo độc lập (Alert Dialog).", {
            title: "Thông báo hệ thống"
        });
        showNotification("Đã đóng thông báo", "info");
    });
}

function initNotifTest() {
    document.getElementById("test_notif_info")?.addEventListener("click", () => {
        showNotification("Info Notification: Just a friendly update.", "info");
    });

    document.getElementById("test_notif_success")?.addEventListener("click", () => {
        showNotification("Success Notification: Task completed successfully!", "success");
    });

    document.getElementById("test_notif_error")?.addEventListener("click", () => {
        showNotification("Error Notification: Something went wrong!", "error");
    });

    document.getElementById("test_notif_warning")?.addEventListener("click", () => {
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
        div.querySelector("#sub_action_1")?.addEventListener("click", () => {
            showNotification("Test action 1 clicked inside the submenu", "success");
        });
        div.querySelector("#sub_action_2")?.addEventListener("click", () => {
            showNotification("Test action 2 clicked inside the submenu", "info");
        });
        return div;
    };

    document.getElementById("test_sidebar_submenu")?.addEventListener("click", () => {
        const inputVal = document.getElementById("test_submenu_width")?.value.trim();
        const title = inputVal ? `Submenu (${inputVal})` : "Advanced Settings";
        openSidebarSubmenu(title, createSubmenuContent("Advanced Submenu Details"), { width: inputVal, canPreview: true });
    });

    document.getElementById("test_sidebar_submenu_fullscreen")?.addEventListener("click", () => {
        openSidebarSubmenu("Fullscreen Submenu", createSubmenuContent("Fullscreen Submenu Details"), { isFullScreen: true });
    });
}

function initDropdownTest() {
    document.addEventListener("dropdownChange", (e) => {
        if (e.detail?.id === "test_custom_dropdown") {
            showNotification(`Custom Dropdown: Đã chọn ${e.detail.value}`, "info");
        }
    });
}

