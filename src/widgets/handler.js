import { getSettings, saveSettings, subscribe } from "/src/core/storageHandler.js";
import { startClockUpdates, stopClockUpdates, initClockSettings } from "/src/widgets/clock/clock.js";
import { startWeatherUpdates, stopWeatherUpdates } from "/src/widgets/weather/weather.js";
import { makeWidgetsDraggable, syncWidgetEditMode } from "./editmode.js";

/** @typedef {import("/src/core/storageHandler.js").WidgetPositionConfig} WidgetPositionConfig */

let gridSize = 10;
let widgetSubscriptions = [];
let resizeObserver = null;

/**
 * Canonical canvas metric calculator — single source of truth.
 * Canvas occupies the largest area that is a multiple of gridSize fitting in the container.
 * @param {number} containerW - container clientWidth
 * @param {number} containerH - container clientHeight
 * @returns {{ effectiveW: number, effectiveH: number, offsetX: number, offsetY: number, centerX: number, centerY: number }}
 */
export function getCanvasMetrics(containerW, containerH) {
    const step = gridSize; // Expand by 1 grid at a time
    const effectiveW = Math.floor(containerW / step) * step;
    const effectiveH = Math.floor(containerH / step) * step;
    // floor keeps offsetX/Y stable (never jumps mid-step when effectiveW hasn't changed)
    const offsetX = Math.floor(((containerW - effectiveW) / 2) / gridSize) * gridSize;
    const offsetY = Math.floor(((containerH - effectiveH) / 2) / gridSize) * gridSize;

    // Round center coordinates to the nearest grid step so anchors are mathematically perfect
    const centerX = Math.round((offsetX + effectiveW / 2) / gridSize) * gridSize;
    const centerY = Math.round((offsetY + effectiveH / 2) / gridSize) * gridSize;

    return { offsetX, offsetY, effectiveW, effectiveH, centerX, centerY };
}

export function updateCanvasOffsets() {
    const container = document.getElementById("widgets_container");
    if (!container) return;
    const parent = container.parentElement;
    if (!parent) return;
    const { offsetX, offsetY, effectiveW, effectiveH, centerX, centerY } = getCanvasMetrics(parent.clientWidth, parent.clientHeight);
    container.style.setProperty("--canvas-effective-w", `${effectiveW}px`);
    container.style.setProperty("--canvas-effective-h", `${effectiveH}px`);
}

/**
 * Apply anchor-relative position styles to a widget DOM element.
 * @param {HTMLElement} widget - The widget DOM element.
 * @param {WidgetPositionConfig} pos - The position config to apply.
 */
export function applyWidgetPositionStyles(widget, pos) {
    widget.style.right = "";
    widget.style.bottom = "";
    widget.style.translate = "";

    const ax = pos.ax ?? 0;
    const ay = pos.ay ?? 0;
    const x = pos.x ?? 0;
    const y = pos.y ?? 0;

    widget.dataset.ax = ax;
    widget.dataset.ay = ay;
    widget.dataset.x = x;
    widget.dataset.y = y;

    if (pos.w) {
        widget.dataset.w = pos.w;
        widget.style.width = `${pos.w}px`;
    }
    if (pos.h) {
        widget.dataset.h = pos.h;
        widget.style.height = `${pos.h}px`;
    }

    widget.style.left = `${ax}%`;
    widget.style.top = `${ay}%`;
    widget.style.transform = `translate(calc(-${ax}% + ${x}px), calc(-${ay}% + ${y}px))`;
}

import clockHtml from "./clock/clock.html?raw";
import weatherHtml from "./weather/weather.html?raw";
import "./editmode.css";
import "./clock/clock.css";
import "./weather/weather.css";

