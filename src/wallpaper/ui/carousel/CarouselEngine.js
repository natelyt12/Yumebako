/**
 * CarouselEngine.js
 * ---------------------------------------------------------------------------
 * Động cơ carousel accordion — bản port của `temp/carousel_layout/carousel.js`
 * (IIFE gắn `window.Carousel`) sang ESM class, giữ nguyên mô hình chuyển động
 * của sketch:
 *
 *   - Bề rộng/toạ độ do `geometry` tính cho từng layout nguyên; khi lướt hoặc
 *     kéo thì nội suy giữa hai layout kề nhau, nên dù công thức bề rộng là rời
 *     rạc, chuyển động vẫn liên tục.
 *   - Snap bằng `duration` cố định + `easeOutExpo`: quỹ đạo xác định trước,
 *     không "đuổi target" như LERP nên không còn đoạn dính rồi búng cuối cú lướt.
 *   - Hai tầng sự kiện: `softSelect` (thẻ vừa lướt qua tâm) và `hardSelect`
 *     (đã dừng hẳn) — tầng trên dùng soft để cập nhật preview, hard để chốt.
 *
 * Khác sketch (có chủ đích, để ghép được vào hệ wallpaper):
 *   - Bàn phím không bị chiếm toàn cục: engine chỉ có `stepByKey()`, owner tự
 *     gắn phím (switcher dành ↑/↓ cho việc đổi nguồn).
 *   - Wheel/drag chỉ sống khi `setActive(true)`; wheel chỉ `preventDefault` khi
 *     thật sự tiêu thụ sự kiện.
 *   - Việc lấy thêm nội dung do `setActionHandler()` cắm từ ngoài vào; engine
 *     không biết store/API nào đứng sau.
 *   - Tâm màn hình đo theo container (`clientWidth / 2`) thay vì `window.innerWidth`.
 *
 * Không phụ thuộc framework: chỉ DOM, RAF và các module thuần trong thư mục này.
 */

import { easeOutExpo } from "./easing.js";
import { createGeometry } from "./geometry.js";
import {
  animateUnpinDrop,
  dragToVirtualIndex,
  isDragMoved,
  resolveDragTarget,
  splitVirtualIndex,
} from "./physics.js";
import {
  DEFAULT_ACTION_ITEM,
  createActionItem,
  escapeHtml,
  isActionItem,
  resolveImageUrl,
} from "./items.js";

/** Ngưỡng gom delta chuột để tính là một bậc cuộn. */
const WHEEL_THRESHOLD = 35;
/** Không có bánh xe nào trong ngần này thì bộ gom được xoá. */
const WHEEL_RESET_MS = 120;
/** Khoảng cách tối thiểu giữa hai lần bấm phím liên tiếp. */
const NAV_COOLDOWN_MS = 80;
/** Thời gian cột thu lại sau khi thẻ bị xóa rơi khỏi khung. */
const COLLAPSE_MS = 350;
/** Dự phòng khi không đọc được `--loading-fadeout-duration`. */
const FADE_OUT_FALLBACK_MS = 220;

const MODE_SLOT_WIDTH = 1;
const MODE_FREE_WIDTH = 2;

/** Class gắn lên `<body>` trong lúc kéo, để con trỏ giữ nguyên khi ra ngoài sân khấu. */
const DRAG_ROOT_CLASS = "wp-carousel-dragging";

/** Dấu cộng mặc định của thẻ hành động khi owner không truyền SVG riêng. */
const DEFAULT_ACTION_ICON = `
      <svg class="card-plus-icon" viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
        <line x1="12" y1="5" x2="12" y2="19"></line>
        <line x1="5" y1="12" x2="19" y2="12"></line>
      </svg>
    `;

export class CarouselEngine {
  /**
   * @param {Object} options
   * @param {HTMLElement} options.container - Khối bao ngoài, nơi nhận chuột/cảm ứng.
   * @param {HTMLElement} options.track - Nơi render thẻ (toạ độ tính từ gốc của nó).
   * @param {HTMLElement} [options.guide] - Đường chỉ đỏ ở tâm (debug, có thể null).
   * @param {HTMLElement} [options.viewfinder] - Khung ngắm trắng ở tâm (có thể null).
   * @param {number} [options.duration=800] - Thời gian một cú snap (ms).
   * @param {Object} [options.geometry] - Ghi đè kích thước, xem `geometry.js`.
   * @param {Object} [options.actionCard] - Cấu hình thẻ hành động mặc định.
   * @param {(item: Object, index: number, engine: CarouselEngine) => Promise<Object|null>} [options.onAction]
   *   Handler lấy thẻ mới. Trả về `null` để huỷ (thẻ hành động giữ nguyên).
   * @param {(index: number, item: Object, cardEl: HTMLElement, ctx: Object) => boolean|void} [options.onCardClick]
   *   Trả về `true` nếu owner đã xử lý cú click (engine sẽ không tự căn giữa).
   * @param {(item: Object, cardEl: HTMLElement, index: number) => void} [options.onThumbError]
   *   Gọi khi ảnh của một thẻ không tải được, để owner dựng lại thumbnail.
   */
  constructor({
    container,
    track,
    guide = null,
    viewfinder = null,
    duration = 800,
    geometry = {},
    actionCard = {},
    onAction = null,
    onCardClick = null,
    onThumbError = null,
  } = {}) {
    this.container = container;
    this.track = track;
    this.guide = guide;
    this.viewfinder = viewfinder;

    this.duration = Math.max(50, Number(duration) || 800);
    this.geometry = createGeometry(geometry);
    this.actionConfig = { ...DEFAULT_ACTION_ITEM, ...actionCard };

    this.onAction = onAction;
    this.onCardClick = onCardClick;
    this.onThumbError = onThumbError;
    this._deleteResolve = null;

    /** @type {Array<Object>} */
    this.items = [];
    /** @type {HTMLElement[]} Thẻ DOM, đúng thứ tự `items`. */
    this.els = [];

    this.hasAccentBg = false;
    this.isActive = false;
    this.isSettled = true;
    this.isDeleting = false;
    this.isFetchingCard = false;

    /** Chỉ số đã chốt (hard) — chỉ đổi khi chuyển động kết thúc. */
    this.hardIndex = 0;
    /** Chỉ số đang lướt qua tâm (soft) — đổi ngay khi tâm vượt sang thẻ khác. */
    this.softIndex = 0;
    /** Vị trí ảo liên tục, có thể lẻ và có thể nằm ngoài biên khi kéo quá mép. */
    this.continuousIndex = 0;

    this._animId = null;
    this._anim = null;
    this._centerCache = null;
    this._wheelAccum = 0;
    this._wheelTimer = null;
    this._lastKeyTime = 0;
    this._drag = null;
    this._listeners = [];

    this._softListeners = new Set();
    this._hardListeners = new Set();
    this._stateListeners = new Set();

    this._applyAccentBg();
    this._bindInput();
  }

