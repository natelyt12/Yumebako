import { Icons } from "/src/core/icon.js";

const CLOSE_ANIM_MS = 200;

// Resolve the `.dropdown` panel that belongs to a `.btn[data-action="dropdown"]`, looking
// through any non-dropdown siblings in between (e.g. labels or svg wrappers).
function findDropdown(btn) {
    let node = btn ? btn.nextElementSibling : null;
    while (node && !node.classList.contains("dropdown")) {
        node = node.nextElementSibling;
    }
    return node;
}

// Resolve the dropdown trigger that controls a `.dropdown` panel.
function findControlButton(dropdown) {
    let node = dropdown ? dropdown.previousElementSibling : null;
    while (node && !node.matches(".btn[data-action='dropdown']")) {
        node = node.previousElementSibling;
    }
    return node;
}

// Close every open dropdown on the page except `except`.
export function closeAllDropdowns(except = null) {
    document.querySelectorAll(".dropdown.opening").forEach((sub) => {
        if (sub !== except) closeDropdown(sub, findControlButton(sub));
    });
}

// Toggle a dropdown open/closed, closing any other open panel first. Shared by
// the global handler and by components that build their own dropdown markup.
export function toggleDropdown(dropdown, btn) {
    if (!dropdown || !btn) return;
    closeAllDropdowns(dropdown);

    if (dropdown.classList.contains("opening")) {
        closeDropdown(dropdown, btn);
        return;
    }

    dropdown.classList.remove("closing");
    dropdown.classList.add("active");
    dropdown.offsetHeight;
    dropdown.classList.add("opening");
    btn.classList.add("btn_active");
}

// Close an open dropdown unless it was reopened within the animation window.
function closeDropdown(dropdown, btn) {
    dropdown.classList.remove("opening");
    // `closing` flips the wipe direction so the panel retreats the way it came.
    dropdown.classList.add("closing");
    btn.classList.remove("btn_active");
    setTimeout(() => {
        if (!dropdown.classList.contains("opening")) {
            dropdown.classList.remove("active", "open_upwards", "closing");
        }
    }, CLOSE_ANIM_MS);
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
    options.forEach((opt) => {
        const item = document.createElement("div");
        item.className = "dropdown_item";
        item.dataset.value = opt.value;
        if (opt.i18n) item.setAttribute("data-i18n", opt.i18n);
        item.textContent = opt.label;
        panel.appendChild(item);
    });

    wrapper.append(btn, panel);
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

export function initSubToggle() {
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
        const isClickInsideDropdown = target.closest(".dropdown_wrapper");

        if (!isClickInsideDropdown) {
            closeAllDropdowns();
        }

        const btn = target.closest(".btn[data-action='dropdown']");
        if (btn) {
            const dropdown = findDropdown(btn);
            if (dropdown) {
                const wasOpening = dropdown.classList.contains("opening");

                closeAllDropdowns(dropdown);

                if (wasOpening) {
                    closeDropdown(dropdown, btn);
                } else {
                    dropdown.classList.remove("closing");
                    dropdown.classList.add("active");
                    dropdown.offsetHeight;
                    dropdown.classList.add("opening");
                    btn.classList.add("btn_active");

                    // Flip the panel upwards when it would not fit below. The
                    // measured height is used (CSS caps it via max-height) and the
                    // scroll parent is clamped to the viewport — mandatory for the
                    // submenu drawer, whose scroll container is a flex child that
                    // can extend past the bottom of the screen.
                    const rect = btn.getBoundingClientRect();
                    const scrollParent = btn.closest('.popup_content, #settings_content, .submenu_body') || document.body;
                    const parentRect = scrollParent === document.body
                        ? { top: 0, bottom: window.innerHeight }
                        : scrollParent.getBoundingClientRect();

                    const bounds = {
                        top: Math.max(parentRect.top, 0),
                        bottom: Math.min(parentRect.bottom, window.innerHeight),
                    };

                    const gap = 6;
                    dropdown.style.removeProperty("max-height");
                    const maxCap = parseFloat(getComputedStyle(dropdown).maxHeight) || dropdown.offsetHeight;
                    const panelHeight = Math.min(dropdown.offsetHeight, maxCap);
                    const spaceBelow = bounds.bottom - rect.bottom - gap;
                    const spaceAbove = rect.top - bounds.top - gap;
                    const openUpwards = spaceBelow < panelHeight && spaceAbove > spaceBelow;

                    dropdown.classList.toggle("open_upwards", openUpwards);

                    // Never let the panel spill past the viewport: clamp it to the
                    // room actually available on the side it opens towards.
                    const available = Math.max(120, Math.min(maxCap, openUpwards ? spaceAbove : spaceBelow));
                    dropdown.style.maxHeight = `${Math.floor(available)}px`;
                }
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

                // Reflect the choice immediately: label, checkmark and data-selected.
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

                closeDropdown(dropdown, controlBtn);
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
