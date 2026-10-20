import { getSettings, saveSettings } from "/src/core/storageHandler.js";
import { getFromStore, saveToStore } from "/src/core/db.js";
import { showNotification, openSidebarSubmenu, showConfirm, showAlert } from "/src/core/ui.js";
import { initIdbTracker } from "/src/settings/system/debugIdbTracker.js";

export function initDebugSettings() {
    initIdbTracker();
    initCarouselTestButtons();
    initI18nDebug();
    initDialogTest();
    initNotifTest();
    initSubmenuTest();
    initUnsplashDebug();
    initDropdownTest();
}

function initCarouselTestButtons() {
    document.getElementById("debug_btn_carousel_jitter")?.addEventListener("click", () => {
        window.open("/tests/carousel-jitter/harness.html", "_blank");
    });
    document.getElementById("debug_btn_carousel_perf")?.addEventListener("click", () => {
        window.open("/tests/carousel-perf/index.html", "_blank");
    });
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
        showNotification("Thông tin: Đây là thông báo cập nhật thông thường.", "info");
    });

    document.getElementById("test_notif_success")?.addEventListener("click", () => {
        showNotification("Thành công: Tác vụ đã được thực hiện hoàn tất!", "success");
    });

    document.getElementById("test_notif_error")?.addEventListener("click", () => {
        showNotification("Lỗi: Đã có lỗi xảy ra trong quá trình xử lý!", "error");
    });

    document.getElementById("test_notif_warning")?.addEventListener("click", () => {
        showNotification("Cảnh báo: Vui lòng kiểm tra lại cấu hình của bạn.", "warning");
    });
}

function initSubmenuTest() {
    const createSubmenuContent = (titleText) => {
        const div = document.createElement("div");
        div.className = "setting_section";
        div.innerHTML = `
            <p class="setting_title">${titleText}</p>
            <span class="tooltip">Bảng menu phụ nổi: trượt vào bên cạnh thanh điều hướng và chiếm vị trí của menu chính. Nhập độ rộng tùy chỉnh nếu muốn hiển thị rộng hơn cột sidebar.</span>
            <div class="setting_options flex_col gap_8">
                <button id="sub_action_1" class="btn">Thao tác thử nghiệm 1</button>
                <button id="sub_action_2" class="btn">Thao tác thử nghiệm 2</button>
            </div>
        `;
        div.querySelector("#sub_action_1")?.addEventListener("click", () => {
            showNotification("Đã nhấn thao tác 1 bên trong menu phụ", "success");
        });
        div.querySelector("#sub_action_2")?.addEventListener("click", () => {
            showNotification("Đã nhấn thao tác 2 bên trong menu phụ", "info");
        });
        return div;
    };

    document.getElementById("test_sidebar_submenu")?.addEventListener("click", () => {
        const inputVal = document.getElementById("test_submenu_width")?.value.trim();
        const title = inputVal ? `Menu phụ (${inputVal})` : "Cài đặt nâng cao";
        openSidebarSubmenu(title, createSubmenuContent("Chi tiết menu phụ thử nghiệm"), { width: inputVal, canPreview: true });
    });

    document.getElementById("test_sidebar_submenu_fullscreen")?.addEventListener("click", () => {
        openSidebarSubmenu("Menu phụ toàn màn hình", createSubmenuContent("Chi tiết menu toàn màn hình"), { isFullScreen: true });
    });
}

function initDropdownTest() {
    document.addEventListener("dropdownChange", (e) => {
        if (e.detail?.id === "test_custom_dropdown") {
            showNotification(`Custom Dropdown: Đã chọn ${e.detail.value}`, "info");
        }
    });
}

