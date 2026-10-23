/**
 * jitter.test.js
 * ---------------------------------------------------------------------------
 * Test đo jitter của CarouselEngine khi vuốt bánh xe liên tục từ đầu tới cuối dải.
 *
 * Chạy: `npm test` (hoặc `npm run test:jitter`).
 *
 * Cách đo: `probe.js` chụp lại (width, translateX, opacity, active) của TỪNG thẻ
 * sau MỖI lần render, trong lúc `scenario.js` bắn từng nấc bánh xe và một đồng hồ
 * ảo tua frame với bước cố định. Nhờ đồng hồ ảo, kết quả lặp lại được y hệt nên
 * ngưỡng dưới đây là ngưỡng thật, không phải "chạy được là xong".
 *
 * Ngưỡng được chọn theo cơ học của animation, không phải theo số đo hiện tại:
 *   - Khi bị retarget giữa chừng, frame đầu của cú snap mới phải nối tiếp đúng
 *     layout đang nằm trên DOM ⇒ độ nhảy phải là 0 (chỉ còn sai số làm tròn).
 *   - Vận tốc là biến trạng thái của chuyển động, không phải thứ được gán lại mỗi
 *     lượt ⇒ một frame không được đổi vận tốc quá một nửa đỉnh của chính nó.
 *     Tween có thời lượng cố định vi phạm đúng bằng 1.0: dựng lại là reset vận tốc
 *     về 0, và frame đầu của tween lại nhảy lên độ dốc lớn nhất.
 *   - Độ mờ là hàm thuần của khoảng cách tới tâm ⇒ tốc độ đổi bị chặn bởi tốc độ
 *     đổi của `continuousIndex`.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

import { createProbe, formatReport } from "./probe.js";
import { createVirtualClock } from "./virtualClock.js";
import { MAX_FLICK_OVERSHOOT } from "../../src/wallpaper/ui/carousel/CarouselEngine.js";
import {
  SCENARIO_DEFAULTS,
  createCarouselScenario,
  dispatchWheel,
  dragAndRelease,
  sweepToLastCard,
} from "./scenario.js";

/** Sai số cho phép của một cú nhảy layout ở frame retarget (px). */
const RETARGET_JUMP_X_PX = 1;

/**
 * Một nấc bánh xe đủ lớn để engine tiêu thụ ngay thay vì cộng dồn — bám theo
 * ngưỡng thật của engine nên chỉnh ngưỡng theo cảm giác tay thì test vẫn đúng.
 */
const NOTCH_DELTA_Y = SCENARIO_DEFAULTS.notchDeltaY;

/**
 * Vận tốc là biến trạng thái, nên một frame không được đổi nó quá ngần này phần
 * của đỉnh: đó là khác biệt giữa "chạy nhanh" (bình thường) và "gãy khúc" (giật).
 *
 * Ngưỡng nằm giữa hai con số suy ra được từ cơ học, không phải đo rồi chọn:
 *   - Lò xo tới hạn khởi hành từ trạng thái nghỉ đổi vận tốc nhiều nhất ở frame
 *     đầu: `Δv = ω²·D·dt` so với đỉnh `v = 0.368·ω·D`, tức tỉ lệ `ω·dt/0.368` —
 *     với ω = 10/0.6 và 60fps là 0.76.
 *   - Tween có thời lượng cố định chạm đúng 1.0: dựng lại là gán vận tốc về 0, mà
 *     frame đầu của tween mới đã nhảy lên độ dốc lớn nhất (đo được: ΔvMax == vMax ở
 *     mọi nhịp lăn).
 * 0.9 nằm trên trần của lò xo và dưới mức của tween ở cả hai phía.
 */
const MAX_VELOCITY_JUMP_RATIO = 0.9;

const GLOBALS_TO_SWAP = [
  "window", "document", "HTMLElement", "Image", "getComputedStyle",
  "requestAnimationFrame", "cancelAnimationFrame",
];

function mountDom() {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", { pretendToBeVisual: true });
  const saved = new Map();
  const next = {
    window: dom.window,
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    Image: dom.window.Image,
    getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
    requestAnimationFrame: dom.window.requestAnimationFrame,
    cancelAnimationFrame: dom.window.cancelAnimationFrame,
  };
  for (const key of GLOBALS_TO_SWAP) {
    saved.set(key, { had: key in globalThis, value: globalThis[key] });
    globalThis[key] = next[key];
  }
  return {
    dom,
    restore() {
      for (const key of GLOBALS_TO_SWAP) {
        const { had, value } = saved.get(key);
        if (had) globalThis[key] = value;
        else delete globalThis[key];
      }
      dom.window.close();
    },
  };
}

