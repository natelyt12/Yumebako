import { renderIcons } from "/src/core/icon.js";
import { t, translateDOM } from "/src/core/i18n.js";

let currentZIndex = 50;

// Track the most recent user click position to anchor popups contextually
let lastPointerPos = null;
if (typeof window !== "undefined") {
    window.addEventListener("pointerdown", (e) => {
        if (e.clientX !== undefined && e.clientY !== undefined) {
            lastPointerPos = { x: e.clientX, y: e.clientY };
        }
    }, { capture: true, passive: true });
}

/**
 * Opens a popup modal positioned contextually near the cursor, anchored to a button/element, or centered in the viewport.
 * Features automatic edge-clamping to prevent overflowing off-screen.
 * 
 * @param {string} title - Header title text.
 * @param {HTMLElement} contentNode - Body content element.
 * @param {string} [width="400px"] - Popup width (CSS string).
 * @param {Object|HTMLElement|string} [options={}] - Configuration options or anchor element/placement string.
 * @param {boolean} [options.canClose=true] - Whether to show the close button and allow backdrop/Escape closing.
 * @param {HTMLElement|string|Event|{x: number, y: number}} [options.anchor=null] - Anchor button/element, click event, or coordinates.
 * @param {"top-left"|"top-right"|"bottom-left"|"bottom-right"} [options.placement="bottom-left"] - Placement relative to anchor element edges.
 * @param {number} [options.offset=8] - Distance in pixels between anchor element and popup.
 * @param {Function} [options.onClose=null] - Callback triggered when popup closes.
 * @param {string} [placementArg=null] - Optional placement if passed as a separate argument.
 * @returns {{ closeBtn: HTMLElement|null, popupSection: HTMLElement, popupWrapper: HTMLElement, closePopup: Function }}
 */
