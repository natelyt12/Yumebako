/**
 * probe.js
 * ---------------------------------------------------------------------------
 * Bộ đo jitter của CarouselEngine — dùng chung cho test trong Node và cho trang
 * harness trong browser.
 *
 * Cách hoạt động: mỗi lần engine ghi layout ra DOM là đúng một lần gọi
 * `geometry.applyLayout(...)`. Bọc hàm đó lại, chụp ngay sau khi nó chạy xong, và
 * ta có ảnh chụp "mỗi lần render" của toàn bộ dải: từng thẻ một, gồm bề rộng, toạ
 * độ (translateX), tâm, độ mờ của khung ảnh và trạng thái `active`.
 *
 * Từ chuỗi ảnh chụp đó, `analyze()` rút ra các dấu hiệu jitter:
 *   - nhảy vị trí / bề rộng giữa hai frame liền nhau,
 *   - nhảy ngay ở frame đầu của một lượt chuyển động mới (đứt quãng khi retarget),
 *   - đảo hướng di chuyển (rung qua lại),
 *   - độ mờ nhảy lệch khỏi công thức theo khoảng cách tới tâm,
 *   - số thẻ `active` khác 1, hoặc chỉ số active chạy ngược,
 *   - `continuousIndex` đảo chiều,
 *   - vận tốc đổi đột ngột (một tween dựng lại từ đầu là reset vận tốc về 0 ngay
 *     lúc retarget, nên vận tốc nhảy đúng bằng chính nó — không phải đứt quãng
 *     nhưng vẫn thấy giật),
 *   - nhịp thời gian giữa các frame (chỉ có ý nghĩa khi đo bằng thời gian thật).
 */

/**
 * Hệ số mờ theo khoảng cách của thẻ: `defaultCardInfo` trong `geometry.js` nội
 * suy tuyến tính `opacityCurve` = [1, 0.9, 0.7, 0.5, 0.3, 0.1], nên dốc lớn nhất
 * của hàm là 0.2 — độ mờ không thể đổi nhanh hơn 0.2 lần quãng đường tâm ảo đi
 * được trong cùng frame.
 */
export const OPACITY_FADE_RATE = 0.2;

const TRANSLATE_RE = /translateX\((-?[\d.eE+-]+)px\)/;

/** Đọc `translateX(...)` từ inline transform. */
export function parseTranslateX(transform) {
  const match = TRANSLATE_RE.exec(transform || "");
  return match ? Number.parseFloat(match[1]) : 0;
}

/**
 * @param {import("../../src/wallpaper/ui/carousel/CarouselEngine.js").CarouselEngine} engine
 * @param {Object} [options]
 * @param {string} [options.opacitySelector]
 * @param {() => number} [options.now]
 */
