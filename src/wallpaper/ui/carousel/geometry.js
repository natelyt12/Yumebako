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
  baseWidth: 800,
  cardMargin: 4,
  containerHeight: 454,
  /** Bề rộng theo từng bước khoảng cách: tâm, ±1, ±2, ±3, rồi sàn. */
  percentageCurve: Object.freeze([1.0, 0.3, 0.2, 0.1, 0.05]),
  /** Bề rộng tối thiểu (px) cho các thẻ ở rất xa tâm. */
  minWidth: 40,
});

/** Cấu hình độ mờ giảm dần theo khoảng cách tới tâm. */
export const OPACITY_CONFIG = Object.freeze({
  /** Mỗi đơn vị offset làm khung thẻ mờ đi bấy nhiêu. */
  cardFadeRate: 0.18,
  /** Sàn độ mờ của khung thẻ ở hai rìa. */
  minCardOpacity: 0.3,
});

/**
 * Lớp class của thẻ trong DOM. Tách ra thành biến để khi ghép vào hệ wallpaper
 * chỉ cần trỏ lại một chỗ, không phải sửa công thức layout.
 */
export const DEFAULT_SELECTORS = Object.freeze({
  overlay: ".carousel-overlay",
  frame: ".card-frame",
  plusIcon: ".card-plus-icon",
  spinner: ".card-loading-spinner",
  deletingClass: "deleting",
});

/**
 * Dựng bộ hàm layout với một cấu hình kích thước cụ thể.
 *
 * @param {Partial<typeof DEFAULT_GEOMETRY>} [overrides]
 * @param {Object} [options]
 * @param {Partial<typeof DEFAULT_SELECTORS>} [options.selectors]
 * @param {(cardEl: HTMLElement, offset: number, width: number, index: number) => void} [options.onCardInfo]
 *   Ghi đè hoàn toàn hàm cập nhật thông tin thẻ (mặc định: xem `_defaultCardInfo`).
 */
