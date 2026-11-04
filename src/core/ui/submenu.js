import "./submenu.css";
import { getSettings } from "/src/core/storageHandler.js";
import { renderIcons } from "/src/core/icon.js";
import { translateDOM, t } from "/src/core/i18n.js";
import { showNotification } from "/src/core/ui/notification.js";
import { initButtons } from "/src/core/ui/button.js";

/**
 * Cleanup delay for the panel after it slides out. Keep it in sync with the
 * shared motion token `--submenu-motion` (default 0.8s, mapped to
 * `--settings-motion` by the settings panel) in `./submenu.css`.
 */
const SUBMENU_TRANSITION_MS = 800;

/** Allowed slide directions for submenu transitions. */
const VALID_DIRECTIONS = new Set(["right", "left", "bottom", "top"]);

/**
 * Resolve a container target (HTMLElement or selector string), falling back to `#setting_wrapper`.
 * @param {HTMLElement|string|null} [target]
 * @returns {HTMLElement|null}
 */
function resolveContainer(target) {
  if (target instanceof HTMLElement) return target;
  if (typeof target === "string" && target.trim()) {
    return document.querySelector(target);
  }
  return document.getElementById("setting_wrapper");
}

/**
 * Ensure the given container has a submenu view and body element.
 * Automatically creates `<div class="submenu_view"><div class="submenu_body"></div></div>`
 * if the host container does not already provide one in markup.
 *
 * @param {HTMLElement} container
 * @returns {{ submenuView: HTMLElement, submenuBody: HTMLElement }}
 */
function ensureSubmenuDOM(container) {
  let submenuView = container.querySelector(
    ".settings_submenu_view, .submenu_view",
  );

  if (!submenuView) {
    submenuView = document.createElement("div");
    submenuView.className = "submenu_view";
    container.appendChild(submenuView);
  }

  let submenuBody = submenuView.querySelector(".submenu_body");
  if (!submenuBody) {
    submenuBody = document.createElement("div");
    submenuBody.className = "submenu_body";
    submenuView.appendChild(submenuBody);
  }

  return { submenuView, submenuBody };
}

let activeSubmenuState = {
  container: null,
  submenuView: null,
  direction: "right",
  isDirty: false,
  canExit: false,
  exitTimer: null,
  cleanupTimer: null,
  onBeforeClose: null,
  onCancel: null,
  onClose: null,
};

/**
 * Manually set or update the dirty state of the currently active submenu.
 * @param {boolean|Function} isDirty - Whether there are unsaved changes.
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
 * Evaluate whether the active submenu currently has unsaved changes.
 * @returns {boolean}
 */
function evaluateIsDirty() {
  if (typeof activeSubmenuState.isDirty === "function") {
    try {
      return Boolean(activeSubmenuState.isDirty());
    } catch (err) {
      console.error("Error evaluating submenu isDirty function:", err);
      return false;
    }
  }
  return Boolean(activeSubmenuState.isDirty);
}

/**
 * Update the visual dirty dot indicator in the submenu back button.
 */
export function updateSubmenuDirtyUI() {
  const container = activeSubmenuState.container || document;
  const dot =
    container.querySelector(".submenu_dirty_dot") ||
    document.getElementById("submenu_dirty_dot");
  if (!dot) return;

  dot.style.display = evaluateIsDirty() ? "inline-block" : "none";
}

/**
 * Measure the settings navigation main group height for smooth nav morphing.
 */
export function updateNavShift() {
  const navMain = document.getElementById("setting_nav_main");
  const settingsNav = document.querySelector(".settings_nav");
  if (navMain && settingsNav) {
    const gap = parseInt(getComputedStyle(settingsNav).gap, 10) || 8;
    const shiftY = navMain.offsetHeight + gap;
    settingsNav.style.setProperty("--nav-shift-y", `${shiftY}px`);
  }
}

/**
 * Open a reusable Submenu panel inside any target container with configurable slide direction.
 *
 * @param {Object} config
 * @param {string} [config.title=""] - Accessible name for the submenu panel.
 * @param {HTMLElement|string} config.content - Content DOM node or HTML string.
 * @param {HTMLElement|string} [config.container="#setting_wrapper"] - Host container element or selector.
 * @param {"right"|"left"|"bottom"|"top"} [config.direction="right"] - Slide-in direction (parent view recedes in the same motion vector).
 * @param {string|number} [config.width=""] - Custom width for the floating panel.
 * @param {boolean} [config.isFullScreen=false] - Let the panel fill the viewport (minus margins).
 * @param {boolean|Function} [config.isDirty=false] - State or checker for unsaved changes.
 * @param {Function} [config.onCancel=null] - Callback executed when leaving without saving.
 * @param {Function} [config.onBeforeClose=null] - Custom guard executed before closing.
 * @param {Function} [config.onClose=null] - Callback executed every time the panel closes (also on `closeSubmenu(true)`), for host cleanup.
 * @param {HTMLElement|string} [config.backBtn=null] - Custom back button element or selector.
 */
