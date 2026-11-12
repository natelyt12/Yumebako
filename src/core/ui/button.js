import "./button.css";
import { Icons } from "/src/core/icon.js";
import { initCustomSelects, syncDropdownSelection, initSubToggle } from "/src/core/ui/dropdown.js";

/**
 * The single initializer for the unified `.btn` component.
 *
 * Scans `rootNode` (and `rootNode` itself) for `.btn[data-action]` and injects
 * the Zone 3 trailing action so markup never carries hand-written SVG arrows or
 * switch tracks:
 *   submenu  -> chevron right (.btn_action_icon)
 *   dropdown -> chevron down  (.sbsctsvg)
 *   toggle   -> switch track  (.ts-track > .ts-thumb)
 *   color    -> hex readout + swatch (.btn_color_trail), synced to a hidden <input type="color">
 *
 * It also finishes the dropdown pipeline for the same subtree (native `<select>`
 * upgrade + selection sync), so one call is enough after any markup change.
 *
 * @param {HTMLElement|Document} [rootNode=document] - Subtree to scan.
 */
let isToggleBlurListenerAttached = false;
function initToggleClickBlur() {
    if (isToggleBlurListenerAttached) return;
    isToggleBlurListenerAttached = true;
    document.addEventListener("click", (e) => {
        // e.detail > 0 means pointer/mouse click (keyboard Space/Enter has detail === 0)
        if (e.detail > 0) {
            const toggle = e.target.closest?.('.btn[data-action="toggle"]') || (e.target.matches?.('input[type="checkbox"]') ? e.target : null);
            if (toggle) {
                const input = toggle.matches?.('input[type="checkbox"]') ? toggle : toggle.querySelector('input[type="checkbox"]');
                if (input && document.activeElement === input) {
                    input.blur();
                }
            }
        }
    });
}

export function initButtons(rootNode = document) {
    initSubToggle();
    initToggleClickBlur();
    if (!rootNode || typeof rootNode.querySelectorAll !== "function") return;

    const buttons = Array.from(rootNode.querySelectorAll(".btn[data-action]"));
    // A freshly created `.btn` passed as the root is not matched by
    // `querySelectorAll` (it only searches descendants), so handle it explicitly.
    if (rootNode.nodeType === 1 && rootNode.matches?.(".btn[data-action]")) {
        buttons.unshift(rootNode);
    }

    buttons.forEach((btn) => {
        const action = btn.getAttribute("data-action");

        if (action === "submenu") {
            if (!btn.querySelector(".btn_action_icon")) {
                btn.insertAdjacentHTML(
                    "beforeend",
                    `<span class="btn_action_icon">${Icons.chevronRight}</span>`
                );
            }
        } else if (action === "dropdown") {
            if (!btn.querySelector(".sbsctsvg")) {
                btn.insertAdjacentHTML(
                    "beforeend",
                    `<div class="sbsctsvg">${Icons.chevronDown}</div>`
                );
            }
        } else if (action === "toggle") {
            if (!btn.querySelector(".ts-track")) {
                btn.insertAdjacentHTML(
                    "beforeend",
                    `<div class="ts-track"><div class="ts-thumb"></div></div>`
                );
            }
        } else if (action === "color") {
            initColorButton(btn);
        }
    });

    initCustomSelects(rootNode);
    syncDropdownSelection(rootNode);
}

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

/**
 * Wires a `.btn[data-action="color"]` label: renders the trailing hex readout +
 * swatch and keeps them in sync with the hidden native `<input type="color">`.
 * Idempotent, so `initButtons` can be called repeatedly on the same subtree.
 *
 * @param {HTMLElement} btn - The color button label.
 */
