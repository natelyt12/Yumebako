import { showNotification } from "/src/core/ui.js";
import { t } from "/src/core/i18n.js";
import { renderIcons } from "/src/core/icon.js";
import { getSettings, saveSettings, subscribe } from "/src/core/storageHandler.js";
import { applyWidgetPositionStyles } from "./handler.js";

let isEditMode = false;
let isWidgetDragDirty = false;
let anchorMenuEl = null;
let targetWidgetForAnchor = null;
let anchorIndicators = [];

function createAnchorIndicators(container) {
    const els = [];
    ["center-x", "center-y"].forEach(axis => {
        const el = document.createElement("div");
        el.className = `canvas-indicator canvas-guide guide-${axis}`;
        el.dataset.axis = axis;
        container.appendChild(el);
        els.push(el);
    });
    return els;
}

function removeAnchorIndicators() {
    anchorIndicators.forEach(el => el.remove());
    anchorIndicators = [];
}

export function makeWidgetsDraggable(container) {
    const widgets = container.querySelectorAll(".widget");

    widgets.forEach((w) => {
        let isDragging = false;
        let startMouseX = 0;
        let startMouseY = 0;

        // Context menu to open anchor selector
        w.addEventListener("contextmenu", (e) => {
            if (!isEditMode) return;
            e.preventDefault();
            e.stopPropagation();
            targetWidgetForAnchor = w;
            showAnchorMenu(e.clientX, e.clientY, container);
        });

        const handleStart = (clientX, clientY, e) => {
            if (!isEditMode) return;
            if (e && e.target.closest("button, input, select, a, .resize-handle:not(.handle-c)")) return;
            if (e && e.target.closest("button, input, select, a, .resize-handle")) return;
            
            isDragging = true;
            startMouseX = clientX;
            startMouseY = clientY;
            
            w.classList.add("selected", "dragging");
            
            // Store initial values
            w.dataset.initialX = w.dataset.x || "0";
            w.dataset.initialY = w.dataset.y || "0";
        };

        const handleMove = (clientX, clientY) => {
            if (!isDragging) return;

            const dx = clientX - startMouseX;
            const dy = clientY - startMouseY;

            const initialX = parseFloat(w.dataset.initialX);
            const initialY = parseFloat(w.dataset.initialY);

            const ax = parseFloat(w.dataset.ax || "50");
            const ay = parseFloat(w.dataset.ay || "50");

            // Snap to 5px grid
            const step = 5;
            let newX = Math.round((initialX + dx) / step) * step;
            let newY = Math.round((initialY + dy) / step) * step;

            // Clamping to container bounds
            const wWidth = w.offsetWidth;
            const wHeight = w.offsetHeight;
            const cWidth = container.clientWidth;
            const cHeight = container.clientHeight;

            const anchorPxX = cWidth * ax / 100;
            const shiftX = wWidth * ax / 100;
            const minXSnap = Math.ceil((shiftX - anchorPxX) / step) * step;
            const maxXSnap = Math.floor((cWidth - wWidth + shiftX - anchorPxX) / step) * step;
            newX = Math.max(minXSnap, Math.min(newX, maxXSnap));

            const anchorPxY = cHeight * ay / 100;
            const shiftY = wHeight * ay / 100;
            const minYSnap = Math.ceil((shiftY - anchorPxY) / step) * step;
            const maxYSnap = Math.floor((cHeight - wHeight + shiftY - anchorPxY) / step) * step;
            newY = Math.max(minYSnap, Math.min(newY, maxYSnap));

            w.dataset.x = newX;
            w.dataset.y = newY;

            w.style.transform = `translate(calc(-${ax}% + ${newX}px), calc(-${ay}% + ${newY}px))`;
            isWidgetDragDirty = true;

            // Highlight guidelines
            requestAnimationFrame(() => {
                const rect = w.getBoundingClientRect();
                const containerRect = container.getBoundingClientRect();
                
                const widgetCenterX = rect.left + rect.width / 2;
                const widgetCenterY = rect.top + rect.height / 2;
                
                const canvasCenterX = containerRect.left + containerRect.width / 2;
                const canvasCenterY = containerRect.top + containerRect.height / 2;
                
                anchorIndicators.forEach(el => {
                    const axis = el.dataset.axis;
                    if (axis === "center-x") {
                        el.classList.toggle("active", Math.abs(widgetCenterX - canvasCenterX) <= 3);
                    } else if (axis === "center-y") {
                        el.classList.toggle("active", Math.abs(widgetCenterY - canvasCenterY) <= 3);
                    }
                });
            });
        };

        const handleEnd = () => {
            if (!isDragging) return;
            isDragging = false;
            w.classList.remove("selected", "dragging");
            anchorIndicators.forEach(el => el.classList.remove("active"));
        };

        w.addEventListener("mousedown", (e) => {
            if (e.button !== 0) return; // Only left click
            handleStart(e.clientX, e.clientY, e);

            const onMouseMove = (moveEvent) => handleMove(moveEvent.clientX, moveEvent.clientY);
            const onMouseUp = () => {
                handleEnd();
                document.removeEventListener("mousemove", onMouseMove);
                document.removeEventListener("mouseup", onMouseUp);
            };

            document.addEventListener("mousemove", onMouseMove);
            document.addEventListener("mouseup", onMouseUp);
        });

        w.addEventListener("touchstart", (e) => {
            if (!isEditMode) return;
            const touch = e.touches[0];
            handleStart(touch.clientX, touch.clientY, e);

            const onTouchMove = (moveEvent) => {
                const moveTouch = moveEvent.touches[0];
                handleMove(moveTouch.clientX, moveTouch.clientY);
            };

            const onTouchEnd = () => {
                handleEnd();
                document.removeEventListener("touchmove", onTouchMove);
                document.removeEventListener("touchend", onTouchEnd);
            };

            document.addEventListener("touchmove", onTouchMove, { passive: false });
            document.addEventListener("touchend", onTouchEnd);
        });
    });
}