export function openCustomPopup(title, contentNode, width = "400px", options = {}, placementArg = null) {
    let opts = options;
    if (opts instanceof Element || (opts && opts.nodeType === 1)) {
        opts = { anchor: opts, placement: typeof placementArg === "string" ? placementArg : "bottom-left" };
    } else if (typeof opts === "string") {
        opts = { placement: opts };
    }

    const {
        canClose = true,
        anchor = null,
        placement = placementArg || "bottom-left",
        offset = 8,
        onClose = null
    } = opts || {};

    const popupWrapper = document.createElement("div");
    popupWrapper.className = "popup_section_wrapper";
    popupWrapper.style.zIndex = ++currentZIndex;

    const popupSection = document.createElement("div");
    popupSection.className = "popup_section";
    popupSection.style.width = width;

    // Header with title and close button
    const popupHeader = document.createElement("div");
    popupHeader.className = "popup_header";

    const titleText = document.createElement("span");
    titleText.innerText = title;
    popupHeader.appendChild(titleText);

    let popupClose = null;
    if (canClose) {
        popupClose = document.createElement("button");
        popupClose.className = "popup_close";
        popupClose.innerHTML = `
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>`;
        popupHeader.appendChild(popupClose);
    }

    // Content container
    const popupContent = document.createElement("div");
    popupContent.className = "popup_content";
    if (contentNode) popupContent.appendChild(contentNode);

    popupSection.append(popupHeader, popupContent);
    popupWrapper.appendChild(popupSection);
    document.body.appendChild(popupWrapper);

    // Contextual positioning: anchor to element edges, click position, or viewport center
    const rawAnchor = anchor || opts?.anchorPos || opts?.anchorEvent || lastPointerPos;

    let anchorEl = null;
    if (rawAnchor instanceof Element || (rawAnchor && rawAnchor.nodeType === 1)) {
        anchorEl = rawAnchor.closest("button, [role='button'], .icon_button, .dropdown_button, .submenu_button, a, label, .setting_section") || rawAnchor;
    } else if (typeof rawAnchor === "string" && rawAnchor.trim().length > 0) {
        anchorEl = document.querySelector(rawAnchor);
    } else if (rawAnchor && (rawAnchor.currentTarget || rawAnchor.target)) {
        const rawTarget = (rawAnchor.currentTarget instanceof Element ? rawAnchor.currentTarget : null) || 
                          (rawAnchor.target instanceof Element ? rawAnchor.target : null);
        if (rawTarget) {
            anchorEl = rawTarget.closest("button, [role='button'], .icon_button, .dropdown_button, .submenu_button, a, label, .setting_section") || rawTarget;
        }
    }

    // Viewport dimensions excluding scrollbars
    const vw = document.documentElement.clientWidth || window.innerWidth;
    const vh = document.documentElement.clientHeight || window.innerHeight;

    // Use unscaled offsetWidth / offsetHeight to avoid animation scale interference
    const popupW = popupSection.offsetWidth || parseInt(width, 10) || 380;
    const popupH = popupSection.offsetHeight || 220;
    const margin = 16;

    let left = 0;
    let top = 0;

    if (anchorEl) {
        const rect = anchorEl.getBoundingClientRect();
        let normalizedPlacement = (opts?.placement || placement || "").toLowerCase().trim();
        const offsetVal = typeof offset === "number" ? offset : 8;

        // Auto-detect optimal edge placement if not explicitly specified
        if (!normalizedPlacement) {
            const isRightSide = (rect.left + rect.width / 2) > (vw / 2);
            const isBottomSide = (rect.top + rect.height / 2) > (vh / 2);
            normalizedPlacement = `${isBottomSide ? "top" : "bottom"}-${isRightSide ? "right" : "left"}`;
        }

        let isTop = normalizedPlacement.startsWith("top") || normalizedPlacement.startsWith("t");
        let isRight = normalizedPlacement.endsWith("right") || normalizedPlacement.endsWith("end") || normalizedPlacement === "tr" || normalizedPlacement === "br";

        // Vertical calculation with overflow flip
        let tentativeTop = isTop ? (rect.top - popupH - offsetVal) : (rect.bottom + offsetVal);
        if (isTop && tentativeTop < margin && (rect.bottom + offsetVal + popupH <= vh - margin)) {
            isTop = false;
            tentativeTop = rect.bottom + offsetVal;
        } else if (!isTop && (tentativeTop + popupH > vh - margin) && (rect.top - popupH - offsetVal >= margin)) {
            isTop = true;
            tentativeTop = rect.top - popupH - offsetVal;
        }
        top = tentativeTop;

        // Horizontal calculation with overflow flip
        let tentativeLeft = isRight ? (rect.right - popupW) : rect.left;
        if (isRight && tentativeLeft < margin && (rect.left + popupW <= vw - margin)) {
            isRight = false;
            tentativeLeft = rect.left;
        } else if (!isRight && (tentativeLeft + popupW > vw - margin) && (rect.right - popupW >= margin)) {
            isRight = true;
            tentativeLeft = rect.right - popupW;
        }
        left = tentativeLeft;
    } else {
        const anchorPoint = rawAnchor?.clientX !== undefined 
            ? { x: rawAnchor.clientX, y: rawAnchor.clientY } 
            : (rawAnchor?.x !== undefined ? rawAnchor : null);

        const targetX = anchorPoint?.x !== undefined ? anchorPoint.x : (vw / 2);
        const targetY = anchorPoint?.y !== undefined ? anchorPoint.y : (vh / 2);

        left = targetX - (popupW / 2);
        top = targetY - (popupH / 2);
    }

    // Strict viewport clamping (never overflow edges)
    const maxLeft = Math.max(margin, vw - popupW - margin);
    const maxTop = Math.max(margin, vh - popupH - margin);

    left = Math.max(margin, Math.min(maxLeft, left));
    top = Math.max(margin, Math.min(maxTop, top));

    popupSection.style.left = `${Math.round(left)}px`;
    popupSection.style.top = `${Math.round(top)}px`;

    let isClosed = false;
    const closePopup = () => {
        if (isClosed) return;
        isClosed = true;

        popupWrapper.classList.add("popup_closing");
        popupWrapper.style.pointerEvents = "none";

        document.removeEventListener("keydown", onKeyDown);

        if (typeof onClose === "function") {
            onClose();
        }

        setTimeout(() => {
            popupWrapper.remove();
        }, 260);
    };

    // Close on Escape key
    const onKeyDown = (e) => {
        if (e.key === "Escape" && canClose) {
            e.preventDefault();
            closePopup();
        }
    };
    document.addEventListener("keydown", onKeyDown);

    // Close on clicking backdrop
    if (canClose) {
        popupWrapper.addEventListener("mousedown", (e) => {
            if (e.target === popupWrapper) {
                closePopup();
            }
        });
    }

    if (popupClose) {
        popupClose.addEventListener("click", () => {
            const beforeCloseEvent = new CustomEvent("popupBeforeClose", { cancelable: true });
            popupClose.dispatchEvent(beforeCloseEvent);
            if (!beforeCloseEvent.defaultPrevented) {
                closePopup();
            }
        });
    }

    translateDOM(popupSection);
    renderIcons(popupSection);

    requestAnimationFrame(() => {
        popupWrapper.classList.add("popup_opened");
    });

    return { closeBtn: popupClose, popupSection, popupWrapper, closePopup };
}

