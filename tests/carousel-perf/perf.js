/**
 * perf.js
 * ---------------------------------------------------------------------------
 * Trang đo hiệu năng THẬT trong browser cho CarouselEngine.
 *
 * Trả lời hai câu hỏi không thể đo bằng test headless:
 *   1. FPS/frame time khi carousel có 200–500 thẻ và đang chạy liên tục.
 *   2. Carousel đang giữ bao nhiêu compositor layer, và ước tính VRAM của chúng.
 *
 * Trình duyệt KHÔNG có API đọc VRAM theo tab. Vì vậy HUD hiển thị:
 *   - `Layer promoted`: số thẻ thật sự có layer GPU (đọc từ class `is-onscreen`
 *     do geometry.js gắn, hoặc toàn bộ thẻ khi bật chế độ mô phỏng trước tối ưu).
 *   - `VRAM ước tính`: layer × 744×420×4×DPR² + texture thumbnail × 640×360×4×DPR².
 * Để có số VRAM thật, mở Task Manager của Chrome/Edge (Shift+Esc) → cột GPU memory.
 */
import "../../src/styles/variables.css";
import "../../src/wallpaper/ui/carousel/carousel.css";
import "./perf.css";

import {
  CarouselEngine,
} from "../../src/wallpaper/ui/carousel/CarouselEngine.js";

const BASE_WIDTH = 744;
const CONTAINER_HEIGHT = 420;
const THUMB_WIDTH = 640;
const THUMB_HEIGHT = 360;

const ui = {
  stage: document.getElementById("stage"),
  count: document.getElementById("count"),
  images: document.getElementById("images"),
  gap: document.getElementById("gap"),
  forceLayers: document.getElementById("force-layers"),
  rebuild: document.getElementById("rebuild"),
  sweep: document.getElementById("sweep"),
  status: document.getElementById("status"),
  stats: {
    fps: document.getElementById("stat-fps"),
    p50: document.getElementById("stat-p50"),
    p95: document.getElementById("stat-p95"),
    max: document.getElementById("stat-max"),
    long: document.getElementById("stat-long"),
    heap: document.getElementById("stat-heap"),
    nodes: document.getElementById("stat-nodes"),
    loaded: document.getElementById("stat-loaded"),
    layers: document.getElementById("stat-layers"),
    vram: document.getElementById("stat-vram"),
    gpu: document.getElementById("stat-gpu"),
    view: document.getElementById("stat-view"),
  },
  graph: document.getElementById("graph"),
};

const nextFrame = () =>
  new Promise((resolve) => requestAnimationFrame(() => resolve()));

/* ── Thẻ & ảnh ──────────────────────────────────────────────────────────── */

let current = null;
let objectUrls = [];
let rebuilding = false;

function makeItems(count, urls) {
  return Array.from({ length: count }, (_, i) => ({
    id: `card-${i}`,
    name: `Card ${i}`,
    sub: "perf",
    url: urls[i] || "",
  }));
}

function createStage() {
  const root = document.createElement("div");
  root.className = "wallpaper_switcher";

  const inner = document.createElement("div");
  inner.className = "wallpaper_switcher_inner";

  const container = document.createElement("div");
  container.className = "carousel-container";

  const track = document.createElement("div");
  track.className = "carousel-track";

  container.appendChild(track);
  inner.appendChild(container);
  root.appendChild(inner);
  ui.stage.appendChild(root);

  return { root, container, track };
}

/**
 * Sinh thumbnail JPEG khác nhau cho từng thẻ. Ảnh dùng chung một URL sẽ được
 * trình duyệt chia sẻ bộ nhớ decode, nên không phản ánh đúng chi phí của một
 * bộ sưu tập ảnh thật.
 */
async function generateThumbUrls(count, onProgress) {
  const canvas = document.createElement("canvas");
  canvas.width = THUMB_WIDTH;
  canvas.height = THUMB_HEIGHT;
  const ctx = canvas.getContext("2d");
  const urls = [];

  for (let i = 0; i < count; i += 1) {
    const hue = (i * 137.508) % 360;
    const gradient = ctx.createLinearGradient(0, 0, THUMB_WIDTH, THUMB_HEIGHT);
    gradient.addColorStop(0, `hsl(${hue} 72% 38%)`);
    gradient.addColorStop(1, `hsl(${(hue + 70) % 360} 68% 12%)`);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, THUMB_WIDTH, THUMB_HEIGHT);

    ctx.fillStyle = "rgba(255, 255, 255, 0.22)";
    ctx.beginPath();
    ctx.arc(120 + (i % 5) * 90, 120, 70, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
    ctx.font = "bold 44px ui-sans-serif, system-ui, sans-serif";
    ctx.fillText(String(i), 22, 66);

    const blob = await new Promise((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.72),
    );
    if (blob) urls.push(URL.createObjectURL(blob));

    if (i % 10 === 0) {
      onProgress(i + 1, count);
      await nextFrame();
    }
  }

  return urls;
}

