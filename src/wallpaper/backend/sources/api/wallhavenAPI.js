import { getFromStore, saveToStore } from "/src/core/db.js";
import { getSettings } from "/src/core/storageHandler.js";
import { t } from "/src/core/i18n.js";

const WALLHAVEN_STORAGE_KEY = "provider_state:wallhaven";

/**
 * Fetch a fresh batch of wallpapers matching the user's Wallhaven filters.
 * Exported so the Switcher's WallhavenSource can build its own card list.
 *
 * @param {Object} [options]
 * @param {boolean} [options.strict=false] - Rethrow on failure instead of
 *     swallowing it into an empty batch. The Switcher needs to tell "the API is
 *     unreachable" (an error the user can retry) apart from "the filters match
 *     nothing" (a feed with nothing left), and an empty batch cannot say which.
 * @returns {Promise<Array>} Raw Wallhaven wallpaper records.
 */
export async function fetchWallhavenQueue({ strict = false, page = 1 } = {}) {
  try {
    const s = getSettings().wallhavenConfig || {};
    // `categories` is stored as a binary string ("010") by the sidebar, but
    // the defaults and older settings used an object — accept both.
    const rawCategories = s.categories;
    const categories =
      typeof rawCategories === "string"
        ? {
            general: rawCategories[0] === "1",
            anime: rawCategories[1] === "1",
            people: rawCategories[2] === "1",
          }
        : rawCategories || { general: true, anime: true, people: false };
    const sorting = s.sorting || "random";
    const topRange = s.topRange || "1M";
    const query = s.query || "";
    const resolution = s.resolution || "any";

    const cats = `${categories.general ? "1" : "0"}${categories.anime ? "1" : "0"}${categories.people ? "1" : "0"}`;

    const params = new URLSearchParams({
      sorting: sorting,
      categories: cats,
      purity: "100",
      ratios: "landscape",
      page: String(page),
    });

    if (sorting === "toplist") {
      params.append("topRange", topRange);
    }

    if (query) params.append("q", query);
    if (resolution && resolution !== "any")
      params.append("atleast", resolution);

    const url = `https://wallhaven.cc/api/v1/search?${params.toString()}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    const json = await response.json();
    const list = json.data || [];
    const appliedQuery = query.trim();
    for (const item of list) {
      item.query = appliedQuery;
    }
    if (json.meta) {
      list.meta = json.meta;
    }
    return list;
  } catch (error) {
    console.error("[wallhavenAPI] Error fetching wallhaven queue:", error);
    if (strict) throw error;
    return [];
  }
}

/**
 * Clear the persisted Wallhaven queue and reset pagination back to page 1.
 * @returns {Promise<void>}
 */
export async function clearWallhavenQueue() {
  let storeData = (await getFromStore(WALLHAVEN_STORAGE_KEY)) || {
    queue: [],
    current: null,
  };
  storeData.queue = [];
  storeData.page = 1;
  storeData.last_page = null;
  await saveToStore(WALLHAVEN_STORAGE_KEY, storeData);
}
