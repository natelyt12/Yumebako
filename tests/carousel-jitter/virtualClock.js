/**
 * virtualClock.js
 * ---------------------------------------------------------------------------
 * Đồng hồ ảo để chạy CarouselEngine mà không cần thời gian thật.
 *
 * Engine lấy thời gian từ hai nguồn: tham số `now` của `requestAnimationFrame` và
 * `performance.now()` (hiệu ứng rơi trong `physics.js` tự bấm giờ riêng). Cả hai
 * phải là cùng một đồng hồ, nếu không `elapsed` sẽ âm và vòng animation không bao
 * giờ kết thúc. Vì vậy hàm này thay cả rAF, `setTimeout` lẫn `performance.now`.
 *
 * Dùng cho test trong Node (jsdom). Trang harness trong browser KHÔNG dùng file
 * này: ở đó ta muốn đo thời gian thật để bắt cả jank do paint.
 *
 * Dùng cho test trong Node (jsdom). Trang harness trong browser KHÔNG dùng file
 * này: ở đó ta muốn đo thời gian thật để bắt cả jank do paint.
 */

/** Bước thời gian mặc định: 60fps. */
export const FRAME_MS = 1000 / 60;

/**
 * @param {Object} [options]
 * @param {number} [options.stepMs=FRAME_MS] - Thời gian trôi qua mỗi lần `advance()`.
 */
export function createVirtualClock({ stepMs = FRAME_MS } = {}) {
  let nowMs = 0;
  let nextId = 0;
  /** @type {Map<number, (now: number) => void>} */
  const rafs = new Map();
  /** @type {Map<number, { cb: Function, at: number }>} */
  const timers = new Map();

  let host = null;
  let saved = null;

  const runDueTimers = () => {
    for (const [id, timer] of [...timers]) {
      if (timer.at > nowMs) continue;
      timers.delete(id);
      timer.cb();
    }
  };

  const runFrame = () => {
    runDueTimers();
    // Chụp danh sách trước khi chạy: callback có thể đăng ký frame kế tiếp, và
    // frame đó phải thuộc lần `advance()` sau, không phải lần này.
    const due = [...rafs.entries()];
    rafs.clear();
    for (const [, cb] of due) cb(nowMs);
  };

  const clock = {
    get now() {
      return nowMs;
    },
    get stepMs() {
      return stepMs;
    },
    get pendingFrames() {
      return rafs.size;
    },

    /** Thay rAF, setTimeout và performance.now của `target` bằng bản ảo. */
    install(target = globalThis) {
      if (host) return clock;
      host = target;
      const perf = target.performance;
      saved = {
        raf: target.requestAnimationFrame,
        caf: target.cancelAnimationFrame,
        setTimeout: target.setTimeout,
        clearTimeout: target.clearTimeout,
        performance: perf,
        performanceHadOwnNow: Boolean(perf && Object.prototype.hasOwnProperty.call(perf, "now")),
        performanceOwnNow: perf?.now,
      };

      target.requestAnimationFrame = (cb) => {
        rafs.set(++nextId, cb);
        return nextId;
      };
      target.cancelAnimationFrame = (id) => {
        rafs.delete(id);
      };
      if (perf) perf.now = () => nowMs;
      target.setTimeout = (cb, ms = 0) => {
        const delay = Number(ms);
        const id = ++nextId;
        timers.set(id, { cb, at: nowMs + (Number.isFinite(delay) ? delay : 0) });
        return id;
      };
      target.clearTimeout = (id) => {
        timers.delete(id);
      };
      return clock;
    },

    /** Trả mọi thứ về như trước khi `install()`. */
    restore() {
      if (!host) return;
      if (saved.raf) host.requestAnimationFrame = saved.raf;
      if (saved.caf) host.cancelAnimationFrame = saved.caf;
      if (saved.setTimeout) host.setTimeout = saved.setTimeout;
      if (saved.clearTimeout) host.clearTimeout = saved.clearTimeout;
      if (saved.performance) {
        if (saved.performanceHadOwnNow) saved.performance.now = saved.performanceOwnNow;
        else delete saved.performance.now;
      }
      host = null;
      saved = null;
    },

    /** Tua thêm `ms` (mặc định 1 frame) rồi chạy các callback đến hạn. */
    advance(ms = stepMs) {
      nowMs += ms;
      runFrame();
    },

    /** Tua `frames` frame liên tiếp. */
    advanceFrames(frames, ms = stepMs) {
      for (let i = 0; i < frames; i += 1) clock.advance(ms);
    },
  };

  return clock;
}
