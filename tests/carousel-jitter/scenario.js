/**
 * scenario.js
 * ---------------------------------------------------------------------------
 * Dựng một carousel thật (CarouselEngine + DOM) và lái nó bằng chuỗi sự kiện bánh
 * xe, để bộ đo trong `probe.js` có cái mà đo.
 *
 * File này không biết gì về Node hay browser: nó nhận `document` từ bên gọi và
 * nhận một hàm `advanceFrame()` để tiến thời gian. Test trong Node truyền đồng hồ
 * ảo, trang harness trong browser truyền `requestAnimationFrame` thật — nhờ vậy
 * cùng một kịch bản chạy được ở cả hai nơi.
 */

import {
  CarouselEngine,
  WHEEL_THRESHOLD,
} from "../../src/wallpaper/ui/carousel/CarouselEngine.js";

export const SCENARIO_DEFAULTS = Object.freeze({
  count: 12,
  containerWidth: 1600,
  duration: 600,
  /**
   * Một nấc bánh xe phải đủ lớn để engine tiêu thụ ngay, không bị cộng dồn: lấy
   * đúng bằng ngưỡng gom delta của engine, nên chỉnh ngưỡng theo cảm giác tay thì
   * kịch bản vẫn bắn đúng một bậc mỗi nấc.
   */
  notchDeltaY: WHEEL_THRESHOLD,
  /** Số frame giữa hai nấc bánh xe — nhỏ = vuốt nhanh, snap bị retarget liên tục. */
  notchEveryFrames: 4,
});

/** Item tối thiểu mà CarouselEngine cần: có id + url. */
export function makeItems(count) {
  return Array.from({ length: count }, (_, i) => ({
    id: `card-${i}`,
    name: `Card ${i}`,
    sub: "scenario",
    url: "",
    metaLeft: `<span>Card ${i}</span>`,
    metaRight: "",
  }));
}

/**
 * @param {Object} options
 * @param {Document} options.document
 * @param {HTMLElement} [options.mount] - Nơi gắn sân khấu; mặc định `document.body`.
 * @param {number} [options.count]
 * @param {number} [options.containerWidth] - Chỉ dùng khi môi trường không có
 *   layout (jsdom trả `clientWidth = 0`); browser thật thì đo được nên bỏ qua.
 * @param {number} [options.duration] - Thời gian một cú snap (ms).
 */
export function createCarouselScenario({
  document: doc,
  mount,
  count = SCENARIO_DEFAULTS.count,
  containerWidth = SCENARIO_DEFAULTS.containerWidth,
  duration = SCENARIO_DEFAULTS.duration,
} = {}) {
  const root = doc.createElement("div");
  root.className = "wallpaper_switcher";
  const container = doc.createElement("div");
  container.className = "carousel-container";
  const track = doc.createElement("div");
  track.className = "carousel-track";
  container.appendChild(track);
  root.appendChild(container);
  (mount || doc.body).appendChild(root);

  // jsdom không có layout: `clientWidth` luôn 0 và engine sẽ rơi về
  // `window.innerWidth`. Ghim bề rộng sân khấu để tâm dải là con số biết trước.
  // Browser thật thì đo được, không đụng vào.
  if (!container.clientWidth) {
    Object.defineProperty(container, "clientWidth", {
      value: containerWidth,
      configurable: true,
    });
  }

  const engine = new CarouselEngine({ container, track, duration });
  engine.setItems(makeItems(count), 0);
  engine.setActive(true);

  return {
    engine,
    container,
    track,
    get cardCount() {
      return engine.count;
    },
    dispose() {
      engine.destroy();
      root.remove();
    },
  };
}

/** Bắn một nấc bánh xe vào sân khấu (engine nghe ở container). */
export function dispatchWheel(container, deltaY) {
  const win = container.ownerDocument.defaultView;
  const WheelEventCtor = win?.WheelEvent;
  let event;
  if (typeof WheelEventCtor === "function") {
    event = new WheelEventCtor("wheel", { deltaY, bubbles: true, cancelable: true });
  } else {
    event = new win.Event("wheel", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "deltaY", { value: deltaY });
  }
  container.dispatchEvent(event);
  return event;
}

