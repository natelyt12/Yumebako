/**
 * SwitcherStore.js
 * ---------------------------------------------------------------------------
 * The carousel window of one source: the single source of truth for which cards
 * exist, which one is centered, and which one is on the desktop.
 *
 * It replaces the previous arrangement where a source held `items`, the
 * carousel held the *same array by reference*, and a virtual "+" slot lived
 * only in the DOM. Now there is one array, owned here, always ending in the
 * sentinel card (see ./cardSchema.js); a source only knows how to *produce*
 * cards and how to apply one.
 *
 * Everything that mutates the list goes through `persist()`, so the single
 * writer in ./cardStore.js can free the media of whatever leaves the window.
 * The store never keeps a reference to a caller's array.
 */
import { CARD_STATE, isMoreCard } from "./cardSchema.js";
import { loadCards, saveCards } from "./cardStore.js";

export class SwitcherStore {
    /**
     * @param {import("../sources/BaseSource.js").BaseSource} source - Owner of
     *     this window: its id keys the records, it produces the cards and it
     *     releases whatever cache a dropped card held.
     */
    constructor(source) {
        this.source = source;
        /** @type {Array<Object>} Wallpapers plus the trailing sentinel. */
        this.cards = [];
        /** Centered card, restored on the next launch. */
        this.index = 0;
        /** Card currently applied to the desktop; its media is pinned. */
        this.appliedId = null;
        /** Runtime state of the sentinel: see `CARD_STATE`. */
        this.moreState = CARD_STATE.IDLE;
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

    /** Wallpapers only — what the carousel shows as real cards. */
    get items() {
        return this.cards.filter((card) => !isMoreCard(card));
    }

    /** The trailing "+" slot, or null when the source cannot produce more. */
    get sentinel() {
        return this.cards.find(isMoreCard) || null;
    }

    /**
     * Read the persisted window and, when it holds no wallpaper yet, seed it.
     * Cards that came back without a usable thumbnail get one built locally, so
     * a reopened switcher is never a row of blank cards.
     * @returns {Promise<SwitcherStore>}
     */
    async open() {
        const { cards, appliedId, index } = await loadCards(this.sourceId);
        this.cards = cards;
        this.appliedId = appliedId;
        this.index = Math.max(0, Math.min(index, cards.length - 1));

        if (this.items.length === 0) {
            await this.seed();
        } else {
            await this._prepareThumbs(this.items);
        }

        this.isOpen = true;
        return this;
    }

    /** Pull the opening card(s) from the source (first launch, empty window). */
    async seed() {
        const cards = await this.source.fetchCards();
        if (!cards?.length) return this.persist();

        this.cards = this._insert(cards);
        this.index = this._indexOf(cards[0], 0);
        return this.persist();
    }

    /**
     * Ask the source for the next card(s) and paint them **into the slot the
     * sentinel occupies**: the "+" the user activated becomes a wallpaper, and a
     * fresh "+" takes its place at the end of the window. The stage therefore
     * never has to move.
     *
     * @returns {Promise<Array<Object>|null>} The cards that were materialized, `[]`
     *     when the feed has nothing left to give (the "+" retires), or `null`
     *     when this round was aborted (a cancelled file picker) and may be retried.
     */
    async fill() {
        const cards = await this.source.fetchMore();
        if (!cards?.length) return cards ?? null;

        // The sentinel sits last, so appending in front of it lands the new cards
        // exactly where it was.
        const firstIndex = this.cards.length - 1;
        this.cards = this._insert(cards);
        await this.persist();

        // Report the slot the new cards took so the view can land on them.
        return this.cards.slice(firstIndex, firstIndex + cards.length);
    }

    /**
     * Drop a card from the window. Non-destructive for the backend: the
     * wallpaper simply stops being offered while browsing.
     *
     * @param {string} cardId
     * @param {Object} [options]
     * @param {string} [options.focusId] - Card to center afterwards, e.g. the
     *     neighbour the desktop just fell back to.
     * @param {string} [options.appliedId] - Wallpaper the desktop ended up on.
     */
    async remove(cardId, { focusId, appliedId } = {}) {
        this.cards = this.cards.filter((card) => card.id !== cardId);

        // Resolved after the filter, so the neighbour keeps the slot it moved into.
        if (focusId) {
            const index = this.cards.findIndex((card) => card.id === focusId);
            if (index !== -1) this.index = index;
        }
        if (appliedId) this.appliedId = appliedId;

        return this.persist();
    }

    /** Centered card changed; remembered for the next launch. */
    async setIndex(index) {
        this.index = Math.max(0, Number(index) || 0);
        return this.persist();
    }

    /** A card became the desktop wallpaper; its media is pinned from now on. */
    async setApplied(cardId) {
        this.appliedId = cardId || null;
        return this.persist();
    }

    /**
     * Re-pull the whole window from the source, replacing what it holds. For
     * local feeds whose content can change behind our back (the collection).
     *
     * @param {Object} [options]
     * @param {string} [options.focusId] - Card to center afterwards, e.g. the
     *     neighbour the desktop just fell back to.
     * @param {string} [options.appliedId] - Wallpaper the desktop ended up on.
     */
    async refresh({ focusId, appliedId } = {}) {
        const cards = await this.source.fetchCards();
        const sentinel = this.sentinel;

        this.cards = sentinel ? [...cards, sentinel] : [...cards];
        this.isOpen = true;

        if (focusId) {
            const index = this.cards.findIndex((card) => card.id === focusId);
            if (index !== -1) this.index = index;
        }
        if (appliedId) this.appliedId = appliedId;

        await this._prepareThumbs(this.items);
        return this.persist();
    }

    /**
     * Record where the user settled: the centered card, plus the wallpaper that
     * just became the desktop background when one did. Settling back onto the
     * card that is already remembered costs no write.
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
     * never blank the cards that are on screen.
     */
    async persist() {
        const runtimeThumbs = new Map(this.cards.map((card) => [card.id, card.thumbnailUrl]));

        const { cards, freedIds } = await saveCards(this.sourceId, {
            cards: this.cards,
            appliedId: this.appliedId,
            index: this.index,
        });

        this.cards = cards.map((card) => {
            const url = runtimeThumbs.get(card.id);
            return url && url !== card.thumbnailUrl ? { ...card, thumbnailUrl: url } : card;
        });
        freedIds.forEach((id) => this.source.releaseCard(id));
        return this;
    }

    /** New cards go in front of the sentinel, oldest cards first. */
    _insert(cards) {
        const sentinel = this.sentinel ?? null;
        const items = this.items;
        const known = new Set(items.map((card) => card.id));
        const fresh = cards.filter((card) => card?.id && !known.has(card.id));

        return sentinel ? [...items, ...fresh, sentinel] : [...items, ...fresh];
    }

    /** Slot of a card in the window, falling back to `fallback` when absent. */
    _indexOf(card, fallback = 0) {
        const index = this.cards.findIndex((entry) => entry.id === card?.id);
        return index === -1 ? fallback : index;
    }

    /** Build the display thumbnail of cards that have none. */
    async _prepareThumbs(cards) {
        await Promise.all(
            cards.filter((card) => !card.thumbnailUrl).map((card) => this.source.prepareThumb(card))
        );
    }
}
