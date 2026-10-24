---
trigger: manual
---

# Wallpaper Architecture & Data Flow Rules

This document defines the standard four-layer architecture for Yumebako's Wallpaper Switcher and Visual Pipeline. Any AI agent or developer modifying, extending, or refactoring the wallpaper system **MUST FOLLOW** the principles below.

## 1. Four-Layer Architecture

```
┌──────────────────────────────────────────────────────────┐
│  LAYER 1: UI (WallpaperSwitcher, CarouselEngine,         │
│             SwitcherBar, CSS)                            │
│  - Render real image cards                               │
│  - Handle drag, wheel, and keyboard gestures             │
│  - Send Soft Select and Hard Select to Layer 2           │
│  - Keep SwitcherBar fully reactive to Layer 2 events     │
└──────────────────────────┬───────────────────────────────┘
                           │ (events / calls)
                           ▼
┌──────────────────────────────────────────────────────────┐
│  LAYER 2: DATA CONTROL (DataControl.js - SSOT)            │
│  - Single source of truth and Pub/Sub event emitter      │
│  - Manage clean wallpaper card lists (CardItem[])        │
│  - Manage currentIndex (Hard) and softIndex (Soft)       │
│  - Remember/restore each source tab's index              │
│    (sourceIndices)                                        │
│  - Communicate with IndexedDB (BakoDB: appData/mediaData)│
└──────────────┬───────────────────────────┬───────────────┘
               │                           │
               ▼                           ▼
┌──────────────────────────────┐ ┌─────────────────────────┐
│ LAYER 3: SOURCE ADAPTERS      │ │ LAYER 4: RENDERER &     │
│ (BaseSource, RemoteSource,    │ │ VISUAL PIPELINE         │
│  CollectionSource...)         │ │ (renderer.js, filter.js,│
│ - Single-phase pipeline       │ │  bgEditor, motion,      │
│ - Fetch and seed data         │ │  particles, onload)     │
│ - Store blobs in mediaData    │ │ - Listen for card:hard  │
│ - Manage session Object URLs  │ │   from Layer 2          │
│                               │ │ - Fade through .overlay │
└──────────────────────────────┘ └─────────────────────────┘
```

## 2. Layer Responsibilities and Boundaries

### Layer 1: UI (`src/wallpaper/ui/`, `src/wallpaper/core/WallpaperSwitcher.js`)

- **Role:** Present the interface, 3D carousel motion (`CarouselEngine`), bottom control bar (`SwitcherBar`), and open/close coordinator (`WallpaperSwitcher`).
- **Rules:**
  - **Do not access the database or fetch external APIs directly:** Route all image loading, deletion, and source-switching requests through `dataControl` methods (`requestMore()`, `deleteCard()`, `switchSource()`).
  - **The "+" action card has been removed:** The carousel contains only real image cards. Load more images through the `#wallpaper_fetch_btn` (`dataControl.requestMore()`) or the `#wallpaper_upload_btn` (for Collection) in `SwitcherBar`.
  - **Optimize DOM updates:** Use `carousel.setItems()` when loading a source and `carousel.syncItems()` when adding a card (`card:added`), so only new cards animate instead of re-rendering the entire strip.
  - **Two-step card deletion:** When deleting a card from `SwitcherBar`, first call `await carousel.deleteActiveCard()` to finish its drop animation and remove it from the DOM. Then call `await dataControl.deleteCard(targetIndex)` and finalize with `setHardIndex`.
  - When scrolling settles, `CarouselEngine` emits `onHardSelect`. Programmatic full-list renders must use `setItems(..., { silent: true })` so they do not masquerade as user selections. `WallpaperSwitcher` must check that source switching and deletion are inactive before calling `dataControl.setHardIndex(index)`.

### Layer 2: Data Control (`src/wallpaper/core/DataControl.js`)