export function createGeometry(overrides = {}, { selectors, onCardInfo } = {}) {
  const config = { ...DEFAULT_GEOMETRY, ...overrides };
  const curve = config.percentageCurve;
  const selectors_ = { ...DEFAULT_SELECTORS, ...selectors };

  const innerWidth = config.baseWidth - config.cardMargin * 2;
  const innerHeight = config.containerHeight - config.cardMargin * 2;
  /** Offset mà từ đó mọi thẻ đều đã nằm ở bề rộng sàn. */
  const curveHorizon = Math.max(0, curve.length - 1);

  /** Bề rộng của slot cách tâm `k` bậc (k là số nguyên ≥ 0). */
  const widthForOffset = (k) =>
    k < curve.length
      ? Math.round(config.baseWidth * curve[k])
      : config.minWidth;

  /**
   * Hàm mặc định cập nhật thông tin thẻ — chạy trong vòng lặp layout, nên phải
   * rẻ: chỉ ghi style, không đo DOM.
   *
   * @param {HTMLElement} cardEl
   * @param {number} offset - Khoảng cách (số thực) từ thẻ tới tâm dải.
   */
  const defaultCardInfo = (cardEl, offset) => {
    // Khối thông tin chỉ hiện ở thẻ tâm: tuyến tính 1 → 0 trong một bước.
    const overlay = cardEl.querySelector(selectors_.overlay);
    if (overlay) overlay.style.opacity = Math.max(0, 1 - offset).toFixed(3);

    // Mờ dần khung thẻ theo khoảng cách để tạo chiều sâu. Thẻ đang bị xóa được
    // bỏ qua: độ mờ của nó do hiệu ứng rơi điều khiển.
    if (!cardEl.classList.contains(selectors_.deletingClass)) {
      const frame = cardEl.querySelector(selectors_.frame);
      if (frame) {
        const opacity = Math.max(
          OPACITY_CONFIG.minCardOpacity,
          1 - offset * OPACITY_CONFIG.cardFadeRate,
        );
        frame.style.opacity = opacity.toFixed(3);
      }
    }

    // Icon "+" và vòng xoay tắt dần sớm hơn khung, tránh thấy dấu cộng méo ở rìa.
    const actionOpacity = clamp(1 - offset / curveHorizon, 0, 1).toFixed(3);
    for (const selector of [selectors_.plusIcon, selectors_.spinner]) {
      const el = cardEl.querySelector(selector);
      if (el) el.style.opacity = actionOpacity;
    }
  };

  let cardInfoListener = onCardInfo || defaultCardInfo;

  /**
   * Layout lý thuyết cho `count` thẻ khi thẻ `centerIndex` nằm ở tâm màn hình.
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

    // Dựng từ tâm ra hai phía, mỗi slot đặt sát slot trước đó.
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
   * Đọc layout đang thực sự nằm trên DOM — dùng làm điểm xuất phát cho một cú
   * lướt mới (carousel có thể bị ngắt giữa chừng nên không thể giả định nó đang
   * ở đúng một layout nguyên).
   *
   * @param {HTMLElement[]} cards
   * @param {number} screenCenter
   */
  const readLayout = (cards, screenCenter) => {
    const count = cards.length;
    const widths = new Array(count);
    const lefts = new Array(count);
    let centerIndex = 0;
    let minDistance = Infinity;

    for (let i = 0; i < count; i += 1) {
      const el = cards[i];
      widths[i] = Number.parseFloat(el.style.width) || config.baseWidth;

      const match = /translateX\((-?[\d.]+)px\)/.exec(el.style.transform || "");
      lefts[i] = match ? Number.parseFloat(match[1]) : 0;

      const distance = Math.abs(lefts[i] + widths[i] / 2 - screenCenter);
      if (distance < minDistance) {
        minDistance = distance;
        centerIndex = i;
      }
    }

    return { widths, lefts, count, centerIndex };
  };

  /**
   * Nội suy hai layout theo `t` rồi ghi kết quả ra DOM.
   *
   * Trả về index của thẻ đang gần tâm nhất — đây chính là "soft index" mà tầng
   * trên dùng để cập nhật preview trong lúc lướt.
   *
   * @returns {number} Chỉ số thẻ gần tâm, hoặc -1 khi danh sách rỗng.
   */
  const applyLayout = (cards, layoutA, layoutB, t, screenCenter) => {
    const count = cards.length;
    if (count === 0) return -1;

    // Tâm ảo di động: nội suy giữa tâm của hai layout, nhờ đó offset của từng
    // thẻ là một số thực và độ mờ biến thiên liên tục thay vì nhảy bậc.
    const centerA = Number.isFinite(layoutA?.centerIndex)
      ? layoutA.centerIndex
      : 0;
    const centerB = Number.isFinite(layoutB?.centerIndex)
      ? layoutB.centerIndex
      : centerA;
    const continuousCenter = (1 - t) * centerA + t * centerB;

    let closestIndex = -1;
    let minDistance = Infinity;

    for (let i = 0; i < count; i += 1) {
      const width = (1 - t) * layoutA.widths[i] + t * layoutB.widths[i];
      const left = (1 - t) * layoutA.lefts[i] + t * layoutB.lefts[i];
      const safeWidth = Math.max(0, width);

      cards[i].style.width = `${safeWidth}px`;
      cards[i].style.transform = `translateX(${left}px)`;

      // Thẻ đang rơi (đang bị xóa) không được tranh vị trí "gần tâm" sau khi đã
      // đi được một quãng — nếu không, highlight sẽ dính vào tấm ảnh đang rơi.
      const isDeleting = cards[i].classList.contains(selectors_.deletingClass);
      if (!isDeleting || t < 0.2) {
        const distance = Math.abs(left + safeWidth / 2 - screenCenter);
        if (distance < minDistance) {
          minDistance = distance;
          closestIndex = i;
        }
      }
    }

    for (let i = 0; i < count; i += 1) {
      const width = (1 - t) * layoutA.widths[i] + t * layoutB.widths[i];
      const left = (1 - t) * layoutA.lefts[i] + t * layoutB.lefts[i];

      cards[i].classList.toggle("active", i === closestIndex);
      cardInfoListener?.(cards[i], Math.abs(i - continuousCenter), width, i);
    }

    return closestIndex;
  };

  return {
    config,
    innerWidth,
    innerHeight,
    widthForOffset,
    computeLayout,
    readLayout,
    applyLayout,
    /** Ghi đè hàm cập nhật thông tin thẻ (nhận `null` để quay về mặc định). */
    setCardInfoListener: (fn) => {
      cardInfoListener = typeof fn === "function" ? fn : defaultCardInfo;
    },
    getCardInfoListener: () => cardInfoListener,
  };
}
