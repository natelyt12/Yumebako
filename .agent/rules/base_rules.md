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
- **UI work:** Before changing markup, styles, or user-facing interactions, read and follow `.agent/rules/ui_rules.md`. Keep that file aligned when shared UI conventions change.
- **Locale sync (i18n):** Whenever a feature is ADDED or REMOVED:
  - Always check and update the locale files together (`public/locales/en.json`, `public/locales/vi.json`).
  - Adding a feature: declare every key for both languages and run `npm run sort-locales`.
  - Removing a feature: review and remove every related locale key, leaving no orphan keys behind.
