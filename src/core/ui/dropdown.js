import "./dropdown.css";
import { Icons } from "/src/core/icon.js";

// Mirrors the `.dropdown.closing` height transition (0.26s) in dropdown.css.
const CLOSE_ANIM_MS = 300;

// Resolve the `.dropdown` panel that belongs to a `.btn[data-action="dropdown"]`, looking
// through any non-dropdown siblings in between (e.g. labels or svg wrappers).
function findDropdown(btn) {
    if (btn?._dropdown) return btn._dropdown;
    let node = btn ? btn.nextElementSibling : null;
    while (node && !node.classList.contains("dropdown")) {
        node = node.nextElementSibling;
    }
    if (node) {
        btn._dropdown = node;
        node._controlBtn = btn;
    }
    return node;
}

// Resolve the dropdown trigger that controls a `.dropdown` panel.
function findControlButton(dropdown) {
    if (dropdown?._controlBtn) return dropdown._controlBtn;
    let node = dropdown ? dropdown.previousElementSibling : null;
    while (node && !node.matches(".btn[data-action='dropdown']")) {
        node = node.previousElementSibling;
    }
    if (node) {
        dropdown._controlBtn = node;
        node._dropdown = dropdown;
    }
    return node;
}

// Close every open dropdown on the page except `except`.
export function closeAllDropdowns(except = null) {
    document.querySelectorAll(".dropdown.opening").forEach((sub) => {
        if (sub !== except) closeDropdown(sub, findControlButton(sub));
    });
}

export function ensureDropdownInner(dropdown) {
    let inner = dropdown.querySelector(".dropdown_inner");
    if (!inner) {
        inner = document.createElement("div");
        inner.className = "dropdown_inner";
        while (dropdown.firstChild) {
            inner.appendChild(dropdown.firstChild);
        }
        dropdown.appendChild(inner);
    }
    return inner;
}

// Open a dropdown with proper bounds, max-height and open_upwards calculation.
export function openDropdown(dropdown, btn) {
    if (!dropdown || !btn) return;
    closeAllDropdowns(dropdown);

    const inner = ensureDropdownInner(dropdown);

    // Portal to document.body to break free from ancestor Backdrop Roots and overflow clipping
    if (dropdown.parentElement !== document.body) {
        dropdown._placeholder = document.createComment("dropdown-portal-placeholder");
        dropdown.parentElement?.insertBefore(dropdown._placeholder, dropdown);
        document.body.appendChild(dropdown);
    }

    const rect = btn.getBoundingClientRect();
    const gap = 6;
    const padding = 8;

    // Measure natural height of inner content without restriction
    inner.style.position = "static";
    dropdown.style.height = "auto";
    dropdown.style.maxHeight = "none";
    dropdown.style.overflow = "hidden";

    const maxCap = 440;
    const naturalHeight = inner.offsetHeight || 200;

    const spaceBelow = window.innerHeight - rect.bottom - gap - padding;
    const spaceAbove = rect.top - gap - padding;
    const openUpwards = spaceBelow < naturalHeight && spaceAbove > spaceBelow;
    const available = Math.max(120, Math.min(maxCap, openUpwards ? spaceAbove : spaceBelow));
    const targetHeight = Math.min(naturalHeight, available);

    // Anchor inner content to the moving edge so it slides with the frame
    inner.style.position = "absolute";
    if (openUpwards) {
        inner.style.bottom = "auto";
        inner.style.top = "0";
    } else {
        inner.style.top = "auto";
        inner.style.bottom = "0";
    }

    // Set initial 0 height and layout coordinates with transition disabled
    dropdown.style.transition = "none";
    dropdown.style.height = "0px";
    dropdown.classList.remove("closing", "opening");
    dropdown.classList.toggle("open_upwards", openUpwards);
    dropdown.classList.add("active");

    dropdown.style.position = "fixed";
    dropdown.style.left = `${Math.round(rect.left)}px`;
    dropdown.style.width = `${Math.round(rect.width)}px`;

    if (openUpwards) {
        dropdown.style.bottom = `${Math.round(window.innerHeight - rect.top + gap)}px`;
        dropdown.style.top = "auto";
    } else {
        dropdown.style.top = `${Math.round(rect.bottom + gap)}px`;
        dropdown.style.bottom = "auto";
    }

    // Ensure stacking z-index is higher than parent containers (modals, popovers, sidebars)
    let highestZ = 40;
    const dialogRoot = btn.closest(".dialog_root");
    if (dialogRoot) {
        const dialogZ = parseInt(getComputedStyle(dialogRoot).zIndex, 10);
        if (!isNaN(dialogZ)) highestZ = Math.max(highestZ, dialogZ + 10);
    }
    const popoverPanel = btn.closest(".popover_panel");
    if (popoverPanel) {
        const popoverZ = parseInt(getComputedStyle(popoverPanel).zIndex, 10);
        if (!isNaN(popoverZ)) highestZ = Math.max(highestZ, popoverZ + 10);
    }
    dropdown.style.zIndex = highestZ;

    // Commit initial height = 0 in a single reflow
    dropdown.offsetHeight;

    // Restore transition and trigger opening on the next paint frame
    dropdown.style.removeProperty("transition");
    btn.classList.add("btn_active");

    requestAnimationFrame(() => {
        if (dropdown.classList.contains("active") && !dropdown.classList.contains("closing")) {
            dropdown.style.height = `${targetHeight}px`;
            dropdown.classList.add("opening");

            if (naturalHeight > available) {
                clearTimeout(dropdown._overflowTimer);
                dropdown._overflowTimer = setTimeout(() => {
                    if (dropdown.classList.contains("opening")) {
                        dropdown.style.overflowY = "auto";
                        inner.style.position = "static";
                    }
                }, 360);
            }
        }
    });
}

