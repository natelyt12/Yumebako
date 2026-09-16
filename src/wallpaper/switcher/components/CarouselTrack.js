import { renderIcons, Icons } from "/src/core/icon.js";
import { CARD_KIND, CARD_STATE } from "../stores/cardSchema.js";

const FALLBACK_THUMB = "/image/fallback.jpg";

/**
 * CarouselTrack.js
 * ---------------------------------------------------------------------------
 * Owns everything about *how cards are laid out*: the card DOM, the width curve
 * around the centered card, the LERP inertia glide, and the wheel / click
 * navigation.
 *
 * It knows nothing about where the cards come from. It receives the window just
 * as it is stored — the trailing "+" is an ordinary member of that list
 * (`kind: "more"`, see ../stores/cardSchema.js), never a slot the view invents
 * — so a slot index always means the same thing to the view and to the data.
 * A settled index is reported back through `onSettle`, which the orchestrator
 * turns into an actual wallpaper apply.
 */
export class CarouselTrack {
    /**
     * @param {Object} options
     * @param {HTMLElement} options.container - Fullscreen element used for measuring and clipping.
     * @param {HTMLElement} options.track - The translated flex row that holds the cards.
     * @param {number} [options.selectedWidth=600] - Width of the centered card, in px.
     * @param {number} [options.gap=12] - Fallback gap when `--card-gap` is not set.
     * @param {(index: number, item: Object|null) => void} [options.onSettle] - Called when the glide stops.
     * @param {() => void} [options.onMoreAction] - Called when the "+" card's button is clicked.
     * @param {(card: Object) => Promise<string|null>} [options.onCardThumbError] - Asked to rebuild a
     *     thumbnail that failed to load. Resolving null means nothing could be done.
     */
    constructor({ container, track, selectedWidth = 600, gap = 12, onSettle, onMoreAction, onCardThumbError }) {
        this.container = container;
        this.track = track;
        this.selectedWidth = selectedWidth;
        this.fallbackGap = gap;
        this.onSettle = onSettle;
        this.onMoreAction = onMoreAction;
        this.onCardThumbError = onCardThumbError;

        /** @type {Array<Object>} The window as stored: wallpapers plus the sentinel. */
        this.cards = [];
        /** Label printed on the "+" card, owned by the orchestrator. */
        this.moreLabel = "";
        /** Runtime state of the "+" card: idle / loading / error. */
        this.moreState = CARD_STATE.IDLE;
        /** Whether that card acts on click only (see BaseSource.moreNeedsGesture). */
        this.moreNeedsGesture = false;
        this.selectedIndex = 0;

        // LERP inertia state
        this.currentOffset = 0;
        this.targetOffset = 0;
        this.isAnimating = false;
        this._rafId = null;
        /** Whether the in-flight glide should report its result. */
        this._notifyOnSettle = false;

        // Navigation cooldown (ms), applied separately to wheel and arrow keys
        this.navCooldown = 80;
        this._lastWheelTime = 0;
        this._lastKeyTime = 0;
        this._wheelAccum = 0;
        this._wheelAccumTimer = null;

        // Dirty no-hover: hover is dropped as soon as the user scrolls, and only
        // restored once the pointer actually moves to a new position.
        this._isHoverDirty = false;
        this._lastMouseX = -1;
        this._lastMouseY = -1;

        this._onWheel = this._onWheel.bind(this);
        this._onMouseMove = this._onMouseMove.bind(this);

        this.container?.addEventListener("wheel", this._onWheel, { passive: false });
        window.addEventListener("mousemove", this._onMouseMove);
    }

    // ─── Public API ───────────────────────────────────────────────────────────

    /** The card sitting in the centre. */
    get selectedCard() {
        return this.cards[this.selectedIndex] || null;
    }

    /** Whether the centered card is the trailing "+". */
    get selectedIsMore() {
        return this.selectedCard?.kind === CARD_KIND.MORE;
    }

    get isEmpty() {
        return this.cards.length === 0;
    }

