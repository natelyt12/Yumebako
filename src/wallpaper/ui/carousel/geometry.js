/**
 * geometry.js
 * ---------------------------------------------------------------------------
 * Hình học của dải accordion: bề rộng từng slot, toạ độ, và phép nội suy giữa
 * hai layout nguyên trong lúc lướt.
 *
 * Chuyển từ `temp/carousel_layout/layout.js` (IIFE, gắn cứng 800/454 và đọc
 * `window.innerWidth`) sang ESM + tham số hóa: mọi kích thước đi qua
 * `createGeometry({...})`, tâm màn hình được truyền vào từng lời gọi.
 *
 * Mô hình: bề rộng chỉ phụ thuộc *khoảng cách nguyên* tới thẻ tâm
 * (`percentageCurve`), và các slot xếp khít nhau từ trong ra ngoài — nên tổng
 * bề rộng của dải do số thẻ quyết định, không cần đo DOM. Khi lướt, hai layout
 * nguyên được nội suy tuyến tính theo `t`, nhờ đó bề rộng và toạ độ biến thiên
 * liên tục dù công thức gốc là rời rạc.
 */

import { clamp } from "./easing.js";

/** Kích thước chuẩn của sketch: thẻ tâm 800px, ảnh trong 792×446 (16:9). */
export const DEFAULT_GEOMETRY = Object.freeze({
  baseWidth: 744,
  cardMargin: 2,
  containerHeight: 420,
  /** Bề rộng theo từng bước khoảng cách: tâm, ±1, ±2, ±3, rồi sàn. */
  percentageCurve: Object.freeze([1.0, 0.3, 0.2, 0.1, 0.05]),
  /** Bề rộng tối thiểu (px) cho các thẻ ở rất xa tâm. */
  minWidth: 35,
  /**
   * Độ mờ theo khoảng cách tới tâm: tâm 100%, rồi 90 / 70 / 50 / 30 / 10 (sàn)
   * ở các bậc ±1..±5. Giữa hai bậc thì nội suy tuyến tính, nên khi lướt độ mờ
   * biến thiên liên tục thay vì nhảy nấc.
   */
  opacityCurve: Object.freeze([1, 0.9, 0.7, 0.5, 0.3, 0.1]),
});


/**
 * Lớp class của thẻ trong DOM. Tách ra thành biến để khi ghép vào hệ wallpaper
 * chỉ cần trỏ lại một chỗ, không phải sửa công thức layout.
 */
export const DEFAULT_SELECTORS = Object.freeze({
  overlay: ".carousel-overlay",
  frame: ".card-frame",
  deletingClass: "deleting",
});

/**
 * Dựng bộ hàm layout với một cấu hình kích thước cụ thể.
 *
 * @param {Partial<typeof DEFAULT_GEOMETRY>} [overrides]
 * @param {Object} [options]
 * @param {Partial<typeof DEFAULT_SELECTORS>} [options.selectors]
 * @param {(cardEl: HTMLElement, offset: number, width: number, index: number) => void} [options.onCardInfo]
 *   Ghi đè hoàn toàn hàm cập nhật thông tin thẻ (mặc định: xem `defaultCardInfo`).
 */
