import { getAllFromStore, getFromStore } from "/src/core/db.js";
import { getSettings, saveSettings, subscribe } from "/src/core/storageHandler.js";

let trackerContainer = null;
let hoverTooltip = null;
let pinnedContainer = null;
let pollTimer = null;
let activeTab = "appData"; // "appData" | "mediaData"
let autoPoll = true;
let searchQuery = "";
let activeHoveredItem = null;
let tooltipHideTimeout = null;
let isTrackerInitialized = false;

const MAX_PINS = 4;
const pinnedCards = new Map(); // key -> { element, badgeEl, contentEl, storeName, key }

/**
 * Initialize IDB Tracker integration and restore state if previously active.
 */
export function initIdbTracker() {
    const isEnabled = getSettings().debugIdbTracker ?? false;
    const toggleEl = document.getElementById("debug_idb_tracker");
    if (toggleEl) {
        toggleEl.checked = isEnabled;
        if (!toggleEl.dataset.bound) {
            toggleEl.dataset.bound = "true";
            toggleEl.addEventListener("change", (e) => {
                saveSettings({ debugIdbTracker: e.target.checked });
            });
        }
    }

    if (isTrackerInitialized) return;
    isTrackerInitialized = true;

    subscribe("debugIdbTracker", (enabled) => {
        const active = enabled === true;
        const toggle = document.getElementById("debug_idb_tracker");
        if (toggle && toggle.checked !== active) {
            toggle.checked = active;
        }

        if (active) {
            showIdbTracker();
        } else {
            hideIdbTracker();
        }
    });

    if (isEnabled) {
        showIdbTracker();
    }
}

/**
 * Open the IDB Tracker floating overlay.
 */
export function showIdbTracker() {
    if (!trackerContainer) {
        createTrackerDOM();
    }
    trackerContainer.style.display = "flex";
    if (pinnedContainer) {
        pinnedContainer.style.display = "flex";
    }
    startPolling();
    refreshData();
}

/**
 * Hide the IDB Tracker floating overlay (UI only, no saveSettings recursion).
 */
export function hideIdbTracker() {
    if (trackerContainer) {
        trackerContainer.style.display = "none";
    }
    if (pinnedContainer) {
        pinnedContainer.style.display = "none";
    }
    hideTooltipNow();
    stopPolling();
}

function startPolling() {
    stopPolling();
    if (autoPoll) {
        pollTimer = setInterval(() => {
            refreshData();
            updatePinnedCards();
        }, 1500);
    }
}

function stopPolling() {
    if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
    }
}

function scheduleHideTooltip() {
    clearTimeout(tooltipHideTimeout);
    tooltipHideTimeout = setTimeout(() => {
        hideTooltipNow();
    }, 120);
}

function cancelHideTooltip() {
    clearTimeout(tooltipHideTimeout);
}

function hideTooltipNow() {
    cancelHideTooltip();
    if (hoverTooltip) {
        hoverTooltip.style.display = "none";
    }
    if (activeHoveredItem) {
        activeHoveredItem.classList.remove("active_hover");
        activeHoveredItem = null;
    }
}

/**
 * Format bytes to human readable format.
 * @param {number} bytes
 * @returns {string}
 */