  /* ── Truy vấn trạng thái ───────────────────────────────────────────────── */

  get count() {
    return this.items.length;
  }

  /** Item đang được chốt ở tâm. */
  get activeItem() {
    return this.items[this.hardIndex] || null;
  }

  /** Item đang lướt qua tâm (đổi liên tục khi đang di chuyển). */
  get softItem() {
    return this.items[this.softIndex] || null;
  }

  /** Thẻ ở tâm có phải ô "lấy thêm" không. */
  get activeIsAction() {
    return isActionItem(this.activeItem);
  }

  /**
   * Chỉ số ô "lấy thêm" trong danh sách, hoặc -1 khi nguồn đã hết nội dung.
   *
   * Cần cho những lệnh không đi qua thẻ đang chốt — ví dụ nút tải ảnh ở thanh
   * dưới, vốn phải mở hộp chọn file dù người dùng đang đứng ở thẻ nào.
   */
  get actionIndex() {
    return this.items.findIndex(isActionItem);
  }

  /** `true` nếu carousel đang đứng yên (không kéo, không chạy snap). */
  get settled() {
    return this.isSettled;
  }

  getActiveCardMode() {
    return this._getCardMode(this.els[this.hardIndex]);
  }

  getDuration() {
    return this.duration;
  }

  hasAccentBackground() {
    return this.hasAccentBg;
  }

  getActionCardConfig() {
    return { ...this.actionConfig };
  }

  /** Ảnh chụp toàn bộ trạng thái — dùng cho UI theo dõi hoặc debug. */
  getState(eventType = this.isSettled ? "hard" : "soft") {
    const activeCard = this.els[this.softIndex] || this.els[this.hardIndex];
    let status = "idle";
    if (this.isDeleting) status = "deleting";
    else if (this.isFetchingCard) status = "fetching";
    else if (!this.isSettled) status = "moving";

    return {
      status,
      hasAccentBg: this.hasAccentBg,
      currentCardIndex: this.hardIndex,
      softCardIndex: this.softIndex,
      totalContent: this.count,
      duration: this.duration,
      isDeleting: this.isDeleting,
      isFetchingCard: this.isFetchingCard,
      isActionCard: isActionItem(this.items[this.softIndex] || this.activeItem),
      activeCardMode: this._getCardMode(activeCard),
      isSettled: this.isSettled,
      eventType,
      softItem: this.items[this.softIndex] || null,
      hardItem: this.activeItem,
      actionCardConfig: { ...this.actionConfig },
    };
  }

  /* ── Nạp dữ liệu ───────────────────────────────────────────────────────── */

  /**
   * Nạp danh sách mới và dựng lại DOM ngay tại `index` (không fade-out).
   *
   * @param {Array<Object>} items
   * @param {number} [index=0]
   * @param {Object} [options]
   * @param {boolean} [options.animate=true] - Chạy hiệu ứng thẻ vào slot.
   * @param {Object} [options.actionCard] - Cấu hình thẻ hành động cho lượt này.
   */
  setItems(items, index = 0, { animate = true, actionCard } = {}) {
    this._cancelAnimation();
    this._setSettled(true);
    this._anim = null;
    this._drag = null;

    if (actionCard) this.setActionCardConfig(actionCard);

    this.items = Array.isArray(items) ? [...items] : [];
    const valid = this._clamp(Number(index) || 0);
    this.hardIndex = valid;
    this.softIndex = valid;
    this.continuousIndex = valid;

    this._renderAll();
    this._recenterLayout();

    if (this.count === 0) {
      this.viewfinder?.classList.add("is-hidden");
      this.container?.classList.add("is-empty");
    } else {
      this.viewfinder?.classList.remove("is-hidden");
      this.container?.classList.remove("is-empty");
    }
    // `_renderAll` đã gắn hiệu ứng vào-slot cho mọi thẻ lúc dựng DOM, nên cả dải
    // hiện ra cùng một nhịp — không cần kích lại cho riêng thẻ đang chốt.
    if (animate) this.triggerEnterAnimation("all");

    this._notifyHard();
    return this;
  }

  /**
   * Dạng "gửi request rồi chờ resolve" của `setItems`: dựng lại DOM tức thì,
   * chạy hiệu ứng vào slot, rồi mới resolve cho bên gọi.
   *
   * @returns {Promise<{success: boolean, selectedIndex: number, count: number, item: Object|null}>}
   */
  loadItems(items, selectedIndex = 0, options = {}) {
    const prepared = Array.isArray(items) ? [...items] : [];

    // Ô "lấy thêm" là một phần tử thật của danh sách; nếu nguồn không cấp thì
    // engine tự nối vào cuối để dải luôn có chỗ cho hành động.
    if (options.appendAction !== false && !prepared.some(isActionItem)) {
      prepared.push(createActionItem(options.actionCard || this.actionConfig));
    } else if (options.actionCard) {
      this.setActionCardConfig(options.actionCard);
      prepared
        .filter(isActionItem)
        .forEach((item) => Object.assign(item, this.actionConfig));
    }

    this.setItems(prepared, selectedIndex, { animate: true });

    return Promise.resolve({
      success: true,
      selectedIndex: this.hardIndex,
      count: this.count,
      item: this.activeItem,
    });
  }

  /** Đặt cấu hình mặc định cho thẻ hành động (nhãn, icon, chữ loading). */
  setActionCardConfig(config) {
    if (!config || typeof config !== "object") return;
    this.actionConfig = {
      ...this.actionConfig,
      name: config.name || config.label || this.actionConfig.name,
      subLabel: config.subLabel ?? this.actionConfig.subLabel,
      loadingText: config.loadingText || this.actionConfig.loadingText,
      icon: config.icon !== undefined ? config.icon : this.actionConfig.icon,
    };
  }

  /** Cắm handler lấy thẻ mới (nhận Promise). Xem `requestAction`. */
  setActionHandler(fn) {
    this.onAction = typeof fn === "function" ? fn : null;
  }

  /**
   * Đổi nhãn thẻ hành động (ví dụ đếm ngược cooldown, hoặc gợi ý thử lại).
   * Ghi luôn vào item để lần render sau không quay về nhãn cũ.
   */
  setActionLabel(label) {
    const index = this.items.findIndex(isActionItem);
    if (index === -1 || !label) return;

    this.items[index].name = label;
    const labelEl = this.els[index]?.querySelector(".card-add-label");
    if (labelEl) labelEl.textContent = label;
  }

  /** Gắn cờ trạng thái lên thẻ hành động: `"idle" | "loading" | "error"`. */
  setActionState(state = "idle") {
    const index = this.items.findIndex(isActionItem);
    const cardEl = this.els[index];
    if (!cardEl) return;

    cardEl.classList.toggle("is-loading", state === "loading");
    cardEl.classList.toggle("is-error", state === "error");
  }

