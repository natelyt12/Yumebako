---
trigger: always_on
description: "Core rules for developing Yumebako Startpage. Always follow them."
---

# Yumebako Startpage - Core Rules

These are the rules the agent must always keep in mind when coding a new feature for this project:

## 1. Settings Storage
- **Check before coding:** Whenever a new feature or module is requested, the very first step is to check `src/core/storageHandler.js`. If the feature needs to persist state (a setting), declare its default structure inside the `defaultSettings` object in that file before doing anything else.
- **Split storage:**
  - Settings about aesthetics, wallpaper and effects (e.g. `wavy`, `particles`, `wallpaperConfig`) are automatically stored under the `bako_wallpaper` key in LocalStorage.
  - Settings about the system, the startpage, widgets and utilities are automatically stored under the `bako_settings` key.
- **Never override stored data directly:** Always call `getSettings()` to read the latest state and use `saveSettings()` to update it. `saveSettings()` is designed to route the data into both keys above automatically.

## 2. General Rules
- **Continuous refactoring:** The user refactors the codebase very often. If a request makes any guidance in this rule file outdated, **proactively ask the user** whether this rule file should be updated instead of forcing a wrong implementation.
- **Locale sync (i18n):** Whenever a feature is ADDED or REMOVED:
  - Always check and update the locale files together (`public/locales/en.json`, `public/locales/vi.json`).
  - Adding a feature: declare every key for both languages and run `npm run sort-locales`.
  - Removing a feature: review and remove every related locale key, leaving no orphan keys behind.

## 3. Interface (UI/UX)
When working on the UI, follow the structure of the project, keep nested `div`s to an absolute minimum and strictly limit inline styles.
- **Core UI components:**
  - The project already ships a component library. For dropdowns, use `core/ui/dropdown.js`. The same applies to `notification`, `popup`, `slider` and `submenu`. **Read and study each of these JS files carefully** before using them, so you pass the right params.
- **Tooltip:** Write in-app tooltips using an element with the `.tooltip` class.
- **Button:**
  - Just use a plain `<button>` element, the system styles it automatically.
  - Button that contains an icon: use the `.icon_button` class.
  - Button that opens a menu/picker (dropdown): use the `.dropdown_button` class.
- **Checkbox/Toggle:** Do not use a bare checkbox input, use a label with the `.checkbox` class:
  ```html
  <label class="checkbox">
      <span>Option name</span>
      <input type="checkbox" />
      <div class="ts-track"><div class="ts-thumb"></div></div>
  </label>
  ```
- **Settings Layout:**
  - A settings block must be wrapped in a `.setting_section`.
  - Block title: use `<p class="setting_title">` (optional, not required).
  - Option content:
    - In the main menu (`#settings_content`): put it inside `<div class="setting_options">`.
    - In a submenu (`.submenu_body`): do **not** use `<div class="setting_options">`, place the options directly inside `.setting_section`. The CSS already handles the spacing through the selector `.submenu_body .setting_section:not(:has(.setting_title)) { gap: 8px; }`, keeping redundant `div` nesting to an absolute minimum.
  - Divider: use `<div class="section_divider"></div>`.
    - **Without text (empty):** `<div class="section_divider"></div>` renders a plain horizontal separator.
    - **With text/i18n:** `<div class="section_divider" data-i18n="...">Section title</div>` automatically draws a line on both sides of the label (`── TEXT ──`). It can be used flexibly in settings, popups, submenus or to group items inside a dropdown.

## 4. Localization (i18n)
- **Never hardcode text that is displayed in the UI**. Always use the `data-i18n="..."` attribute on HTML elements that contain text. For placeholders, use `data-i18n-placeholder="..."`.
- In JS code, use the `t("...")` function from `core/i18n.js` to resolve translated strings.
- If a new feature contains text, remind the user to add the translation keys to the locale JSON files.