// Close an open dropdown unless it was reopened within the animation window.
export function closeDropdown(dropdown, btn) {
    if (!dropdown) return;
    if (!btn) btn = findControlButton(dropdown);

    clearTimeout(dropdown._overflowTimer);
    const inner = dropdown.querySelector(".dropdown_inner");
    if (inner) {
        inner.style.position = "absolute";
        if (dropdown.classList.contains("open_upwards")) {
            inner.style.top = "0";
            inner.style.bottom = "auto";
        } else {
            inner.style.bottom = "0";
            inner.style.top = "auto";
        }
    }

    dropdown.style.overflow = "hidden";
    dropdown.classList.remove("opening");
    dropdown.classList.add("closing");
    dropdown.style.height = "0px";

    if (btn) btn.classList.remove("btn_active");

    setTimeout(() => {
        if (!dropdown.classList.contains("opening")) {
            dropdown.classList.remove("active", "open_upwards", "closing");

            // Return to original DOM placeholder if portaled
            if (dropdown._placeholder && dropdown._placeholder.parentNode) {
                dropdown._placeholder.parentNode.insertBefore(dropdown, dropdown._placeholder);
                dropdown._placeholder.remove();
                dropdown._placeholder = null;
            }
            dropdown.style.removeProperty("position");
            dropdown.style.removeProperty("left");
            dropdown.style.removeProperty("top");
            dropdown.style.removeProperty("bottom");
            dropdown.style.removeProperty("width");
            dropdown.style.removeProperty("z-index");
            dropdown.style.removeProperty("max-height");
            dropdown.style.removeProperty("height");
            dropdown.style.removeProperty("overflow");
            if (inner) {
                inner.style.removeProperty("position");
                inner.style.removeProperty("top");
                inner.style.removeProperty("bottom");
            }
        }
    }, CLOSE_ANIM_MS);
}

// Toggle a dropdown open/closed, closing any other open panel first.
export function toggleDropdown(dropdown, btn) {
    if (!dropdown || !btn) return;
    if (dropdown.classList.contains("opening")) {
        closeDropdown(dropdown, btn);
    } else {
        openDropdown(dropdown, btn);
    }
}

// Flag exactly one item as the current selection so the checkmark (CSS ::before)
// appears on it and nowhere else.
function markSelectedItem(dropdown, item) {
    dropdown.querySelectorAll(".dropdown_item[data-selected]").forEach((el) => {
        if (el !== item) el.removeAttribute("data-selected");
    });
    item.setAttribute("data-selected", "true");
}

// Upgrade every native select that opted in (`.native_select` or `[data-custom]`)
// inside `rootNode`. Safe to call repeatedly.
export function initCustomSelects(rootNode = document) {
    rootNode.querySelectorAll("select.native_select, select[data-custom]").forEach((sel) => {
        upgradeSelectToDropdown(sel);
    });
}

