import { getSettings, saveSettings } from "/src/core/storageHandler.js";
import { clearWallhavenQueue } from "/src/wallpaper/sources/api/wallhavenAPI.js";
import { setDropdownValue } from "/src/core/ui/dropdown.js";

/**
 * Create and return the Wallhaven Extra Settings UI element from template.
 * @param {Object} providerInstance
 * @returns {HTMLElement|DocumentFragment|null}
 */
export function createWallhavenSettingsUI(providerInstance) {
    const template = document.getElementById("tpl_wallhaven_settings");
    if (!template) return null;

    const clone = template.content.cloneNode(true);
    const config = getSettings().wallhavenConfig;

    const queryInput = clone.querySelector("#wh_query");
    const catGeneral = clone.querySelector("#wh_cat_general");
    const catAnime = clone.querySelector("#wh_cat_anime");
    const catPeople = clone.querySelector("#wh_cat_people");
    const resolutionBtn = clone.querySelector("#wh_resolution");
    const sortingBtn = clone.querySelector("#wh_sorting");
    const topRangeBtn = clone.querySelector("#wh_topRange");
    const topRangeWrapper = clone.querySelector("#wh_toprange_wrapper");

    if (queryInput) queryInput.value = config.query;
    if (catGeneral) catGeneral.checked = config.categories.general;
    if (catAnime) catAnime.checked = config.categories.anime;
    if (catPeople) catPeople.checked = config.categories.people;

    if (resolutionBtn) setDropdownValue(resolutionBtn, config.resolution);
    if (sortingBtn) setDropdownValue(sortingBtn, config.sorting);
    if (topRangeBtn) setDropdownValue(topRangeBtn, config.topRange);

    const updateTopRangeVisibility = () => {
        if (!sortingBtn || !topRangeWrapper) return;
        const currentSort = sortingBtn.getAttribute("data-selected");
        if (currentSort === "toplist") {
            topRangeWrapper.style.display = "block";
        } else {
            topRangeWrapper.style.display = "none";
        }
    };
    updateTopRangeVisibility();

    const saveWallhavenConfig = async () => {
        const currentConfig = getSettings().wallhavenConfig;
        const newConfig = {
            query: queryInput ? queryInput.value.trim() : currentConfig.query,
            categories: {
                general: catGeneral ? catGeneral.checked : currentConfig.categories.general,
                anime: catAnime ? catAnime.checked : currentConfig.categories.anime,
                people: catPeople ? catPeople.checked : currentConfig.categories.people,
            },
            resolution: resolutionBtn ? resolutionBtn.getAttribute("data-selected") : currentConfig.resolution,
            sorting: sortingBtn ? sortingBtn.getAttribute("data-selected") : currentConfig.sorting,
            topRange: topRangeBtn ? topRangeBtn.getAttribute("data-selected") : currentConfig.topRange,
        };

        saveSettings({ wallhavenConfig: newConfig });
        await clearWallhavenQueue();
    };

    if (queryInput) queryInput.addEventListener("change", saveWallhavenConfig);
    if (catGeneral) catGeneral.addEventListener("change", saveWallhavenConfig);
    if (catAnime) catAnime.addEventListener("change", saveWallhavenConfig);
    if (catPeople) catPeople.addEventListener("change", saveWallhavenConfig);
    if (resolutionBtn) {
        const observer = new MutationObserver(() => saveWallhavenConfig());
        observer.observe(resolutionBtn, { attributes: true, attributeFilter: ["data-selected"] });
    }
    if (sortingBtn) {
        const observerSorting = new MutationObserver(() => {
            updateTopRangeVisibility();
            saveWallhavenConfig();
        });
        observerSorting.observe(sortingBtn, { attributes: true, attributeFilter: ["data-selected"] });
    }
    if (topRangeBtn) {
        const observerTopRange = new MutationObserver(() => saveWallhavenConfig());
        observerTopRange.observe(topRangeBtn, { attributes: true, attributeFilter: ["data-selected"] });
    }

    return clone;
}
