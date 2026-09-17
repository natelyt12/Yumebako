/**
 * mediaStore.js
 * ---------------------------------------------------------------------------
 * Blob storage for the carousel, one IndexedDB record per item so that freeing
 * an item frees exactly its own bytes.
 *
 * One record per item:
 *   wallpaper_media:<sourceId>:<itemId>  — the full-size image, used to apply,
 *                                          download, add to the collection, and
 *                                          to rebuild an item thumbnail locally
 *
 * Thumbnails are not stored: an item either carries a remote thumbnail URL in its
 * metadata (persisted, free to draw) or has one derived from this record.
 *
 * The full-size record is *optional by design*: an item whose media was evicted
 * (window overflow, budget, or a mid-flight crash) simply becomes lazy and is
 * refetched from its URL the next time it is needed. Losing it can never lose
 * the wallpaper itself, since the URL is always persisted in the item metadata.
 *
 * Deletion is always a plain `delete` on a known key — never a rewrite of a
 * container record — so a partially applied cleanup can only end up with a
 * *missing* blob, never with unreachable bytes. `sweepBlobs()` closes the loop
 * by removing anything the sources no longer reference.
 *
 * Videos are never stored here: a collection video can weigh hundreds of MB and
 * is already owned (and persisted) by the collection itself.
 */
import { getAllKeys, getFromStore, removeFromStore, saveToStore } from "/src/core/db.js";
import { MAX_MEDIA_BYTES } from "./carouselSchema.js";

const MEDIA_PREFIX = "wallpaper_media:";
const MEDIA_STORE_NAME = "mediaData";

/** Key of an item's full-size media record. */
export function mediaKey(sourceId, itemId) {
    return `${MEDIA_PREFIX}${sourceId}:${itemId}`;
}

/** Whether a blob looks like something worth persisting as full-size media. */
function isStorableMedia(blob) {
    return blob instanceof Blob && blob.type.startsWith("image/");
}

/**
 * Read an item's full-size media.
 * @returns {Promise<Blob|null>} null when the item is lazy (media not stored).
 */
export async function readMedia(sourceId, itemId) {
    const blob = await getFromStore(mediaKey(sourceId, itemId), MEDIA_STORE_NAME);
    return blob instanceof Blob ? blob : null;
}

/**
 * Persist an item's full-size media. Non-image blobs (videos) are ignored.
 * @returns {Promise<boolean>} Whether a record was written.
 */
export async function saveMedia(sourceId, itemId, blob) {
    if (!isStorableMedia(blob)) return false;
    return saveToStore(mediaKey(sourceId, itemId), blob, MEDIA_STORE_NAME);
}

/**
 * Free the media persisted for one item. Called when an item leaves the window;
 * deleting a key that was never written is a no-op.
 */
export async function releaseMedia(sourceId, itemId) {
    await removeFromStore(mediaKey(sourceId, itemId), MEDIA_STORE_NAME);
}

/** Every media record key currently held. */
export async function listMediaKeys() {
    const keys = await getAllKeys(MEDIA_STORE_NAME);
    return keys.filter((key) => key.startsWith(MEDIA_PREFIX));
}

/** Ids of the items of one source that still have full-size media stored. */
export async function readMediaIds(sourceId) {
    const prefix = `${MEDIA_PREFIX}${sourceId}:`;
    return new Set((await listMediaKeys()).filter((key) => key.startsWith(prefix)).map((key) => key.slice(prefix.length)));
}

/**
 * Delete every media record that no source references any more.
 *
 * This is the safety net behind the whole scheme: whatever slips through the
 * normal eviction path (a crash between two deletes, a list rewritten by an
 * older build, an item dropped before its media was written) is collected here.
 *
 * @param {Set<string>} keepKeys - Full keys that must survive, built from every
 *     source's item list plus the wallpaper currently applied.
 * @returns {Promise<number>} How many records were freed.
 */
export async function sweepBlobs(keepKeys) {
    const orphans = (await listMediaKeys()).filter((key) => !keepKeys.has(key));

    for (const key of orphans) {
        await removeFromStore(key, MEDIA_STORE_NAME);
    }
    return orphans.length;
}

/**
 * Pick the items whose full-size media no longer fits the per-source budget.
 * The newest items are kept and the oldest overflow is freed; metadata is left
 * alone, so those items only become lazy.
 *
 * @param {Array<Object>} items - Normalized list, oldest first.
 * @param {Object} options
 * @param {Set<string>} options.mediaIds - Ids that actually have media stored.
 * @param {Array<string>} options.pinnedIds - Ids that must never be freed.
 * @param {number} [options.maxBytes=MAX_MEDIA_BYTES]
 * @returns {Array<string>} Ids to free, oldest first.
 */
export function selectOverBudget(items, { mediaIds, pinnedIds = [], maxBytes = MAX_MEDIA_BYTES }) {
    const pinned = new Set(pinnedIds.filter(Boolean));
    const overflow = [];
    let total = 0;

    for (let i = items.length - 1; i >= 0; i--) {
        const item = items[i];
        if (!item?.id || !mediaIds.has(item.id)) continue;

        total += item.size || 0;
        if (total > maxBytes && !pinned.has(item.id)) overflow.push(item.id);
    }

    return overflow.reverse();
}
