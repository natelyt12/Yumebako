import { getSettings } from "/src/core/storageHandler.js";
import { EventBus } from "/src/core/eventBus.js";
import { EVENTS } from "/src/core/events.js";

let currentLocaleStrings = {};

/**
 * Loads the current language JSON file based on settings and applies translations.
 * @param {string|null} [lang=null] - Optional language code to load. If null, use from settings.
 */
export async function initI18n(lang = null) {
    const selectedLang = lang || getSettings().language || "vi";
    try {
        // Assume locales folder is at the root level relative to index.html
        const response = await fetch(`locales/${selectedLang}.json`);
        if (response.ok) {
            currentLocaleStrings = await response.json();
        } else {
            console.warn(`Could not load locales/${lang}.json`);
        }
    } catch (e) {
        console.error("Failed to load language file:", e);
    }

    translateDOM();
    EventBus.emit(EVENTS.LANGUAGE_CHANGED, selectedLang, "i18n.js");
}

/**
 * Gets a translated string for a given key, with optional variable injection.
 * @param {string} key - The dot-notation key from the JSON (e.g. "settings.weather")
 * @param {Object} variables - Dictionary of variables to replace (e.g. { size: 5 }) for {{size}}
 * @returns {string} The translated string or the original key if missing.
 */
export function t(key, variables = {}) {
    if (!key) return "";

    let result = currentLocaleStrings[key];
    
    if (result === undefined) {
        const keys = key.split('.');
        result = currentLocaleStrings;
        for (const k of keys) {
            if (!result || result[k] === undefined) return key;
            result = result[k];
        }
    }

    if (result === undefined) return key;

    // Replace {{variables}}
    if (typeof result === 'string' && Object.keys(variables).length > 0) {
        for (const [varName, value] of Object.entries(variables)) {
            result = result.replace(new RegExp(`{{${varName}}}`, 'g'), value);
        }
    }

    return result;
}

/**
 * Translates all DOM elements containing exactly the 'data-i18n' attribute.
 * @param {HTMLElement|Document} container - The container to search within, defaults to document.
 */
export function translateDOM(container = document) {
    const isDebug = getSettings().debugI18n;
    if (isDebug) return; // Bỏ qua toàn bộ quá trình dịch nếu đang bật debug

    const elements = container.querySelectorAll('[data-i18n], [data-i18n-placeholder], [data-i18n-html], [data-i18n-title]');
    elements.forEach(el => {
        // Handle innerText
        if (el.hasAttribute('data-i18n')) {
            el.innerText = t(el.getAttribute('data-i18n'));
        }

        // Handle innerHTML with optional link interpolation
        if (el.hasAttribute('data-i18n-html')) {
            let htmlStr = t(el.getAttribute('data-i18n-html'));
            const linkHref = el.getAttribute('data-i18n-link');
            if (linkHref) {
                htmlStr = htmlStr.replace(/\[([^\]]+)\]/g, `<a href="${linkHref}" target="_blank" style="text-decoration: underline; opacity: 0.9;">$1</a>`);
            }
            el.innerHTML = htmlStr;
        }

        // Handle placeholder
        if (el.hasAttribute('data-i18n-placeholder')) {
            el.placeholder = t(el.getAttribute('data-i18n-placeholder'));
        }

        // Handle title tooltip
        if (el.hasAttribute('data-i18n-title')) {
            el.title = t(el.getAttribute('data-i18n-title'));
        }
    });
}