- **Role:** The centralized data coordinator and single source of truth.
- **Rules:**
  - **Keep item arrays clean:** `dataControl.items` and the `carousel:${sourceId}` key in IndexedDB (`appData`) contain only real wallpaper card data (`CardItem`), and every `id` appears **at most once**.
  - **Dedupe by `id` on every write and every load:** remote feeds hand back wallpapers that are already in the window (Wallhaven's `random` sorting replays the same results once the filter is exhausted). `DataControl` runs `uniqueCards()` in `switchSource()`, in the `requestMore()` merge (including duplicates inside a single batch) and in `_persistCards()`; when `switchSource()` finds duplicates in `carousel:*` it rewrites the cleaned list on the spot, so data written by older builds heals itself. `CarouselEngine` repeats the check in `setItems()`/`syncItems()`. The carousel keys cards by id, so a duplicated id makes two slots share one DOM element — one slot loses its image and the leftover node stays in the strip as a ghost card no layout ever writes again.
  - **Never store `blob:` URLs in IndexedDB:** When `_persistCards()` writes `carousel:${sourceId}`, reset every `thumbnailUrl` beginning with `blob:` to `null` to prevent `ERR_FILE_NOT_FOUND` after reload. When reloading a source, call `source.prepareThumb(item)` to recreate a live Object URL from `mediaData`.
  - **Distinguish regular and dynamic sources (`isDynamic`):**
    - Dynamic sources (`CollectionSource`, `BingSource` with `isDynamic = true`) always load the latest list through `source.fetchItems()`.
    - Static/history sources (`isDynamic = false`) load directly from `carousel:${sourceId}` in `appData`. If the source has no stored items, it stays empty until the user explicitly requests new images via `requestMore()`.
  - **Manage indexes:**
    - On source switch or startup (`switchSource`), first look for a card matching `wallpaperConfig.activeWallpaperId` (or `activeCollectionItemId`) when the source matches the one active on the desktop. Otherwise, use `settings.wallpaperSwitcher.sourceIndices[sourceId]`, falling back to `0`.
    - When scrolling settles (`setHardIndex`), update `wallpaperSwitcher.sourceIndices[activeSourceId]` and `wallpaperConfig` through `saveSettings()`.
    - When deleting a card (`deleteCard`), remove its source data and persist the updated card list (orphaned media blobs are purged centrally by Media GC). If the list becomes empty, also delete `storeData.applied` to prevent a stale card from reappearing during reseeding. Recalculate the neighboring index (prefer the card to the left, `targetIndex - 1`) and update `sourceIndices`.
  - **Media Garbage Collection (`src/wallpaper/core/mediaGC.js`):** Runs automatically in the background on browser idle after page load. Collects all referenced IDs across settings and `appData` stores, purges orphaned blobs from `mediaData`, and logs a diagnostic summary to console.
  - **History limit (`source.maxCards`):** Remote sources cap their history window (`RemoteSource.maxCards = 100`); the Collection is unbounded. When reaching `maxCards`, `DataControl.requestMore()` automatically rotates items using FIFO: the oldest card (preserving the one currently applied to the desktop) is pruned silently if out of view, or with an animated drop if currently active in the carousel. Users can trigger `clearSourceHistory(sourceId)` from source settings sidebar, which preserves only the wallpaper currently applied to the desktop and purges other rolled items and their media cache.
  - **Standard Pub/Sub events:**
    - `source:change`: Emitted when switching source tabs begins.
    - `cards:loaded`: Emitted when a source's card list has finished loading.
    - `card:soft`: Emitted as the carousel center moves across cards (`setSoftIndex`).
    - `card:hard`: Emitted when scrolling settles on a card (`setHardIndex` or initial setup with `firstRun: true`).
    - `card:added` / `card:deleted`: Emitted when a card is added or deleted.
    - `feed:limit_reached`: Emitted when a fetch is attempted while the source is at `maxCards`.
    - `feed:exhausted`: Emitted when a remote source has no more images to load.
    - `state:change`: Emits a `getState()` snapshot whenever the busy/index state changes.
    - `error`: Emitted when seeding, `fetchMore`, `deleteCard`, or `clearSourceHistory` fails.

### Layer 3: Source Adapters (`src/wallpaper/sources/`)

- **Role:** Provide wallpaper data from the local collection (`CollectionSource`) or online APIs (`RemoteSource` -> `PicreSource`, `WallhavenSource`, `UnsplashSource`), along with display metadata (`cardMeta.js`) and action definitions (`sourceActions.js`).
- **Single-phase pipeline (`RemoteSource.js`):**
  - When fetching a remote image (`fetchNext`): retrieve metadata (`fetchItem`) -> download the original image exactly once -> store it in the IndexedDB `mediaData` store (`media:orig:${id}`) -> generate a 16:9 thumbnail using Canvas (`generateImageThumbnail`) -> store it in `mediaData` (`media:thumb:${id}`) -> create an Object URL and cache it in `thumbCache`.
  - **Never hand over a card that cannot paint.** If neither a local Blob nor the source's fallback URL yields an image (offline, dead CDN), the pipeline throws: a `NetworkError` for connection failures, the original error otherwise. The caller shows a notification instead of appending a blank frame to the strip. User-facing error text comes from `core/errors.js` (`describeFetchError`), which turns the browser's untranslatable `TypeError: Failed to fetch` into the localized "check your connection" line.
  - When applying a wallpaper (`source.apply(card, { firstRun })`), retrieve the Blob immediately from memory (`blobCache`) or `mediaData` (with no network delay), package the payload, pass it to `wallpaperRenderer.apply()`, and update `persistApplied()`.
  - Layer 3 is fully headless: it returns plain `CardItem` objects and manages that source's `URL.createObjectURL` / `URL.revokeObjectURL` lifecycle. It must not manipulate the Carousel or SwitcherBar DOM.

### Layer 4: Desktop Renderer and Visual Pipeline (`src/wallpaper/core/renderer.js` and effect modules)

- **Role:** Render the wallpaper and visual effect layers on the desktop.
- **Module boundaries:**
  - **`core/renderer.js` (`wallpaperRenderer`):** Listens to `dataControl.on("card:hard", ...)` and calls `source.apply(card, { firstRun })`. Manages smooth transitions through the `.overlay` layer (`_fadeToOverlay`), assigns `blob:` URLs to `.image` / `.video`, revokes old Object URLs, and triggers `applyOnloadAnimation()` on the first run (`firstRun`). It must not store settings state or control Layer 1 or Layer 2.
  - **`core/filter.js` (`applyWallpaperFilters`):** Independently manages CSS filters (`brightness`, `contrast`, `saturate`) on `.image, .video` and the `.bloom_container` glow intensity (`bloom`).
  - **`bgEditor.js` (`applyWallpaperPosition`):** Manages position coordinates (`x`, `y`), `zoom`, and `mode` (`cover` / `contain`).
  - **`motion/`, `particles/`, `onload/`:** Independent effect engines (Wavy/Parallax, dynamic/static particles, and page-load animations) exported centrally through `src/wallpaper/index.js`.

---

## 3. Anti-Patterns

1. **STRICTLY FORBIDDEN:** Reintroducing `SwitcherStore.js`, `ProviderManager`, or any fragmented store. All Switcher state belongs in `DataControl.js`.
2. **STRICTLY FORBIDDEN:** Adding action cards or virtual UI cards to the database or `dataControl.items`.
3. **STRICTLY FORBIDDEN:** Storing `blob:...` URLs directly in IndexedDB (`carousel:${sourceId}`), because Object URLs become invalid after a page reload.
4. **STRICTLY FORBIDDEN:** Calling `saveToStore('carousel:...')` outside `DataControl`.
5. **STRICTLY FORBIDDEN:** Having Layer 1 (`CarouselEngine`, `SwitcherBar`) fetch images or delete IndexedDB records directly instead of going through `DataControl`.
6. When adding a wallpaper source, extend `BaseSource` (or `RemoteSource`), register it in `src/wallpaper/sources/registry.js`, define its badge/metadata (if any) in `src/wallpaper/sources/cardMeta.js`, and declare its `defaultSettings` in `src/core/storageHandler.js`.
