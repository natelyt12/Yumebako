import "./manage.css";
import { t, translateDOM } from "/src/core/i18n.js";
import { renderIcons } from "/src/core/icon.js";
import { showConfirm, showNotification } from "/src/core/ui.js";
import { subscribe } from "/src/core/storageHandler.js";
import {
  formatFileSize,
  formatResolution,
  getResolutionBadge,
  escapeHtml,
} from "../../../backend/sources/cardMeta.js";
import { getCollection } from "../../../backend/sources/api/collectionDb.js";
import {
  isCardInCollection,
  addCardsToCollection,
} from "../../../backend/sources/sourceActions.js";
import {
  getCardCustomizations,
  sortCardsByCustomizations,
} from "../../customize/state.js";
import { EFFECT_SETTING_KEYS } from "../../customize/catalog.js";

/**
 * manageGrid.js
 * ---------------------------------------------------------------------------
 * Layer 1 (UI) manage view of the Wallpaper Switcher, built from the card
 * logic of the pre-carousel `collectionUi.js`.
 *
 * Layout:
 *   - toolbar pinned above (collection only), detached from the scrolling grid;
 *   - body: 70/30 split — card grid on the left, selected card detail on the
 *     right. In select-many mode the detail pane hides and the grid fills it.
 *
 * Cards show three distinct states:
 *   - applied to the desktop: bright ring + a check in the caption;
 *   - selected for preview: the same bright ring, but no check;
 *   - selected in select-many mode: a numbered badge in the middle.
 *
 * Every mutation goes through `DataControl` (`setHardIndex`, `deleteCard`) as
 * the architecture requires; no direct database access here.
 */

/**
 * Render the "applied customizations" icon strip shared by the card caption and
 * the detail pane, so both stay visually consistent and share one markup path.
 *
 * @param {Array<{ id: string, icon: string, label: string }>} customs
 * @param {Object} options
 * @param {string}  options.containerClass - Class for the wrapper span.
 * @param {string}  options.itemClass      - Class for each icon item span.
 * @param {boolean} [options.containerTitle=false] - Put all labels in the wrapper title.
 * @returns {string} HTML, or "" when there is nothing to show.
 */
function buildCustomizationIconsHtml(
  customs,
  { containerClass, itemClass, containerTitle = false },
) {
  if (!customs || customs.length === 0) return "";

  const items = customs
    .map(
      (custom) =>
        `<span class="${itemClass}" title="${escapeHtml(custom.label)}"><i data-icon="${custom.icon}"></i></span>`,
    )
    .join("");
  const titleAttr = containerTitle
    ? ` title="${escapeHtml(customs.map((custom) => custom.label).join(", "))}"`
    : "";

  return `<span class="${containerClass}"${titleAttr}>${items}</span>`;
}