  /**
   * Thu hồi ô "lấy thêm" khi nguồn đã hết nội dung: gỡ nó khỏi danh sách rồi
   * đo lại layout, thẻ kế cận trượt vào chỗ trống.
   */
  retireActionCard() {
    const index = this.items.findIndex(isActionItem);
    if (index === -1) return;

    this.items.splice(index, 1);
    this.els[index]?.remove();
    this.els = this._collectEls();

    this.hardIndex = this._clamp(Math.min(this.hardIndex, this.count - 1));
    this.softIndex = this.hardIndex;
    this.continuousIndex = this.hardIndex;
    this._recenterLayout();
    this._notifyHard();
  }

  /** Gán lại ảnh cho một thẻ — dùng khi thumbnail cũ hỏng và được dựng lại. */
  setCardImage(cardEl, url) {
    const bg = cardEl?.querySelector(".card-bg");
    if (bg && url) bg.style.backgroundImage = `url('${url}')`;
  }

  /* ── Điều hướng ────────────────────────────────────────────────────────── */

  /** Cuộn mượt tới thẻ `index` (đã kẹp biên). */
  scrollToCard(index) {
    this._animateTo(this._clamp(index));
  }

  /** Đi thêm `delta` thẻ so với đích gần nhất đang nhắm tới. */
  step(delta) {
    const base = this._anim ? this._anim.target : this.hardIndex;
    this.scrollToCard(base + delta);
  }

  /**
   * Điều hướng bằng phím. Owner gọi hàm này; engine không tự gắn phím để không
   * tranh chấp với các phím tắt khác của app.
   */
  stepByKey(delta) {
    const now = performance.now();
    if (now - this._lastKeyTime < NAV_COOLDOWN_MS) return;
    this._lastKeyTime = now;
    this.step(delta);
  }

  /** Bỏ mọi chuyển động đang chạy và đứng ngay tại thẻ đã chốt. */
  stop() {
    this._cancelAnimation();
    this._anim = null;
    this.continuousIndex = this.hardIndex;
    this._recenterLayout();
    this._setSettled(true);
  }

  /** Đo lại tâm rồi đặt lại layout tại vị trí đang chốt (dùng khi resize). */
  recenter() {
    if (this.isDeleting || this.count === 0) return;
    this._centerCache = null;
    this._recenterLayout();
    this._notifyState();
  }

  /**
   * Đồng bộ danh sách thẻ với dữ liệu mới mà KHÔNG dựng lại cả dải.
   *
   * Đối chiếu theo `id` rồi chỉ gỡ những thẻ đã biến mất và dựng những thẻ vừa
   * xuất hiện; thẻ cũ giữ nguyên element nên ảnh đã tải và hiệu ứng vừa chạy còn
   * nguyên. Dựng lại toàn bộ (như `setItems`) là chuyện của việc đổi nguồn, không
   * phải của việc sửa danh sách hiện tại.
   *
   * Đây cũng là chỗ duy nhất thay `items` bên ngoài `setItems`, nên tham chiếu
   * `card` của từng thẻ tự động được làm mới theo bản ghi mà store vừa trả về.
   *
   * @param {Array<Object>} items
   * @param {number} [index] - Vị trí cần chốt sau khi đồng bộ.
   * @param {Object} [options]
   * @param {boolean} [options.silent=false] - Không báo hard select.
   */
  syncItems(items, index = this.hardIndex, { silent = false } = {}) {
    if (!this.track) return this;

    this._cancelAnimation();
    this._anim = null;
    this._drag = null;

    const next = Array.isArray(items) ? [...items] : [];
    const wanted = new Set(next.map((item) => item.id));

    // Thẻ bị xoá thường đã tự rời DOM ở pha thu cột; những thẻ bị cắt khỏi danh
    // sách vì lý do khác (cửa sổ dài quá giới hạn) thì được gỡ ở đây.
    this.els.forEach((el) => {
      if (!wanted.has(el.dataset.id)) el.remove();
    });

    const existing = new Map(
      this._collectEls().map((el) => [el.dataset.id, el]),
    );
    this.items = next;

    const fresh = [];
    const ordered = next.map((item, i) => {
      const known = existing.get(item.id);
      if (known) {
        known.dataset.index = i + 1;
        return known;
      }

      const el = this._createCard(item, i);
      el.dataset.index = i + 1;
      fresh.push(el);
      return el;
    });

    // Chỉ đụng vào DOM khi thứ tự thật sự khác. `appendChild` trên node đã nằm
    // trong track là một lần *di chuyển*, mà di chuyển node thì trình duyệt chạy
    // lại CSS animation đang gắn trên nó — nên việc đồng bộ lại cả dải sau một
    // cú xoá sẽ làm thẻ "+" (và mọi ảnh) nhảy nhót dù chúng không liên quan gì.
    const current = this._collectEls();
    const sameOrder =
      current.length === ordered.length &&
      ordered.every((el, i) => el === current[i]);

    if (!sameOrder) ordered.forEach((el) => this.track.appendChild(el));
    this.els = ordered;

    this.hardIndex = this._clamp(index);
    this.softIndex = this.hardIndex;
    this.continuousIndex = this.hardIndex;

    this._recenterLayout();

    // Thẻ vừa sinh ra mới cần hiệu ứng "vào slot"; thẻ cũ giữ nguyên vì chúng
    // chẳng có gì mới để chào. Đặt SAU `_recenterLayout`: hiệu ứng lấy độ mờ hiện
    // tại của khung làm đích, nên layout phải ghi xong đã.
    if (fresh.length) this.triggerEnterAnimation(fresh);

    if (this.count === 0) {
      this.viewfinder?.classList.add("is-hidden");
      this.container?.classList.add("is-empty");
    } else {
      this.viewfinder?.classList.remove("is-hidden");
      this.container?.classList.remove("is-empty");
    }

    this._setSettled(true);
    if (!silent) this._notifyHard();
    return this;
  }

  /** Bật/tắt nhận chuột, cảm ứng, bánh xe (switcher đóng thì tắt). */
  setActive(isActive) {
    this.isActive = Boolean(isActive);
    if (!this.isActive) {
      this._endDrag();
      this._cancelAnimation();
      this._setSettled(true);
    }
  }

  /* ── Thao tác với thẻ đang chốt ────────────────────────────────────────── */