/**
 * Dựng cảnh + đo, rồi luôn dọn dẹp dù test pass hay fail.
 *
 * @param {Object} options - `count`, `containerWidth`, `duration`, `notchEveryFrames`.
 * @param {(ctx: Object) => Promise<void>} run
 */
async function withScenario(options, run) {
  const domHost = mountDom();
  const clock = createVirtualClock();
  clock.install(globalThis);
  let scenario = null;
  try {
    scenario = createCarouselScenario({ document: globalThis.document, ...options });
    const probe = createProbe(scenario.engine, { now: () => clock.now }).attach();
    const advanceFrame = () => clock.advance();

    await run({ ...scenario, probe, clock, advanceFrame });
  } finally {
    clock.restore();
    scenario?.dispose();
    domHost.restore();
  }
}

const px = (n) => `${n.toFixed(2)}px`;

/**
 * Chạy tới khi promise xong, đồng thời tua frame. Promise resolve trong microtask
 * của một frame, nên chỉ cần `await advanceFrame()` là nó có cơ hội chạy.
 */
async function drain(frameCount, advanceFrame) {
  for (let i = 0; i < frameCount; i += 1) await advanceFrame();
}

test("setItems silent không phát hard-select, mặc định vẫn phát", async () => {
  await withScenario(
    { count: 4, containerWidth: 1600, duration: 600 },
    async ({ engine }) => {
      let hardSelectCount = 0;
      engine.onHardSelect(() => {
        hardSelectCount += 1;
      });

      engine.setItems(engine.items, 0, { silent: true });
      assert.equal(hardSelectCount, 0, "silent render không được phát hard-select");

      engine.setItems(engine.items, 0);
      assert.equal(hardSelectCount, 1, "mặc định setItems vẫn phát hard-select");
    },
  );
});

test("opacity theo offset vẫn cập nhật khi thẻ mới đang chạy enter animation", async () => {
  await withScenario(
    { count: 4, containerWidth: 1600, duration: 600 },
    async ({ engine, advanceFrame }) => {
      const nextItems = [...engine.items, { id: "card-new", url: "" }];
      engine.syncItems(nextItems, 0, { animate: true });

      const newCard = engine.els.at(-1);
      const frame = newCard.querySelector(".card-frame");
      const content = newCard.querySelector(".card-content");
      const initialOpacity = Number(frame.style.opacity);

      assert.ok(content.classList.contains("card-enter-slot"));
      engine.scrollToCard(engine.count - 1);
      await drain(20, advanceFrame);

      assert.ok(
        Number(frame.style.opacity) > initialOpacity,
        "opacity layout phải tăng khi thẻ mới tiến về tâm, dù enter animation đang chạy",
      );
    },
  );
});

test("xóa thẻ đang chốt: thu cột không nhảy, promise resolve, index chốt đúng", { timeout: 30000 }, async () => {
  await withScenario(
    { count: 8, containerWidth: 1600, duration: 600 },
    async ({ engine, probe, advanceFrame }) => {
      engine.scrollToCard(3);
      await drain(90, advanceFrame);
      assert.equal(engine.hardIndex, 3, "phải chốt ở thẻ số 3 trước khi xóa");

      let outcome;
      const pending = engine.deleteActiveCard().then((value) => {
        outcome = value;
        return value;
      });
      const rightNeighbourFrame = engine.els[4].querySelector(".card-frame");
      let guard = 0;
      while (outcome === undefined && guard < 300) {
        await advanceFrame();
        guard += 1;
        if (guard === 45) {
          assert.ok(
            Number(rightNeighbourFrame.style.opacity) > 0.88,
            "opacity của thẻ bên phải phải theo offset đã dịch khi cột thu hẹp",
          );
        }
      }
      await pending;

      const analysis = probe.analyze();
      console.log(formatReport(analysis, "delete settled card (index 3)"));

      assert.equal(outcome, true, "deleteActiveCard phải resolve true");
      assert.equal(engine.count, 7, "danh sách phải còn 7 thẻ");
      assert.equal(engine.isDeleting, false, "phải thoát trạng thái đang xóa");
      assert.equal(engine.hardIndex, 2, "thẻ kế cận ưu tiên bên trái là index 2");
      assert.equal(
        engine.settled, true,
        "sau khi xóa xong dải phải ở trạng thái đứng yên",
      );
      assert.ok(
        analysis.retarget.worst.dx <= RETARGET_JUMP_X_PX,
        `thu cột làm thẻ nhảy ${px(analysis.retarget.worst.dx)} ` +
        `(ngưỡng ${px(RETARGET_JUMP_X_PX)})`,
      );
      assertRenderInvariants(analysis, "delete");    },
  );
});