export function createManageGrid({
  dataControl,
  onUpload,
  onFetch,
  onApplied,
  onSettings,
}) {
  const el = document.createElement("div");
  el.className = "manage_view";
  el.innerHTML = `
        <div class="manage_toolbar" hidden>
            <div class="manage_toolbar_group">
                <button type="button" class="btn manage_toolbar_btn" data-manage-action="settings">
                    <i data-icon="settings"></i><span></span>
                </button>
            </div>
            <div class="manage_toolbar_group">
                <button type="button" class="btn manage_toolbar_btn" data-manage-action="upload">
                    <i data-icon="upload"></i><span data-i18n="sp.api.collection.upload_btn">Tải lên ảnh / video</span>
                </button>
                <button type="button" class="btn manage_toolbar_btn" data-manage-action="fetch" hidden>
                    <i data-icon="arrowClockwise"></i><span data-i18n="wallpaper_switcher.get_new_image">Lấy ảnh mới</span>
                </button>
                <button type="button" class="btn manage_toolbar_btn" data-manage-action="add-selected" hidden>
                    <i data-icon="star"></i><span data-i18n="sp.api.collection.add_selected">Thêm mục đã chọn vào bộ sưu tập</span>
                </button>
                <button type="button" class="btn manage_toolbar_btn" data-manage-action="delete-selected" data-variant="danger" hidden>
                    <i data-icon="bulkDelete"></i><span data-i18n="sp.api.collection.delete_selected">Xóa mục đã chọn</span>
                </button>
                <button type="button" class="btn manage_toolbar_btn" data-manage-action="select">
                    <i data-icon="selectMode"></i><span data-i18n="sp.api.collection.select_mode">Chọn nhiều</span>
                </button>
                <button type="button" class="btn manage_toolbar_btn" data-manage-action="cancel-select" hidden>
                    <i data-icon="close"></i><span data-i18n="sp.api.collection.cancel_select_mode">Hủy chọn</span>
                </button>
            </div>
        </div>
        <div class="manage_body">
            <section class="manage_pane manage_pane_grid">
                <div class="manage_grid_empty" hidden>
                    <i data-icon="emptyCollection"></i>
                    <p></p>
                    <span></span>
                </div>
                <div class="manage_grid" role="list"></div>
            </section>
            <aside class="manage_pane manage_pane_detail" aria-hidden="true"></aside>
        </div>
    `;

  const gridEl = el.querySelector(".manage_grid");
  const emptyEl = el.querySelector(".manage_grid_empty");
  const toolbarEl = el.querySelector(".manage_toolbar");
  const detailEl = el.querySelector(".manage_pane_detail");
  const btnSelect = toolbarEl.querySelector('[data-manage-action="select"]');
  const btnCancelSelect = toolbarEl.querySelector(
    '[data-manage-action="cancel-select"]',
  );
  const btnSettings = toolbarEl.querySelector(
    '[data-manage-action="settings"]',
  );
  const btnUpload = toolbarEl.querySelector('[data-manage-action="upload"]');
  const btnFetch = toolbarEl.querySelector('[data-manage-action="fetch"]');
  const btnAddSelected = toolbarEl.querySelector(
    '[data-manage-action="add-selected"]',
  );
  const btnDeleteSelected = toolbarEl.querySelector(
    '[data-manage-action="delete-selected"]',
  );

  /** id → `CardItem` for the cards currently drawn. */
  const cardsById = new Map();
  /** Card picked for the detail pane (not necessarily the applied one). */
  let selectedId = null;
  /** Select-many mode: card clicks toggle membership instead of previewing. */
  let isSelectMode = false;
  /** Insertion-ordered membership; the badge number is the current position. */
  const selectedIds = new Set();
  /** Guards async detail renders so a stale one cannot overwrite a newer one. */
  let detailToken = 0;
  /** Coalesces the burst of events fired by one wallpaper switch into one pass. */
  let activeSyncScheduled = false;
  /** Rendered card ids that already exist in the personal collection. */
  let inCollectionIds = new Set();
  /** Guards async collection-membership refreshes. */
  let collectionToken = 0;

  btnSelect.addEventListener("click", () => enterSelectMode());
  btnCancelSelect.addEventListener("click", () => exitSelectMode());
  btnSettings.addEventListener("click", () => onSettings?.());
  btnUpload.addEventListener("click", () => onUpload?.());
  btnFetch.addEventListener("click", () => onFetch?.());
  btnAddSelected.addEventListener("click", () => addSelectedToCollection());
  btnDeleteSelected.addEventListener("click", () => deleteSelected());

  /** Disable the "get new image" verb while the store is fetching.
   *  The switcher's carousel button does the same; here the grid owns its own
   *  toolbar, so it listens to the store state directly. */
  const syncFetchState = () => {
    const status = dataControl.status;
    const busy = Boolean(dataControl.isBusy || (status && status !== "idle"));
    if (btnFetch.disabled !== busy) btnFetch.disabled = busy;
  };
  dataControl.on("state:change", syncFetchState);
  syncFetchState();

  translateDOM(el);
  renderIcons(el);

  /* ── Rendering ─────────────────────────────────────────────────────────── */

  /**
   * Sắp xếp hình nền trong manage grid:
   * 1. Ưu tiên các hình nền có tùy chỉnh lên đầu danh sách (từ nhiều tùy chỉnh nhất đến ít nhất).
   * 2. Nếu cùng số lượng tùy chỉnh: giữ nguyên thứ tự cơ sở (ảnh mới nhất lên đầu với canGrow sources,
   *    hoặc thứ tự chuẩn của nguồn).
   * @param {Array<Object>} items
   * @returns {Array<Object>}
   */
  function getGridItems(items) {
    const activeId = dataControl.activeCard?.id ?? null;
    let baseList;
    if (dataControl.activeSource?.canGrow) {
      const hasTimestamps = items.some((item) => Number(item?.addedAt) > 0);
      baseList = hasTimestamps
        ? [...items].sort(
            (a, b) => (Number(b?.addedAt) || 0) - (Number(a?.addedAt) || 0),
          )
        : [...items].reverse();
    } else {
      baseList = [...items];
    }
    return sortCardsByCustomizations(baseList, activeId);
  }

  /** True when the cards already drawn match the order computed for `items`. */
  function gridMatchesItems() {
    const display = getGridItems(
      Array.isArray(dataControl.items) ? dataControl.items : [],
    );
    const nodes = gridEl.children;
    if (nodes.length !== display.length) return false;
    for (let i = 0; i < display.length; i++) {
      if (nodes[i]?.dataset?.id !== String(display[i].id)) return false;
    }
    return true;
  }

  const prefersReducedMotion = () =>
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true;

  /** Fade the given cards out and resolve once the leave transition ends. */
  function animateCardsOut(ids) {
    const wanted = new Set(ids.map(String));
    let found = 0;
    gridEl.querySelectorAll(".bg_coll_card").forEach((cardEl) => {
      if (!wanted.has(cardEl.dataset.id)) return;
      cardEl.classList.add("is-removing");
      cardEl.style.pointerEvents = "none";
      found++;
    });
    if (found === 0 || prefersReducedMotion()) return Promise.resolve();
    return new Promise((resolve) => setTimeout(resolve, 250));
  }

  /** Undo a leave animation when the deletion did not go through. */
  function restoreCards(ids) {
    const wanted = new Set(ids.map(String));
    gridEl.querySelectorAll(".bg_coll_card").forEach((cardEl) => {
      if (!wanted.has(cardEl.dataset.id)) return;
      cardEl.classList.remove("is-removing");
      cardEl.style.pointerEvents = "";
    });
  }

  function render() {
    const items = Array.isArray(dataControl.items)
      ? [...dataControl.items]
      : [];
    const displayItems = getGridItems(items);
    const activeId = dataControl.activeCard?.id ?? null;

    cardsById.clear();
    // Membership is re-computed from the collection below; start clean so a
    // previously rendered source cannot leave stale stars behind.
    inCollectionIds = new Set();
    items.forEach((card) => cardsById.set(String(card.id), card));

    // Members removed by another surface (or by our own bulk delete) drop out.
    selectedIds.forEach((id) => {
      if (!cardsById.has(id)) selectedIds.delete(id);
    });

    if (items.length === 0 && isSelectMode) {
      isSelectMode = false;
      selectedIds.clear();
    }

    // Fresh open (or the previewed card disappeared): fall back to the applied
    // wallpaper, never to a selection remembered from an earlier session.
    if (!isSelectMode) {
      if (!selectedId || !cardsById.has(selectedId)) {
        selectedId =
          activeId != null
            ? String(activeId)
            : displayItems[0]
              ? String(displayItems[0].id)
              : null;
      }
      if (!cardsById.has(selectedId)) selectedId = null;
    }

    syncToolbar();
    refreshCollectionMarkers();

    if (items.length === 0) {
      syncEmptyCopy();
      emptyEl.hidden = false;
      gridEl.hidden = true;
      gridEl.replaceChildren();
      renderDetail();
      return;
    }

    emptyEl.hidden = true;
    gridEl.hidden = false;

    const cardElements = displayItems.map((card) => buildCard(card, activeId));
    gridEl.replaceChildren(...cardElements);
    renderIcons(gridEl);
    if (isSelectMode) refreshMultiSelectionUI();
    renderDetail();
  }

  /** Empty state wording follows the active source, like the carousel does. */
  function syncEmptyCopy() {
    const isCollection = dataControl.activeSourceId === "collection";
    emptyEl.querySelector("p").textContent = t(
      "wallpaper_switcher.empty_title",
      "Chưa có hình nền nào",
    );
    emptyEl.querySelector("span").textContent = t(
      isCollection
        ? "wallpaper_switcher.empty_hint_collection"
        : "wallpaper_switcher.empty_hint_remote",
      isCollection
        ? 'Bấm nút "Tải lên ảnh / video" bên trên để thêm hình nền từ thiết bị của bạn'
        : 'Bấm nút "Lấy ảnh mới" bên dưới để bắt đầu quay hình nền',
    );
  }

  /* ── Card ──────────────────────────────────────────────────────────────── */

  /**
   * @param {import("/src/wallpaper/backend/data/DataControl.js").CardItem} card
   * @param {string|null} activeId
   * @returns {HTMLElement}
   */
  function buildCard(card, activeId) {
    const isActive = activeId != null && String(card.id) === String(activeId);

    const cardEl = document.createElement("article");
    cardEl.className = "bg_coll_card";
    cardEl.dataset.id = String(card.id);
    cardEl.setAttribute("role", "listitem");
    cardEl.tabIndex = 0;
    if (isActive) cardEl.classList.add("bg_coll_card_active");
    if (!isSelectMode && String(card.id) === selectedId) {
      cardEl.classList.add("is-selected");
    }

    /* Thumbnail */
    const thumbWrapper = document.createElement("div");
    thumbWrapper.className = "bg_coll_thumb_wrapper";
    thumbWrapper.appendChild(buildThumb(card));

    /* Hover overlay: the apply action only. Everything else lives in the
       detail pane on the right. */
    const actions = document.createElement("div");
    actions.className = "bg_coll_card_actions";
    actions.append(buildApplyButton(card, isActive));
    thumbWrapper.appendChild(actions);

    /* Caption: check (when applied) + badge + resolution, size on the right. */
    const info = document.createElement("div");
    info.className = "bg_coll_info";
    info.innerHTML = buildInfoHtml(card, isActive);

    cardEl.append(thumbWrapper, info);

    cardEl.addEventListener("click", () => {
      if (isSelectMode) toggleMultiSelect(card.id);
      else selectCard(card.id);
    });
    cardEl.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault();
      if (isSelectMode) toggleMultiSelect(card.id);
      else selectCard(card.id);
    });

    return cardEl;
  }

  const isVideoCard = (card) =>
    card?.mediaType === "video" || Boolean(card?.type?.includes("video"));

  function buildInfoHtml(card, isActive) {
    const isVideo = isVideoCard(card);
    const size = formatFileSize(card.size);
    // Video has no resolution: the word "Video" takes its place.
    const badge = isVideo ? "" : getResolutionBadge(card.width, card.height);
    const mainLabel = isVideo
      ? t("sp.api.collection.typeVideo", "Video")
      : formatResolution(card.width, card.height);
    const isVideoLabel = isVideo ? " is-video" : "";

    const inCollection = inCollectionIds.has(String(card.id));
    const left = [
      isActive
        ? `<i data-icon="particleCheck" class="bg_coll_info_check"></i>`
        : "",
      inCollection
        ? `<span class="bg_coll_info_star"><i data-icon="starFill"></i></span>`
        : "",
      badge ? `<span class="meta_badge">${escapeHtml(badge)}</span>` : "",
      mainLabel
        ? `<span class="bg_coll_info_res${isVideoLabel}">${escapeHtml(mainLabel)}</span>`
        : "",
    ].join("");

    const customs = getCardCustomizations(card, isActive);
    const customsHtml = buildCustomizationIconsHtml(customs, {
      containerClass: "bg_coll_info_customs",
      itemClass: "bg_coll_info_custom_icon",
      containerTitle: true,
    });

    return `<span class="bg_coll_info_meta">${left}</span><span class="bg_coll_info_right">${customsHtml}<span class="bg_coll_info_size">${escapeHtml(size)}</span></span>`;
  }

  function buildThumb(card) {
    if (card.thumbnailUrl) {
      const img = document.createElement("img");
      img.className = "bg_coll_thumb";
      img.alt = card.title || "";
      img.loading = "lazy";
      img.decoding = "async";
      img.src = card.thumbnailUrl;
      img.addEventListener(
        "error",
        () => img.replaceWith(buildFallbackThumb(card)),
        {
          once: true,
        },
      );
      return img;
    }
    return buildFallbackThumb(card);
  }

  function buildFallbackThumb(card) {
    const box = document.createElement("div");
    box.className = "bg_coll_thumb bg_coll_no_thumb";
    box.innerHTML = `<i data-icon="${isVideoCard(card) ? "videoBadge" : "imageBadge"}"></i>`;
    return box;
  }

  /* ── Apply ("Set as wallpaper") ───────────────────────────────────────── */

  function buildApplyButton(card, isActive) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn bg_coll_set_btn";
    syncApplyButton(btn, isActive);

    // Always bound: a card can stop being the applied one later, and its button
    // must work again without a full grid rebuild.
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (String(dataControl.activeCard?.id) === String(card.id)) return;

      try {
        // Layer 2 owns the switch; the renderer listens for `card:hard`.
        const targetIndex = dataControl.items.findIndex(
          (item) => String(item.id) === String(card.id),
        );
        dataControl.setHardIndex(targetIndex);
        // The carousel strip does not know about grid-driven switches; ask the
        // owner to re-centre it on the card we just applied.
        onApplied?.(targetIndex);
        // Patch the two affected cards in place: rebuilding the strip here would
        // replace the hovered overlay and restart its transition.
        syncActiveCards(dataControl.activeCard?.id ?? null);
        selectCard(card.id);
      } catch (err) {
        console.error("[ManageGrid] Failed to apply card:", err);
        showNotification(
          t("sp.api.collection.apply_error", "Lỗi khi áp dụng hình nền"),
          "error",
        );
        syncActiveCards(dataControl.activeCard?.id ?? null);
      }
    });

    return btn;
  }

  /** Paint one apply button for the given state (label, icon, enabled). */
  function syncApplyButton(btn, isActive) {
    const label = isActive
      ? t("sp.api.collection.currentWallpaper", "Đã đặt")
      : t("sp.api.collection.setWallpaper", "Đặt làm nền");

    btn.innerHTML = `<i data-icon="${isActive ? "particleCheck" : "imageBadge"}"></i><span></span>`;
    btn.querySelector("span").textContent = label;
    btn.disabled = isActive;
  }

  /**
   * Move the applied state from the old card to the new one without rebuilding
   * the grid, so the hovered overlay keeps its transition and focus.
   * @param {string|null} activeId
   */
  function syncActiveCards(activeId) {
    gridEl.querySelectorAll(".bg_coll_card").forEach((cardEl) => {
      const card = cardsById.get(cardEl.dataset.id);
      if (!card) return;
      const isActive = activeId != null && String(card.id) === String(activeId);

      cardEl.classList.toggle("bg_coll_card_active", isActive);
      const info = cardEl.querySelector(".bg_coll_info");
      if (info) info.innerHTML = buildInfoHtml(card, isActive);
      const btn = cardEl.querySelector(".bg_coll_set_btn");
      if (btn) syncApplyButton(btn, isActive);
    });
    renderIcons(gridEl);
  }

  /* ── Select-many mode ─────────────────────────────────────────────────── */

  /** Keep the toolbar in step with the source, the mode and the selection. */
  function syncToolbar() {
    const source = dataControl.activeSource;
    const isCollection = dataControl.activeSourceId === "collection";
    const hasSettings = isCollection || Boolean(source?.hasProviderSettings);

    // Every managed source gets the toolbar; only the verbs differ.
    toolbarEl.hidden = false;
    el.classList.toggle("is-select-mode", isSelectMode);

    btnSelect.hidden = isSelectMode;
    btnCancelSelect.hidden = !isSelectMode;
    btnSettings.hidden = isSelectMode || !hasSettings;
    btnUpload.hidden = isSelectMode || !isCollection;
    btnFetch.hidden = isSelectMode || isCollection;
    btnDeleteSelected.hidden = !isSelectMode;

    // Bulk "add to collection" only makes sense for sources that can store
    // items (history / infinite sources), never for the collection itself.
    const canAddToCollection =
      Array.isArray(source?.actions) &&
      source.actions.some((action) => action.id === "add");
    btnAddSelected.hidden = !isSelectMode || !canAddToCollection;

    const settingsLabel = t("wallpaper_switcher.extra_settings", {
      source: source?.name || "",
    });
    const settingsSpan = btnSettings.querySelector("span");
    if (settingsSpan && settingsSpan.textContent !== settingsLabel) {
      settingsSpan.textContent = settingsLabel;
    }

    const fetchLabel =
      source?.moreLabel || t("wallpaper_switcher.get_new_image");
    const fetchSpan = btnFetch.querySelector("span");
    if (fetchSpan && fetchSpan.textContent !== fetchLabel) {
      fetchSpan.textContent = fetchLabel;
    }

    const count = selectedIds.size;
    btnDeleteSelected.disabled = count === 0;
    const label =
      count > 0
        ? t("sp.api.collection.delete_selected_count", { count })
        : t("sp.api.collection.delete_selected");
    const span = btnDeleteSelected.querySelector("span");
    if (span && span.textContent !== label) span.textContent = label;

    if (!btnAddSelected.hidden) {
      btnAddSelected.disabled = count === 0;
      const addLabel =
        count > 0
          ? t("sp.api.collection.add_selected_count", { count })
          : t("sp.api.collection.add_selected");
      const addSpan = btnAddSelected.querySelector("span");
      if (addSpan && addSpan.textContent !== addLabel) {
        addSpan.textContent = addLabel;
      }
    }
  }

  function enterSelectMode() {
    if (isSelectMode) return;
    isSelectMode = true;
    selectedId = null;
    selectedIds.clear();
    detailEl.setAttribute("aria-hidden", "true");
    detailEl.replaceChildren();
    gridEl.querySelectorAll(".bg_coll_card").forEach((cardEl) => {
      cardEl.classList.remove("is-selected");
    });
    syncToolbar();
  }

  function exitSelectMode() {
    if (!isSelectMode) return;
    isSelectMode = false;
    selectedIds.clear();
    gridEl.querySelectorAll(".bg_coll_card").forEach((cardEl) => {
      cardEl.classList.remove("is-multi-selected");
      cardEl.querySelector(".bg_coll_select_index")?.remove();
    });

    // Come back to the applied wallpaper's details.
    selectedId =
      dataControl.activeCard?.id != null
        ? String(dataControl.activeCard.id)
        : null;
    gridEl.querySelectorAll(".bg_coll_card").forEach((cardEl) => {
      cardEl.classList.toggle("is-selected", cardEl.dataset.id === selectedId);
    });

    syncToolbar();
    renderDetail();
  }

  function toggleMultiSelect(id) {
    const key = String(id);
    if (selectedIds.has(key)) selectedIds.delete(key);
    else selectedIds.add(key);
    refreshMultiSelectionUI();
    syncToolbar();
  }

  /** Number the selected cards 1..n (insertion order) and draw the badge. */
  function refreshMultiSelectionUI() {
    const ids = [...selectedIds];
    gridEl.querySelectorAll(".bg_coll_card").forEach((cardEl) => {
      const position = ids.indexOf(cardEl.dataset.id);
      const isSelected = position !== -1;
      cardEl.classList.toggle("is-multi-selected", isSelected);

      const thumb = cardEl.querySelector(".bg_coll_thumb_wrapper");
      let badge = cardEl.querySelector(".bg_coll_select_index");
      if (!isSelected) {
        badge?.remove();
        return;
      }

      if (!badge && thumb) {
        badge = document.createElement("span");
        badge.className = "bg_coll_select_index";
        thumb.appendChild(badge);
      }
      if (badge && badge.textContent !== String(position + 1)) {
        badge.textContent = String(position + 1);
      }
    });
  }

  /* ── Collection membership (star marker + bulk add) ───────────────────── */

  /**
   * Fetch the collection once, mark which rendered cards already live in it,
   * then repaint the captions so a star sits next to the applied check.
   */
  async function refreshCollectionMarkers() {
    const token = ++collectionToken;
    const source = dataControl.activeSource;
    const supportsAdd =
      Array.isArray(source?.actions) &&
      source.actions.some((action) => action.id === "add");

    if (!supportsAdd) {
      inCollectionIds = new Set();
      return;
    }

    let collection = [];
    try {
      collection = await getCollection();
    } catch (err) {
      console.error("[ManageGrid] Failed to read collection:", err);
      return;
    }

    if (token !== collectionToken) return;

    const next = new Set();
    cardsById.forEach((card, id) => {
      if (isCardInCollection(card, source, collection)) next.add(id);
    });
    inCollectionIds = next;
    patchCardInfo();
  }

  /** Repaint every caption from the current active + stored state. */
  function patchCardInfo() {
    const activeId = dataControl.activeCard?.id ?? null;
    gridEl.querySelectorAll(".bg_coll_card").forEach((cardEl) => {
      const card = cardsById.get(cardEl.dataset.id);
      if (!card) return;
      const isActive = activeId != null && String(card.id) === String(activeId);
      const info = cardEl.querySelector(".bg_coll_info");
      if (info) info.innerHTML = buildInfoHtml(card, isActive);
    });
    renderIcons(gridEl);
  }

  /** Bulk "add to collection" for the current multi-selection. */
  async function addSelectedToCollection() {
    if (!isSelectMode || selectedIds.size === 0) return;

    const source = dataControl.activeSource;
    const cards = [...selectedIds]
      .map((id) => cardsById.get(id))
      .filter(Boolean);
    if (cards.length === 0) return;

    btnAddSelected.disabled = true;
    try {
      const added = await addCardsToCollection(cards, source);
      if (added > 0) {
        showNotification(
          t("sp.api.collection.add_selected_success", { count: added }),
          "success",
        );
      }
      await refreshCollectionMarkers();
    } catch (err) {
      console.error("[ManageGrid] Bulk add to collection failed:", err);
      showNotification(t("sp.api.collection.add_error"), "error");
    } finally {
      btnAddSelected.disabled = false;
    }
  }

  async function deleteSelected() {
    if (!isSelectMode || selectedIds.size === 0) return;

    const ids = [...selectedIds];
    const count = ids.length;
    const activeId =
      dataControl.activeCard?.id != null
        ? String(dataControl.activeCard.id)
        : null;

    const selectedCards = ids.map((id) => cardsById.get(id)).filter(Boolean);

    const customizedCards = selectedCards.filter((c) => {
      const isActive = activeId != null && String(c.id) === activeId;
      return getCardCustomizations(c, isActive).length > 0;
    });

    const hasCustomizedCards = customizedCards.length > 0;

    const msg = hasCustomizedCards
      ? t(
          "sp.api.collection.bulk_delete_customized_confirm_msg",
          "Một hoặc nhiều hình nền hiện đang sử dụng các tùy chỉnh hình nền, bạn có chắc chắn muốn xóa không?",
        )
      : t("sp.api.collection.bulk_delete_confirm_msg", { count });

    const thumbGrid = hasCustomizedCards
      ? buildBulkDeleteThumbGrid(customizedCards)
      : null;

    const confirmed = await showConfirm(msg, {
      title: t("sp.api.collection.bulk_delete_confirm_title"),
      okText: t("sp.api.collection.delete_btn"),
      isDanger: true,
      anchor: btnDeleteSelected,
      content: thumbGrid,
      width: hasCustomizedCards ? "420px" : "380px",
    });
    if (!confirmed) return;

    // One batched delete: a single DB write + one persisted list, mirroring
    // the batched upload path instead of deleting card by card.
    const indices = ids
      .map((id) =>
        dataControl.items.findIndex((card) => String(card.id) === id),
      )
      .filter((index) => index >= 0);
    if (indices.length === 0) return;

    // Leave select mode first so the re-render triggered by `card:deleted` does
    // not re-add number badges to the remaining cards.
    exitSelectMode();

    // Play the leave animation, then delete. The `card:deleted` event rebuilds
    // the grid and the FLIP pass slides the remaining cards into the gap.
    await animateCardsOut(ids);
    const ok = await dataControl.deleteCards(indices);
    if (!ok) {
      restoreCards(ids);
      return;
    }

    if (
      activeId != null &&
      ids.includes(activeId) &&
      dataControl.items.length
    ) {
      dataControl.setHardIndex(dataControl.currentIndex);
    }
  }

  /**
   * Builds a 3x3 thumbnail grid element previewing the selected customized wallpapers for deletion.
   *
   * @param {Array<Object>} cards
   * @returns {HTMLElement}
   */
  function buildBulkDeleteThumbGrid(cards) {
    const grid = document.createElement("div");
    grid.className = "dialog_thumb_grid";

    const maxSlots = 9;
    const total = cards.length;
    const showMore = total > maxSlots;
    const displayCards = showMore
      ? cards.slice(0, maxSlots - 1)
      : cards.slice(0, maxSlots);

    displayCards.forEach((card) => {
      const item = document.createElement("div");
      item.className = "dialog_thumb_item";

      if (card.thumbnailUrl) {
        const img = document.createElement("img");
        img.src = card.thumbnailUrl;
        img.alt = card.title || "";
        img.loading = "lazy";
        img.decoding = "async";
        item.appendChild(img);
      } else {
        item.innerHTML = `<i data-icon="${isVideoCard(card) ? "videoBadge" : "imageBadge"}"></i>`;
      }

      grid.appendChild(item);
    });

    if (showMore) {
      const moreItem = document.createElement("div");
      moreItem.className = "dialog_thumb_item dialog_thumb_more";
      const remaining = total - (maxSlots - 1);
      moreItem.textContent = `+${remaining}`;
      grid.appendChild(moreItem);
    }

    return grid;
  }

  /* ── Selection & detail pane ──────────────────────────────────────────── */

  function selectCard(id) {
    const nextId = String(id);
    if (selectedId === nextId) return;
    selectedId = nextId;

    gridEl.querySelectorAll(".bg_coll_card").forEach((cardEl) => {
      cardEl.classList.toggle("is-selected", cardEl.dataset.id === nextId);
    });
    renderDetail();
  }

  /**
   * Collapse the burst of events fired by a single wallpaper switch (`card:hard`
   * followed by the renderer persisting five effect keys) into one in-place
   * pass on the next microtask: repaint the applied markers/apply buttons and
   * refresh the detail pane once, instead of rebuilding the grid several times.
   */
  function scheduleActiveSync() {
    if (activeSyncScheduled) return;
    activeSyncScheduled = true;
    queueMicrotask(() => {
      activeSyncScheduled = false;
      syncActiveCards(dataControl.activeCard?.id ?? null);
      renderDetail();
    });
  }

  async function renderDetail() {
    const token = ++detailToken;
    // Select-many mode has no preview: the pane keeps its space but is cleared.
    if (isSelectMode) {
      detailEl.setAttribute("aria-hidden", "true");
      detailEl.replaceChildren();
      return;
    }

    const card = selectedId ? cardsById.get(selectedId) : null;

    if (!card) {
      detailEl.setAttribute("aria-hidden", "true");
      detailEl.innerHTML = `<p class="manage_detail_hint">${escapeHtml(
        t("wallpaper_switcher.manage_pick_hint"),
      )}</p>`;
      return;
    }

    const actions = await buildDetailActions(card);
    if (token !== detailToken) return;

    detailEl.removeAttribute("aria-hidden");
    detailEl.replaceChildren(
      buildDetailPreview(card),
      buildDetailList(card),
      actions,
    );
    renderIcons(detailEl);
  }

  function buildDetailPreview(card) {
    const figure = document.createElement("div");
    figure.className = "manage_detail_figure";

    if (card.thumbnailUrl) {
      const img = document.createElement("img");
      img.src = card.thumbnailUrl;
      img.alt = card.title || "";
      img.decoding = "async";
      figure.appendChild(img);
    } else {
      const box = document.createElement("div");
      box.className = "bg_coll_no_thumb";
      box.innerHTML = `<i data-icon="${isVideoCard(card) ? "videoBadge" : "imageBadge"}"></i>`;
      figure.appendChild(box);
    }

    return figure;
  }

  function buildDetailList(card) {
    const source = dataControl.activeSource;
    const details =
      typeof source?.getChipDetails === "function"
        ? source.getChipDetails(card) || []
        : [];

    const list = document.createElement("div");
    list.className = "manage_detail_list";

    // Compatibility fallback for sources that do not describe their cards.
    const rows =
      details.length > 0
        ? details
        : [
            ...(isVideoCard(card)
              ? []
              : [
                  {
                    label: t("sp.meta.resolution", "Độ phân giải"),
                    value: formatResolution(card.width, card.height),
                  },
                ]),
            {
              label: t("sp.meta.filesize", "Dung lượng"),
              value: formatFileSize(card.size),
            },
            {
              label: t("sp.meta.source", "Nguồn ảnh"),
              value: source?.name || "",
            },
          ];

    // Thêm dòng "Tùy chỉnh đang áp dụng" với các icon tương ứng
    const activeId = dataControl.activeCard?.id ?? null;
    const isActive = activeId != null && String(card.id) === String(activeId);
    const customs = getCardCustomizations(card, isActive);

    const customsValHtml =
      customs.length > 0
        ? buildCustomizationIconsHtml(customs, {
            containerClass: "manage_detail_custom_icons",
            itemClass: "manage_detail_custom_icon",
          })
        : `<span class="manage_detail_no_customs">${escapeHtml(
            t("sp.meta.no_customizations", "Không có"),
          )}</span>`;

    rows.push({
      label: t("sp.meta.applied_customizations", "Tùy chỉnh đang áp dụng"),
      value: customsValHtml,
      html: true,
    });

    rows.forEach((item) => {
      if (!item || (!item.value && !item.html)) return;

      const row = document.createElement("div");
      row.className = `meta_detail_row${item.stacked ? " is-stacked" : ""}`;

      const label = document.createElement("span");
      label.className = "meta_label";
      label.textContent = item.label;

      const value = document.createElement("span");
      value.className = "meta_value";
      if (item.html) value.innerHTML = item.value;
      else value.textContent = item.value;

      row.append(label, value);
      list.appendChild(row);
    });

    return list;
  }

  async function buildDetailActions(card) {
    const source = dataControl.activeSource;
    const available = source?.actions || [];
    const context = { source, dataControl };
    const findAction = (id) => available.find((action) => action.id === id);

    const entries = [];
    const consider = async (action) => {
      if (!action) return;
      if (action.isAvailable && action.isAvailable(card, context) === false) {
        return;
      }
      let resolved = null;
      if (typeof action.resolveState === "function") {
        try {
          resolved = await action.resolveState(card, context);
        } catch (err) {
          console.error("[ManageGrid] resolveState failed:", err);
          resolved = null;
        }
      }
      entries.push({ action, resolved });
    };

    // Fixed order, laid out as a 2x2 grid: download / source on top,
    // add-to-collection / delete underneath.
    await consider(findAction("download"));
    await consider(findAction("source"));
    await consider(findAction("add"));
    await consider(findAction("remove") || findAction("removeFromCarousel"));

    const row = document.createElement("div");
    row.className = "manage_detail_actions";
    const isOdd = entries.length % 2 === 1;

    entries.forEach(({ action, resolved }, index) => {
      const label = t(
        resolved?.labelKey ?? action.labelKey,
        resolved?.fallback ?? action.fallback ?? action.id,
      );
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn manage_detail_action";
      if (isOdd && index === entries.length - 1) btn.classList.add("is-wide");
      if (action.danger) btn.dataset.variant = "danger";
      btn.innerHTML = `<i data-icon="${resolved?.icon ?? action.icon}"></i><span></span>`;
      btn.querySelector("span").textContent = label;

      btn.addEventListener("click", async () => {
        await runDetailAction(action, card, btn);
        if (action.id === "add") {
          // Real-time: repaint the caption star, then flip the button
          // between add <-> remove from collection.
          await refreshCollectionMarkers();
          renderDetail();
        }
      });
      row.appendChild(btn);
    });

    return row;
  }

  async function runDetailAction(action, card, triggerBtn) {
    const isDelete =
      action.id === "remove" || action.id === "removeFromCarousel";

    if (!isDelete) {
      try {
        await action.run(card, {
          source: dataControl.activeSource,
          dataControl,
        });
      } catch (err) {
        console.error(`[ManageGrid] Action [${action.id}] failed:`, err);
      }
      return;
    }

    if (action.id === "remove") {
      const isActive = String(dataControl.activeCard?.id) === String(card.id);
      const customs = getCardCustomizations(card, isActive);
      let msg = t(
        "sp.api.collection.delete_msg",
        "Bạn có chắc chắn muốn xóa hình nền này khỏi bộ sưu tập không?",
      );
      if (customs.length > 0) {
        const customNames = customs.map((c) => `• ${c.label}`).join("\n");
        msg += `\n\n${t("sp.api.collection.delete_customizations_warning", "Hình nền này hiện đang sở hữu các tùy chỉnh sau:")}\n${customNames}`;
      }
      const confirmed = await showConfirm(msg, {
        title: t("sp.api.collection.delete_title", "Xác nhận xóa"),
        okText: t("sp.api.collection.delete_btn", "Xóa"),
        isDanger: true,
        anchor: triggerBtn,
      });
      if (!confirmed) return;
    }

    const index = dataControl.items.findIndex(
      (item) => String(item.id) === String(card.id),
    );
    if (index < 0) return;

    const wasActive = String(dataControl.activeCard?.id) === String(card.id);
    if (wasActive) selectedId = null;

    // Play the leave animation, then delete. `card:deleted` re-renders the grid
    // (with a FLIP slide for the cards closing the gap).
    const cardKey = String(card.id);
    await animateCardsOut([cardKey]);

    // `preserveCursor` keeps the desktop card in place when a different card is
    // removed (DataControl otherwise jumps to the deletion neighbourhood).
    const ok = await dataControl.deleteCard(index, { preserveCursor: true });
    if (!ok) {
      restoreCards([cardKey]);
      return;
    }

    if (wasActive && dataControl.items.length > 0) {
      dataControl.setHardIndex(dataControl.currentIndex);
    }
  }

  /* ── Lifecycle ────────────────────────────────────────────────────────── */

  const onItemsChanged = () => render();
  // The applied wallpaper or its effects can also change from outside the grid
  // (carousel settling, the renderer persisting the new card's effects). Patch
  // the already-drawn cards in place instead of rebuilding the grid: a rebuild
  // replaces the hovered "Set as wallpaper" overlay (restarting its slide-in)
  // and re-creates the detail pane several times for a single switch. Only fall
  // back to a full render when the visual order actually changed.
  const onActiveChanged = () => scheduleActiveSync();
  const onEffectsChanged = () => {
    if (!gridMatchesItems()) {
      render();
      return;
    }
    scheduleActiveSync();
  };

  const effectUnsubs = EFFECT_SETTING_KEYS.map((key) =>
    subscribe(key, onEffectsChanged),
  );

  dataControl.on("card:added", onItemsChanged);
  dataControl.on("card:deleted", onItemsChanged);
  dataControl.on("card:hard", onActiveChanged);
  dataControl.on("card:effects_changed", onEffectsChanged);

  render();

  return {
    el,
    refresh: render,
    destroy() {
      // Unsubscribe only: the DOM must survive the panel's slide-out animation.
      // `performCloseSubmenu` clears `.submenu_body` once the motion is over.
      effectUnsubs.forEach((unsub) => unsub());
      dataControl.off("card:added", onItemsChanged);
      dataControl.off("card:deleted", onItemsChanged);
      dataControl.off("card:hard", onActiveChanged);
      dataControl.off("card:effects_changed", onEffectsChanged);
      dataControl.off("state:change", syncFetchState);
      cardsById.clear();
    },
  };
}