    /**
     * Replace the window, rebuild the DOM and snap to `index` without triggering
     * an apply (the caller decides what should be shown).
     *
     * The list is copied: the view never holds a reference to the caller's array,
     * so nothing the store does later can change what is on screen behind our back.
     *
     * This is a hard redraw, used when the window as a whole changed (opening the
     * switcher, switching tabs). A list mutation that happens while the user is
     * watching goes through `animateInsertCard` / `animateRemoveCard` instead,
     * which keep the existing card elements alive and let them move into place.
     *
     * @param {Array<Object>} cards - Wallpapers plus the sentinel, in display order.
     * @param {number} [index=0]
     */
    setCards(cards, index = 0) {
        this.cards = Array.isArray(cards) ? [...cards] : [];
        this.selectedIndex = this._clamp(index);
        this._render();
        this.recenter({ smooth: false, notify: false });
    }

    /**
     * Re-apply one card's runtime presentation (its pending veil) without
     * rebuilding the track. Called when a card's wallpaper has landed.
     * @param {string} cardId
     */
    refreshCard(cardId) {
        const card = this.cards.find((entry) => entry.id === cardId);
        const el = this._cardElement(cardId);
        if (!card || !el) return;

        const pending = Boolean(card.pending);
        el.classList.toggle("is_pending", pending);
        el.classList.toggle("is_revealing", !pending);
    }

    /**
     * Presentation of the trailing "+" card: its label and its state. Changing
     * it updates that one card in place, so the cooldown countdown can rewrite
     * it a few times a second without rebuilding anything.
     *
     * @param {Object} [more]
     * @param {string} [more.state] - One of `CARD_STATE` (END means "not rendered").
     * @param {string} [more.label]
     * @param {boolean} [more.needsGesture]
     */
    setMore({ state = this.moreState, label = this.moreLabel, needsGesture = this.moreNeedsGesture } = {}) {
        this.moreState = state;
        this.moreLabel = label;
        this.moreNeedsGesture = Boolean(needsGesture);
        this._syncMoreCard();
    }

    /**
     * Move to an absolute index and glide there.
     * @param {number} index
     * @param {Object} [options]
     * @param {boolean} [options.smooth=true] - Animate instead of snapping.
     * @param {boolean} [options.applyNow=false] - Skip the glide and settle at once.
     */
    goTo(index, { smooth = true, applyNow = false } = {}) {
        if (this.isEmpty) return;

        this.selectedIndex = this._clamp(index);
        this.recenter({ smooth, notify: !applyNow && smooth });

        if (applyNow || !smooth) this._settle();
    }

    /** Relative move, used by wheel and arrow keys. */
    step(delta, { smooth = true } = {}) {
        this.goTo(this.selectedIndex + delta, { smooth });
    }

    /** Relative move driven by a key press, throttled by the navigation cooldown. */
    stepByKey(delta) {
        const now = performance.now();
        if (now - this._lastKeyTime < this.navCooldown) return;
        this._lastKeyTime = now;
        this.step(delta);
    }

    /**
     * Recompute the geometry for the current index (used on resize and open).
     * @param {Object} [options]
     * @param {boolean} [options.smooth=false] - Glide instead of snapping.
     * @param {boolean} [options.notify=false] - Report the settle to `onSettle`.
     */
    recenter({ smooth = false, notify = false } = {}) {
        if (!this.track || !this.container || this.isEmpty) return;

        // Geometry follows the card list, not the DOM order: the array is the
        // truth, so an extra element (a ghost, a card animating out) can never
        // shift the distances of the cards that matter.
        this.cards.forEach((card, index) => {
            const el = this._cardElement(card.id);
            if (!el) return;

            if (el.classList.contains("is_removing") || el.classList.contains("is_inserting")) return;

            const distance = Math.abs(index - this.selectedIndex);
            const width = this._cardWidth(distance);

            el.classList.toggle("selected", distance === 0);
            el.dataset.distance = distance;
            el.style.width = `${width}px`;
            el.style.flexBasis = `${width}px`;
        });

        const gap = this._gap();

        // Sum the widths of every card before the selected one to find its center.
        let offsetToSelected = 0;
        for (let i = 0; i < this.selectedIndex; i++) {
            offsetToSelected += this._cardWidth(Math.abs(i - this.selectedIndex)) + gap;
        }

        const cardCenter = offsetToSelected + this._cardWidth(0) / 2;
        const containerWidth = this.container.clientWidth || window.innerWidth;
        this.targetOffset = containerWidth / 2 - cardCenter;

        if (!smooth) {
            this._cancelAnimation();
            this.currentOffset = this.targetOffset;
            this._translate();
        } else {
            this._notifyOnSettle = notify;
            this._startAnimation();
        }

        // Card widths just changed, so the "+" label may no longer fit.
        this._updateMoreFit();
    }