export function createProbe(engine, {
  opacitySelector = ".card-frame",
  now = () => globalThis.performance?.now?.() ?? Date.now(),
} = {}) {
  /** @type {Array<Object>} */
  const samples = [];
  let attached = false;
  let originalApplyLayout = null;
  let lastLayoutA = null;
  let lastLayoutB = null;
  let lastTarget;
  let epoch = 0;

  const readCard = (cardEl, index) => {
    const width = Number.parseFloat(cardEl.style.width) || 0;
    const left = parseTranslateX(cardEl.style.transform);
    const overlay = cardEl.querySelector(opacitySelector);
    const rawOpacity = overlay ? Number.parseFloat(overlay.style.opacity) : NaN;
    return {
      index,
      id: cardEl.dataset.id ?? String(index),
      width,
      left,
      center: left + width / 2,
      opacity: Number.isFinite(rawOpacity) ? rawOpacity : null,
      active: cardEl.classList.contains("active"),
      // Thẻ đang rơi: độ mờ của khung do hiệu ứng rơi điều khiển, không theo
      // công thức khoảng cách tới tâm — phải loại khỏi phép kiểm tra liên tục.
      deleting: cardEl.classList.contains("deleting"),
    };
  };

  const record = (cards, layoutA, layoutB, t, layoutCenterIndex) => {
    // Mốc "vừa có lượt chuyển động mới": đích của cú đang chạy vừa đổi (retarget),
    // hoặc engine vừa dựng cặp layout mới cho một lượt khác (pha thu cột khi xoá).
    // Đây là mốc để tách "frame đầu của lượt mới" (chỗ dễ đứt quãng nhất) khỏi các
    // frame nằm giữa lượt.
    //
    // KHÔNG lấy identity của layout làm mốc duy nhất: lò xo vẽ lại từ vị trí nên
    // mỗi frame là một object mới, lấy identity thì frame nào cũng hoá retarget và
    // số đo mất hết ý nghĩa.
    const target = engine._anim?.target ?? null;
    const newLayoutPair = layoutA !== lastLayoutA || layoutB !== lastLayoutB;
    if (target !== lastTarget || (newLayoutPair && layoutA !== layoutB)) {
      epoch += 1;
    }
    lastTarget = target;
    lastLayoutA = layoutA;
    lastLayoutB = layoutB;
    samples.push({
      n: samples.length,
      epoch,
      t,
      tMs: now(),
      // `continuousIndex` là vị trí ảo của engine; `layoutCenterIndex` là tâm ảo
      // dùng để tính độ mờ ở chính frame này. Hai giá trị này khác nhau trong pha
      // thu cột sau khi xóa, nên phép kiểm tra độ mờ phải bám theo giá trị sau.
      continuousIndex: engine.continuousIndex,
      layoutCenterIndex: Number.isFinite(layoutCenterIndex)
        ? layoutCenterIndex
        : engine.continuousIndex,
      softIndex: engine.softIndex,
      hardIndex: engine.hardIndex,
      settled: engine.settled,
      cardCount: cards.length,
      cards: cards.map(readCard),
    });
  };

  return {
    get samples() {
      return samples;
    },
    get epochs() {
      return epoch;
    },

    /** Bắt đầu ghi. Gọi sau khi dải đã dựng xong để không lẫn frame khởi tạo. */
    attach() {
      if (attached) return this;
      attached = true;
      const geometry = engine.geometry;
      originalApplyLayout = geometry.applyLayout;
      geometry.applyLayout = (cards, layoutA, layoutB, t, screenCenter) => {
        const result = originalApplyLayout.call(geometry, cards, layoutA, layoutB, t, screenCenter);
        record(cards, layoutA, layoutB, t, result?.layout?.centerIndex);
        return result;
      };
      return this;
    },

    detach() {
      if (!attached) return this;
      attached = false;
      engine.geometry.applyLayout = originalApplyLayout;
      return this;
    },

    analyze(options) {
      return analyze(samples, options);
    },

    /** Xuất CSV để soi bằng mắt hoặc vẽ đồ thị. */
    toCsv() {
      const header = [
        "sample", "epoch", "t", "tMs", "continuousIndex", "layoutCenterIndex",
        "softIndex", "hardIndex", "cardId", "cardIndex", "width", "left", "center",
        "opacity", "active", "deleting",
      ].join(",");
      const lines = [header];
      for (const sample of samples) {
        for (const card of sample.cards) {
          lines.push([
            sample.n, sample.epoch, sample.t.toFixed(6), sample.tMs.toFixed(2),
            sample.continuousIndex.toFixed(6), sample.layoutCenterIndex.toFixed(6),
            sample.softIndex, sample.hardIndex, card.id, card.index,
            card.width.toFixed(3), card.left.toFixed(3), card.center.toFixed(3),
            card.opacity === null ? "" : card.opacity.toFixed(4),
            card.active ? 1 : 0, card.deleting ? 1 : 0,
          ].join(","));
        }
      }
      return lines.join("\n");
    },
  };
}

const percentile = (sorted, p) => {
  if (sorted.length === 0) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[i];
};

