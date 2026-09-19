/**
 * easing.js
 * ---------------------------------------------------------------------------
 * Đường cong chuyển động dùng chung cho carousel.
 *
 * Chuyển từ `temp/carousel_layout/easing.js` (IIFE gắn vào window) sang ESM.
 * Không phụ thuộc DOM — thuần toán học, nên test/bench được độc lập.
 *
 * Quy ước: mọi hàm nhận `t` trong [0, 1] và trả về tiến độ đã biến đổi.
 * `easeOutExpo` là đường cong snap chính của carousel; `easeInQuad` /
 * `easeInSine` dùng cho pha rơi của hiệu ứng "bong đinh" khi xóa thẻ.
 */

/** Snap chính: lao nhanh rồi hãm êm ở cuối (mặc định cho mọi cú cuộn). */
export const easeOutExpo = (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));

/** Vào chậm, ra nhanh — dùng cho pha bật lên của "bong đinh". */
export const easeInCubic = (t) => t * t * t;

/** Hãm êm vừa phải, rẻ hơn expo — dùng cho các đoạn phụ trợ. */
export const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);

/** Gia tốc rơi tự do (t²) — quỹ đạo Y của thẻ bị xóa. */
export const easeInQuad = (t) => t * t;

/** Gia tốc nhẹ hơn, dùng khi muốn cú rơi bớt dứt khoát. */
export const easeInSine = (t) => 1 - Math.cos((t * Math.PI) / 2);

/** Các đường cong tra theo tên, cho phần cấu hình của hiệu ứng xóa. */
export const EASING_FNS = Object.freeze({
  expo: easeOutExpo,
  outCubic: easeOutCubic,
  inCubic: easeInCubic,
  inQuad: easeInQuad,
  inSine: easeInSine,
});

/** Nội suy tuyến tính giữa `a` và `b` theo `t`. */
export const lerp = (a, b, t) => a + (b - a) * t;

/** Kẹp `value` vào khoảng [min, max]. */
export const clamp = (value, min, max) =>
  value < min ? min : value > max ? max : value;
