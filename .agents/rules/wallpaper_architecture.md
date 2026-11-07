---
trigger: manual
description: "Core architectural boundaries and anti-patterns for the Wallpaper subsystem."
---

# Wallpaper Architecture & Invariant Rules

This document establishes the hard architectural boundaries and invariant rules for Yumebako's Wallpaper subsystem. Developers and AI agents must follow these rules without exception.

## 1. Unidirectional Data Flow

```text
┌────────────────────────────────────────────────────────┐
│  LAYER 1: UI (`frontend/`)                             │
│  - Switcher, Carousel, Top Bar, Sidebars, Customize    │
└──────────────────────────┬─────────────────────────────┘
                           │ (events / method calls)
                           ▼
┌────────────────────────────────────────────────────────┐
│  LAYER 2: DATA CONTROL (`backend/data/DataControl.js`) │
│  - Single source of truth (SSOT) & event emitter       │
│  - Card lists, active indices, IndexedDB sync          │
└──────────────┬───────────────────────────┬─────────────┘
               │                           │
               ▼                           ▼
┌──────────────────────────────┐ ┌───────────────────────┐
│ LAYER 3: SOURCE ADAPTERS     │ │ LAYER 4: RENDERER     │
│ (`backend/sources/`)         │ │ (`backend/rendering/` │
│ - Fetch images & metadata    │ │  & `backend/effects/`)│
│ - Cache media blobs in IDB   │ │ - Render desktop layer│
└──────────────────────────────┘ └───────────────────────┘
```

---

## 2. Layer Invariants & Boundaries

### Layer 1: UI (`src/wallpaper/frontend/`)
- **No direct storage or network access:** Never read/write IndexedDB or fetch remote APIs directly. Route all queries, mutations, and deletions through `DataControl`.
- **Real image cards only:** Do not insert virtual action cards (e.g. `+` card) into the carousel DOM strip or data arrays. Actions belong in `SwitcherBar`.
- **Two-step card deletion:** Always await visual removal (`await carousel.deleteActiveCard()`) before calling `await dataControl.deleteCard(targetIndex)`.
- **Silent batch updates:** Use `carousel.setItems(items, { silent: true })` for non-user-driven data syncs to prevent firing fake selection cascades.
- **Customize panel isolation:** Open wallpaper customization panels exclusively from the Wallpaper Switcher, never from Settings modal. Keep panels under `frontend/customize/panels/<panel>/` decoupled from backend effect math.

### Layer 2: Data Control (`src/wallpaper/backend/data/DataControl.js`)
- **Single Source of Truth:** `DataControl` exclusively manages active indices (`currentIndex`, `softIndex`, `sourceIndices`) and persisted card lists (`carousel:<sourceId>`).
- **Strict Deduplication:** Always deduplicate cards by `id` on every merge, write, and load (`uniqueCards()`). Never allow duplicate IDs into `items` or IndexedDB.
- **No persistent blob URLs:** Never save `blob:` URLs in IndexedDB (`appData`). Strip `thumbnailUrl` before persisting, and recreate live Object URLs via `source.prepareThumb()` on load.
- **Central media lifecycle:** Media blobs are owned by `mediaData` store and cleaned up centrally by `mediaGC.js`.

### Layer 3: Source Adapters (`src/wallpaper/backend/sources/`)
- **Headless contracts:** Sources produce plain `CardItem` objects and manage Object URLs (`blob:`). They must never manipulate the DOM.
- **Fail-safe delivery:** Never return cards that cannot render. Throw descriptive errors (`NetworkError`) for connection failures so UI can notify the user instead of appending broken cards.

### Layer 4: Desktop Renderer & Visual Effects (`src/wallpaper/backend/rendering/`, `effects/`)
- **Stateless rendering:** Listens for `card:hard` events and applies wallpapers/effects to desktop elements (`.image`, `.video`, `.overlay`).
- **No state ownership:** Renderers and effect engines must not persist settings or manipulate Layer 1/2 state directly. State persistence belongs to `storageHandler.js`.

---

## 3. Strictly Forbidden (Anti-Patterns)

1. **NO fragmented stores:** Do NOT create secondary stores (`SwitcherStore`, `ProviderManager`). All Switcher state belongs in `DataControl.js`.
2. **NO `blob:` URLs in persistent storage:** Object URLs are transient to the browser session and will cause `ERR_FILE_NOT_FOUND` after reload.
3. **NO direct `saveToStore('carousel:...')`:** All carousel persistence must pass through `DataControl._persistCards()`.
4. **NO DOM access in Layers 2–4:** Backend data, sources, and effect engines must never import or query Switcher UI elements.
5. **NO wallpaper editor UI in Settings modal:** Keep editor markup, styles, and controllers strictly inside `src/wallpaper/frontend/customize/`.