export async function initWidget() {
    const isEnabled = getSettings().widgets?.enabled !== false;

    if (!isEnabled) {
        cleanupWidget();
        return;
    }

    const container = document.getElementById("widgets_container");
    if (container && container.children.length > 0) {
        return;
    }

    // Load widget HTML files dynamically
    let loadedCount = 0;
    if (getSettings().widgets?.clock?.enabled !== false || getSettings().widgets?.date?.enabled !== false || getSettings().widgets?.lunar?.enabled !== false) {
        container.insertAdjacentHTML("beforeend", clockHtml);

        // Remove disabled sub-widgets from the DOM
        if (getSettings().widgets?.clock?.enabled === false) {
            const clockEl = container.querySelector("#widget-clock");
            if (clockEl) clockEl.remove();
        }
        if (getSettings().widgets?.date?.enabled === false) {
            const dateEl = container.querySelector("#widget-date");
            if (dateEl) dateEl.remove();
        }
        if (getSettings().widgets?.lunar?.enabled === false) {
            const lunarEl = container.querySelector("#widget-lunar");
            if (lunarEl) lunarEl.remove();
        }
        loadedCount++;
    }
    if (getSettings().widgets?.weather?.enabled !== false) {
        container.insertAdjacentHTML("beforeend", weatherHtml);
        loadedCount++;
    }


    if (loadedCount > 0) {
        console.debug("Widget DOM loaded dynamically.");
        document.getElementById("widgets_container").style.opacity = "1";
    }

    const positionsStr = localStorage.getItem("bako_widget_positions");
    const userPositions = positionsStr ? JSON.parse(positionsStr) : {};

    const DEFAULT_POSITIONS = {
        "widget-clock": { ax: 0, ay: 100, x: 0, y: 0 },
        "widget-date": { ax: 0, ay: 100, x: 0, y: -80 },
        "widget-lunar": { ax: 0, ay: 100, x: 0, y: -120 },
        "widget-weather": { ax: 100, ay: 0, x: -20, y: 20 }
    };

    widgetSubscriptions.forEach((unsub) => unsub());
    widgetSubscriptions = [];

    gridSize = 10;
    container.style.setProperty("--grid-size", gridSize);

    if (resizeObserver) resizeObserver.disconnect();
    resizeObserver = new ResizeObserver(updateCanvasOffsets);
    if (container.parentElement) {
        resizeObserver.observe(container.parentElement);
    } else {
        resizeObserver.observe(document.body);
    }
    updateCanvasOffsets();

    // Apply saved positions or fallback to default
    const widgetsDOM = container.querySelectorAll(".widget");
    widgetsDOM.forEach((w) => {
        const type = w.id.replace("widget-", "");
        let pos = getSettings().widgets?.[type]?.position || DEFAULT_POSITIONS[w.id];
        
        // Very basic backward compatibility if they have old anchor config
        if (pos && pos.anchor && pos.ax === undefined) {
             const anchorMap = {
                 "top-left": { ax: 0, ay: 0 }, "top-center": { ax: 50, ay: 0 }, "top-right": { ax: 100, ay: 0 },
                 "center-left": { ax: 0, ay: 50 }, "center": { ax: 50, ay: 50 }, "center-right": { ax: 100, ay: 50 },
                 "bottom-left": { ax: 0, ay: 100 }, "bottom-center": { ax: 50, ay: 100 }, "bottom-right": { ax: 100, ay: 100 }
             };
             const mapped = anchorMap[pos.anchor] || { ax: 0, ay: 0 };
             pos = { ax: mapped.ax, ay: mapped.ay, x: pos.offsetX || 0, y: pos.anchor.includes("bottom") ? -(pos.offsetY || 0) : (pos.offsetY || 0) };
             if (pos.anchor.includes("right")) pos.x = -pos.x;
        }

        if (pos) {
            applyWidgetPositionStyles(w, pos);
        }

        // Force widget dimensions to be exactly multiples of the grid size (5px)
        // We use MutationObserver to avoid infinite loops from ResizeObserver.
        const updateRoundedSize = () => {
            // If custom width and height are set via resize, preserve them
            if (w.dataset.w && w.dataset.h) {
                w.style.width = `${w.dataset.w}px`;
                w.style.height = `${w.dataset.h}px`;
                return;
            }

            // Revert to natural size
            w.style.width = 'max-content';
            w.style.height = 'max-content';

            // Measure exactly
            const rect = w.getBoundingClientRect();
            const step = parseInt(getComputedStyle(w).getPropertyValue('--grid-size')) || 10;

            // CRITICAL: We MUST round to an EVEN multiple of the grid step (step * 2).
            // If width is an odd multiple of 10 (e.g. 30), half width is 15.
            // When anchored to 'center', translate: -50% pushes the visual edge to a 5px boundary.
            // This causes a 5px jump on mousedown, and another 5px jump on mouseup!
            // By forcing width to be an even multiple (e.g. 40), half width is 20, keeping both center AND edges perfectly on the 10px grid.
            const doubleStep = step * 2;
            const roundedW = Math.ceil((rect.width - 0.01) / doubleStep) * doubleStep;
            const roundedH = Math.ceil((rect.height - 0.01) / doubleStep) * doubleStep;

            // Force rounded size
            w.style.width = `${roundedW}px`;
            w.style.height = `${roundedH}px`;
        };

        updateRoundedSize();

        // Listen for any inner DOM changes
        const mo = new MutationObserver(updateRoundedSize);
        mo.observe(w, { childList: true, characterData: true, subtree: true });

        // Also listen for font loading (since font affects text size)
        if (document.fonts) {
            document.fonts.ready.then(updateRoundedSize);
        }
    });

    makeWidgetsDraggable(container);
    if (getSettings().widgets?.clock?.enabled !== false || getSettings().widgets?.date?.enabled !== false || getSettings().widgets?.lunar?.enabled !== false) startClockUpdates();
    if (getSettings().widgets?.weather?.enabled !== false) startWeatherUpdates();
}