  /**
   * Kích hoạt việc lấy thêm nội dung: gọi handler, rồi thay ô "lấy thêm" bằng thẻ
   * mới và nối thêm một ô mới ở cuối dải.
   *
   * Chạy được cả khi dải **không có** ô "lấy thêm" — nguồn đã ẩn nó đi và chỉ còn
   * một nút riêng ở bên ngoài: khi đó không có ô nào để hiện trạng thái loading,
   * cũng không có ô nào để vẽ thẻ mới vào, nên việc đưa thẻ mới lên dải thuộc về
   * bên gọi (`onAction` tự đồng bộ danh sách trước khi trả về).
   *
   * @param {number} [index=this.actionIndex] - Vị trí ô "lấy thêm"; `-1` là hợp lệ.
   * @returns {Promise<Object|null>} Thẻ vừa nhận, hoặc `null` nếu bị huỷ.
   */
  async requestAction(index = this.actionIndex) {
    if (this.isFetchingCard) return null;

    const item = this.items[index];
    const cardEl = this.els[index];
    const hasCard = Boolean(cardEl) && isActionItem(item);
    // Chỉ số trỏ sai chỗ là lỗi của bên gọi; còn `-1` thì hợp lệ, nghĩa là nguồn
    // này không có ô "lấy thêm".
    if (!hasCard && index !== -1) return null;

    this.isFetchingCard = true;
    this._notifyState();

    const spinner = hasCard
      ? cardEl.querySelector(".card-loading-spinner")
      : null;
    const plusIcon = hasCard ? cardEl.querySelector(".card-plus-icon") : null;
    const label = hasCard ? cardEl.querySelector(".card-add-label") : null;

    if (hasCard) {
      cardEl.classList.add("is-loading");
      if (spinner) spinner.style.display = "block";
      if (plusIcon) plusIcon.style.display = "none";
      if (label)
        label.textContent = item.loadingText || this.actionConfig.loadingText;
    }

    try {
      const newItem = await this.onAction?.(item ?? null, index, this);
      // Không có ô để vẽ vào: kết quả thuộc về bên gọi, engine không đụng gì thêm.
      if (!newItem || !hasCard) return newItem ?? null;

      await this._commitActionCard(index, cardEl, newItem);
      return newItem;
    } catch (error) {
      // Lỗi được báo cho owner (họ mới biết nguồn nào hỏng và hiển thị gì); ở
      // đây chỉ cần trả thẻ "+" về trạng thái chờ, và nuốt lỗi để không tạo ra
      // một promise bị reject mà không ai bắt.
      if (hasCard)
        this._revertActionCard(cardEl, item, spinner, plusIcon, label);
      console.error("[CarouselEngine] Action request failed:", error);
      return null;
    } finally {
      this.isFetchingCard = false;
      this._notifyState();
    }
  }

  /**
   * Xoá thẻ đang chốt: bung đinh cho khung ảnh rơi khỏi màn hình, rồi thu cột
   * lại và chốt sang thẻ kế cận. Không cho xoá khi chỉ còn một thẻ hoặc khi thẻ
   * đang chốt là ô "lấy thêm".
   *
   * @returns {Promise<boolean>} `true` khi đã xoá xong, `false` nếu bị từ chối.
   */
  deleteActiveCard() {
    if (this.isDeleting || this._animId || this.count === 0)
      return Promise.resolve(false);

    const index = this.hardIndex;
    const cardEl = this.els[index];
    if (!cardEl || isActionItem(this.items[index]))
      return Promise.resolve(false);

    this.isDeleting = true;
    this.viewfinder?.classList.add("is-hidden");
    this._notifyState();

    // Mode 2: khung ảnh tách khỏi bề rộng slot, nên hiệu ứng rơi không bị cột
    // đang thu lại kéo méo.
    this.setCardMode(cardEl, MODE_FREE_WIDTH);
    cardEl.classList.add("deleting");

    const frame = cardEl.querySelector(".card-frame");
    frame?.classList.add("slide-down");

    // Trường hợp chỉ còn 1 thẻ duy nhất (xóa thẻ cuối cùng trong danh sách)
    if (this.count === 1) {
      const onLastDrop = () => {
        cardEl?.remove();
        this.items = [];
        this.els = [];
        this.hardIndex = 0;
        this.softIndex = 0;
        this.continuousIndex = 0;
        this.isDeleting = false;
        this.container?.classList.add("is-empty");
        this.viewfinder?.classList.add("is-hidden");
        this._notifyHard();
        this._notifyState();
        if (this._deleteResolve) {
          this._deleteResolve(true);
          this._deleteResolve = null;
        }
      };

      if (frame) animateUnpinDrop(frame, onLastDrop);
      else onLastDrop();

      return new Promise((resolve) => {
        this._deleteResolve = resolve;
      });
    }

    const collapse = () => this._collapseDeleted(index);
    if (frame) animateUnpinDrop(frame, collapse);
    else collapse();

    // Bên gọi (adapter của store) cần biết lúc nào thẻ đã thực sự rời danh sách
    // để đồng bộ lại cửa sổ dữ liệu.
    return new Promise((resolve) => {
      this._deleteResolve = resolve;
    });
  }

  /** Chuyển đổi qua lại giữa Mode 1 (theo slot) và Mode 2 (bung đủ khung). */
  toggleCurrentCardMode() {
    const cardEl = this.els[this.hardIndex];
    if (!cardEl) return;
    const next =
      this._getCardMode(cardEl) === MODE_SLOT_WIDTH
        ? MODE_FREE_WIDTH
        : MODE_SLOT_WIDTH;
    this.setCardMode(cardEl, next);
  }

  /** Gán mode cho một thẻ DOM. */
  setCardMode(cardEl, mode) {
    if (!cardEl) return;
    const free = mode === MODE_FREE_WIDTH;
    cardEl.classList.toggle("mode-2", free);
    cardEl.classList.toggle("mode-1", !free);
    cardEl.dataset.mode = free ? "2" : "1";
    this._notifyState();
  }

  /* ── Hiệu ứng ──────────────────────────────────────────────────────────── */

  /**
   * Hiệu ứng "thẻ vào slot": zoom nhẹ + fade, dùng được cho một thẻ, nhiều thẻ
   * hay toàn bộ dải. Độ mờ đích lấy từ chính style hiện tại của khung, nên hiệu
   * ứng không phá độ mờ mà layout đã tính theo khoảng cách tới tâm.
   *
   * @param {number|HTMLElement|HTMLElement[]|"all"} [target=thẻ đang chốt]
   */
  triggerEnterAnimation(target) {
    let targets = [];
    if (target === undefined || target === null) {
      if (this.els[this.hardIndex]) targets = [this.els[this.hardIndex]];
    } else if (typeof target === "number") {
      if (this.els[target]) targets = [this.els[target]];
    } else if (target === "all") {
      targets = [...this.els];
    } else if (target instanceof HTMLElement) {
      targets = [target];
    } else if (Array.isArray(target)) {
      targets = target;
    }

    targets.forEach((cardEl) => {
      const frame = cardEl.querySelector?.(".card-frame") || cardEl;
      if (!frame) return;

      const targetOpacity =
        frame.style.opacity || getComputedStyle(frame).opacity || "1";
      frame.style.setProperty("--slot-target-opacity", targetOpacity);
      this._restartAnimation(frame, "card-enter-slot", {
        durationVar: "--slot-enter-duration",
        onEnd: () => frame.style.removeProperty("--slot-target-opacity"),
      });
    });
  }

