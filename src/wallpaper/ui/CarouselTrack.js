import { renderIcons, Icons } from "/src/core/icon.js";
import { ITEM_KIND, ITEM_STATE } from "../stores/carouselSchema.js";

const FALLBACK_THUMB = "/image/fallback.jpg";
/** Delays matching switcher.css */
const REVEAL_MS = 700;
const POP_MS = 420;
const PLUCK_MS = 500;

/** Bề rộng thẻ kề sát thẻ đang chọn (d = 1) và hệ số suy giảm mũ cho các thẻ xa hơn. */
const SIDE_WIDTH = 240;
const DECAY_BASE = 0.65;
/** Bề rộng sàn của thẻ ở rất xa, tính theo tỉ lệ bề rộng thẻ đang chọn. */
const MIN_WIDTH_RATIO = 0.05;

/** Độ dài một frame chuẩn 60Hz — mốc quy đổi hệ số LERP sang thời gian thực. */
const FRAME_MS = 1000 / 60;
/** Trần thời gian một frame: chặn cú nhảy lớn sau khi tab bị treo / rớt frame nặng. */
const MAX_FRAME_MS = 64;
/** Coi như đã tới đích: 0.0015 cursor ≈ 0.65px dịch chuyển thực, dưới ngưỡng thấy được. */
const SETTLE_EPSILON = 0.0015;
/** Cache "giá trị đã ghi ra DOM" gắn trực tiếp lên từng slot (xem _updateLayout). */
const SLOT_STATE = Symbol("carouselSlotState");

/**
 * Hệ số LERP vật lý cho chuyển động lướt (tính cho một frame 60Hz):
 * - 0.08 - 0.10: Chuyển động chậm rãi, mượt mà, lướt êm (Cinematic).
 * - 0.13 - 0.16: Cân bằng, tự nhiên (Mặc định).
 * - 0.20 - 0.25: Nhanh, dứt khoát, phản hồi cao.
 * Hệ số này được quy đổi theo delta-time thật của từng frame (`_startAnimation`),
 * nên tốc độ lướt giống hệt nhau trên màn 60Hz, 120Hz hay khi bị rớt frame.
 */
export const CAROUSEL_LERP_FACTOR = 0.14;

/**
 * CarouselTrack.js
 * ---------------------------------------------------------------------------
 * Kiến trúc Pure LERP Physics Engine (Đồng bộ vật lý toàn phần 1:1):
 * - Tọa độ trượt và bề rộng (width) của toàn bộ các thẻ đều được tính toán trực tiếp
 *   trong từng frame requestAnimationFrame theo biến số thực `currentCursor`.
 * - Khi lướt từ thẻ 1 sang 2 (cursor 1.0 -> 2.0):
 *   Vị trí trượt tới đâu, width co giãn theo hàm liên tục tới đó với cùng tốc độ.
 *   Không còn bất kỳ xung đột hay lệch nhịp nào giữa CSS transition và JS LERP.
 * - Triệt tiêu hoàn toàn giật nảy khi scroll liên tục vì targetCursor chỉ việc trôi tiếp.
 * - Mọi giá trị ghi ra DOM đều được cache lại trên chính element, frame chỉ ghi
 *   khi giá trị thật sự đổi — lúc đứng yên thì vòng lặp không chạm vào DOM.
 * - Không bao giờ bỏ qua thẻ đang ở ngoài khung nhìn: vị trí "đóng băng" của nó
 *   sẽ lộ ra thành một thẻ đứng im ở rìa màn hình trong khi cả hàng vẫn trượt.
 */
