/**
 * mediaStore.js
 * ---------------------------------------------------------------------------
 * Blob storage for the carousel, one IndexedDB record per card so that freeing
 * a card frees exactly its own bytes.
 *
 * One record per card:
 *   wallpaper_media:<sourceId>:<cardId>  — the full-size image, used to apply,
 *                                          download, add to the collection, and
 *                                          to rebuild a card thumbnail locally
 *
 * Thumbnails are not stored: a card either carries a remote thumbnail URL in its
 * metadata (persisted, free to draw) or has one derived from this record.
 *
 * The full-size record is *optional by design*: a card whose media was evicted
 * (window overflow, budget, or a mid-flight crash) simply becomes lazy and is
 * refetched from its URL the next time it is needed. Losing it can never lose
 * the wallpaper itself, since the URL is always persisted in the card metadata.
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
import { MAX_MEDIA_BYTES } from "./cardSchema.js";

const MEDIA_PREFIX = "wallpaper_media:";

/** Key of a card's full-size media record. */
export function mediaKey(sourceId, cardId) {
    return `${MEDIA_PREFIX}${sourceId}:${cardId}`;
}

/** Whether a blob looks like something worth persisting as full-size media. */
function isStorableMedia(blob) {
    return blob instanceof Blob && blob.type.startsWith("image/");
}

/**
 * Read a card's full-size media.
 * @returns {Promise<Blob|null>} null when the card is lazy (media not stored).
 */
export async function readMedia(sourceId, cardId) {
    const blob = await getFromStore(mediaKey(sourceId, cardId));
    return blob instanceof Blob ? blob : null;
}

/**
 * Persist a card's full-size media. Non-image blobs (videos) are ignored.
 * @returns {Promise<boolean>} Whether a record was written.
 */
export async function saveMedia(sourceId, cardId, blob) {
    if (!isStorableMedia(blob)) return false;
    return saveToStore(mediaKey(sourceId, cardId), blob);
}

/**
 * Free the media persisted for one card. Called when a card leaves the window;
 * deleting a key that was never written is a no-op.
 */
export async function releaseMedia(sourceId, cardId) {
    await removeFromStore(mediaKey(sourceId, cardId));
}

/** Every media record key currently held. */
export async function listMediaKeys() {
    const keys = await getAllKeys();
    return keys.filter((key) => key.startsWith(MEDIA_PREFIX));
}

/** Ids of the cards of one source that still have full-size media stored. */
export async function readMediaIds(sourceId) {
    const prefix = `${MEDIA_PREFIX}${sourceId}:`;
    return new Set((await listMediaKeys()).filter((key) => key.startsWith(prefix)).map((key) => key.slice(prefix.length)));
}

/**
 * Delete every media record that no source references any more.
 *
 * This is the safety net behind the whole scheme: whatever slips through the
 * normal eviction path (a crash between two deletes, a list rewritten by an
 * older build, a card dropped before its media was written) is collected here.
 *
 * @param {Set<string>} keepKeys - Full keys that must survive, built from every
 *     source's card list plus the wallpaper currently applied.
 * @returns {Promise<number>} How many records were freed.
 */
export async function sweepBlobs(keepKeys) {
    const orphans = (await listMediaKeys()).filter((key) => !keepKeys.has(key));

    for (const key of orphans) {
        await removeFromStore(key);
    }
    return orphans.length;
}

/**
 * Pick the cards whose full-size media no longer fits the per-source budget.
 * The newest cards are kept and the oldest overflow is freed; metadata is left
 * alone, so those cards only become lazy.
 *
 * @param {Array<Object>} cards - Normalized list, oldest first.
 * @param {Object} options
 * @param {Set<string>} options.mediaIds - Ids that actually have media stored.
 * @param {Array<string>} options.pinnedIds - Ids that must never be freed.
 * @param {number} [options.maxBytes=MAX_MEDIA_BYTES]
 * @returns {Array<string>} Ids to free, oldest first.
 */
export function selectOverBudget(cards, { mediaIds, pinnedIds = [], maxBytes = MAX_MEDIA_BYTES }) {
    const pinned = new Set(pinnedIds.filter(Boolean));
    const overflow = [];
    let total = 0;

    for (let i = cards.length - 1; i >= 0; i--) {
        const card = cards[i];
        if (!card?.id || !mediaIds.has(card.id)) continue;

        total += card.size || 0;
        if (total > maxBytes && !pinned.has(card.id)) overflow.push(card.id);
    }

    return overflow.reverse();
}
