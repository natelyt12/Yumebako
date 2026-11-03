import { t, translateDOM } from "/src/core/i18n.js";
import { renderIcons } from "/src/core/icon.js";
import { showNotification, showConfirm } from "/src/core/ui.js";
import { initButtons } from "/src/core/ui/button.js";

/**
 * PicreSidebar.js
 * ---------------------------------------------------------------------------
 * Form panel for Picre provider settings (Clear history management).
 */
export function createPicreSidebar({ dataControl, sidebar }) {
    const form = document.createElement("div");
    form.className = "source_sidebar_form picre_sidebar_form";

    form.innerHTML = `
        <div class="source_sidebar_section">
            <span class="source_sidebar_section_title" data-i18n="wallpaper_switcher.clear_history_section"></span>
            <button type="button" class="btn" id="picre_sidebar_btn_clear_history" data-variant="danger">
                <i data-icon="trash"></i>
                <div class="btn_body">
                    <span class="btn_title" data-i18n="wallpaper_switcher.clear_history"></span>
                    <span class="btn_desc" data-i18n="wallpaper_switcher.clear_history_desc"></span>
                </div>
            </button>
        </div>
    `;

    translateDOM(form);
    renderIcons(form);
    initButtons(form);

    const clearHistoryBtn = form.querySelector("#picre_sidebar_btn_clear_history");

    clearHistoryBtn?.addEventListener("click", async () => {
        const confirmed = await showConfirm(
            t("wallpaper_switcher.clear_history_modal_msg"),
            {
                title: t("wallpaper_switcher.clear_history_modal_title"),
                okText: t("wallpaper_switcher.clear_history"),
                cancelText: t("common.cancel"),
                isDanger: true,
            }
        );
        if (!confirmed) return;

        try {
            await dataControl.clearSourceHistory("picre");
            sidebar.close();
            showNotification(
                t("wallpaper_switcher.clear_history_success"),
                "success"
            );
        } catch (err) {
            console.error("[PicreSidebar] Failed to clear history:", err);
            showNotification(err?.message || "Lỗi khi dọn dẹp lịch sử", "error");
        }
    });

    return {
        el: form,
        onOpen: () => {},
        onClose: () => {},
    };
}

