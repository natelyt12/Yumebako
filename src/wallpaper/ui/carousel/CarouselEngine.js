/**
 * CarouselEngine.js
 * ---------------------------------------------------------------------------
 * Động cơ carousel accordion
 * (IIFE gắn `window.Carousel`) sang ESM class, giữ nguyên mô hình chuyển động
 * của sketch:
 *
 *   - Bề rộng/toạ độ do `geometry` tính cho từng layout nguyên; khi lướt hoặc
 *     kéo thì nội suy giữa hai layout kề nhau, nên dù công thức bề rộng là rời
 *     rạc, chuyển động vẫn liên tục.
 *   - Snap bằng lò xo tới hạn (critically damped) trên `continuousIndex`: trạng
 *     thái chuyển động là (vị trí, vận tốc) nên retarget giữa chừng chỉ đổi đích,
 *     không dựng lại quỹ đạo — dải không nhảy vị trí và vận tốc không gãy khúc.
 *     Nghiệm đóng, nên frame dài gấp mấy cũng đúng và không bao giờ mất ổn định.
 *     `duration` là "bao lâu thì đứng yên", từ đó suy ra tần số lò xo.
 *     Nhả kéo thì truyền đà của cú kéo vào lò xo, nên dải đi tiếp liền mạch thay vì
 *     dừng ngay tại chỗ rồi mới được kéo về đích.
 *   - Hai tầng sự kiện: `softSelect` (thẻ vừa lướt qua tâm) và `hardSelect`
 *     (đã dừng hẳn) — tầng trên dùng soft để cập nhật preview, hard để chốt.
 *
 * Khác sketch (có chủ đích, để ghép được vào hệ wallpaper):
 *   - Bàn phím không bị chiếm toàn cục: engine chỉ có `stepByKey()`, owner tự
 *     gắn phím (switcher dành ↑/↓ cho việc đổi nguồn).
 *   - Wheel/drag chỉ sống khi `setActive(true)`; wheel chỉ `preventDefault` khi
 *     thật sự tiêu thụ sự kiện.
 *   - Engine không biết store/API nào đứng sau: việc lấy thêm nội dung do
 *     `DataControl.requestMore()` lo, engine chỉ nhận thẻ mới rồi hiển thị.
 *   - Tâm màn hình đo theo container (`clientWidth / 2`) thay vì `window.innerWidth`.
 *
 * Không phụ thuộc framework: chỉ DOM, RAF và các module thuần trong thư mục này.
 */

import { clamp, easeOutExpo } from "./easing.js";
import { createGeometry } from "./geometry.js";
import {
  animateUnpinDrop,
  dragToVirtualIndex,
  isDragMoved,
  resolveDragTarget,
  splitVirtualIndex,
} from "./physics.js";
import { resolveImageUrl } from "./items.js";

/**
 * Ngưỡng gom delta chuột để tính là một bậc cuộn.
 *
 * Xuất ra ngoài để test/harness bắn nấc đủ lớn — nấc nhỏ hơn ngưỡng sẽ bị cộng dồn
 * chứ không nhảy bậc, và ngưỡng này chỉnh theo cảm giác tay nên đổi là chuyện thường.
 */
export const WHEEL_THRESHOLD = 40;
/** Không có bánh xe nào trong ngần này thì bộ gom được xoá. */
const WHEEL_RESET_MS = 250;
/** Khoảng cách tối thiểu giữa hai lần bấm phím liên tiếp. */
const NAV_COOLDOWN_MS = 80;
/** Animation duration for collapse after card delete. */
const COLLAPSE_MS = 600;

/** Thời gian fade của một thẻ bị cắt khỏi cửa sổ dữ liệu (khớp carousel.css). */
const FADE_OUT_MS = 200;

/**
 * Tần số lò xo suy từ `duration`: ω = SPRING_OMEGA / (duration / 1000).
 *
 * Lò xo tới hạn đi hết 99% quãng đường ở ω·t ≈ 6.6 và đứng hẳn ở ω·t ≈ 9.6, nên 10
 * nghĩa là "tới nơi ở ~0.66·duration, đứng yên ở ~0.96·duration" — tức `duration`
 * vẫn giữ đúng nghĩa cũ là bao lâu thì dải dừng.
 */