// Ensure every value-selecting custom dropdown shows its checkmark on the row
// matching the button's current `data-selected`. Called whenever markup is
// (re)populated. Action menus (rows without `data-value`, e.g. "add effect")
// are left untouched — they have no persistent selection.
export function syncDropdownSelection(rootNode = document) {
    rootNode.querySelectorAll(".dropdown_wrapper").forEach((wrapper) => {
        const btn = wrapper.querySelector(".btn[data-action='dropdown']");
        const dropdown = wrapper.querySelector(".dropdown");
        if (!btn || !dropdown) return;

        const items = dropdown.querySelectorAll(".dropdown_item[data-value]");
        if (items.length === 0) return;

        // An explicit data-selected on a row wins; otherwise fall back to the
        // wrapper's selected value, then to the first row.
        const flagged = Array.from(dropdown.querySelectorAll('.dropdown_item[data-selected="true"]')).pop();
        const currentValue = btn.getAttribute("data-selected");
        const item = flagged
            || (currentValue != null
                ? dropdown.querySelector(`.dropdown_item[data-value="${currentValue}"]`)
                : null)
            || items[0];

        if (item) markSelectedItem(dropdown, item);
    });
}

// Build the unified custom dropdown markup for a value list and insert it next
// to `selectEl`, hiding the native `<select>` but keeping it in the DOM (and
// keeping its `id`) as the source of truth. Returns the trigger button.
//
// The native select keeps receiving programmatic `.value` writes, so existing
// code that reads `select.value` / attaches a `change` listener continues to
// work; picks in the custom UI are mirrored back onto it and a native `change`
// is fired.
export function upgradeSelectToDropdown(selectEl) {
    if (!selectEl || selectEl.dataset.dropdownUpgraded === "true") return null;
    selectEl.dataset.dropdownUpgraded = "true";

    const options = Array.from(selectEl.options).map((opt) => ({
        value: opt.value,
        label: opt.textContent,
        i18n: opt.getAttribute("data-i18n"),
    }));

    const wrapper = document.createElement("div");
    wrapper.className = "dropdown_wrapper";

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn";
    btn.setAttribute("data-action", "dropdown");
    // The trigger carries the original id so `getElementById(name)` keeps finding
    // a single element (the visible control). The hidden select gets a derived id.
    if (selectEl.id) {
        btn.id = selectEl.id;
        selectEl.id = `${selectEl.id}-native`;
    }

    const label = document.createElement("span");
    label.className = "selected_value";
    btn.appendChild(label);

    const chevron = document.createElement("div");
    chevron.className = "sbsctsvg";
    chevron.innerHTML = Icons.chevronDown;
    btn.appendChild(chevron);

    const panel = document.createElement("div");
    panel.className = "dropdown";
    const inner = document.createElement("div");
    inner.className = "dropdown_inner";
    options.forEach((opt) => {
        const item = document.createElement("div");
        item.className = "dropdown_item";
        item.dataset.value = opt.value;
        if (opt.i18n) item.setAttribute("data-i18n", opt.i18n);
        item.textContent = opt.label;
        inner.appendChild(item);
    });
    panel.appendChild(inner);

    wrapper.append(btn, panel);
    btn._dropdown = panel;
    panel._controlBtn = btn;
    // Hide the select but keep it as the value store; link the pair both ways so
    // `setDropdownValue` can find the visible UI from the select.
    selectEl.classList.add("hidden");
    selectEl.dataset.dropdownFor = "true";
    selectEl.parentElement.insertBefore(wrapper, selectEl);
    selectEl._customDropdown = wrapper;
    // Link the panel back to the select so the document-level `dropdownChange`
    // handler (dispatched on `document`, not on the panel) can find it.
    panel._nativeSelect = selectEl;

    // Seed the label/checkmark from the select's current value.
    syncDropdownFromSelect(selectEl, options[0] && options[0].value);

    return btn;
}

// Push a value into a select's paired custom dropdown (label + checkmark).
function syncDropdownFromSelect(selectEl, fallbackValue) {
    const wrapper = selectEl._customDropdown;
    if (!wrapper) return;
    const btn = wrapper.querySelector(".btn[data-action='dropdown']");
    const value = selectEl.value || fallbackValue;
    if (btn && value != null) setDropdownValue(btn, value);
}

