import dayjs from "dayjs";
import { getFormattedClock, initDate } from "/src/core/time.js";
import { getSettings, saveSettings } from "/src/core/storageHandler.js";
import { EventBus } from "/src/core/eventBus.js";
import { EVENTS } from "/src/core/events.js";
import { t, translateDOM } from "/src/core/i18n.js";
import { toLunar, getLunarYearStem, getLunarYearBranch, stringifyLunar } from "/src/api/lunar_core.js";
import { createSlider, showNotification } from "/src/core/ui.js";
import { resolveGoogleFont } from "/src/core/font.js";

let clockTimeout = null;
let listenersBound = false;
let currentFont = null;

let currentFontUrl = null;

function applyClockFont(fontName, fontUrl, fontWeight) {
    const clockEl = document.getElementById("widget-clock");
    if (!clockEl) return;

    if (!fontName) {
        clockEl.style.fontFamily = "";
        clockEl.style.removeProperty("--clock-font-weight");
        currentFont = "";
        currentFontUrl = "";
        return;
    }

    const formattedFontName = fontName.trim().split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');

    if (currentFont !== formattedFontName || currentFontUrl !== fontUrl) {
        currentFont = formattedFontName;
        currentFontUrl = fontUrl;
        const fontId = "clock-google-font-link";
        let link = document.getElementById(fontId);
        if (!link) {
            link = document.createElement("link");
            link.id = fontId;
            link.rel = "stylesheet";
            document.head.appendChild(link);
        }
        link.href = fontUrl || `https://fonts.googleapis.com/css2?family=${formattedFontName.replace(/\s+/g, '+')}&display=swap`;
    }

    clockEl.style.fontFamily = `"${formattedFontName}", sans-serif`;
    clockEl.style.setProperty("--clock-font-weight", fontWeight || 300);
}

/* ─── Widget Clock Updates ───────────────────────────── */

export function startClockUpdates() {
    if (clockTimeout) {
        clearTimeout(clockTimeout);
    }

    const updateClock = () => {
        const hourEl = document.getElementById("clock-widget-hour");
        const minuteEl = document.getElementById("clock-widget-minute");
        const timeEl = document.getElementById("clock-widget-time");
        const secondsContainer = document.getElementById("clock-widget-seconds-container");
        const secondsFill = document.getElementById("clock-widget-seconds-fill");
        const ampmEl = document.getElementById("clock-widget-ampm");
        const dateEl = document.getElementById("clock-widget-date");
        const lunarEl = document.getElementById("clock-widget-lunar");

        if (!timeEl && !dateEl) return;

        const settings = getSettings();
        const clock = getFormattedClock(settings);
        const date = initDate();
        const lang = settings.language || "vi";
        const intlLang = lang === "jp" ? "ja" : lang;

        applyClockFont(
            settings.widgets?.clock?.config?.font,
            settings.widgets?.clock?.config?.font_url,
            settings.widgets?.clock?.config?.font_weight
        );

        /* ── Digital time ── */
        if (hourEl && minuteEl) {
            hourEl.textContent = clock.hours;
            minuteEl.textContent = clock.minutes;
        } else if (timeEl) {
            timeEl.textContent = `${clock.hours}:${clock.minutes}`;
        }

        if (secondsContainer && secondsFill) {
            if (clock.showSeconds) {
                secondsContainer.style.display = "";
                const sec = parseInt(clock.seconds, 10);
                if (sec === 0) {
                    secondsFill.style.transition = "none";
                    secondsFill.style.width = "0%";
                    // Force a reflow so the 0% is applied immediately
                    void secondsFill.offsetWidth;
                } else {
                    secondsFill.style.transition = "width 1s linear";
                    secondsFill.style.width = `${(sec / 59) * 100}%`;
                }
            } else {
                secondsContainer.style.display = "none";
            }
        }

        if (ampmEl) {
            if (clock.ampm) {
                ampmEl.style.display = "";
                ampmEl.textContent = clock.ampm.trim();
            } else {
                ampmEl.style.display = "none";
            }
        }

        if (dateEl) {
            const dateObj = dayjs().toDate();
            dateEl.textContent = new Intl.DateTimeFormat(intlLang, {
                weekday: 'long',
                year: 'numeric',
                month: 'long',
                day: 'numeric'
            }).format(dateObj);
        }

        if (lunarEl) {
            try {
                const d = parseInt(date.day, 10);
                const m = parseInt(date.month, 10);
                const y = parseInt(date.year, 10);
                const tz = -(dayjs().toDate().getTimezoneOffset() / 60); // Múi giờ tự động theo máy tính

                const lunar = toLunar({ day: d, month: m, year: y, tz });

                let lunarLang = "en";
                if (lang === "vi") lunarLang = "vi";
                if (lang.startsWith("zh") || lang === "jp" || lang === "ja") lunarLang = "zh";

                // Get Can Chi for the year
                const stem = getLunarYearStem(lunar.year, lunarLang);
                const branch = getLunarYearBranch(lunar.year, lunarLang);

                if (lang === "vi") {
                    const leapStr = lunar.leap ? " (Nhuận)" : "";
                    const yearName = `${stem} ${branch}`;
                    lunarEl.textContent = `Âm lịch: ${lunar.day} tháng ${lunar.month}${leapStr} năm ${yearName}`;
                } else if (lang.startsWith("zh")) {
                    const leapStr = lunar.leap ? "閏" : "";
                    const yearName = `${stem}${branch}`;
                    lunarEl.textContent = `農曆: ${yearName}年${leapStr}${lunar.month}月${lunar.day}日`;
                } else if (lang === "jp" || lang === "ja") {
                    const leapStr = lunar.leap ? "閏" : "";
                    const yearName = `${stem}${branch}`;
                    lunarEl.textContent = `旧暦: ${yearName}年 ${leapStr}${lunar.month}月${lunar.day}日`;
                } else {
                    const leapStr = lunar.leap ? " (Leap)" : "";
                    lunarEl.textContent = `Lunar: ${lunar.month}/${lunar.day}${leapStr} - Year of ${branch}`;
                }
            } catch (e) {
                console.error("Lunar error:", e);
                lunarEl.textContent = "";
            }
        }
    };

    const scheduleNextUpdate = () => {
        updateClock();
        const delay = 1000 - new Date().getMilliseconds();
        clockTimeout = setTimeout(scheduleNextUpdate, delay);
    };

    scheduleNextUpdate();

    if (!listenersBound) {
        listenersBound = true;
        EventBus.on(EVENTS.TIME_UPDATED, updateClock);
        EventBus.on(EVENTS.LANGUAGE_CHANGED, updateClock);
    }
}