    /** The flex row's gap, read back from CSS so the math matches the layout. */
    _gap() {
        return parseFloat(getComputedStyle(this.container).getPropertyValue("--card-gap")) || this.fallbackGap;
    }

    /** Cancel any in-flight glide and drop the dirty-hover state. */
    stop() {
        this._cancelAnimation();
        this._resetHover();
    }

    /**
     * Directly animate a card out and smoothly glide to the next selection.
     * Does NOT rebuild or wipe the track DOM.
     * @param {string} cardId
     * @param {Object} [options]
     * @param {string} [options.focusId] - Card that should end up centered, e.g.
     *     the neighbour the desktop fell back to.
     * @returns {Promise<void>}
     */
    async animateRemoveCard(cardId, { focusId } = {}) {
        const index = this.cards.findIndex((c) => c.id === cardId);
        if (index === -1) return;

        const el = this._cardElement(cardId);

        this.cards.splice(index, 1);

        // Where the selection lands. The caller names the card it wants centered,
        // and a name survives the splice: an index measured before the removal is
        // off by one whenever that neighbour sat to the right of the card leaving.
        const focusIndex = focusId ? this.cards.findIndex((c) => c.id === focusId) : -1;
        let nextIndex = focusIndex;
        if (nextIndex === -1) {
            if (this.selectedIndex === index) {
                nextIndex = index > 0 ? index - 1 : 0;
            } else if (this.selectedIndex > index) {
                nextIndex = this.selectedIndex - 1;
            } else {
                nextIndex = this.selectedIndex;
            }
        }
        this.selectedIndex = this._clamp(nextIndex);

        if (el) {
            el.classList.add("is_removing");
            const cleanup = () => {
                el.remove();
                el.removeEventListener("transitionend", onEnd);
            };
            const onEnd = (e) => {
                if (e.target === el && (e.propertyName === "width" || e.propertyName === "transform")) {
                    cleanup();
                }
            };
            el.addEventListener("transitionend", onEnd);
            setTimeout(cleanup, 450);
        }

        this.recenter({ smooth: true, notify: false });
        await new Promise((resolve) => setTimeout(resolve, 380));
    }

    /**
     * Directly insert a new card before the '+' card with a smooth expansion animation.
     * Does NOT rebuild or wipe the track DOM.
     * @param {Object} cardItem
     * @param {Object} [options]
     * @param {boolean} [options.following=false] - Whether to glide and select this new card.
     * @param {Array<string>} [options.droppedIds=[]] - Old card IDs evicted due to capacity.
     * @returns {Promise<void>}
     */
    async animateInsertCard(cardItem, { following = false, droppedIds = [] } = {}) {
        if (!cardItem || !this.track) return;

        // Evict any dropped cards at the start of the list
        if (droppedIds && droppedIds.length) {
            droppedIds.forEach((id) => {
                const dropIdx = this.cards.findIndex((c) => c.id === id);
                const dropEl = this._cardElement(id);
                if (dropIdx !== -1) {
                    this.cards.splice(dropIdx, 1);
                    if (this.selectedIndex > dropIdx) {
                        this.selectedIndex = Math.max(0, this.selectedIndex - 1);
                    }
                }
                if (dropEl) {
                    dropEl.classList.add("is_removing");
                    setTimeout(() => dropEl.remove(), 450);
                }
            });
        }

        // Insert position: before sentinel if present, else at end
        const sentinelIndex = this.cards.findIndex((c) => c.kind === CARD_KIND.MORE);
        const insertIndex = sentinelIndex !== -1 ? sentinelIndex : this.cards.length;

        // Create DOM element
        const el = this._createCard(cardItem);
        el.classList.add("is_inserting");

        if (this._moreCard && this._moreCard.parentNode === this.track) {
            this.track.insertBefore(el, this._moreCard);
        } else {
            this.track.appendChild(el);
        }

        renderIcons(el);

        // Update cards array
        this.cards.splice(insertIndex, 0, cardItem);

        if (following) {
            this.selectedIndex = insertIndex;
        }

        // Trigger expansion on next frame
        await new Promise((resolve) => requestAnimationFrame(resolve));

        el.classList.remove("is_inserting");
        this.recenter({ smooth: true, notify: false });
    }