export function openSubmenu(config = {}) {
  const {
    title = "",
    content = "",
    container: containerTarget = null,
    direction = "right",
    width = "",
    isFullScreen = false,
    isDirty = false,
    onBeforeClose = null,
    onCancel = null,
    onClose = null,
    backBtn: customBackBtn = null,
  } = config;

  const container = resolveContainer(containerTarget);
  if (!container) return;

  const normalizedDirection = VALID_DIRECTIONS.has(direction)
    ? direction
    : "right";
  const { submenuView, submenuBody } = ensureSubmenuDOM(container);

  if (activeSubmenuState.exitTimer) {
    clearTimeout(activeSubmenuState.exitTimer);
  }
  if (activeSubmenuState.cleanupTimer) {
    clearTimeout(activeSubmenuState.cleanupTimer);
  }

  activeSubmenuState = {
    container,
    submenuView,
    direction: normalizedDirection,
    isDirty,
    canExit: false,
    exitTimer: null,
    cleanupTimer: null,
    onBeforeClose,
    onCancel,
    onClose,
  };
  updateSubmenuDirtyUI();


  // Clear previous custom content sections inside body
  submenuBody.innerHTML = "";

  // Mount new content directly into submenuBody
  if (typeof content === "string") {
    const temp = document.createElement("div");
    temp.innerHTML = content;
    while (temp.firstChild) {
      submenuBody.appendChild(temp.firstChild);
    }
  } else if (content instanceof Node) {
    submenuBody.appendChild(content);
  }

  translateDOM(submenuView);
  renderIcons(submenuView);
  initButtons(submenuView);

  // Apply requested width
  container.style.removeProperty("--submenu-requested-width");
  if (isFullScreen || width === "100vw" || width === "100%") {
    container.style.setProperty("--submenu-requested-width", "100vw");
  } else if (width) {
    const numericWidth = parseInt(width, 10);
    if (!Number.isNaN(numericWidth) && numericWidth > 0) {
      container.style.setProperty(
        "--submenu-requested-width",
        `${numericWidth}px`,
      );
    }
  }

  // Snap submenuView to its new starting direction without animating across if closed
  const isAlreadyActive = container.classList.contains("submenu_active");
  if (!isAlreadyActive) {
    submenuView.style.transition = "none";
    container.dataset.submenuDirection = normalizedDirection;
    submenuView.dataset.direction = normalizedDirection;
    void submenuView.offsetWidth;
    submenuView.style.removeProperty("transition");
  } else {
    container.dataset.submenuDirection = normalizedDirection;
    submenuView.dataset.direction = normalizedDirection;
  }

  if (container.id === "setting_wrapper") {
    updateNavShift();
  }

  container.classList.add("submenu_active");

  // Replay the content fade-out / fade-in even when one submenu replaces
  // another one while the panel is already open.
  submenuView.classList.remove("show_content");
  void submenuView.offsetWidth;
  submenuView.classList.add("show_content");

  const resolvedBackBtn =
    (customBackBtn instanceof HTMLElement
      ? customBackBtn
      : typeof customBackBtn === "string"
        ? container.querySelector(customBackBtn) ||
          document.querySelector(customBackBtn)
        : null) ||
    container.querySelector(".submenu_back_btn") ||
    document.getElementById("submenu_back_btn");

  if (resolvedBackBtn) {
    resolvedBackBtn.onclick = () => attemptCloseSubmenu();
  }
}

/**
 * Open a level-2 Submenu (backward-compatible signature used by Settings and BG Editor).
 *
 * @param {string} title - Accessible name for the panel.
 * @param {HTMLElement|string} contentNode - Content node or HTML string.
 * @param {Object} [options={}] - Options including `direction`, `container`, `width`, `isFullScreen`, `isDirty`, `onCancel`, `onBeforeClose`.
 */
export function openSidebarSubmenu(title, contentNode, options = {}) {
  openSubmenu({
    ...options,
    title,
    content: contentNode,
  });
}

/**
 * Attempt to close the active Submenu with unsaved changes check.
 * @param {boolean} [force=false] - If true, bypasses unsaved check and closes immediately.
 * @returns {boolean} True if submenu closed or closing initiated, false if blocked by unsaved warning.
 */
