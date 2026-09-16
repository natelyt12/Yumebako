/**
 * cardSchema.js
 * ---------------------------------------------------------------------------
 * Shape of the carousel list a source keeps in IndexedDB, and the invariants
 * that make it trustworthy.
 *
 * The list is a plain array of cards and the trailing "+" card is a real member
 * of it (`kind: "more"`) instead of a virtual slot invented by the view. That
 * keeps indices identical everywhere: whatever the array holds is what the
 * carousel renders, with no off-by-one tail slot.
 *
 * Persisted card (wallpaper):
 *     { id, kind: "item", source, url, sourceUrl, title, category, mediaType,
 *       thumbnailUrl, trackUrl, local, width, height, size, addedAt }
 * Persisted card (the "+" slot):
 *     { id: "<source>:more", kind: "more" }
 *
 * `url` is how a remote card resolves its media later; `local: true` marks a
 * card whose media is owned by the app itself (a collection file) and therefore
 * needs no URL. `trackUrl` is pinged when such an API requires it (Unsplash).
 *
 * `thumbnailUrl` is kept only when it is a remote http(s) URL: a locally
 * generated thumbnail is a `blob:` object URL that dies with the session and is
 * rebuilt from the persisted media instead.
 *
 * The four UI states (`idle | loading | error | end`) deliberately live in
 * memory only: a persisted "loading" would be a lie after a reload. Reading a
 * list therefore always yields a sentinel in `idle`.
 */

/** Version of the persisted list shape, bumped when the schema changes. */
export const CARDS_VERSION = 1;

/** The two kinds of card a list may contain. */
export const CARD_KIND = Object.freeze({
    /** A real wallpaper. Must carry enough data to be rendered and re-applied. */
    ITEM: "item",
    /** The trailing "+" slot. Never carries media. */
    MORE: "more",
});

/** Runtime state of the "+" card. Never persisted (see the file header). */
export const CARD_STATE = Object.freeze({
    /** Waiting for the user to reach it. */
    IDLE: "idle",
    /** A fetch is in flight. */
    LOADING: "loading",
    /** The last fetch failed; a retry is allowed. */
    ERROR: "error",
    /** The feed has nothing left to give: the "+" card should not be rendered. */
    END: "end",
});

/** How many real cards a source's window keeps (the sentinel is not counted). */
const MAX_CARDS = 25;

/** Full-size blobs kept per source before the oldest ones are freed. */
export const MAX_MEDIA_BYTES = 64 * 1024 * 1024;

/** Id of a source's sentinel card. */
function moreCardId(sourceId) {
    return `${sourceId}:more`;
}

/** Build a fresh "+" slot for a source. */
export function createMoreCard(sourceId) {
    return { id: moreCardId(sourceId), kind: CARD_KIND.MORE };
}

/** Whether a card is the trailing "+" slot. */
export function isMoreCard(card) {
    return card?.kind === CARD_KIND.MORE;
}

/**
 * Whether a card carries enough to be rendered offline and re-applied later.
 * A wallpaper needs an identity plus a way back to its media: a remote URL, or
 * the app's own storage (the collection).
 */
export function isUsableItem(card) {
    return card?.kind === CARD_KIND.ITEM && Boolean(card.id) && Boolean(card.url || card.local);
}

/** Kept on disk only when it survives a reload (i.e. it is not a `blob:` URL). */
function persistableThumb(url) {
    return /^https?:/i.test(url || "") ? url : "";
}

/** Coerce a stored wallpaper into the exact persisted shape. */
function sanitizeItem(card, sourceId) {
    return {
        id: String(card.id),
        kind: CARD_KIND.ITEM,
        source: card.source || sourceId,
        url: String(card.url),
        sourceUrl: card.sourceUrl || "",
        title: card.title || "",
        category: card.category || "",
        mediaType: card.mediaType === "video" ? "video" : "image",
        thumbnailUrl: persistableThumb(card.thumbnailUrl),
        trackUrl: persistableThumb(card.trackUrl),
        local: Boolean(card.local),
        width: Number(card.width) || 0,
        height: Number(card.height) || 0,
        size: Number(card.size) || 0,
        addedAt: Number(card.addedAt) || Date.now(),
    };
}

/**
 * Coerce any list into the invariant shape:
 *   - every entry is either a usable wallpaper or the sentinel,
 *   - the sentinel is unique and last,
 *   - at most `maxCards` wallpapers, the oldest dropped first.
 *
 * Callers use `droppedIds` to free the media of cards that are no longer
 * reachable, so no orphan blob can survive a broken list.
 *
 * @param {Array<Object>} list - Whatever was read from the store.
 * @param {string} sourceId
 * @param {Object} [options]
 * @param {number} [options.maxCards=MAX_CARDS]
 * @returns {{ cards: Array<Object>, droppedIds: Array<string> }}
 */
export function normalizeCards(list, sourceId, { maxCards = MAX_CARDS } = {}) {
    const raw = Array.isArray(list) ? list : [];
    const items = [];
    const seen = new Set();

    for (const entry of raw) {
        if (!isUsableItem(entry)) continue;
        const id = String(entry.id);
        if (seen.has(id)) continue;
        seen.add(id);
        items.push(sanitizeItem(entry, sourceId));
    }

    while (items.length > maxCards) items.shift();

    const cards = [...items, createMoreCard(sourceId)];

    // Whatever had an id in the stored list but did not survive normalization
    // is unreachable: report it so its blobs can be freed.
    const keptIds = new Set(cards.map((card) => card.id));
    const droppedIds = [];
    for (const entry of raw) {
        const id = entry?.id ? String(entry.id) : "";
        if (id && !keptIds.has(id) && !droppedIds.includes(id)) droppedIds.push(id);
    }

    return { cards, droppedIds };
}