    /**
     * Animate out and remove the '+' card when the feed has ended.
     */
    animateRemoveMore() {
        if (!this._moreCard) return;
        const moreEl = this._moreCard;
        this._moreCard = null;

        const moreIdx = this.cards.findIndex((c) => c.kind === CARD_KIND.MORE);
        if (moreIdx !== -1) {
            this.cards.splice(moreIdx, 1);
            this.selectedIndex = this._clamp(this.selectedIndex);
        }

        moreEl.classList.add("is_removing");
        setTimeout(() => moreEl.remove(), 450);
        this.recenter({ smooth: true, notify: false });
    }

    // ─── Card rendering ───────────────────────────────────────────────────────

    /** Width of a card at `distance` steps from the centered one. */
    _cardWidth(distance) {
        if (distance === 0) return this.selectedWidth;
        // The neighbour card (distance = 1) is 40% wide, then it decays evenly
        // down to a 5% floor.
        const ratio = Math.max(0.05, 0.4 * Math.pow(0.55, distance - 1));
        return Math.round(this.selectedWidth * ratio);
    }

    _render() {
        if (!this.track) return;

        if (this.isEmpty) {
            this.track.style.display = "none";
            this.track.innerHTML = "";
            this._moreCard = null;
            return;
        }

        this.track.style.display = "flex";
        this.track.innerHTML = "";
        this._moreCard = null;

        this.cards.forEach((card) => {
            const el = card?.kind === CARD_KIND.MORE ? this._createMoreCard(card) : this._createCard(card);
            this.track.appendChild(el);
        });

        renderIcons(this.track);
        this._syncMoreCard();
    }

    /** Trailing "+" card: centering it makes the source produce the next card. */
    _createMoreCard(card) {
        const el = document.createElement("div");
        el.className = "wallpaper_card wallpaper_card_more";
        el.dataset.id = card.id;
        el.innerHTML = `<i data-icon="addMore"></i>`;

        // The label sits in its own absolutely placed slot: changing it never
        // moves the "+", and the spinner can take the "+" place on its own.
        const slot = document.createElement("div");
        slot.className = "wallpaper_card_more_slot";

        const text = document.createElement("span");
        text.className = "wallpaper_card_more_label";
        slot.appendChild(text);
        el.appendChild(slot);

        // Absolutely centred, i.e. exactly where the "+" is drawn.
        const spinner = document.createElement("span");
        spinner.className = "wallpaper_card_spinner";
        el.appendChild(spinner);

        el.addEventListener("click", () => {
            // A source that opens a native dialog only gets permission to do so
            // from the click itself, so its card acts immediately instead of
            // gliding first (settling on it stays inert — see handleSettle).
            if (this.moreNeedsGesture) {
                this.onMoreAction?.();
                return;
            }
            const currentIndex = this.cards.findIndex((entry) => entry.kind === CARD_KIND.MORE);
            if (currentIndex !== -1) {
                this.goTo(currentIndex);
            }
        });

        // The card width animates: re-measure the label once it has settled.
        el.addEventListener("transitionend", (event) => {
            if (event.target === el && event.propertyName === "width") this._updateMoreFit();
        });

        this._moreCard = el;
        return el;
    }

