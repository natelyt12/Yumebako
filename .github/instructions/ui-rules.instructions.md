---
description: "UI/UX conventions for Yumebako: design tokens, layouts, shared components, accessibility, localization."
applyTo: "src/**/*.{css,html,js},public/locales/*.json"
---

# Yumebako UI Rules

Full rules: [.agent/rules/ui_rules.md](../../.agent/rules/ui_rules.md)

- Read the relevant component and stylesheet **before** changing or using a component.
- Keep the dark translucent glass visual language; reuse tokens in `src/styles/variables.css` (surfaces, text, borders, interaction states, status colors, easing, stacking order). No parallel palettes or one-off colors.
- Font: Quicksand variable font (300–800) in `src/styles/fonts.css`, Mulish as fallback.
- Font-weight hierarchy has exactly 2 levels: `500` regular (body, buttons, descriptions, inputs, inactive tabs) and `600` medium/bold (titles, labels, active tabs, badges). No other weights.
- All user-facing strings go through `src/core/i18n.js` and `public/locales/{en,vi}.json` (run `pnpm sync-locales`).
- Follow §7 "UI change checklist" before finishing any UI change.