const ANCHOR_ICONS = {
    "0,0": `<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12V4h8"/></svg>`,
    "50,0": `<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M3 4h10M8 4v8"/></svg>`,
    "100,0": `<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M12 12V4H4"/></svg>`,
    "0,50": `<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M4 3v10M4 8h8"/></svg>`,
    "50,50": `<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3v10M3 8h10"/></svg>`,
    "100,50": `<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v10M12 8H4"/></svg>`,
    "0,100": `<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4v8h8"/></svg>`,
    "50,100": `<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12h10M8 12V4"/></svg>`,
    "100,100": `<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v8H4"/></svg>`
};

function showAnchorMenu(x, y, container) {
    if (!anchorMenuEl) {
        anchorMenuEl = document.createElement("div");
        anchorMenuEl.className = "anchor-menu grid-anchor-menu";
        
        // Hide menu when clicking outside
        document.addEventListener('click', (e) => {
            if (anchorMenuEl && !e.target.closest('.anchor-menu')) {
                anchorMenuEl.classList.remove('visible');
                targetWidgetForAnchor = null;
            }
        });
        
        const anchorsList = [
            { ax: 0, ay: 0, title: "Top Left" }, { ax: 50, ay: 0, title: "Top Center" }, { ax: 100, ay: 0, title: "Top Right" },
            { ax: 0, ay: 50, title: "Center Left" }, { ax: 50, ay: 50, title: "Center" }, { ax: 100, ay: 50, title: "Center Right" },
            { ax: 0, ay: 100, title: "Bottom Left" }, { ax: 50, ay: 100, title: "Bottom Center" }, { ax: 100, ay: 100, title: "Bottom Right" }
        ];
        
        const gridEl = document.createElement("div");
        gridEl.className = "anchor-grid";
        
        anchorsList.forEach(item => {
            const btn = document.createElement("button");
            btn.className = "anchor-cell";
            btn.title = item.title;
            btn.dataset.ax = item.ax;
            btn.dataset.ay = item.ay;
            btn.innerHTML = ANCHOR_ICONS[`${item.ax},${item.ay}`] || "";
            
            btn.onclick = (e) => {
                e.stopPropagation();
                if (targetWidgetForAnchor) {
                    const ax = btn.dataset.ax;
                    const ay = btn.dataset.ay;
                    
                    targetWidgetForAnchor.dataset.ax = ax;
                    targetWidgetForAnchor.dataset.ay = ay;
                    
                    // Reset offset to teleport to anchor
                    targetWidgetForAnchor.dataset.x = 0;
                    targetWidgetForAnchor.dataset.y = 0;
                    
                    applyWidgetPositionStyles(targetWidgetForAnchor, {
                        ax: parseInt(ax), ay: parseInt(ay), x: 0, y: 0
                    });
                    
                    isWidgetDragDirty = true;
                    anchorMenuEl.classList.remove('visible');
                    targetWidgetForAnchor = null;
                }
            };
            gridEl.appendChild(btn);
        });
        
        anchorMenuEl.appendChild(gridEl);
        container.appendChild(anchorMenuEl);
    }
    
    // Position menu with boundary safety
    const rect = container.getBoundingClientRect();
    let menuLeft = x - rect.left;
    let menuTop = y - rect.top;

    const menuSize = 100;
    if (menuLeft + menuSize > rect.width) menuLeft = rect.width - menuSize - 8;
    if (menuTop + menuSize > rect.height) menuTop = rect.height - menuSize - 8;
    if (menuLeft < 8) menuLeft = 8;
    if (menuTop < 8) menuTop = 8;
    
    anchorMenuEl.style.left = menuLeft + "px";
    anchorMenuEl.style.top = menuTop + "px";
    
    // Highlight current anchor
    if (targetWidgetForAnchor) {
        const currentAx = targetWidgetForAnchor.dataset.ax || "0";
        const currentAy = targetWidgetForAnchor.dataset.ay || "0";
        anchorMenuEl.querySelectorAll(".anchor-cell").forEach(cell => {
            cell.classList.toggle("active", cell.dataset.ax === currentAx && cell.dataset.ay === currentAy);
        });
    }
    
    anchorMenuEl.classList.add("visible");
}