    /**
     * Push the current label / state onto the rendered "+" card, in place.
     * Used both after a re-render and for live updates such as the countdown.
     */
    _syncMoreCard() {
        if (!this._moreCard) return;

        this._moreCard.classList.toggle("is_loading", this.moreState === CARD_STATE.LOADING);
        this._moreCard.classList.toggle("is_error", this.moreState === CARD_STATE.ERROR);

        const label = this._moreCard.querySelector(".wallpaper_card_more_label");
        if (label && label.textContent !== this.moreLabel) label.textContent = this.moreLabel;

        this._updateMoreFit();
    }

    /**
     * Hide the label as soon as it stops fitting, instead of letting the card
     * show a truncated one: the "+" alone reads better than "Lấy ảnh mớ…".
     */
    _updateMoreFit() {
        const label = this._moreCard?.querySelector(".wallpaper_card_more_label");
        if (!label) return;

        // Measure in the unclipped state — a hidden element reports a zero box.
        label.classList.remove("is_clipped");
        label.classList.toggle("is_clipped", label.scrollWidth > label.clientWidth + 1);
    }

    /**
     * A card thumbnail can fail for reasons the card is still able to recover
     * from: the remote thumbnail is unreachable, while the full media may already
     * be stored — and then a local thumbnail is free to build. Only when nothing
     * can be done does the card show the generic placeholder.
     * @param {HTMLImageElement} img
     * @param {Object} card
     */
    async _recoverThumb(img, card) {
        // Disarm first: a second failure simply gives up on the placeholder.
        img.onerror = () => { img.src = FALLBACK_THUMB; };

        let rebuilt = null;
        try {
            rebuilt = await this.onCardThumbError?.(card);
        } catch (error) {
            console.error("[CarouselTrack] Thumbnail recovery failed:", error);
        }

        img.src = rebuilt || FALLBACK_THUMB;
    }

    _createCard(item) {
        const card = document.createElement("div");
        card.className = "wallpaper_card";
        card.dataset.id = item.id;

        if (item.pending) card.classList.add("is_pending");

        const viewport = document.createElement("div");
        viewport.className = "wallpaper_card_viewport";

        if (item.mediaType === "video") {
            const video = document.createElement("video");
            video.className = "wallpaper_card_img";
            video.src = item.thumbnailUrl || "";
            video.muted = true;
            video.loop = true;
            video.playsInline = true;
            video.autoplay = true;
            viewport.appendChild(video);
        } else {
            const img = document.createElement("img");
            img.className = "wallpaper_card_img";
            img.src = item.thumbnailUrl || FALLBACK_THUMB;
            img.alt = item.title || "";
            img.loading = "lazy";
            img.onerror = () => this._recoverThumb(img, item);
            viewport.appendChild(img);
        }

        const overlay = document.createElement("div");
        overlay.className = "wallpaper_card_overlay";

        const titleRow = document.createElement("div");
        titleRow.className = "wallpaper_card_title_row";

        const title = document.createElement("span");
        title.className = "wallpaper_card_title";
        title.textContent = item.title || "";
        titleRow.appendChild(title);

        if (item.mediaType === "video") {
            const typeBadge = document.createElement("span");
            typeBadge.className = "wallpaper_card_type_badge";
            typeBadge.innerHTML = Icons.videoBadge || "";
            titleRow.appendChild(typeBadge);
        }

        overlay.appendChild(titleRow);
        card.appendChild(viewport);
        card.appendChild(overlay);

        // Hidden unless the card is waiting for its wallpaper (see `is_pending`).
        const spinner = document.createElement("span");
        spinner.className = "wallpaper_card_spinner";
        card.appendChild(spinner);

        card.addEventListener("click", () => {
            const currentIndex = this.cards.findIndex((entry) => entry.id === item.id);
            if (currentIndex !== -1) {
                this.goTo(currentIndex, { smooth: true, applyNow: true });
            }
        });

        return card;
    }

