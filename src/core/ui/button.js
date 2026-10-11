import { Icons } from "/src/core/icon.js";
import { initCustomSelects, syncDropdownSelection } from "/src/core/ui/dropdown.js";

/**
 * The single initializer for the unified `.btn` component.
 *
 * Scans `rootNode` (and `rootNode` itself) for `.btn[data-action]` and injects
 * the Zone 3 trailing action so markup never carries hand-written SVG arrows or
 * switch tracks:
 *   submenu  -> chevron right (.btn_action_icon)
 *   dropdown -> chevron down  (.sbsctsvg)
 *   toggle   -> switch track  (.ts-track > .ts-thumb)
 *
 * It also finishes the dropdown pipeline for the same subtree (native `<select>`
 * upgrade + selection sync), so one call is enough after any markup change.
 *
 * @param {HTMLElement|Document} [rootNode=document] - Subtree to scan.
 */
export function initButtons(rootNode = document) {
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
        }
    });

    initCustomSelects(rootNode);
    syncDropdownSelection(rootNode);
}

/**
 * Create a `.btn` element from JavaScript.
 *
 * @param {Object} [options] - Button configuration.
 * @param {string} [options.id] - Element id.
 * @param {string} [options.icon] - Phosphor icon key (rendered into Zone 1).
 * @param {string} [options.title] - Primary label (Zone 2).
 * @param {string} [options.desc] - Secondary description (Zone 2, optional).
 * @param {'normal'|'submenu'|'dropdown'|'toggle'} [options.action='normal'] - Behaviour.
 * @param {'default'|'danger'} [options.variant='default'] - Colour variant.
 * @param {boolean} [options.checked] - Initial state for toggle buttons.
 * @param {Function} [options.onClick] - Click handler (skipped for toggles).
 * @returns {HTMLElement}
 */
export function createButton({
    id = "",
    icon = "",
    title = "",
    desc = "",
    action = "normal",
    variant = "default",
    checked = false,
    onClick = null,
} = {}) {
    const isToggle = action === "toggle";
    const el = document.createElement(isToggle ? "label" : "button");
    el.className = "btn";
    if (id) el.id = id;
    if (action !== "normal") el.setAttribute("data-action", action);
    if (variant === "danger") el.setAttribute("data-variant", "danger");

    let html = "";
    if (icon) html += `<i data-icon="${icon}"></i>`;

    html += `<div class="btn_body">`;
    if (title) html += `<span class="btn_title">${title}</span>`;
    if (desc) html += `<span class="btn_desc">${desc}</span>`;
    html += `</div>`;

    if (isToggle) {
        html += `<input type="checkbox"${id ? ` id="${id}_input"` : ""}${checked ? " checked" : ""} />`;
    }

    el.innerHTML = html;

    // Auto-render Zone 3 (chevron / switch track).
    initButtons(el);

    if (onClick && !isToggle) {
        el.addEventListener("click", onClick);
    }

    return el;
}
