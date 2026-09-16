import { initI18n } from "./i18n.js";
import { getSettings } from "./storageHandler.js";
import { providerManager, initializeWavySettings, initializeParticles } from "../wallpaper/index.js";
import { initWidget } from "../widgets/handler.js";
import { initAppUtils } from "../settings/system/apputils.js";
import { renderIcons } from "./icon.js";
import { wallpaperSwitcher } from "../wallpaper/switcher/index.js";

let settingsLoaded = false;

/**
 * Dynamically loads and initializes the settings panel and its dependencies.
 */
async function loadSettingsPanel() {
    if (settingsLoaded) return;
    settingsLoaded = true;

    // Dynamic import of the settings sub-launcher
    const { initSettingsLauncher } = await import("../settings/settingHandler.js");
    await initSettingsLauncher();

    // Remove preload class and force reflow to guarantee the sliding transition animates on first click
    const wrapper = document.getElementById("setting_wrapper");
    if (wrapper) {
        void wrapper.offsetWidth; // Force layout calculation (reflow)
        wrapper.classList.remove("preload");
    }

    // Re-dispatch a mousedown event on the toggle button so the newly registered
    // event listener inside ui.js opens the settings panel immediately on first click.
    const toggleBtn = document.getElementById("setting_toggle_btn");
    if (toggleBtn) {
        toggleBtn.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
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
    initializeWavySettings();
    initializeParticles();
    renderIcons();

    // 2. Load core components in parallel (i18n and background layer)
    const i18nPromise = initI18n();
    const bgPromise = providerManager.prepare();

    if (immediate) {
        // Load widgets immediately in parallel with i18n/background
        await Promise.all([
            i18nPromise,
            bgPromise,
            initWidget()
        ]);
    } else {
        // Load widgets only after the entrance animation completes
        await Promise.all([i18nPromise, bgPromise]);
        document.addEventListener("onload-animation-complete", () => {
            initWidget();
        }, { once: true });
    }

    // 3. Initialize Wallpaper Switcher — it now decides which wallpaper boots
    await wallpaperSwitcher.init();

    // 4. Safety net: if the switcher could not restore or fetch anything, fall
    // back to the legacy provider flow so the overlay never stays covering the page.
    await providerManager.ensureBackground();

    // 5. Register Lazy Loading settings listeners
    const toggleBtn = document.getElementById("setting_toggle_btn");
    if (toggleBtn) {
        toggleBtn.addEventListener("mousedown", () => {
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
            const isOpen = wrapper && wrapper.classList.contains("setting_wrapper_opened");
            if (!isOpen) {
                if (!settingsLoaded) {
                    loadSettingsPanel();
                } else {
                    const btn = document.getElementById("setting_toggle_btn");
                    if (btn) btn.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
                }
            } else {
                const closeBtn = document.getElementById("setting_close_btn");
                if (closeBtn) closeBtn.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
            }
        }
    });
}
