import { initI18n } from "./i18n.js";
import { getSettings } from "./storageHandler.js";
import {
  initializeWavySettings,
  initializeParticles,
  applyWallpaperFilters,
  applyWallpaperPosition,
} from "../wallpaper/index.js";
import { initWidget } from "../widgets/handler.js";
import { initAppUtils } from "../settings/system/apputils.js";
import { renderIcons } from "./icon.js";
import { initButtons } from "./ui/button.js";
import { wallpaperSwitcher } from "../wallpaper/core/WallpaperSwitcher.js";
import { dataControl } from "../wallpaper/core/DataControl.js";
import { scheduleMediaGC } from "../wallpaper/core/mediaGC.js";

let settingsLoaded = false;

/**
 * Dynamically loads and initializes the settings panel and its dependencies.
 */
async function loadSettingsPanel() {
  if (settingsLoaded) return;
  settingsLoaded = true;

  // Dynamic import of the settings sub-launcher
  const { initSettingsLauncher } =
    await import("../settings/settingHandler.js");
  await initSettingsLauncher();

  // Remove preload class and force reflow to guarantee the sliding transition animates on first click
  const wrapper = document.getElementById("setting_wrapper");
  if (wrapper) {
    void wrapper.offsetWidth; // Force layout calculation (reflow)
    wrapper.classList.remove("preload");
  }

  // Re-dispatch a click event on the toggle button so the newly registered
  // event listener inside ui.js opens the settings panel immediately on first click.
  const toggleBtn = document.getElementById("setting_toggle_btn");
  if (toggleBtn) {
    toggleBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  }
}

/**
 * Initializes the global startup lifecycle for Yumebako.
 */
export async function start() {
  // 1. Get initial configuration
  const settings = getSettings();
  const onloadData = settings.onload || {};
  const immediate = onloadData.widget_immediate !== false;

  // Apply saved visual settings immediately on startup
  initAppUtils();
  applyWallpaperFilters();
  applyWallpaperPosition();
  initializeWavySettings();
  initializeParticles();
  initButtons();
  renderIcons();

  // 2. Kh?i t?o DataControl tr??c (T?ng 2 -> T?ng 3 -> T?ng 4) ?? render Desktop Wallpaper ngay
  window.dataControl = dataControl;
  const dataControlPromise = dataControl.init();

  // 3. Load core components (i18n v? widgets) ch?y song song
  const i18nPromise = initI18n();
  const widgetPromise = immediate
    ? Promise.all([i18nPromise, initWidget()])
    : i18nPromise.then(() => {
        document.addEventListener(
          "onload-animation-complete",
          () => {
            initWidget();
          },
          { once: true },
        );
      });

  // Ch? c? DataControl v? i18n s?n s?ng tr??c khi d?ng Switcher (T?ng 1)
  await Promise.all([dataControlPromise, widgetPromise]);

  // 4. Kh?i t?o Wallpaper Switcher (T?ng 1)
  window.wallpaperSwitcher = wallpaperSwitcher;
  await wallpaperSwitcher.init();

  // 5. Register Lazy Loading settings listeners
  const toggleBtn = document.getElementById("setting_toggle_btn");
  if (toggleBtn) {
    toggleBtn.addEventListener("click", () => {
      wallpaperSwitcher.close();
      loadSettingsPanel();
    });
  }

  // 6. Register global shortcuts Alt+X (Settings) and Alt+W (Wallpaper Switcher)
  document.addEventListener("keydown", (e) => {
    if (e.altKey && e.code === "KeyW") {
      e.preventDefault();
      wallpaperSwitcher.toggle();
      return;
    }

    if (e.altKey && e.code === "KeyX") {
      e.preventDefault();
      const wrapper = document.getElementById("setting_wrapper");
      const isOpen =
        wrapper && wrapper.classList.contains("setting_wrapper_opened");
      if (!isOpen) {
        if (!settingsLoaded) {
          loadSettingsPanel();
        } else {
          const btn = document.getElementById("setting_toggle_btn");
          if (btn)
            btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        }
      } else {
        const closeBtn = document.getElementById("setting_close_btn");
        if (closeBtn)
          closeBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      }
    }
  });

  // 7. Schedule background Media Garbage Collector (GC)
  scheduleMediaGC();
}