export class CarouselTrack {
  /**
   * @param {Object} options
   * @param {HTMLElement} options.container
   * @param {HTMLElement} options.track
   * @param {number} [options.selectedWidth=600]
   * @param {number} [options.gap=12]
   * @param {(index: number, item: Object|null) => void} [options.onSettle]
   * @param {() => void} [options.onMoreAction]
   * @param {(card: Object) => Promise<string|null>} [options.onCardThumbError]
   */
  constructor({
    container,
    track,
    selectedWidth = 600,
    gap = 12,
    onSettle,
    onMoreAction,
    onCardThumbError,
  }) {
    this.container = container;
    this.track = track;
    this.selectedWidth = selectedWidth;
    this.fallbackGap = gap;
    this.onSettle = onSettle;
    this.onMoreAction = onMoreAction;
    this.onCardThumbError = onCardThumbError;

    // Biên của hàm suy giảm bề rộng: từ khoảng cách này trở đi mọi thẻ đều đã nằm
    // ở bề rộng sàn, nên vòng lặp layout khỏi tốn cos()/pow() cho chúng.
    this._floorWidth = selectedWidth * MIN_WIDTH_RATIO;
    const floorRatio = this._floorWidth / SIDE_WIDTH;
    this._decayHorizon =
      floorRatio >= 1 ? 1 : 1 + Math.log(floorRatio) / Math.log(DECAY_BASE);

    // Số liệu môi trường được đo một lần rồi cache: getComputedStyle gọi trong
    // vòng lặp RAF sẽ kéo theo style recalc mỗi frame.
    this._gapPx = null;

    // Bộ nhớ tạm dùng lại giữa các frame (không cấp phát trong RAF).
    this._widths = new Float64Array(0);
    this._centers = new Float64Array(0);

    // Cache element theo đúng thứ tự `cards`, chỉ dựng lại khi DOM đổi cấu trúc.
    this._els = [];
    this._elsDirty = true;

    /** @type {Array<Object>} */
    this.cards = [];
    this.moreLabel = "";
    this.moreState = ITEM_STATE.IDLE;
    this.moreNeedsGesture = false;

    // Continuous Physics State
    this.selectedIndex = 0;
    this.currentCursor = 0;
    this.targetCursor = 0;
    this.isAnimating = false;
    this._rafId = null;
    this._notifyOnSettle = false;

    // Navigation cooldown & input
    this.navCooldown = 80;
    this._lastWheelTime = 0;
    this._lastKeyTime = 0;
    this._wheelAccum = 0;
    this._wheelAccumTimer = null;

    this._isHoverDirty = false;
    this._lastMouseX = -1;
    this._lastMouseY = -1;

    this._onWheel = this._onWheel.bind(this);
    this._onMouseMove = this._onMouseMove.bind(this);

    this.container?.addEventListener("wheel", this._onWheel, {
      passive: false,
    });
    window.addEventListener("mousemove", this._onMouseMove, { passive: true });
  }

  // ─── Public API ───────────────────────────────────────────────────────────

  get selectedCard() {
    return this.cards[this.selectedIndex] || null;
  }

  get selectedIsMore() {
    return this.selectedCard?.kind === ITEM_KIND.MORE;
  }

  get isEmpty() {
    return this.cards.length === 0;
  }

  setCards(cards, index = 0) {
    this.cards = Array.isArray(cards) ? [...cards] : [];

    this.selectedIndex = this._clamp(index);
    this.currentCursor = this.selectedIndex;
    this.targetCursor = this.selectedIndex;

    // Đường nguội: đo lại gap một lần cho mỗi lần dựng lại danh sách.
    this._gapPx = null;

    this._cancelAnimation();
    this._render();
    this._updateLayout(this.currentCursor);
  }

  syncCards(cards, index) {
    this.cards = Array.isArray(cards) ? [...cards] : [];
    const nextIdx = Number.isFinite(index) ? index : this.selectedIndex;
    this.selectedIndex = this._clamp(nextIdx);
    this.targetCursor = this.selectedIndex;

    // DOM giữ nguyên nhưng danh sách item có thể đã đổi: ánh xạ lại element.
    this._invalidateEls();
  }