export function attemptCloseSubmenu(force = false) {
  if (force) {
    performCloseSubmenu();
    return true;
  }

  const isDirty = evaluateIsDirty();

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
 * Close the active Submenu and slide back to the main view.
 * @param {boolean} [force=false] - If true, forces closing without unsaved changes warning.
 * @returns {boolean}
 */
export function closeSubmenu(force = false) {
  if (!force) {
    return attemptCloseSubmenu(false);
  }
  performCloseSubmenu();
  return true;
}

/**
 * Backward-compatible alias for `closeSubmenu`.
 * @param {boolean} [force=false]
 * @returns {boolean}
 */
export function closeSidebarSubmenu(force = false) {
  return closeSubmenu(force);
}

function performCloseSubmenu() {
  if (activeSubmenuState.exitTimer) {
    clearTimeout(activeSubmenuState.exitTimer);
    activeSubmenuState.exitTimer = null;
  }
  activeSubmenuState.canExit = false;
  activeSubmenuState.isDirty = false;
  updateSubmenuDirtyUI();

  // Always released, including forced closes (`closeSubmenu(true)`).
  if (typeof activeSubmenuState.onClose === "function") {
    try {
      activeSubmenuState.onClose();
    } catch (err) {
      console.error("Error executing submenu onClose callback:", err);
    }
  }
  activeSubmenuState.onClose = null;

  const container =
    activeSubmenuState.container || document.getElementById("setting_wrapper");
  const submenuView =
    activeSubmenuState.submenuView ||
    container?.querySelector(".settings_submenu_view, .submenu_view");

  if (container) {
    container.classList.remove("submenu_active", "preview_eye_active");
  }
  if (submenuView) {
    submenuView.classList.remove("show_content");
  }

  // Release the mounted content once the panel has finished sliding out, so
  // heavy submenus (collection grid, editors) drop their DOM again.
  clearTimeout(activeSubmenuState.cleanupTimer);
  activeSubmenuState.cleanupTimer = setTimeout(() => {
    activeSubmenuState.cleanupTimer = null;
    if (container && container.classList.contains("submenu_active")) return;

    const submenuBody = submenuView?.querySelector(".submenu_body");
    if (submenuBody) submenuBody.innerHTML = "";
    if (container) container.style.removeProperty("--submenu-requested-width");
  }, SUBMENU_TRANSITION_MS);
}

let isToggleSettingBtnInitialized = false;

/**
 * Initialize the Settings panel open/close toggle button and click-outside dismissal.
 */
export function initToggleSettingBtn() {
  if (isToggleSettingBtnInitialized) return;
  isToggleSettingBtnInitialized = true;

  const settingToggleBtn = document.getElementById("setting_toggle_btn");
  const settingCloseBtn = document.getElementById("setting_close_btn");
  const settingWrapper = document.getElementById("setting_wrapper");
  const actionButtons = document.getElementById("action_buttons");

  if (!settingToggleBtn || !settingWrapper) return;

  // Match the settings panel's slide-out transition so the trigger buttons only
  // reappear once the panel has fully closed.
  const ACTION_BUTTONS_RESTORE_MS = 450;
  let actionButtonsRestoreTimer = null;

  const setOpenState = (isOpen) => {
    if (actionButtonsRestoreTimer) {
      clearTimeout(actionButtonsRestoreTimer);
      actionButtonsRestoreTimer = null;
    }

    if (isOpen) {
      settingWrapper.classList.add("setting_wrapper_opened");
      settingToggleBtn.classList.add("setting_toggle_btn_opened");
      actionButtons?.classList.add("setting_toggle_btn_opened");
      actionButtons?.classList.remove("toggle_hidden");
      updateNavShift();
      return;
    }

    settingWrapper.classList.remove("setting_wrapper_opened");
    settingToggleBtn.classList.remove("setting_toggle_btn_opened");

    // Hold the trigger buttons hidden until the panel has finished sliding out,
    // then reveal them (respecting the "hide toggle" preference).
    actionButtonsRestoreTimer = setTimeout(() => {
      actionButtonsRestoreTimer = null;
      actionButtons?.classList.remove("setting_toggle_btn_opened");
      const isDim = getSettings().hideToggleButton === true;
      if (isDim) {
        actionButtons?.classList.add("toggle_hidden");
      } else {
        actionButtons?.classList.remove("toggle_hidden");
      }
    }, ACTION_BUTTONS_RESTORE_MS);
  };

  const closeSettings = () => {
    if (settingWrapper.classList.contains("submenu_active")) {
      const closed = attemptCloseSubmenu();
      if (!closed) return;
    }
    setOpenState(false);
  };

  settingToggleBtn.addEventListener("click", () => {
    const isOpen = settingWrapper.classList.contains("setting_wrapper_opened");
    if (!isOpen) {
      setOpenState(true);
    }
  });

  if (settingCloseBtn) {
    settingCloseBtn.addEventListener("click", () => {
      closeSettings();
    });
  }

  // Click outside to close settings panel
  document.addEventListener("pointerdown", (e) => {
    const isOpen = settingWrapper.classList.contains("setting_wrapper_opened");
    if (!isOpen) return;

    const target = e.target;
    if (
      target.closest("#setting_wrapper") ||
      target.closest("#action_buttons") ||
      target.closest("#setting_toggle_btn") ||
      target.closest(".dialog_root") ||
      target.closest(".dropdown") ||
      target.closest(".notification_container")
    ) {
      return;
    }

    closeSettings();
  });
}