function cleanupWidget() {
    stopClockUpdates();
    stopWeatherUpdates();
    widgetSubscriptions.forEach((unsub) => unsub());
    widgetSubscriptions = [];
    if (resizeObserver) {
        resizeObserver.disconnect();
        resizeObserver = null;
    }
    const container = document.getElementById("widgets_container");
    if (container) container.innerHTML = "";
}

export async function reloadWidgets() {
    cleanupWidget();
    await initWidget();
}

export async function initSettings() {
    syncWidgetToggle();
    syncIndividualWidgetToggles();
    syncWidgetEditMode();

    // Initialize specific widget settings

    initClockSettings();
}

/**
 * Handle checkbox toggle logic for widget enabling/disabling
 */
function syncWidgetToggle() {
    const widgetCheckbox = document.getElementById("widgets_enabled");
    if (!widgetCheckbox) return;

    let prevEnabled = null;

    subscribe("widgets", (widgets) => {
        const enabled = widgets?.enabled !== false;

        if (prevEnabled !== enabled) {
            if (prevEnabled !== null) {
                if (enabled) {
                    initWidget();
                } else {
                    cleanupWidget();
                }
            }
            prevEnabled = enabled;
        }

        widgetCheckbox.checked = enabled;

        const widgetSidebarElements = document.querySelectorAll(".widget_sidebar_element");
        widgetSidebarElements.forEach((el) => {
            el.style.display = enabled ? "" : "none";
        });

        if (enabled) {
            updateSidebarTabVisibility("time", widgets?.clock?.enabled !== false);
            updateSidebarTabVisibility("weather", widgets?.weather?.enabled !== false);
        }

        if (!enabled) {
            const activeTab = document.querySelector(".nav_item.active");
            if (activeTab) {
                const activeTabId = activeTab.getAttribute("data-tab");
                if (activeTabId === "time" || activeTabId === "weather") {
                    const widgetsTab = document.querySelector('.nav_item[data-tab="widgets"]');
                    if (widgetsTab) {
                        widgetsTab.dispatchEvent(new MouseEvent("mousedown"));
                    }
                }
            }
        }
    });

    widgetCheckbox.onchange = (e) => {
        saveSettings({ widgets: { ...getSettings().widgets, enabled: e.target.checked } });
    };
}

function updateSidebarTabVisibility(tabId, isVisible) {
    const tab = document.querySelector(`.nav_item[data-tab="${tabId}"]`);
    if (tab) {
        const globalEnabled = getSettings().widgets?.enabled !== false;
        tab.style.display = globalEnabled && isVisible ? "" : "none";

        if (!isVisible && tab.classList.contains("active")) {
            const widgetsTab = document.querySelector('.nav_item[data-tab="widgets"]');
            if (widgetsTab) widgetsTab.dispatchEvent(new MouseEvent("mousedown"));
        }
    }
}

function syncIndividualWidgetToggles() {
    const clockToggle = document.getElementById("widget_clock_enabled");
    if (clockToggle) {
        subscribe("widgets", (widgets) => {
            const enabled = widgets?.clock?.enabled !== false;
            clockToggle.checked = enabled;
            updateSidebarTabVisibility("time", enabled);
        });
        clockToggle.onchange = async (e) => {
            saveSettings({ widgets: { ...getSettings().widgets, clock: { ...getSettings().widgets?.clock, enabled: e.target.checked } } });
            await reloadWidgets();
        };
    }

    const dateToggle = document.getElementById("widget_date_enabled");
    if (dateToggle) {
        subscribe("widgets", (widgets) => {
            const enabled = widgets?.date?.enabled !== false;
            dateToggle.checked = enabled;
        });
        dateToggle.onchange = async (e) => {
            saveSettings({ widgets: { ...getSettings().widgets, date: { ...getSettings().widgets?.date, enabled: e.target.checked } } });
            await reloadWidgets();
        };
    }

    const lunarToggle = document.getElementById("widget_lunar_enabled");
    if (lunarToggle) {
        subscribe("widgets", (widgets) => {
            const enabled = widgets?.lunar?.enabled !== false;
            lunarToggle.checked = enabled;
        });
        lunarToggle.onchange = async (e) => {
            saveSettings({ widgets: { ...getSettings().widgets, lunar: { ...getSettings().widgets?.lunar, enabled: e.target.checked } } });
            await reloadWidgets();
        };
    }

    const weatherToggle = document.getElementById("widget_weather_enabled");
    if (weatherToggle) {
        subscribe("widgets", (widgets) => {
            const enabled = widgets?.weather?.enabled !== false;
            weatherToggle.checked = enabled;
            updateSidebarTabVisibility("weather", enabled);
        });
        weatherToggle.onchange = async (e) => {
            saveSettings({ widgets: { ...getSettings().widgets, weather: { ...getSettings().widgets?.weather, enabled: e.target.checked } } });
            await reloadWidgets();
        };
    }
}
