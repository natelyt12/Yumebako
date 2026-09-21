/**
 * physics.js
 * ---------------------------------------------------------------------------
 * Hai mô phỏng vật lý thuần túy của carousel:
 *
 *  1. Kéo thả (drag / touch) — đổi px dịch chuột thành chỉ số ảo liên tục,
 *     kèm lực cản lò xo ở hai mép và cú hất quán tính (flick) khi nhả tay.
 *     Phần này chuyển từ khối "DRAG & CLICK INTERACTION ENGINE" trong
 *     `temp/carousel_layout/carousel.js`.
 *
 *  2. "Bong đinh" khi xóa thẻ — thẻ bật lên rồi rơi tự do khỏi khung, chuyển
 *     từ `temp/carousel_layout/physics.js`.
 *
 * Không nhánh nào chạm vào DOM ngoài `animateUnpinDrop`, và cả file không đọc
 * `window` — nên có thể dùng lại cho bất kỳ danh sách nào cùng dạng.
 */

import {
  EASING_FNS,
  easeInQuad,
  easeInSine,
  easeOutCubic,
  clamp,
} from "./easing.js";

/** Quãng kéo (px) tương ứng với đúng một thẻ. */
export const DRAG_STEP = 300;
/** Trên ngưỡng này (px/ms) cú nhả tay được coi là "flick" và đi thêm một thẻ. */
export const FLICK_VELOCITY = 4;
/** Flick chỉ tính khi quãng kéo đủ xa, để cú click rung tay không nhảy thẻ. */
export const FLICK_MIN_DISTANCE = 25;
/** Hệ số nén khi kéo vượt mép (rubber-banding). */
export const EDGE_RESISTANCE = 0.25;
/** Dưới ngưỡng này (px) coi như người dùng chỉ click, không kéo. */
export const DRAG_DEAD_ZONE = 4;

/**
 * Đổi một cú kéo thành chỉ số ảo liên tục.
 *
 * Kéo sang trái (deltaX < 0) làm chỉ số tăng — đúng cảm giác "đẩy hàng sang trái
 * để xem thẻ bên phải". Vượt quá hai mép thì bị nén lại theo `EDGE_RESISTANCE`,
 * nên vẫn thấy phản hồi khi kéo quá đầu/cuối nhưng không tuột khỏi danh sách.
 *
 * @param {number} startIndex - Chỉ số ảo tại lúc bắt đầu kéo.
 * @param {number} deltaX - Quãng dịch ngang tích lũy kể từ lúc bắt đầu (px).
 * @param {number} count - Tổng số thẻ trong danh sách.
 * @returns {number} Chỉ số ảo (có thể lẻ, có thể nằm ngoài [0, count - 1] một chút).
 */
export function dragToVirtualIndex(startIndex, deltaX, count) {
  if (count <= 0) return 0;

  const last = count - 1;
  const raw = startIndex - deltaX / DRAG_STEP;
  if (raw < 0) return raw * EDGE_RESISTANCE;
  if (raw > last) return last + (raw - last) * EDGE_RESISTANCE;
  return raw;
}

/**
 * Chỉ số mà carousel sẽ chốt sau khi người dùng nhả tay.
 *
 * `virtualIndex` đã bao gồm quán tính kéo; cú flick chỉ cộng thêm một thẻ khi
 * vận tốc và quãng đường đều vượt ngưỡng, nhờ vậy một cú click (quãng ~0) không
 * bao giờ bị hiểu thành lướt.
 *
 * @param {Object} input
 * @param {number} input.virtualIndex - Chỉ số ảo tại thời điểm nhả.
 * @param {number} input.deltaX - Quãng kéo tích lũy (px).
 * @param {number} input.durationMs - Thời gian giữ chuột (ms).
 * @param {number} input.count - Tổng số thẻ.
 * @returns {number} Chỉ số đã kẹp trong [0, count - 1].
 */
export function resolveDragTarget({ virtualIndex, deltaX, durationMs, count }) {
  if (count <= 0) return 0;

  const last = count - 1;
  let target = Math.round(clamp(virtualIndex, 0, last));

  const velocity = deltaX / Math.max(1, durationMs);
  const flicked =
    Math.abs(velocity) > FLICK_VELOCITY &&
    Math.abs(deltaX) > FLICK_MIN_DISTANCE;

  if (flicked) target += deltaX < 0 ? 1 : -1;

  return clamp(target, 0, last);
}

/** `true` khi quãng kéo đủ lớn để không còn được coi là một cú click. */
export const isDragMoved = (deltaX) => Math.abs(deltaX) > DRAG_DEAD_ZONE;

/**
 * Tách chỉ số ảo thành cặp layout kề nhau + tiến độ nội suy giữa chúng.
 * Dùng cho đường kéo: mỗi frame nội suy giữa hai layout nguyên để bề rộng và
 * toạ độ biến thiên liên tục (xem `geometry.applyLayout`).
 *
 * @param {number} virtualIndex - Chỉ số ảo (đã kẹp hoặc chưa).
 * @param {number} count
 * @returns {{ from: number, to: number, progress: number }}
 */
