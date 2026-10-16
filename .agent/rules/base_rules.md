---
trigger: always_on
description: "Core rules for developing Yumebako Startpage. Always follow them."
---

# Yumebako Startpage - Core Rules

These are the rules the agent must always keep in mind when coding a new feature for this project:

## 1. Settings Storage (`src/core/storageHandler.js`)
- **Check before coding:** Whenever a new feature or module is requested, the very first step is to check `src/core/storageHandler.js`. If the feature needs to persist state (a setting), declare its default structure (and JSDoc typedef) inside `defaultSettings` in that file before doing anything else.
- **Split storage (`WALLPAPER_KEYS`):**
  - Aesthetics, wallpaper, and effect settings (`wallpaperConfig`, `wallpaperSwitcher`, `wallpaperPosition`, `wavy`, `particles`, `onload`, `wallpapers`) are automatically routed to `bako_wallpaper` in LocalStorage.
  - System, startpage, widget, and utility settings are automatically routed to `bako_settings`.
- **Never override stored data directly:** Always call `getSettings()` to read the latest merged state, `saveSettings(partial)` to update it, and `subscribe(key, callback)` to reactively listen to changes on a top-level key.

## 2. General Rules & Workflow
- **Output & Workflow:**
  - Do **NOT** create or update walkthrough artifacts (`walkthrough.md`).
  - Do **NOT** run `npm run build` after changes unless explicitly requested by the user or checking syntax error.
  - Keep responses concise and strictly limited. Summarize what changed briefly. Only communicate in normal length when discussion or user input is actually required.
- **Continuous refactoring:** The user refactors the codebase very often. If a request makes any guidance in this rule file outdated, **proactively ask the user** whether this rule file should be updated instead of forcing a wrong implementation.
- **Locale sync (i18n):** Whenever a feature is ADDED or REMOVED:
  - Always check and update the locale files together (`public/locales/en.json`, `public/locales/vi.json`).
  - Adding a feature: declare every key for both languages and run `npm run sort-locales`.
  - Removing a feature: review and remove every related locale key, leaving no orphan keys behind.

## 3. Interface (UI/UX)
When working on the UI, follow the structure of the project, keep nested `div`s to an absolute minimum, and use helper classes from `src/styles/utilities.css` (`.flex_row`, `.flex_col`, `.flex_1`, `.gap_4`–`.gap_12`, `.mt_4`–`.mt_12`, `.mb_8`, `.w_full`, `.text_center`, `.hidden`) instead of inline styles.

- **Icons (`src/core/icon.js`):**
  - Icons use `@phosphor-icons/core` raw SVGs registered in `Icons` (`src/core/icon.js`).
  - In HTML, place `<i data-icon="iconName"></i>` and call `renderIcons(rootNode)` after injecting dynamic DOM.
