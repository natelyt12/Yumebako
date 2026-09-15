import { openSidebarSubmenu, closeSidebarSubmenu, setSubmenuDirty, showNotification, createSlider } from "/src/core/ui.js";
import { saveSettings, getSettings } from "/src/core/storageHandler.js";
import { t, translateDOM } from "/src/core/i18n.js";

const MIN_ZOOM = 1;
const MAX_ZOOM = 3;

// ─────────────────────────────────────────────────────────────────────────────
//  BackgroundEditor
//
//  Coordinate system:
//    - state.x / state.y  (0..100%)  → CSS background-position X% Y%
//    - state.zoom  (MIN..MAX)        → CSS transform: scale(zoom)
//                                      with transformOrigin: X% Y%
// ─────────────────────────────────────────────────────────────────────────────

class BackgroundEditor {
    constructor(realLayer, template) {
        this.realLayer = realLayer;
        this.template = template;

        this.DEFAULT_STATE = { x: 50, y: 50, zoom: 1, mode: "cover" };

        const savedPos = getSettings().wallpaperPosition;
        this.startState = savedPos
            ? { ...this.DEFAULT_STATE, ...savedPos }
            : { ...this.DEFAULT_STATE };
        this.currentState = { ...this.startState };

        this.isSaved = false;
        this.isDirty = false;

        this.ui = {};
        this.sliders = {};

        // Editor geometry (populated on image load)
        this.dim = {
            viewW: 0,  // thumbnail width  in the editor popup
            viewH: 0,  // thumbnail height in the editor popup
            baseLensW: 0, // lens width  at zoom = 1 (represents 1 screenful)
            baseLensH: 0, // lens height at zoom = 1
        };

        // Interaction state
        this._drag = {
            active: false,
            type: null,   // "lens" | "corner"
            corner: null,   // "nw" | "ne" | "sw" | "se"
            startClientX: 0,
            startClientY: 0,
            // Lens drag
            startLensLeft: 0,
            startLensTop: 0,
            // Corner resize (snapshot at mousedown)
            startLensW: 0,
            startLensH: 0,
            startResLeft: 0,
            startResTop: 0,
        };

        this.onMouseMove = this.onMouseMove.bind(this);
        this.onMouseUp = this.onMouseUp.bind(this);
    }

    // ─── Public ─────────────────────────────────────────────────────────────

    /**
     * Apply saved transform to the real background layer on page load.
     */
    init() {
        if (getSettings().wallpaperPosition) {
            this.applyTransformToLayer(this.startState);
        }
    }

    /**
     * Open the editor popup.
     */
    async open() {
        const videoLayer = document.querySelector(".video");
        const imgLayer = document.querySelector(".image");
        const isVideo = videoLayer && videoLayer.style.display !== "none" && videoLayer.src && !videoLayer.src.endsWith("undefined");
        
        const bgUrl = imgLayer ? getComputedStyle(imgLayer).backgroundImage : null;

        if (!isVideo && (!bgUrl || bgUrl === "none")) {
            showNotification(t("bg_editor.no_image_alert"), "warning");
            return;
        }

        // Remove any leftover global listeners from a previous session
        document.removeEventListener("mousemove", this.onMouseMove);
        document.removeEventListener("mouseup", this.onMouseUp);

        // Reset session
        this.isSaved = false;
        this.isDirty = false;
        this.dim = { viewW: 0, viewH: 0, baseLensW: 0, baseLensH: 0 };
        
        const savedPos = getSettings().wallpaperPosition;
        this.startState = savedPos
            ? { ...this.DEFAULT_STATE, ...savedPos }
            : { ...this.DEFAULT_STATE };
        this.currentState = { ...this.startState };

        const clone = this.template.content.cloneNode(true);
        translateDOM(clone);

        this.bindUI(clone);

        if (isVideo) {
            const fitModeLabelText = clone.querySelector('[data-i18n="bg_editor.fit_mode_label"]');
            if (fitModeLabelText) {
                fitModeLabelText.setAttribute("data-i18n", "bg_editor.fit_mode_video_label");
                fitModeLabelText.innerText = t("bg_editor.fit_mode_video_label", "Hiển thị toàn bộ video");
            }
        }

        this.setupSliders(isVideo);
        this.setupDragHandlers();
        this.setupEvents();

        openSidebarSubmenu(t("bg_editor.window_title"), clone, {
            width: "600px",
            canPreview: true,
            isDirty: () => this.isDirty,
            onCancel: () => {
                document.removeEventListener("mousemove", this.onMouseMove);
                document.removeEventListener("mouseup", this.onMouseUp);
                if (!this.isSaved) {
                    this.currentState = { ...this.startState };
                    this.applyTransformToLayer(this.startState);
                }
                const imgLayerEl = document.querySelector(".image");
                const videoLayerEl = document.querySelector(".video");
                if (imgLayerEl) imgLayerEl.style.transition = "";
                if (videoLayerEl) videoLayerEl.style.transition = "";
                if (this.isDirty) {
                    this.isDirty = false;
                    setSubmenuDirty(false);
                }
            }
        });

        const success = await this.loadMediaAndCalculate(isVideo, videoLayer, bgUrl);
        if (!success) {
            closeSidebarSubmenu(true);
            return;
        }
    }