const px = (n) => `${n.toFixed(2)}px`;

/**
 * Rút số liệu jitter từ chuỗi ảnh chụp.
 *
 * @param {Array<Object>} samples
 * @param {Object} [options]
 * @param {number} [options.opacityRate] - Hệ số mờ theo khoảng cách (khớp `defaultCardInfo`).
 * @param {number} [options.moveEps] - Dưới ngần này coi như đứng yên (px).
 * @param {number} [options.opacityTol] - Dung sai làm tròn của độ mờ.
 */
export function analyze(samples, {
  opacityRate = OPACITY_FADE_RATE,
  moveEps = 0.5,
  opacityTol = 0.002,
} = {}) {
  /** @type {Map<string, Array<Object>>} */
  const seriesById = new Map();
  for (const sample of samples) {
    for (const card of sample.cards) {
      if (!seriesById.has(card.id)) seriesById.set(card.id, []);
      seriesById.get(card.id).push({
        ...card,
        n: sample.n,
        epoch: sample.epoch,
        t: sample.t,
        tMs: sample.tMs,
        continuousIndex: sample.continuousIndex,
        layoutCenterIndex: sample.layoutCenterIndex,
        cardCount: sample.cardCount,
      });
    }
  }

  const cards = [];
  const retargetJumps = [];
  const opacityViolations = [];
  let worstJumpAny = { delta: 0, sample: -1, cardId: "-" };

  for (const [id, points] of seriesById) {
    let maxAbsDx = 0;
    let maxAbsDw = 0;
    let maxAbsDop = 0;
    let maxJumpAtRetarget = 0;
    let maxJumpAtRetargetWidth = 0;
    let xReversals = 0;
    let widthDirectionChanges = 0;
    let maxAbsVelocity = 0;
    let maxVelocityJump = 0;
    let lastDx = 0;
    let lastDw = 0;
    let lastVelocity = null;
    let minOpacity = Infinity;
    let maxOpacity = -Infinity;

    for (let i = 1; i < points.length; i += 1) {
      const prev = points[i - 1];
      const cur = points[i];
      const dx = cur.center - prev.center;
      const dw = cur.width - prev.width;
      const dop = cur.opacity === null || prev.opacity === null ? 0 : cur.opacity - prev.opacity;

      // Vận tốc px/giây. Một cú chuyển động dựng lại từ đầu sẽ reset vận tốc về 0
      // ngay lúc retarget, nên cột này so với `vMax` là chỗ lộ ra chuyện gãy khúc.
      const dtMs = cur.tMs - prev.tMs;
      if (dtMs > 0) {
        const velocity = (dx / dtMs) * 1000;
        maxAbsVelocity = Math.max(maxAbsVelocity, Math.abs(velocity));
        if (lastVelocity !== null) {
          maxVelocityJump = Math.max(maxVelocityJump, Math.abs(velocity - lastVelocity));
        }
        lastVelocity = velocity;
      }

      maxAbsDx = Math.max(maxAbsDx, Math.abs(dx));
      maxAbsDw = Math.max(maxAbsDw, Math.abs(dw));
      maxAbsDop = Math.max(maxAbsDop, Math.abs(dop));
      if (Math.abs(dx) > worstJumpAny.delta) {
        worstJumpAny = { delta: Math.abs(dx), sample: cur.n, cardId: id };
      }

      if (cur.epoch !== prev.epoch) {
        maxJumpAtRetarget = Math.max(maxJumpAtRetarget, Math.abs(dx));
        maxJumpAtRetargetWidth = Math.max(maxJumpAtRetargetWidth, Math.abs(dw));
        retargetJumps.push({
          sample: cur.n,
          cardId: id,
          epoch: cur.epoch,
          dx: Math.abs(dx),
          dw: Math.abs(dw),
          continuousIndex: cur.layoutCenterIndex,
        });
      }

      if (Math.abs(dx) > moveEps) {
        const dir = Math.sign(dx);
        if (lastDx !== 0 && dir !== lastDx) xReversals += 1;
        lastDx = dir;
      }
      if (Math.abs(dw) > moveEps) {
        const dir = Math.sign(dw);
        if (lastDw !== 0 && dir !== lastDw) widthDirectionChanges += 1;
        lastDw = dir;
      }

      // Độ mờ là hàm thuần của khoảng cách tới tâm, nên tốc độ đổi của nó bị chặn
      // bởi tốc độ đổi của tâm ảo ở chính frame đó. Vượt chặn = có chỗ ghi độ mờ
      // rời rạc. Bỏ qua hai trường hợp không phải chuyển động:
      //   - thẻ đang rơi: độ mờ của nó thuộc hiệu ứng rơi;
      //   - frame gỡ thẻ: số thẻ đổi nên chỉ số (và do đó offset) của mọi thẻ phía
      //     sau được đánh lại, độ mờ đổi theo là đúng.
      const structural = cur.cardCount !== prev.cardCount;
      const bound = opacityRate * Math.abs(cur.layoutCenterIndex - prev.layoutCenterIndex)
        + opacityTol;
      if (!structural && !cur.deleting && !prev.deleting && Math.abs(dop) > bound) {
        opacityViolations.push({
          sample: cur.n,
          cardId: id,
          dop: Math.abs(dop),
          bound,
          continuousIndex: cur.layoutCenterIndex,
        });
      }

      if (cur.opacity !== null) {
        minOpacity = Math.min(minOpacity, cur.opacity);
        maxOpacity = Math.max(maxOpacity, cur.opacity);
      }
    }

    cards.push({
      id,
      index: points[0]?.index ?? -1,
      samples: points.length,
      maxAbsDx,
      maxAbsDw,
      maxAbsDop,
      maxJumpAtRetarget,
      maxJumpAtRetargetWidth,
      xReversals,
      widthDirectionChanges,
      maxAbsVelocity,
      maxVelocityJump,
      minOpacity: Number.isFinite(minOpacity) ? minOpacity : null,
      maxOpacity: Number.isFinite(maxOpacity) ? maxOpacity : null,
    });
  }

  // Trên toàn dải: luôn đúng 1 thẻ active, và chỉ số active không chạy ngược
  // trong lúc vuốt một chiều.
  let activeCountViolations = 0;
  let activeRegressions = 0;
  let prevActiveIndex = null;
  for (const sample of samples) {
    const actives = sample.cards.filter((c) => c.active);
    if (actives.length !== 1) activeCountViolations += 1;
    const activeIndex = actives[0]?.index ?? null;
    if (prevActiveIndex !== null && activeIndex !== null && activeIndex < prevActiveIndex) {
      activeRegressions += 1;
    }
    if (activeIndex !== null) prevActiveIndex = activeIndex;
  }

  // `continuousIndex` phải đơn điệu trong lúc vuốt một chiều.
  let ciReversals = 0;
  let prevCi = null;
  let prevDir = 0;
  for (const sample of samples) {
    if (prevCi !== null) {
      const d = sample.continuousIndex - prevCi;
      if (Math.abs(d) > 1e-9) {
        const dir = Math.sign(d);
        if (prevDir !== 0 && dir !== prevDir) ciReversals += 1;
        prevDir = dir;
      }
    }
    prevCi = sample.continuousIndex;
  }

  // Nhịp frame — chỉ đáng quan tâm khi đo bằng thời gian thật (browser harness).
  const dts = [];
  for (let i = 1; i < samples.length; i += 1) dts.push(samples[i].tMs - samples[i - 1].tMs);
  const sortedDts = [...dts].sort((a, b) => a - b);
  const p50 = percentile(sortedDts, 0.5);
  const frameTiming = dts.length
    ? {
      p50,
      p95: percentile(sortedDts, 0.95),
      max: sortedDts[sortedDts.length - 1],
      longFrames: dts.filter((d) => d > p50 * 1.5 + 4).length,
      total: dts.length,
    }
    : null;

  const worstRetarget = retargetJumps.reduce(
    (acc, item) => (item.dx > acc.dx ? item : acc),
    { dx: 0, dw: 0 },
  );

  return {
    frames: samples.length,
    epochs: samples.length ? samples[samples.length - 1].epoch : 0,
    cards,
    retarget: { count: retargetJumps.length, worst: worstRetarget, events: retargetJumps },
    worstJumpAny,
    opacityViolations,
    activeCountViolations,
    activeRegressions,
    ciReversals,
    frameTiming,
  };
}

