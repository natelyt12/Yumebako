import { getSettings, saveSettings, subscribe } from "/src/core/storageHandler.js";
import { getFromStore, saveToStore } from "/src/core/db.js";
import { t } from "/src/core/i18n.js";
import {
  showNotification,
  openSidebarSubmenu,
  showConfirm,
  showAlert,
} from "/src/core/ui.js";
import { initIdbTracker } from "/src/settings/system/debugIdbTracker.js";

const DEBUG_UNLOCK_TAPS = 7;
const DEBUG_TAP_WINDOW_MS = 2000;

export function initDebugSettings() {
  initDebugModeToggle();
  initDebugUnlock();
  initIdbTracker();
  initCarouselTestButtons();
  initI18nDebug();
  initDialogTest();
  initNotifTest();
  initSubmenuTest();
  initDropdownTest();
}

function syncDebugTabVisibility(enabled) {
  const navItem = document.querySelector('.nav_item[data-tab="debug"]');
  const toggle = document.getElementById("debug_mode_toggle");

  if (navItem) {
    navItem.classList.toggle("hidden", !enabled);
    if (!enabled && navItem.classList.contains("active")) {
      document.querySelector('.nav_item[data-tab="info"]')?.click();
    }
  }
  if (toggle) {
    toggle.checked = Boolean(enabled);
  }
}

function initDebugModeToggle() {
  const enabled = getSettings().debugMode === true;
  syncDebugTabVisibility(enabled);

  const toggle = document.getElementById("debug_mode_toggle");
  toggle?.addEventListener("change", (e) => {
    const isEnabled = e.target.checked;
    saveSettings({ debugMode: isEnabled });
    syncDebugTabVisibility(isEnabled);
    if (!isEnabled) {
      showNotification(t("sp.debug.disabled_toast"), "info");
    }
  });

  subscribe("debugMode", (isEnabled) => {
    syncDebugTabVisibility(isEnabled === true);
  });
}

function initDebugUnlock() {
  const versionTrigger = document.getElementById("app_version_trigger");
  if (!versionTrigger) return;

  let tapCount = 0;
  let resetTimer = null;

  versionTrigger.addEventListener("click", () => {
    if (getSettings().debugMode === true) {
      showNotification(t("sp.debug.already_enabled"), "info");
      return;
    }

    tapCount += 1;
    clearTimeout(resetTimer);
    resetTimer = setTimeout(() => {
      tapCount = 0;
    }, DEBUG_TAP_WINDOW_MS);

    const remaining = DEBUG_UNLOCK_TAPS - tapCount;
    if (remaining > 0) {
      if (tapCount >= 3) {
        showNotification(
          t("sp.debug.tap_remaining", { count: remaining }),
          "info",
        );
      }
      return;
    }

    tapCount = 0;
    clearTimeout(resetTimer);
    saveSettings({ debugMode: true });
    syncDebugTabVisibility(true);
    showNotification(t("sp.debug.enabled_toast"), "success");
  });
}

function initCarouselTestButtons() {
  document
    .getElementById("debug_btn_carousel_jitter")
    ?.addEventListener("click", () => {
      window.open("/tests/carousel-jitter/harness.html", "_blank");
    });
  document
    .getElementById("debug_btn_carousel_perf")
    ?.addEventListener("click", () => {
      window.open("/tests/carousel-perf/index.html", "_blank");
    });
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
    const confirmed = await showConfirm(
      "This is a standard confirmation dialog.",
      {
        title: "Confirm Action",
        okText: "Confirm",
        cancelText: "Cancel",
      },
    );
    showNotification(
      `Result: ${confirmed ? "Confirmed" : "Cancelled"}`,
      confirmed ? "success" : "info",
    );
  });

  const dangerBtn = document.getElementById("test_dialog_danger");
  dangerBtn?.addEventListener("click", async () => {
    const confirmed = await showConfirm(
      "This action is destructive and cannot be undone (Danger Confirm).",
      {
        title: "Delete Data?",
        okText: "Delete Permanently",
        isDanger: true,
      },
    );
    showNotification(
      `Delete confirmed: ${confirmed}`,
      confirmed ? "success" : "info",
    );
  });

  const alertBtn = document.getElementById("test_dialog_alert");
  alertBtn?.addEventListener("click", async () => {
    await showAlert("This is a standalone alert dialog.", {
      title: "System Alert",
    });
    showNotification("Alert closed", "info");
  });
}

function initNotifTest() {
  document.getElementById("test_notif_info")?.addEventListener("click", () => {
    showNotification("Info: This is a standard info notification.", "info");
  });

  document
    .getElementById("test_notif_success")
    ?.addEventListener("click", () => {
      showNotification(
        "Success: Action completed successfully!",
        "success",
      );
    });

  document.getElementById("test_notif_error")?.addEventListener("click", () => {
    showNotification("Error: Something went wrong while processing!", "error");
  });

  document
    .getElementById("test_notif_warning")
    ?.addEventListener("click", () => {
      showNotification(
        "Warning: Please double-check your configuration.",
        "warning",
      );
    });
}

function initSubmenuTest() {
  const createSubmenuContent = (titleText) => {
    const div = document.createElement("div");
    div.className = "setting_section";
    div.innerHTML = `
            <p class="setting_title">${titleText}</p>
            <span class="tooltip">Floating submenu panel: slides in next to the navigation bar and takes over the main menu slot. Enter a custom width to test wider panels.</span>
            <div class="setting_options flex_col gap_8">
                <button id="sub_action_1" class="btn">Test Action 1</button>
                <button id="sub_action_2" class="btn">Test Action 2</button>
            </div>
        `;
    div.querySelector("#sub_action_1")?.addEventListener("click", () => {
      showNotification("Clicked Test Action 1 inside submenu", "success");
    });
    div.querySelector("#sub_action_2")?.addEventListener("click", () => {
      showNotification("Clicked Test Action 2 inside submenu", "info");
    });
    return div;
  };

  document
    .getElementById("test_sidebar_submenu")
    ?.addEventListener("click", () => {
      const inputVal = document
        .getElementById("test_submenu_width")
        ?.value.trim();
      const title = inputVal ? `Submenu (${inputVal})` : "Advanced Settings";
      openSidebarSubmenu(title, createSubmenuContent("Test Submenu Details"), {
        width: inputVal,
      });
    });

  document
    .getElementById("test_sidebar_submenu_fullscreen")
    ?.addEventListener("click", () => {
      openSidebarSubmenu(
        "Fullscreen Submenu",
        createSubmenuContent("Fullscreen Submenu Details"),
        { isFullScreen: true },
      );
    });
}

function initDropdownTest() {
  document.addEventListener("dropdownChange", (e) => {
    if (e.detail?.id === "test_custom_dropdown") {
      showNotification(`Custom Dropdown: Selected ${e.detail.value}`, "info");
    }
  });
}
