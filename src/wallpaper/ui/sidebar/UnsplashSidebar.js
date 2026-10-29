import { t, translateDOM } from "/src/core/i18n.js";
import { renderIcons } from "/src/core/icon.js";
import { getSettings, saveSettings } from "/src/core/storageHandler.js";
import { showNotification, confirmReset } from "/src/core/ui.js";
import { initButtons } from "/src/core/ui/button.js";
import { setDropdownValue } from "/src/core/ui/dropdown.js";
import { clearUnsplashQueue } from "/src/wallpaper/sources/api/unsplashAPI.js";

const DEFAULT_CONFIG = {
  query: "",
  topic: "all",
  orientation: "landscape",
};

/**
 * UnsplashSidebar.js
 * ---------------------------------------------------------------------------
 * Bảng điều khiển cài đặt nguồn Unsplash (Từ khóa tìm kiếm, Chủ đề, Khung hình).
 */
export function createUnsplashSidebar({ dataControl, sidebar }) {
  const form = document.createElement("div");
  form.className = "source_sidebar_form unsplash_sidebar_form";

  form.innerHTML = `
        <div class="source_sidebar_section">
            <span class="source_sidebar_section_title" data-i18n="sp.api.unsplash.search"></span>
            <input
                type="text"
                id="unsplash_sidebar_query"
                autocomplete="off"
                spellcheck="false"
                data-i18n-placeholder="sp.api.unsplash.search_placeholder"
            />
        </div>

        <div class="source_sidebar_section">
            <span class="source_sidebar_section_title" data-i18n="sp.api.unsplash.topic"></span>
            <select class="native_select" id="unsplash_sidebar_topic">
                <option value="all" data-i18n="sp.api.unsplash.topic_all"></option>
                <option value="wallpapers" data-i18n="sp.api.unsplash.topic_wallpapers"></option>
                <option value="3d-renders" data-i18n="sp.api.unsplash.topic_3d_renders"></option>
                <option value="nature" data-i18n="sp.api.unsplash.topic_nature"></option>
                <option value="architecture-interior" data-i18n="sp.api.unsplash.topic_architecture"></option>
                <option value="street-photography" data-i18n="sp.api.unsplash.topic_street"></option>
                <option value="textures-patterns" data-i18n="sp.api.unsplash.topic_textures"></option>
                <option value="film" data-i18n="sp.api.unsplash.topic_film"></option>
                <option value="experimental" data-i18n="sp.api.unsplash.topic_experimental"></option>
            </select>
        </div>

        <div class="source_sidebar_section">
            <span class="source_sidebar_section_title" data-i18n="sp.api.unsplash.orientation"></span>
            <select class="native_select" id="unsplash_sidebar_orientation">
                <option value="landscape" data-i18n="sp.api.unsplash.orientation_landscape"></option>
                <option value="portrait" data-i18n="sp.api.unsplash.orientation_portrait"></option>
                <option value="squarish" data-i18n="sp.api.unsplash.orientation_squarish"></option>
            </select>
        </div>

        <div class="source_sidebar_actions">
            <button type="button" class="btn" id="unsplash_sidebar_btn_reset">
                <span class="btn_title" data-i18n="common.reset"></span>
            </button>
            <button type="button" class="btn" id="unsplash_sidebar_btn_apply" disabled>
                <span class="btn_title" data-i18n="common.save"></span>
            </button>
        </div>
    `;

  translateDOM(form);
  renderIcons(form);

  const queryInput = form.querySelector("#unsplash_sidebar_query");
  const topicSelect = form.querySelector("#unsplash_sidebar_topic");
  const orientationSelect = form.querySelector("#unsplash_sidebar_orientation");

  initButtons(form);

  const resetBtn = form.querySelector("#unsplash_sidebar_btn_reset");
  const applyBtn = form.querySelector("#unsplash_sidebar_btn_apply");

  let savedConfig = { ...DEFAULT_CONFIG };

  function getFormValues() {
    return {
      query: (queryInput.value || "").trim(),
      topic: topicSelect.value || "all",
      orientation: orientationSelect.value || "landscape",
    };
  }

  function checkDirty() {
    const cur = getFormValues();
    const isDirty =
      cur.query !== savedConfig.query ||
      cur.topic !== savedConfig.topic ||
      cur.orientation !== savedConfig.orientation;
    applyBtn.disabled = !isDirty;
  }

  function syncFromSettings() {
    const settings = getSettings();
    savedConfig = {
      ...DEFAULT_CONFIG,
      ...(settings.unsplashConfig || {}),
    };

    queryInput.value = savedConfig.query;
    setDropdownValue(topicSelect, savedConfig.topic);
    setDropdownValue(orientationSelect, savedConfig.orientation);

    checkDirty();
  }

  queryInput.addEventListener("input", checkDirty);
  topicSelect.addEventListener("change", checkDirty);
  orientationSelect.addEventListener("change", checkDirty);

  resetBtn.addEventListener("click", async () => {
    const confirmed = await confirmReset(
      t(
        "sp.api.unsplash.reset_confirm_msg",
        "Bạn có chắc muốn đặt lại cài đặt Unsplash về mặc định?",
      ),
    );
    if (!confirmed) return;

    queryInput.value = DEFAULT_CONFIG.query;
    setDropdownValue(topicSelect, DEFAULT_CONFIG.topic);
    setDropdownValue(orientationSelect, DEFAULT_CONFIG.orientation);
    checkDirty();
  });

  applyBtn.addEventListener("click", async () => {
    const newConfig = getFormValues();
    saveSettings({ unsplashConfig: newConfig });

    savedConfig = { ...newConfig };
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
