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
  - Do **NOT** run tests (`pnpm test`) automatically after changes; ONLY run tests when the user explicitly requests to commit or run tests.
- **Continuous refactoring:** The user refactors the codebase very often. If a request makes any guidance in this rule file outdated, **proactively ask the user** whether this rule file should be updated instead of forcing a wrong implementation.
- **UI work:** Before changing markup, styles, or user-facing interactions, read and follow `.agent/rules/ui_rules.md`. Keep that file aligned when shared UI conventions change.
- **Locale sync (i18n):** Whenever a feature is ADDED or REMOVED:
  - Always check and update the locale files together (`public/locales/en.json`, `public/locales/vi.json`).
  - Adding a feature: declare every key for both languages and run `npm run sort-locales`.
  - Removing a feature: review and remove every related locale key, leaving no orphan keys behind.

## 3. Project Structure & Directory Overview

```text
yumebako/
├── .agent/rules/         # Agent guidelines (base_rules, ui_rules, wallpaper_architecture, commit_rules)
├── public/               # Static assets & localization files (locales/en.json, locales/vi.json)
├── scripts/              # Build & localization sync scripts (sort_locales, sync_locales)
├── tests/                # Test suites (unit tests, carousel performance & jitter tests)
├── temp/                 # Temporary migration notes and implementation plans
├── index.html            # Extension root HTML document
├── manifest.json         # Chrome extension Manifest V3 definition
├── vite.config.js        # Vite + CRXJS plugin configuration
└── src/
    ├── main.js           # App entry point: initializes core services, wallpaper, widgets, and settings
    ├── style.css         # Global stylesheet entry (imports styles/ and core/ui/)
    ├── api/              # Third-party integrations & helpers (lunar_core, weather)
    ├── core/             # Fundamental application infrastructure
    │   ├── storageHandler.js # Single source of truth for settings, dual-storage routing & reactivity
    │   ├── db.js         # IndexedDB helper for heavy wallpaper cache and offline blobs
    │   ├── eventBus.js   # Central pub/sub event bus & events.js definitions
    │   ├── i18n.js       # Internationalization loader and translator
    │   ├── launcher.js   # Coordinates startup and service lifecycle
    │   ├── font.js, icon.js, time.js # System helpers (dynamic fonts, Phosphor icons, clock timing)
    │   ├── ui.js & ui/   # Shared UI primitive components (button, dialog, dropdown, notification, slider, submenu)
    │   └── utils/        # Generic utilities shared across subsystems
    ├── settings/         # App-wide settings: appearance, widgets, time/weather, info/debug
    │   ├── settingHandler.js # Settings modal lifecycle and non-wallpaper settings panels
    │   ├── settings.html # Settings navigation and app-wide settings tabs
    │   └── system/       # System utilities, IDB diagnostics, backup/export
    ├── styles/           # Base design tokens, typography, CSS layers (@layer), utilities
    ├── wallpaper/        # Autonomous wallpaper subsystem with separated processing/UI layers
    │   ├── index.js      # Public facade for the wallpaper subsystem
    │   ├── backend/      # Data, sources, rendering pipeline, and effect engines
    │   │   ├── data/     # DataControl, network errors, and media garbage collection
    │   │   ├── effects/  # motion/, onload/, particles/ engines and registries
    │   │   ├── rendering/ # Renderer, filters, and position application
    │   │   └── sources/  # Wallpaper providers and their API adapters
    │   └── frontend/     # Switcher UI and all wallpaper customization panels
    │       ├── switcher/ # Switcher coordinator, carousel, bar, manage, and sidebar
    │       │   ├── switcher.css # Shell and submenu host layout
    │       │   ├── customize.css # Customize panel layout and tabs
    │       │   ├── meta.css # Morphing wallpaper metadata card
    │       │   ├── bar/     # Top bar component & bar.css (source tabs, counters, actions)
    │       ├── customize/ # Panel registry, shared layout, and individual panels
    │       │   └── panels/ # arrange/, filters/, particles/, onload/, wavy/
    │       ├── index.js  # Public frontend entry and wallpaper stylesheet
    │       └── wallpaper.css # Desktop wallpaper layer presentation
    └── widgets/          # Desktop widgets on the startpage
        ├── handler.js    # Widget lifecycle and positioning manager
        ├── editmode.js   # Widget edit/drag-and-drop layout manager
        ├── clock/        # Clock widget logic, template, and settings
        └── weather/      # Weather widget logic, template, and settings
```

### Directory Responsibilities at a Glance:
- **`src/core/`**: Foundational, headless services. Do not put domain-specific UI (like widgets or wallpaper selectors) here. `storageHandler.js` is the central state authority.
- **`src/core/ui/`**: Reusable primitive components (buttons, dialogs, sliders). Follow conventions in `ui_rules.md`.
- **`src/wallpaper/backend/`**: Wallpaper data, providers, renderer, and effect engines. Keep implementation behavior here; do not put editor markup/styles here.
- **`src/wallpaper/frontend/`**: Wallpaper Switcher and customization UI. Each Customize panel owns an `index.js`, `template.html`, and `style.css`; shared layout belongs in `frontend/customize/shared.css`.
- **`src/wallpaper/`**: Public facade joining the backend and frontend. Shared infrastructure such as `src/core/storageHandler.js` and `src/core/db.js` stays in `src/core/`.
- **`src/widgets/`**: Startpage widgets. Each widget is self-contained with its own JS, HTML template, CSS, and settings markup.
- **`src/settings/`**: Manages app-wide settings modal interactions, tab navigation, and system diagnostics/maintenance. Wallpaper editor panels and their templates/styles belong under `src/wallpaper/`; do not import wallpaper UI modules from Settings.
- **`public/locales/`**: Must remain strictly synchronized between `en.json` and `vi.json`.

### Wallpaper Customize Panel Convention
- Open wallpaper customization from the Wallpaper Switcher, not the Settings modal.
- Keep each submenu's controller, HTML template, and CSS under `wallpaper/frontend/customize/panels/<panel>/`. Shared presentation belongs in `frontend/customize/shared.css` only when multiple panels genuinely share it.
- Keep data, source, rendering, and effect behavior under `wallpaper/backend/`; panel components call those APIs without relocating or duplicating engine logic.
- Settings may retain app-wide wallpaper backup/export and source attribution, but it must not own wallpaper editor markup, initialization hooks, or editor styles.
