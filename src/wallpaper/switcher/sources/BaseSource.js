import { t } from "/src/core/i18n.js";

/**
 * BaseSource.js
 * ---------------------------------------------------------------------------
 * Headless data-adapter contract for the Wallpaper Switcher.
 *
 * A Source knows nothing about the DOM and owns no list: it just *produces*
 * cards (see ../stores/cardSchema.js) and knows how to apply one of them as
 * background. Which cards exist, in what order, for how long — that is the
 * store's job (../stores/SwitcherStore.js).
 */
export class BaseSource {
    /** @type {string} Unique source id, also used as the i18n key suffix. */
    static id = "base";
    /** @type {string} Fallback label when no locale entry exists. */
    static label = "Source";
    /**
     * Whether cards need a thumbnail generated from the full image. Enabled for
     * services without a thumbnail endpoint, so the carousel never has to decode
     * full-size bitmaps just to draw a card.
     */
    static generateThumbnail = false;

    constructor() {
        /** @type {boolean} Guard against concurrent fetches. */
        this.isLoading = false;
        /** @type {Set<string>} Object URLs owned by this source. */
        this._objectUrls = new Set();
    }

    get id() {
        return this.constructor.id;
    }

    /** Localized display name for the source tab. */
    get name() {
        return t(`wallpaper_switcher.source.${this.id}`, this.constructor.label);
    }

    /** Actions offered in the bottom button row, in display order. */
    get actions() {
        return [];
    }

    /** Whether `fetchMore()` can still produce cards. */
    get canGrow() {
        return false;
    }

    /** Label printed on the trailing "+" card, telling what it will do. */
    get moreLabel() {
        return "";
    }

    /**
     * Whether the "+" card must be clicked to produce anything. Sources that
     * open a native file picker need this: settling on the card stays inert and
     * only a real click (a user gesture) may open the dialog.
     */
    get moreNeedsGesture() {
        return false;
    }

    /**
     * Whether the window must be re-read every time it is shown. Local feeds
     * (the collection) change from other parts of the app; remote feeds keep the
     * window they already materialized.
     */
    get isVolatile() {
        return false;
    }

    /**
     * Whether the source can be browsed right now. Sources that need user
     * configuration (e.g. an API key) report false and their tab is hidden.
     */
    get isAvailable() {
        return true;
    }

    // ─── Producing cards ──────────────────────────────────────────────────────

    /**
     * @abstract
     * First card(s) of a window that has nothing yet. Usually one card: the
     * wallpaper the user already has, or a fresh one when there is none.
     * @returns {Promise<Array<Object>>} Cards, in display order.
     */
    async fetchCards() {
        return [];
    }

    /**
     * @abstract
     * Next card(s), requested when the user reaches the trailing "+".
     * @returns {Promise<Array<Object>|null>} Cards to append, `[]` when the feed
     *     has nothing left to give (the "+" card retires) or `null` when this
     *     round was aborted and may simply be retried (a cancelled file picker).
     */
    async fetchMore() {
        return null;
    }

    /**
     * Make sure the card can be drawn: the carousel only ever renders
     * thumbnails, never full-size images.
     * @param {Object} card
     * @returns {Promise<string|null>} The card's `thumbnailUrl`.
     */
    async prepareThumb(card) {
        return card?.thumbnailUrl || null;
    }

    // ─── Applying ─────────────────────────────────────────────────────────────

    /**
     * @abstract
     * Apply the given card item as the desktop background.
     * @param {Object} _item
     * @param {Object} [_options]
     * @param {boolean} [_options.firstRun] - Play the entrance animation instead of a fade.
     */
    async apply(_item, _options) {
        throw new Error(`[${this.id}] apply() must be implemented by the source.`);
    }

    /** Whether the given item is currently the applied background. */
    isActive(_item) {
        return false;
    }

    // ─── Item helpers (used by the action buttons) ────────────────────────────

    /**
     * Release whatever per-card cache this source holds. Called by the store
     * when a card leaves the window, so nothing outlives the card.
     * @param {string} _cardId
     */
    releaseCard(_cardId) {}

    /**
     * @abstract
     * Resolve the item's media as a Blob, for download / add-to-collection.
     * @returns {Promise<Blob|null>}
     */
    async getBlob(_item) {
        return null;
    }

    /** Canonical page URL of a card, opened by the "view source" action. */
    getSourceUrl(card) {
        return card?.sourceUrl || "";
    }

    // ─── Helpers ──────────────────────────────────────────────────────────────

    /** Build a card in the persisted shape (see ../stores/cardSchema.js). */
    toCard(raw, overrides = {}) {
        return {
            id: String(raw?.id ?? ""),
            kind: "item",
            source: this.id,
            url: "",
            sourceUrl: "",
            title: "",
            category: "",
            mediaType: "image",
            thumbnailUrl: null,
            trackUrl: "",
            local: false,
            width: 0,
            height: 0,
            size: 0,
            addedAt: Date.now(),
            ...overrides,
        };
    }

    /** Create (and track) an object URL for a blob, or null if not a blob. */
    _createObjectUrl(blob) {
        if (!(blob instanceof Blob)) return null;
        const url = URL.createObjectURL(blob);
        this._objectUrls.add(url);
        return url;
    }

    /** Revoke every tracked object URL. */
    _revokeAll() {
        this._objectUrls.forEach((url) => URL.revokeObjectURL(url));
        this._objectUrls.clear();
    }
}
