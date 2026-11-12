import { t, translateDOM } from "/src/core/i18n.js";
import { renderIcons } from "/src/core/icon.js";
import {
    getSettings,
    saveSettings,
    DEFAULT_COLLECTION_SOURCE_ORDER,
} from "/src/core/storageHandler.js";
import { initButtons } from "/src/core/ui/button.js";
import { setDropdownValue } from "/src/core/ui/dropdown.js";
import { createSlider } from "/src/core/ui/slider.js";

/**
 * CollectionSidebar.js
 * ---------------------------------------------------------------------------
 * Form panel for Collection provider settings (ordering, video sound & volume).
 * Changes take effect and persist immediately without requiring an Apply button.
 */
export function createCollectionSidebar({ dataControl }) {
    const form = document.createElement("div");
    form.className = "source_sidebar_form collection_sidebar_form";

    form.innerHTML = `
        <div class="source_sidebar_section">
            <span class="source_sidebar_section_title" data-i18n="sp.api.collection.sort_title"></span>
            <select class="native_select" id="coll_sidebar_sort_mode">
                <option value="effects" data-i18n="sp.api.collection.sort_effects"></option>
                <option value="video" data-i18n="sp.api.collection.sort_video"></option>
                <option value="date" data-i18n="sp.api.collection.sort_date"></option>
                <option value="source" data-i18n="sp.api.collection.sort_source"></option>
            </select>
        </div>
        <div class="source_sidebar_section hidden" id="coll_sidebar_sort_date_section">
            <label class="btn" data-action="toggle">
                <div class="btn_body">
                    <span class="btn_title" data-i18n="sp.api.collection.sort_oldest"></span>
                    <span class="btn_desc" data-i18n="sp.api.collection.sort_oldest_desc"></span>
                </div>
                <input type="checkbox" id="coll_sidebar_sort_oldest" />
            </label>
        </div>
        <div class="source_sidebar_section hidden" id="coll_sidebar_sort_source_section">
            <span class="source_sidebar_section_title" data-i18n="sp.api.collection.sort_source_order"></span>
            <ul class="coll_sort_order" id="coll_sidebar_source_order"></ul>
        </div>
        <div class="source_sidebar_section">
            <label class="btn" data-action="toggle">
                <div class="btn_body">
                    <span class="btn_title" data-i18n="sp.api.collection.video_sound"></span>
                    <span class="btn_desc" data-i18n="sp.api.collection.video_sound_desc"></span>
                </div>
                <input type="checkbox" id="coll_sidebar_video_sound" />
            </label>
        </div>
        <div class="source_sidebar_section" id="coll_sidebar_volume_section"></div>
    `;

    translateDOM(form);
    renderIcons(form);
    initButtons(form);

    const sortSelect = form.querySelector("#coll_sidebar_sort_mode-native");
    const dateSection = form.querySelector("#coll_sidebar_sort_date_section");
    const sourceSection = form.querySelector(
        "#coll_sidebar_sort_source_section",
    );
    const oldestCheckbox = form.querySelector("#coll_sidebar_sort_oldest");
    const orderList = form.querySelector("#coll_sidebar_source_order");
    const volumeSection = form.querySelector("#coll_sidebar_volume_section");
    const soundCheckbox = form.querySelector("#coll_sidebar_video_sound");

    /* ── Settings helpers ─────────────────────────────────────────────────── */

    function currentConfig() {
        return getSettings().collectionConfig || {};
    }

    /** Persist a partial config without dropping the keys we did not touch. */
    function saveConfig(patch) {
        saveSettings({
            collectionConfig: { ...currentConfig(), ...patch },
        });
    }

    /** Re-apply the ordering right away when the Collection is on screen. */
    async function resortCollection() {
        if (dataControl?.activeSourceId !== "collection") return;
        try {
            await dataControl.sortActiveItems();
        } catch (err) {
            console.error("[CollectionSidebar] Failed to re-sort:", err);
        }
    }

    /* ── Sort mode ────────────────────────────────────────────────────────── */

    function syncSortSections() {
        const mode = sortSelect.value;
        dateSection.classList.toggle("hidden", mode !== "date");
        sourceSection.classList.toggle("hidden", mode !== "source");
    }

    sortSelect.addEventListener("change", () => {
        // Keep the visible dropdown in step even when the value is written
        // programmatically (picks through the custom UI already sync it).
        setDropdownValue(sortSelect, sortSelect.value);
        saveConfig({ sortMode: sortSelect.value });
        syncSortSections();
        void resortCollection();
    });

    oldestCheckbox.addEventListener("change", () => {
        saveConfig({ sortOldestFirst: oldestCheckbox.checked });
        void resortCollection();
    });

    /* ── Source priority list (drag to reorder) ───────────────────────────── */

    function getSourceOrder() {
        const stored = currentConfig().sourceOrder;
        const known = DEFAULT_COLLECTION_SOURCE_ORDER;
        const list = Array.isArray(stored) ? stored : [];
        // Keep the known ids in their stored order, then append any group the
        // stored array forgot so the list always holds all five exactly once.
        const order = list.filter((id) => known.includes(id));
        known.forEach((id) => {
            if (!order.includes(id)) order.push(id);
        });
        return order;
    }

    function sourceLabel(id) {
        return t(`wallpaper_switcher.source.${id}`, id);
    }

    function renderSourceOrder() {
        // Drop any in-flight snap from a previous render.
        rowSnaps.forEach((snap) => snap.cancel());
        rowSnaps.clear();

        const rows = getSourceOrder().map((id) => {
            const row = document.createElement("li");
            // Reuse the shared bar-button chrome: hover/active come from `.btn`.
            row.className = "btn coll_sort_row";
            row.dataset.source = id;
            row.tabIndex = 0;
            row.title = t(
                "sp.api.collection.sort_reorder_hint",
                "Kéo để đổi thứ tự ưu tiên",
            );
            row.innerHTML = `
                <span class="coll_sort_grip" aria-hidden="true"><i data-icon="dragHandle"></i></span>
                <span class="coll_sort_label"></span>
            `;
            row.querySelector(".coll_sort_label").textContent = sourceLabel(id);
            return row;
        });
        orderList.replaceChildren(...rows);
        renderIcons(orderList);
    }

    function commitSourceOrder() {
        const order = Array.from(orderList.children).map(
            (row) => row.dataset.source,
        );
        saveConfig({ sourceOrder: order });
        void resortCollection();
    }

    /** Duration of the list snap, matching `--expo_out` for the curve. */
    const LIST_SNAP_MS = 400;
    const LIST_SNAP_EASE = "cubic-bezier(0.19, 1, 0.22, 1)";

    function prefersReducedMotion() {
        return (
            window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ===
            true
        );
    }

    /** Snapshot where each row sits, so the list can snap into place later. */
    function captureRowRects() {
        const rects = new Map();
        orderList.querySelectorAll(".coll_sort_row").forEach((row) => {
            rects.set(row.dataset.source, row.getBoundingClientRect());
        });
        return rects;
    }

    /** Same snapshot, minus the row that is following the pointer. */
    function captureSiblingRects(draggedRow) {
        const rects = new Map();
        orderList.querySelectorAll(".coll_sort_row").forEach((row) => {
            if (row === draggedRow) return;
            rects.set(row.dataset.source, row.getBoundingClientRect());
        });
        return rects;
    }

    /** Running snaps per row, so a new slide replaces the old one cleanly. */
    const rowSnaps = new Map();

    /** FLIP the whole list from `previousRects` to its current layout. */
    function snapRows(previousRects) {
        if (prefersReducedMotion()) return;

        orderList.querySelectorAll(".coll_sort_row").forEach((row) => {
            const previous = previousRects.get(row.dataset.source);
            if (!previous) return;
            // Read before cancelling: the live animation's offset is part of it.
            const dy = previous.top - row.getBoundingClientRect().top;
            if (Math.abs(dy) < 1) return;

            rowSnaps.get(row)?.cancel();
            const snap = row.animate(
                [
                    { transform: `translateY(${dy}px)` },
                    { transform: "translateY(0)" },
                ],
                { duration: LIST_SNAP_MS, easing: LIST_SNAP_EASE },
            );
            rowSnaps.set(row, snap);
            snap.addEventListener(
                "finish",
                () => {
                    if (rowSnaps.get(row) === snap) rowSnaps.delete(row);
                },
                { once: true },
            );
        });
    }

    /** Keyboard reordering: the grip itself is pointer-only. */
    function moveRowWithKeyboard(row, direction) {
        const sibling =
            direction < 0 ? row.previousElementSibling : row.nextElementSibling;
        if (!sibling) return;
        const previousRects = captureRowRects();
        if (direction < 0) orderList.insertBefore(row, sibling);
        else orderList.insertBefore(sibling, row);
        row.focus({ preventScroll: true });
        snapRows(previousRects);
        commitSourceOrder();
    }

    orderList.addEventListener("keydown", (e) => {
        const row = e.target.closest(".coll_sort_row");
        if (!row) return;
        if (e.key === "ArrowUp") {
            e.preventDefault();
            moveRowWithKeyboard(row, -1);
        } else if (e.key === "ArrowDown") {
            e.preventDefault();
            moveRowWithKeyboard(row, 1);
        }
    });

    // Pointer drag: the grabbed row follows the cursor while its siblings close
    // the gap, then the new order is persisted on release.
    let drag = null;

    orderList.addEventListener("pointerdown", (e) => {
        if (e.pointerType === "mouse" && e.button !== 0) return;
        const row = e.target.closest(".coll_sort_row");
        if (!row) return;

        e.preventDefault();
        const rect = row.getBoundingClientRect();
        drag = { row, grabOffset: e.clientY - rect.top, translate: 0 };
        row.classList.add("is-dragging");
        row.focus({ preventScroll: true });
    });

    window.addEventListener("pointermove", (e) => {
        if (!drag) return;
        const { row } = drag;

        // Slot under the pointer: insert before the first row whose midpoint is
        // still below the cursor, otherwise at the end.
        let target = null;
        for (const other of orderList.children) {
            if (other === row) continue;
            const rect = other.getBoundingClientRect();
            if (e.clientY < rect.top + rect.height / 2) {
                target = other;
                break;
            }
        }
        if (target) {
            if (row.nextElementSibling !== target) {
                const previousRects = captureSiblingRects(row);
                orderList.insertBefore(row, target);
                snapRows(previousRects);
            }
        } else if (orderList.lastElementChild !== row) {
            const previousRects = captureSiblingRects(row);
            orderList.appendChild(row);
            snapRows(previousRects);
        }

        // Keep the grabbed point under the cursor, compensating for the layout
        // position the row just moved to.
        const rect = row.getBoundingClientRect();
        const layoutTop = rect.top - drag.translate;
        drag.translate = e.clientY - drag.grabOffset - layoutTop;
        row.style.transform = `translateY(${drag.translate}px)`;
    });

    function endDrag() {
        if (!drag) return;
        const { row } = drag;
        // Capture before clearing the grab transform so the row snaps from the
        // place it was released, and the rest of the list from its old slots.
        const previousRects = captureRowRects();
        // Reset the offset without letting the `.btn` transition animate it;
        // the snap below owns that motion.
        row.style.transition = "none";
        row.classList.remove("is-dragging");
        row.style.removeProperty("transform");
        drag = null;
        snapRows(previousRects);
        requestAnimationFrame(() => row.style.removeProperty("transition"));
        commitSourceOrder();
    }

    window.addEventListener("pointerup", endDrag);
    window.addEventListener("pointercancel", endDrag);

    /* ── Audio ────────────────────────────────────────────────────────────── */

    function updateVolumeDisabledState(enabled) {
        volumeSection.classList.toggle("disabled_section", !enabled);
        volumeSlider.setDisabled(!enabled);
    }

    const volumeSlider = createSlider({
        label: t("sp.api.collection.video_volume", "Âm lượng video"),
        dataI18n: "sp.api.collection.video_volume",
        min: 0,
        max: 100,
        step: 5,
        value: 100,
        defaultValue: 100,
        unit: "%",
        onCommit: (val) => {
            saveConfig({ videoVolume: val / 100 });
        },
    });
    volumeSection.appendChild(volumeSlider);

    soundCheckbox.addEventListener("change", () => {
        updateVolumeDisabledState(soundCheckbox.checked);
        saveConfig({ videoSound: soundCheckbox.checked });
    });

    /* ── Sync from settings ───────────────────────────────────────────────── */

    const SORT_MODES = ["effects", "video", "date", "source"];

    function syncFromSettings() {
        const cfg = currentConfig();

        const sortMode = SORT_MODES.includes(cfg.sortMode)
            ? cfg.sortMode
            : "effects";
        // Keeps the hidden select (the value store) and the visible dropdown
        // label in step.
        setDropdownValue(sortSelect, sortMode);
        syncSortSections();

        oldestCheckbox.checked = cfg.sortOldestFirst === true;
        renderSourceOrder();

        const sound = Boolean(cfg.videoSound);
        const vol = typeof cfg.videoVolume === "number" ? cfg.videoVolume : 1;
        soundCheckbox.checked = sound;
        volumeSlider.setValueNoAnim(Math.round(vol * 100));
        updateVolumeDisabledState(sound);
    }

    return {
        el: form,
        onOpen: syncFromSettings,
        onClose: () => {},
    };
}