test("xóa khi cú snap đang chạy: carousel từ chối để store không lệch dải", { timeout: 30000 }, async () => {
  await withScenario(
    { count: 8, containerWidth: 1600, duration: 600 },
    async ({ engine, container, advanceFrame }) => {
      dispatchWheel(container, NOTCH_DELTA_Y);
      await drain(3, advanceFrame);
      assert.equal(engine.settled, false, "cú snap phải đang chạy");

      const outcome = await engine.deleteActiveCard();
      assert.equal(outcome, false, "đang chạy animation thì phải từ chối xóa");
      assert.equal(engine.count, 8, "từ chối xóa thì danh sách không được đổi");
      assert.equal(engine.isDeleting, false, "không được kẹt trạng thái đang xóa");
    },
  );
});

/**
 * Đếm số lần engine thật sự dựng một cú snap mới.
 *
 * Probe chỉ thấy layout đổi identity, mà lần render chốt cuối (`_applyLayout(to,
 * to, 1)`) cũng đổi identity — nên nó không phân biệt được "khởi động lại" với
 * "chạy xong". Bọc thẳng `_animateTo` thì đếm được đúng thứ cần đếm.
 */
function spyOnTweenStarts(engine) {
  const original = engine._animateTo.bind(engine);
  const state = { starts: 0 };
  engine._animateTo = (...args) => {
    const before = engine._anim;
    const result = original(...args);
    if (engine._anim && engine._anim !== before) state.starts += 1;
    return result;
  };
  return state;
}

test("lăn tới cuối rồi lăn tiếp (nhịp thường): không reset cú snap, vẫn chốt", { timeout: 30000 }, async () => {
  await withScenario(
    { count: 8, containerWidth: 1600, duration: 600 },
    async (ctx) => {
      const { engine, container, probe, advanceFrame } = ctx;
      const spy = spyOnTweenStarts(engine);

      // Vuốt tới cuối, rồi ghi lại số cú snap đã dựng.
      for (let step = 0; step < engine.count - 1; step += 1) {
        for (let frame = 0; frame < 4; frame += 1) await advanceFrame();
        dispatchWheel(container, NOTCH_DELTA_Y);
      }
      const startsAtEnd = spy.starts;

      // Tiếp tục lăn dù đã ở cuối: mọi nấc đều bị clamp về cùng một thẻ.
      let settledAtNotch = -1;
      for (let notch = 0; notch < 60; notch += 1) {
        for (let frame = 0; frame < 4; frame += 1) await advanceFrame();
        dispatchWheel(container, NOTCH_DELTA_Y);
        if (settledAtNotch < 0 && engine.settled) settledAtNotch = notch;
      }

      const analysis = probe.analyze();
      console.log(formatReport(analysis, "lăn tới cuối rồi lăn tiếp — nhịp 4 frame/nấc"));

      assert.ok(
        settledAtNotch >= 0,
        "lăn tiếp ở biên thì cú snap vẫn phải chốt xong, không được khựng mãi",
      );
      assert.equal(
        spy.starts, startsAtEnd,
        "nấc lăn ở biên không được dựng lại cú snap (mỗi lần dựng lại là một lần reset easing)",
      );
      assert.equal(engine.hardIndex, engine.count - 1, "phải chốt ở thẻ cuối");
      assert.ok(
        analysis.cards.some((c) => c.maxAbsDx > 1),
        "dải phải thật sự di chuyển, không được đứng yên",
      );
    },
  );
});

test("lăn tới cuối rồi lăn tiếp (1 nấc/frame): dải vẫn tiến và chốt được", { timeout: 30000 }, async () => {
  await withScenario(
    { count: 8, containerWidth: 1600, duration: 600 },
    async ({ engine, container, probe, advanceFrame }) => {
      const spy = spyOnTweenStarts(engine);

      for (let step = 0; step < engine.count - 1; step += 1) {
        await advanceFrame();
        dispatchWheel(container, NOTCH_DELTA_Y);
      }
      const startsAtEnd = spy.starts;

      let settledAtNotch = -1;
      for (let notch = 0; notch < 60; notch += 1) {
        await advanceFrame();
        dispatchWheel(container, NOTCH_DELTA_Y);
        if (settledAtNotch < 0 && engine.settled) settledAtNotch = notch;
      }

      const analysis = probe.analyze();

      assert.ok(settledAtNotch >= 0, "nhịp dày ở biên vẫn phải chốt được cú snap");
      assertVelocityContinuity(analysis, "biên, 1 nấc/frame");
      assert.equal(
        spy.starts, startsAtEnd,
        "nấc lăn ở biên không được dựng lại cú snap",
      );
      assert.ok(
        analysis.cards.some((c) => c.maxAbsDx > 1),
        "dải phải thật sự di chuyển, không được đứng yên",
      );
    },
  );
});

