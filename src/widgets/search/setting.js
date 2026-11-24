import { getSettings, saveSettings, subscribe } from "/src/core/storageHandler.js";
import { EventBus } from "/src/core/eventBus.js";
import { EVENTS } from "/src/core/events.js";
import {
  PERMISSION_STATUS,
  hasPermission,
  requestPermission,
} from "/src/core/permissions.js";
import { SEARCH_ENGINES } from "./providers.js";

/**
 * Update a single key inside `widgets.search.config` and persist it.
 * @param {string} key
 * @param {any} value
 */
function saveSearchConfig(key, value) {
  const currentWidgets = getSettings().widgets;
  saveSettings({
    widgets: {
      ...currentWidgets,
      search: {
        ...currentWidgets?.search,
        config: {
          ...currentWidgets?.search?.config,
          [key]: value,
        },
      },
    },
  });
}

/**
 * Initialize controls inside the Search widget settings tab and keep them
 * synchronized with persisted settings.
 */
export function initSearchSettings() {
  const providerSelect = document.getElementById("search_provider");
  const placeholderInput = document.getElementById("search_custom_placeholder");

  if (providerSelect) {
    const resolveEngine = (id) =>
      SEARCH_ENGINES.some((p) => p.id === id) ? id : SEARCH_ENGINES[0].id;

    const syncDropdown = (value) => {
      const normalized = resolveEngine(value);
      if (providerSelect.value !== normalized) {
        providerSelect.value = normalized;
      }
      document.dispatchEvent(
        new CustomEvent("dropdownChange", {
          detail: { id: "search_provider", value: normalized, firstRun: true },
        }),
      );
    };

    syncDropdown(getSettings().widgets?.search?.config?.provider);

    subscribe("widgets", (widgets) => {
      syncDropdown(widgets?.search?.config?.provider);
    });

    document.addEventListener("dropdownChange", (e) => {
      const { id, value, firstRun } = e.detail || {};
      if (id !== "search_provider" || firstRun || !value) return;
      if (getSettings().widgets?.search?.config?.provider !== value) {
        saveSearchConfig("provider", value);
      }
    });
  }

  const toggleBindings = [
    ["search_open_new_tab", "open_in_new_tab"],
    ["search_reduce_animation", "reduce_animation"],
    ["search_disable_placeholder_roll", "disable_placeholder_roll"],
  ];
  const config = getSettings().widgets?.search?.config || {};

  toggleBindings.forEach(([elementId, configKey]) => {
    const checkbox = document.getElementById(elementId);
    if (!checkbox) return;
    checkbox.checked = Boolean(config[configKey]);
    checkbox.addEventListener("change", (e) => {
      saveSearchConfig(configKey, e.target.checked);
    });
  });

  const permissionToggleBindings = [
    ["search_autocomplete_bookmarks", "autocomplete_bookmarks", "bookmarks"],
    ["search_autocomplete_history", "autocomplete_history", "history"],
  ];

  const syncPermissionToggles = async () => {
    const latestConfig = getSettings().widgets?.search?.config || {};
    await Promise.all(
      permissionToggleBindings.map(async ([elementId, configKey, permission]) => {
        const checkbox = document.getElementById(elementId);
        if (!checkbox) return;
        const enabled = Boolean(latestConfig[configKey]);
        if (!enabled) {
          checkbox.checked = false;
          return;
        }
        const check = await hasPermission({
          permissions: [permission],
          source: "search_widget",
        });
        if (check.status === PERMISSION_STATUS.MISSING) {
          checkbox.checked = false;
          saveSearchConfig(configKey, false);
        } else {
          checkbox.checked = enabled;
        }
      }),
    );
  };

  permissionToggleBindings.forEach(([elementId, configKey, permission]) => {
    const checkbox = document.getElementById(elementId);
    if (!checkbox) return;
    checkbox.checked = Boolean(config[configKey]);
    checkbox.addEventListener("change", async (e) => {
      if (!e.target.checked) {
        saveSearchConfig(configKey, false);
        return;
      }
      const result = await requestPermission({
        permissions: [permission],
        source: "search_widget",
      });
      if (result.granted) {
        saveSearchConfig(configKey, true);
      } else {
        checkbox.checked = false;
        saveSearchConfig(configKey, false);
      }
    });
  });

  syncPermissionToggles();
  EventBus.on(EVENTS.PERMISSION_CHANGED, syncPermissionToggles);

  if (placeholderInput) {
    placeholderInput.value = config.custom_placeholder || "";
    placeholderInput.addEventListener("input", (e) => {
      saveSearchConfig("custom_placeholder", e.target.value);
    });
  }
}