export function stopClockUpdates() {
    if (clockTimeout) {
        clearTimeout(clockTimeout);
        clockTimeout = null;
    }
}

export function initClockSettings() {
    const addZeroHourbox = document.getElementById("add_zero_hour");
    if (addZeroHourbox) {
        addZeroHourbox.checked = getSettings().widgets?.clock?.config?.add_zero_hour !== false;
        addZeroHourbox.addEventListener("change", (e) => {
            saveSettings({
                widgets: {
                    ...getSettings().widgets,
                    clock: {
                        ...getSettings().widgets?.clock,
                        config: {
                            ...getSettings().widgets?.clock?.config,
                            add_zero_hour: e.target.checked
                        }
                    }
                }
            });
            EventBus.emit(EVENTS.TIME_UPDATED, null, "clock.js");
        });
    }

    const showSecondsbox = document.getElementById("show_seconds");
    if (showSecondsbox) {
        showSecondsbox.checked = getSettings().widgets?.clock?.config?.show_seconds === true;
        showSecondsbox.addEventListener("change", (e) => {
            saveSettings({
                widgets: {
                    ...getSettings().widgets,
                    clock: {
                        ...getSettings().widgets?.clock,
                        config: {
                            ...getSettings().widgets?.clock?.config,
                            show_seconds: e.target.checked
                        }
                    }
                }
            });
            EventBus.emit(EVENTS.TIME_UPDATED, null, "clock.js");
        });
    }

    const clock12hBox = document.getElementById("clock_format_12h");
    if (clock12hBox) {
        clock12hBox.checked = getSettings().widgets?.clock?.config?.format === "12h";
        clock12hBox.addEventListener("change", (e) => {
            const format = e.target.checked ? "12h" : "24h";
            saveSettings({
                widgets: {
                    ...getSettings().widgets,
                    clock: {
                        ...getSettings().widgets?.clock,
                        config: {
                            ...getSettings().widgets?.clock?.config,
                            format: format
                        }
                    }
                }
            });
            EventBus.emit(EVENTS.TIME_UPDATED, null, "clock.js");
        });
    }

    const showAmPmBox = document.getElementById("show_ampm");
    if (showAmPmBox) {
        showAmPmBox.checked = getSettings().widgets?.clock?.config?.show_ampm !== false;
        showAmPmBox.addEventListener("change", (e) => {
            saveSettings({
                widgets: {
                    ...getSettings().widgets,
                    clock: {
                        ...getSettings().widgets?.clock,
                        config: {
                            ...getSettings().widgets?.clock?.config,
                            show_ampm: e.target.checked
                        }
                    }
                }
            });
            EventBus.emit(EVENTS.TIME_UPDATED, null, "clock.js");
        });
    }

    const clockFontInput = document.getElementById("clock_google_font");
    const clockApplyFontBtn = document.getElementById("clock_apply_font");
    const weightSliderContainer = document.getElementById("clock_font_weight_slider_container");
    let weightSliderObj = null;

    if (clockFontInput && clockApplyFontBtn) {
        clockFontInput.value = getSettings().widgets?.clock?.config?.font || "";

        const renderWeightSlider = (minWeight, maxWeight, currentWeight) => {
            if (!weightSliderContainer) return;
            weightSliderContainer.innerHTML = "";
            weightSliderContainer.style.display = "block";

            weightSliderObj = createSlider({
                label: t("sp.time.font_weight") || "Font Weight",
                dataI18n: "sp.time.font_weight",
                min: minWeight,
                max: maxWeight,
                step: 100,
                value: currentWeight || 300,
                defaultValue: 300,
                onChange: (val) => {
                    saveSettings({
                        widgets: {
                            ...getSettings().widgets,
                            clock: {
                                ...getSettings().widgets?.clock,
                                config: {
                                    ...getSettings().widgets?.clock?.config,
                                    font_weight: val
                                }
                            }
                        }
                    });
                    EventBus.emit(EVENTS.TIME_UPDATED, null, "clock.js");
                }
            });
            weightSliderContainer.appendChild(weightSliderObj);
            translateDOM(weightSliderContainer);
        };

        const initSliderFromSettings = async () => {
            const cfg = getSettings().widgets?.clock?.config || {};
            const fontName = cfg.font;
            const currentWeight = cfg.font_weight || 300;
            const minW = cfg.font_weight_min;
            const maxW = cfg.font_weight_max;

            if (!fontName) {
                // Default Lexend font
                renderWeightSlider(100, 900, currentWeight);
            } else if (minW !== undefined && maxW !== undefined && minW !== maxW) {
                renderWeightSlider(minW, maxW, currentWeight);
            } else {
                if (weightSliderContainer) weightSliderContainer.style.display = "none";
            }
        };

        const saveFont = async () => {
            const rawValue = clockFontInput.value.trim();

            const saveAndEmit = (name, url, minW, maxW) => {
                saveSettings({
                    widgets: {
                        ...getSettings().widgets,
                        clock: {
                            ...getSettings().widgets?.clock,
                            config: {
                                ...getSettings().widgets?.clock?.config,
                                font: name,
                                font_url: url,
                                font_weight_min: minW,
                                font_weight_max: maxW
                            }
                        }
                    }
                });
                if (minW !== maxW && minW !== undefined) {
                    renderWeightSlider(minW, maxW, getSettings().widgets?.clock?.config?.font_weight || 300);
                } else {
                    if (weightSliderContainer) weightSliderContainer.style.display = "none";
                }
                EventBus.emit(EVENTS.TIME_UPDATED, null, "clock.js");
            };

            if (rawValue === "") {
                saveAndEmit("", null, 100, 900);
                return;
            }

            try {
                const parsed = await resolveGoogleFont(rawValue);
                if (!parsed.url) clockFontInput.value = parsed.name;
                saveAndEmit(parsed.name, parsed.url, parsed.min, parsed.max);
            } catch (err) {
                const fallbackName = rawValue.trim().split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
                showNotification(t("sp.time.font_not_found").replace("{font}", fallbackName), "error");
                clockFontInput.value = "";
                saveAndEmit("", null, 100, 900);
            }
        };

        clockApplyFontBtn.addEventListener("click", saveFont);
        clockFontInput.addEventListener("keydown", (e) => {
            if (e.key === "Enter") saveFont();
        });

        initSliderFromSettings();
    }
}
