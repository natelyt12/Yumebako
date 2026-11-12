import "./style.css";
import {
  createSlider,
  confirmReset,
  showNotification,
  initButtons,
} from "/src/core/ui.js";
import { renderIcons } from "/src/core/icon.js";
import { t } from "/src/core/i18n.js";
import { getSettings, saveSettings } from "/src/core/storageHandler.js";
import { applyWallpaperPosition } from "../../../../backend/rendering/position.js";

const DEFAULT_STATE = Object.freeze({
  x: 50,
  y: 50,
  zoom: 1,
  mode: "cover",
});

/**
 * Open the Fullscreen Direct Drag & Bottom-Left Floating HUD Position Editor.
 *
 * @param {Object} [options]
 * @param {Function} [options.onSave] - Callback invoked when changes are saved.
 * @param {Function} [options.onClose] - Callback invoked when the editor is closed.
 */
export function openPositionEditorPopup(options = {}) {
  // Never stack two editors: the first one owns the fullscreen overlay.
  if (document.body.classList.contains("wallpaper_position_editing")) return;

  const settings = getSettings();
  const savedState = settings.wallpaperPosition
    ? { ...DEFAULT_STATE, ...settings.wallpaperPosition }
    : { ...DEFAULT_STATE };

  const initialState = { ...savedState };
  let currentState = { ...savedState };

  // 1. Temporarily tuck the Switcher out of view so the user has 100% of the desktop
  document.body.classList.add("wallpaper_position_editing");

  // 2. Fullscreen interactive canvas (captures pointer drag and wheel gestures)
  const canvas = document.createElement("div");
  canvas.className = "wallpaper_position_canvas";

  // 3. Floating HUD card at bottom-left, hint pinned to its top
  const hud = document.createElement("aside");
  hud.className = "wallpaper_position_hud";

  hud.innerHTML = `
    <div class="hud_hint tooltip">
      <i data-icon="arrangeWallpaper"></i>
      <span>${t("bg_editor.drag_hint")}</span>
    </div>
    <div class="hud_sliders" id="hud_sliders"></div>
    <div class="hud_options">
      <label class="btn" data-action="toggle">
        <div class="btn_body">
          <span class="btn_title">${t("bg_editor.fit_mode_label")}</span>
        </div>
        <input type="checkbox" id="hud_fit_mode" ${currentState.mode === "contain" ? "checked" : ""} />
      </label>
    </div>
    <div class="hud_actions">
      <div class="hud_actions_row">
        <button type="button" class="btn flex_1" id="hud_btn_reset">${t("bg_editor.btn_reset")}</button>
        <button type="button" class="btn btn_primary flex_1" id="hud_btn_apply">${t("bg_editor.btn_apply")}</button>
      </div>
      <button type="button" class="btn hud_cancel_btn" id="hud_btn_cancel">${t("common.cancel")}</button>
    </div>
  `;

  document.body.append(canvas, hud);
  renderIcons(hud);
  initButtons(hud);

  // Prevent drag / gesture events inside HUD from bleeding into the background canvas
  hud.addEventListener("pointerdown", (e) => e.stopPropagation());
  hud.addEventListener("wheel", (e) => e.stopPropagation());

  // 5. Create sliders for Zoom, X, and Y using shared Material 3 wavy slider
  const slidersHost = hud.querySelector("#hud_sliders");
  const fitModeCheckbox = hud.querySelector("#hud_fit_mode");

  const sliderZoom = createSlider({
    label: t("bg_editor.zoom_label"),
    dataI18n: "bg_editor.zoom_label",
    min: 1,
    max: 3,
    step: 0.05,
    value: currentState.zoom,
    defaultValue: DEFAULT_STATE.zoom,
    unit: "x",
    onChange: (val) => {
      currentState.zoom = parseFloat(val);
      applyWallpaperPosition(currentState);
    },
  });

  const sliderX = createSlider({
    label: t("bg_editor.pos_x_label"),
    dataI18n: "bg_editor.pos_x_label",
    min: 0,
    max: 100,
    step: 0.01,
    value: parseFloat(currentState.x ?? DEFAULT_STATE.x),
    defaultValue: DEFAULT_STATE.x,
    unit: "%",
    onChange: (val) => {
      currentState.x = parseFloat(val);
      applyWallpaperPosition(currentState);
    },
  });

  const sliderY = createSlider({
    label: t("bg_editor.pos_y_label"),
    dataI18n: "bg_editor.pos_y_label",
    min: 0,
    max: 100,
    step: 0.01,
    value: parseFloat(currentState.y ?? DEFAULT_STATE.y),
    defaultValue: DEFAULT_STATE.y,
    unit: "%",
    onChange: (val) => {
      currentState.y = parseFloat(val);
      applyWallpaperPosition(currentState);
    },
  });

  slidersHost.append(sliderZoom, sliderX, sliderY);

  const syncSlidersDisabled = () => {
    const isContain = currentState.mode === "contain";
    slidersHost.classList.toggle("is-disabled", isContain);
  };
  syncSlidersDisabled();

  // 6. Direct Pan & Drag Gestures on Canvas, locked 1:1 to the cursor.
  //
  //    For `background-size: cover` (and `object-fit: cover`), moving the
  //    position by 1% shifts the painted image by `(renderedSize - container) / 100`
  //    pixels. The layer is additionally scaled by `zoom` around its position
  //    origin, so the on-screen shift per 1% becomes `zoom * renderedSize - container`.
  //    We only need the natural image size to derive `renderedSize`, which lets us
  //    convert pointer pixels into an exact position delta instead of guessing a
  //    sensitivity constant.
  let naturalSize = null;

  const getLayerElement = () => {
    const video = [...document.querySelectorAll(".video")].find(
      (v) => v.style.display !== "none" && v.videoWidth > 0,
    );
    return video || document.querySelector(".image");
  };

  const measureNaturalSize = () => {
    const layer = getLayerElement();
    if (layer?.tagName === "VIDEO") {
      return Promise.resolve({ w: layer.videoWidth, h: layer.videoHeight });
    }

    const bg = layer ? getComputedStyle(layer).backgroundImage : "";
    const match = bg && bg.match(/url\(["']?(.*?)["']?\)/);
    if (!match) return Promise.resolve(null);

    return new Promise((resolve) => {
      const probe = new Image();
      probe.onload = () =>
        resolve({ w: probe.naturalWidth, h: probe.naturalHeight });
      probe.onerror = () => resolve(null);
      probe.src = match[1];
    });
  };
  measureNaturalSize().then((size) => {
    naturalSize = size;
  });

  /**
   * Painted (cover-fitted) media size before zoom, plus the box it is painted in.
   * Measured from the live layer so the math works even when the wallpaper layer
   * is not exactly the size of the window.
   */
  const getRenderedSize = () => {
    const layer = getLayerElement();
    const cw = layer?.clientWidth || window.innerWidth || 1;
    const ch = layer?.clientHeight || window.innerHeight || 1;
    const base =
      layer?.tagName === "VIDEO"
        ? { w: layer.videoWidth, h: layer.videoHeight }
        : naturalSize || { w: 16, h: 9 }; // 16:9 fallback until measured
    const coverScale = Math.max(cw / base.w, ch / base.h);
    return {
      width: base.w * coverScale,
      height: base.h * coverScale,
      containerWidth: cw,
      containerHeight: ch,
    };
  };

  const clampPercent = (value) => Math.min(100, Math.max(0, value));

  let isDragging = false;
  let startX = 0;
  let startY = 0;
  let originX = currentState.x;
  let originY = currentState.y;

  const onPointerDown = (e) => {
    if (e.target !== canvas) return;
    if (e.button !== 0 || currentState.mode === "contain") return;
    isDragging = true;
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {}
    canvas.classList.add("is-dragging");
    startX = e.clientX;
    startY = e.clientY;
    originX = currentState.x;
    originY = currentState.y;
  };

  const onPointerMove = (e) => {
    if (!isDragging) return;
    const dxPx = e.clientX - startX;
    const dyPx = e.clientY - startY;

    const zoom = currentState.zoom || 1;
    const rendered = getRenderedSize();

    // Signed overflow of the painted image past the viewport on each axis.
    const overflowX = zoom * rendered.width - rendered.containerWidth;
    const overflowY = zoom * rendered.height - rendered.containerHeight;

    let nextX = currentState.x;
    let nextY = currentState.y;

    if (Math.abs(overflowX) > 1) {
      nextX = clampPercent(originX - (dxPx * 100) / overflowX);
    }
    if (Math.abs(overflowY) > 1) {
      nextY = clampPercent(originY - (dyPx * 100) / overflowY);
    }

    currentState.x = parseFloat(nextX.toFixed(2));
    currentState.y = parseFloat(nextY.toFixed(2));

    sliderX.value = currentState.x;
    sliderY.value = currentState.y;

    applyWallpaperPosition(currentState);
  };

  const onPointerUp = (e) => {
    if (!isDragging) return;
    isDragging = false;
    try {
      canvas.releasePointerCapture(e.pointerId);
    } catch {}
    canvas.classList.remove("is-dragging");
  };

  const onWheel = (e) => {
    if (currentState.mode === "contain") return;
    e.preventDefault();
    const step = e.deltaY < 0 ? 0.05 : -0.05;
    const nextZoom = Math.min(3.0, Math.max(1.0, currentState.zoom + step));
    if (nextZoom !== currentState.zoom) {
      currentState.zoom = parseFloat(nextZoom.toFixed(2));
      sliderZoom.value = currentState.zoom;
      applyWallpaperPosition(currentState);
    }
  };

  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", onPointerUp);
  canvas.addEventListener("wheel", onWheel, { passive: false });

  // 7. Fit Mode toggle
  fitModeCheckbox.addEventListener("change", () => {
    currentState.mode = fitModeCheckbox.checked ? "contain" : "cover";
    if (currentState.mode === "contain") {
      currentState.zoom = 1;
      currentState.x = 50;
      currentState.y = 50;
      sliderZoom.value = 1;
      sliderX.value = 50;
      sliderY.value = 50;
    }
    syncSlidersDisabled();
    applyWallpaperPosition(currentState);
  });

  // 8. Teardown & cleanup helper
  let isClosed = false;
  const close = (saved = false) => {
    if (isClosed) return;
    isClosed = true;

    window.removeEventListener("keydown", onKeyDown);
    canvas.removeEventListener("pointerdown", onPointerDown);
    canvas.removeEventListener("pointermove", onPointerMove);
    canvas.removeEventListener("pointerup", onPointerUp);
    canvas.removeEventListener("pointercancel", onPointerUp);
    canvas.removeEventListener("wheel", onWheel);

    hud.classList.add("is-closing");
    document.body.classList.remove("wallpaper_position_editing");
    // Ignore clicks on the fading overlays so they cannot reach the switcher.
    canvas.style.pointerEvents = "none";
    hud.style.pointerEvents = "none";

    setTimeout(() => {
      canvas.remove();
      hud.remove();
    }, 280);

    if (!saved) {
      applyWallpaperPosition(initialState);
      options.onClose?.();
    } else {
      options.onSave?.(currentState);
    }
  };

  const onKeyDown = (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close(false);
    }
  };
  window.addEventListener("keydown", onKeyDown);

  // 9. Reset action
  hud.querySelector("#hud_btn_reset")?.addEventListener("click", async () => {
    canvas.style.pointerEvents = "none";
    try {
      if (!(await confirmReset())) return;
      currentState = { ...DEFAULT_STATE };
      fitModeCheckbox.checked = false;
      sliderZoom.value = DEFAULT_STATE.zoom;
      sliderX.value = DEFAULT_STATE.x;
      sliderY.value = DEFAULT_STATE.y;
      syncSlidersDisabled();
      applyWallpaperPosition(currentState);
    } finally {
      canvas.style.pointerEvents = "";
    }
  });

  // 10. Apply & Save action
  hud.querySelector("#hud_btn_apply")?.addEventListener("click", () => {
    const finalState = {
      x: parseFloat(currentState.x.toFixed(2)),
      y: parseFloat(currentState.y.toFixed(2)),
      zoom: parseFloat(currentState.zoom.toFixed(4)),
      mode: currentState.mode || "cover",
    };
    saveSettings({ wallpaperPosition: finalState });
    showNotification(t("common.saved_changes"), "success");
    applyWallpaperPosition(finalState);
    close(true);
  });

  // 11. Cancel & Close actions
  hud.querySelector("#hud_btn_cancel")?.addEventListener("click", () => {
    close(false);
  });
}
