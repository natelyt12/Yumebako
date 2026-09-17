/**
 * SwitcherStore.js
 * ---------------------------------------------------------------------------
 * The carousel window of one source: the single source of truth for which items
 * exist, which one is centered, and which one is on the desktop.
 *
 * It replaces the previous arrangement where a source held `items`, the
 * carousel held the *same array by reference*, and a virtual "+" slot lived
 * only in the DOM. Now there is one array, owned here, always ending in the
 * sentinel item (see ./carouselSchema.js); a source only knows how to *produce*
 * items and how to apply one.
 *
 * Everything that mutates the list goes through `persist()`, so the single
 * writer in ./carouselStore.js can free the media of whatever leaves the window.
 * The store never keeps a reference to a caller's array.
 */
import { ITEM_STATE, isMoreItem } from "./carouselSchema.js";
import { loadCarousel, saveCarousel } from "./carouselStore.js";

export class SwitcherStore {
    /**
     * @param {import("../sources/BaseSource.js").BaseSource} source - Owner of
     *     this window: its id keys the records, it produces the items and it
     *     releases whatever cache a dropped item held.
     */
    constructor(source) {
        this.source = source;
        /** @type {Array<Object>} Wallpapers plus the trailing sentinel. */
        this.carouselItems = [];
        /** Centered item, restored on the next launch. */
        this.index = 0;
        /** Item currently applied to the desktop; its media is pinned. */
        this.appliedId = null;
        /** Runtime state of the sentinel: see `ITEM_STATE`. */
        this.moreState = ITEM_STATE.IDLE;
        /**
         * Set while a user action is changing the backend the window mirrors.
         * Reactive listeners (e.g. the collection's update event) check it to
         * avoid redrawing the window on a slot that is about to shift.
         */
        this.isMutating = false;
        /** Whether the persisted window has been read yet. */
        this.isOpen = false;
    }

    get sourceId() {
        return this.source.id;
    }

    /** Wallpapers only — what the carousel shows as real items. */
    get items() {
        return this.carouselItems.filter((item) => !isMoreItem(item));
    }

    /** The trailing "+" slot, or null when the source cannot produce more. */
    get sentinel() {
        return this.carouselItems.find(isMoreItem) || null;
    }

    /**
     * Read the persisted window and, when it holds no wallpaper yet, seed it.
     * Items that came back without a usable thumbnail get one built locally, so
     * a reopened switcher is never a row of blank items.
     * @returns {Promise<SwitcherStore>}
     */
    async open() {
        const { items, appliedId, index } = await loadCarousel(this.sourceId);
        this.carouselItems = items;
        this.appliedId = appliedId;
        this.index = Math.max(0, Math.min(index, items.length - 1));

        if (this.items.length === 0) {
            await this.seed();
        } else {
            await this._prepareThumbs(this.items);
        }

        this.isOpen = true;
        return this;
    }

    /** Pull the opening item(s) from the source (first launch, empty window). */
    async seed() {
        const items = await this.source.fetchItems();
        if (!items?.length) return this.persist();

        this.carouselItems = this._insert(items);
        this.index = this._indexOf(items[0], 0);
        return this.persist();
    }

    /**
     * Ask the source for the next item(s) and paint them **into the slot the
     * sentinel occupies**: the "+" the user activated becomes a wallpaper, and a
     * fresh "+" takes its place at the end of the window. The stage therefore
     * never has to move.
     *
     * @returns {Promise<Array<Object>|null>} The items that were materialized, `[]`
     *     when the feed has nothing left to give (the "+" retires), or `null`
     *     when this round was aborted (a cancelled file picker) and may be retried.
     */
    async fill() {
        const items = await this.source.fetchMore();
        if (!items?.length) return items ?? null;

        // The sentinel sits last, so appending in front of it lands the new items
        // exactly where it was.
        const firstIndex = this.carouselItems.length - 1;
        this.carouselItems = this._insert(items);
        await this.persist();

        // Report the slot the new items took so the view can land on them.
        return this.carouselItems.slice(firstIndex, firstIndex + items.length);
    }