export function syncWidgetEditMode() {
    const editBtn = document.getElementById("widget_edit_mode");
    if (!editBtn) return;

    subscribe("widgets", (widgets) => {
        const enabled = widgets?.enabled !== false;
        if (!enabled && isEditMode) exitMode();
        editBtn.disabled = enabled === false;
        editBtn.style.opacity = enabled !== false ? "1" : "0.5";
        editBtn.style.pointerEvents = enabled !== false ? "auto" : "none";
    });

    editBtn.onclick = () => {
        startEditMode();
    };
}

let floatingBar = null;
let canExit = false;
let exitTimer = null;
let originalPositions = [];

const RESIZE_HANDLE_ICONS = {
    nw: `<svg viewBox="0 0 18 18" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M16 3H3v13"/></svg>`,
    ne: `<svg viewBox="0 0 18 18" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3h13v13"/></svg>`,
    se: `<svg viewBox="0 0 18 18" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 15h13V2"/></svg>`,
    sw: `<svg viewBox="0 0 18 18" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M16 15H3V2"/></svg>`,
    n: `<svg viewBox="0 0 24 6" width="24" height="6" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="2" y1="3" x2="22" y2="3"/></svg>`,
    s: `<svg viewBox="0 0 24 6" width="24" height="6" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="2" y1="3" x2="22" y2="3"/></svg>`,
    w: `<svg viewBox="0 0 6 24" width="6" height="24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="3" y1="2" x2="3" y2="22"/></svg>`,
    e: `<svg viewBox="0 0 6 24" width="6" height="24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="3" y1="2" x2="3" y2="22"/></svg>`
};

function createResizeHandles(widget, container) {
    if (widget.querySelector(".widget-resize-handles")) return;

    const wrapper = document.createElement("div");
    wrapper.className = "widget-resize-handles";

    const handlePositions = ["nw", "n", "ne", "w", "e", "sw", "s", "se"];
    handlePositions.forEach((pos) => {
        const h = document.createElement("div");
        h.className = `resize-handle handle-${pos}`;
        h.dataset.handle = pos;
        if (RESIZE_HANDLE_ICONS[pos]) {
            h.innerHTML = RESIZE_HANDLE_ICONS[pos];
        }
        attachHandleEvents(h, pos, widget, container);
        wrapper.appendChild(h);
    });

    widget.appendChild(wrapper);
}

function removeResizeHandles(container) {
    container.querySelectorAll(".widget-resize-handles").forEach((el) => el.remove());
}

