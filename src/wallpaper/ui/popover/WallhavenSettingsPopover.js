import "./wallhaven_popover.css";
import { t, translateDOM } from "/src/core/i18n.js";
import { getSettings, saveSettings } from "/src/core/storageHandler.js";
import { createPopover, showNotification, confirmReset } from "/src/core/ui.js";
import { initButtons } from "/src/core/ui/button.js";
import { setDropdownValue } from "/src/core/ui/dropdown.js";
import { clearWallhavenQueue } from "/src/wallpaper/sources/api/wallhavenAPI.js";

/**
 * WallhavenSettingsPopover.js
 * ---------------------------------------------------------------------------
 * Popover form for Wallhaven provider settings (search query, categories,
 * resolution, sorting, and toplist range).
 *
 * Strictly adheres to Yumebako UI rules:
 * - Uses shared layout tokens, semantic native controls upgraded to custom dropdowns.
 * - Full localization support with data-i18n and translateDOM.
 * - Standard .btn controls without arbitrary primary colors.
 * - Category tab bar replicating .wallpaper_source_tabs.
 */
export function createWallhavenSettingsPopover({ trigger, switcher, dataControl }) {
    if (!trigger) return null;

    const form = document.createElement("div");
    form.className = "wallhaven_settings_form";

    form.innerHTML = `
        <div class="wh_section">
            <span class="wh_section_title" data-i18n="sp.api.wallhaven.search"></span>
            <input type="text" id="wh_popover_query" data-i18n-placeholder="sp.api.wallhaven.search_placeholder" autocomplete="off" />
        </div>
        <div class="wh_section">
            <span class="wh_section_title" data-i18n="sp.api.wallhaven.categories"></span>
            <div class="wh_categories_group" role="group">
                <button type="button" class="wh_cat_pill" id="wh_popover_cat_general" role="button" aria-pressed="false"><span data-i18n="sp.api.wallhaven.cat_general"></span></button>
                <button type="button" class="wh_cat_pill" id="wh_popover_cat_anime" role="button" aria-pressed="true"><span data-i18n="sp.api.wallhaven.cat_anime"></span></button>
                <button type="button" class="wh_cat_pill" id="wh_popover_cat_people" role="button" aria-pressed="false"><span data-i18n="sp.api.wallhaven.cat_people"></span></button>
            </div>
        </div>
        <div class="wh_section">
            <span class="wh_section_title" data-i18n="sp.api.wallhaven.resolution"></span>
            <select class="native_select" id="wh_popover_resolution">
                <option value="any" data-i18n="sp.api.wallhaven.resolution_any"></option>
                <option value="1920x1080">Full HD (1920×1080)</option>
                <option value="2560x1440">2K (2560×1440)</option>
                <option value="3840x2160">4K (3840×2160)</option>
            </select>
        </div>
        <div class="wh_section">
            <span class="wh_section_title" data-i18n="sp.api.wallhaven.sorting"></span>
            <select class="native_select" id="wh_popover_sorting">
                <option value="random" data-i18n="sp.api.wallhaven.sort_random"></option>
                <option value="date_added" data-i18n="sp.api.wallhaven.sort_date"></option>
                <option value="views" data-i18n="sp.api.wallhaven.sort_views"></option>
                <option value="favorites" data-i18n="sp.api.wallhaven.sort_favorites"></option>
                <option value="toplist" data-i18n="sp.api.wallhaven.sort_toplist"></option>
            </select>
        </div>
        <div class="wh_section hidden" id="wh_popover_toprange_section">
            <span class="wh_section_title" data-i18n="sp.api.wallhaven.toprange"></span>
            <select class="native_select" id="wh_popover_toprange">
                <option value="1d" data-i18n="sp.api.wallhaven.toprange_1d"></option>
                <option value="3d" data-i18n="sp.api.wallhaven.toprange_3d"></option>
                <option value="1w" data-i18n="sp.api.wallhaven.toprange_1w"></option>
                <option value="1M" data-i18n="sp.api.wallhaven.toprange_1M"></option>
                <option value="3M" data-i18n="sp.api.wallhaven.toprange_3M"></option>
                <option value="6M" data-i18n="sp.api.wallhaven.toprange_6M"></option>
                <option value="1y" data-i18n="sp.api.wallhaven.toprange_1y"></option>
            </select>
        </div>
        <div class="wh_actions">
            <button type="button" class="btn" id="wh_popover_btn_reset" data-i18n="common.reset"></button>
            <button type="button" class="btn" id="wh_popover_btn_apply" data-i18n="bg_editor.btn_apply"></button>
        </div>
    `;

    translateDOM(form);

    // Query select elements before upgrade to keep direct reference to native select
    const resSelect = form.querySelector("#wh_popover_resolution");
    const sortSelect = form.querySelector("#wh_popover_sorting");
    const topRangeSelect = form.querySelector("#wh_popover_toprange");

    // Upgrade native selects to custom dropdowns and initialize .btn controls
    initButtons(form);

    // Query elements
    const queryInput = form.querySelector("#wh_popover_query");
    const catGeneral = form.querySelector("#wh_popover_cat_general");
    const catAnime = form.querySelector("#wh_popover_cat_anime");
    const catPeople = form.querySelector("#wh_popover_cat_people");
    const topRangeSection = form.querySelector("#wh_popover_toprange_section");
    const resetBtn = form.querySelector("#wh_popover_btn_reset");
    const applyBtn = form.querySelector("#wh_popover_btn_apply");

    const pills = [catGeneral, catAnime, catPeople];
    let savedConfig = {};

    const setPillActive = (pill, active) => {
        pill.classList.toggle("active", active);
        pill.setAttribute("aria-pressed", active ? "true" : "false");
    };

    function getFormValues() {
        return {
            query: queryInput.value.trim(),
            categories: {
                general: catGeneral.classList.contains("active"),
                anime: catAnime.classList.contains("active"),
                people: catPeople.classList.contains("active"),
            },
            resolution: resSelect.value,
            sorting: sortSelect.value,
            topRange: topRangeSelect.value,
        };
    }

    function checkDirty() {
        const current = getFormValues();
        const saved = savedConfig || {};
        const savedCats = saved.categories || {};

        const isDirty =
            current.query !== (saved.query || "") ||
            current.categories.general !== Boolean(savedCats.general) ||
            current.categories.anime !== Boolean(savedCats.anime) ||
            current.categories.people !== Boolean(savedCats.people) ||
            current.resolution !== (saved.resolution || "any") ||
            current.sorting !== (saved.sorting || "random") ||
            (current.sorting === "toplist" && current.topRange !== (saved.topRange || "1M"));

        applyBtn.disabled = !isDirty;
    }

    // Toggle category pills (must keep at least 1 active)
    pills.forEach((pill) => {
        pill.addEventListener("click", () => {
            const isCurrentlyActive = pill.classList.contains("active");
            const activeCount = pills.filter((p) => p.classList.contains("active")).length;
            if (isCurrentlyActive && activeCount <= 1) {
                return;
            }
            setPillActive(pill, !isCurrentlyActive);
            checkDirty();
        });
    });

    queryInput.addEventListener("input", checkDirty);

    // Toggle topRange select visibility based on sorting using .hidden class
    sortSelect.addEventListener("change", () => {
        topRangeSection.classList.toggle("hidden", sortSelect.value !== "toplist");
        checkDirty();
    });

    resSelect.addEventListener("change", checkDirty);
    topRangeSelect.addEventListener("change", checkDirty);

    function syncFromSettings() {
        const cfg = getSettings().wallhavenConfig || {};
        savedConfig = {
            query: cfg.query || "",
            categories: cfg.categories || { general: true, anime: true, people: false },
            resolution: cfg.resolution || "any",
            sorting: cfg.sorting || "random",
            topRange: cfg.topRange || "1M",
        };
        queryInput.value = savedConfig.query;
        setPillActive(catGeneral, Boolean(savedConfig.categories.general));
        setPillActive(catAnime, Boolean(savedConfig.categories.anime));
        setPillActive(catPeople, Boolean(savedConfig.categories.people));
        setDropdownValue(resSelect, savedConfig.resolution);
        setDropdownValue(sortSelect, savedConfig.sorting);
        setDropdownValue(topRangeSelect, savedConfig.topRange);
        topRangeSection.classList.toggle("hidden", savedConfig.sorting !== "toplist");
        checkDirty();
    }

    resetBtn.addEventListener("click", async () => {
        if (!(await confirmReset())) return;
        queryInput.value = "";
        setPillActive(catGeneral, true);
        setPillActive(catAnime, true);
        setPillActive(catPeople, false);
        setDropdownValue(resSelect, "any");
        setDropdownValue(sortSelect, "random");
        setDropdownValue(topRangeSelect, "1M");
        topRangeSection.classList.add("hidden");
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
                wallhavenConfig: newValues,
            });
            savedConfig = newValues;

            await clearWallhavenQueue();

            popover.close();
            if (!dataControl.items || dataControl.items.length === 0) {
                await switcher?.loadSource?.("wallhaven");
            }
            showNotification(t("common.saved_changes", "Đã lưu thay đổi"), "success");
        } catch (err) {
            console.error("[WallhavenSettingsPopover] Failed to apply settings:", err);
            showNotification(err?.message || "Lỗi khi áp dụng cài đặt", "error");
            checkDirty();
        }
    });

    return popover;
}