    // ─── UI Binding ──────────────────────────────────────────────────────────

    bindUI(clone) {
        this.ui.editorContainer = clone.querySelector("#editor_container");
        this.ui.fullImageView = clone.querySelector("#full_image_view");
        this.ui.viewLens = clone.querySelector("#view_lens");
        this.ui.btnReset = clone.querySelector("#btn_reset");
        this.ui.btnApply = clone.querySelector("#btn_apply");
        this.ui.fitMode = clone.querySelector("#fit_mode_checkbox");
        this.ui.manualControls = clone.querySelector("#manual_controls");
    }

    // ─── Sliders ─────────────────────────────────────────────────────────────

    setupSliders(isVideo = false) {
        if (!this.ui.manualControls) return;

        const specs = [
            {
                id: "zoom", label: isVideo ? t("bg_editor.zoom_video_label", "Zoom video:") : t("bg_editor.zoom_label"),
                min: MIN_ZOOM, max: MAX_ZOOM, step: 0.01, defaultValue: 1, unit: "×",
            },
            {
                id: "x", label: t("bg_editor.pos_x_label"),
                min: 0, max: 100, step: 0.1, defaultValue: 50, unit: "%",
            },
            {
                id: "y", label: t("bg_editor.pos_y_label"),
                min: 0, max: 100, step: 0.1, defaultValue: 50, unit: "%",
            },
        ];

        this.sliders = {};
        this.ui.manualControls.innerHTML = "";

        specs.forEach(spec => {
            const slider = createSlider({
                label: spec.label,
                min: spec.min,
                max: spec.max,
                step: spec.step,
                value: this.currentState[spec.id] ?? spec.defaultValue,
                defaultValue: spec.defaultValue,
                unit: spec.unit,
                onChange: (val) => {
                    this.currentState[spec.id] = val;
                    this.isDirty = true;
                    setSubmenuDirty(true);
                    // Sliders already updated internally; only update lens + layer
                    this._updateLensGeometry();
                    this.applyTransformToLayer(this.currentState);
                },
            });

            this.ui.manualControls.appendChild(slider);
            this.sliders[spec.id] = slider;
        });
    }

    // ─── Drag & Corner Resize ────────────────────────────────────────────────

    setupDragHandlers() {
        const lens = this.ui.viewLens;
        const drag = this._drag;

        // ── Lens body → move position ──
        lens.addEventListener("mousedown", (e) => {
            if (e.target.classList.contains("lens_corner")) return;
            e.preventDefault();

            drag.active = true;
            drag.type = "lens";
            drag.startClientX = e.clientX;
            drag.startClientY = e.clientY;
            drag.startLensLeft = lens.offsetLeft;
            drag.startLensTop = lens.offsetTop;
            lens.style.cursor = "grabbing";
        });

        // ── Corner handles → resize (zoom) ──
        lens.querySelectorAll(".lens_corner").forEach(handle => {
            handle.addEventListener("mousedown", (e) => {
                e.preventDefault();
                e.stopPropagation();

                drag.active = true;
                drag.type = "corner";
                drag.corner = handle.dataset.corner;
                drag.startClientX = e.clientX;
                drag.startClientY = e.clientY;
                drag.startLensW = lens.offsetWidth;
                drag.startLensH = lens.offsetHeight;
                drag.startResLeft = lens.offsetLeft;
                drag.startResTop = lens.offsetTop;
            });
        });

        document.addEventListener("mousemove", this.onMouseMove);
        document.addEventListener("mouseup", this.onMouseUp);
    }

