
import { initButtons, initToggleSettingBtn, initSubToggle, showConfirm, closeSidebarSubmenu } from "/src/core/ui.js";
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
        initButtons();
        renderIcons();
        initToggleSettingBtn();
        initSettingsNav();
        initNavFloatingTooltip();

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
                    const langBtn = document.getElementById("language");
                    const msg = t("sp.language.reload_msg") || "Thay đổi ngôn ngữ yêu cầu tải lại trang";
                    const confirmed = await showConfirm(msg, {
                        title: t("sp.language.reload_title") || "Thay đổi ngôn ngữ",
                        okText: t("common.reload") || "Tải lại trang",
                        width: "340px",
                        anchor: langBtn,
                        placement: "bottom-right"
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
    }
}

function initSettingsNav() {
    const navItems = document.querySelectorAll(".nav_item[data-tab]");
    const tabContents = document.querySelectorAll(".tab_content");

    navItems.forEach((item) => {
        item.addEventListener("click", () => {
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

function initNavFloatingTooltip() {
    const nav = document.querySelector(".settings_nav");
    const tooltip = document.getElementById("nav_floating_tooltip");
    const textEl = document.getElementById("nav_tooltip_text");
    const measureEl = document.getElementById("nav_tooltip_measure");
    if (!nav || !tooltip || !textEl || !measureEl) return;

    let hideTimer = null;
    let fadeTimer = null;
    let rafId = null;

    let currentY = null;
    let targetY = null;
    let currentWidth = null;
    let targetWidth = null;
    let currentText = "";

    const LERP_FACTOR = 0.22;
    const HORIZONTAL_CHROME = 28 + 2; // 14px * 2 padding + 1px * 2 border

    function animate() {
        const dy = targetY - currentY;
        const dw = targetWidth - currentWidth;

        if (Math.abs(dy) < 0.25 && Math.abs(dw) < 0.25) {
            currentY = targetY;
            currentWidth = targetWidth;
            tooltip.style.top = `${currentY.toFixed(1)}px`;
            tooltip.style.width = `${currentWidth.toFixed(1)}px`;
            rafId = null;
            return;
        }

        currentY += dy * LERP_FACTOR;
        currentWidth += dw * LERP_FACTOR;

        tooltip.style.top = `${currentY.toFixed(1)}px`;
        tooltip.style.width = `${currentWidth.toFixed(1)}px`;

        rafId = requestAnimationFrame(animate);
    }

    function startLerp() {
        if (!rafId) {
            rafId = requestAnimationFrame(animate);
        }
    }

    nav.addEventListener("pointerover", (e) => {
        const item = e.target.closest(".nav_item[data-tooltip-i18n], .nav_item[data-tooltip]");
        if (!item || !nav.contains(item)) return;

        clearTimeout(hideTimer);
        const i18nKey = item.getAttribute("data-tooltip-i18n");
        const directText = item.getAttribute("data-tooltip");
        const text = i18nKey ? t(i18nKey) : directText;
        if (!text) return;

        const navRect = nav.getBoundingClientRect();
        const itemRect = item.getBoundingClientRect();
        targetY = (itemRect.top - navRect.top) + (itemRect.height / 2);

        measureEl.textContent = text;
        targetWidth = Math.ceil(measureEl.offsetWidth + HORIZONTAL_CHROME);

        const isAlreadyVisible = tooltip.classList.contains("visible");

        if (!isAlreadyVisible) {
            currentY = targetY;
            currentWidth = targetWidth;
            currentText = text;
            textEl.textContent = text;
            textEl.className = "nav_tooltip_text";
            tooltip.style.top = `${currentY}px`;
            tooltip.style.width = `${currentWidth}px`;
            tooltip.classList.add("visible");
        } else {
            startLerp();

            if (text !== currentText) {
                currentText = text;
                clearTimeout(fadeTimer);
                textEl.classList.remove("fade_in_prep");
                textEl.classList.add("fade_out");

                fadeTimer = setTimeout(() => {
                    textEl.textContent = text;
                    textEl.classList.add("fade_in_prep");
                    textEl.classList.remove("fade_out");
                    void textEl.offsetWidth; // Force reflow
                    textEl.classList.remove("fade_in_prep");
                }, 70);
            }
        }
    });

    nav.addEventListener("pointerout", (e) => {
        const item = e.target.closest(".nav_item");
        if (!item) return;

        const related = e.relatedTarget?.closest?.(".nav_item");
        if (related && nav.contains(related)) return;

        clearTimeout(hideTimer);
        hideTimer = setTimeout(() => {
            tooltip.classList.remove("visible");
            if (rafId) {
                cancelAnimationFrame(rafId);
                rafId = null;
            }
        }, 80);
    });
}

