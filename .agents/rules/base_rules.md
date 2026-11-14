---
trigger: always_on
description: "Core rules for developing Yumebako Startpage. Always follow them."
---

# Yumebako Startpage - Core Rules

These are the rules the agent must always keep in mind when coding a new feature for this project:

## 1. Settings Storage (`src/core/storageHandler.js`)

- **Check before coding:** Whenever a new feature or module is requested, the very first step is to check `src/core/storageHandler.js`. If the feature needs to persist state (a setting), declare its default structure (and JSDoc typedef) inside `defaultSettings` in that file before doing anything else.
- **Split storage (`WALLPAPER_KEYS`):**
  - Wallpaper, aesthetic, and effect keys in `WALLPAPER_KEYS` are automatically routed to `bako_wallpaper` in LocalStorage; all other settings route to `bako_settings`.
- **Never override stored data directly:** Always call `getSettings()` to read the latest merged state, `saveSettings(partial)` to update it, and `subscribe(key, callback)` to reactively listen to changes on a top-level key.

## 2. General Rules & Workflow

- **Verification output:** When running `npm run build` or `pnpm test`, keep output concise (report pass/fail summary, or only the first few error lines if failing).
- **Continuous refactoring:** The user refactors the codebase very often. If a request makes any guidance in this rule file outdated, **proactively ask the user** whether this rule file should be updated instead of forcing a wrong implementation.
- **UI work:** Before changing markup, styles, or user-facing interactions, read and follow `.agents/rules/ui_rules.md`. Keep that file aligned when shared UI conventions change.
- **Locale sync (i18n):** Whenever a feature is ADDED or REMOVED:
  - Always check and update the locale files together (`public/locales/en.json`, `public/locales/vi.json`).
  - Adding a feature: declare every key for both languages and run `npm run sort-locales`.
  - Removing a feature: review and remove every related locale key, leaving no orphan keys behind.
- **Comments & JSDoc Standards:**
  - **Language rules:**
    - **Vietnamese:** Use Vietnamese exclusively for comments explaining configurable variables, customization options, tuning parameters, and settings values (giải thích ý nghĩa biến cấu hình, ngưỡng giá trị cho người dùng/developer dễ tùy chỉnh).
    - **English:** All other technical comments (architecture, algorithms, logic flow, bug fixes, edge-case handling) and JSDoc tags must be written in English.
  - **JSDoc scope (where to document):**
    - **Required:** Exported functions/APIs, class definitions & public methods, core infrastructure services (`src/core/`), storage schemas & typedefs (`@typedef`), data pipelines, and custom event bus payloads. Document types with `@param`, `@returns`, and `@type` for solid IDE autocompletion.
    - **Skip / keep lightweight:** Trivial internal helper arrows, obvious DOM click listeners, and small self-explanatory local callbacks to avoid documentation bloat.
  - **Deprecated code & clean deletion:**
    - When a feature, option, or function is deprecated or replaced: delete the code completely and cleanly.
    - Do **NOT** leave commented-out code blocks or orphan notes like `// deprecated`, `// was removed`, `// old logic`. Git history already tracks past implementations.

## 3. Directory Responsibilities at a Glance
- **`src/core/`**: Foundational, headless services. Do not put domain-specific UI (like widgets or wallpaper selectors) here. `storageHandler.js` is the central state authority.
- **`src/core/ui/`**: Reusable primitive components (buttons, dialogs, sliders). Follow conventions in `ui_rules.md`.
- **`src/wallpaper/backend/`**: Wallpaper data, providers, renderer, and effect engines. Keep implementation behavior here; do not put editor markup/styles here.
- **`src/wallpaper/frontend/`**: Wallpaper Switcher and customization UI. Each Customize panel owns an `index.js`, `template.html`, and `style.css`; shared layout belongs in `frontend/customize/shared.css`.
- **`src/wallpaper/`**: Public facade joining the backend and frontend. Shared infrastructure such as `src/core/storageHandler.js` and `src/core/db.js` stays in `src/core/`.
- **`src/widgets/`**: Startpage widgets. Each widget is self-contained with its own JS, HTML template, CSS, and settings markup.
- **`src/settings/`**: Manages app-wide settings modal interactions, tab navigation, and system diagnostics/maintenance. Wallpaper editor panels and their templates/styles belong under `src/wallpaper/`; do not import wallpaper UI modules from Settings.
- **`public/locales/`**: Must remain strictly synchronized between `en.json` and `vi.json`.