  /**
   * Hiệu ứng "nạp ảnh": ảnh bên trong zoom nhẹ + bo góc, chạy sau khi ảnh mới
   * đã sẵn sàng.
   *
   * @param {number|HTMLElement} [target=thẻ đang chốt]
   */
  triggerImageAnimation(target) {
    const cardEl =
      target instanceof HTMLElement
        ? target
        : this.els[target ?? this.hardIndex];
    const bg = cardEl?.querySelector(".card-bg");
    if (bg) {
      this._restartAnimation(bg, "card-fade-in", {
        durationVar: "--img-enter-duration",
      });
    }
  }

  /* ── Nền & thông tin thẻ ───────────────────────────────────────────────── */

  /** Bật/tắt dải màu nền lộ ra sau khe thẻ (kèm đường chỉ đỏ ở tâm). */
  setAccentBackground(enable) {
    this.hasAccentBg = Boolean(enable);
    this._applyAccentBg();
    this._notifyState();
  }

  toggleAccentBackground() {
    this.setAccentBackground(!this.hasAccentBg);
  }

  /** Ghi đè hàm vẽ thông tin thẻ trong vòng lặp layout. */
  setCardInfoListener(fn) {
    this.geometry.setCardInfoListener(fn);
  }

  getCardInfoListener() {
    return this.geometry.getCardInfoListener();
  }

  setDuration(ms) {
    this.duration = Math.max(50, Number(ms) || 800);
    this._notifyState();
  }

  /* ── Sự kiện ───────────────────────────────────────────────────────────── */

  /** Thẻ vừa lướt qua tâm. Trả về hàm huỷ đăng ký. */
  onSoftSelect(callback) {
    this._softListeners.add(callback);
    return () => this._softListeners.delete(callback);
  }

  /** Thẻ vừa được chốt (đã đứng yên). Trả về hàm huỷ đăng ký. */
  onHardSelect(callback) {
    this._hardListeners.add(callback);
    return () => this._hardListeners.delete(callback);
  }

  /** Mọi thay đổi trạng thái tổng thể. Trả về hàm huỷ đăng ký. */
  onStateChange(callback) {
    this._stateListeners.add(callback);
    callback?.(this.getState());
    return () => this._stateListeners.delete(callback);
  }

  /** Gỡ toàn bộ listener và vòng lặp — gọi khi tháo switcher. */
  destroy() {
    this._cancelAnimation();
    this._wheelClear();
    this._listeners.forEach(({ target, type, handler, options }) =>
      target.removeEventListener(type, handler, options),
    );
    this._listeners = [];
    this._softListeners.clear();
    this._hardListeners.clear();
    this._stateListeners.clear();
    document.body.classList.remove(DRAG_ROOT_CLASS);
  }

  /* ── Chuyển động ───────────────────────────────────────────────────────── */

  /**
   * Chạy một cú snap tới `target`: nội suy từ layout đang thực sự nằm trên DOM
   * (carousel có thể bị ngắt giữa chừng) tới layout của thẻ đích.
   */
  _animateTo(target, { force = false } = {}) {
    if (this.isDeleting || this.count === 0) return;

    const next = this._clamp(target);
    const alreadyThere =
      next === this.hardIndex && Math.abs(this.continuousIndex - next) < 0.001;

    if (alreadyThere && !this._animId && !force) return;

    this._setSettled(false);

    const from = this.geometry.readLayout(this.els, this._screenCenter());
    from.centerIndex = this.continuousIndex;

    this._anim = { from, to: this._layoutAt(next), start: 0, target: next };
    this._cancelAnimation();
    this._animId = requestAnimationFrame(this._tick);
    this._notifyState("soft");
  }

  /**
   * Một frame của cú snap: tiến độ theo thời gian thực, easing cố định.
   *
   * Khai báo bằng class field (arrow) chứ không phải method: `requestAnimationFrame`
   * gọi callback trần, không kèm `this`, mà ESM luôn ở strict mode — method
   * thường sẽ có `this === undefined` ngay frame đầu tiên.
   */
  _tick = (now) => {
    const anim = this._anim;
    if (!anim) return;

    if (!anim.start) anim.start = now;
    const progress = Math.min((now - anim.start) / this.duration, 1);
    const eased = easeOutExpo(progress);

    this.continuousIndex =
      (1 - eased) * anim.from.centerIndex + eased * anim.target;
    const closest = this._applyLayout(anim.from, anim.to, eased);
    if (closest !== -1 && closest !== this.softIndex) {
      this.softIndex = closest;
      this._notifySoft();
    }

    if (progress < 1) {
      this._animId = requestAnimationFrame(this._tick);
      return;
    }

    // Chạm đích: chốt cứng trên thẻ đích rồi mới báo, để bên nhận không bao
    // giờ thấy trạng thái "đã dừng nhưng chưa tới nơi".
    this._animId = null;
    this._anim = null;
    this.hardIndex = anim.target;
    this.softIndex = anim.target;
    this.continuousIndex = anim.target;
    this._applyLayout(anim.to, anim.to, 1);
    this._setSettled(true);
    this._notifyHard();
  };

  _cancelAnimation() {
    if (this._animId) {
      cancelAnimationFrame(this._animId);
      this._animId = null;
    }
  }