export function setDropdownValue(btn, value) {
    if (!btn) return;

    if (btn.tagName === "SELECT") {
        btn.value = value;
        btn.setAttribute("data-selected", value);
        // Keep the paired custom dropdown in sync when this select was upgraded.
        syncDropdownFromSelect(btn, value);
        return;
    }

    let dropdown = findDropdown(btn);

    if (dropdown) {
        const item = dropdown.querySelector(`.dropdown_item[data-value="${value}"]`);
        const displaySpan = btn.querySelector(".selected_value");

        if (item && displaySpan) {
            displaySpan.textContent = item.textContent;

            if (item.hasAttribute("data-i18n")) {
                displaySpan.setAttribute("data-i18n", item.getAttribute("data-i18n"));
            } else {
                displaySpan.removeAttribute("data-i18n");
            }

            markSelectedItem(dropdown, item);
            btn.setAttribute("data-selected", value);

            // Mirror onto the hidden native select when this came from one, so its
            // `.value` stays authoritative for code that reads it.
            if (dropdown._nativeSelect) dropdown._nativeSelect.value = value;
        }
    }
}

function updateDropdownUI(dropdownId, value) {
    const btn = document.getElementById(dropdownId);
    setDropdownValue(btn, value);
}

let isSubToggleInitialized = false;

export function initSubToggle() {
    if (isSubToggleInitialized) return;
    isSubToggleInitialized = true;

    document.addEventListener("change", (event) => {
        const target = event.target;
        // Upgraded selects are hidden value stores: the custom dropdown already
        // announced the pick with the trigger's id, so ignore their synthetic
        // `change` to avoid a duplicate `dropdownChange` under the wrong id.
        if (target && target.tagName === "SELECT") {
            if (target.dataset.dropdownUpgraded === "true") return;
            target.blur();
            target.setAttribute("data-selected", target.value);
            const changeEvent = new CustomEvent("dropdownChange", {
                bubbles: true,
                detail: { id: target.id, value: target.value },
            });
            document.dispatchEvent(changeEvent);
        }
    });

    document.addEventListener("mousedown", (event) => {
        const target = event.target;
        const isClickInsideDropdown = target.closest(".dropdown_wrapper") || target.closest(".dropdown");

        if (!isClickInsideDropdown) {
            closeAllDropdowns();
        }

        const btn = target.closest(".btn[data-action='dropdown']");
        if (btn) {
            const dropdown = findDropdown(btn);
            if (dropdown) {
                toggleDropdown(dropdown, btn);
            }
            return;
        }

        const item = target.closest(".dropdown_item");
        if (item) {
            const dropdown = item.closest(".dropdown");
            const controlBtn = findControlButton(dropdown);

            if (controlBtn) {
                const value = item.getAttribute("data-value");
                const id = controlBtn.id;

                if (value !== null) {
                    // Value row: reflect the choice immediately (label, checkmark and data-selected).
                    markSelectedItem(dropdown, item);
                    setDropdownValue(controlBtn, value);

                    // If this dropdown was upgraded from a native select, mirror the
                    // pick onto it and re-emit a native `change` for legacy listeners.
                    if (dropdown._nativeSelect) {
                        dropdown._nativeSelect.value = value;
                        dropdown._nativeSelect.dispatchEvent(new Event("change", { bubbles: true }));
                    }

                    const changeEvent = new CustomEvent("dropdownChange", {
                        bubbles: true,
                        detail: { id: id, value: value },
                    });
                    document.dispatchEvent(changeEvent);
                } else {
                    // Action menu row (no data-value, e.g. "Add effect"):
                    item._handled = true;
                    if (typeof item._action === "function") {
                        item._action(item);
                    }
                    const actionEvent = new CustomEvent("dropdownAction", {
                        bubbles: true,
                        detail: { id: id, item },
                    });
                    item.dispatchEvent(actionEvent);
                    setTimeout(() => { item._handled = false; }, 300);
                }

                closeDropdown(dropdown, controlBtn);
            }
        }
    });

    // Close open dropdowns when scrolling any container (except when scrolling the dropdown itself)
    window.addEventListener(
        "scroll",
        (event) => {
            if (event.target && (event.target.classList?.contains("dropdown") || event.target.closest?.(".dropdown"))) {
                return;
            }
            closeAllDropdowns();
        },
        true
    );

    window.addEventListener("resize", () => {
        closeAllDropdowns();
    });

    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
            closeAllDropdowns();
            return;
        }
        if (event.key === "Enter" || event.key === " ") {
            const btn = event.target.closest?.(".btn[data-action='dropdown']");
            if (btn) {
                event.preventDefault();
                const dropdown = findDropdown(btn);
                if (dropdown) toggleDropdown(dropdown, btn);
            }
        }
    });

    document.addEventListener("dropdownChange", (e) => {
        const { id, value } = e.detail;
        if (id && value !== undefined && value !== null) {
            updateDropdownUI(id, value);
        }
    });
}