const SPRING_OMEGA = 10;
/** Bước thời gian tối đa cho một lần tính (ms): tab bị treo cả giây thì bỏ qua, đừng nhảy một cú. */
const SPRING_MAX_STEP_MS = 100;
/** Xa đích dưới ngần này và chậm dưới ngần kia thì coi như đã đứng yên. */
const SPRING_POS_EPS = 0.001;
const SPRING_VEL_EPS = 0.01;

/**
 * Mỗi mẫu `mousemove` chỉ chiếm ngần này trọng số trong vận tốc kéo.
 *
 * Vận tốc lấy từ hai mẫu liền nhau, mà hai sự kiện chỉ cách nhau vài ms nên sai số
 * toạ độ bị khuếch đại; làm mượt để một mẫu nhiễu không quyết định cú nhả.
 */
const DRAG_VELOCITY_SMOOTH = 0.4;
/** Đã đứng yên ngần này (ms) thì đà của cú kéo coi như tắt hẳn. */
const RELEASE_DECAY_MS = 80;
/**
 * Trần quãng vượt đích cho phép của cú nhả tay (đơn vị: thẻ).
 *
 * Lò xo tới hạn khởi hành thuần bằng vận tốc vượt đích xa nhất `v / (ω·e)`, nên
 * chặn vận tốc ở `v ≤ 0.25·ω·e` là chặn quãng vượt ở 0.25 thẻ: đủ để thấy đà mà
 * không biến mỗi lần nhả tay thành một cú nảy qua nửa thẻ — và vì luôn dưới 0.5
 * thẻ, nó cũng không làm nhảy chỉ số `soft`.
 *
 * Xuất ra ngoài để test khẳng định đúng trần này thay vì chép lại con số.
 */
export const MAX_FLICK_OVERSHOOT = 0.25;

const MODE_SLOT_WIDTH = 1;
const MODE_FREE_WIDTH = 2;

/** Class added to body while dragging. */
const DRAG_ROOT_CLASS = "wp-carousel-dragging";

