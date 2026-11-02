/**
 * Centralized Event Registry for Yumebako
 * All custom events should be defined here to prevent "ghost events" and typos.
 */
export const EVENTS = {
    // Weather Widget
    WEATHER_UPDATED: "weather-updated",
    WEATHER_ERROR: "weather-error",

    // Clock Widget & Time
    TIME_UPDATED: "time-updated",

    // System & Settings
    LANGUAGE_CHANGED: "language-changed",
    DROPDOWN_CHANGE: "dropdownChange", // Legacy camelCase kept for compatibility, fired on UI settings

    // Lifecycle
    ONLOAD_ANIMATION_COMPLETE: "onload-animation-complete",
    POPUP_BEFORE_CLOSE: "popupBeforeClose"
};