  refreshCard(cardId) {
    const card = this.cards.find((entry) => entry.id === cardId);
    const el = this._cardElement(cardId);
    if (!card || !el) return;

    el.classList.toggle("is_pending", Boolean(card.pending));
    if (card.pending) return;

    el.classList.remove("is_revealing_new");
    void el.offsetWidth;
    el.classList.add("is_revealing_new");
    setTimeout(() => el.classList.remove("is_revealing_new"), REVEAL_MS);
  }

  setMore({
    state = this.moreState,
    label = this.moreLabel,
    needsGesture = this.moreNeedsGesture,
  } = {}) {
    this.moreState = state;
    this.moreLabel = label;
    this.moreNeedsGesture = Boolean(needsGesture);
    this._syncMoreCard();
  }

  goTo(index, { smooth = true, applyNow = false } = {}) {
    if (this.isEmpty) return;

    const nextIndex = this._clamp(index);
    if (
      nextIndex === this.selectedIndex &&
      Math.abs(this.currentCursor - nextIndex) < 0.001
    )
      return;

    this.selectedIndex = nextIndex;
    this.targetCursor = nextIndex;

    if (applyNow || !smooth) {
      this._cancelAnimation();
      this.currentCursor = nextIndex;
      this._updateLayout(this.currentCursor);
      this._settle();
    } else {
      this._notifyOnSettle = true;
      this._startAnimation();
    }
  }

  step(delta, { smooth = true } = {}) {
    const nextIndex = this._clamp(this.selectedIndex + delta);
    if (
      nextIndex === this.selectedIndex &&
      Math.abs(this.currentCursor - nextIndex) < 0.001
    )
      return;
    this.goTo(nextIndex, { smooth });
  }

  stepByKey(delta) {
    const now = performance.now();
    if (now - this._lastKeyTime < this.navCooldown) return;
    this._lastKeyTime = now;
    this.step(delta);
  }

  recenter({ smooth = false, notify = false } = {}) {
    if (!this.track || !this.container || this.isEmpty) return;

    if (!smooth) {
      this._cancelAnimation();
      this.currentCursor = this.selectedIndex;
      this.targetCursor = this.selectedIndex;
      this._updateLayout(this.currentCursor);
    } else {
      this.targetCursor = this.selectedIndex;
      this._notifyOnSettle = notify;
      this._startAnimation();
    }
  }

  stop() {
    this._cancelAnimation();
    this._resetHover();
  }

  // ─── Pure LERP Physics Engine ─────────────────────────────────────────────

