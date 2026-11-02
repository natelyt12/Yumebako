import dayjs from "dayjs";

/**
 * Get current time components.
 * @param {string} type - Time format: "24h" or "12h".
 * @param {boolean} addZero - Whether to prefix single-digit hours with zero.
 * @param {boolean} showAmPm - Whether to show AM/PM.
 * @returns {{ hours: string, minutes: string, seconds: string, ampm: string }}
 */
export function initClock(type = "24h", addZero = true, showAmPm = true) {
    const now = dayjs();
    
    let hourFormat;
    if (type === "12h") {
        hourFormat = addZero ? "hh" : "h";
    } else {
        hourFormat = addZero ? "HH" : "H";
    }

    const hours = now.format(hourFormat);
    const minutes = now.format("mm");
    const seconds = now.format("ss");
    
    let ampm = "";
    if (type === "12h" && showAmPm) {
        ampm = now.format(" A");
    }

    return { hours, minutes, seconds, ampm };
}

/**
 * Get current date components.
 * @returns {{ day: number, month: number, year: number, dayOfWeek: number }}
 */
export function initDate() {
    const today = dayjs();
    return {
        day: today.date(),
        month: today.month() + 1,
        year: today.year(),
        dayOfWeek: today.day()
    };
}

/**
 * Helper to get formatted clock based on settings object.
 * @param {Object} settings - The settings object from storage.
 * @returns {Object}
 */
export function getFormattedClock(settings) {
    const config = settings.widgets?.clock?.config || {};
    const type = config.format || "24h";
    const addZero = config.add_zero_hour !== false;
    const showSeconds = config.show_seconds === true;
    const showAmPm = config.show_ampm !== false;
    return { ...initClock(type, addZero, showAmPm), showSeconds };
}

