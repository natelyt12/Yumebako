import { getSettings } from "/src/core/storageHandler.js";
import { renderIcons } from "/src/core/icon.js";
import { translateDOM, t } from "/src/core/i18n.js";
import { showNotification } from "/src/core/ui/notification.js";
import { initSubsectionSvg } from "/src/core/ui/dropdown.js";

/** Must stay in sync with `--settings-motion` (styles/settings_wrapper.css). */
const SUBMENU_TRANSITION_MS = 800;

let activeSubmenuState = {
    isDirty: false,
    canExit: false,
    exitTimer: null,
    cleanupTimer: null,
    onBeforeClose: null,
    onCancel: null
};

/**
 * Manually set or update the dirty state of the currently active submenu.
 * @param {boolean} isDirty - Whether there are unsaved changes.
 */
export function setSubmenuDirty(isDirty = true) {
    activeSubmenuState.isDirty = isDirty;
    if (!isDirty && activeSubmenuState.exitTimer) {
        clearTimeout(activeSubmenuState.exitTimer);
        activeSubmenuState.canExit = false;
        activeSubmenuState.exitTimer = null;
    }
    updateSubmenuDirtyUI();
}

/**
 * Update the visual dirty dot indicator in the submenu header.
 */
export function updateSubmenuDirtyUI() {
    const dot = document.getElementById("submenu_dirty_dot");
    if (!dot) return;

    let isDirty = false;
    if (typeof activeSubmenuState.isDirty === "function") {
        try {
            isDirty = Boolean(activeSubmenuState.isDirty());
        } catch (err) {
            isDirty = false;
        }
    } else {
        isDirty = Boolean(activeSubmenuState.isDirty);
    }

    dot.style.display = isDirty ? "inline-block" : "none";
}

export function initToggleSettingBtn() {
    const settingToggleBtn = document.getElementById("setting_toggle_btn");
    const settingCloseBtn = document.getElementById("setting_close_btn");
    const settingWrapper = document.getElementById("setting_wrapper");

    if (!settingToggleBtn || !settingWrapper) return;


    const setOpenState = (isOpen) => {
        if (isOpen) {
            settingWrapper.classList.add("setting_wrapper_opened");
            settingToggleBtn.classList.add("setting_toggle_btn_opened");
            settingToggleBtn.classList.remove("toggle_hidden");
        } else {
            settingWrapper.classList.remove("setting_wrapper_opened");
            settingToggleBtn.classList.remove("setting_toggle_btn_opened");
            const isDim = getSettings().hideToggleButton !== false;
            if (isDim) {
                settingToggleBtn.classList.add("toggle_hidden");
            } else {
                settingToggleBtn.classList.remove("toggle_hidden");
            }
        }
    };

    settingToggleBtn.addEventListener("mousedown", () => {
        const isOpen = settingWrapper.classList.contains("setting_wrapper_opened");
        if (!isOpen) {
            setOpenState(true);
        }
    });

    if (settingCloseBtn) {
        settingCloseBtn.addEventListener("mousedown", () => {
            setOpenState(false);
        });
    }
}

/**
 * Open a level-2 Submenu as a floating panel next to the settings nav.
 * While it is open, the nav swaps its tab list for the back / preview actions.
 * @param {string} title - Accessible name for the panel (it has no visible header).
 * @param {HTMLElement|string} contentNode - Content node or HTML string.
 * @param {Object} [options] - Options:
 *   - width {string|number}: Custom width for the floating panel.
 *   - isFullScreen {boolean}: Let the panel fill the viewport (minus margins).
 *   - canPreview {boolean}: Show the hold-to-preview eye button in the nav.
 *   - isDirty {boolean|Function}: State or checker for unsaved changes.
 *   - onCancel {Function}: Callback executed when leaving without saving.
 *   - onBeforeClose {Function}: Custom guard executed before closing.
 */
export function openSidebarSubmenu(title, contentNode, options = {}) {
    const {
        width = "",
        isFullScreen = false,
        canPreview = false,
        isDirty = false,
        onBeforeClose = null,
        onCancel = null
    } = options;

    if (activeSubmenuState.exitTimer) {
        clearTimeout(activeSubmenuState.exitTimer);
    }
    if (activeSubmenuState.cleanupTimer) {
        clearTimeout(activeSubmenuState.cleanupTimer);
    }
    activeSubmenuState = {
        isDirty,
        canExit: false,
        exitTimer: null,
        cleanupTimer: null,
        onBeforeClose,
        onCancel
    };
    updateSubmenuDirtyUI();

    const wrapper = document.getElementById("setting_wrapper");
    const submenuView = document.querySelector(".settings_submenu_view");
    const backBtn = document.getElementById("submenu_back_btn");

    if (!wrapper || !submenuView) return;

    // The panel has no visible header, so the title only feeds its accessible name.
    submenuView.setAttribute("aria-label", title);

    let submenuBody = submenuView.querySelector(".submenu_body");
    if (!submenuBody) {
        submenuBody = document.createElement("div");
        submenuBody.className = "submenu_body";
        submenuView.appendChild(submenuBody);
    }

    // Clear previous custom content sections inside body
    submenuBody.innerHTML = "";

    // Mount new content directly into submenuBody
    if (typeof contentNode === "string") {
        const temp = document.createElement("div");
        temp.innerHTML = contentNode;
        while (temp.firstChild) {
            submenuBody.appendChild(temp.firstChild);
        }
    } else if (contentNode instanceof Node) {
        submenuBody.appendChild(contentNode);
    }

    if (submenuView) {
        translateDOM(submenuView);
        renderIcons(submenuView);
        initSubsectionSvg(submenuView);
    }

    // Only declare the width the caller asked for: `--submenu-width` clamps it to
    // the viewport and drives both the panel and the wrapper that holds it.
    wrapper.style.removeProperty("--submenu-requested-width");
    if (isFullScreen || width === "100vw" || width === "100%") {
        wrapper.style.setProperty("--submenu-requested-width", "100vw");
    } else if (width) {
        const numericWidth = parseInt(width, 10);
        if (!Number.isNaN(numericWidth) && numericWidth > 0) {
            wrapper.style.setProperty("--submenu-requested-width", `${numericWidth}px`);
        }
    }

    wrapper.classList.toggle("can_preview", canPreview);
    wrapper.classList.add("submenu_active");

    // Replay the content fade-out / fade-in even when one submenu replaces
    // another one while the panel is already open.
    submenuView.classList.remove("show_content");
    void submenuView.offsetWidth; // Force a reflow so the transition restarts.
    submenuView.classList.add("show_content");

    if (backBtn) {
        backBtn.onmousedown = () => attemptCloseSubmenu();
    }
}

