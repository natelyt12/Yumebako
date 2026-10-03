/**
 * easing.js
 * ---------------------------------------------------------------------------
 * Đường cong chuyển động dùng chung cho carousel.
 *
 * Chuyển từ `temp/carousel_layout/easing.js` (IIFE gắn vào window) sang ESM.
 * Không phụ thuộc DOM — thuần toán học, nên test/bench được độc lập.
 *
 * Quy ước: mọi hàm nhận `t` trong [0, 1] và trả về tiến độ đã biến đổi.
 * Snap của carousel KHÔNG dùng file này: nó chạy bằng lò xo tới hạn trong
 * `CarouselEngine` (trạng thái là vị trí + vận tốc, không phải một `t` cho trước).
 * Ở đây còn lại các đường cong cho những đoạn có thời lượng cố định — pha thu cột
 * khi xoá (`easeOutExpo`) và pha rơi của hiệu ứng "bong đinh" (`easeInQuad` /
 * `easeInSine`, pha bật lên dùng `easeOutCubic`).
 */

/** Bung ra rất nhanh rồi hãm dài ở cuối — dùng cho pha thu cột khi xoá thẻ. */
export const easeOutExpo = (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));

/** Vào chậm, ra nhanh — dùng cho pha bật lên của "bong đinh". */
export const easeInCubic = (t) => t * t * t;

/** Hãm êm vừa phải, rẻ hơn expo — dùng cho pha bật lên của "bong đinh" và các đoạn phụ trợ. */
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
