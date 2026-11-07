---
description: "Core rules for developing Yumebako Startpage. Always follow them."
applyTo: "**"
---

# Yumebako Startpage - Core Rules

Full rules: [.agent/rules/base_rules.md](../../.agent/rules/base_rules.md)

- **Settings Storage (`src/core/storageHandler.js`):** Before coding any new feature/module, check this file. If the feature persists state, declare its default structure (and JSDoc typedef) inside `defaultSettings` first.
- **Split storage (`WALLPAPER_KEYS`):** aesthetics/wallpaper/effect settings (`wallpaperConfig`, `wallpaperSwitcher`, `wallpaperPosition`, `wavy`, `particles`, `onload`, `wallpapers`) go to `bako_wallpaper`; system/widget/utility settings go to `bako_settings`.
- **Project structure:** follow the directory responsibilities defined in [base_rules.md](../../.agent/rules/base_rules.md) §3; `core/` = shared infrastructure, `widgets/` = self-registering widgets via `handler.js`.
- **Workflow:** read the existing implementation of the area you touch before changing it; reuse existing helpers/tokens instead of adding parallel ones.
- **Build/Test:** `pnpm dev`, `pnpm build`, `pnpm test` (node:test). See [base_rules.md](../../.agent/rules/base_rules.md) §2 for the full workflow.

Load the full rule file when the task involves storage, project structure, or cross-cutting workflow decisions.