  /**
   * Pha thu cột sau khi thẻ bị xóa đã rơi khỏi khung: bề rộng slot của nó co về
   * 0 trong khi các thẻ còn lại trượt vào chỗ trống.
   */
  _collapseDeleted(index) {
    const start = this.geometry.readLayout(this.els, this._screenCenter());
    const futureCount = this.count - 1;
    // Chọn thẻ kế cận theo đúng quy tắc của store (`findNeighbour` trong
    // sourceActions.js): ưu tiên thẻ bên trái. Thẻ rời đi luôn nằm ở vị trí của
    // vị trí mới hoặc sau nó, nên hàng chỉ khép lại phía sau thẻ đang chốt; lệch
    // quy tắc ở đây là lệch luôn chỉ số mà store ghi lại sau đó.
    const nextActive = Math.max(0, index - 1);
    const future = this._layoutAt(nextActive, futureCount);

    // Dựng layout đích cho *cả* mảng hiện tại: thẻ bị xóa giữ width 0, các thẻ
    // còn lại nhận đúng chỗ của chúng trong danh sách tương lai.
    const widths = new Array(this.count);
    const lefts = new Array(this.count);
    let futureIdx = 0;
    for (let i = 0; i < this.count; i += 1) {
      if (i === index) {
        // Thẻ bị xóa co bề rộng về 0 tại đúng chỗ nó đang nằm, nên cột bên phải
        // trượt sang trái thay vì nhảy.
        widths[i] = 0;
        lefts[i] = start.lefts[i];
      } else {
        widths[i] = future.widths[futureIdx];
        lefts[i] = future.lefts[futureIdx];
        futureIdx += 1;
      }
    }
    const target = {
      widths,
      lefts,
      count: this.count,
      centerIndex: nextActive,
    };

    let startTime = 0;
    const step = (now) => {
      if (!startTime) startTime = now;
      const progress = Math.min((now - startTime) / COLLAPSE_MS, 1);
      const eased = easeOutExpo(progress);

      const closest = this._applyLayout(start, target, eased);
      if (closest !== -1 && closest !== this.softIndex) {
        this.softIndex = closest;
        this._notifySoft();
      }

      if (progress < 1) {
        requestAnimationFrame(step);
        return;
      }

      this.els[index]?.remove();
      this.items.splice(index, 1);
      this.els = this._collectEls();

      this.hardIndex = this._clamp(nextActive);
      this.softIndex = this.hardIndex;
      this.continuousIndex = this.hardIndex;

      this.isDeleting = false;
      this._recenterLayout();
      this.viewfinder?.classList.remove("is-hidden");
      this._setSettled(true);
      this._notifyHard();

      this._deleteResolve?.(true);
      this._deleteResolve = null;
    };

    requestAnimationFrame(step);
  }

  /* ── Thẻ hành động ─────────────────────────────────────────────────────── */

  /** Trả thẻ hành động về trạng thái chờ (huỷ hoặc lỗi). */
  _revertActionCard(cardEl, item, spinner, plusIcon, label) {
    cardEl.classList.remove("is-loading", "is-fading-out");
    if (spinner) spinner.style.display = "none";
    if (plusIcon) plusIcon.style.display = "block";
    if (label) label.textContent = item.name || this.actionConfig.name;
  }

  /**
   * Thay ô "lấy thêm" bằng thẻ vừa nhận, rồi nối một ô "lấy thêm" mới ở cuối.
   *
   * Thứ tự có chủ đích: icon loading mờ đi trước, sau đó ảnh mới mới hiện lên —
   * nếu đổi DOM ngay thì khối loading sẽ lộ ra phía sau tấm ảnh đang fade in.
   */
  async _commitActionCard(index, cardEl, newItem) {
    this.items[index] = newItem;
    this.items.push(createActionItem(this.actionConfig));

    // Ảnh của thẻ mới tải trước, tránh khoảnh khắc khung trống.
    await this._preloadImage(resolveImageUrl(newItem));

    cardEl.classList.add("is-fading-out");
    await new Promise((resolve) =>
      setTimeout(resolve, this._fadeOutDuration()),
    );

    cardEl.classList.remove("card-add-item", "is-loading", "is-fading-out");
    cardEl.dataset.isAddCard = "false";
    cardEl.dataset.id = newItem.id ?? index;

    const frame = cardEl.querySelector(".card-frame");
    if (frame) {
      frame.className = "card-frame";
      frame.innerHTML = `${this._imageFrameHtml(newItem, index)}${this._overlayHtml(newItem)}`;
      frame.style.removeProperty("opacity");

      // Ảnh mới zoom nhẹ vào khung, đi qua `triggerImageAnimation` để class được
      // gỡ bằng cả animationend lẫn hẹn giờ — nhét thẳng class vào HTML thì nó
      // nằm lại trên ảnh và chạy lại mỗi lần dải đồng bộ lại thứ tự node.
      this.triggerImageAnimation(cardEl);
    }

    const actionEl = this._createCard(
      this.items[this.items.length - 1],
      this.count - 1,
    );
    this.track?.appendChild(actionEl);
    this.els = this._collectEls();

    // Thẻ mới chiếm đúng slot cũ nên sân khấu không nhảy; chỉ cần đo lại layout.
    this._recenterLayout();
    this.triggerEnterAnimation(actionEl);
    this._notifyHard();
  }

  /** Thời gian fade của icon loading, đọc từ biến CSS để khớp với animation. */
  _fadeOutDuration() {
    return this._cssDuration(
      "--loading-fadeout-duration",
      FADE_OUT_FALLBACK_MS,
    );
  }

  /** Chờ ảnh tải xong (hoặc lỗi) để khung không hiện ra trống. */
  _preloadImage(url) {
    if (!url) return Promise.resolve();
    return new Promise((resolve) => {
      const image = new Image();
      image.onload = resolve;
      image.onerror = resolve;
      image.src = url;
    });
  }

  /**
   * Thử tải ảnh của thẻ; hỏng thì báo cho owner dựng lại thumbnail.
   *
   * Nền của `.card-bg` là `background-image` nên trình duyệt không bắn ra sự kiện
   * nào cho ta bắt — phải dò bằng một `Image()` riêng.
   */
  _probeThumbnail(item, cardEl, index) {
    if (!this.onThumbError) return;

    const url = resolveImageUrl(item);
    if (!url) return;

    const probe = new Image();
    probe.onerror = () => this.onThumbError?.(item, cardEl, index);
    probe.src = url;
  }

  /* ── Render ───────────────────────────────────────────────────────────── */

  _renderAll() {
    if (!this.track) return;
    this.track.innerHTML = "";
    this.items.forEach((item, index) => {
      this.track.appendChild(this._createCard(item, index));
    });
    this.els = this._collectEls();
  }

  _collectEls() {
    return this.track
      ? Array.from(this.track.querySelectorAll(".carousel-item"))
      : [];
  }

  /**
   * Dựng DOM cho một thẻ. Thẻ hành động dùng `.card-add-item` + dấu cộng/vòng
   * xoay ở tâm; thẻ ảnh dùng `.card-bg` với ảnh nền.
   *
   * Thẻ ra đời ở trạng thái tĩnh: hiệu ứng "vào slot" do `triggerEnterAnimation`
   * gắn sau khi thẻ đã nằm trong DOM. Nhờ vậy chỉ có đúng một đường sinh ra hiệu
   * ứng đó — và đường ấy luôn gỡ class lại sau khi chạy xong.
   */
  _createCard(item, index) {
    const card = document.createElement("div");
    card.className = "carousel-item mode-1";
    card.dataset.index = index + 1;
    card.dataset.id = item.id ?? index + 1;
    card.dataset.mode = "1";

    if (isActionItem(item)) {
      card.classList.add("card-add-item");
      card.dataset.isAddCard = "true";
      card.innerHTML = `
        <div class="card-frame card-add-frame">
          <div class="card-add-center">
            ${this._actionIconHtml(item)}
            <div class="card-loading-spinner" style="display: none;"></div>
          </div>
          ${this._overlayHtml(item)}
        </div>
      `;
    } else {
      card.innerHTML = `
        <div class="card-frame">
          ${this._imageFrameHtml(item, index, { animate: false })}
          ${this._overlayHtml(item)}
        </div>
      `;
      this._probeThumbnail(item, card, index);
    }

    return card;
  }