function initColorButton(btn) {
    const input = btn.querySelector('input[type="color"]');
    if (!input || btn.dataset.colorReady) return;
    btn.dataset.colorReady = "1";

    btn.insertAdjacentHTML(
        "beforeend",
        `<span class="btn_color_trail"><span class="btn_color_hex"></span><span class="btn_color_swatch"></span></span>`
    );
    const hexEl = btn.querySelector(".btn_color_hex");
    const sync = () => {
        hexEl.textContent = input.value.toUpperCase();
        btn.style.setProperty("--btn-color-value", input.value);
    };
    input.addEventListener("input", sync);
    input.addEventListener("change", sync);
    sync();
}

/**
 * Programmatically sets the value of a color button and refreshes its swatch.
 * Does not dispatch `input`/`change`, so callers stay in control of persistence.
 *
 * @param {HTMLElement} btn - A `.btn[data-action="color"]` element.
 * @param {string} hex - Color in `#rrggbb` form; invalid values are ignored.
 */
export function setColorButtonValue(btn, hex) {
    const input = btn?.querySelector('input[type="color"]');
    if (!input || !HEX_COLOR.test(hex)) return;
    input.value = hex.toLowerCase();
    btn.querySelector(".btn_color_hex").textContent = input.value.toUpperCase();
    btn.style.setProperty("--btn-color-value", input.value);
}

/**
 * Create a `.btn` element from JavaScript.
 *
 * @param {Object} [options] - Button configuration.
 * @param {string} [options.id] - Element id.
 * @param {string} [options.icon] - Phosphor icon key (rendered into Zone 1).
 * @param {string} [options.title] - Primary label (Zone 2).
 * @param {string} [options.dataI18n] - i18n key applied to the title so `translateDOM` can refresh it.
 * @param {string} [options.desc] - Secondary description (Zone 2, optional).
 * @param {'normal'|'submenu'|'dropdown'|'toggle'|'color'} [options.action='normal'] - Behaviour.
 * @param {'default'|'danger'} [options.variant='default'] - Colour variant.
 * @param {boolean} [options.checked] - Initial state for toggle buttons.
 * @param {string} [options.value] - Initial `#rrggbb` value for color buttons.
 * @param {Function} [options.onClick] - Click handler (skipped for toggles and color buttons).
 * @param {function(string): void} [options.onChange] - Color buttons only: fired live with the picked `#rrggbb`.
 * @returns {HTMLElement & { value?: string }} Color buttons expose a `value` getter/setter.
 */
export function createButton({
    id = "",
    icon = "",
    title = "",
    dataI18n = "",
    desc = "",
    action = "normal",
    variant = "default",
    checked = false,
    value = "#ffffff",
    onClick = null,
    onChange = null,
} = {}) {
    const isToggle = action === "toggle";
    const isColor = action === "color";
    const el = document.createElement(isToggle || isColor ? "label" : "button");
    el.className = "btn";
    if (id) el.id = id;
    if (action !== "normal") el.setAttribute("data-action", action);
    if (variant === "danger") el.setAttribute("data-variant", "danger");

    let html = "";
    if (icon) html += `<i data-icon="${icon}"></i>`;

    html += `<div class="btn_body">`;
    if (title) html += `<span class="btn_title"${dataI18n ? ` data-i18n="${dataI18n}"` : ""}>${title}</span>`;
    if (desc) html += `<span class="btn_desc">${desc}</span>`;
    html += `</div>`;

    if (isToggle) {
        html += `<input type="checkbox"${id ? ` id="${id}_input"` : ""}${checked ? " checked" : ""} />`;
    }
    if (isColor) {
        html += `<input type="color"${id ? ` id="${id}_input"` : ""} value="${HEX_COLOR.test(value) ? value.toLowerCase() : "#ffffff"}" />`;
    }

    el.innerHTML = html;

    // Auto-render Zone 3 (chevron / switch track / color swatch).
    initButtons(el);

    if (isColor) {
        const input = el.querySelector('input[type="color"]');
        if (onChange) input.addEventListener("input", () => onChange(input.value));
        Object.defineProperty(el, "value", {
            get: () => input.value,
            set: (hex) => setColorButtonValue(el, hex),
        });
    } else if (onClick && !isToggle) {
        el.addEventListener("click", onClick);
    }

    return el;
}
