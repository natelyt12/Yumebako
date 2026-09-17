/**
 * carouselSchema.js
 * ---------------------------------------------------------------------------
 * Shape of the carousel list a source keeps in IndexedDB, and the invariants
 * that make it trustworthy.
 *
 * The list is a plain array of items and the trailing "+" item is a real member
 * of it (`kind: "more"`) instead of a virtual slot invented by the view. That
 * keeps indices identical everywhere: whatever the array holds is what the
 * carousel renders, with no off-by-one tail slot.
 *
 * Persisted item (wallpaper):
 *     { id, kind: "item", source, url, sourceUrl, title, category, mediaType,
 *       thumbnailUrl, trackUrl, local, width, height, size, addedAt }
 * Persisted item (the "+" slot):
 *     { id: "<source>:more", kind: "more" }
 *
 * `url` is how a remote item resolves its media later; `local: true` marks an
 * item whose media is owned by the app itself (a collection file) and therefore
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
export const CAROUSEL_VERSION = 1;

/** The two kinds of items a list may contain. */
export const ITEM_KIND = Object.freeze({
    /** A real wallpaper. Must carry enough data to be rendered and re-applied. */
    ITEM: "item",
    /** The trailing "+" slot. Never carries media. */
    MORE: "more",
});

/** Runtime state of the "+" item. Never persisted (see the file header). */
export const ITEM_STATE = Object.freeze({
    /** Waiting for the user to reach it. */
    IDLE: "idle",
    /** A fetch is in flight. */
    LOADING: "loading",
    /** The last fetch failed; a retry is allowed. */
    ERROR: "error",
    /** The feed has nothing left to give: the "+" item should not be rendered. */
    END: "end",
});

/** How many real items a source's window keeps (the sentinel is not counted). */
const MAX_ITEMS = 25;

/** Full-size blobs kept per source before the oldest ones are freed. */
export const MAX_MEDIA_BYTES = 64 * 1024 * 1024;

/** Id of a source's sentinel item. */
function moreItemId(sourceId) {
    return `${sourceId}:more`;
}

/** Build a fresh "+" slot for a source. */
export function createMoreItem(sourceId) {
    return { id: moreItemId(sourceId), kind: ITEM_KIND.MORE };
}

/** Whether an item is the trailing "+" slot. */
export function isMoreItem(item) {
    return item?.kind === ITEM_KIND.MORE;
}

/**
 * Whether an item carries enough to be rendered offline and re-applied later.
 * A wallpaper needs an identity plus a way back to its media: a remote URL, or
 * the app's own storage (the collection).
 */
export function isUsableItem(item) {
    return item?.kind === ITEM_KIND.ITEM && Boolean(item.id) && Boolean(item.url || item.local);
}

/** Kept on disk only when it survives a reload (i.e. it is not a `blob:` URL). */
function persistableThumb(url) {
    return /^https?:/i.test(url || "") ? url : "";
}

/** Coerce a stored wallpaper into the exact persisted shape. */
function sanitizeItem(item, sourceId) {
    return {
        id: String(item.id),
        kind: ITEM_KIND.ITEM,
        source: item.source || sourceId,
        url: String(item.url),
        sourceUrl: item.sourceUrl || "",
        title: item.title || "",
        category: item.category || "",
        mediaType: item.mediaType === "video" ? "video" : "image",
        thumbnailUrl: persistableThumb(item.thumbnailUrl),
        trackUrl: persistableThumb(item.trackUrl),
        local: Boolean(item.local),
        width: Number(item.width) || 0,
        height: Number(item.height) || 0,
        size: Number(item.size) || 0,
        addedAt: Number(item.addedAt) || Date.now(),
    };
}

/**
 * Coerce any list into the invariant shape:
 *   - every entry is either a usable wallpaper or the sentinel,
 *   - the sentinel is unique and last,
 *   - at most `maxItems` wallpapers, the oldest dropped first.
 *
 * Callers use `droppedIds` to free the media of items that are no longer
 * reachable, so no orphan blob can survive a broken list.
 *
 * @param {Array<Object>} list - Whatever was read from the store.
 * @param {string} sourceId
 * @param {Object} [options]
 * @param {number} [options.maxItems=MAX_ITEMS]
 * @returns {{ items: Array<Object>, droppedIds: Array<string> }}
 */
export function normalizeCarousel(list, sourceId, { maxItems = MAX_ITEMS } = {}) {
    const raw = Array.isArray(list) ? list : [];
    const validItems = [];
    const seen = new Set();

    for (const entry of raw) {
        if (!isUsableItem(entry)) continue;
        const id = String(entry.id);
        if (seen.has(id)) continue;
        seen.add(id);
        validItems.push(sanitizeItem(entry, sourceId));
    }

    while (validItems.length > maxItems) validItems.shift();

    const items = [...validItems, createMoreItem(sourceId)];

    // Whatever had an id in the stored list but did not survive normalization
    // is unreachable: report it so its blobs can be freed.
    const keptIds = new Set(items.map((item) => item.id));
    const droppedIds = [];
    for (const entry of raw) {
        const id = entry?.id ? String(entry.id) : "";
        if (id && !keptIds.has(id) && !droppedIds.includes(id)) droppedIds.push(id);
    }

    return { items, droppedIds };
}
