import { BaseSource } from "./BaseSource.js";
import { SOURCE_ACTIONS } from "./sourceActions.js";
import { getFromStore, saveToStore } from "/src/core/db.js";
import { readMedia, saveMedia } from "../stores/mediaStore.js";
import { getSettings } from "/src/core/storageHandler.js";
import { providerManager } from "/src/wallpaper/providers/ProviderManager.js";
import { generateImageThumbnail } from "/src/core/utils/thumbnailGenerator.js";
import { t } from "/src/core/i18n.js";

/** Resolve once the browser has the image decoded and ready to paint. */
function preloadImage(url) {
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = resolve;
        img.onerror = resolve;
        img.src = url;
    });
}

/**
 * RemoteSource.js
 * ---------------------------------------------------------------------------
 * Shared behaviour for sources backed by a remote API (Wallhaven, Unsplash,
 * Picre...). Subclasses only describe *how to fetch the next single item*
 * (`fetchItem()`) and where its original page lives (`getSourceUrl()`).
 *
 * Items are materialized lazily, one at a time, as the user scrolls onto the
 * trailing "+" card, and only *after* their thumbnail is ready — so a card is
 * never appended blank. How many stay in the window, and when the oldest media
 * is freed, is the store's business (../stores/SwitcherStore.js).
 *
 * Applying an item is handled here:
 *   1. resolve the media blob (cached, so download / add reuse it),
 *   2. persist it as the provider's `current` record so a reload restores it,
 *   3. hand the payload to ProviderManager for a silent (no-fade) apply.
 */
export class RemoteSource extends BaseSource {
    /** Provider id this source feeds. Defaults to the source id. */
    static providerId = "";
    /** IndexedDB key holding the provider's `{ queue, current }` record. */
    static storageKey = "";
    /** Full blobs kept in memory, so apply / download stay instant for recent cards. */
    static maxCachedBlobs = 6;

    constructor() {
        super();
        /** @type {Map<string, Blob>} Keeps resolved media so we never fetch twice. */
        this.blobCache = new Map();
        /** @type {Map<string, string>} Item id -> object URL of its generated thumbnail. */
        this.thumbCache = new Map();
    }

    get providerId() {
        return this.constructor.providerId || this.id;
    }

    get actions() {
        return [SOURCE_ACTIONS.download, SOURCE_ACTIONS.source, SOURCE_ACTIONS.removeFromCarousel, SOURCE_ACTIONS.add];
    }

    get canGrow() {
        return true;
    }

    get moreLabel() {
        return t("wallpaper_switcher.get_new_image", "Lấy ảnh mới");
    }

    // ─── Producing cards ──────────────────────────────────────────────────────

    /**
     * The window opens either on the wallpaper this source already applied (its
     * legacy `current` record, whose blob sits in IndexedDB) or, when there is
     * none, on one freshly fetched card. Either way the carousel opens on the
     * exact wallpaper that is on the desktop, and a reload never rolls a new
     * random image on the user.
     */
    async fetchCards() {
        // A rebuilt list invalidates every previously generated thumbnail and
        // every cached blob, since those items are gone.
        [...this.thumbCache.keys()].forEach((id) => this._releaseThumb(id));
        this.blobCache.clear();

        const card = (await this.fetchSeedCard()) || (await this.fetchNext());
        return card ? [card] : [];
    }

    /** One more card, requested when the user reaches the trailing "+". */
    async fetchMore() {
        if (this.isLoading) return null;
        this.isLoading = true;
        try {
            const card = await this.fetchNext();
            // An empty list is a real answer here: the feed had nothing to give.
            return card ? [card] : [];
        } finally {
            this.isLoading = false;
        }
    }

    /**
     * The wallpaper this source last applied, read back from the legacy
     * `current` record. Its blob already sits in IndexedDB, so this card costs
     * no network at all.
     * @returns {Promise<Object|null>}
     */
    async fetchSeedCard() {
        const key = this.constructor.storageKey;
        if (!key) return null;

        const current = (await getFromStore(key))?.current;
        if (!current?.image || !(current.blob instanceof Blob)) return null;

        const id = String(current.id ?? current.image);
        this.blobCache.set(id, current.blob);

        const card = this.toCard(current, {
            id,
            url: current.image,
            sourceUrl: current.source || "",
            title: this.getSeedTitle(current),
            category: current.category || "",
            thumbnailUrl: current.image,
            mediaType: "image",
            width: current.width || 0,
            height: current.height || 0,
            size: current.size || current.blob.size,
            addedAt: current.last_updated || Date.now(),
        });

        await this.prepareThumb(card);
        return card;
    }

    /** Card title of the restored wallpaper. Overridden per source. */
    getSeedTitle(current) {
        return current.category || "";
    }

    /**
     * Materialize the next card: resolve its metadata, make sure its thumbnail
     * is ready, and only then hand it back.
     * @returns {Promise<Object|null>}
     */
    async fetchNext() {
        const card = await this.fetchItem();
        if (!card) return null;

        await this.prepareThumb(card);
        return card;
    }

    /**
     * @abstract
     * @returns {Promise<Object|null>} The next card, in the persisted shape.
     */
    async fetchItem() {
        return null;
    }

    // ─── Thumbnails ───────────────────────────────────────────────────────────