async function rebuild() {
  if (rebuilding) return;
  rebuilding = true;
  ui.rebuild.disabled = true;
  stopSweep();

  const count = Math.max(
    2,
    Math.min(1000, Number(ui.count.value) || 300),
  );
  const withImages = ui.images.value === "synthetic";

  try {
    if (current) {
      current.engine.destroy();
      current.root.remove();
      current = null;
    }
    objectUrls.forEach((url) => URL.revokeObjectURL(url));
    objectUrls = [];

    let urls = [];
    if (withImages) {
      ui.status.textContent = `Đang sinh 0/${count} ảnh…`;
      urls = await generateThumbUrls(count, (done, total) => {
        ui.status.textContent = `Đang sinh ${done}/${total} ảnh…`;
      });
      objectUrls = urls;
    }

    const { root, container, track } = createStage();
    root.classList.toggle("force-layers", ui.forceLayers.checked);
    const engine = new CarouselEngine({ container, track, duration: 600 });
    engine.setItems(makeItems(count, urls), 0);
    engine.setActive(true);
    current = { root, container, track, engine, count };

    ui.status.textContent = `Sẵn sàng: ${count} thẻ${
      withImages ? `, ${urls.length} thumbnail` : " (không ảnh)"
    }.`;
  } catch (error) {
    console.error("[perf] rebuild failed:", error);
    ui.status.textContent = `Lỗi: ${error?.message || error}`;
  } finally {
    rebuilding = false;
    ui.rebuild.disabled = false;
  }
}

/* ── Vòng đo frame ──────────────────────────────────────────────────────── */

const frameDeltas = [];
const frameStamps = [];
let lastFrameTs = 0;

function recordFrame(ts) {
  if (lastFrameTs) {
    const dt = ts - lastFrameTs;
    frameDeltas.push(dt);
    if (frameDeltas.length > 300) frameDeltas.shift();
  }
  lastFrameTs = ts;
  frameStamps.push(ts);
  while (frameStamps.length && ts - frameStamps[0] > 1000) frameStamps.shift();
  requestAnimationFrame(recordFrame);
}
requestAnimationFrame(recordFrame);

function quantile(sorted, p) {
  if (!sorted.length) return 0;
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(p * sorted.length) - 1),
  );
  return sorted[index];
}

function frameSummary() {
  const sorted = [...frameDeltas].sort((a, b) => a - b);
  const p50 = quantile(sorted, 0.5);
  return {
    fps: frameStamps.length,
    p50,
    p95: quantile(sorted, 0.95),
    max: sorted[sorted.length - 1] ?? 0,
    long: frameDeltas.filter((dt) => dt > Math.max(33.4, p50 * 1.6)).length,
    total: frameDeltas.length,
  };
}

/* ── Tự vuốt ─────────────────────────────────────────────────────────────── */

let sweepOn = false;
let sweepRaf = 0;
let sweepFrame = 0;
let sweepDir = 1;

function stopSweep() {
  sweepOn = false;
  if (sweepRaf) cancelAnimationFrame(sweepRaf);
  sweepRaf = 0;
  ui.sweep.classList.remove("is-on");
  ui.sweep.textContent = "Tự vuốt";
}

function sweepTick() {
  if (!sweepOn || !current) return;
  const { engine } = current;
  const gap = Math.max(1, Math.min(120, Number(ui.gap.value) || 4));
  sweepFrame += 1;

  if (sweepFrame % gap === 0 && engine.count > 1) {
    const last = engine.count - 1;
    if (engine.hardIndex >= last) sweepDir = -1;
    else if (engine.hardIndex <= 0) sweepDir = 1;
    engine.step(sweepDir);
  }

  sweepRaf = requestAnimationFrame(sweepTick);
}

function toggleSweep() {
  if (sweepOn) {
    stopSweep();
    return;
  }
  if (!current) return;
  sweepOn = true;
  sweepFrame = 0;
  sweepDir = 1;
  ui.sweep.classList.add("is-on");
  ui.sweep.textContent = "Dừng vuốt";
  sweepRaf = requestAnimationFrame(sweepTick);
}

/* ── HUD ─────────────────────────────────────────────────────────────────── */