export class CarouselEngine {
  /**
   * @param {Object} options
   * @param {HTMLElement} options.container
   * @param {HTMLElement} options.track
   * @param {HTMLElement} [options.guide]
   * @param {HTMLElement} [options.viewfinder]
   * @param {number} [options.duration=800]
   * @param {Object} [options.geometry]
   * @param {(index: number, item: Object, cardEl: HTMLElement, ctx: Object) => boolean|void} [options.onCardClick]
   * @param {(item: Object, cardEl: HTMLElement, index: number) => void} [options.onThumbError]
   */
  constructor({
    container,
    track,
    guide = null,
    viewfinder = null,
    duration = 800,
    geometry = {},
    onCardClick = null,
    onThumbError = null,
  } = {}) {
    this.container = container;
    this.track = track;
    this.guide = guide;
    this.viewfinder = viewfinder;

    this.duration = Math.max(50, Number(duration) || 800);
    this.geometry = createGeometry(geometry);

    this.onCardClick = onCardClick;
    this.onThumbError = onThumbError;
    this._deleteResolve = null;

    /** @type {Array<Object>} */
    this.items = [];
    /** @type {HTMLElement[]} */
    this.els = [];

    this.hasAccentBg = false;
    this.isActive = false;
    this.isSettled = true;
    this.isDeleting = false;

    /** Chỉ số đã chốt (hard) — chỉ đổi khi chuyển động kết thúc. */
    this.hardIndex = 0;
    /** Chỉ số đang lướt qua tâm (soft) — đổi ngay khi tâm vượt sang thẻ khác. */
    this.softIndex = 0;
    /** Vị trí ảo liên tục, có thể lẻ và có thể nằm ngoài biên khi kéo quá mép. */
    this.continuousIndex = 0;

    this._animId = null;
    this._anim = null;
    /**
     * Layout đang thật sự nằm trên DOM, do `_applyLayout()` ghi lại mỗi frame.
     * Pha thu cột khi xoá cần nó làm điểm xuất phát — xem `_currentLayout()`.
     * @type {{ widths: number[], lefts: number[], count: number, centerIndex: number }|null}
     */
    this._liveLayout = null;
    /** Id RAF của pha thu cột sau khi xóa — tách khỏi `_animId` vì không phải snap. */
    this._collapseId = null;
    /** Chốt pha thu cột ngay lập tức, dùng khi animation bị hủy giữa chừng. */
    this._finishCollapse = null;
    this._centerCache = null;
    this._wheelAccum = 0;
    this._wheelTimer = null;
    this._lastKeyTime = 0;
    this._drag = null;
    this._listeners = [];

    this._softListeners = new Set();
    this._hardListeners = new Set();
    this._stateListeners = new Set();
    this._suppressHardSelect = false;

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

  /** Snapshot of current state. */
  getState(eventType = this.isSettled ? "hard" : "soft") {
    const activeCard = this.els[this.softIndex] || this.els[this.hardIndex];
    let status = "idle";
    if (this.isDeleting) status = "deleting";
    else if (!this.isSettled) status = "moving";

    return {
      status,
      hasAccentBg: this.hasAccentBg,
      currentCardIndex: this.hardIndex,
      softCardIndex: this.softIndex,
      totalContent: this.count,
      duration: this.duration,
      isDeleting: this.isDeleting,
      activeCardMode: this._getCardMode(activeCard),
      isSettled: this.isSettled,
      eventType,
      softItem: this.items[this.softIndex] || null,
      hardItem: this.activeItem,
    };
  }

  /* ── Nạp dữ liệu ───────────────────────────────────────────────────────── */

  /**
   * Nạp danh sách mới và dựng lại DOM ngay tại `index`.
   *
   * @param {Array<Object>} items
   * @param {number} [index=0]
   * @param {Object} [options]
   * @param {boolean} [options.silent=false] - Không phát hard-select cho lần dựng lại này.
   */
  setItems(items, index = 0, { silent = false } = {}) {
    const wasSuppressingHardSelect = this._suppressHardSelect;
    this._suppressHardSelect ||= silent;

    try {
      this._cancelAnimation();
      this._setSettled(true);
      this._anim = null;
      this._drag = null;
      // Dải sắp được dựng lại từ đầu: bỏ layout cũ để không dùng nhầm nó làm điểm xuất phát.
      this._liveLayout = null;

      this.items = this._uniqueItems(items);
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

      if (silent) this._notifyState();
      else this._notifyHard();
      return this;
    } finally {
      this._suppressHardSelect = wasSuppressingHardSelect;
    }
  }

  /** Gán lại ảnh cho một thẻ — dùng khi thumbnail cũ hỏng và được dựng lại. */
  setCardImage(cardEl, url) {
    if (!cardEl || !url) return;
    cardEl._bgUrl = url;
    cardEl.dataset.bgUrl = url;
    cardEl._isImageLoaded = true;
    const bg = cardEl._cachedNodes?.bg || cardEl.querySelector('.card-bg');
    if (bg) bg.style.backgroundImage = 'url(\x27' + url + '\x27)';
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
  stop({ immediate = false } = {}) {
    this._cancelAnimation();
    this._anim = null;
    this._drag = null;
    this._setSettled(true);
    if (immediate) {
      this.resetToHard();
    }
  }

  /** Đặt lại dải về đúng vị trí thẻ đã chốt (hardIndex). */
  resetToHard() {
    this.continuousIndex = this.hardIndex;
    this.softIndex = this.hardIndex;
    this._recenterLayout();
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
   * @param {boolean} [options.animate=true] - Kích hoạt hiệu ứng enter cho thẻ mới tạo.
   */
  syncItems(
    items,
    index = this.hardIndex,
    { silent = false, animate = true } = {},
  ) {
    if (!this.track) return this;

    this._cancelAnimation();
    this._anim = null;
    this._drag = null;
    this._liveLayout = null;

    const next = this._uniqueItems(items);
    const wanted = new Set(next.map((item, i) => this._cardKey(item, i)));

    // Thẻ bị xoá thường đã tự rời DOM ở pha thu cột; những thẻ bị cắt khỏi danh
    // sách vì lý do khác (cửa sổ dài quá giới hạn) thì được gỡ ở đây.
    //
    // Duyệt toàn bộ track chứ không chỉ `this.els`: một node lỡ nằm ngoài mảng
    // (lần đồng bộ trước lệch) sẽ không bao giờ được gỡ nếu chỉ duyệt `els` —
    // nó nằm lại dải mãi như một cái thẻ ma, không layout nào ghi tới nữa.
    this._collectEls().forEach((el) => {
      if (!wanted.has(el.dataset.id)) el.remove();
    });

    const existing = new Map(
      this._collectEls().map((el) => [el.dataset.id, el]),
    );
    this.items = next;

    const fresh = [];
    const ordered = next.map((item, i) => {
      const known = existing.get(this._cardKey(item, i));
      if (known) {
        known.dataset.index = i + 1;
        const newUrl = resolveImageUrl(item);
        if (known._bgUrl !== newUrl) {
          known._bgUrl = newUrl;
          known.dataset.bgUrl = newUrl;
          if (known._isImageLoaded && known._cachedNodes?.bg) {
            known._cachedNodes.bg.style.backgroundImage = 'url(\'' + newUrl + '\')';
          }
        }
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
    // cú xoá sẽ làm mọi thẻ (và ảnh bên trong) nhảy nhót dù không liên quan gì.
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
    if (fresh.length && animate) this.triggerEnterAnimation(fresh);

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
      if (this._drag) {
        this._endDrag();
      } else if (
        !this._anim &&
        Math.abs(this.continuousIndex - this.hardIndex) > SPRING_POS_EPS
      ) {
        this.scrollToCard(this._clamp(Math.round(this.continuousIndex)));
      }
    }
  }

  /* ── Thao tác với thẻ đang chốt ────────────────────────────────────────── */

  /**
   * Delete settled active card.
   *
   * @returns {Promise<boolean>}
   */
  deleteActiveCard() {
    if (this.isDeleting || this._animId || this.count === 0)
      return Promise.resolve(false);

    const index = this.hardIndex;
    const cardEl = this.els[index];
    if (!cardEl) return Promise.resolve(false);

    this.isDeleting = true;
    this.viewfinder?.classList.add("is-hidden");
    this._notifyState();

    // Mode 2: khung ảnh tách khỏi bề rộng slot, nên hiệu ứng rơi không bị cột
    // đang thu lại kéo méo.
    this.setCardMode(cardEl, MODE_FREE_WIDTH);
    cardEl.classList.add("deleting");

    const frame = cardEl.querySelector(".card-frame");
    frame?.classList.add("slide-down");

    // Resolver phải có sẵn trước khi hiệu ứng chạy: nếu khung thiếu thì callback
    // hoàn tất được gọi đồng bộ, và promise sẽ không còn đường nào để resolve.
    const settled = new Promise((resolve) => {
      this._deleteResolve = resolve;
    });

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

      return settled;
    }

    if (frame) animateUnpinDrop(frame, () => this._collapseDeleted(index));
    else this._collapseDeleted(index);


    // Bên gọi (adapter của store) cần biết lúc nào thẻ đã thực sự rời danh sách
    // để đồng bộ lại cửa sổ dữ liệu.
    return settled;
  }

  /**
   * Khoảng index của các thẻ đang giao viewport. Dùng khi cần biết một thẻ cụ thể
   * (ví dụ thẻ cũ nhất sắp bị cắt) có đang hiện trước mắt người dùng hay không.
   *
   * @returns {{ first: number, last: number }} `-1` khi không có thẻ nào.
   */
  visibleIndexRange() {
    const layout = this._liveLayout || this._layoutAt(this.hardIndex);
    if (!layout || layout.count === 0) return { first: -1, last: -1 };

    const viewportRight = this._screenCenter() * 2;
    let first = -1;
    let last = -1;

    for (let i = 0; i < layout.count; i += 1) {
      const left = layout.lefts[i];
      const width = layout.widths[i];
      if (left + width > 0 && left < viewportRight) {
        if (first === -1) first = i;
        last = i;
      }
    }

    return { first, last };
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
   * Hiệu ứng "thẻ vào slot": zoom nhẹ + fade, tách opacity animation khỏi
   * `.card-frame` để layout tiếp tục cập nhật độ mờ theo khoảng cách tới tâm.
   *
   * @param {number|HTMLElement|HTMLElement[]} [target=thẻ đang chốt]
   */
  triggerEnterAnimation(target) {
    let targets = [];
    if (target === undefined || target === null) {
      if (this.els[this.hardIndex]) targets = [this.els[this.hardIndex]];
    } else if (typeof target === "number") {
      if (this.els[target]) targets = [this.els[target]];
    } else if (target instanceof HTMLElement) {
      targets = [target];
    } else if (Array.isArray(target)) {
      targets = target;
    }

    targets.forEach((cardEl) => {
      const content = cardEl.querySelector?.(".card-content");
      if (!content) return;

      this._restartAnimation(content, "card-enter-slot", {
        durationVar: "--slot-enter-duration",
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

  /**
   * Đổi thời lượng chuyển động (ms). Với lò xo, đây là mốc "bao lâu thì dải đứng
   * yên" chứ không phải độ dài một tween — xem `SPRING_OMEGA`.
   */
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
   * Cho dải chạy tới `target` bằng lò xo tới hạn.
   *
   * Retarget giữa chừng chỉ đổi đích, giữ nguyên (vị trí, vận tốc) đang có: quỹ đạo
   * không bị dựng lại nên dải không nhảy một cú nào và vận tốc không gãy khúc. Đó
   * là hai thứ mà tween có thời lượng cố định không tránh được, vì dựng lại là reset
   * đồng hồ về 0.
   *
   * @param {number} target - Chỉ số đích (đã hoặc chưa kẹp biên).
   * @param {Object} [options]
   * @param {boolean} [options.force=false] - Chạy kể cả khi đang đứng yên tại đích.
   * @param {number|null} [options.velocity=null] - Vận tốc đầu (bậc/giây), dùng khi nhả kéo.
   * @param {number|null} [options.sinceMs=null] - Mốc đồng hồ của lò xo bắt đầu; bỏ trống thì nối tiếp đồng hồ của cú đang chạy.
   */
  _animateTo(target, { force = false, velocity = null, sinceMs = null } = {}) {
    if (this.isDeleting || this.count === 0) return;

    const next = this._clamp(target);

    // Đang nhắm đúng đích này rồi thì không có gì để dựng lại. Quan trọng nhất ở
    // sát biên: lăn tiếp sau khi đã ở thẻ cuối thì mọi nấc đều bị clamp về cùng một
    // đích, dựng lại lò xo mỗi nấc là liên tục bơm vận tốc về 0 — dải bò rồi khựng
    // theo từng nấc chuột, và không bao giờ chốt được `hardIndex`.
    if (!force && this._anim?.target === next) return;

    const atRest =
      !this._anim &&
      next === this.hardIndex &&
      Math.abs(this.continuousIndex - next) < SPRING_POS_EPS;

    if (!force && atRest) return;

    this._setSettled(false);
    this._anim = {
      target: next,
      // Vận tốc của cú đang chạy được giữ nguyên khi đổi đích — đây chính là chỗ
      // nối tiếp mượt thay cho việc reset đồng hồ easing.
      vx: velocity ?? this._anim?.vx ?? 0,
      // Đồng hồ cũng phải theo chuyển động chứ không theo từng nấc. Reset về null ở
      // mỗi nấc thì frame kế tiếp có `dt = 0`; lăn mỗi frame một nấc là chuỗi
      // `dt = 0` liên tiếp, dải đứng yên cho tới khi người dùng ngừng lăn rồi mới
      // nhảy bù một mạch. `sinceMs` là cú nhả kéo: lò xo ra đời ngay tại đó, nên
      // đồng hồ tính từ đó chứ không phải từ frame sau.
      lastMs: sinceMs ?? this._anim?.lastMs ?? null,
    };
    this._cancelAnimation();
    this._animId = requestAnimationFrame(this._tick);
    this._notifyState("soft");
  }

  /**
   * Một frame của lò xo.
   *
   * Nghiệm đóng của lò xo tới hạn (tỉ số cản = 1) quanh một đích cố định:
   *   u(t) = (u₀ + (v₀ + ω·u₀)·t)·e^(−ω·t),   u = vị trí − đích
   * nên frame dài gấp mấy cũng chỉ là một `t` lớn hơn: không tích lũy sai số, không
   * mất ổn định, khác hẳn cách cộng dồn kiểu `v += a·dt`.
   *
   * Khai báo bằng class field (arrow) chứ không phải method: `requestAnimationFrame`
   * gọi callback trần, không kèm `this`, mà ESM luôn ở strict mode — method
   * thường sẽ có `this === undefined` ngay frame đầu tiên.
   */
  _tick = (nowMs) => {
    const anim = this._anim;
    if (!anim) return;

    if (anim.lastMs === null) anim.lastMs = nowMs;
    const dt =
      Math.min(Math.max(nowMs - anim.lastMs, 0), SPRING_MAX_STEP_MS) / 1000;
    anim.lastMs = nowMs;

    const omega = this._springOmega();
    const u0 = this.continuousIndex - anim.target;
    const slope = anim.vx + omega * u0;
    const decay = Math.exp(-omega * dt);

    this.continuousIndex = anim.target + (u0 + slope * dt) * decay;
    anim.vx = (slope - omega * (u0 + slope * dt)) * decay;

    const closest = this._renderAt(this.continuousIndex);
    if (closest !== -1 && closest !== this.softIndex) {
      this.softIndex = closest;
      this._notifySoft();
    }

    if (
      Math.abs(this.continuousIndex - anim.target) > SPRING_POS_EPS ||
      Math.abs(anim.vx) > SPRING_VEL_EPS
    ) {
      this._animId = requestAnimationFrame(this._tick);
      return;
    }

    // Đứng yên: chốt cứng trên thẻ đích rồi mới báo, để bên nhận không bao giờ
    // thấy trạng thái "đã dừng nhưng chưa tới nơi".
    this._animId = null;
    this._anim = null;
    this.hardIndex = anim.target;
    this.softIndex = anim.target;
    this.continuousIndex = anim.target;
    this._renderAt(anim.target);
    this._setSettled(true);
    this._notifyHard();
  };

  /** Tần số góc của lò xo, suy từ `duration` — xem `SPRING_OMEGA`. */
  _springOmega() {
    return SPRING_OMEGA / Math.max(0.05, this.duration / 1000);
  }

  /**
   * Vẽ dải tại vị trí ảo `index` (số thực) theo layout chuẩn của vị trí đó.
   *
   * Vẽ lại từ vị trí thay vì nội suy giữa hai layout của cú snap: khi bị retarget,
   * vị trí là biến trạng thái duy nhất còn đúng, cặp layout của cú cũ đã hết nghĩa.
   *
   * @returns {number} Chỉ số thẻ gần tâm (-1 nếu chưa có thẻ nào).
   */
  _renderAt(index) {
    const count = this.els.length;
    if (count === 0) return -1;
    const layout = this.geometry.computeInterpolatedLayout(
      index,
      count,
      this._screenCenter(),
    );
    return this._applyLayout(layout, layout, 1);
  }

  _cancelAnimation() {
    if (this._animId) {
      cancelAnimationFrame(this._animId);
      this._animId = null;
    }
    // Pha thu cột không đi qua `_animId` (nó không phải một cú snap), nên phải
    // kết thúc ngay tại đây: bỏ dở thì thẻ nằm kẹt giữa hai layout và promise
    // của `deleteActiveCard()` không bao giờ resolve.
    if (this._collapseId) {
      cancelAnimationFrame(this._collapseId);
      this._collapseId = null;
      this._finishCollapse?.();
    }
  }

  /**
   * Pha thu cột sau khi thẻ bị xóa đã rơi khỏi khung: bề rộng slot của nó co về
   * 0 trong khi các thẻ còn lại trượt vào chỗ trống.
   */
  _collapseDeleted(index) {
    const start = this._currentLayout();
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
    // DOM indexes remain uncompressed until the collapse ends; track each
    // surviving card's eventual index so its opacity follows its visual slot.
    const opacityIndices = new Array(this.count);
    let futureIdx = 0;
    for (let i = 0; i < this.count; i += 1) {
      if (i === index) {
        // Thẻ bị xóa co bề rộng về 0 tại đúng chỗ nó đang nằm, nên cột bên phải
        // trượt sang trái thay vì nhảy.
        widths[i] = 0;
        lefts[i] = start.lefts[i];
        opacityIndices[i] = nextActive;
      } else {
        widths[i] = future.widths[futureIdx];
        lefts[i] = future.lefts[futureIdx];
        opacityIndices[i] = futureIdx;
        futureIdx += 1;
      }
    }
    const target = {
      widths,
      lefts,
      count: this.count,
      centerIndex: nextActive,
      opacityIndices,
    };

    let startTime = 0;
    let finished = false;

    const finish = () => {
      if (finished) return;
      finished = true;
      this._collapseId = null;
      this._finishCollapse = null;

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

    // Mở đường cho `_cancelAnimation()` (đóng switcher, đổi danh sách) chốt pha
    // co cột ngay lập tức thay vì để vòng RAF ghi tiếp vào DOM đã bị tháo.
    this._finishCollapse = finish;

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
        this._collapseId = requestAnimationFrame(step);
        return;
      }

      finish();
    };

    this._collapseId = requestAnimationFrame(step);
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
   * Khoá định danh của một thẻ — cũng là `dataset.id` của node trong DOM.
   *
   * `dataset` luôn là chuỗi, nên id dạng số và dạng chuỗi của cùng một bản ghi
   * phải quy về cùng một khoá; lệch kiểu thì mỗi lần đồng bộ lại gỡ rồi dựng
   * lại thẻ, ảnh đã tải mất theo. Thẻ không có id dùng vị trí, và tiền tố `#`
   * để không đụng id thật nào trùng với số thứ tự.
   *
   * @param {Object} item
   * @param {number} [index] - Vị trí dùng làm khoá dự phòng; bỏ trống thì trả `null`.
   * @returns {string|null}
   */
  _cardKey(item, index = -1) {
    const id = item?.id;
    if (id !== undefined && id !== null && id !== "") return String(id);
    return index >= 0 ? `#${index}` : null;
  }

  /**
   * Bỏ các thẻ trùng khoá, giữ bản xuất hiện đầu tiên.
   *
   * Động cơ đối chiếu thẻ theo khoá, nên hai bản ghi cùng khoá sẽ cùng trỏ về
   * một element DOM: một slot mất ảnh, element bị ghi layout hai lần và bản còn
   * lại trong track thành thẻ ma. Nguồn ảnh remote có thể trả lại ảnh đã có
   * (Wallhaven xếp random trả lại đúng bức cũ khi bộ lọc cạn ảnh), nên chặn ở
   * đây là chốt cuối cùng trước khi dải bị vỡ.
   *
   * @param {Array<Object>} items
   * @returns {Array<Object>}
   */
  _uniqueItems(items) {
    if (!Array.isArray(items)) return [];

    const seen = new Set();
    const unique = [];
    for (const item of items) {
      const key = this._cardKey(item);
      if (key !== null) {
        if (seen.has(key)) continue;
        seen.add(key);
      }
      unique.push(item);
    }
    return unique;
  }

  /**
   * Dựng DOM cho một thẻ ảnh: `.card-bg` (ảnh nền) + `.carousel-overlay` (meta).
   *
   * Thẻ ra đời ở trạng thái tĩnh: hiệu ứng "vào slot" do `triggerEnterAnimation`
   * gắn sau khi thẻ đã nằm trong DOM. Nhờ vậy chỉ có đúng một đường sinh ra hiệu
   * ứng đó — và đường ấy luôn gỡ class lại sau khi chạy xong.
   */
  _createCard(item, index) {
    const card = document.createElement("div");
    card.className = "carousel-item mode-1";
    card.dataset.index = index + 1;
    card.dataset.id = this._cardKey(item, index);
    card.dataset.mode = "1";

    const url = resolveImageUrl(item);
    card._bgUrl = url;
    card.dataset.bgUrl = url;
    card._item = item;
    card._index = index;
    card._engine = this;
    card._isImageLoaded = false;

    card.innerHTML = `
      <div class="card-frame">
        <div class="card-content">
          ${this._imageFrameHtml()}
          ${this._overlayHtml()}
        </div>
      </div>
    `;

    card._cachedNodes = {
      overlay: card.querySelector(".carousel-overlay"),
      frame: card.querySelector(".card-frame"),
      bg: card.querySelector(".card-bg"),
    };

    return card;
  }

  /** Lớp ảnh của thẻ; animation được kích hoạt sau khi node đã vào DOM. */
  _imageFrameHtml() {
    return `<div class="card-bg"></div>`;
  }

  /**
   * Overlay placeholder at the bottom of the card (metadata has moved to Top Bar).
   */
  _overlayHtml() {
    return `<div class="carousel-overlay"></div>`;
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

  /**
   * Layout thật đang nằm trên DOM — điểm xuất phát cho pha thu cột khi xoá.
   *
   * KHÔNG dựng lại layout từ `continuousIndex`: nếu lúc xoá dải đang chạy dở thì
   * các frame đang là blend của nhiều layout (phần còn sót của những layout trước
   * vẫn nằm trong công thức nội suy), nên bản dựng lại chỉ có 2 layout sẽ lệch hẳn
   * so với những gì đang hiện trên màn hình — đúng một cú nhảy ở frame đầu của pha
   * thu cột. `readLayout()` chỉ còn là đường dự phòng khi chưa có layout nào được ghi.
   *
   * @returns {{ widths: number[], lefts: number[], count: number, centerIndex: number }}
   */
  _currentLayout() {
    const live = this._liveLayout;
    if (live && live.count === this.els.length) return { ...live };
    return this.geometry.readLayout(
      this.els,
      this._screenCenter(),
      this.continuousIndex,
    );
  }

  _applyLayout(from, to, t) {
    const { closestIndex, layout } = this.geometry.applyLayout(
      this.els,
      from,
      to,
      t,
      this._screenCenter(),
    );
    if (layout) this._liveLayout = layout;
    return closestIndex;
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
    if (this._suppressHardSelect) return;
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

    this.onCardClick?.(index, item, cardEl, {
      isCentered: index === this.hardIndex,
      engine: this,
    });
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
      // Mẫu trước đó để đo vận tốc kéo — xem `_releaseVelocity()`.
      sampleMs: performance.now(),
      sampleVirtual: this.continuousIndex,
      vx: 0,
    };

    this.hardIndex = this._clamp(Math.round(this.continuousIndex));
    this.container.classList.add("is-dragging");
    document.body.classList.add(DRAG_ROOT_CLASS);
  }

  _moveDrag(clientX) {
    const drag = this._drag;
    if (!drag) return;

    const deltaX = clientX - drag.startX;
    const now = performance.now();
    drag.lastX = clientX;
    drag.deltaX = deltaX;
    drag.durationMs = now - drag.startTime;

    // Chỉ cần biết "đã kéo hay chưa" đủ sớm để click sau đó bị bỏ qua.
    if (isDragMoved(deltaX)) this._suppressClick = true;

    const virtual = dragToVirtualIndex(drag.startIndex, deltaX, this.count);
    drag.virtual = virtual;
    this.continuousIndex = virtual;

    // Vận tốc để truyền cho lò xo lúc nhả tay, lấy từ hai mẫu liền nhau rồi làm mượt.
    const sampleMs = now - drag.sampleMs;
    if (sampleMs > 0) {
      const instant = ((virtual - drag.sampleVirtual) / sampleMs) * 1000;
      drag.vx += (instant - drag.vx) * DRAG_VELOCITY_SMOOTH;
      drag.sampleMs = now;
      drag.sampleVirtual = virtual;
    }

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
    // thật đang lệch khỏi layout nguyên nên cần được kéo về cho khớp. Kèm theo đà
    // của cú kéo — không có đà thì dải dừng ngay tại chỗ rồi mới được kéo về, đúng
    // một cú khựng ở mỗi lần nhả tay.
    const releaseMs = performance.now();
    this._animateTo(target, {
      force: true,
      velocity: this._releaseVelocity(drag, releaseMs),
      // Đồng hồ của lò xo bắt đầu từ lúc NHẢ, không phải từ mẫu di chuột cuối: dừng
      // tay rồi mới buông là chuyện thường, mà suốt quãng đứng yên đó dải cũng đứng
      // yên theo tay. Tính quãng đó vào đồng hồ thì frame đầu sau khi nhả đã đi một
      // mạch bằng cả quãng đứng yên (tối đa `SPRING_MAX_STEP_MS`) — dải giật một cú
      // về phía đích rồi mới bò nốt phần còn lại.
      sinceMs: releaseMs,
    });
  }

  /**
   * Vận tốc của dải lúc nhả tay, quy về bậc/giây.
   *
   * Dùng vận tốc đã làm mượt của những mẫu di chuột cuối, không dùng trung bình cả
   * cú kéo: kéo chậm rồi hất một cái ở cuối là chuyện thường, mà trung bình cả cú
   * sẽ nuốt mất cú hất đó.
   *
   * @param {Object} drag
   * @param {number} nowMs - Mốc nhả tay (ms), cũng là mốc suy ra quãng tay đứng yên.
   * @returns {number} Vận tốc (bậc/giây), dương = đi về phía chỉ số tăng.
   */
  _releaseVelocity(drag, nowMs) {
    // Buông chuột sau khi đã đứng yên thì đà cũng hết: cho tắt dần theo thời gian,
    // thay vì bắn dải đi bằng vận tốc của lần di chuột cuối cùng.
    const idleMs = nowMs - drag.sampleMs;
    const limit = MAX_FLICK_OVERSHOOT * this._springOmega() * Math.E;
    const velocity = clamp(
      drag.vx * Math.exp(-idleMs / RELEASE_DECAY_MS),
      -limit,
      limit,
    );

    // Kéo vượt mép rồi nhả: đà đang hướng ra ngoài danh sách thì bỏ, chứ dải sẽ bay
    // xa thêm khỏi mép và để hở một quãng — ở ngoài đó không có gì để đi tới.
    const last = this.count - 1;
    const outward =
      (velocity < 0 && this.continuousIndex <= 0) ||
      (velocity > 0 && this.continuousIndex >= last);
    return outward ? 0 : velocity;
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