    onMouseMove(e) {
        if (!this._drag.active) return;
        const dx = e.clientX - this._drag.startClientX;
        const dy = e.clientY - this._drag.startClientY;

        if (this._drag.type === "lens") {
            this._handleLensDrag(dx, dy);
        } else if (this._drag.type === "corner") {
            this._handleCornerResize(dx, dy, this._drag.corner);
        }
    }

    onMouseUp() {
        if (!this._drag.active) return;
        this._drag.active = false;
        this._drag.type = null;
        this._drag.corner = null;
        if (this.ui.viewLens) this.ui.viewLens.style.cursor = "grab";
    }

    /**
     * Drag the entire lens to reposition (changes x / y).
     */
    _handleLensDrag(dx, dy) {
        const d = this.dim;
        const drag = this._drag;
        const lens = this.ui.viewLens;

        const lensW = lens.offsetWidth;
        const lensH = lens.offsetHeight;
        const maxMoveX = Math.max(0, d.viewW - lensW);
        const maxMoveY = Math.max(0, d.viewH - lensH);

        const newLeft = Math.max(0, Math.min(drag.startLensLeft + dx, maxMoveX));
        const newTop = Math.max(0, Math.min(drag.startLensTop + dy, maxMoveY));

        this.currentState.x = maxMoveX > 0 ? (newLeft / maxMoveX) * 100 : 50;
        this.currentState.y = maxMoveY > 0 ? (newTop / maxMoveY) * 100 : 50;
        this.isDirty = true;
        setSubmenuDirty(true);

        // Apply immediately without full updateVisuals (avoids re-reading offsetWidth/offsetHeight)
        lens.style.left = `${newLeft}px`;
        lens.style.top = `${newTop}px`;
        this._syncSliders(false);
        this.applyTransformToLayer(this.currentState);
    }

    /**
     * Drag a corner handle to resize the lens (changes zoom, and anchors the opposite corner).
     *
     * Each corner's "expand" direction is a diagonal:
     *   nw → (-1,-1), ne → (+1,-1), sw → (-1,+1), se → (+1,+1)
     * We project (dx,dy) onto that diagonal to get a single scalar rawDelta,
     * which drives the new lens width while keeping aspect ratio locked.
     */
    _handleCornerResize(dx, dy, corner) {
        const d = this.dim;
        const drag = this._drag;

        if (d.baseLensW === 0) return;

        // Aspect ratio of the lens (= screen ratio, always)
        const lensAspect = d.baseLensW / d.baseLensH;

        // Project drag onto the corner's outward diagonal (normalised)
        const DIAG = 1 / Math.SQRT2;
        let rawDelta;
        switch (corner) {
            case "se": rawDelta = (dx + dy) * DIAG; break; // right+down  = bigger
            case "sw": rawDelta = (-dx + dy) * DIAG; break; // left+down   = bigger
            case "ne": rawDelta = (dx - dy) * DIAG; break; // right+up    = bigger
            case "nw": rawDelta = (-dx - dy) * DIAG; break; // left+up     = bigger
            default: return;
        }

        // New lens size, clamped to zoom [MIN_ZOOM..MAX_ZOOM]
        const minLensW = d.baseLensW / MAX_ZOOM;
        const maxLensW = d.baseLensW;               // corresponds to zoom = MIN_ZOOM = 1
        const newLensW = Math.max(minLensW, Math.min(drag.startLensW + rawDelta, maxLensW));
        const newLensH = newLensW / lensAspect;

        // Compute new top-left by anchoring the OPPOSITE corner
        const sL = drag.startResLeft;
        const sT = drag.startResTop;
        const sW = drag.startLensW;
        const sH = drag.startLensH;

        let newLeft, newTop;
        switch (corner) {
            case "se": newLeft = sL; newTop = sT; break; // nw fixed
            case "sw": newLeft = sL + sW - newLensW; newTop = sT; break; // ne-x fixed
            case "ne": newLeft = sL; newTop = sT + sH - newLensH; break; // sw-y fixed
            case "nw": newLeft = sL + sW - newLensW; newTop = sT + sH - newLensH; break; // se fixed
        }

        // Clamp position so lens never exits the view
        newLeft = Math.max(0, Math.min(newLeft, d.viewW - newLensW));
        newTop = Math.max(0, Math.min(newTop, d.viewH - newLensH));

        // Convert back to state values
        const maxMoveX = Math.max(0, d.viewW - newLensW);
        const maxMoveY = Math.max(0, d.viewH - newLensH);

        this.currentState.zoom = d.baseLensW / newLensW;
        this.currentState.x = maxMoveX > 0.001
            ? Math.max(0, Math.min(100, (newLeft / maxMoveX) * 100))
            : 50;
        this.currentState.y = maxMoveY > 0.001
            ? Math.max(0, Math.min(100, (newTop / maxMoveY) * 100))
            : 50;
        this.isDirty = true;
        setSubmenuDirty(true);

        // Update lens DOM directly for responsiveness
        const lens = this.ui.viewLens;
        lens.style.width = `${newLensW}px`;
        lens.style.height = `${newLensH}px`;
        lens.style.left = `${newLeft}px`;
        lens.style.top = `${newTop}px`;

        this._syncSliders(false);
        this.applyTransformToLayer(this.currentState);
    }

