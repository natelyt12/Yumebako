---
description: "Architectural boundaries and anti-patterns for the Wallpaper subsystem."
applyTo: "src/wallpaper/**"
---

# Wallpaper Architecture & Invariant Rules

Full rules: [.agent/rules/wallpaper_architecture.md](../../.agent/rules/wallpaper_architecture.md)

- Data flow is strictly unidirectional: UI (`frontend/`) → `backend/data/DataControl.js` → source adapters (`backend/sources/`) → renderer/effects (`backend/rendering/`, `effects/`).
- Layers must not skip levels or call upward; UI never touches adapters directly.
- Respect the §3 "Strictly Forbidden (Anti-Patterns)" list — these rules apply without exception.

Read the full rule file before modifying any cross-layer behavior.