  _startAnimation() {
    if (this.isAnimating) return;
    this.isAnimating = true;

    let lastTime = performance.now();

    const animate = (now) => {
      if (!this.isAnimating) return;

      // Nội suy mũ theo delta-time thật: 1 frame 120Hz chỉ đi nửa quãng đường của
      // 1 frame 60Hz, còn rớt frame thì đi bù — quán tính không đổi theo thiết bị.
      const dt = Math.min(Math.max(now - lastTime, 1), MAX_FRAME_MS);
      lastTime = now;

      const diff = this.targetCursor - this.currentCursor;

      if (Math.abs(diff) < SETTLE_EPSILON) {
        this.currentCursor = this.targetCursor;
        // Hạ cờ TRƯỚC khi vẽ frame cuối: `_updateLayout` dùng nó để biết đây là
        // thời điểm duy nhất được phép đo lại nhãn "+" (phép đo ép reflow).
        this.isAnimating = false;
        this._rafId = null;
        this._updateLayout(this.currentCursor);

        if (this._notifyOnSettle) this._settle();
        return;
      }

      const alpha = 1 - Math.pow(1 - CAROUSEL_LERP_FACTOR, dt / FRAME_MS);
      this.currentCursor += diff * alpha;
      this._updateLayout(this.currentCursor);
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

  /**
   * Bề rộng liên tục W(d) cho bất kỳ giá trị khoảng cách số thực d >= 0:
   * - Khi d in [0, 1]: Nội suy cosine cực kỳ mượt mà từ selectedWidth (600px) xuống 240px.
   * - Khi d > 1: Giảm dần theo cấp số nhân (hàm mũ) cho tới khi chạm sàn 5% selectedWidth (30px).
   * - Giữ số thực float liên tục (không Math.round) để triệt tiêu rung giật.
   */
  _cardWidth(d) {
    if (d <= 1) {
      const t = (1 - Math.cos(d * Math.PI)) / 2;
      return this.selectedWidth - (this.selectedWidth - SIDE_WIDTH) * t;
    }
    // d > 1: Giảm theo cấp số nhân từ 240px xuống sàn 30px
    const decayed = SIDE_WIDTH * Math.pow(DECAY_BASE, d - 1);
    return Math.max(this._floorWidth, decayed);
  }

  /**
   * Tính toán và gán layout thực tế cho toàn bộ các slot trong frame hiện tại:
   * - Đảm bảo gap giữa hai thẻ bất kỳ luôn luôn chính xác 100% bằng CSS gap.
   * - Tọa độ và bề rộng của từng thẻ dịch chuyển đồng thời theo float cursor.
   */
  _updateLayout(cursor) {
    const N = this.cards.length;
    if (!this.track || N === 0) return;

    const u = Math.max(0, Math.min(cursor, N - 1));
    const gap = this._gap();

    // 1. Tính toán width liên tục cho mọi thẻ.
    // Bộ nhớ tạm chỉ lớn lên khi danh sách dài ra — mỗi frame không cấp phát gì.
    if (this._widths.length < N) {
      this._widths = new Float64Array(N);
      this._centers = new Float64Array(N);
    }
    const widths = this._widths;
    const C = this._centers;
    const horizon = this._decayHorizon;

    for (let i = 0; i < N; i++) {
      const d = i < u ? u - i : i - u;
      // Thẻ đã tắt hẳn theo hàm mũ thì lấy thẳng bề rộng sàn.
      widths[i] = d >= horizon ? this._floorWidth : this._cardWidth(d);
    }

    // 2. Tính toán tọa độ tâm C[i] relative to track center (50vw)
    const K = Math.floor(u);
    const p = u - K; // Phần lẻ [0, 1)

    if (K < N - 1) {
      const D = widths[K] / 2 + gap + widths[K + 1] / 2;
      C[K] = -p * D;
      C[K + 1] = (1 - p) * D;
    } else {
      C[K] = 0;
    }

    // Tỏa đều sang phải từ K+1
    for (let j = K + 2; j < N; j++) {
      C[j] = C[j - 1] + widths[j - 1] / 2 + gap + widths[j] / 2;
    }

    // Tỏa đều sang trái từ K
    for (let j = K - 1; j >= 0; j--) {
      C[j] = C[j + 1] - widths[j + 1] / 2 - gap - widths[j] / 2;
    }

    // 3. Gán lên DOM: tra element qua cache và chỉ ghi khi giá trị thật sự đổi.
    // KHÔNG bỏ qua thẻ nào, kể cả thẻ đã ra ngoài khung nhìn: vị trí cuối cùng
    // được ghi của nó vẫn nằm trong tầm nhìn (frame ngay trước đó), nên "đóng
    // băng" nó sẽ để lại một thẻ đứng im ở rìa màn hình giữa lúc cả hàng vẫn
    // trượt — đúng hiện tượng giật ở hai rìa.
    this._syncEls();
    const els = this._els;
    const selectedIndex = this.selectedIndex;

    for (let i = 0; i < N; i++) {
      const el = els[i];
      if (!el || el.classList.contains("is_removing")) continue;

      const cx = C[i];
      const w = widths[i];
      const half = w / 2;
      const d = i < u ? u - i : i - u;

      let st = el[SLOT_STATE];
      if (!st) {
        st = el[SLOT_STATE] = {
          w: NaN,
          x: NaN,
          dist: -1,
          selected: null,
          fitKey: null,
        };
      }

      const wq = Math.round(w * 100) / 100;
      if (wq !== st.w) {
        st.w = wq;
        el.style.width = `${wq}px`;
      }

      // Dịch chuyển đã bao sẵn phần bù -50% (tâm slot trùng tâm track), nên chỉ
      // còn một hàm transform duy nhất, không phụ thuộc bề rộng của chính nó.
      const xq = Math.round((cx - half) * 100) / 100;
      if (xq !== st.x) {
        st.x = xq;
        el.style.transform = `translateX(${xq}px)`;
      }

      const dist = Math.round(d);
      if (dist !== st.dist) {
        st.dist = dist;
        el.dataset.distance = dist;
      }

      const selected = i === selectedIndex && d < 0.25;
      if (selected !== st.selected) {
        st.selected = selected;
        el.classList.toggle("selected", selected);
      }
    }

    // Chỉ đo lại nhãn "+" khi hệ thống đã dừng: phép đo scrollWidth/clientWidth
    // buộc trình duyệt chạy lại layout, không được nằm trong vòng lặp RAF.
    if (!this.isAnimating && this._moreCard)
      this._updateMoreFit(this._moreCard);
  }

  /**
   * Gap đọc từ CSS một lần duy nhất cho mỗi lần dựng lại danh sách:
   * `getComputedStyle` là phép đo đắt, gọi mỗi frame sẽ kéo theo style recalc.
   */
  _gap() {
    if (this._gapPx !== null) return this._gapPx;

    let measured = NaN;
    if (this.container) {
      try {
        measured = parseFloat(
          getComputedStyle(this.container).getPropertyValue("--card-gap"),
        );
      } catch (error) {
        measured = NaN;
      }
    }

    this._gapPx = Number.isFinite(measured) ? measured : this.fallbackGap;
    return this._gapPx;
  }

  /** Buộc lần vẽ kế tiếp dựng lại cache element ↔ card. */
  _invalidateEls() {
    this._elsDirty = true;
    this._els.length = 0;
  }

  /** Dựng lại cache element theo đúng thứ tự `cards` (chỉ khi DOM đổi cấu trúc). */
  _syncEls() {
    const cards = this.cards;
    if (!this._elsDirty && this._els.length === cards.length) return;

    const els = this._els;
    els.length = cards.length;
    for (let i = 0; i < cards.length; i++) {
      els[i] = this._cardElement(cards[i].id);
    }
    this._elsDirty = false;
  }

  // ─── Card Mutations ───────────────────────────────────────────────────────

  async animateRemoveCard(cardId, { focusId } = {}) {
    const index = this.cards.findIndex((c) => c.id === cardId);
    if (index === -1) return;

    const el = this._cardElement(cardId);
    const wasSelected = this.selectedIndex === index;

    // 1. Where the selection lands
    const focusIndex = focusId
      ? this.cards.findIndex((c) => c.id === focusId)
      : -1;
    let nextIndex = focusIndex;
    if (nextIndex === -1) {
      if (wasSelected) {
        nextIndex =
          index >= this.cards.length - 1 ? Math.max(0, index - 1) : index;
      } else if (this.selectedIndex > index) {
        nextIndex = this.selectedIndex - 1;
      } else {
        nextIndex = this.selectedIndex;
      }
    }

    // ── GIAI ĐOẠN 1: Card bung nhẹ lên rồi rơi khuất tầm mắt (Slot vẫn giữ nguyên, track đứng im) ──
    if (el && wasSelected) {
      el.classList.add("is_sliding_down");
      await new Promise((resolve) => setTimeout(resolve, PLUCK_MS));
    }

    // ── GIAI ĐOẠN 2: Thẻ đã khuất, cập nhật mảng cards, co slot và lướt LERP sang thẻ kế cận ──
    this.cards.splice(index, 1);
    this._invalidateEls();
    const targetIdx = wasSelected
      ? this._clamp(nextIndex)
      : this.selectedIndex > index
        ? this.selectedIndex - 1
        : this.selectedIndex;

    if (el) {
      const cleanup = () => {
        el.removeEventListener("transitionend", onEnd);
        if (el.parentNode) el.remove();
      };
      const onEnd = (e) => {
        if (e.target === el && e.propertyName === "width") {
          cleanup();
        }
      };

      el.classList.remove("is_sliding_down");
      el.classList.add("is_removing");
      el.addEventListener("transitionend", onEnd);
      setTimeout(cleanup, 450);
    }

    this.selectedIndex = targetIdx;
    this.targetCursor = targetIdx;
    if (index < this.currentCursor) {
      this.currentCursor = Math.max(0, this.currentCursor - 1);
    }

    this._notifyOnSettle = true;
    this._startAnimation();
  }

  async animateInsertCard(
    cardItem,
    { following = false, droppedIds = [] } = {},
  ) {
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
            this.currentCursor = Math.max(0, this.currentCursor - 1);
            this.targetCursor = Math.max(0, this.targetCursor - 1);
          }
        }
        if (dropEl) {
          dropEl.classList.add("is_removing");
          setTimeout(() => dropEl.remove(), 450);
        }
      });
      this._invalidateEls();
    }

    // Insert position: before sentinel if present, else at end
    const sentinelIndex = this.cards.findIndex(
      (c) => c.kind === ITEM_KIND.MORE,
    );
    const insertIndex =
      sentinelIndex !== -1 ? sentinelIndex : this.cards.length;

    // Update cards array
    this.cards.splice(insertIndex, 0, cardItem);

    if (following) {
      this.selectedIndex = insertIndex;
      this.targetCursor = insertIndex;
    }

    let reusedEl = null;

    if (this._moreCard && this._moreCard.parentNode === this.track) {
      reusedEl = this._moreCard;

      // Morph existing DOM into Image card
      reusedEl.classList.remove("is_more", "is_loading", "is_error");
      reusedEl.dataset.id = cardItem.id;
      if (cardItem.pending) reusedEl.classList.add("is_pending");

      // Strip more icon and label
      const layerMore = reusedEl.querySelector(".wallpaper_card_layer_more");
      if (layerMore) {
        const moreIcon = layerMore.querySelector("svg, [data-icon]");
        if (moreIcon) moreIcon.remove();
        const moreSlot = layerMore.querySelector(".wallpaper_card_more_slot");
        if (moreSlot) moreSlot.remove();
      }

      // Re-bind Title & Badges
      const titleRow = reusedEl.querySelector(".wallpaper_card_title_row");
      if (titleRow) {
        titleRow.innerHTML = "";
        const title = document.createElement("span");
        title.className = "wallpaper_card_title";
        title.textContent = cardItem.title || "";
        titleRow.appendChild(title);

        if (cardItem.mediaType === "video") {
          const typeBadge = document.createElement("span");
          typeBadge.className = "wallpaper_card_type_badge";
          typeBadge.innerHTML = Icons.videoBadge || "";
          titleRow.appendChild(typeBadge);
        }
      }

      // Set Background Image
      const layerImage = reusedEl.querySelector(".wallpaper_card_layer_image");
      if (layerImage) {
        const thumbUrl = cardItem.thumbnailUrl || FALLBACK_THUMB;
        layerImage.style.backgroundImage = `url("${thumbUrl}")`;

        if (cardItem.thumbnailUrl) {
          const img = new Image();
          img.onerror = async () => {
            img.onerror = null;
            let rebuilt = null;
            try {
              rebuilt = await this.onCardThumbError?.(cardItem);
            } catch (e) {}
            layerImage.style.backgroundImage = `url("${rebuilt || FALLBACK_THUMB}")`;
          };
          img.src = cardItem.thumbnailUrl;
        }
      }

      if (!cardItem.pending) reusedEl.classList.add("is_revealing_new");
      renderIcons(reusedEl);

      // Create the NEW More Card
      const newMoreData = this.cards.find((c) => c.kind === ITEM_KIND.MORE);
      if (newMoreData) {
        this._moreCard = this._createCard(newMoreData);
        this._moreCard.classList.add("is_popping");

        if (reusedEl.nextSibling) {
          this.track.insertBefore(this._moreCard, reusedEl.nextSibling);
        } else {
          this.track.appendChild(this._moreCard);
        }
        renderIcons(this._moreCard);
      } else {
        this._moreCard = null;
      }
    } else {
      // Normal insertion
      const el = this._createCard(cardItem);
      if (!cardItem.pending) el.classList.add("is_revealing_new");
      this.track.appendChild(el);
      renderIcons(el);
      reusedEl = el;
    }

    this._invalidateEls();
    this._updateLayout(this.currentCursor);

    const moreCard = this._moreCard;
    if (moreCard)
      setTimeout(() => moreCard.classList.remove("is_popping"), POP_MS);
    if (!cardItem.pending)
      setTimeout(
        () => reusedEl.classList.remove("is_revealing_new"),
        REVEAL_MS,
      );
  }

  animateRemoveMore() {
    if (!this._moreCard) return;
    const moreEl = this._moreCard;
    this._moreCard = null;

    const moreIdx = this.cards.findIndex((c) => c.kind === ITEM_KIND.MORE);
    if (moreIdx !== -1) {
      this.cards.splice(moreIdx, 1);
      this.selectedIndex = this._clamp(this.selectedIndex);
      this.targetCursor = this.selectedIndex;
    }

    moreEl.classList.add("is_removing");
    setTimeout(() => moreEl.remove(), 450);
    this._invalidateEls();
    this._updateLayout(this.currentCursor);
  }

  // ─── DOM Rendering ────────────────────────────────────────────────────────

  _render() {
    if (!this.track) return;

    if (this.isEmpty) {
      this.track.style.display = "none";
      this.track.innerHTML = "";
      this._moreCard = null;
      this._invalidateEls();
      return;
    }

    this.track.style.display = "block";
    this.track.innerHTML = "";
    this._moreCard = null;

    this.cards.forEach((card) => {
      const el = this._createCard(card);
      this.track.appendChild(el);
    });

    this._invalidateEls();
    renderIcons(this.track);
    this._syncMoreCard();
  }

  _createCard(item) {
    const isMore = item.kind === ITEM_KIND.MORE;

    const slotEl = document.createElement("div");
    slotEl.className = "wallpaper_card_slot";
    if (isMore) slotEl.classList.add("is_more");
    slotEl.dataset.id = item.id;
    if (item.pending) slotEl.classList.add("is_pending");

    const card = document.createElement("div");
    card.className = "wallpaper_card";

    // Lớp 1: Giao diện Get New Image
    const layerMore = document.createElement("div");
    layerMore.className = "wallpaper_card_layer_more";
    if (isMore) {
      layerMore.innerHTML = `<i data-icon="addMore"></i>`;

      const slot = document.createElement("div");
      slot.className = "wallpaper_card_more_slot";
      const label = document.createElement("span");
      label.className = "wallpaper_card_more_label";
      slot.appendChild(label);
      layerMore.appendChild(slot);
    }

    const spinner = document.createElement("span");
    spinner.className = "wallpaper_card_spinner";
    layerMore.appendChild(spinner);

    // Lớp 2: Hình ảnh (Background image)
    const layerImage = document.createElement("div");
    layerImage.className = "wallpaper_card_layer_image";
    if (!isMore) {
      const thumbUrl = item.thumbnailUrl || FALLBACK_THUMB;
      layerImage.style.backgroundImage = `url("${thumbUrl}")`;

      if (item.thumbnailUrl) {
        const img = new Image();
        img.onerror = async () => {
          img.onerror = null;
          let rebuilt = null;
          try {
            rebuilt = await this.onCardThumbError?.(item);
          } catch (e) {
            console.error("[CarouselTrack] Thumbnail recovery failed:", e);
          }
          layerImage.style.backgroundImage = `url("${rebuilt || FALLBACK_THUMB}")`;
        };
        img.src = item.thumbnailUrl;
      }
    }

    // Lớp 3: Khung Card Overlay
    const layerOverlay = document.createElement("div");
    layerOverlay.className = "wallpaper_card_layer_overlay";

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

    layerOverlay.appendChild(titleRow);

    card.appendChild(layerMore);
    card.appendChild(layerImage);
    card.appendChild(layerOverlay);
    slotEl.appendChild(card);

    slotEl.addEventListener("click", () => {
      const currentId = slotEl.dataset.id;
      const currentIndex = this.cards.findIndex(
        (entry) => String(entry.id) === String(currentId),
      );
      if (currentIndex === -1) return;

      const currentItem = this.cards[currentIndex];
      if (currentItem.kind === ITEM_KIND.MORE) {
        if (this.moreNeedsGesture || currentIndex === this.selectedIndex) {
          this.onMoreAction?.();
          return;
        }
        this.goTo(currentIndex);
      } else {
        if (currentIndex === this.selectedIndex) return;
        this.goTo(currentIndex, { smooth: true, applyNow: true });
      }
    });

    if (isMore) {
      this._moreCard = slotEl;
    }

    return slotEl;
  }

  _syncMoreCard() {
    if (!this._moreCard) return;

    this._moreCard.classList.toggle(
      "is_loading",
      this.moreState === ITEM_STATE.LOADING,
    );
    this._moreCard.classList.toggle(
      "is_error",
      this.moreState === ITEM_STATE.ERROR,
    );

    const label = this._moreCard.querySelector(".wallpaper_card_more_label");
    if (label && label.textContent !== this.moreLabel)
      label.textContent = this.moreLabel;

    this._updateMoreFit(this._moreCard);
  }

  _updateMoreFit(cardElement) {
    const label = cardElement?.querySelector(".wallpaper_card_more_label");
    if (!label) return;

    // Nhãn chỉ có thể bị cắt khi bề rộng thẻ hoặc nội dung đổi. Đối chiếu với
    // chính bề rộng đã ghi ra DOM (SLOT_STATE.w) nên không tốn phép đọc nào, và
    // bỏ qua hẳn phép đo khi cả hai vẫn như cũ — scrollWidth/clientWidth buộc
    // trình duyệt chạy lại layout.
    const st = cardElement[SLOT_STATE];
    if (st) {
      const key = `${st.w}|${label.textContent}`;
      if (st.fitKey === key) return;
      st.fitKey = key;
    }

    label.classList.remove("is_clipped");
    label.classList.toggle(
      "is_clipped",
      label.scrollWidth > label.clientWidth + 1,
    );
  }

  _cardElement(cardId) {
    return (
      this.track?.querySelector(
        `.wallpaper_card_slot[data-id="${CSS.escape(String(cardId))}"]`,
      ) || null
    );
  }

  _settle() {
    this._notifyOnSettle = false;
    Promise.resolve(
      this.onSettle?.(this.selectedIndex, this.selectedCard),
    ).catch(() => {});
  }

  _clamp(index) {
    if (this.cards.length === 0) return 0;
    return Math.max(0, Math.min(index, this.cards.length - 1));
  }

  // ─── Input Handling ───────────────────────────────────────────────────────

  get _isActive() {
    return Boolean(this.container?.classList.contains("active"));
  }

  _onWheel(event) {
    if (!this._isActive || this.isEmpty) return;
    event.preventDefault();

    this._markHoverDirty();

    const delta =
      Math.abs(event.deltaY) >= Math.abs(event.deltaX)
        ? event.deltaY
        : event.deltaX;
    this._wheelAccum += delta;

    const now = performance.now();
    const STEP_THRESHOLD = 25;

    if (
      now - this._lastWheelTime >= this.navCooldown &&
      Math.abs(this._wheelAccum) >= STEP_THRESHOLD
    ) {
      this._lastWheelTime = now;
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
      this._lastMouseX !== -1 &&
      (event.clientX !== this._lastMouseX ||
        event.clientY !== this._lastMouseY);
    this._lastMouseX = event.clientX;
    this._lastMouseY = event.clientY;

    if (this._isHoverDirty && hasMoved) this._resetHover();
  }

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