function attachHandleEvents(handleEl, handleType, widget, container) {
    const onStart = (clientX, clientY, e) => {
        if (!isEditMode) return;
        e.stopPropagation();
        e.preventDefault();

        widget.classList.add("resizing");
        handleEl.classList.add("active");

        const startMouseX = clientX;
        const startMouseY = clientY;

        const startW = widget.offsetWidth;
        const startH = widget.offsetHeight;

        const startX = parseFloat(widget.dataset.x || "0");
        const startY = parseFloat(widget.dataset.y || "0");

        const ax = parseFloat(widget.dataset.ax || "50");
        const ay = parseFloat(widget.dataset.ay || "50");

        const cWidth = container.clientWidth;
        const cHeight = container.clientHeight;

        const anchorPxX = (cWidth * ax) / 100;
        const anchorPxY = (cHeight * ay) / 100;

        const initialLeft = anchorPxX - (startW * ax) / 100 + startX;
        const initialRight = initialLeft + startW;

        const initialTop = anchorPxY - (startH * ay) / 100 + startY;
        const initialBottom = initialTop + startH;

        const step = 10; // 1 ô = 10px

        const onMove = (moveEvent) => {
            const currentX = moveEvent.clientX ?? moveEvent.touches?.[0]?.clientX;
            const currentY = moveEvent.clientY ?? moveEvent.touches?.[0]?.clientY;
            if (currentX === undefined || currentY === undefined) return;

            const rawDx = currentX - startMouseX;
            const rawDy = currentY - startMouseY;

            let newW = startW;
            let newX = startX;
            let newH = startH;
            let newY = startY;

            // Horizontal resize có chặn biên container
            if (handleType.includes("e")) {
                const maxW = Math.max(20, Math.floor((cWidth - initialLeft) / step) * step);
                const dx = Math.round(rawDx / step) * step;
                newW = Math.min(maxW, Math.max(20, startW + dx));
                const actualDeltaW = newW - startW;
                newX = startX + (ax / 100) * actualDeltaW;
            } else if (handleType.includes("w")) {
                const maxW = Math.max(20, Math.floor(initialRight / step) * step);
                const dx = Math.round(rawDx / step) * step;
                newW = Math.min(maxW, Math.max(20, startW - dx));
                const actualDeltaW = newW - startW;
                newX = startX - (1 - ax / 100) * actualDeltaW;
            }

            // Vertical resize có chặn biên container
            if (handleType.includes("s")) {
                const maxH = Math.max(20, Math.floor((cHeight - initialTop) / step) * step);
                const dy = Math.round(rawDy / step) * step;
                newH = Math.min(maxH, Math.max(20, startH + dy));
                const actualDeltaH = newH - startH;
                newY = startY + (ay / 100) * actualDeltaH;
            } else if (handleType.includes("n")) {
                const maxH = Math.max(20, Math.floor(initialBottom / step) * step);
                const dy = Math.round(rawDy / step) * step;
                newH = Math.min(maxH, Math.max(20, startH - dy));
                const actualDeltaH = newH - startH;
                newY = startY - (1 - ay / 100) * actualDeltaH;
            }

            widget.style.width = `${newW}px`;
            widget.style.height = `${newH}px`;
            widget.dataset.w = newW;
            widget.dataset.h = newH;
            widget.dataset.x = newX;
            widget.dataset.y = newY;

            widget.style.transform = `translate(calc(-${ax}% + ${newX}px), calc(-${ay}% + ${newY}px))`;
            isWidgetDragDirty = true;
        };

        const onEnd = () => {
            widget.classList.remove("resizing");
            handleEl.classList.remove("active");
            window.removeEventListener("mousemove", onMove);
            window.removeEventListener("mouseup", onEnd);
            window.removeEventListener("touchmove", onMove);
            window.removeEventListener("touchend", onEnd);
        };

        window.addEventListener("mousemove", onMove);
        window.addEventListener("mouseup", onEnd);
        window.addEventListener("touchmove", onMove, { passive: false });
        window.addEventListener("touchend", onEnd);
    };

    handleEl.addEventListener("mousedown", (e) => {
        if (e.button !== 0) return;
        onStart(e.clientX, e.clientY, e);
    });

    handleEl.addEventListener("touchstart", (e) => {
        const touch = e.touches[0];
        onStart(touch.clientX, touch.clientY, e);
    });
}

