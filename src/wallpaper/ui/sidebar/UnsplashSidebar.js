import { t, translateDOM } from "/src/core/i18n.js";
import { renderIcons } from "/src/core/icon.js";
import { getSettings, saveSettings } from "/src/core/storageHandler.js";
import { showNotification, confirmReset } from "/src/core/ui.js";
import { initButtons } from "/src/core/ui/button.js";
import { clearUnsplashQueue } from "/src/wallpaper/sources/api/unsplashAPI.js";

/**
 * UnsplashSidebar.js
 * ---------------------------------------------------------------------------
 * Form panel for Unsplash provider settings (Access Key).
 */
export function createUnsplashSidebar({ dataControl, sidebar }) {
  const form = document.createElement("div");
  form.className = "source_sidebar_form unsplash_sidebar_form";

  form.innerHTML = `
        <div class="source_sidebar_section">
            <span class="source_sidebar_section_title" data-i18n="sp.api.unsplash.access_key"></span>
            <input
                type="text"
                id="unsplash_sidebar_key"
                autocomplete="off"
                spellcheck="false"
                data-i18n-placeholder="sp.api.unsplash.key_placeholder"
            />
            <span class="tooltip" data-i18n="sp.api.unsplash.key_hint"></span>
        </div>
        <div class="source_sidebar_actions">
            <button type="button" class="btn" id="unsplash_sidebar_btn_reset">
                <span data-i18n="common.reset"></span>
            </button>
            <button type="button" class="btn" id="unsplash_sidebar_btn_apply" disabled>
                <span data-i18n="common.save"></span>
            </button>
        </div>
    `;

  translateDOM(form);
  renderIcons(form);
  initButtons(form);

  const keyInput = form.querySelector("#unsplash_sidebar_key");
  const resetBtn = form.querySelector("#unsplash_sidebar_btn_reset");
  const applyBtn = form.querySelector("#unsplash_sidebar_btn_apply");

  let savedKey = "";

  function checkDirty() {
    applyBtn.disabled = keyInput.value.trim() === savedKey;
  }

  function syncFromSettings() {
    savedKey = (getSettings().unsplashApiKey || "").trim();
    keyInput.value = savedKey;
    checkDirty();
  }

  keyInput.addEventListener("input", checkDirty);

  resetBtn.addEventListener("click", async () => {
    const confirmed = await confirmReset(
      t(
        "sp.api.unsplash.reset_confirm_msg",
        "Bạn có chắc muốn xóa Access Key Unsplash đã lưu?",
      ),
    );
    if (!confirmed) return;

    keyInput.value = "";
    checkDirty();
  });

  applyBtn.addEventListener("click", async () => {
    const key = keyInput.value.trim();
    saveSettings({ unsplashApiKey: key });

    savedKey = key;
    checkDirty();

    try {
      await clearUnsplashQueue();
      if (dataControl.activeSourceId === "unsplash") {
        await sidebar.reload("unsplash");
      }
      sidebar.close();
      showNotification(t("common.saved_changes", "Đã lưu thay đổi"), "success");
    } catch (err) {
      console.error("[UnsplashSidebar] Failed to apply settings:", err);
      showNotification(err?.message || "Lỗi khi lưu cài đặt", "error");
    }
  });

  return {
    el: form,
    onOpen: syncFromSettings,
    onClose: () => {},
  };
}
