
import { initSubsectionSvg, initToggleSettingBtn, initSubToggle, showConfirm, closeSidebarSubmenu } from "/src/core/ui.js";
import { renderIcons } from "/src/core/icon.js";
import { t, translateDOM } from "/src/core/i18n.js";
import {

    InitBGEditor,
    initializeWavySettings,
    initializeOnloadSettings,
    initializeParticles,
    initializeFilterSettings,
    applyWallpaperFilters,
    applyWallpaperPosition,
} from "/src/wallpaper/index.js";
import { initAppUtils, initDebugSettings } from "/src/settings/system/index.js";

import { initWeatherSettings } from "/src/widgets/weather/weather.js";
import { getSettings, saveSettings } from "/src/core/storageHandler.js";
import { initSettings as initWidgetSettings } from "/src/widgets/handler.js";

import settingsHtml from "./settings.html?raw";
import templateHtml from "./template.html?raw";
import clockSettingHtml from "/src/widgets/clock/setting.html?raw";
import weatherSettingHtml from "/src/widgets/weather/setting.html?raw";
import "./settings.css";

export async function initSettingsLauncher() {
    const wrapper = document.getElementById("setting_wrapper");
    if (wrapper) {
        wrapper.innerHTML = settingsHtml;
        
        if (!document.getElementById("external_templates_holder")) {
            const holder = document.createElement("div");
            holder.id = "external_templates_holder";
            holder.style.display = "none";
            holder.innerHTML = templateHtml;
            document.body.appendChild(holder);
        }

        const success = true;

        const tabTime = document.getElementById("tab-time");
        if (tabTime) tabTime.innerHTML = clockSettingHtml;

        const tabWeather = document.getElementById("tab-weather");
        if (tabWeather) tabWeather.innerHTML = weatherSettingHtml;

        // RENDER SETTINGS UI
        translateDOM(document.getElementById("setting_wrapper"));

        // --- 1. LOAD SETTINGS FROM STORAGE ---
        const settings = getSettings();
        console.debug("Loaded settings", settings);

        // --- 2. INIT UI & EVENTS ---
        initSubToggle();
        initSubsectionSvg();
        renderIcons();
        initToggleSettingBtn();
        initSettingsNav();

        // --- 3. INIT FEATURES ---

        applyWallpaperFilters();
        applyWallpaperPosition();
        InitBGEditor();
        initializeWavySettings();
        initAppUtils();
        initWeatherSettings();

        initializeOnloadSettings();
        initializeParticles();
        initializeFilterSettings();
        initWidgetSettings();
        initDebugSettings();

        // --- 4. RESTORE UI STATES FROM STORAGE ---
        const restoreStates = [
            { id: "API_selector", value: settings.wallpaperConfig.source },
            { id: "wh_resolution", value: settings.wallhavenConfig?.resolution || "" },
            { id: "language", value: settings.language || "vi" },
        ];

        restoreStates.forEach((state) => {
            document.dispatchEvent(
                new CustomEvent("dropdownChange", {
                    detail: { id: state.id, value: state.value, firstRun: true },
                }),
            );
        });

        // --- 4. EVENT LISTENERS FOR AUTO SAVE ---
        document.addEventListener("dropdownChange", async (e) => {
            const { id, value, firstRun } = e.detail;
            if (id === "language") {
                const current = getSettings().language || "vi";
                if (current !== value && !firstRun) {
                    const msg = t("sp.language.reload_msg") || "Thay đổi ngôn ngữ yêu cầu tải lại trang";
                    const confirmed = await showConfirm(msg, {
                        title: t("sp.language.reload_title") || "Thay đổi ngôn ngữ",
                        okText: t("common.reload") || "Tải lại trang",
                        width: "340px"
                    });

                    if (confirmed) {
                        saveSettings({ language: value });
                        location.reload();
                    } else {
                        // Revert dropdown UI back to current language
                        document.dispatchEvent(
                            new CustomEvent("dropdownChange", {
                                detail: { id: "language", value: current, firstRun: true },
                            })
                        );
                    }
                }
            }
        });

        // Remove preload class immediately to enable smooth transition
        document.getElementById("setting_wrapper")?.classList.remove("preload");
        
        syncThumbnailUI();
        
        const { providerManager } = await import("/src/wallpaper/legacy/index.js");
        providerManager.bindSettingsUI();
    }
}

function syncThumbnailUI() {
    const mainImg = document.querySelector('.background_container .image');
    const mainVideo = document.querySelector('.background_container .video');
    
    const thumbImg = document.querySelector('#wallpaper_thumbnail_container .image');
    const thumbVideo = document.querySelector('#wallpaper_thumbnail_container .video');

    if (mainVideo && mainVideo.style.display !== "none" && mainVideo.src && !mainVideo.src.endsWith("undefined")) {
        if (thumbVideo) {
            thumbVideo.style.display = "block";
            thumbVideo.src = mainVideo.src;
            thumbVideo.play().catch(() => {});
        }
        if (thumbImg) thumbImg.style.display = "none";
    } else if (mainImg) {
        if (thumbImg) {
            thumbImg.style.display = "block";
            thumbImg.style.backgroundImage = mainImg.style.backgroundImage;
        }
        if (thumbVideo) {
            thumbVideo.style.display = "none";
            thumbVideo.pause();
            thumbVideo.removeAttribute("src");
        }
    }
}

function initSettingsNav() {
    const navItems = document.querySelectorAll(".nav_item[data-tab]");
    const tabContents = document.querySelectorAll(".tab_content");

    navItems.forEach((item) => {
        item.addEventListener("mousedown", () => {
            const tabId = item.getAttribute("data-tab");
            if (!tabId) return;

            closeSidebarSubmenu();

            // Remove active class from all nav items and tab contents
            navItems.forEach((nav) => nav.classList.remove("active"));
            tabContents.forEach((tab) => tab.classList.remove("active"));

            // Add active class to clicked nav item and corresponding tab content
            item.classList.add("active");
            const targetTab = document.getElementById(`tab-${tabId}`);
            if (targetTab) {
                targetTab.classList.add("active");
                // Reset scroll position when switching tabs
                document.getElementById("settings_content").scrollTo({
                    top: 0,
                    behavior: "smooth",
                });
            }
        });
    });
}

