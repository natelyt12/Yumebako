/**
 * migration.js
 * ---------------------------------------------------------------------------
 * One-time move of the legacy provider records into the card stores.
 *
 * Legacy IndexedDB layout (still written by `wallpaper/legacy/providers/*`):
 *     data:wallhaven -> { queue: [...], current: {...} }
 *     data:unsplash  -> { queue: [...], current: {...} }
 *     data:picre     -> { image, blob, source, ... }  (flat, plus a `current`
 *                       record bolted on by the switcher)
 *
 * New layout (see ./carouselStore.js and ./mediaStore.js):
 *     carousel:<sourceId>                -> { items: [ wallpaper..., sentinel ] }
 *     wallpaper_media:<sourceId>:<id> -> Blob
 *
 * The migration is purely additive: the legacy keys are left untouched so the
 * old settings panel keeps working while the two systems run side by side.
 * That duplicates exactly one wallpaper blob per source, which is a deliberate
 * trade until the legacy providers are removed.
 *
 * It is also idempotent: a source is migrated once, keyed on the stored
 * `version`, so a failed run is retried on the next launch instead of being
 * skipped forever.
 */
import { getFromStore } from "/src/core/db.js";
import { CAROUSEL_VERSION, isMoreItem, normalizeCarousel } from "./carouselSchema.js";
import { carouselKey, collectLiveKeys, loadCarousel, saveCarousel } from "./carouselStore.js";
import { saveMedia, sweepBlobs } from "./mediaStore.js";

/** Legacy storage key of each source the switcher can read today. */
const LEGACY_SOURCES = [
    { sourceId: "wallhaven", key: "data:wallhaven" },
    { sourceId: "unsplash", key: "data:unsplash" },
    { sourceId: "picre", key: "data:picre" },
];

/**
 * Legacy records hold the applied wallpaper either nested (`current`) or, for
 * pic.re, as the record itself. The nested one always wins: it is the newest
 * write, the flat fields are only what the legacy provider fetched at boot.
 */
function readLegacyCurrent(record) {
    if (!record) return null;
    if (record.current?.image) return record.current;
    return record.image ? record : null;
}

/** Map a legacy `current` record onto the new persisted item shape. */
function toCarouselItem(sourceId, current) {
    return {
        id: String(current.id ?? current.image),
        kind: "item",
        source: sourceId,
        url: current.image,
        sourceUrl: current.source || "",
        // The richer titles ("wallhaven • people") are provider specific and are
        // rebuilt by the source when it hydrates the item, not guessed here.
        title: current.title || "",
        category: current.category || "",
        mediaType: "image",
        width: current.width || 0,
        height: current.height || 0,
        size: current.size || (current.blob instanceof Blob ? current.blob.size : 0),
        addedAt: current.last_updated || Date.now(),
    };
}

/** Migrate one source. Returns whether the new record was written. */
async function migrateSource({ sourceId, key }) {
    const current = readLegacyCurrent(await getFromStore(key));

    if (!current?.image) {
        // Nothing to carry over: still claim the source so the migration does
        // not run again on every launch.
        await saveCarousel(sourceId, { items: [] });
        return false;
    }

    const item = toCarouselItem(sourceId, current);
    const { items } = normalizeCarousel([item], sourceId);

    // Media before metadata: an item is never listed before its blob exists.
    if (current.blob instanceof Blob) {
        await saveMedia(sourceId, item.id, current.blob);
    }
    await saveCarousel(sourceId, { items, appliedId: item.id, index: 0 });

    return true;
}

/**
 * Bring every legacy source over to the carousel stores. Safe to call on each
 * startup: already-migrated sources are skipped.
 *
 * @returns {Promise<{ migrated: Array<Object>, skipped: Array<string>, failed: Array<Object>, swept: number }>}
 */
export async function migrateCarouselStores() {
    const report = { migrated: [], skipped: [], failed: [], swept: 0 };

    for (const legacy of LEGACY_SOURCES) {
        const stored = await getFromStore(carouselKey(legacy.sourceId));
        if (stored?.version >= CAROUSEL_VERSION) {
            report.skipped.push(legacy.sourceId);
            continue;
        }

        try {
            const carried = await migrateSource(legacy);
            report.migrated.push({ sourceId: legacy.sourceId, carried });
        } catch (error) {
            console.error(`[migration] Failed to migrate [${legacy.sourceId}]:`, error);
            report.failed.push({ sourceId: legacy.sourceId, error: String(error?.message || error) });
        }
    }

    // Read every store back before sweeping: a list that needed repairing is
    // repaired here, so the sweep sees the final shape and frees accordingly.
    report.stores = await summarizeStores();

    // Collect whatever the migration (or any earlier run) left unreachable.
    try {
        report.swept = await sweepBlobs(await collectLiveKeys());
    } catch (error) {
        console.error("[migration] Sweep failed:", error);
    }

    return report;
}

/**
 * Compact snapshot of what every store holds, so a startup log is enough to
 * confirm a migration (count of items, how many still have their media, and
 * whether a wallpaper is pinned as applied). Retire this together with the
 * legacy providers.
 */
async function summarizeStores() {
    const summary = {};

    for (const { sourceId } of LEGACY_SOURCES) {
        const { items, appliedId, mediaIds } = await loadCarousel(sourceId);
        const count = items.filter((item) => !isMoreItem(item)).length;
        summary[sourceId] = `${count} item(s), ${mediaIds.size} with media, applied=${appliedId ? "yes" : "no"}`;
    }

    return summary;
}
