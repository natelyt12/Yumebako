---
trigger: manual
description: "Detailed UI and UX conventions for Yumebako: visual language, layouts, shared components, accessibility, and localization."
---

# Yumebako UI Rules

Follow these rules whenever adding or changing user-facing markup, styles, controls, or interactions. This file describes the existing design system and its component contracts; the implementation files remain the source of truth. Read the relevant component and stylesheet before changing or using a component, and update this guide if a shared convention changes.

## 1. Visual foundation

- Keep the existing dark, translucent glass visual language. Reuse the design tokens in `src/styles/variables.css` for surfaces, text, borders, interaction states, status colors, easing, and stacking order. Do not introduce a parallel palette or scatter one-off colors when an existing token fits.
- Use the existing Mulish font stack and sizing rhythm. Preserve the established rounded control shapes, restrained borders, translucent surfaces, and subtle motion rather than adding unrelated visual treatments.
- Size type from the root scale: `html` uses `--font-size-root` (pinned in `px` so the browser's default font-size setting cannot shrink the extension UI) and everything below uses `em`/`rem`. Change that one token to rescale the whole interface instead of overriding sizes per component.
- Keep the `html`/`html body` typography rules **outside** `@layer` (see `src/styles/base.css`). Chromium injects an unlayered `body { font-size: 75%; font-family: system-ui }` rule into extension pages, and unlayered styles outrank every cascade layer — layering the shell typography makes the extension render smaller than the dev server.
- Prefer design tokens over hardcoded colors, radii, shadows, and animation curves. Component-specific values belong in the component stylesheet; promote a value to a shared token only when multiple surfaces need the same semantic value.
- Keep layering predictable. Use the existing `--z-*` layers for backgrounds, widgets, floating controls, settings, dropdowns, modals, and toasts instead of inventing unrelated z-index values.
- **Nested Backdrop-Filter & Decoupled Layering (Fixing Text Bleed-Through):**
  - *Root Cause:* Under W3C Filter Effects Module Level 2, any element with `backdrop-filter` creates a new **Backdrop Root** and **Stacking Context**. Any child glass element (such as a custom dropdown, submenu, or floating menu) cannot sample or blur text/controls belonging to that same Backdrop Root behind it, rendering parent text sharply through the child's glass surface.
  - *The Decoupled Layering Pattern:* Never place `backdrop-filter` or background color directly on a parent container if it hosts floating children with glassmorphism. Instead, move the background and filter to a `::before` pseudo-element:
    ```css
    .parent-container {
      position: relative;
      /* NEVER put background or backdrop-filter here */
    }
    .parent-container::before {
      content: "";
      position: absolute;
      inset: 0;
      border-radius: inherit;
      background: var(--bg-panel);
      backdrop-filter: blur(28px) saturate(180%) brightness(1.06);
      -webkit-backdrop-filter: blur(28px) saturate(180%) brightness(1.06);
      z-index: -1;
      pointer-events: none;
    }
    ```
  - *Keep Alpha Thin:* Never "solve" bleed-through by forcing opaque backgrounds (e.g. `rgba(..., 0.85)`). Keep the delicate glass aesthetic intact.
  - *Vendor Prefix:* Always specify `-webkit-backdrop-filter` alongside `backdrop-filter`.
- Follow the CSS entry points: `src/style.css` loads only tokens, base layout, global form controls, and utilities; shared component presentation lives beside its component under `src/core/ui/` and is imported by that component's JS; settings presentation lives under `src/settings/`; feature-specific presentation lives beside its widget or wallpaper feature and is imported by the feature entry. Avoid duplicating shared component rules in feature stylesheets.
- Respect the cascade layer order declared in `src/styles/layers.css` (`utilities, tokens, base, components, features`). Put new rules in the layer of the file that owns them instead of raising specificity or adding competing `!important` declarations.

## 2. Layout and CSS

- Keep the interface structure shallow and semantic. Avoid wrapper elements that exist only to add spacing or alignment; use the existing layout helpers from `src/styles/utilities.css` (`.flex_row`, `.flex_col`, `.flex_1`, `.gap_*`, `.mt_*`, `.mb_8`, `.w_full`, `.text_center`, `.hidden`) where they fit.
- Prefer stylesheet classes for stable layout and appearance. Use inline styles only when a value is genuinely computed at runtime (for example, measured animation distance); do not use them as a substitute for reusable CSS.
- Scope feature selectors to their component. Avoid broad element rules and `!important` overrides that can unintentionally change settings, dialog, or widget controls.
- Preserve the full-screen start-page composition: the page itself does not scroll; scroll long settings, submenu, and dialog content inside their own bounded panels.
- Keep long labels and descriptions usable at narrow widths. Let text wrap where appropriate, constrain flex children with `min-width: 0`, and do not allow content to push panels or controls off-screen.
- Check viewport boundaries when sizing dialogs and submenus, ensuring bounded scrolling and usable margins.
- Reuse existing easing tokens. Do not add competing timings to coordinated settings/sidebar/submenu transitions; keep `--settings-motion` synchronized with `SUBMENU_TRANSITION_MS` if either is intentionally changed.

## 3. Settings information layout

- Keep settings tabs as a flat vertical sequence inside `.tab_content`; submenu sections use `.setting_section`. Do not add redundant nested containers around each setting.
- Use `.setting_title` for a settings group heading. Its spacing, uppercase treatment, optional leading icon, and trailing gradient divider are supplied by `src/settings/settings_layout.css`.
- Use `.section_divider` to separate groups when a heading is not appropriate. Do not draw separators with text glyphs or ad-hoc borders.
- Use `.setting_option` or the existing feature-specific layout for a label/control row, and keep descriptions visually secondary with `.tooltip`.
- Use the existing sidebar navigation (`.settings_nav`, `.nav_group`, `.nav_item`) for settings navigation. Localize navigation tooltips through `data-tooltip-i18n`; do not add a separate tooltip element for every nav item.
- When a submenu can be left with unsaved edits, integrate with `isDirty`, `onCancel`, `onBeforeClose`, and `setSubmenuDirty` rather than implementing a parallel dirty-state or close flow.

## 4. Shared controls and components

Use the shared UI components through `src/core/ui.js` and their implementations under `src/core/ui/`. Confirm the current API before use; do not recreate a component that already exists.

### Buttons

- Use `.btn` for standard bar-style actions and settings rows. Its layout is three zones: optional leading icon, label/description body, and optional trailing action.
- Use `<div class="btn_body">` with `.btn_title` and optional `.btn_desc` for a two-line row; a single-line action may use a simple label. Keep the leading icon optional and aligned with the title.
- Let `initButtons(rootNode)` generate the trailing affordance from `data-action`: `submenu` adds a right chevron, `dropdown` adds a down chevron, and `toggle` adds a switch track. Never hand-write these trailing arrows or switch tracks.
- Use only the existing default glass and `data-variant="danger"` variants. Reserve the danger variant for destructive or irreversible actions.
- Toggles are a `.btn[data-action="toggle"]` label containing a real checkbox. Keep the text and checkbox in the same label so the control remains operable as a single target. Do not replace it with a decorative switch.
- `createButton({ id, icon, title, desc, action, variant, checked, onClick })` is available for programmatic creation. `initButtons(rootNode)` also initializes/upgrades custom selects and synchronizes dropdown selection.
- Bare buttons remain appropriate for intentional icon-only or compact controls such as slider steppers, floating controls, and navigation items. Do not revive removed legacy button classes such as `.btn_liked`, `.icon_button`, `.submenu_button`, `.btn_warning`, or `.danger_btn`.

### Dropdowns and fields

- Prefer native text/number inputs and `<select class="native_select">` where suitable. The common field height, padding, color, and interaction surface are defined centrally in `src/styles/controls.css`.
- Use the custom dropdown upgrade for a select that needs the shared animated menu. Let `initButtons` / `initCustomSelects` initialize it and keep the hidden native select synchronized; do not maintain a second independent selected value.
- For a custom dropdown or action menu, follow the `.dropdown_wrapper` contract in `src/core/ui/dropdown.css`. Use `data-value` for selectable value rows; action rows intentionally omit it. Update values through `setDropdownValue` and handle `dropdownChange` / `dropdownAction` as appropriate.
- Do not add custom select arrows, selected checkmarks, or open-state markup by hand; the component owns these states.
- Keep native input labels, placeholders, and disabled states meaningful. Do not rely on placeholder text as the only name or instruction for a field.

### Sliders

- Use `createSlider({ label, dataI18n, min, max, step, value, defaultValue, unit, dataI18nUnit, disabled, onChange })` for the shared Material 3 Expressive wavy slider.
- Provide the real bounds, step, initial/default value, unit, and change handler. Localize both the label and unit where needed. Avoid building a second slider markup/interaction implementation for the same use case.
- Use component-specific CSS variables in `src/core/ui/slider.css` for its compact number input, unit, track, and step/reset controls rather than overriding global form styles.

### Submenus, dialogs, and notifications

- Open settings submenus with `openSidebarSubmenu(title, contentNode, options)` and close via `closeSidebarSubmenu(force)`. Use `width`, `isFullScreen`, and `canPreview` only when the content requires them. The title also supplies the submenu's accessible name.
- Allow the submenu helper to translate content, render icons, and initialize controls. If controls are added later, initialize the affected subtree through the shared helpers.
- Use the Promise-based `showConfirm(msg, options)` for confirmation dialogs and `showAlert(msg, options)` for system alerts. Dialogs are centered modal surfaces with translucent backdrops, destructive styling (`isDanger`), and keyboard support (Escape to dismiss, Enter to confirm).
- Use `showNotification(message, type)` for brief feedback (`info`, `success`, `error`, or `warning`). Do not use transient notifications as the only place to communicate information that the user must retain or act on.

## 5. Icons, text, and localization

- Use the icon registry in `src/core/icon.js` (Phosphor raw SVGs). In markup use `<i data-icon="iconName"></i>` and call `renderIcons(rootNode)` for dynamically injected markup; do not depend on emoji or unrelated icon sets for interface controls.
- Never hardcode user-facing text. Add keys to both `public/locales/en.json` and `public/locales/vi.json` and follow the locale-sync/sorting workflow in `.agent/rules/base_rules.md`.
- In markup, use `data-i18n` for text, `data-i18n-placeholder` for placeholders, `data-i18n-title` for native title text, and `data-i18n-html` only for intentional translated HTML (with `data-i18n-link` when translated bracket text becomes a link).
- In JavaScript, use `t(key, variables)` from `src/core/i18n.js`. Translate newly created or injected content with `translateDOM` or the relevant component initializer.
- Use `.tooltip` for explanatory notes and descriptions. Keep help text concise and supplementary; it should not replace a visible label or required instruction.

## 6. Interaction, accessibility, and feedback

- Use native interactive elements (`button`, `input`, `select`, links) for actions and controls. Do not make a plain `div` clickable when a semantic element can express the same behavior.
- Ensure every control has an accessible name, sensible keyboard operation, and a visible focus indicator. Preserve existing `:focus-visible` behavior and add a component-scoped focus style when a new custom control otherwise has none.
- Make states distinguishable beyond hover alone: selected/active, disabled, open, error, and destructive states must remain clear without relying only on color.
- Keep hover and pressed feedback consistent with the shared button/input states. Disabled controls must not appear interactive or dispatch their normal action.
- Respect the existing animation language and keep motion purposeful. Avoid animating layout-heavy properties unnecessarily; where practical, reduce or remove nonessential motion when `prefers-reduced-motion` is requested.
- Provide user feedback after meaningful save, import/export, failure, and destructive operations using the existing notification/confirmation patterns. Do not silently imply success when an operation fails.
- Verify dynamic UI after injection: translations resolve, registered icons render, controls initialize once, events update the source of truth, and closing/reopening does not leave stale state.

## 7. UI change checklist

Before considering a UI change complete, verify:

1. It uses the existing visual tokens, layout, and shared component where applicable.
2. Labels, descriptions, tooltips, and status feedback are localized in English and Vietnamese.
3. Keyboard access, focus visibility, disabled/selected states, and semantic names are preserved.
4. Long text, scrollable content, dialog/submenu layout, and dynamic content work at the available viewport size.
5. Related component CSS and this rule are updated if a shared UI contract has changed.
6. Decoupled Layering (moving parent glass/blur to ::before with z-index: -1) is applied to any glass container hosting child dropdowns or floating elements to prevent nested backdrop-filter text bleed-through.