const gpuInfo = (() => {
  try {
    const gl = document.createElement("canvas").getContext("webgl");
    if (!gl) return "không có WebGL";
    const debug = gl.getExtension("WEBGL_debug_renderer_info");
    if (!debug) return "không đọc được";
    return String(gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)).slice(0, 48);
  } catch {
    return "không đọc được";
  }
})();

function formatMB(bytes) {
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

function readLayers() {
  if (!current) return { promoted: 0, loaded: 0 };
  const els = current.engine.els || [];
  const visible = els.filter((el) => el._onScreen).length;
  const loaded = els.filter((el) => el._isImageLoaded).length;
  const promoted = ui.forceLayers.checked ? els.length : visible;
  return { promoted, loaded };
}

function updateHud() {
  const frames = frameSummary();
  ui.stats.fps.textContent = `${frames.fps}`;
  ui.stats.p50.textContent = `${frames.p50.toFixed(1)} ms`;
  ui.stats.p95.textContent = `${frames.p95.toFixed(1)} ms`;
  ui.stats.max.textContent = `${frames.max.toFixed(1)} ms`;
  ui.stats.long.textContent = `${frames.long}/${frames.total}`;

  const memory = performance.memory;
  ui.stats.heap.textContent = memory
    ? formatMB(memory.usedJSHeapSize)
    : "n/a (không phải Chromium)";
  ui.stats.nodes.textContent = String(
    document.getElementsByTagName("*").length,
  );

  const { promoted, loaded } = readLayers();
  ui.stats.loaded.textContent = current
    ? `${loaded}/${current.engine.count}`
    : "—";
  ui.stats.layers.textContent = current
    ? `${promoted}/${current.engine.count}`
    : "—";

  const dpr = window.devicePixelRatio || 1;
  const layerBytes = BASE_WIDTH * CONTAINER_HEIGHT * 4 * dpr * dpr;
  const thumbBytes = THUMB_WIDTH * THUMB_HEIGHT * 4 * dpr * dpr;
  ui.stats.vram.textContent = formatMB(
    promoted * layerBytes + loaded * thumbBytes,
  );
  ui.stats.gpu.textContent = gpuInfo;
  ui.stats.view.textContent = `${dpr}× / ${window.innerWidth}px`;

  drawGraph();
}

function drawGraph() {
  const canvas = ui.graph;
  const ctx = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;
  ctx.clearRect(0, 0, width, height);

  const samples = frameDeltas.slice(-120);
  if (!samples.length) return;

  const scale = Math.max(33.4, ...samples);
  const barWidth = width / 120;

  // Đường 16.7ms (60fps)
  const y60 = height - (16.7 / scale) * height;
  ctx.strokeStyle = "rgba(110, 231, 168, 0.35)";
  ctx.beginPath();
  ctx.moveTo(0, y60);
  ctx.lineTo(width, y60);
  ctx.stroke();

  samples.forEach((dt, i) => {
    const barHeight = Math.max(1, (dt / scale) * height);
    ctx.fillStyle =
      dt <= 20 ? "#6ee7a8" : dt <= 33.4 ? "#ffd166" : "#ff7a7a";
    ctx.fillRect(i * barWidth, height - barHeight, Math.max(1, barWidth - 1), barHeight);
  });

  ctx.fillStyle = "rgba(255, 255, 255, 0.5)";
  ctx.font = "10px ui-monospace, monospace";
  ctx.fillText(`${scale.toFixed(0)}ms`, 4, 12);
}

setInterval(updateHud, 250);

/* ── Sự kiện ─────────────────────────────────────────────────────────────── */

ui.rebuild.addEventListener("click", () => {
  rebuild();
});

ui.sweep.addEventListener("click", toggleSweep);

ui.forceLayers.addEventListener("change", () => {
  if (!current) return;
  current.root.classList.toggle("force-layers", ui.forceLayers.checked);
});

ui.count.addEventListener("change", () => {
  rebuild();
});

ui.images.addEventListener("change", () => {
  rebuild();
});

window.addEventListener("resize", () => {
  // Engine tự recenter qua listener riêng; chỉ HUD cần cập nhật ngay.
  updateHud();
});

window.addEventListener("beforeunload", () => {
  objectUrls.forEach((url) => URL.revokeObjectURL(url));
});

const params = new URLSearchParams(location.search);
if (params.has("count")) ui.count.value = params.get("count");
if (params.get("images") === "none") ui.images.value = "none";
if (params.get("force") === "1") ui.forceLayers.checked = true;

rebuild();