    /**
     * Drop an item from the window. Non-destructive for the backend: the
     * wallpaper simply stops being offered while browsing.
     *
     * @param {string} itemId
     * @param {Object} [options]
     * @param {string} [options.focusId] - Item to center afterwards, e.g. the
     *     neighbour the desktop just fell back to.
     * @param {string} [options.appliedId] - Wallpaper the desktop ended up on.
     */
    async remove(itemId, { focusId, appliedId } = {}) {
        this.carouselItems = this.carouselItems.filter((item) => item.id !== itemId);

        // Resolved after the filter, so the neighbour keeps the slot it moved into.
        if (focusId) {
            const index = this.carouselItems.findIndex((item) => item.id === focusId);
            if (index !== -1) this.index = index;
        }
        if (appliedId) this.appliedId = appliedId;

        return this.persist();
    }

    /** Centered item changed; remembered for the next launch. */
    async setIndex(index) {
        this.index = Math.max(0, Number(index) || 0);
        return this.persist();
    }

    /** An item became the desktop wallpaper; its media is pinned from now on. */
    async setApplied(itemId) {
        this.appliedId = itemId || null;
        return this.persist();
    }

    /**
     * Re-pull the whole window from the source, replacing what it holds. For
     * local feeds whose content can change behind our back (the collection).
     *
     * @param {Object} [options]
     * @param {string} [options.focusId] - Item to center afterwards, e.g. the
     *     neighbour the desktop just fell back to.
     * @param {string} [options.appliedId] - Wallpaper the desktop ended up on.
     */
    async refresh({ focusId, appliedId } = {}) {
        const items = await this.source.fetchItems();
        const sentinel = this.sentinel;

        this.carouselItems = sentinel ? [...items, sentinel] : [...items];
        this.isOpen = true;

        if (focusId) {
            const index = this.carouselItems.findIndex((item) => item.id === focusId);
            if (index !== -1) this.index = index;
        }
        if (appliedId) this.appliedId = appliedId;

        await this._prepareThumbs(this.items);
        return this.persist();
    }

    /**
     * Record where the user settled: the centered item, plus the wallpaper that
     * just became the desktop background when one did. Settling back onto the
     * item that is already remembered costs no write.
     */
    async remember({ index, appliedId } = {}) {
        const nextIndex = Number.isFinite(index) ? Math.max(0, index) : this.index;
        const nextApplied = appliedId || this.appliedId;
        if (nextIndex === this.index && nextApplied === this.appliedId) return this;

        this.index = nextIndex;
        this.appliedId = nextApplied;
        return this.persist();
    }

    /** Record the sentinel's runtime state (idle / loading / error / end). */
    setMoreState(state) {
        this.moreState = state;
    }

    /**
     * Write the window through the single writer, which frees what left it.
     *
     * The stored shape keeps only thumbnails that survive a reload (remote
     * URLs), so the ones generated locally are re-attached here: a persist must
     * never blank the items that are on screen.
     */
    async persist() {
        const runtimeThumbs = new Map(this.carouselItems.map((item) => [item.id, item.thumbnailUrl]));

        const { items, freedIds } = await saveCarousel(this.sourceId, {
            items: this.carouselItems,
            appliedId: this.appliedId,
            index: this.index,
        });

        this.carouselItems = items.map((item) => {
            const url = runtimeThumbs.get(item.id);
            return url && url !== item.thumbnailUrl ? { ...item, thumbnailUrl: url } : item;
        });
        freedIds.forEach((id) => this.source.releaseItem(id));
        return this;
    }

    /** New items go in front of the sentinel, oldest items first. */
    _insert(itemsToInsert) {
        const sentinel = this.sentinel ?? null;
        const currentItems = this.items;
        const known = new Set(currentItems.map((item) => item.id));
        const fresh = itemsToInsert.filter((item) => item?.id && !known.has(item.id));

        return sentinel ? [...currentItems, ...fresh, sentinel] : [...currentItems, ...fresh];
    }

    /** Slot of an item in the window, falling back to `fallback` when absent. */
    _indexOf(itemToFind, fallback = 0) {
        const index = this.carouselItems.findIndex((entry) => entry.id === itemToFind?.id);
        return index === -1 ? fallback : index;
    }

    /** Build the display thumbnail of items that have none. */
    async _prepareThumbs(itemsToPrepare) {
        await Promise.all(
            itemsToPrepare.filter((item) => !item.thumbnailUrl).map((item) => this.source.prepareThumb(item))
        );
    }
}