/** Bất biến đúng ở mọi kịch bản: mỗi frame có đúng 1 thẻ active, độ mờ liên tục. */
function assertRenderInvariants(analysis, label) {
  assert.equal(analysis.activeCountViolations, 0,
    `${label}: phải luôn có đúng 1 thẻ active ở mọi frame`);
  assert.deepEqual(analysis.opacityViolations, [],
    `${label}: độ mờ phải biến thiên liên tục theo continuousIndex`);
}

/** Thêm bất biến chỉ đúng khi vuốt một chiều từ đầu tới cuối dải. */
function assertSweepInvariants(analysis, label) {
  assertRenderInvariants(analysis, label);
  assert.equal(analysis.activeRegressions, 0,
    `${label}: chỉ số active không được chạy ngược khi vuốt một chiều`);
  assert.equal(analysis.ciReversals, 0,
    `${label}: continuousIndex phải đơn điệu khi vuốt một chiều`);
  const reversing = analysis.cards.filter((c) => c.xReversals > 0);
  assert.deepEqual(reversing, [],
    `${label}: không thẻ nào được đảo hướng khi vuốt một chiều ` +
    `(${reversing.map((c) => `${c.id}:${c.xReversals}`).join(", ")})`);
}

/**
 * Vận tốc không được gãy khúc.
 *
 * Không so với một số px tuyệt đối: "chạy nhanh" cũng làm vận tốc đổi nhiều, nên
 * ngưỡng phải là tỉ lệ so với đỉnh vận tốc của chính thẻ đó. Một cú dựng lại chỉ
 * cần đúng một frame là reset vận tốc về 0, nên nó chạm tỉ lệ 1.0 ngay.
 */
function assertVelocityContinuity(analysis, label) {
  const worst = analysis.cards.reduce(
    (acc, card) => {
      const ratio = card.maxAbsVelocity > 0
        ? card.maxVelocityJump / card.maxAbsVelocity
        : 0;
      return ratio > acc.ratio ? { ratio, card } : acc;
    },
    { ratio: 0, card: null },
  );
  assert.ok(
    worst.ratio <= MAX_VELOCITY_JUMP_RATIO,
    `${label}: ${worst.card?.id} đổi vận tốc ` +
    `${worst.card?.maxVelocityJump.toFixed(0)}px/s trong một frame, ` +
    `bằng ${(worst.ratio * 100).toFixed(0)}% đỉnh ` +
    `${worst.card?.maxAbsVelocity.toFixed(0)}px/s ` +
    `(ngưỡng ${(MAX_VELOCITY_JUMP_RATIO * 100).toFixed(0)}%)`,
  );
}

test("vuốt chậm (mỗi cú snap chạy xong mới sang nấc kế) không có jitter", { timeout: 30000 }, async () => {
  await withScenario(
    { count: 12, containerWidth: 1600, duration: 600, notchEveryFrames: 60 },
    async ({ engine, container, probe, advanceFrame }) => {
      await sweepToLastCard({ engine, container, advanceFrame, notchEveryFrames: 60 });
      const analysis = probe.analyze();
      console.log(formatReport(analysis, "slow sweep — mỗi snap chạy trọn"));

      assert.ok(analysis.frames > 12, "phải ghi được nhiều frame");
      assertSweepInvariants(analysis, "slow sweep");
      assertVelocityContinuity(analysis, "slow sweep");
      assert.ok(
        analysis.retarget.worst.dx <= RETARGET_JUMP_X_PX,
        `slow sweep: nhảy vị trí ở frame retarget = ${px(analysis.retarget.worst.dx)} ` +
        `(ngưỡng ${px(RETARGET_JUMP_X_PX)})`,
      );
    },
  );
});