export function splitVirtualIndex(virtualIndex, count) {
  if (count <= 0) return { from: 0, to: 0, progress: 0 };

  const last = count - 1;
  const clamped = clamp(virtualIndex, 0, last);
  const from = Math.floor(clamped);
  const to = Math.min(last, from + 1);
  return { from, to, progress: clamped - from };
}

/* ── Hiệu ứng xóa: bung đinh rồi rơi tự do ──────────────────────────────── */

/** Thông số quỹ đạo rơi, đã tinh chỉnh bằng mắt — đổi ở đây là đổi cả hiệu ứng. */
export const GRAVITY_CONFIG = Object.freeze({
  popHeight: 20, // Chiều cao hất nảy lên khi bung đinh (px)
  popDuration: 100, // Thời gian nảy lên đến đỉnh Y (ms)
  fallDistance: 300, // Quãng đường rơi tự do xuống dưới (px)
  fallDuration: 340, // Thời gian rơi tự do (ms)
  fallEasing: "quad", // "quad" (t², rơi tự do) hoặc "sine"
  fadeStartRatio: 0.65, // Bắt đầu mờ dần sau khi rơi được 65% quãng đường
  scalePop: 1.05, // Độ phóng to cực đại
  scalePopDuration: 300, // Thời gian đạt đỉnh scale (ms)
});

/**
 * Cho khung ảnh "bong đinh": bật lên, xoay nhẹ rồi rơi khỏi khung.
 *
 * `onComplete` được gọi đúng một lần khi chạm đáy, để bên gọi chạy tiếp pha thu
 * gọn cột. Thẻ bị xóa chuyển sang Mode 2 (không bị bề rộng slot co kéo) trước
 * khi gọi hàm này, nên transform ở đây hoàn toàn thuộc về hiệu ứng.
 *
 * @param {HTMLElement} frame - Phần tử khung ảnh cần mô phỏng rơi.
 * @param {() => void} [onComplete] - Gọi khi rơi xong.
 * @param {Partial<typeof GRAVITY_CONFIG>} [customConfig] - Ghi đè thông số.
 * @returns {() => void} Hàm hủy, dừng vòng lặp nếu thẻ bị gỡ giữa chừng.
 */
export function animateUnpinDrop(frame, onComplete, customConfig = {}) {
  if (!frame) {
    onComplete?.();
    return () => { };
  }

  const config = { ...GRAVITY_CONFIG, ...customConfig };
  const startTime = performance.now();
  const totalDuration = config.popDuration + config.fallDuration;
  const apexTime = config.popDuration;

  // Góc xoay ngẫu nhiên -10°..10°, né khoảng [-1°, 1°] để cú rơi không trông
  // như bị lỗi căn chỉnh.
  const sign = Math.random() < 0.5 ? -1 : 1;
  const targetRotation = sign * (1 + Math.random() * 9);
  const fallEase = config.fallEasing === "sine" ? easeInSine : easeInQuad;

  frame.style.transformOrigin = "center center";

  let rafId = null;
  let cancelled = false;

  const tick = (now) => {
    if (cancelled) return;

    const elapsed = now - startTime;
    const progress = Math.min(elapsed / totalDuration, 1);

    let y;
    let scale;
    let rot = 0;
    let opacity = 1;

    if (elapsed <= apexTime) {
      // Pha 1 — bật lên tới đỉnh, chưa xoay, còn nguyên độ đậm.
      y = -config.popHeight * easeOutCubic(elapsed / apexTime);
    } else {
      // Pha 2 — rơi tự do: đi hết quãng còn lại theo t², bắt đầu xoay và mờ dần.
      const v = (elapsed - apexTime) / config.fallDuration;
      const eased = fallEase(v);
      y = -config.popHeight + (config.fallDistance + config.popHeight) * eased;
      rot = targetRotation * eased;
      opacity =
        v < config.fadeStartRatio
          ? 1
          : Math.max(
            0,
            1 - (v - config.fadeStartRatio) / (1 - config.fadeStartRatio),
          );
    }

    scale =
      elapsed <= config.scalePopDuration
        ? 1 +
        (config.scalePop - 1) *
        easeOutCubic(elapsed / config.scalePopDuration)
        : config.scalePop;

    frame.style.transform = `translate(-50%, ${y}px) rotate(${rot}deg) scale(${scale})`;
    frame.style.opacity = opacity;

    if (progress < 1) {
      rafId = requestAnimationFrame(tick);
    } else {
      rafId = null;
      onComplete?.();
    }
  };

  rafId = requestAnimationFrame(tick);

  return () => {
    cancelled = true;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
  };
}

/** Bảng tra easing của hiệu ứng xóa, giữ tương thích với cấu hình cũ. */
export const PHYSICS_EASING = EASING_FNS;
