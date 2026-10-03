/**
 * harness.js
 * ---------------------------------------------------------------------------
 * Đo jitter trong BROWSER THẬT — bổ sung cho `jitter.test.js` (chạy headless).
 *
 * Test headless trả lời được câu "quỹ đạo có liên tục không" nhưng không thấy
 * được chi phí paint/compositing. Trang này dựng đúng CarouselEngine + đúng
 * `carousel.css`, ghi lại từng frame với thời gian thật, nên:
 *   - `frame dt (p95/max)`, `longFrames` → jank do paint (backdrop-filter, filter,
 *     quá nhiều layer…).
 *   - `jump@retarget`, `xRev` → lỗi quỹ đạo, giống hệt test headless.
 *
 * Mở bằng dev server của repo:
 *   npm run dev
 *   http://localhost:5173/tests/carousel-jitter/harness.html
 */

import "../../src/styles/variables.css";
import "../../src/wallpaper/ui/carousel/carousel.css";
import "./harness.css";

import { createCarouselScenario, sweepToLastCard } from "./scenario.js";
import { createProbe, formatReport } from "./probe.js";

const ui = {
  stage: document.getElementById("stage"),
  report: document.getElementById("report"),
  count: document.getElementById("count"),
  gap: document.getElementById("gap"),
  buttons: {
    fast: document.getElementById("run-fast"),
    slow: document.getElementById("run-slow"),
    rebuild: document.getElementById("rebuild"),
    analyze: document.getElementById("analyze"),
    csv: document.getElementById("csv"),
  },
};

/** @type {{ scenario: ReturnType<typeof createCarouselScenario>, probe: ReturnType<typeof createProbe> }|null} */
let current = null;
let running = false;

const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()));

/**
 * Đo nhịp frame THẬT bằng một vòng rAF riêng — độc lập với việc engine có render
 * hay không. Đây mới là con số bắt jank do paint/compositing: frame dài bất thường
 * nghĩa là có thứ gì đó trong khung hình đang ngốn thời gian vẽ.
 */
function createFrameMonitor() {
  let running = false;
  let last = 0;
  const deltas = [];

  const tick = (nowMs) => {
    if (!running) return;
    if (last) deltas.push(nowMs - last);
    last = nowMs;
    requestAnimationFrame(tick);
  };

  const quantile = (sorted, p) => (sorted.length
    ? sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))]
    : 0);

  return {
    start() {
      if (running) return;
      running = true;
      last = 0;
      deltas.length = 0;
      requestAnimationFrame(tick);
    },
    stop() {
      running = false;
    },
    summary() {
      const sorted = [...deltas].sort((a, b) => a - b);
      const p50 = quantile(sorted, 0.5);
      return {
        frames: deltas.length,
        p50,
        p95: quantile(sorted, 0.95),
        max: sorted[sorted.length - 1] ?? 0,
        longFrames: deltas.filter((d) => d > p50 * 1.5 + 4).length,
        worst: [...deltas].sort((a, b) => b - a).slice(0, 5),
      };
    },
  };
}

const frameMonitor = createFrameMonitor();

function setRunning(value) {
  running = value;
  Object.values(ui.buttons).forEach((button) => {
    button.disabled = value;
  });
}

function rebuild() {
  if (current) current.scenario.dispose();
  const count = Math.max(2, Math.min(60, Number(ui.count.value) || 12));
  const scenario = createCarouselScenario({
    document,
    mount: ui.stage,
    count,
  });
  const probe = createProbe(scenario.engine).attach();
  current = { scenario, probe };
  return current;
}

async function runScripted(label, notchEveryFrames) {
  if (running) return;
  setRunning(true);
  try {
    const { scenario, probe } = rebuild();
    ui.report.textContent = `Đang chạy: ${label}…`;

    // Hai frame đầu để layout ổn định trước khi bắt đầu ghi.
    await nextFrame();
    await nextFrame();

    frameMonitor.start();
    await sweepToLastCard({
      engine: scenario.engine,
      container: scenario.container,
      advanceFrame: nextFrame,
      notchEveryFrames,
    });
    frameMonitor.stop();

    const analysis = probe.analyze();
    const frames = frameMonitor.summary();
    const frameLine =
      `frame thật (rAF): frames=${frames.frames} p50=${frames.p50.toFixed(2)}ms ` +
      `p95=${frames.p95.toFixed(2)}ms max=${frames.max.toFixed(2)}ms ` +
      `longFrames=${frames.longFrames}/${frames.frames}` +
      (frames.worst.length ? ` worst=[${frames.worst.map((d) => d.toFixed(1)).join(", ")}]ms` : "");

    ui.report.textContent =
      `${frameLine}\n${formatReport(analysis, label)}`;
  } finally {
    frameMonitor.stop();
    setRunning(false);
  }
}

function analyzeNow() {
  if (!current) return;
  const analysis = current.probe.analyze();
  ui.report.textContent = formatReport(analysis, "phân tích thủ công (lăn chuột tay)");
}

function downloadCsv() {
  if (!current) return;
  const url = URL.createObjectURL(new Blob([current.probe.toCsv()], { type: "text/csv" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "carousel-jitter-samples.csv";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const readGap = () => Math.max(1, Math.min(120, Number(ui.gap.value) || 4));

ui.buttons.fast.addEventListener("click", () => {
  const gap = readGap();
  runScripted(`fast sweep — notch mỗi ${gap} frame`, gap);
});
ui.buttons.slow.addEventListener("click", () => runScripted("slow sweep — mỗi snap chạy trọn", 60));
ui.buttons.rebuild.addEventListener("click", () => {
  if (running) return;
  rebuild();
  ui.report.textContent =
    "Đã dựng lại. Lăn chuột trong sân khấu rồi bấm “Phân tích”, " +
    "hoặc bấm “Vuốt nhanh” để đo tự động.";
});
ui.buttons.analyze.addEventListener("click", analyzeNow);
ui.buttons.csv.addEventListener("click", downloadCsv);

// Lăn chuột tay cũng được ghi lại; đồng hồ dùng thời gian thật nên frame dt ở
// lần đo này phản ánh đúng cảm giác thật.
rebuild();
ui.report.textContent =
  "Sẵn sàng. Bấm “Vuốt nhanh” để đo tự động, hoặc lăn chuột trong sân khấu " +
  "rồi bấm “Phân tích”.";