/**
 * Displays a lightweight confirmation dialog with Promise support.
 * 
 * @param {string} msg - Message description text.
 * @param {Object} [options={}] - Dialog options.
 * @param {string} [options.title] - Dialog title.
 * @param {string} [options.okText] - Confirm button label.
 * @param {string} [options.cancelText] - Cancel button label.
 * @param {boolean} [options.isDanger=false] - Whether this is a destructive action (styles confirm button with .danger_btn).
 * @param {string} [options.width="380px"] - Dialog width.
 * @param {HTMLElement|string|Event|{x: number, y: number}} [options.anchor=null] - Anchor button/element or coordinates.
 * @param {"top-left"|"top-right"|"bottom-left"|"bottom-right"} [options.placement="bottom-left"] - Placement relative to anchor element.
 * @param {number} [options.offset=8] - Distance in pixels between anchor element and dialog.
 * @returns {Promise<boolean>} Resolves to true if confirmed, false otherwise.
 */
export function showConfirm(msg, options = {}) {
    const {
        title = t("common.confirm", "Xác nhận"),
        okText = t("common.confirm", "Đồng ý"),
        cancelText = t("common.cancel", "Hủy"),
        isDanger = false,
        width = "380px",
        anchor = null,
        placement = "bottom-left",
        offset = 8
    } = options;

    return new Promise((resolve) => {
        const body = document.createElement("div");
        body.className = "popup_body";
        body.innerHTML = `
            <p class="popup_desc">${msg}</p>
            <div class="actions">
                <button id="confirm_cancel_btn" class="secondary">${cancelText}</button>
                <button id="confirm_ok_btn" class="${isDanger ? "danger_btn" : "primary"}">${okText}</button>
            </div>
        `;

        let resolved = false;
        const finish = (val) => {
            if (resolved) return;
            resolved = true;
            popup.closePopup();
            resolve(val);
        };

        const popup = openCustomPopup(title, body, width, {
            canClose: true,
            anchor,
            placement,
            offset,
            onClose: () => {
                if (!resolved) {
                    resolved = true;
                    resolve(false);
                }
            }
        });

        body.querySelector("#confirm_cancel_btn")?.addEventListener("click", () => finish(false));
        body.querySelector("#confirm_ok_btn")?.addEventListener("click", () => finish(true));
    });
}

/**
 * Creates a confirmation dialog body with backward-compatible interface.
 * 
 * @param {string} msg - The message to display.
 * @param {Function} onConfirm - Callback executed when the OK button is clicked.
 * @param {Object} [options={}] - Options: okText, cancelText, isDanger, okClass, cancelClass, hideCancel, onCancel.
 * @returns {{ container: HTMLElement, setCloseHandler: Function }}
 */
export function createConfirmDialog(msg, onConfirm, options = {}) {
    const {
        okText = t("common.confirm", "Đồng ý"),
        cancelText = t("common.cancel", "Hủy"),
        isDanger = false,
        okClass = isDanger ? "danger_btn" : "primary",
        cancelClass = "secondary",
        hideCancel = false,
        onCancel = null
    } = options;

    const container = document.createElement("div");
    container.className = "popup_body";
    container.innerHTML = `
        <p class="popup_desc">${msg}</p>
        <div class="actions">
            ${hideCancel ? "" : `<button id="confirm_cancel_btn" class="${cancelClass}">${cancelText}</button>`}
            <button id="confirm_ok_btn" class="${okClass}">${okText}</button>
        </div>
    `;

    let closeHandler = null;

    if (!hideCancel) {
        container.querySelector("#confirm_cancel_btn")?.addEventListener("click", async () => {
            let shouldClose = true;
            if (onCancel) {
                const res = await onCancel();
                if (res === false) shouldClose = false;
            }
            if (shouldClose && closeHandler) closeHandler();
        });
    }

    container.querySelector("#confirm_ok_btn")?.addEventListener("click", async () => {
        let shouldClose = true;
        if (onConfirm) {
            const res = await onConfirm();
            if (res === false) shouldClose = false;
        }
        if (shouldClose && closeHandler) closeHandler();
    });

    return {
        container,
        setCloseHandler: (fn) => { closeHandler = fn; }
    };
}