    /**
     * Ensure the card has a renderable thumbnail. Sources without a thumbnail
     * endpoint download the full image once and derive a small JPEG from it;
     * the rest just preload their CDN thumbnail. Either way the card is only
     * appended after this resolves.
     *
     * The stored media counts as "at hand" too: after a reload, or when the
     * remote thumbnail is unreachable, a thumbnail built from it costs no
     * network at all.
     *
     * A locally generated thumbnail is a `blob:` URL: it dies with the session
     * and is rebuilt from the stored media on the next one.
     * @param {Object} card
     * @returns {Promise<string|null>} The card's `thumbnailUrl`.
     */
    async prepareThumb(card) {
        if (!card) return null;
        if (card.thumbnailUrl?.startsWith("blob:")) return card.thumbnailUrl;

        // The full image, when it is already at hand: in memory, or on disk. Read
        // from the store only when a local thumbnail is needed anyway — i.e. the
        // source has no thumbnail endpoint, or the card has none to show.
        let media = this.blobCache.get(card.id) || null;
        if (!media && (this.constructor.generateThumbnail || !card.thumbnailUrl)) {
            media = await readMedia(this.id, card.id).catch(() => null);
        }
        if (!media && this.constructor.generateThumbnail) {
            media = await this.getBlob(card).catch(() => null);
        }

        if (media?.type.startsWith("image/")) {
            // If the canvas round-trip fails, keep the URL the card came with, so
            // it still shows something instead of dropping the card.
            const generated = await this._buildThumbnail(card.id, media).catch(() => null);
            if (generated) card.thumbnailUrl = generated;
        }

        if (card.thumbnailUrl) await preloadImage(card.thumbnailUrl);
        return card.thumbnailUrl || null;
    }

    /** Generate (once per card) a small JPEG used to draw the card. */
    async _buildThumbnail(id, blob) {
        if (this.thumbCache.has(id)) return this.thumbCache.get(id);

        const url = this._createObjectUrl(await generateImageThumbnail(blob));
        if (url) this.thumbCache.set(id, url);
        return url;
    }

    /** Revoke a generated thumbnail that is no longer needed. */
    _releaseThumb(id) {
        const url = this.thumbCache.get(id);
        if (!url) return;
        URL.revokeObjectURL(url);
        this._objectUrls.delete(url);
        this.thumbCache.delete(id);
    }

    /** Forget the cached media of a card that left the carousel window. */
    releaseCard(id) {
        this.blobCache.delete(id);
        this._releaseThumb(id);
    }

    isActive(card) {
        const config = getSettings().wallpaperConfig || {};
        return config.source === this.providerId && config.activeWallpaperId === card.id;
    }

    async apply(card, { firstRun = false } = {}) {
        // Resolve the media first. The overlay cycle only starts once the image
        // is in hand, so the cross-fade always covers a swap that can happen
        // immediately — never a download that may take seconds.
        const blob = await this.getBlob(card);
        if (!blob) {
            throw new Error(t("wallpaper_switcher.error.no_url", "Không tìm thấy đường dẫn ảnh."));
        }

        const payload = this.buildPayload(card, blob);
        await providerManager.applyExternalData(payload, this.providerId, { firstRun });

        // Keep the legacy `current` record in step while both systems run side by
        // side: the old settings panel and its boot fallback still read it.
        try {
            await this.persistCurrent(payload);
        } catch (error) {
            console.error(`[${this.id}] Failed to persist the applied wallpaper:`, error);
        }
    }

    // ─── Item helpers ─────────────────────────────────────────────────────────

    /**
     * Resolve the card's full resolution media, cheapest source first:
     *
     *   1. the in-memory cache (apply / download stay instant for recent cards),
     *   2. the persisted media — this is what makes a reopened switcher instant
     *      and what lets sources without a thumbnail endpoint rebuild their
     *      thumbnails at no network cost,
     *   3. the network, in which case the result is persisted for next time.
     */
    async getBlob(card) {
        if (!card?.id) return null;
        if (this.blobCache.has(card.id)) return this.blobCache.get(card.id);

        const stored = await readMedia(this.id, card.id);
        if (stored) return this._cacheBlob(card.id, stored);

        if (!card.url) return null;

        const response = await fetch(card.url, { mode: "cors" });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const blob = await response.blob();
        await saveMedia(this.id, card.id, blob);
        return this._cacheBlob(card.id, blob);
    }

    /**
     * Keep a resolved blob in memory, oldest evicted first. A full window of
     * full resolution images would otherwise sit in memory forever.
     */
    _cacheBlob(id, blob) {
        this.blobCache.set(id, blob);
        while (this.blobCache.size > this.constructor.maxCachedBlobs) {
            this.blobCache.delete(this.blobCache.keys().next().value);
        }
        return blob;
    }

    /** Build the provider-shaped payload consumed by ProviderManager. */
    buildPayload(card, blob) {
        return {
            id: card.id,
            blob,
            type: card.mediaType === "video" ? "video" : "image",
            image: card.url,
            source: card.sourceUrl,
            width: card.width,
            height: card.height,
            size: blob.size,
            category: card.category,
            metadata: {
                provider: this.providerId,
                providerName: this.name,
                source: card.sourceUrl,
                url: card.url,
            },
        };
    }

    // ─── Legacy persistence ───────────────────────────────────────────────────

    /**
     * Mirror the applied wallpaper into the provider's legacy `current` record.
     * Only needed while the legacy providers run in parallel; the switcher's own
     * truth is `cards:<sourceId>` plus the persisted media.
     */
    async persistCurrent(payload) {
        const key = this.constructor.storageKey;
        if (!key) return;

        const storeData = (await getFromStore(key)) || { queue: [], current: null };
        storeData.current = {
            id: payload.id,
            image: payload.image,
            blob: payload.blob,
            source: payload.source,
            width: payload.width,
            height: payload.height,
            size: payload.size,
            category: payload.category,
            last_updated: Date.now(),
            queue_left: Array.isArray(storeData.queue) ? storeData.queue.length : 0,
            queue_total: storeData.queue_total,
        };
        await saveToStore(key, storeData);
    }
}