  /** Lớp ảnh của thẻ. `animate` bật hiệu ứng zoom khi ảnh vừa được thay. */
  _imageFrameHtml(item, index, { animate = false } = {}) {
    const url = escapeHtml(resolveImageUrl(item));
    return `
          <div class="card-bg${animate ? " card-fade-in" : ""}" style="background-image: url('${url}');"></div>
        `;
  }

  /**
   * Khối thông tin dưới đáy thẻ.
   *
   * Thẻ ảnh để rỗng ruột: chữ nằm đè lên ảnh chỉ làm bẩn chính tấm ảnh đang được
   * chọn, còn thông tin đầy đủ đã có ở hàng nút phía dưới. Các element vẫn giữ
   * nguyên (chỉ rỗng text) nên muốn bật lại chỉ là chuyện đổ chữ vào.
   *
   * Riêng thẻ hành động phải có nhãn: đó là chỗ duy nhất hiện trạng thái loading,
   * đếm ngược cooldown và gợi ý thử lại.
   */
  _overlayHtml(item) {
    if (isActionItem(item)) {
      const name = escapeHtml(item.name || "");
      const sub = escapeHtml(item.subLabel || "");
      return `
            <div class="carousel-overlay">
              <div class="card-info-inline">
                <span class="item-name card-add-label">${name}</span>
                <span class="info-sep"></span>
                <span class="item-num">${sub}</span>
              </div>
            </div>
          `;
    }

    const left = item.metaLeft || "";
    const right = item.metaRight || "";
    if (!left && !right) return `<div class="carousel-overlay"></div>`;

    return `
          <div class="carousel-overlay">
            <div class="card-meta-left">${left}</div>
            <div class="card-meta-right">${right}</div>
          </div>
        `;
  }

  /** Icon thẻ hành động: SVG do owner truyền, hoặc dấu cộng mặc định. */
  _actionIconHtml(item) {
    const svg = item.icon || this.actionConfig.icon;
    if (typeof svg === "string" && svg.trim().startsWith("<svg")) {
      const clean = svg.trim();
      return clean.includes("card-plus-icon")
        ? clean
        : clean.replace("<svg", '<svg class="card-plus-icon"');
    }
    return DEFAULT_ACTION_ICON;
  }

  /* ── Layout ───────────────────────────────────────────────────────────── */

  /** Tâm dải trong hệ toạ độ của `track`, đo theo container. */
  _screenCenter() {
    if (this._centerCache === null) {
      const width = this.container?.clientWidth || window.innerWidth;
      this._centerCache = width / 2;
    }
    return this._centerCache;
  }

  _layoutAt(index, count = this.count) {
    return this.geometry.computeLayout(
      this._clamp(index),
      count,
      this._screenCenter(),
    );
  }

  _applyLayout(from, to, t) {
    return this.geometry.applyLayout(
      this.els,
      from,
      to,
      t,
      this._screenCenter(),
    );
  }

  /** Đặt lại layout tĩnh tại thẻ đang chốt. */
  _recenterLayout() {
    const layout = this._layoutAt(this.hardIndex);
    this._applyLayout(layout, layout, 1);
  }

  _clamp(index) {
    if (this.count === 0) return 0;
    return Math.max(
      0,
      Math.min(this.count - 1, Math.round(Number(index) || 0)),
    );
  }

  _getCardMode(cardEl) {
    return cardEl?.classList.contains("mode-2")
      ? MODE_FREE_WIDTH
      : MODE_SLOT_WIDTH;
  }

  _applyAccentBg() {
    const hidden = !this.hasAccentBg;
    this.container?.classList.toggle("hide-accent-bg", hidden);
    this.track?.classList.toggle("hide-accent-bg", hidden);
    if (this.guide)
      this.guide.style.display = this.hasAccentBg ? "block" : "none";
  }

  /* ── Trạng thái & thông báo ───────────────────────────────────────────── */

  _setSettled(settled) {
    if (this.isSettled === settled) return;
    this.isSettled = settled;
    this.viewfinder?.classList.toggle("is-moving", !settled);
    this._notifyState(settled ? "hard" : "soft");
  }

  _notifySoft() {
    const item = this.items[this.softIndex] || null;
    this._softListeners.forEach((callback) =>
      callback(this.softIndex, this.els[this.softIndex], item),
    );
    this._notifyState("soft");
  }

  _notifyHard() {
    const item = this.items[this.hardIndex] || null;
    this._hardListeners.forEach((callback) =>
      callback(this.hardIndex, this.els[this.hardIndex], item),
    );
    this._notifyState("hard");
  }

  _notifyState(eventType = this.isSettled ? "hard" : "soft") {
    if (this._stateListeners.size === 0) return;
    const state = this.getState(eventType);
    this._stateListeners.forEach((callback) => callback(state));
  }

  /* ── Nhập liệu ────────────────────────────────────────────────────────── */

  _bindInput() {
    if (!this.container) return;

    this._listen(this.container, "wheel", this._onWheel, { passive: false });
    this._listen(this.container, "mousedown", this._onMouseDown);
    this._listen(this.container, "touchstart", this._onTouchStart, {
      passive: true,
    });
    this._listen(this.container, "click", this._onClick);
    this._listen(window, "mousemove", this._onMouseMove);
    this._listen(window, "mouseup", this._onMouseUp);
    this._listen(window, "touchmove", this._onTouchMove, { passive: true });
    this._listen(window, "touchend", this._onTouchEnd);
    this._listen(window, "resize", this._onResize);
  }

  _listen(target, type, handler, options) {
    target.addEventListener(type, handler, options);
    this._listeners.push({ target, type, handler, options });
  }

  _onWheel = (event) => {
    if (!this.isActive || this.isDeleting || this.count <= 1) return;

    // Gom delta rồi mới nhảy bậc: bánh xe rời rạc từng nấc nhỏ, cộng dồn lại
    // vẫn ra một bậc đúng ý người dùng mà không cần nuốt từng sự kiện.
    this._wheelAccum += event.deltaY || event.deltaX || 0;
    this._wheelClear(false);

    if (Math.abs(this._wheelAccum) < WHEEL_THRESHOLD) return;

    event.preventDefault();
    const direction = Math.sign(this._wheelAccum);
    this._wheelAccum = 0;
    this.scrollToCard(
      (this._anim ? this._anim.target : this.hardIndex) + direction,
    );

    this._wheelTimer = setTimeout(() => this._wheelClear(), WHEEL_RESET_MS);
  };