let isEyePreviewHolding = false;

// Global hold-to-preview event delegation for eye button
window.addEventListener("pointerdown", (e) => {
    const eyeBtn = e.target.closest("#submenu_eye_btn");
    if (eyeBtn) {
        e.preventDefault();
        const wrapper = document.getElementById("setting_wrapper");
        if (wrapper) {
            isEyePreviewHolding = true;
            wrapper.classList.add("preview_eye_active");
        }
    }
}, { capture: true });

const stopEyePreview = () => {
    if (isEyePreviewHolding) {
        isEyePreviewHolding = false;
        const wrapper = document.getElementById("setting_wrapper");
        if (wrapper) {
            wrapper.classList.remove("preview_eye_active");
        }
    }
};

window.addEventListener("pointerup", stopEyePreview, { capture: true });
window.addEventListener("pointercancel", stopEyePreview, { capture: true });
window.addEventListener("mouseleave", stopEyePreview, { capture: true });

/**
 * Attempt to close the active level-2 Submenu with unsaved changes check.
 * @param {boolean} [force=false] - If true, bypasses unsaved check and closes immediately.
 * @returns {boolean} True if submenu closed or closing initiated, false if blocked by unsaved warning.
 */
export function attemptCloseSubmenu(force = false) {
    if (force) {
        performCloseSubmenu();
        return true;
    }

    let isDirty = false;
    if (typeof activeSubmenuState.isDirty === "function") {
        try {
            isDirty = Boolean(activeSubmenuState.isDirty());
        } catch (err) {
            console.error("Error evaluating submenu isDirty function:", err);
        }
    } else {
        isDirty = Boolean(activeSubmenuState.isDirty);
    }

    if (typeof activeSubmenuState.onBeforeClose === "function") {
        const allowClose = activeSubmenuState.onBeforeClose();
        if (allowClose === false) return false;
    }

    if (isDirty && !activeSubmenuState.canExit) {
        showNotification(t("common.unsaved_changes"), "warning");
        activeSubmenuState.canExit = true;

        if (activeSubmenuState.exitTimer) {
            clearTimeout(activeSubmenuState.exitTimer);
        }
        activeSubmenuState.exitTimer = setTimeout(() => {
            activeSubmenuState.canExit = false;
            activeSubmenuState.exitTimer = null;
        }, 5000);

        return false;
    }

    if (activeSubmenuState.exitTimer) {
        clearTimeout(activeSubmenuState.exitTimer);
        activeSubmenuState.exitTimer = null;
    }

    if (typeof activeSubmenuState.onCancel === "function") {
        try {
            activeSubmenuState.onCancel();
        } catch (err) {
            console.error("Error executing submenu onCancel callback:", err);
        }
    }

    performCloseSubmenu();
    return true;
}

/**
 * Close the level-2 Submenu and slide back to the main menu.
 * @param {boolean} [force=false] - If true, forces closing without unsaved changes warning.
 */
export function closeSidebarSubmenu(force = false) {
    if (!force) {
        return attemptCloseSubmenu(false);
    }
    performCloseSubmenu();
}

function performCloseSubmenu() {
    if (activeSubmenuState.exitTimer) {
        clearTimeout(activeSubmenuState.exitTimer);
        activeSubmenuState.exitTimer = null;
    }
    activeSubmenuState.canExit = false;
    activeSubmenuState.isDirty = false;
    updateSubmenuDirtyUI();

    const wrapper = document.getElementById("setting_wrapper");
    const submenuView = document.querySelector(".settings_submenu_view");

    if (wrapper) {
        wrapper.classList.remove("submenu_active", "can_preview", "preview_eye_active");
    }
    if (submenuView) {
        submenuView.classList.remove("show_content");
    }

    // Release the mounted content once the panel has finished sliding out, so
    // heavy submenus (collection grid, editors) drop their DOM again.
    clearTimeout(activeSubmenuState.cleanupTimer);
    activeSubmenuState.cleanupTimer = setTimeout(() => {
        activeSubmenuState.cleanupTimer = null;
        if (wrapper && wrapper.classList.contains("submenu_active")) return;

        const submenuBody = submenuView?.querySelector(".submenu_body");
        if (submenuBody) submenuBody.innerHTML = "";
        if (wrapper) wrapper.style.removeProperty("--submenu-requested-width");
    }, SUBMENU_TRANSITION_MS);
}