    /** Element holding a card, or null when it is not rendered. */
    _cardElement(cardId) {
        return this.track?.querySelector(`.wallpaper_card[data-id="${CSS.escape(cardId)}"]`) || null;
    }

    // ─── Inertia glide ────────────────────────────────────────────────────────

    _startAnimation() {
        if (this.isAnimating) return;
        this.isAnimating = true;

        // 0.11 keeps the inertia feel but settles in roughly half the time of
        // the original 0.07, so a scroll step previews noticeably sooner.
        const LERP_FACTOR = 0.11;

        const animate = () => {
            if (!this.isAnimating) return;

            const diff = this.targetOffset - this.currentOffset;

            if (Math.abs(diff) < 0.25) {
                this.currentOffset = this.targetOffset;
                this._translate();
                this.isAnimating = false;
                this._rafId = null;

                // The glide is over: this is the moment to preview the picked wallpaper.
                if (this._notifyOnSettle) {
                    this._notifyOnSettle = false;
                    this._settle();
                }
                return;
            }

            this.currentOffset += diff * LERP_FACTOR;
            this._translate();
            this._rafId = requestAnimationFrame(animate);
        };

        this._rafId = requestAnimationFrame(animate);
    }
    _cancelAnimation() {
        if (this._rafId) {
            cancelAnimationFrame(this._rafId);
            this._rafId = null;
        }
        this.isAnimating = false;
        this._notifyOnSettle = false;
    }

    _translate() {
        if (this.track) this.track.style.transform = `translateX(${this.currentOffset.toFixed(2)}px)`;
    }

    /**
     * The glide came to rest: report the position to the orchestrator, which turns
     * it into an actual wallpaper apply. Nothing here waits on that work — a
     * newer move supersedes it, and the apply guards itself with its own token.
     */
    _settle() {
        this._notifyOnSettle = false;
        Promise.resolve(this.onSettle?.(this.selectedIndex, this.selectedCard)).catch(() => {});
    }

    _clamp(index) {
        if (this.cards.length === 0) return 0;
        return Math.max(0, Math.min(index, this.cards.length - 1));
    }

    // ─── Input ────────────────────────────────────────────────────────────────

    /** Only react while the switcher is open (the container carries `.active`). */
    get _isActive() {
        return Boolean(this.container?.classList.contains("active"));
    }

    _onWheel(event) {
        if (!this._isActive || this.isEmpty) return;
        event.preventDefault();

        this._markHoverDirty();

        const delta = Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
        this._wheelAccum += delta;

        const now = performance.now();
        const STEP_THRESHOLD = 30;

        if (now - this._lastWheelTime >= this.navCooldown && Math.abs(this._wheelAccum) >= STEP_THRESHOLD) {
            this._lastWheelTime = now;
            // Scroll down -> next card on the left, scroll up -> previous on the right.
            this.step(this._wheelAccum > 0 ? 1 : -1);
            this._wheelAccum = 0;
        }

        clearTimeout(this._wheelAccumTimer);
        this._wheelAccumTimer = setTimeout(() => {
            this._wheelAccum = 0;
        }, 80);
    }

    _onMouseMove(event) {
        if (!this._isActive) return;

        const hasMoved =
            this._lastMouseX !== -1 && (event.clientX !== this._lastMouseX || event.clientY !== this._lastMouseY);
        this._lastMouseX = event.clientX;
        this._lastMouseY = event.clientY;

        if (this._isHoverDirty && hasMoved) this._resetHover();
    }

    /** Kill hover as soon as a scroll starts, so a card can't light up under the pointer. */
    _markHoverDirty() {
        if (this._isHoverDirty) return;
        this._isHoverDirty = true;
        this.container?.classList.add("no_hover");
    }

    _resetHover() {
        this._isHoverDirty = false;
        this._lastMouseX = -1;
        this._lastMouseY = -1;
        this.container?.classList.remove("no_hover");
    }
}