  _wheelClear(reset = true) {
    if (this._wheelTimer) clearTimeout(this._wheelTimer);
    this._wheelTimer = null;
    if (reset) this._wheelAccum = 0;
  }

  _onMouseDown = (event) => {
    if (event.button === 0) this._startDrag(event.clientX, event);
  };

  _onMouseMove = (event) => {
    if (this._drag?.source === "mouse") this._moveDrag(event.clientX);
  };

  _onMouseUp = () => {
    if (this._drag?.source === "mouse") this._endDrag();
  };

  _onTouchStart = (event) => {
    if (event.touches.length === 1)
      this._startDrag(event.touches[0].clientX, event);
  };

  _onTouchMove = (event) => {
    if (this._drag?.source === "touch" && event.touches.length === 1) {
      this._moveDrag(event.touches[0].clientX);
    }
  };

  _onTouchEnd = (event) => {
    if (this._drag?.source !== "touch") return;
    this._moveDrag(event.changedTouches[0]?.clientX ?? this._drag.lastX);
    this._endDrag();
  };

  _onClick = (event) => {
    if (!this.isActive || this.isDeleting) return;
    // Cú kéo vừa kết thúc cũng bắn click — bỏ qua để không nhảy thêm một bậc.
    if (this._suppressClick) {
      this._suppressClick = false;
      return;
    }

    const cardEl = event.target.closest?.(".carousel-item");
    if (!cardEl) return;

    const index = this.els.indexOf(cardEl);
    const item = this.items[index];
    if (index === -1 || !item) return;

    const handled = this.onCardClick?.(index, item, cardEl, {
      isCentered: index === this.hardIndex,
      engine: this,
    });
    if (handled) return;

    // Chỉ ô "lấy thêm" có phản ứng với cú click khi nó đang ở tâm: đó là lệnh
    // lấy nội dung. Thẻ ảnh cố tình KHÔNG nhảy theo click — bản phác thảo cũng
    // vậy, và mỗi cú click lỡ tay sẽ làm cả dải trượt đi mất một nhịp.
    if (isActionItem(item) && index === this.hardIndex)
      this.requestAction(index);
  };

  _startDrag(clientX, event) {
    if (!this.isActive || this.isDeleting || this.count <= 1) return;

    // Bỏ qua cú nhấn trên nút bấm bên trong thẻ (nếu có) để không cướp click.
    if (event?.target?.closest?.("button, a, input")) return;

    this._cancelAnimation();
    this._anim = null;
    this._setSettled(false);
    // Cờ chặn click của cú kéo trước phải được xoá ngay từ đầu cú mới: nếu cú
    // trước nhả chuột ngoài sân khấu thì click dọn dẹp không bao giờ tới.
    this._suppressClick = false;

    this._drag = {
      source: event?.type === "touchstart" ? "touch" : "mouse",
      startX: clientX,
      lastX: clientX,
      deltaX: 0,
      durationMs: 0,
      startIndex: this.continuousIndex,
      virtual: this.continuousIndex,
      startTime: performance.now(),
    };

    this.hardIndex = this._clamp(Math.round(this.continuousIndex));
    this.container.classList.add("is-dragging");
    document.body.classList.add(DRAG_ROOT_CLASS);
  }

  _moveDrag(clientX) {
    const drag = this._drag;
    if (!drag) return;

    const deltaX = clientX - drag.startX;
    drag.lastX = clientX;
    drag.deltaX = deltaX;
    drag.durationMs = performance.now() - drag.startTime;

    // Chỉ cần biết "đã kéo hay chưa" đủ sớm để click sau đó bị bỏ qua.
    if (isDragMoved(deltaX)) this._suppressClick = true;

    const virtual = dragToVirtualIndex(drag.startIndex, deltaX, this.count);
    drag.virtual = virtual;
    this.continuousIndex = virtual;

    const { from, to, progress } = splitVirtualIndex(virtual, this.count);
    const closest = this._applyLayout(
      this._layoutAt(from),
      this._layoutAt(to),
      progress,
    );
    if (closest !== -1 && closest !== this.softIndex) {
      this.softIndex = closest;
      this._notifySoft();
    }
  }

  _endDrag() {
    const drag = this._drag;
    if (!drag) return;
    this._drag = null;

    this.container.classList.remove("is-dragging");
    document.body.classList.remove(DRAG_ROOT_CLASS);

    const target = resolveDragTarget({
      virtualIndex: drag.virtual,
      deltaX: drag.deltaX,
      durationMs: drag.durationMs || 1,
      count: this.count,
    });

    // Luôn chạy snap, kể cả khi đích trùng thẻ đang chốt: sau một cú kéo, vị trí
    // thật đang lệch khỏi layout nguyên nên cần được kéo về cho khớp.
    this._animateTo(target, { force: true });
  }

  _onResize = () => {
    if (this.isDeleting || this.count === 0) return;
    this.recenter();
  };

  /* ── Tiện ích animation ───────────────────────────────────────────────── */

  /**
   * Chạy lại một class animation: gỡ, ép reflow, rồi gắn lại.
   *
   * Class được gỡ bằng hai đường: `animationend` của chính element (đường nhanh)
   * và một hẹn giờ dự phòng. Hẹn giờ là thứ bảo đảm class không bao giờ nằm lại
   * trên element — class nằm lại nghĩa là lần di chuyển DOM sau đó sẽ làm hiệu
   * ứng chạy lại từ đầu, ở một thẻ chẳng liên quan gì tới hành động vừa rồi.
   *
   * `animationend` cũng phải lọc theo `event.target`: sự kiện này bong bóng, nên
   * hiệu ứng của ảnh bên trong khung sẽ kết thúc sớm hiệu ứng của chính khung.
   */
  _restartAnimation(element, className, { durationVar, onEnd } = {}) {
    element.classList.remove(className);
    void element.offsetWidth;
    element.classList.add(className);

    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      element.removeEventListener("animationend", onAnimationEnd);
      element.classList.remove(className);
      onEnd?.();
    };
    const onAnimationEnd = (event) => {
      if (event.target === element) finish();
    };
    const timer = setTimeout(finish, this._cssDuration(durationVar, 900));
    element.addEventListener("animationend", onAnimationEnd);
  }

  /** Đọc một biến thời lượng CSS ("0.7s" / "700ms") ra mili-giây. */
  _cssDuration(variableName, fallbackMs) {
    if (!variableName) return fallbackMs;

    const raw = getComputedStyle(this.container || document.documentElement)
      .getPropertyValue(variableName)
      .trim();
    const value = Number.parseFloat(raw);
    if (!raw || !Number.isFinite(value)) return fallbackMs;

    return raw.endsWith("ms") ? value : value * 1000;
  }
}