export function createGeometry(overrides = {}, { selectors, onCardInfo } = {}) {
  const config = { ...DEFAULT_GEOMETRY, ...overrides };
  const curve = config.percentageCurve;
  const selectors_ = { ...DEFAULT_SELECTORS, ...selectors };

  const innerWidth = config.baseWidth - config.cardMargin * 2;
  const innerHeight = config.containerHeight - config.cardMargin * 2;
  /** Bề rộng của slot cách tâm `k` bậc (k là số nguyên ≥ 0). */
  const widthForOffset = (k) =>
    k < curve.length
      ? Math.round(config.baseWidth * curve[k])
      : config.minWidth;

  /** Độ mờ của thẻ cách tâm `offset` bậc (nội suy tuyến tính trong `opacityCurve`). */
  const opacityForOffset = (offset) => {
    const opacityCurve = config.opacityCurve;
    const last = opacityCurve.length - 1;
    if (offset <= 0) return opacityCurve[0];
    if (offset >= last) return opacityCurve[last];

    const step = Math.floor(offset);
    const t = offset - step;
    return opacityCurve[step] + (opacityCurve[step + 1] - opacityCurve[step]) * t;
  };

  /**
   * Helper to cache child DOM elements directly on the card element,
   * avoiding expensive querySelector traversals on every animation frame.
   *
   * @param {HTMLElement} cardEl
   */
  const getCardElements = (cardEl) => {
    let cached = cardEl._cachedNodes;
    if (!cached) {
      cached = {
        overlay: cardEl.querySelector(selectors_.overlay),
        frame: cardEl.querySelector(selectors_.frame),
        bg: cardEl.querySelector(".card-bg"),
      };
      cardEl._cachedNodes = cached;
    } else if (!cached.bg) {
      cached.bg = cardEl.querySelector(".card-bg");
    }
    return cached;
  };

  /**
   * Default card info and opacity update callback running in the layout loop.
   *
   * @param {HTMLElement} cardEl
   * @param {number} offset - Distance (float) from the card to the continuous center.
   * @param {number} width - Slot width in px.
   * @param {number} _index - Card index in the strip.
   * @param {number} left - Slot's x position in track coordinates.
   * @param {number} screenCenter - Half the stage width; the stage spans `[0, 2 * screenCenter]`.
   */
  const defaultCardInfo = (
    cardEl,
    offset,
    width,
    _index,
    left,
    screenCenter,
  ) => {
    const nodes = getCardElements(cardEl);

    // Chỉ giữ ảnh của thẻ đang giao với viewport. Xét toạ độ thật của slot chứ
    // không xét offset, nên ảnh ngoài tâm vẫn hiện đủ tới khi trượt hẳn ra khỏi
    // màn hình; hàm chạy mỗi frame nên resize hay kéo đều nạp lại đúng lúc.
    if (nodes.bg) {
      const viewportRight = Number.isFinite(screenCenter)
        ? screenCenter * 2
        : Infinity;
      const shouldLoad = left + width > 0 && left < viewportRight;

      // Bật/tắt layer GPU theo đúng vùng nhìn thấy (xem `will-change` trong
      // carousel.css). Chỉ ghi class khi trạng thái đổi để không đụng DOM mỗi frame.
      if (cardEl._onScreen !== shouldLoad) {
        cardEl._onScreen = shouldLoad;
        cardEl.classList.toggle("is-onscreen", shouldLoad);
      }

      if (shouldLoad && !cardEl._isImageLoaded) {
        cardEl._isImageLoaded = true;
        const url = cardEl._bgUrl || cardEl.dataset.bgUrl;
        if (url) {
          nodes.bg.style.backgroundImage = `url(\x27${url}\x27)`;
          if (!cardEl._probed && cardEl._engine?.onThumbError) {
            cardEl._probed = true;
            cardEl._engine._probeThumbnail(cardEl._item, cardEl, cardEl._index);
          }
        }
      } else if (!shouldLoad && cardEl._isImageLoaded) {
        cardEl._isImageLoaded = false;
        nodes.bg.style.backgroundImage = "none";
      }
    }

    // Độ mờ giảm dần từ thẻ đang chọn ra hai bên (xem `opacityCurve`). Ghi lên
    // `.card-frame` để chỉ tấm ảnh mờ đi, còn nền accent của slot vẫn giữ nguyên.
    //
    // Thẻ đang bị xóa thì bỏ qua: độ mờ của nó thuộc hiệu ứng rơi (physics.js ghi
    // thẳng vào style, kết thúc ở 0), mà pha thu cột vẫn gọi callback này cho nó
    // với width 0 — ghi đè ở đây sẽ làm nó hiện nguyên hình giữa lúc cột khép lại.
    if (nodes.frame && !cardEl.classList.contains(selectors_.deletingClass)) {
      const opacity = opacityForOffset(offset).toFixed(3);
      if (nodes.frame.style.opacity !== opacity) {
        nodes.frame.style.opacity = opacity;
      }
    }

    // Overlay is only visible near center: linear 1 -> 0 within 1 step
    if (nodes.overlay) {
      const overlayOpacity = Math.max(0, 1 - offset).toFixed(3);
      if (nodes.overlay.style.opacity !== overlayOpacity) {
        nodes.overlay.style.opacity = overlayOpacity;
      }
    }
  };

  let cardInfoListener = onCardInfo || defaultCardInfo;

  /**
   * Theoretical layout for `count` cards with `centerIndex` centered on screen.
   * @returns {{ widths: number[], lefts: number[], count: number, centerIndex: number }}
   */
  const computeLayout = (centerIndex, count, screenCenter) => {
    const widths = new Array(count);
    const lefts = new Array(count);
    if (count === 0) return { widths, lefts, count, centerIndex: 0 };

    const center = clamp(centerIndex, 0, count - 1);
    for (let i = 0; i < count; i += 1) {
      widths[i] = widthForOffset(Math.abs(i - center));
    }

    // Build from center outwards
    lefts[center] = screenCenter - widths[center] / 2;
    for (let i = center + 1; i < count; i += 1) {
      lefts[i] = lefts[i - 1] + widths[i - 1];
    }
    for (let i = center - 1; i >= 0; i -= 1) {
      lefts[i] = lefts[i + 1] - widths[i];
    }

    return { widths, lefts, count, centerIndex: center };
  };

  /**
   * Compute interpolated layout mathematically at continuous index without touching DOM styles.
   */
  const computeInterpolatedLayout = (continuousIndex, count, screenCenter) => {
    const fromIdx = Math.max(0, Math.min(Math.floor(continuousIndex), count - 1));
    const toIdx = Math.max(0, Math.min(Math.ceil(continuousIndex), count - 1));
    const t = continuousIndex - fromIdx;

    if (fromIdx === toIdx || t <= 0) {
      return computeLayout(fromIdx, count, screenCenter);
    }

    const layoutA = computeLayout(fromIdx, count, screenCenter);
    const layoutB = computeLayout(toIdx, count, screenCenter);
    const widths = new Array(count);
    const lefts = new Array(count);

    for (let i = 0; i < count; i += 1) {
      widths[i] = (1 - t) * layoutA.widths[i] + t * layoutB.widths[i];
      lefts[i] = (1 - t) * layoutA.lefts[i] + t * layoutB.lefts[i];
    }

    return { widths, lefts, count, centerIndex: continuousIndex };
  };

  /**
   * Layout của dải tại vị trí ảo `continuousIndex`.
   *
   * Tính thuần trong JS từ `continuousIndex` — không đọc style trên DOM, nên
   * không cần parse chuỗi `translateX(...)` và không gây layout thrash.
   *
   * @param {HTMLElement[]} cards
   * @param {number} screenCenter
   * @param {number} continuousIndex - Vị trí ảo (có thể lẻ) của thẻ ở tâm.
   */
  const readLayout = (cards, screenCenter, continuousIndex) => {
    const count = cards.length;
    if (count === 0) return { widths: [], lefts: [], count: 0, centerIndex: 0 };

    const index = Number.isFinite(continuousIndex) ? continuousIndex : 0;
    return computeInterpolatedLayout(index, count, screenCenter);
  };

  /**
   * Interpolate between two layouts by `t` and write the result to DOM in a single pass.
   *
   * Trả về cả layout vừa ghi: bên gọi cần biết chính xác dải đang nằm ở đâu để
   * dùng làm điểm xuất phát cho cú lướt kế tiếp (xem `_currentLayout` bên engine).
   *
   * @returns {{ closestIndex: number, layout: { widths: number[], lefts: number[], count: number, centerIndex: number }|null }}
   */
  const applyLayout = (cards, layoutA, layoutB, t, screenCenter) => {
    const count = cards.length;
    if (count === 0) return { closestIndex: -1, layout: null };

    const centerA = Number.isFinite(layoutA?.centerIndex)
      ? layoutA.centerIndex
      : 0;
    const centerB = Number.isFinite(layoutB?.centerIndex)
      ? layoutB.centerIndex
      : centerA;
    const continuousCenter = (1 - t) * centerA + t * centerB;

    let closestIndex = -1;
    let minDistance = Infinity;

    // First pass: compute positions, widths, and find closestIndex
    const widths = new Array(count);
    const lefts = new Array(count);

    for (let i = 0; i < count; i += 1) {
      const width = (1 - t) * layoutA.widths[i] + t * layoutB.widths[i];
      const left = (1 - t) * layoutA.lefts[i] + t * layoutB.lefts[i];
      const safeWidth = Math.max(0, width);
      widths[i] = safeWidth;
      lefts[i] = left;

      cards[i].style.width = `${safeWidth}px`;
      cards[i].style.transform = `translateX(${left}px)`;

      const isDeleting = cards[i].classList.contains(selectors_.deletingClass);
      if (!isDeleting || t < 0.2) {
        const distance = Math.abs(left + safeWidth / 2 - screenCenter);
        if (distance < minDistance) {
          minDistance = distance;
          closestIndex = i;
        }
      }
    }

    // Apply active class and update card info
    for (let i = 0; i < count; i += 1) {
      cards[i].classList.toggle("active", i === closestIndex);
      cardInfoListener?.(
        cards[i],
        Math.abs(i - continuousCenter),
        widths[i],
        i,
        lefts[i],
        screenCenter,
      );
    }

    return {
      closestIndex,
      layout: { widths, lefts, count, centerIndex: continuousCenter },
    };
  };

  return {
    config,
    innerWidth,
    innerHeight,
    widthForOffset,
    computeLayout,
    computeInterpolatedLayout,
    readLayout,
    applyLayout,
    setCardInfoListener: (fn) => {
      cardInfoListener = typeof fn === "function" ? fn : defaultCardInfo;
    },
    getCardInfoListener: () => cardInfoListener,
  };
}