test("vuốt liên tục đầu-cuối (retarget giữa chừng) không có jitter", { timeout: 30000 }, async () => {
  await withScenario(
    { count: 12, containerWidth: 1600, duration: 600, notchEveryFrames: 4 },
    async ({ engine, container, probe, advanceFrame }) => {
      const sweep = await sweepToLastCard({
        engine, container, advanceFrame, notchEveryFrames: 4,
      });
      const analysis = probe.analyze();
      console.log(formatReport(analysis, "fast sweep — retarget liên tục"));

      assert.equal(sweep.notches.length, 11, "phải bắn đủ số nấc để tới thẻ cuối");
      assert.ok(engine.hardIndex === engine.count - 1,
        `phải dừng ở thẻ cuối, đang ở ${engine.hardIndex}`);
      assertSweepInvariants(analysis, "fast sweep");
      assertVelocityContinuity(analysis, "fast sweep");

      // Ở nhịp dày, frame retarget là một frame bình thường của lò xo (đích vừa đổi
      // nhưng vị trí và vận tốc không đổi), nên nó vẫn đi được vài chục px. Vì vậy
      // ngưỡng nhảy tuyệt đối chỉ có nghĩa ở nhịp thưa — nơi mỗi nấc bắt đầu lại từ
      // trạng thái đứng yên. Ở đây thứ phải giữ là tính liên tục của vận tốc, cộng
      // với các bất biến một chiều ở trên.
      assert.ok(
        analysis.epochs >= sweep.notches.length + 1,
        `phải tách được một mốc chuyển động cho từng nấc ` +
        `(epochs=${analysis.epochs}, nấc=${sweep.notches.length})`,
      );
    },
  );
});

test("lăn mỗi frame một nấc trên danh sách dài: dải bám theo tay, không khựng", { timeout: 30000 }, async () => {
  await withScenario(
    { count: 30, containerWidth: 1600, duration: 600 },
    async ({ engine, container, probe, advanceFrame }) => {
      const steps = engine.count - 1;
      const midStep = Math.floor(steps / 2);
      let midLag = null;

      for (let step = 0; step < steps; step += 1) {
        await advanceFrame();
        dispatchWheel(container, NOTCH_DELTA_Y);
        if (step === midStep) midLag = step + 1 - engine.continuousIndex;
      }
      const endLag = steps - engine.continuousIndex;
      await drain(180, advanceFrame);

      const analysis = probe.analyze();
      console.log(formatReport(analysis, `lăn mỗi frame một nấc (${steps} nấc)`));

      // Lăn nhanh hơn cả tốc độ mà lò xo có thể đuổi thì dải phải bám sau đích một
      // quãng ổn định (lực hút tỉ lệ với quãng bám, nên quãng đó tự tìm điểm cân
      // bằng). Quãng bám cứ nới dần nghĩa là mỗi nấc lại dựng lại chuyển động từ
      // đầu, và dải bò ngày càng xa tay người dùng.
      assert.ok(
        Math.abs(endLag - midLag) < 1,
        `quãng bám không được nới dần: giữa chừng ${midLag.toFixed(2)} thẻ, ` +
        `lúc ngừng ${endLag.toFixed(2)} thẻ`,
      );
      assert.ok(
        endLag > -0.05,
        `dải không được vượt đích khi đang lăn tới (đang ở ${endLag.toFixed(2)} thẻ)`,
      );
      assert.equal(engine.hardIndex, steps, "phải chốt ở thẻ cuối");
      assert.equal(engine.settled, true, "lăn xong phải đứng yên");
      assertSweepInvariants(analysis, "lăn mỗi frame một nấc");
      assertVelocityContinuity(analysis, "lăn mỗi frame một nấc");
    },
  );
});

/** Chạy tới khi lò xo chốt, đồng thời ghi lại vị trí xa nhất mà dải đi được. */
async function drainTracking(engine, advanceFrame, limit = 240) {
  let min = engine.continuousIndex;
  let max = engine.continuousIndex;
  let guard = 0;
  while (!engine.settled && guard < limit) {
    await advanceFrame();
    min = Math.min(min, engine.continuousIndex);
    max = Math.max(max, engine.continuousIndex);
    guard += 1;
  }
  return { min, max, settled: engine.settled };
}

