import { t, translateDOM } from "/src/core/i18n.js";
import { renderIcons } from "/src/core/icon.js";
import { getSettings, saveSettings } from "/src/core/storageHandler.js";
import { showNotification, confirmReset } from "/src/core/ui.js";
import { initButtons } from "/src/core/ui/button.js";
import { setDropdownValue } from "/src/core/ui/dropdown.js";
import { clearBingCache } from "/src/wallpaper/sources/api/bingAPI.js";

/**
 * BingSidebar.js
 * ---------------------------------------------------------------------------
 * Form panel for Bing provider settings (Resolution selection).
 */
export function createBingSidebar({ dataControl, sidebar }) {
  const form = document.createElement("div");
  form.className = "source_sidebar_form bing_sidebar_form";

  form.innerHTML = `
        <div class="source_sidebar_section">
            <span class="source_sidebar_section_title" data-i18n="sp.api.bing.resolution"></span>
            <select class="native_select" id="bing_sidebar_resolution">
                <option value="1080p" data-i18n="sp.api.bing.res_1080p"></option>
                <option value="uhd" data-i18n="sp.api.bing.res_uhd"></option>
            </select>
        </div>

        <div class="source_sidebar_actions">
            <button type="button" class="btn" id="bing_sidebar_btn_reset">
                <span class="btn_title" data-i18n="common.reset"></span>
            </button>
            <button type="button" class="btn" id="bing_sidebar_btn_apply" disabled>
                <span class="btn_title" data-i18n="common.save"></span>
            </button>
        </div>
    `;

  translateDOM(form);
  renderIcons(form);

  const resSelect = form.querySelector("#bing_sidebar_resolution");
  initButtons(form);

  const resetBtn = form.querySelector("#bing_sidebar_btn_reset");
  const applyBtn = form.querySelector("#bing_sidebar_btn_apply");

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
    if (!form.contains(e.detail.element)) return;
    checkDirty();
  });

  resetBtn.addEventListener("click", async () => {
    const confirmed = await confirmReset(
      t(
        "sp.api.bing.reset_confirm_msg",
        "Bạn có chắc muốn đặt lại cài đặt Bing về mặc định?",
      ),
    );
    if (!confirmed) return;

    setDropdownValue(resSelect, "1080p");
    checkDirty();
  });

  applyBtn.addEventListener("click", async () => {
    const cur = getFormValues();
    saveSettings({
      bingConfig: {
        resolution: cur.resolution,
      },
    });

    savedConfig = { ...cur };
    checkDirty();

    try {
      await clearBingCache();
      if (dataControl.activeSourceId === "bing") {
        await sidebar.reload("bing");
      }
      sidebar.close();
      showNotification(t("common.saved_changes", "Đã lưu thay đổi"), "success");
    } catch (err) {
      console.error("[BingSidebar] Failed to apply settings:", err);
      showNotification(err?.message || "Lỗi khi lưu cài đặt", "error");
    }
  });

  return {
    el: form,
    onOpen: syncFromSettings,
    onClose: () => {},
  };
}
