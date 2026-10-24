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
    │   ├── ui.js & ui/   # Shared UI primitive components (button, dialog, dropdown, notification, popover, slider, submenu)
    │   └── utils/        # Generic utilities (e.g. thumbnailGenerator)
    ├── settings/         # Settings modal, tab navigation, and settings panels
    │   ├── settingHandler.js # Manages settings modal state, tabs, and panel rendering
    │   └── system/       # System & debug utilities (IDB tracker, debug logs, app reset/export)
    ├── styles/           # Base design tokens, typography, CSS layers (@layer), utilities
    ├── wallpaper/        # Core wallpaper engine & visual effects
    │   ├── core/         # Engine core (WallpaperSwitcher, renderer, DataControl, mediaGC, filters)
    │   ├── motion/       # Dynamic visual shaders/animations (BaseMotion, MotionEngine, noise, wavy)
    │   ├── particles/    # Particle systems (rain, snow, fireflies, dust, static cinematic/vignette)
    │   ├── sources/      # Wallpaper providers (Wallhaven, Unsplash, Bing, Picre, Collection)
    │   └── ui/           # Wallpaper UI (SwitcherBar, 3D CarouselEngine, Source Settings popovers)
    └── widgets/          # Desktop widgets on the startpage
        ├── handler.js    # Widget lifecycle and positioning manager
        ├── editmode.js   # Widget edit/drag-and-drop layout manager
        ├── clock/        # Clock widget logic, template, and settings
        └── weather/      # Weather widget logic, template, and settings
```

### Directory Responsibilities at a Glance:
- **`src/core/`**: Foundational, headless services. Do not put domain-specific UI (like widgets or wallpaper selectors) here. `storageHandler.js` is the central state authority.
- **`src/core/ui/`**: Reusable primitive components (buttons, dialogs, popovers, sliders). Follow conventions in `ui_rules.md`.
- **`src/wallpaper/`**: Autonomous subsystem handling background canvas rendering, visual effects (motion/particles), remote source adapters, and carousel switcher. Detailed in `wallpaper_architecture.md`.
- **`src/widgets/`**: Startpage widgets. Each widget is self-contained with its own JS, HTML template, CSS, and settings markup.
- **`src/settings/`**: Manages settings modal interactions, tab navigation, and system diagnostics/maintenance tools.
- **`public/locales/`**: Must remain strictly synchronized between `en.json` and `vi.json`.