function startEditMode() {
    if (isEditMode) return;
    const container = document.getElementById("widgets_container");
    if (!container) return;

    originalPositions = [];
    const widgets = container.querySelectorAll(".widget");

    widgets.forEach((w) => {
        originalPositions.push({
            element: w,
            ax: w.dataset.ax,
            ay: w.dataset.ay,
            x: w.dataset.x,
            y: w.dataset.y,
            w: w.dataset.w,
            h: w.dataset.h
        });
        createResizeHandles(w, container);
    });

    isWidgetDragDirty = false;
    isEditMode = true;
    container.classList.add("edit-mode");
    anchorIndicators = createAnchorIndicators(container);

    // Hide settings panel during edit mode
    document.querySelector("#setting_wrapper")?.classList.add("preview_active");
    document.querySelector("#action_buttons")?.classList.add("preview_active");
    document.querySelector("#setting_toggle_btn")?.classList.add("preview_active");

    // Create lightweight floating action bar with only Cancel and Save buttons
    const bar = document.createElement("div");
    bar.className = "edit_floating_bar";
    bar.id = "widget_edit_bar";
    bar.innerHTML = `
        <button id="edit_cancel_btn">
            <i data-icon="close"></i>
            <span>${t("sp.widgets.edit_cancel", "Hủy")}</span>
        </button>
        <button id="edit_save_btn">
            <i data-icon="particleCheck"></i>
            <span>${t("sp.widgets.edit_save", "Lưu")}</span>
        </button>
    `;
    renderIcons(bar);

    bar.querySelector("#edit_cancel_btn")?.addEventListener("click", () => {
        if (isWidgetDragDirty && !canExit) {
            showNotification(t("common.unsaved_changes", "Thay đổi chưa được lưu. Nhấn lần nữa để hủy."), "warning");
            canExit = true;
            if (exitTimer) clearTimeout(exitTimer);
            exitTimer = setTimeout(() => { canExit = false; }, 4000);
            return;
        }

        // Revert positions and dimensions
        originalPositions.forEach((pos) => {
            if (pos.ax !== undefined) {
                applyWidgetPositionStyles(pos.element, {
                    ax: parseFloat(pos.ax),
                    ay: parseFloat(pos.ay),
                    x: parseFloat(pos.x),
                    y: parseFloat(pos.y),
                    w: pos.w ? parseInt(pos.w) : null,
                    h: pos.h ? parseInt(pos.h) : null
                });
            }
            if (!pos.w) {
                delete pos.element.dataset.w;
                pos.element.style.width = 'max-content';
            }
            if (!pos.h) {
                delete pos.element.dataset.h;
                pos.element.style.height = 'max-content';
            }
            pos.element.classList.remove("selected", "dragging", "resizing");
        });

        exitMode();
    });

    bar.querySelector("#edit_save_btn")?.addEventListener("click", () => {
        const newWidgets = { ...getSettings().widgets };
        const widgetsDOM = container.querySelectorAll(".widget");

        widgetsDOM.forEach((w) => {
            if (w.dataset.ax !== undefined) {
                const type = w.id.replace("widget-", "");
                newWidgets[type] = {
                    ...newWidgets[type],
                    position: {
                        ax: parseFloat(w.dataset.ax),
                        ay: parseFloat(w.dataset.ay),
                        x: parseFloat(w.dataset.x),
                        y: parseFloat(w.dataset.y),
                        w: w.dataset.w ? parseInt(w.dataset.w, 10) : null,
                        h: w.dataset.h ? parseInt(w.dataset.h, 10) : null
                    }
                };
            }
            w.classList.remove("selected", "dragging", "resizing");
        });

        saveSettings({ widgets: newWidgets });
        showNotification(t("common.saved_changes", "Đã lưu thay đổi"), "success");
        exitMode();
    });

    document.body.appendChild(bar);
    floatingBar = bar;
}

function exitMode() {
    isEditMode = false;
    const container = document.getElementById("widgets_container");
    if (container) {
        container.classList.remove("edit-mode");
        removeResizeHandles(container);
    }
    removeAnchorIndicators();
    if (anchorMenuEl) {
        anchorMenuEl.classList.remove("visible");
        targetWidgetForAnchor = null;
    }

    if (floatingBar) {
        floatingBar.classList.add("closing");
        const barToRemove = floatingBar;
        floatingBar = null;
        setTimeout(() => barToRemove.remove(), 260);
    }

    // Restore settings panel
    document.querySelector("#setting_wrapper")?.classList.remove("preview_active");
    document.querySelector("#action_buttons")?.classList.remove("preview_active");
    document.querySelector("#setting_toggle_btn")?.classList.remove("preview_active");
}