/**
 * Kết xuất báo cáo dạng text — dùng chung cho `console.log` trong test và cho
 * khung `<pre>` của trang harness, để hai nơi không lệch nhau.
 *
 * @param {Object} analysis - Kết quả `analyze()`.
 * @param {string} [title]
 */
export function formatReport(analysis, title = "carousel jitter") {
  const lines = [];
  lines.push("");
  lines.push(`── ${title} ──`);
  lines.push(
    `frames=${analysis.frames}  epochs=${analysis.epochs}  ` +
    `retarget-frames=${analysis.retarget.count}`,
  );
  if (analysis.frameTiming) {
    const t = analysis.frameTiming;
    lines.push(
      `sample dt (gap giữa các lần render): p50=${t.p50.toFixed(2)}ms ` +
      `p95=${t.p95.toFixed(2)}ms max=${t.max.toFixed(2)}ms longGaps=${t.longFrames}/${t.total}`,
    );
  }
  lines.push(
    "card      | maxΔx    maxΔw    maxΔop  | jump@retarget x/w      | xRev wDir | " +
    "vMax px/s   ΔvMax px/s | op[min..max]",
  );
  for (const card of analysis.cards) {
    lines.push(
      `${card.id.padEnd(9)} | ` +
      `${px(card.maxAbsDx).padStart(8)} ${px(card.maxAbsDw).padStart(8)} ` +
      `${card.maxAbsDop.toFixed(3).padStart(7)} | ` +
      `${px(card.maxJumpAtRetarget).padStart(10)} ${px(card.maxJumpAtRetargetWidth).padStart(10)} | ` +
      `${String(card.xReversals).padStart(4)} ${String(card.widthDirectionChanges).padStart(4)} | ` +
      `${card.maxAbsVelocity.toFixed(0).padStart(10)} ${card.maxVelocityJump.toFixed(0).padStart(11)} | ` +
      `${card.minOpacity?.toFixed(3) ?? "-"}..${card.maxOpacity?.toFixed(3) ?? "-"}`,
    );
  }
  lines.push(
    `worst jump anywhere: ${px(analysis.worstJumpAny.delta)} ` +
    `(sample ${analysis.worstJumpAny.sample}, ${analysis.worstJumpAny.cardId})`,
  );
  lines.push(
    `violations: active-count=${analysis.activeCountViolations} ` +
    `opacity=${analysis.opacityViolations.length} ` +
    `[chỉ có nghĩa khi vuốt một chiều: active-regress=${analysis.activeRegressions} ` +
    `ci-reversal=${analysis.ciReversals}]`,
  );
  if (analysis.retarget.events.length > 0) {
    const worst = [...analysis.retarget.events].sort((a, b) => b.dx - a.dx).slice(0, 8);
    lines.push("top retarget jumps:");
    for (const event of worst) {
      lines.push(
        `  sample ${String(event.sample).padStart(3)} ${event.cardId.padEnd(9)} ` +
        `dx=${px(event.dx).padStart(9)} dw=${px(event.dw).padStart(9)} ` +
        `layoutCenter=${event.continuousIndex.toFixed(3)}`,
      );
    }
  }
  lines.push("");
  return lines.join("\n");
}