- **Core UI Components (`src/core/ui.js` barrel):**
  - **Read and study each component file in `src/core/ui/` before using it** so you pass the right parameters:
  - **Button (`core/ui/button.js`, `styles/buttons.css`):** Every bar-style button (settings + app UI) uses the single `.btn` component with a three-zone slot layout. Zone 3 is always auto-rendered by `initButtons(rootNode)` from `data-action` — never hand-write chevrons or switch tracks:
    - Zone 1 (optional): leading icon `<i data-icon="...">`.
    - Zone 2: `<div class="btn_body">` holding `.btn_title` and an optional `.btn_desc` (or a plain `<span>` for a single-line label without description).
    - Zone 3 (auto-rendered by `core/ui/button.js`):

      | `data-action` | Zone 3 | Purpose |
      | :--- | :--- | :--- |
      | *(none)* | – | Plain action (Save, Reset, Export, Close) |
      | `submenu` | right chevron (`.btn_action_icon`) | Opens a level-2 submenu panel |
      | `dropdown` | down chevron (`.sbsctsvg`) | Opens a dropdown — see `styles/dropdown.css` |
      | `toggle` | switch track (`.ts-track`) | Binary on/off — use `<label class="btn" data-action="toggle">` |

    - Colour variants: default glass, or `data-variant="danger"` for destructive actions.
    - Can also be built in JS via `createButton({ id, icon, title, desc, action, variant, checked, onClick })`.
    - Calling `initButtons(rootNode)` also runs `initCustomSelects(rootNode)` and `syncDropdownSelection(rootNode)`.
    - Legacy classes (`.btn_liked`, `.icon_button`, `.submenu_button`, `.btn_warning`, `.danger_btn`) were removed — do not use them. Icon-only controls (slider steppers, floating action buttons, nav items, transparent tabs) are intentionally outside this spec.
  - **Toggle:** A `.btn` with `data-action="toggle"`:
    ```html
    <label class="btn" data-action="toggle">
        <span data-i18n="...">Option name</span>
        <input type="checkbox" />
    </label>
    ```
  - **Dropdown (`core/ui/dropdown.js`, `styles/dropdown.css`):**
    - Use `<select class="native_select">` (or `select[data-custom]`); `initButtons(rootNode)` / `initCustomSelects(rootNode)` automatically upgrades it into `.dropdown_wrapper > button.btn[data-action="dropdown"] + .dropdown` while keeping the hidden `<select>` synced.
    - For custom markup or action menus (items without `data-value`), follow the `.dropdown_wrapper` contract in `styles/dropdown.css`. Use `setDropdownValue(el, value)` and listen to `dropdownChange` / `dropdownAction`.
  - **Slider (`core/ui/slider.js`, `styles/sliders.css`):** Use `createSlider({ label, dataI18n, min, max, step, value, defaultValue, unit, dataI18nUnit, disabled, onChange })` for Material 3 Expressive wavy sliders.
  - **Submenu (`core/ui/submenu.js`, `styles/submenus.css`):** Use `openSidebarSubmenu(title, contentNode, { width, isFullScreen, canPreview, isDirty, onCancel, onBeforeClose })`, `closeSidebarSubmenu(force)`, and `setSubmenuDirty(isDirty)`. `openSidebarSubmenu` automatically runs `translateDOM`, `renderIcons`, and `initButtons`.
  - **Popup & Confirm (`core/ui/popup.js`, `styles/popups.css`):** Use `openCustomPopup(title, contentNode, width, options)` and Promise-based `showConfirm(msg, { title, okText, cancelText, isDanger, width, anchor, placement, offset })`. Pass `anchor` (element/button or event) to position contextually near the trigger.
  - **Notification (`core/ui/notification.js`):** Use `showNotification(message, type)` (`"info" | "success" | "error" | "warning"`).
- **Tooltip:** Write in-app descriptions/notes using `<span class="tooltip">`. For sidebar `.nav_item` buttons, use `data-tooltip-i18n="..."` (driven by the singleton `#nav_floating_tooltip`).
- **Settings Layout (`settings/settings_layout.css`, `settings/settings_nav.css`):**
  - **Flat Linear Layout:** Options, titles, and dividers sit directly inside `.tab_content` (or `.setting_section` inside submenu templates) in a flat vertical sequence. Avoid redundant wrapper `div`s.
  - **Block title:** Use `<p class="setting_title">` (automatically handles top spacing rhythm and renders a trailing gradient line; supports an optional `<i data-icon="...">`).
  - **Divider:** Use `<div class="section_divider"></div>` as a horizontal separator line.

## 4. Localization (i18n) (`src/core/i18n.js`)
- **Never hardcode text that is displayed in the UI.**
- Supported HTML attributes handled by `translateDOM(container)`:
  - `data-i18n="..."` for text content.
  - `data-i18n-placeholder="..."` for input placeholders.
  - `data-i18n-title="..."` for native `title` tooltips.
  - `data-i18n-html="..."` (with optional `data-i18n-link="..."` to convert `[text]` into `<a>` links).
- In JS code, use `t(key, variables)` from `core/i18n.js` (supports `{{variable}}` replacement).
