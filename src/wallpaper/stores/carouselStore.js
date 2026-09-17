/**
 * carouselStore.js
 * ---------------------------------------------------------------------------
 * The carousel window of one source, persisted as a single metadata record:
 *
 *     carousel:<sourceId> -> { version, appliedId, index, items: [...] }
 *
 * Only metadata lives in that record; the blobs live one key per item in
 * `mediaStore.js`. Keeping the two apart is what makes strict cleanup possible:
 * dropping an item is a plain `delete` of its own keys, not a rewrite of a
 * container that might be interrupted halfway.
 *
 * `saveCarousel()` is the single writer. It normalizes the list, frees everything
 * that left the window, enforces the media budget, and only then writes — in
 * that order, so an interrupted save can only orphan *blobs already freed*,
 * never leave bytes nobody can reach.
 */
import { getAllKeys, getFromStore, saveToStore } from "/src/core/db.js";
import { CAROUSEL_VERSION, isMoreItem, normalizeCarousel } from "./carouselSchema.js";
import { mediaKey, readMediaIds, releaseMedia, selectOverBudget } from "./mediaStore.js";

const CAROUSEL_PREFIX = "carousel:";

/** Key of a source's carousel list. */
export function carouselKey(sourceId) {
    return `${CAROUSEL_PREFIX}${sourceId}`;
}

/** Ids present in `previous` but gone from `next`. */
function removedIds(previous, next) {
    const kept = new Set((next || []).map((item) => item.id));
    return (previous || [])
        .filter((item) => item?.id && !isMoreItem(item) && !kept.has(String(item.id)))
        .map((item) => String(item.id));
}

/**
 * Read a source's window.
 *
 * A stored list that no longer satisfies the invariants is repaired on the spot
 * (and its unreachable blobs freed) rather than passed on to the view.
 *
 * @param {string} sourceId
 * @returns {Promise<{ items: Array<Object>, appliedId: string|null, index: number, mediaIds: Set<string> }>}
 */
export async function loadCarousel(sourceId) {
    const record = await getFromStore(carouselKey(sourceId));
    const { items, droppedIds } = normalizeCarousel(record?.items, sourceId);
    const appliedId = record?.appliedId ? String(record.appliedId) : null;
    const index = Math.max(0, Number(record?.index) || 0);

    if (droppedIds.length) {
        console.warn(`[carouselStore] Repaired the item list of [${sourceId}]:`, droppedIds);
        await saveCarousel(sourceId, { items, appliedId, index });
    }

    return { items, appliedId, index, mediaIds: await readMediaIds(sourceId) };
}

/**
 * Persist a source's window.
 *
 * @param {string} sourceId
 * @param {Object} state
 * @param {Array<Object>} state.items - Items plus the sentinel; normalized here.
 * @param {string|null} [state.appliedId] - Item currently on the desktop. Its
 *     media is pinned: it is what the app boots with, even once it leaves the window.
 * @param {number} [state.index] - Centered item, restored on the next launch.
 * @returns {Promise<{ items: Array<Object>, freedIds: Array<string> }>}
 */
export async function saveCarousel(sourceId, { items, appliedId = null, index = 0 } = {}) {
    const previous = await getFromStore(carouselKey(sourceId));
    const { items: clean, droppedIds } = normalizeCarousel(items, sourceId);

    // The wallpaper in use is pinned — but only while it is still part of the
    // window. Once its item is gone there is nothing left to resolve it from, so
    // keeping its bytes would pin an unreachable blob forever.
    const applied = appliedId ? String(appliedId) : null;
    const pinned = applied && clean.some((item) => item.id === applied) ? [applied] : [];

    const doomed = new Set([...droppedIds, ...removedIds(previous?.items, clean)]);
    pinned.forEach((id) => doomed.delete(id));

    // Media over budget is freed too, oldest first, metadata left in place.
    // Items already doomed do not count: their bytes are freed anyway.
    const victimIds = await readMediaIds(sourceId);
    doomed.forEach((id) => victimIds.delete(id));
    selectOverBudget(clean, { mediaIds: victimIds, pinnedIds: pinned }).forEach((id) => doomed.add(id));

    for (const id of doomed) {
        await releaseMedia(sourceId, id);
    }

    await saveToStore(carouselKey(sourceId), {
        version: CAROUSEL_VERSION,
        appliedId,
        index: Math.max(0, Number(index) || 0),
        items: clean,
    });

    return { items: clean, freedIds: [...doomed] };
}

/**
 * Every media key that is still reachable: the items of every source, plus the
 * wallpaper each one has applied while that item is still in its window (the
 * pinned one). Feed this to `sweepBlobs()`.
 * @returns {Promise<Set<string>>}
 */
export async function collectLiveKeys() {
    const keys = new Set();

    for (const key of await getAllKeys()) {
        if (!key.startsWith(CAROUSEL_PREFIX)) continue;
        const sourceId = key.slice(CAROUSEL_PREFIX.length);
        const record = await getFromStore(key);
        const items = record?.items || [];

        items.forEach((item) => {
            if (item?.id && !isMoreItem(item)) keys.add(mediaKey(sourceId, item.id));
        });

        const applied = record?.appliedId ? String(record.appliedId) : null;
        if (applied && items.some((item) => item?.id === applied)) keys.add(mediaKey(sourceId, applied));
    }

    return keys;
}
