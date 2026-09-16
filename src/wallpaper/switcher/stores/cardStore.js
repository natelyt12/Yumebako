/**
 * cardStore.js
 * ---------------------------------------------------------------------------
 * The carousel window of one source, persisted as a single metadata record:
 *
 *     cards:<sourceId> -> { version, appliedId, index, cards: [...] }
 *
 * Only metadata lives in that record; the blobs live one key per card in
 * `mediaStore.js`. Keeping the two apart is what makes strict cleanup possible:
 * dropping a card is a plain `delete` of its own keys, not a rewrite of a
 * container that might be interrupted halfway.
 *
 * `saveCards()` is the single writer. It normalizes the list, frees everything
 * that left the window, enforces the media budget, and only then writes — in
 * that order, so an interrupted save can only orphan *blobs already freed*,
 * never leave bytes nobody can reach.
 */
import { getAllKeys, getFromStore, saveToStore } from "/src/core/db.js";
import { CARDS_VERSION, isMoreCard, normalizeCards } from "./cardSchema.js";
import { mediaKey, readMediaIds, releaseMedia, selectOverBudget } from "./mediaStore.js";

const CARDS_PREFIX = "cards:";

/** Key of a source's card list. */
export function cardsKey(sourceId) {
    return `${CARDS_PREFIX}${sourceId}`;
}

/** Ids present in `previous` but gone from `next`. */
function removedIds(previous, next) {
    const kept = new Set((next || []).map((card) => card.id));
    return (previous || [])
        .filter((card) => card?.id && !isMoreCard(card) && !kept.has(String(card.id)))
        .map((card) => String(card.id));
}

/**
 * Read a source's window.
 *
 * A stored list that no longer satisfies the invariants is repaired on the spot
 * (and its unreachable blobs freed) rather than passed on to the view.
 *
 * @param {string} sourceId
 * @returns {Promise<{ cards: Array<Object>, appliedId: string|null, index: number, mediaIds: Set<string> }>}
 */
export async function loadCards(sourceId) {
    const record = await getFromStore(cardsKey(sourceId));
    const { cards, droppedIds } = normalizeCards(record?.cards, sourceId);
    const appliedId = record?.appliedId ? String(record.appliedId) : null;
    const index = Math.max(0, Number(record?.index) || 0);

    if (droppedIds.length) {
        console.warn(`[cardStore] Repaired the card list of [${sourceId}]:`, droppedIds);
        await saveCards(sourceId, { cards, appliedId, index });
    }

    return { cards, appliedId, index, mediaIds: await readMediaIds(sourceId) };
}

/**
 * Persist a source's window.
 *
 * @param {string} sourceId
 * @param {Object} state
 * @param {Array<Object>} state.cards - Items plus the sentinel; normalized here.
 * @param {string|null} [state.appliedId] - Card currently on the desktop. Its
 *     media is pinned: it is what the app boots with, even once it leaves the window.
 * @param {number} [state.index] - Centered card, restored on the next launch.
 * @returns {Promise<{ cards: Array<Object>, freedIds: Array<string> }>}
 */
export async function saveCards(sourceId, { cards, appliedId = null, index = 0 } = {}) {
    const previous = await getFromStore(cardsKey(sourceId));
    const { cards: clean, droppedIds } = normalizeCards(cards, sourceId);

    // The wallpaper in use is pinned — but only while it is still part of the
    // window. Once its card is gone there is nothing left to resolve it from, so
    // keeping its bytes would pin an unreachable blob forever.
    const applied = appliedId ? String(appliedId) : null;
    const pinned = applied && clean.some((card) => card.id === applied) ? [applied] : [];

    const doomed = new Set([...droppedIds, ...removedIds(previous?.cards, clean)]);
    pinned.forEach((id) => doomed.delete(id));

    // Media over budget is freed too, oldest first, metadata left in place.
    // Cards already doomed do not count: their bytes are freed anyway.
    const victimIds = await readMediaIds(sourceId);
    doomed.forEach((id) => victimIds.delete(id));
    selectOverBudget(clean, { mediaIds: victimIds, pinnedIds: pinned }).forEach((id) => doomed.add(id));

    for (const id of doomed) {
        await releaseMedia(sourceId, id);
    }

    await saveToStore(cardsKey(sourceId), {
        version: CARDS_VERSION,
        appliedId,
        index: Math.max(0, Number(index) || 0),
        cards: clean,
    });

    return { cards: clean, freedIds: [...doomed] };
}

/**
 * Every media key that is still reachable: the cards of every source, plus the
 * wallpaper each one has applied while that card is still in its window (the
 * pinned one). Feed this to `sweepBlobs()`.
 * @returns {Promise<Set<string>>}
 */
export async function collectLiveKeys() {
    const keys = new Set();

    for (const key of await getAllKeys()) {
        if (!key.startsWith(CARDS_PREFIX)) continue;
        const sourceId = key.slice(CARDS_PREFIX.length);
        const record = await getFromStore(key);
        const cards = record?.cards || [];

        cards.forEach((card) => {
            if (card?.id && !isMoreCard(card)) keys.add(mediaKey(sourceId, card.id));
        });

        const applied = record?.appliedId ? String(record.appliedId) : null;
        if (applied && cards.some((card) => card?.id === applied)) keys.add(mediaKey(sourceId, applied));
    }

    return keys;
}
