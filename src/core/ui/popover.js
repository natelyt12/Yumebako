import "./popover.css";

/**
 * popover.js
 * ---------------------------------------------------------------------------
 * Generic Blank Canvas Popover component.
 *
 * Provides a clean glassmorphism container that snaps directly to any trigger
 * element. No built-in title, header, or close buttons.
 */

// Active popover instances currently open on page
const activePopovers = new Set();

// Global click-outside listener
let isGlobalListenerBound = false;

function bindGlobalListeners() {
    if (isGlobalListenerBound) return;
    isGlobalListenerBound = true;

    document.addEventListener("pointerdown", (e) => {
        if (activePopovers.size === 0) return;
        const target = e.target;

        activePopovers.forEach((instance) => {
            // Don't close if clicking inside a portaled dropdown belonging to an element inside this popover
            const portaledDropdown = target.closest?.(".dropdown");
            if (portaledDropdown && portaledDropdown._controlBtn && instance.panel.contains(portaledDropdown._controlBtn)) {
                return;
            }

            // Dialog xác nhận (vd. reset về mặc định) mở đè lên popover: click trong
            // dialog không được tính là click ra ngoài, nếu không popover đóng mất
            // và thao tác vừa xác nhận sẽ không thấy được.
            if (target.closest?.(".dialog_root") || target.closest?.(".notification_container")) {
                return;
            }

            if (
                instance.isOpen &&
                !instance.panel.contains(target) &&
                !instance.trigger.contains(target)
            ) {
                instance.close();
            }
        });
    });

    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && activePopovers.size > 0) {
            // Close the most recently opened popover
            const last = Array.from(activePopovers).pop();
            if (last) {
                e.stopPropagation();
                last.close();
            }
        }
    });

    window.addEventListener(
        "scroll",
        (e) => {
            if (activePopovers.size === 0) return;
            const target = e.target;
            // Don't close if scrolling inside an active popover panel or an open dropdown
            if (target?.closest?.(".popover_panel, .dropdown")) return;
            activePopovers.forEach((instance) => instance.close());
        },
        true
    );

    window.addEventListener("resize", () => {
        if (activePopovers.size === 0) return;
        activePopovers.forEach((instance) => instance.close());
    });
}

// Mirrors the `.popover_panel.closing` height transition (0.26s) in popover.css.
const CLOSE_ANIM_MS = 300;

export function ensurePopoverInner(panel) {
    let inner = panel.querySelector(":scope > .popover_inner");
    if (!inner) {
        inner = document.createElement("div");
        inner.className = "popover_inner";
        while (panel.firstChild) {
            inner.appendChild(panel.firstChild);
        }
        panel.appendChild(inner);
    } else {
        const nonInnerChildren = Array.from(panel.childNodes).filter((node) => node !== inner);
        if (nonInnerChildren.length > 0) {
            nonInnerChildren.forEach((child) => inner.appendChild(child));
        }
    }
    return inner;
}

/**
 * Creates and binds a Popover instance to a trigger element.
 *
 * @param {Object} options
 * @param {HTMLElement} options.trigger - Any button or element to anchor and toggle.
 * @param {HTMLElement|string} [options.content] - Any element or HTML string.
 * @param {"up"|"down"} [options.placement="up"] - Direction to expand relative to trigger.
 * @param {"end"|"start"|"center"} [options.align="end"] - Horizontal alignment.
 * @param {string} [options.className=""] - Optional extra class for the popover panel.
 * @param {Function} [options.onOpen] - Callback when popover opens.
 * @param {Function} [options.onClose] - Callback when popover closes.
 * @param {boolean} [options.manualTrigger=false] - Whether trigger click listener is handled manually outside.
 * @returns {Object} Popover control interface.
 */