test("nhả kéo nhanh: đà của cú kéo được truyền vào lò xo, dải không dừng khựng", { timeout: 30000 }, async () => {
  await withScenario(
    { count: 12, containerWidth: 1600, duration: 600 },
    async ({ engine, container, advanceFrame }) => {
      // Kéo sang trái 300px trong 6 mẫu (~100ms) ⇒ ~3000px/s ≈ 10 bậc/giây, đúng
      // một thẻ và chưa đủ ngưỡng flick của `resolveDragTarget`.
      await dragAndRelease({ container, advanceFrame, totalX: -300 });

      assert.equal(engine.settled, false, "nhả tay là lò xo phải đang chạy");
      const releaseVx = engine._anim?.vx ?? 0;
      assert.ok(
        releaseVx > 3,
        `đà của cú kéo phải được truyền vào lò xo (đang là ${releaseVx.toFixed(2)} bậc/giây)`,
      );

      // Đi ngay frame kế tiếp: không có đà thì đây là chỗ dải đứng lại một nhịp.
      const beforeReleaseFrame = engine.continuousIndex;
      await advanceFrame();
      const firstStep = engine.continuousIndex - beforeReleaseFrame;
      assert.ok(
        firstStep > 0.05,
        `dải phải đi tiếp ngay sau khi nhả (được ${firstStep.toFixed(3)} bậc)`,
      );

      const track = await drainTracking(engine, advanceFrame);
      assert.equal(track.settled, true, "phải chốt được sau cú nhả");
      assert.equal(engine.hardIndex, 1, "kéo đúng một thẻ thì phải chốt ở thẻ 1");
      assert.ok(
        track.max <= 1 + MAX_FLICK_OVERSHOOT + 0.05,
        `quãng vượt đích phải bị chặn (đi tới ${track.max.toFixed(3)} thẻ)`,
      );
    },
  );
});

test("kéo vượt mép rồi nhả: đà hướng ra ngoài dải bị bỏ, mép không hở thêm", { timeout: 30000 }, async () => {
  await withScenario(
    { count: 8, containerWidth: 1600, duration: 600 },
    async ({ engine, container, advanceFrame }) => {
      // Đang ở thẻ đầu, kéo sang phải tức là ra ngoài mép trái rồi nhả.
      await dragAndRelease({ container, advanceFrame, totalX: 240 });

      assert.equal(
        engine._anim?.vx ?? 0, 0,
        "đà hướng ra ngoài danh sách phải bị bỏ, nếu không dải bay xa thêm khỏi mép",
      );

      const track = await drainTracking(engine, advanceFrame);
      assert.equal(track.settled, true, "phải chốt được sau cú nhả");
      assert.equal(engine.hardIndex, 0, "phải trở về thẻ đầu");
      assert.ok(
        track.min >= -0.35,
        `dải không được đi xa thêm khỏi mép (đi tới ${track.min.toFixed(3)} thẻ)`,
      );
    },
  );
});

test("đặt dải vào giữa hai thẻ rồi đứng tay mới nhả: lướt về đích, không giật", { timeout: 30000 }, async () => {
  await withScenario(
    { count: 12, containerWidth: 1600, duration: 600 },
    async ({ engine, container, advanceFrame }) => {
      // Kéo chậm 150px ≈ nửa bậc (giữa hai thẻ), rồi GIỮ YÊN 20 frame (~330ms) mới
      // buông — đúng cách người ta đặt dải vào chỗ rồi mới nhả tay.
      await dragAndRelease({
        container, advanceFrame, totalX: -150, samples: 15, idleFrames: 20,
      });

      const steps = [];
      let guard = 0;
      while (!engine.settled && guard < 240) {
        const before = engine.continuousIndex;
        await advanceFrame();
        steps.push(engine.continuousIndex - before);
        guard += 1;
      }

      assert.equal(engine.settled, true, "phải chốt được sau cú nhả");
      assert.equal(engine.hardIndex, 1, "buông ở nửa bậc thì chốt ở thẻ kế tiếp");

      // Quãng còn lại 0.5 bậc, nên cú lướt nhanh nhất mà lò xo tới hạn được phép là
      // 0.368·ω·D·dt ≈ 0.051 bậc/frame (ω = 10/0.6, 60fps). Nhét quãng đứng yên vào
      // đồng hồ thì frame đầu đi 0.259 bậc — nửa quãng đường trong đúng một frame,
      // tức cú giật mà test này canh. 0.1 là gấp đôi trần trên, đủ chỗ cho frame dài.
      const maxStep = Math.max(...steps);
      assert.ok(
        maxStep < 0.1,
        `bước dài nhất phải là bước lướt bình thường (được ${maxStep.toFixed(4)} bậc)`,
      );
      assert.ok(steps[0] > 0, "frame đầu sau khi nhả phải đi tiếp chứ không đứng hình");
    },
  );
});
