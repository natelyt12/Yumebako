import { t, translateDOM } from "/src/core/i18n.js";
import { renderIcons } from "/src/core/icon.js";
import { getSettings, saveSettings } from "/src/core/storageHandler.js";
import { showNotification, confirmReset, showConfirm } from "/src/core/ui.js";
import { initButtons } from "/src/core/ui/button.js";
import { setDropdownValue } from "/src/core/ui/dropdown.js";
import { clearWallhavenQueue } from "/src/wallpaper/sources/api/wallhavenAPI.js";

/**
 * WallhavenSidebar.js
 * ---------------------------------------------------------------------------
 * Form panel for Wallhaven provider settings (search query, categories,
 * resolution, sorting, and toplist range).
 */
export function createWallhavenSidebar({ dataControl, sidebar }) {
  const form = document.createElement("div");
  form.className = "source_sidebar_form wallhaven_sidebar_form";

  form.innerHTML = `
        <div class="source_sidebar_section">
            <span class="source_sidebar_section_title" data-i18n="sp.api.wallhaven.search"></span>
            <input type="text" id="wh_sidebar_query" data-i18n-placeholder="sp.api.wallhaven.search_placeholder" autocomplete="off" />
        </div>
        <div class="source_sidebar_section">
            <span class="source_sidebar_section_title" data-i18n="sp.api.wallhaven.categories"></span>
            <div class="wh_categories_group" role="group">
                <button type="button" class="wh_cat_pill" id="wh_sidebar_cat_general" role="button" aria-pressed="false"><span data-i18n="sp.api.wallhaven.cat_general"></span></button>
                <button type="button" class="wh_cat_pill" id="wh_sidebar_cat_anime" role="button" aria-pressed="true"><span data-i18n="sp.api.wallhaven.cat_anime"></span></button>
                <button type="button" class="wh_cat_pill" id="wh_sidebar_cat_people" role="button" aria-pressed="false"><span data-i18n="sp.api.wallhaven.cat_people"></span></button>
            </div>
        </div>
        <div class="source_sidebar_section">
            <span class="source_sidebar_section_title" data-i18n="sp.api.wallhaven.resolution"></span>
            <select class="native_select" id="wh_sidebar_resolution">
                <option value="any" data-i18n="sp.api.wallhaven.resolution_any"></option>
                <option value="1920x1080">Full HD (1920×1080)</option>
                <option value="2560x1440">2K (2560×1440)</option>
                <option value="3840x2160">4K (3840×2160)</option>
            </select>
        </div>
        <div class="source_sidebar_section">
            <span class="source_sidebar_section_title" data-i18n="sp.api.wallhaven.sorting"></span>
            <select class="native_select" id="wh_sidebar_sorting">
                <option value="random" data-i18n="sp.api.wallhaven.sort_random"></option>
                <option value="date_added" data-i18n="sp.api.wallhaven.sort_date"></option>
                <option value="views" data-i18n="sp.api.wallhaven.sort_views"></option>
                <option value="favorites" data-i18n="sp.api.wallhaven.sort_favorites"></option>
                <option value="toplist" data-i18n="sp.api.wallhaven.sort_toplist"></option>
            </select>
        </div>
        <div class="source_sidebar_section hidden" id="wh_sidebar_toprange_section">
            <span class="source_sidebar_section_title" data-i18n="sp.api.wallhaven.toprange"></span>
            <select class="native_select" id="wh_sidebar_toprange">
                <option value="1d" data-i18n="sp.api.wallhaven.toprange_1d"></option>
                <option value="3d" data-i18n="sp.api.wallhaven.toprange_3d"></option>
                <option value="1w" data-i18n="sp.api.wallhaven.toprange_1w"></option>
                <option value="1M" data-i18n="sp.api.wallhaven.toprange_1M"></option>
                <option value="3M" data-i18n="sp.api.wallhaven.toprange_3M"></option>
                <option value="6M" data-i18n="sp.api.wallhaven.toprange_6M"></option>
                <option value="1y" data-i18n="sp.api.wallhaven.toprange_1y"></option>
            </select>
        </div>
        <div class="source_sidebar_section">
            <span class="source_sidebar_section_title" data-i18n="wallpaper_switcher.clear_history_section"></span>
            <button type="button" class="btn" id="wh_sidebar_btn_clear_history" data-variant="danger">
                <i data-icon="trash"></i>
                <div class="btn_body">
                    <span class="btn_title" data-i18n="wallpaper_switcher.clear_history"></span>
                    <span class="btn_desc" data-i18n="wallpaper_switcher.clear_history_desc"></span>
                </div>
            </button>
        </div>
        <div class="source_sidebar_actions">
            <button type="button" class="btn" id="wh_sidebar_btn_reset">
                <span data-i18n="common.reset"></span>
            </button>
            <button type="button" class="btn" id="wh_sidebar_btn_apply">
                <span data-i18n="bg_editor.btn_apply"></span>
            </button>
        </div>
    `;

  translateDOM(form);
  renderIcons(form);

  const resSelect = form.querySelector("#wh_sidebar_resolution");
  const sortSelect = form.querySelector("#wh_sidebar_sorting");
  const topRangeSelect = form.querySelector("#wh_sidebar_toprange");

  initButtons(form);

  const queryInput = form.querySelector("#wh_sidebar_query");
  const catGeneral = form.querySelector("#wh_sidebar_cat_general");
  const catAnime = form.querySelector("#wh_sidebar_cat_anime");
  const catPeople = form.querySelector("#wh_sidebar_cat_people");
  const topRangeSection = form.querySelector("#wh_sidebar_toprange_section");
  const resetBtn = form.querySelector("#wh_sidebar_btn_reset");
  const applyBtn = form.querySelector("#wh_sidebar_btn_apply");
  const clearHistoryBtn = form.querySelector("#wh_sidebar_btn_clear_history");

  let savedConfig = {
    query: "",
    categories: "010",
    resolution: "any",
    sorting: "random",
    topRange: "1M",
  };

  function getCategoriesBinary() {
    const g = catGeneral.getAttribute("aria-pressed") === "true" ? "1" : "0";
    const a = catAnime.getAttribute("aria-pressed") === "true" ? "1" : "0";
    const p = catPeople.getAttribute("aria-pressed") === "true" ? "1" : "0";
    return `${g}${a}${p}`;
  }

  function setCategoriesFromBinary(binary = "010") {
    const pad = binary.padEnd(3, "0");
    catGeneral.setAttribute("aria-pressed", pad[0] === "1" ? "true" : "false");
    catAnime.setAttribute("aria-pressed", pad[1] === "1" ? "true" : "false");
    catPeople.setAttribute("aria-pressed", pad[2] === "1" ? "true" : "false");
  }

  function updateTopRangeVisibility() {
    const isToplist = sortSelect.value === "toplist";
    topRangeSection.classList.toggle("hidden", !isToplist);
  }

  function getFormValues() {
    return {
      query: queryInput.value.trim(),
      categories: getCategoriesBinary(),
      resolution: resSelect.value || "any",
      sorting: sortSelect.value || "random",
      topRange: topRangeSelect.value || "1M",
    };
  }

  function checkDirty() {
    const cur = getFormValues();
    const isDirty =
      cur.query !== savedConfig.query ||
      cur.categories !== savedConfig.categories ||
      cur.resolution !== savedConfig.resolution ||
      cur.sorting !== savedConfig.sorting ||
      (cur.sorting === "toplist" && cur.topRange !== savedConfig.topRange);

    applyBtn.disabled = !isDirty;
  }

  function toggleCategoryPill(btn) {
    const isPressed = btn.getAttribute("aria-pressed") === "true";
    const newPressed = !isPressed;
    if (!newPressed) {
      const othersPressed = [catGeneral, catAnime, catPeople].some(
        (p) => p !== btn && p.getAttribute("aria-pressed") === "true",
      );
      if (!othersPressed) return;
    }
    btn.setAttribute("aria-pressed", String(newPressed));
    checkDirty();
  }

  catGeneral.addEventListener("click", () => toggleCategoryPill(catGeneral));
  catAnime.addEventListener("click", () => toggleCategoryPill(catAnime));
  catPeople.addEventListener("click", () => toggleCategoryPill(catPeople));

  queryInput.addEventListener("input", checkDirty);
  resSelect.addEventListener("change", checkDirty);
  sortSelect.addEventListener("change", () => {
    updateTopRangeVisibility();
    checkDirty();
  });
  topRangeSelect.addEventListener("change", checkDirty);

  document.addEventListener("dropdownChange", (e) => {
    if (!form.contains(e.detail.element)) return;
    if (e.detail.element === sortSelect) {
      updateTopRangeVisibility();
    }
    checkDirty();
  });

  clearHistoryBtn?.addEventListener("click", async () => {
    const confirmed = await showConfirm(
      t("wallpaper_switcher.clear_history_modal_msg"),
      {
        title: t("wallpaper_switcher.clear_history_modal_title"),
        okText: t("wallpaper_switcher.clear_history"),
        cancelText: t("common.cancel"),
        isDanger: true,
      },
    );
    if (!confirmed) return;

    try {
      await dataControl.clearSourceHistory("wallhaven");
      sidebar.close();
      showNotification(
        t("wallpaper_switcher.clear_history_success"),
        "success",
      );
    } catch (err) {
      console.error("[WallhavenSidebar] Failed to clear history:", err);
      showNotification(err?.message || "Lỗi khi dọn dẹp lịch sử", "error");
    }
  });

  resetBtn.addEventListener("click", async () => {
    const confirmed = await confirmReset(
      t(
        "sp.api.wallhaven.reset_confirm_msg",
        "Bạn có chắc muốn đặt lại cài đặt tìm kiếm Wallhaven về mặc định?",
      ),
    );
    if (!confirmed) return;

    queryInput.value = "";
    setCategoriesFromBinary("010");
    setDropdownValue(resSelect, "any");
    setDropdownValue(sortSelect, "random");
    setDropdownValue(topRangeSelect, "1M");
    updateTopRangeVisibility();
    checkDirty();
  });

  applyBtn.addEventListener("click", async () => {
    const cur = getFormValues();
    saveSettings({
      wallhavenConfig: {
        query: cur.query,
        categories: cur.categories,
        resolution: cur.resolution,
        sorting: cur.sorting,
        topRange: cur.topRange,
      },
    });

    savedConfig = { ...cur };
    checkDirty();

    try {
      await clearWallhavenQueue();
      if (dataControl.activeSourceId === "wallhaven") {
        await sidebar.reload("wallhaven");
      }
      sidebar.close();
      showNotification(
        t("sp.api.wallhaven.saved", "Đã áp dụng cài đặt Wallhaven"),
        "success",
      );
    } catch (err) {
      console.error("[WallhavenSidebar] Failed to apply settings:", err);
      showNotification(err?.message || "Lỗi khi áp dụng cài đặt", "error");
    }
  });

  function syncFromSettings() {
    const cfg = getSettings().wallhavenConfig || {};
    savedConfig = {
      query: cfg.query || "",
      categories: cfg.categories || "010",
      resolution: cfg.resolution || "any",
      sorting: cfg.sorting || "random",
      topRange: cfg.topRange || "1M",
    };

    queryInput.value = savedConfig.query;
    setCategoriesFromBinary(savedConfig.categories);
    setDropdownValue(resSelect, savedConfig.resolution);
    setDropdownValue(sortSelect, savedConfig.sorting);
    setDropdownValue(topRangeSelect, savedConfig.topRange);
    updateTopRangeVisibility();
    checkDirty();
  }

  return {
    el: form,
    onOpen: syncFromSettings,
    onClose: () => {},
  };
}