export function createPopover({
    trigger,
    content = null,
    placement = "up",
    align = "end",
    className = "",
    onOpen = null,
    onClose = null,
    manualTrigger = false,
} = {}) {
    if (!trigger) {
        throw new Error("[createPopover] A trigger element is required.");
    }

    bindGlobalListeners();

    // 1. Ensure wrapper exists
    let wrapper = trigger.closest(".popover_wrapper");
    if (!wrapper) {
        wrapper = document.createElement("div");
        wrapper.className = "popover_wrapper";
        trigger.parentNode?.insertBefore(wrapper, trigger);
        wrapper.appendChild(trigger);
    }

    // 2. Create popover panel
    const panel = document.createElement("div");
    panel.className = `popover_panel${className ? ` ${className}` : ""}`;
    panel.setAttribute("role", "dialog");
    panel.setAttribute("data-placement", placement);
    panel.setAttribute("data-align", align);

    // Accessibility on trigger
    trigger.setAttribute("aria-haspopup", "dialog");
    trigger.setAttribute("aria-expanded", "false");

    const inner = document.createElement("div");
    inner.className = "popover_inner";

    if (content) {
        if (typeof content === "string") {
            inner.innerHTML = content;
        } else if (content instanceof HTMLElement) {
            inner.appendChild(content);
        }
    }

    panel.appendChild(inner);
    wrapper.appendChild(panel);

    const instance = {
        trigger,
        panel,
        wrapper,

        get isOpen() {
            return panel.classList.contains("is-open") && !panel.classList.contains("closing");
        },

        open() {
            if (this.isOpen) return;

            // Close other open popovers
            activePopovers.forEach((p) => {
                if (p !== this) p.close();
            });

            if (typeof onOpen === "function") {
                onOpen(this);
            }

            clearTimeout(panel._closeTimer);
            const inner = ensurePopoverInner(panel);

            // Portal to document.body to break free from ancestor Backdrop Roots and overflow clipping
            if (panel.parentElement !== document.body) {
                panel._placeholder = document.createComment("popover-portal-placeholder");
                panel.parentElement?.insertBefore(panel._placeholder, panel);
                document.body.appendChild(panel);
            }

            const rect = trigger.getBoundingClientRect();
            const gap = 8;
            const padding = 8;

            // Measure natural dimensions of inner content without restriction
            inner.style.position = "static";
            panel.style.transition = "none";
            panel.style.height = "auto";
            panel.style.maxHeight = "none";
            panel.style.overflow = "hidden";
            panel.style.visibility = "hidden";
            panel.style.width = "auto";

            const naturalHeight = panel.offsetHeight || inner.offsetHeight || 200;
            const naturalWidth = Math.min(panel.offsetWidth || inner.offsetWidth || 380, window.innerWidth - 32);

            const spaceAbove = rect.top - gap - padding;
            const spaceBelow = window.innerHeight - rect.bottom - gap - padding;
            const available = Math.max(120, placement === "up" ? spaceAbove : spaceBelow);
            const targetHeight = Math.min(naturalHeight, available);

            // Anchor inner content to the moving edge so it slides with the frame
            inner.style.position = "absolute";
            if (placement === "up") {
                inner.style.bottom = "auto";
                inner.style.top = "0";
            } else {
                inner.style.top = "auto";
                inner.style.bottom = "0";
            }

            // Set initial 0 height and layout coordinates with transition disabled
            panel.style.height = "0px";
            panel.style.width = `${Math.round(naturalWidth)}px`;
            panel.classList.remove("closing");

            panel.style.position = "fixed";

            if (placement === "up") {
                panel.style.bottom = `${Math.round(window.innerHeight - rect.top + gap)}px`;
                panel.style.top = "auto";
            } else {
                panel.style.top = `${Math.round(rect.bottom + gap)}px`;
                panel.style.bottom = "auto";
            }

            if (align === "end") {
                panel.style.right = `${Math.round(window.innerWidth - rect.right)}px`;
                panel.style.left = "auto";
            } else if (align === "start") {
                panel.style.left = `${Math.round(rect.left)}px`;
                panel.style.right = "auto";
            } else {
                panel.style.left = `${Math.round(rect.left + rect.width / 2)}px`;
                panel.style.right = "auto";
            }

            // Commit initial height = 0 in a single reflow
            panel.offsetHeight;

            // Restore transition and trigger opening on next paint frame
            panel.style.removeProperty("transition");
            panel.style.removeProperty("visibility");

            panel.classList.add("is-open");
            trigger.classList.add("popover_active");
            trigger.setAttribute("aria-expanded", "true");
            activePopovers.add(this);

            requestAnimationFrame(() => {
                if (panel.classList.contains("is-open") && !panel.classList.contains("closing")) {
                    panel.style.height = `${targetHeight}px`;

                    clearTimeout(panel._overflowTimer);
                    panel._overflowTimer = setTimeout(() => {
                        if (panel.classList.contains("is-open") && !panel.classList.contains("closing")) {
                            if (naturalHeight > available) {
                                panel.style.overflowY = "auto";
                            } else {
                                panel.style.height = "auto";
                            }
                            inner.style.position = "static";
                        }
                    }, 360);
                }
            });
        },

        close() {
            if (!this.isOpen && !panel.classList.contains("closing")) return;

            clearTimeout(panel._overflowTimer);
            clearTimeout(panel._closeTimer);
            const inner = ensurePopoverInner(panel);

            // Lock current height so transition from current height to 0 works
            const currentHeight = panel.offsetHeight;
            panel.style.transition = "none";
            panel.style.height = `${currentHeight}px`;

            inner.style.position = "absolute";
            if (placement === "up") {
                inner.style.top = "0";
                inner.style.bottom = "auto";
            } else {
                inner.style.bottom = "0";
                inner.style.top = "auto";
            }

            panel.style.overflow = "hidden";
            panel.offsetHeight;

            panel.style.removeProperty("transition");
            panel.classList.remove("is-open");
            panel.classList.add("closing");
            panel.style.height = "0px";

            trigger.classList.remove("popover_active");
            trigger.setAttribute("aria-expanded", "false");
            activePopovers.delete(this);

            panel._closeTimer = setTimeout(() => {
                if (!panel.classList.contains("is-open")) {
                    panel.classList.remove("closing");

                    if (panel._placeholder && panel._placeholder.parentNode) {
                        panel._placeholder.parentNode.insertBefore(panel, panel._placeholder);
                        panel._placeholder.remove();
                        panel._placeholder = null;
                    }
                    panel.style.removeProperty("position");
                    panel.style.removeProperty("top");
                    panel.style.removeProperty("bottom");
                    panel.style.removeProperty("left");
                    panel.style.removeProperty("right");
                    panel.style.removeProperty("width");
                    panel.style.removeProperty("height");
                    panel.style.removeProperty("overflow");
                    panel.style.removeProperty("overflow-y");
                    if (inner) {
                        inner.style.removeProperty("position");
                        inner.style.removeProperty("top");
                        inner.style.removeProperty("bottom");
                    }
                }
            }, CLOSE_ANIM_MS);

            if (typeof onClose === "function") {
                onClose(this);
            }
        },

        toggle() {
            if (this.isOpen) {
                this.close();
            } else {
                this.open();
            }
        },

        setContent(newContent) {
            const inner = ensurePopoverInner(panel);
            inner.innerHTML = "";
            if (typeof newContent === "string") {
                inner.innerHTML = newContent;
            } else if (newContent instanceof HTMLElement) {
                inner.appendChild(newContent);
            }
        },

        destroy() {
            this.close();
            if (!manualTrigger) {
                trigger.removeEventListener("click", handleTriggerClick);
            }
            trigger.removeAttribute("aria-haspopup");
            trigger.removeAttribute("aria-expanded");
            panel.remove();
            activePopovers.delete(this);
        },
    };

    const handleTriggerClick = (e) => {
        e.stopPropagation();
        instance.toggle();
    };

    if (!manualTrigger) {
        trigger.addEventListener("click", handleTriggerClick);
    }

    return instance;
}