    // ─── Visuals ─────────────────────────────────────────────────────────────

    /**
     * Full visual update: recalculates lens geometry, syncs sliders, applies transform.
     * Used when state is set programmatically (reset, fit toggle, page load).
     */
    updateVisuals() {
        const d = this.dim;
        const state = this.currentState;
        const ui = this.ui;

        if (d.baseLensW === 0) return;

        const isFit = state.mode === "contain";
        ui.viewLens.style.display = isFit ? "none" : "block";
        ui.manualControls.style.opacity = isFit ? "0.4" : "1";
        ui.manualControls.style.pointerEvents = isFit ? "none" : "auto";
        ui.fitMode.checked = isFit;

        if (!isFit) {
            // Clamp state
            state.zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, state.zoom));
            state.x = Math.max(0, Math.min(100, state.x));
            state.y = Math.max(0, Math.min(100, state.y));
            this._syncSliders();
            this._updateLensGeometry();
        }

        this.applyTransformToLayer(state);
    }

    /**
     * Recompute and position the lens rectangle from currentState + dim.
     */
    _updateLensGeometry() {
        const d = this.dim;
        const state = this.currentState;
        const lens = this.ui.viewLens;

        if (d.baseLensW === 0) return;

        const lensW = d.baseLensW / state.zoom;
        const lensH = d.baseLensH / state.zoom;
        const maxMoveX = Math.max(0, d.viewW - lensW);
        const maxMoveY = Math.max(0, d.viewH - lensH);

        lens.style.width = `${lensW}px`;
        lens.style.height = `${lensH}px`;
        lens.style.left = `${(state.x / 100) * maxMoveX}px`;
        lens.style.top = `${(state.y / 100) * maxMoveY}px`;
    }

    /**
     * Push currentState to the three sliders (without triggering onChange).
     * @param {boolean} [animate=true] - Whether to allow CSS transitions on the sliders. Pass false when dragging rapidly.
     */
    _syncSliders(animate = true) {
        if (!this.sliders) return;
        if (animate) {
            if (this.sliders.zoom) this.sliders.zoom.value = this.currentState.zoom;
            if (this.sliders.x) this.sliders.x.value = this.currentState.x;
            if (this.sliders.y) this.sliders.y.value = this.currentState.y;
        } else {
            if (this.sliders.zoom) this.sliders.zoom.setValueNoAnim ? this.sliders.zoom.setValueNoAnim(this.currentState.zoom) : this.sliders.zoom.value = this.currentState.zoom;
            if (this.sliders.x) this.sliders.x.setValueNoAnim ? this.sliders.x.setValueNoAnim(this.currentState.x) : this.sliders.x.value = this.currentState.x;
            if (this.sliders.y) this.sliders.y.setValueNoAnim ? this.sliders.y.setValueNoAnim(this.currentState.y) : this.sliders.y.value = this.currentState.y;
        }
    }

    /**
     * Apply state to the real .image background layer.
     *
     * Pixel-perfect: backgroundPosition X% Y% + transform scale(Z) + transformOrigin X% Y%
     * are mathematically equivalent to "crop the image at (X%, Y%) with zoom factor Z."
     * (Proof: the bg fraction visible at viewport-centre equals the lens-centre fraction
     *  in the editor, given the baseLens / viewW ratio correctly mirrors CSS cover.)
     */
    applyTransformToLayer(state) {
        const imgLayers = document.querySelectorAll(".image");
        const videoLayers = document.querySelectorAll(".video");
        const mode = state.mode || "cover";

        imgLayers.forEach(imgLayer => {
            imgLayer.style.backgroundSize = mode;

            if (mode === "contain") {
                imgLayer.style.backgroundPosition = "center";
                imgLayer.style.transformOrigin = "center";
                imgLayer.style.transform = "scale(1)";
            } else {
                imgLayer.style.transformOrigin = `${state.x}% ${state.y}%`;
                imgLayer.style.backgroundPosition = `${state.x}% ${state.y}%`;
                imgLayer.style.transform = `scale(${state.zoom})`;
            }
        });

        videoLayers.forEach(videoLayer => {
            videoLayer.style.objectFit = mode;

            if (mode === "contain") {
                videoLayer.style.objectPosition = "center";
                videoLayer.style.transformOrigin = "center";
                videoLayer.style.transform = "scale(1)";
            } else {
                videoLayer.style.transformOrigin = `${state.x}% ${state.y}%`;
                videoLayer.style.objectPosition = `${state.x}% ${state.y}%`;
                videoLayer.style.transform = `scale(${state.zoom})`;
            }
        });
    }

    // ─── Image/Video Loading ───────────────────────────────────────────────────────

    loadMediaAndCalculate(isVideo, videoLayer, bgUrl) {
        return new Promise((resolve) => {
            if (isVideo) {
                const natW = videoLayer.videoWidth;
                const natH = videoLayer.videoHeight;
                if (!natW || !natH) {
                    showNotification(t("bg_editor.video_not_ready", "Video chưa tải xong, vui lòng thử lại."), "warning");
                    if (this.popup?.closeBtn) this.popup.closeBtn.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
                    resolve(false);
                    return;
                }

                const canvas = document.createElement("canvas");
                canvas.width = natW;
                canvas.height = natH;
                const ctx = canvas.getContext("2d");
                ctx.drawImage(videoLayer, 0, 0, natW, natH);
                const thumbUrl = canvas.toDataURL("image/jpeg", 0.8);

                this._calculateAndRenderUI(natW, natH, thumbUrl);
                resolve(true);
            } else {
                const cleanUrl = bgUrl.replace(/^url\(["']?/, "").replace(/["']?\)$/, "");
                const imgObj = new Image();
                imgObj.src = cleanUrl;
                imgObj.onload = () => {
                    this._calculateAndRenderUI(imgObj.naturalWidth, imgObj.naturalHeight, cleanUrl);
                    resolve(true);
                };
                imgObj.onerror = () => {
                    showNotification(t("bg_editor.image_load_error", "Không thể tải hình ảnh."), "error");
                    resolve(false);
                };
            }
        });
    }

    _calculateAndRenderUI(natW, natH, thumbUrl) {
        const imgRatio = natW / natH;
        const screenRatio = window.innerWidth / window.innerHeight;

        // Padding inside the editor container. The corner handles are inset in
        // the lens now, so they no longer need padding to escape the
        // overflow: hidden edge - the image can use the full width.
        const CORNER_PAD = 0;
        
        // Dynamically compute available width subtracting container padding (16px * 2 = 32px)
        // and the CORNER_PAD on each side so the total container stays within the section.
        const section = this.ui.editorContainer?.closest(".setting_section") || this.ui.editorContainer?.parentElement;
        const sectionW = section ? section.clientWidth : 540;
        const availableW = Math.max(280, sectionW - 32 - CORNER_PAD * 2);
        const MAX_SIZE = availableW;
        const d = this.dim;

        // ── Step 1: fit image thumbnail into MAX_SIZE ──────────────────────
        if (imgRatio > 1) {
            d.viewW = MAX_SIZE;
            d.viewH = MAX_SIZE / imgRatio;
        } else {
            d.viewH = MAX_SIZE;
            d.viewW = MAX_SIZE * imgRatio;
        }

        this.ui.fullImageView.style.width = `${d.viewW}px`;
        this.ui.fullImageView.style.height = `${d.viewH}px`;
        this.ui.fullImageView.style.backgroundImage = `url(${thumbUrl})`;

        // ── Step 2: compute baseLens (1 screenful in editor coords) ───────
        //
        // Mirrors what CSS object-fit/background-size: cover does on the real screen:

        if (screenRatio > imgRatio) {
            d.baseLensW = d.viewW;
            d.baseLensH = d.viewW / screenRatio;
        } else {
            d.baseLensH = d.viewH;
            d.baseLensW = d.viewH * screenRatio;
        }

        // ── Step 3: size container to fit lens ────────────────────
        //
        // • containerH = max(viewH, baseLensH) ensures lens is never taller than
        //   the container (portrait screens with landscape images).
        const innerH = Math.max(d.viewH, d.baseLensH);
        const containerH = innerH + CORNER_PAD * 2;
        const containerW = d.viewW + CORNER_PAD * 2;

        this.ui.editorContainer.style.width = `${containerW}px`;
        this.ui.editorContainer.style.height = `${containerH}px`;

        // Centre full_image_view within the padded container
        this.ui.fullImageView.style.position = "absolute";
        this.ui.fullImageView.style.left = `${CORNER_PAD}px`;
        this.ui.fullImageView.style.top = `${CORNER_PAD + (innerH - d.viewH) / 2}px`;

        this.updateVisuals();
    }

    // ─── Button Events ───────────────────────────────────────────────────────

    setupEvents() {
        this.ui.btnReset.onmousedown = () => {
            // Reset position & zoom but keep current mode
            this.currentState = {
                ...this.DEFAULT_STATE,
                mode: this.currentState.mode,
            };
            this.isDirty = true;
            setSubmenuDirty(true);
            this.updateVisuals();
        };

        this.ui.fitMode.onchange = () => {
            this.currentState.mode = this.ui.fitMode.checked ? "contain" : "cover";
            if (this.currentState.mode === "contain") {
                this.currentState.zoom = 1;
                this.currentState.x = 50;
                this.currentState.y = 50;
            }
            this.isDirty = true;
            setSubmenuDirty(true);
            this.updateVisuals();
        };

        this.ui.btnApply.onmousedown = () => {
            this.isSaved = true;
            this.isDirty = false;
            setSubmenuDirty(false);
            this.startState = {
                x: parseFloat(this.currentState.x.toFixed(2)),
                y: parseFloat(this.currentState.y.toFixed(2)),
                zoom: parseFloat(this.currentState.zoom.toFixed(4)),
                mode: this.currentState.mode || "cover",
            };
            saveSettings({ wallpaperPosition: this.startState });
            showNotification(t("common.saved_changes"), "success");
        };
    }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Public exports
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Initialize the Background Editor component.
 * Allows users to adjust the zoom and focus position of the current static
 * background image using a popup UI with draggable lens + corner resize handles.
 */
export function InitBGEditor() {
    const btn = document.getElementById("arrange_wallpaper");
    const template = document.getElementById("tpl_wallpaper_editor");
    const realLayer = document.querySelector(".image");

    if (!btn || !template || !realLayer) return;

    const editor = new BackgroundEditor(realLayer, template);
    editor.init();

    btn.onmousedown = () => editor.open();
}

export function toggleBgEditorVisibility(state) {
    const btn = document.getElementById("arrange_wallpaper");
    if (!btn) return;
    btn.style.display = state ? "flex" : "none";
    if (btn.nextElementSibling) {
        btn.nextElementSibling.style.display = state ? "block" : "none";
    }
}

/**
 * Apply wallpaper position state (zoom, transform-origin, background-position) on page load.
 */
export function applyWallpaperPosition() {
    const settings = getSettings();
    const state = settings.wallpaperPosition || { x: 50, y: 50, zoom: 1, mode: "cover" };
    const realLayers = document.querySelectorAll(".image");
    const videoLayers = document.querySelectorAll(".video");

    const mode = state.mode || "cover";

    realLayers.forEach(realLayer => {
        realLayer.style.backgroundSize = mode;

        if (mode === "contain") {
            realLayer.style.backgroundPosition = "center";
            realLayer.style.transformOrigin = "center";
            realLayer.style.transform = "scale(1)";
        } else {
            realLayer.style.transformOrigin = `${state.x}% ${state.y}%`;
            realLayer.style.backgroundPosition = `${state.x}% ${state.y}%`;
            realLayer.style.transform = `scale(${state.zoom})`;
        }
    });

    videoLayers.forEach(videoLayer => {
        videoLayer.style.objectFit = mode;

        if (mode === "contain") {
            videoLayer.style.objectPosition = "center";
            videoLayer.style.transformOrigin = "center";
            videoLayer.style.transform = "scale(1)";
        } else {
            videoLayer.style.transformOrigin = `${state.x}% ${state.y}%`;
            videoLayer.style.objectPosition = `${state.x}% ${state.y}%`;
            videoLayer.style.transform = `scale(${state.zoom})`;
        }
    });
}