function formatBytes(bytes) {
    if (!bytes || bytes <= 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

/**
 * Get summary badge text for a value.
 * @param {any} val
 * @returns {string}
 */
function getValueSummary(val) {
    if (val === null) return "null";
    if (val === undefined) return "undefined";
    if (val instanceof Blob) {
        return `${val.type || "blob"} • ${formatBytes(val.size)}`;
    }
    if (Array.isArray(val)) {
        return `Array(${val.length})`;
    }
    if (typeof val === "object") {
        return `Object(${Object.keys(val).length})`;
    }
    if (typeof val === "string") {
        return `String(${val.length})`;
    }
    return String(val);
}

function formatValueContent(val) {
    if (val instanceof Blob) {
        return `[Blob: size=${val.size} bytes, type=${val.type || "unknown"}]`;
    }
    try {
        return JSON.stringify(val, null, 2);
    } catch {
        return String(val);
    }
}

/**
 * Create floating tracker container and inject styles.
 */
function createTrackerDOM() {
    const style = document.createElement("style");
    style.id = "idb-tracker-styles";
    style.textContent = `
        #idb_tracker_overlay {
            position: fixed;
            top: 12px;
            left: 12px;
            width: 265px;
            height: auto;
            max-height: calc(100vh - 24px);
            background: rgba(10, 10, 16, 0.9);
            backdrop-filter: blur(12px);
            -webkit-backdrop-filter: blur(12px);
            border: 1px solid rgba(255, 255, 255, 0.12);
            border-radius: 8px;
            box-shadow: 0 10px 30px rgba(0, 0, 0, 0.55);
            display: flex;
            flex-direction: column;
            z-index: 100000;
            font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
            font-size: 10.5px;
            line-height: 1.2;
            color: #e6e6ea;
            overflow: hidden;
            box-sizing: border-box;
            user-select: none;
        }
        #idb_tracker_overlay * {
            box-sizing: border-box;
        }
        .idb_head {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 4px 7px;
            background: rgba(255, 255, 255, 0.04);
            border-bottom: 1px solid rgba(255, 255, 255, 0.08);
            cursor: move;
            flex-shrink: 0;
        }
        .idb_title {
            font-size: 9.5px;
            font-weight: 700;
            letter-spacing: 0.08em;
            text-transform: uppercase;
            color: rgba(255, 255, 255, 0.6);
            display: flex;
            align-items: center;
            gap: 4px;
        }
        .idb_head_actions {
            display: flex;
            align-items: center;
            gap: 3px;
        }
        .idb_btn {
            background: rgba(255, 255, 255, 0.06);
            border: 1px solid rgba(255, 255, 255, 0.12);
            color: #ccc;
            border-radius: 3px;
            padding: 1px 5px;
            font-size: 9.5px;
            cursor: pointer;
            transition: all 0.12s ease;
            height: 17px;
            display: inline-flex;
            align-items: center;
            justify-content: center;
        }
        .idb_btn:hover {
            background: rgba(255, 255, 255, 0.16);
            color: #fff;
        }
        .idb_toolbar {
            display: flex;
            align-items: center;
            gap: 4px;
            padding: 3px 6px;
            border-bottom: 1px solid rgba(255, 255, 255, 0.06);
            background: rgba(0, 0, 0, 0.25);
            flex-shrink: 0;
        }
        .idb_tabs {
            display: flex;
            gap: 2px;
        }
        .idb_tab {
            padding: 1px 5px;
            border-radius: 3px;
            border: none;
            background: transparent;
            color: #777;
            font-size: 10px;
            font-weight: 600;
            cursor: pointer;
            height: 18px;
            transition: all 0.12s ease;
        }
        .idb_tab.active {
            background: rgba(255, 255, 255, 0.12);
            color: #fff;
        }
        .idb_search {
            flex: 1;
            background: rgba(255, 255, 255, 0.05);
            border: 1px solid rgba(255, 255, 255, 0.08);
            border-radius: 3px;
            color: #eee;
            padding: 1px 5px;
            font-size: 9.5px;
            height: 18px;
            outline: none;
        }
        .idb_search:focus {
            border-color: rgba(255, 255, 255, 0.25);
        }
        .idb_body {
            flex: 0 1 auto;
            overflow-y: auto;
            max-height: calc(100vh - 100px);
            padding: 2px 4px;
        }
        .idb_empty {
            text-align: center;
            color: #666;
            padding: 12px 6px;
            font-size: 9.5px;
            font-style: italic;
        }
        .idb_item {
            background: transparent;
            border: 1px solid transparent;
            border-radius: 3px;
            padding: 2px 5px;
            margin: 0 0 1px;
            min-height: 18px;
            display: flex;
            align-items: center;
            cursor: default;
            transition: background 0.1s ease, border-color 0.1s ease;
        }
        .idb_item:hover, .idb_item.active_hover {
            background: rgba(255, 255, 255, 0.08);
            border-color: rgba(255, 255, 255, 0.14);
        }
        .idb_item_header {
            width: 100%;
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 4px;
            line-height: 1;
        }
        .idb_item_key {
            font-size: 10.5px;
            font-weight: 500;
            color: #58a6ff;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            max-width: 165px;
        }
        .idb_badge {
            background: rgba(255, 255, 255, 0.08);
            border-radius: 3px;
            padding: 1px 4px;
            font-size: 9px;
            line-height: 1;
            color: rgba(255, 255, 255, 0.6);
            flex-shrink: 0;
        }
        .idb_footer {
            padding: 3px 6px;
            background: rgba(0, 0, 0, 0.25);
            border-top: 1px solid rgba(255, 255, 255, 0.06);
            display: flex;
            align-items: center;
            justify-content: space-between;
            font-size: 9.5px;
            color: #777;
            flex-shrink: 0;
        }

        /* ── Floating Hover Preview Tooltip ───────────────────────── */
        #idb_hover_tooltip {
            position: fixed;
            left: 283px;
            top: 12px;
            width: 360px;
            max-width: calc(100vw - 295px);
            height: auto;
            max-height: calc(100vh - 24px);
            background: rgba(12, 12, 18, 0.96);
            backdrop-filter: blur(14px);
            -webkit-backdrop-filter: blur(14px);
            border: 1px solid rgba(88, 166, 255, 0.35);
            border-radius: 8px;
            box-shadow: 0 12px 36px rgba(0, 0, 0, 0.75);
            padding: 6px 8px;
            font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
            font-size: 10px;
            line-height: 1.35;
            color: #a5d6ff;
            z-index: 100001;
            pointer-events: auto;
            display: none;
            flex-direction: column;
            box-sizing: border-box;
            overflow: hidden;
        }
        #idb_hover_tooltip * {
            box-sizing: border-box;
        }
        .idb_tooltip_header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 6px;
            padding-bottom: 3px;
            margin-bottom: 4px;
            border-bottom: 1px solid rgba(255, 255, 255, 0.08);
            flex-shrink: 0;
            line-height: 1;
        }
        .idb_tooltip_title {
            font-size: 10px;
            font-weight: 700;
            color: #58a6ff;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }
        .idb_tooltip_actions {
            display: flex;
            align-items: center;
            gap: 5px;
            flex-shrink: 0;
        }
        .idb_tooltip_badge {
            font-size: 9px;
            color: rgba(255, 255, 255, 0.55);
        }
        .idb_tooltip_pin {
            background: none;
            border: none;
            cursor: pointer;
            font-size: 10px;
            padding: 0 2px;
            opacity: 0.75;
            transition: opacity 0.15s, transform 0.15s;
            line-height: 1;
        }
        .idb_tooltip_pin:hover {
            opacity: 1;
            transform: scale(1.2);
        }
        .idb_tooltip_content {
            flex: 1 1 auto;
            min-height: 0;
            overflow-y: auto;
            overflow-x: auto;
            white-space: pre;
            user-select: text;
            padding-right: 2px;
        }

        /* ── Pinned Cards Container (Top Right Stack) ─────────────── */
        #idb_pinned_container {
            position: fixed;
            top: 12px;
            right: 12px;
            z-index: 99999;
            display: flex;
            flex-direction: row-reverse;
            gap: 8px;
            pointer-events: none;
            max-width: calc(100vw - 290px);
        }
        .idb_pinned_card {
            pointer-events: auto;
            width: 360px;
            height: 300px;
            background: rgba(10, 10, 16, 0.94);
            backdrop-filter: blur(12px);
            -webkit-backdrop-filter: blur(12px);
            border: 1px solid rgba(88, 166, 255, 0.35);
            border-radius: 8px;
            box-shadow: 0 10px 30px rgba(0, 0, 0, 0.65);
            padding: 6px 8px;
            display: flex;
            flex-direction: column;
            box-sizing: border-box;
            font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
            font-size: 10px;
            line-height: 1.35;
            color: #a5d6ff;
            user-select: text;
            overflow: hidden;
            animation: idb_pin_in 0.2s cubic-bezier(0.16, 1, 0.3, 1);
        }
        @keyframes idb_pin_in {
            from {
                opacity: 0;
                transform: translateY(-8px) scale(0.96);
            }
            to {
                opacity: 1;
                transform: translateY(0) scale(1);
            }
        }
        .idb_pinned_header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 5px;
            padding-bottom: 3px;
            margin-bottom: 4px;
            border-bottom: 1px solid rgba(255, 255, 255, 0.08);
            flex-shrink: 0;
            line-height: 1;
        }
        .idb_pinned_title {
            font-size: 10px;
            font-weight: 700;
            color: #58a6ff;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            display: flex;
            align-items: center;
            gap: 4px;
        }
        .idb_pinned_actions {
            display: flex;
            align-items: center;
            gap: 4px;
            flex-shrink: 0;
        }
        .idb_pinned_badge {
            font-size: 9px;
            color: rgba(255, 255, 255, 0.55);
        }
        .idb_pinned_close {
            background: none;
            border: none;
            color: #777;
            cursor: pointer;
            padding: 0 2px;
            font-size: 10px;
            line-height: 1;
            border-radius: 3px;
            display: inline-flex;
            align-items: center;
            justify-content: center;
        }
        .idb_pinned_close:hover {
            color: #ff7b72;
            background: rgba(248, 81, 73, 0.25);
        }
        .idb_pinned_content {
            flex: 1 1 auto;
            min-height: 0;
            overflow-y: auto;
            overflow-x: auto;
            white-space: pre;
            padding-right: 2px;
        }

        /* Custom Scrollbars */
        .idb_tooltip_content::-webkit-scrollbar,
        .idb_pinned_content::-webkit-scrollbar,
        .idb_body::-webkit-scrollbar {
            width: 4px;
            height: 4px;
        }
        .idb_tooltip_content::-webkit-scrollbar-thumb,
        .idb_pinned_content::-webkit-scrollbar-thumb,
        .idb_body::-webkit-scrollbar-thumb {
            background: rgba(255, 255, 255, 0.2);
            border-radius: 2px;
        }
    `;
    document.head.appendChild(style);

    trackerContainer = document.createElement("div");
    trackerContainer.id = "idb_tracker_overlay";
    trackerContainer.innerHTML = `
        <div class="idb_head" id="idb_drag_handle">
            <span class="idb_title">⚡ BakoDB Live</span>
            <div class="idb_head_actions">
                <button class="idb_btn" id="idb_btn_refresh" title="Làm mới">↻</button>
                <button class="idb_btn" id="idb_btn_close" title="Đóng">✕</button>
            </div>
        </div>
        <div class="idb_toolbar">
            <div class="idb_tabs">
                <button class="idb_tab active" data-tab="appData" id="idb_tab_appData">appData</button>
                <button class="idb_tab" data-tab="mediaData" id="idb_tab_mediaData">mediaData</button>
            </div>
            <input type="text" class="idb_search" id="idb_search_input" placeholder="Lọc..." autocomplete="off" />
        </div>
        <div class="idb_body" id="idb_body_content">
            <div class="idb_empty">Đang tải...</div>
        </div>
        <div class="idb_footer">
            <label style="display:flex;align-items:center;gap:3px;cursor:pointer;">
                <input type="checkbox" id="idb_check_auto" checked style="margin:0;transform:scale(0.85);" />
                <span>Tự động (1.5s)</span>
            </label>
            <span id="idb_status_summary">0 mục</span>
        </div>
    `;
    document.body.appendChild(trackerContainer);

    // Create persistent hover tooltip
    hoverTooltip = document.createElement("div");
    hoverTooltip.id = "idb_hover_tooltip";
    document.body.appendChild(hoverTooltip);

    // Create container for pinned cards at top-right
    pinnedContainer = document.createElement("div");
    pinnedContainer.id = "idb_pinned_container";
    document.body.appendChild(pinnedContainer);

    // Keep tooltip alive when mouse moves into it to scroll plaintext
    hoverTooltip.addEventListener("mouseenter", () => {
        cancelHideTooltip();
    });
    hoverTooltip.addEventListener("mouseleave", () => {
        scheduleHideTooltip();
    });

    // Wire events
    const closeBtn = trackerContainer.querySelector("#idb_btn_close");
    closeBtn?.addEventListener("click", () => {
        saveSettings({ debugIdbTracker: false });
    });

    const refreshBtn = trackerContainer.querySelector("#idb_btn_refresh");
    refreshBtn?.addEventListener("click", () => {
        refreshData();
        updatePinnedCards();
    });

    const tabAppData = trackerContainer.querySelector("#idb_tab_appData");
    const tabMediaData = trackerContainer.querySelector("#idb_tab_mediaData");

    tabAppData?.addEventListener("click", () => {
        activeTab = "appData";
        tabAppData.classList.add("active");
        tabMediaData.classList.remove("active");
        hideTooltipNow();
        refreshData();
    });

    tabMediaData?.addEventListener("click", () => {
        activeTab = "mediaData";
        tabMediaData.classList.add("active");
        tabAppData.classList.remove("active");
        hideTooltipNow();
        refreshData();
    });

    const searchInput = trackerContainer.querySelector("#idb_search_input");
    searchInput?.addEventListener("input", (e) => {
        searchQuery = (e.target.value || "").trim().toLowerCase();
        refreshData();
    });

    const autoCheck = trackerContainer.querySelector("#idb_check_auto");
    autoCheck?.addEventListener("change", (e) => {
        autoPoll = e.target.checked;
        if (autoPoll) {
            startPolling();
        } else {
            stopPolling();
        }
    });

    makeDraggable(trackerContainer, trackerContainer.querySelector("#idb_drag_handle"));
}

function showTooltip(key, val) {
    if (!hoverTooltip) return;
    const summary = getValueSummary(val);
    const contentText = formatValueContent(val);
    const isPinned = pinnedCards.has(key);

    hoverTooltip.innerHTML = `
        <div class="idb_tooltip_header">
            <span class="idb_tooltip_title" title="${key}">${key}</span>
            <div class="idb_tooltip_actions">
                <span class="idb_tooltip_badge">${summary}</span>
                <button class="idb_tooltip_pin" id="idb_btn_pin" title="${isPinned ? 'Bỏ ghim' : 'Ghim ra góc phải'}">${isPinned ? '📌' : '📍'}</button>
            </div>
        </div>
        <div class="idb_tooltip_content">${escapeHtml(contentText)}</div>
    `;

    const pinBtn = hoverTooltip.querySelector("#idb_btn_pin");
    pinBtn?.addEventListener("click", () => {
        togglePin(key, activeTab, val);
        hideTooltipNow();
    });

    const trackerRect = trackerContainer?.getBoundingClientRect() || { right: 277, top: 12 };
    let left = trackerRect.right + 4;
    if (left + 360 > window.innerWidth) {
        left = Math.max(8, trackerRect.left - 370);
    }

    hoverTooltip.style.left = `${left}px`;
    hoverTooltip.style.top = `${trackerRect.top}px`;
    hoverTooltip.style.display = "flex";
}

function togglePin(key, storeName, val) {
    if (pinnedCards.has(key)) {
        unpinKey(key);
        return;
    }

    if (pinnedCards.size >= MAX_PINS) {
        // Drop the oldest pinned card
        const oldestKey = pinnedCards.keys().next().value;
        unpinKey(oldestKey);
    }

    createPinnedCard(key, storeName, val);
}

function unpinKey(key) {
    const entry = pinnedCards.get(key);
    if (entry) {
        entry.element.remove();
        pinnedCards.delete(key);
    }
}

function createPinnedCard(key, storeName, val) {
    if (!pinnedContainer) return;

    const summary = getValueSummary(val);
    const contentText = formatValueContent(val);

    const cardEl = document.createElement("div");
    cardEl.className = "idb_pinned_card";
    cardEl.innerHTML = `
        <div class="idb_pinned_header">
            <span class="idb_pinned_title" title="${key}">📌 ${key}</span>
            <div class="idb_pinned_actions">
                <span class="idb_pinned_badge">${summary}</span>
                <button class="idb_pinned_close" title="Bỏ ghim">✕</button>
            </div>
        </div>
        <div class="idb_pinned_content">${escapeHtml(contentText)}</div>
    `;

    const closeBtn = cardEl.querySelector(".idb_pinned_close");
    const badgeEl = cardEl.querySelector(".idb_pinned_badge");
    const contentEl = cardEl.querySelector(".idb_pinned_content");

    closeBtn?.addEventListener("click", () => {
        unpinKey(key);
    });

    pinnedCards.set(key, {
        element: cardEl,
        badgeEl,
        contentEl,
        storeName,
        key,
    });

    pinnedContainer.appendChild(cardEl);
}

async function updatePinnedCards() {
    if (pinnedCards.size === 0) return;

    for (const [key, entry] of pinnedCards.entries()) {
        try {
            const val = await getFromStore(key, entry.storeName);
            if (entry.badgeEl) entry.badgeEl.textContent = getValueSummary(val);
            if (entry.contentEl) {
                const newText = formatValueContent(val);
                if (entry.contentEl.textContent !== newText) {
                    entry.contentEl.innerHTML = escapeHtml(newText);
                }
            }
        } catch (e) {
            console.warn("[IDB Tracker] Error updating pinned card:", e);
        }
    }
}

function escapeHtml(str) {
    return str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

/**
 * Make an element draggable by its handle.
 */
function makeDraggable(element, handle) {
    let offsetX = 0, offsetY = 0, startX = 0, startY = 0;
    handle.onmousedown = (e) => {
        if (e.target.tagName === "BUTTON") return;
        e.preventDefault();
        startX = e.clientX;
        startY = e.clientY;
        const rect = element.getBoundingClientRect();
        offsetX = rect.left;
        offsetY = rect.top;

        document.onmousemove = (moveEvent) => {
            const dx = moveEvent.clientX - startX;
            const dy = moveEvent.clientY - startY;
            element.style.bottom = "auto";
            element.style.right = "auto";
            element.style.left = `${Math.max(6, Math.min(window.innerWidth - element.offsetWidth - 6, offsetX + dx))}px`;
            element.style.top = `${Math.max(6, Math.min(window.innerHeight - element.offsetHeight - 6, offsetY + dy))}px`;
            hideTooltipNow();
        };

        document.onmouseup = () => {
            document.onmousemove = null;
            document.onmouseup = null;
        };
    };
}

/**
 * Fetch and render records from IndexedDB.
 */
async function refreshData() {
    if (!trackerContainer || trackerContainer.style.display === "none") return;

    const bodyEl = trackerContainer.querySelector("#idb_body_content");
    const statusSummary = trackerContainer.querySelector("#idb_status_summary");
    if (!bodyEl) return;

    try {
        const records = (await getAllFromStore(activeTab)) || [];
        let filtered = records;
        if (searchQuery) {
            filtered = records.filter(r => (r?.key || "").toLowerCase().includes(searchQuery));
        }

        if (statusSummary) {
            statusSummary.textContent = `${filtered.length} / ${records.length} mục`;
        }

        if (filtered.length === 0) {
            bodyEl.innerHTML = `<div class="idb_empty">${searchQuery ? "Không khớp" : `Store trống`}</div>`;
            return;
        }

        const fragment = document.createDocumentFragment();
        filtered.forEach(record => {
            const itemKey = record.key;
            const itemVal = record.value;
            const summary = getValueSummary(itemVal);

            const itemEl = document.createElement("div");
            itemEl.className = "idb_item";

            // Hover to inspect JSON
            itemEl.addEventListener("mouseenter", () => {
                cancelHideTooltip();
                if (activeHoveredItem && activeHoveredItem !== itemEl) {
                    activeHoveredItem.classList.remove("active_hover");
                }
                activeHoveredItem = itemEl;
                itemEl.classList.add("active_hover");
                showTooltip(itemKey, itemVal);
            });

            itemEl.addEventListener("mouseleave", () => {
                scheduleHideTooltip();
            });

            const headerEl = document.createElement("div");
            headerEl.className = "idb_item_header";

            const keyEl = document.createElement("span");
            keyEl.className = "idb_item_key";
            keyEl.textContent = itemKey;
            keyEl.title = itemKey;

            const badgeEl = document.createElement("span");
            badgeEl.className = "idb_badge";
            badgeEl.textContent = summary;

            headerEl.appendChild(keyEl);
            headerEl.appendChild(badgeEl);
            itemEl.appendChild(headerEl);

            fragment.appendChild(itemEl);
        });

        bodyEl.replaceChildren(fragment);
    } catch (err) {
        console.error("IDB Tracker error:", err);
        bodyEl.innerHTML = `<div class="idb_empty" style="color:#ff7b72;">Lỗi: ${err.message || err}</div>`;
    }
}