/** Bắn một sự kiện chuột (kèm `clientX`) — engine nghe `mousedown` ở sân khấu, `mousemove`/`mouseup` ở window. */
export function dispatchMouse(target, type, clientX) {
  // `target` có thể là chính window (nó không có `ownerDocument`) — và sự kiện phải
  // do window đó tạo, không phải `globalThis`, nếu không `dispatchEvent` từ chối.
  const win = target.ownerDocument?.defaultView ?? target;
  const MouseEventCtor = win?.MouseEvent;
  let event;
  if (typeof MouseEventCtor === "function") {
    event = new MouseEventCtor(type, {
      clientX, button: 0, bubbles: true, cancelable: true,
    });
  } else {
    event = new win.Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clientX", { value: clientX });
    Object.defineProperty(event, "button", { value: 0 });
  }
  target.dispatchEvent(event);
  return event;
}

/**
 * Kéo ngang rồi nhả, chia thành nhiều mẫu `mousemove` và tiến frame giữa các mẫu.
 *
 * Engine đo vận tốc kéo từ hai mẫu cuối (xem `_releaseVelocity`), nên một cú kéo chỉ
 * có một mẫu sẽ bị coi là không có đà; muốn thử đà thì phải kéo thành chuỗi như tay
 * người thật.
 *
 * @param {Object} options
 * @param {HTMLElement} options.container
 * @param {() => (void | Promise<void>)} options.advanceFrame - Tiến một frame giữa hai mẫu.
 * @param {number} options.totalX - Tổng quãng kéo (px, âm = kéo sang trái).
 * @param {number} [options.samples] - Số mẫu `mousemove`.
 * @param {number} [options.startX] - Toạ độ ngang lúc nhấn xuống.
 * @param {boolean} [options.release] - Có nhả chuột ở cuối cú kéo hay không.
 * @param {number} [options.idleFrames] - Số frame tay đứng yên trước khi nhả.
 */
export async function dragAndRelease({
  container,
  advanceFrame,
  totalX,
  samples = 6,
  startX = 800,
  release = true,
  idleFrames = 0,
}) {
  const win = container.ownerDocument.defaultView;
  dispatchMouse(container, "mousedown", startX);
  for (let i = 1; i <= samples; i += 1) {
    await advanceFrame();
    dispatchMouse(win, "mousemove", startX + (totalX * i) / samples);
  }
  // Dừng tay rồi mới buông: dải cũng đứng yên suốt quãng đó, nên lò xo không được
  // tính quãng ấy vào đồng hồ của nó (xem `_endDrag`).
  for (let i = 0; i < idleFrames; i += 1) await advanceFrame();
  if (release) dispatchMouse(win, "mouseup", startX + totalX);
}

/**
 * Vuốt bánh xe liên tục từ thẻ đầu tới thẻ cuối, đúng kiểu "lăn một mạch".
 *
 * Mỗi nấc được bắn sau `notchEveryFrames` frame, nhanh hơn thời gian một cú snap —
 * nên cú đang chạy liên tục bị retarget giữa chừng. Đây chính là tình huống dễ lộ
 * jitter nhất.
 *
 * @param {Object} options
 * @param {import("../../src/wallpaper/ui/carousel/CarouselEngine.js").CarouselEngine} options.engine
 * @param {HTMLElement} options.container
 * @param {() => (void | Promise<void>)} options.advanceFrame - Tiến một frame.
 * @param {number} [options.notchEveryFrames]
 * @param {number} [options.notchDeltaY]
 * @param {number} [options.settleFrames] - Trần số frame chờ cú snap cuối dừng hẳn.
 */
export async function sweepToLastCard({
  engine,
  container,
  advanceFrame,
  notchEveryFrames = SCENARIO_DEFAULTS.notchEveryFrames,
  notchDeltaY = SCENARIO_DEFAULTS.notchDeltaY,
  settleFrames = 240,
}) {
  const steps = Math.max(0, engine.count - 1);
  const notches = [];

  for (let step = 0; step < steps; step += 1) {
    for (let frame = 0; frame < notchEveryFrames; frame += 1) await advanceFrame();
    const event = dispatchWheel(container, notchDeltaY);
    notches.push({ step, prevented: event.defaultPrevented });
  }

  let guard = 0;
  while (!engine.settled && guard < settleFrames) {
    await advanceFrame();
    guard += 1;
  }
  // Vài frame thừa để chắc chắn trạng thái đã đứng yên hẳn.
  for (let frame = 0; frame < 3; frame += 1) await advanceFrame();

  return { steps, notches, settleFramesUsed: guard };
}
