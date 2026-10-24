import { renderIcons } from "/src/core/icon.js";
import { t } from "/src/core/i18n.js";
import { showConfirm } from "/src/core/ui.js";
import { getSettings, saveSettings } from "/src/core/storageHandler.js";
import { resolveCardMeta } from "../../sources/cardMeta.js";
import { createWallhavenSettingsPopover } from "../popover/WallhavenSettingsPopover.js";
import { createCollectionSettingsPopover } from "../popover/CollectionSettingsPopover.js";
import { createPicreSettingsPopover } from "../popover/PicreSettingsPopover.js";
import { createBingSettingsPopover } from "../popover/BingSettingsPopover.js";

/**
 * SwitcherBar.js
 * ---------------------------------------------------------------------------
 * Component thống nhất quản lý toàn bộ thanh đáy (Bottom Bar) của WallpaperSwitcher.
 * Bao gồm:
 *   - Source Tabs: Chuyển đổi giữa các nguồn hình nền (Collection, Wallhaven, Picre...)
 *   - Counter: Bộ đếm vị trí thẻ mềm (softIndex) / tổng số thẻ
 *   - Action Buttons: Các nút hành động cho thẻ hiện tại (Download, View Source, Add to Collection, Delete)
 *   - Right Slot: Nút tải lên (Collection) hoặc cài đặt nguồn (Settings)
 *
 * Hoạt động Reactive 100% theo State của DataControl.
 */
export class SwitcherBar {
    /**
     * @param {Object} options
     * @param {HTMLElement} options.container - Element .wallpaper_switcher_bar
     * @param {import("../../core/DataControl.js").DataControl} options.dataControl
     * @param {import("../../core/WallpaperSwitcher.js").WallpaperSwitcher} options.switcher
     */
    constructor({ container, dataControl, switcher }) {
        this.container = container;
        this.dataControl = dataControl;
        this.switcher = switcher;

        this.tabsWrapper = container.querySelector("#wallpaper_source_tabs_wrapper");
        this.tabsContainer = container.querySelector("#wallpaper_source_tabs");
        this.counterEl = container.querySelector("#wallpaper_switcher_counter");
        this.loaderEl = container.querySelector("#wallpaper_switcher_loader");
        this.metaInfoEl = container.querySelector("#wallpaper_switcher_meta_info");
        this.actionsContainer = container.querySelector("#wallpaper_switcher_actions");
        this.fetchBtn = container.querySelector("#wallpaper_fetch_btn");
        this.uploadBtn = container.querySelector("#wallpaper_upload_btn");
        this.settingsBtn = container.querySelector("#wallpaper_source_settings");

        this.tabButtons = new Map();
        this.wallhavenPopover = null;
        this.collectionPopover = null;
        this._token = 0;
        this._isBusy = false;
    }

    /**
     * Initialize and subscribe to DataControl.
     */
    init() {
        this._bindEvents();
        this.renderTabs();
        this.syncState(this.dataControl.getState());
        if (this.dataControl.activeCard) {
            this.syncMetaInfo(this.dataControl.activeCard);
            this.renderActions(this.dataControl.activeCard);
        }
        renderIcons(this.container);

        // Subscribe to DataControl events
        this.dataControl.on("state:change", (state) => this.syncState(state));
        this.dataControl.on("card:soft", ({ card }) => {
            this.syncMetaInfo(card);
            this.hideActions();
        });
        this.dataControl.on("card:hard", ({ card }) => {
            this.syncMetaInfo(card);
            this.renderActions(card);
        });
        this.dataControl.on("source:change", ({ sourceId }) => {
            this.closePopovers();
            this.syncActiveTab(sourceId);
            this.syncRightSlot(sourceId);
            this.syncMetaInfo(null);
            this.hideActions();
            this.renderActions(null);
        });
        this.dataControl.on("cards:loaded", () => {
            this.syncRightSlot(this.dataControl.activeSourceId);
            this.syncMetaInfo(this.dataControl.activeCard);
            this.renderActions(this.dataControl.activeCard);
        });

        return this;
    }

    _bindEvents() {
        // Fetch button (for sources that support fetching more)
        this.fetchBtn?.addEventListener("click", async () => {
            if (this.isDataBusy()) return;
            this.fetchBtn.classList.add("is-loading");
            this.syncLoader();
            try {
                await this.dataControl.requestMore();
            } finally {
                this.fetchBtn.classList.remove("is-loading");
                this.syncLoader();
            }
        });

        // Upload button (for Collection)
        this.uploadBtn?.addEventListener("click", () => {
            if (this.isDataBusy()) return;
            this.switcher?.requestUpload?.();
        });

        // Settings button (for sources with custom settings like Wallhaven & Collection)
        if (this.settingsBtn) {
            this.wallhavenPopover = createWallhavenSettingsPopover({
                trigger: this.settingsBtn,
                switcher: this.switcher,
                dataControl: this.dataControl,
            });
            this.collectionPopover = createCollectionSettingsPopover({
                trigger: this.settingsBtn,
                switcher: this.switcher,
                dataControl: this.dataControl,
            });
            this.picrePopover = createPicreSettingsPopover({
                trigger: this.settingsBtn,
                switcher: this.switcher,
                dataControl: this.dataControl,
            });
            this.bingPopover = createBingSettingsPopover({
                trigger: this.settingsBtn,
                switcher: this.switcher,
                dataControl: this.dataControl,
            });

            this.settingsBtn.addEventListener("click", (e) => {
                e.stopPropagation();
                const activeId = this.dataControl.activeSourceId;
                if (activeId === "wallhaven") {
                    this.collectionPopover?.close();
                    this.picrePopover?.close();
                    this.bingPopover?.close();
                    this.wallhavenPopover?.toggle();
                } else if (activeId === "collection") {
                    this.wallhavenPopover?.close();
                    this.picrePopover?.close();
                    this.bingPopover?.close();
                    this.collectionPopover?.toggle();
                } else if (activeId === "picre") {
                    this.wallhavenPopover?.close();
                    this.collectionPopover?.close();
                    this.bingPopover?.close();
                    this.picrePopover?.toggle();
                } else if (activeId === "bing") {
                    this.wallhavenPopover?.close();
                    this.collectionPopover?.close();
                    this.picrePopover?.close();
                    this.bingPopover?.toggle();
                }
            });
        }
    }

    /**
     * Đóng tất cả popover đang mở thuộc thanh bar.
     */
    closePopovers() {
        this.wallhavenPopover?.close();
        this.collectionPopover?.close();
        this.picrePopover?.close();
        this.bingPopover?.close();
    }

    /**
     * Đồng bộ giao diện tổng thể theo State của DataControl.
     * @param {Object} state
     */
    syncState(state) {
        this.setBusy(state.isBusy || state.status !== "idle");
        this.syncCounter(state);
        this.syncLoader(state);
        this.syncMetaInfo(state.softCard || state.activeCard);
        this.syncActiveTab(state.sourceId);
        this.syncRightSlot(state.sourceId);
        if (!state.cardCount || state.cardCount === 0 || !state.activeCard) {
            this.renderActions(null);
        }
    }

    /* ── Source Tabs ───────────────────────────────────────────────────────── */

    /**
     * Dựng danh sách các tab nguồn khả dụng.
     */
    renderTabs() {
        if (!this.tabsContainer) return;
        this.tabsContainer.innerHTML = "";
        this.tabButtons.clear();

        const sources = this.switcher?.availableSources || [];
        const activeId = this.dataControl.activeSourceId;

        sources.forEach((source) => {
            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = `wallpaper_source_tab${source.id === activeId ? " active" : ""}`;
            btn.dataset.source = source.id;

            const label = document.createElement("span");
            label.dataset.i18n = `wallpaper_switcher.source.${source.id}`;
            label.textContent = source.name;
            btn.appendChild(label);

            btn.addEventListener("click", () => {
                this.switcher?.selectSource(source.id);
            });

            this.tabsContainer.appendChild(btn);
            this.tabButtons.set(source.id, btn);
        });

        this.syncCompactTabsWidth();
        renderIcons(this.tabsContainer);
    }

    /**
     * Đồng bộ footprint chiều rộng của wrapper ở trạng thái thu gọn,
     * giúp các element kế bên (counter, loader) không bị dịch chuyển khi hover mở rộng.
     */
    syncCompactTabsWidth() {
        if (!this.tabsWrapper || !this.tabsContainer) return;

        requestAnimationFrame(() => {
            const activeTab = this.tabsContainer.querySelector(".wallpaper_source_tab.active");
            if (activeTab) {
                const activeRect = activeTab.getBoundingClientRect();
                const activeW = activeRect.width || 80;
                // Container padding: 3px left + 3px right = 6px
                const totalW = Math.ceil(activeW + 6);
                this.tabsWrapper.style.width = totalW + "px";
            }
        });
    }

    /**
     * Cập nhật highlight cho tab đang active.
     */
    syncActiveTab(activeSourceId) {
        this.tabButtons.forEach((btn, id) => {
            btn.classList.toggle("active", id === activeSourceId);
        });
        this.syncCompactTabsWidth();
    }

    /**
     * Chuyển tab kế tiếp / trước đó (phím tắt ArrowUp/ArrowDown).
     */
    stepTab(direction) {
        const sources = this.switcher?.availableSources || [];
        if (sources.length < 2) return;

        const ids = sources.map((s) => s.id);
        const currentTargetId = this.switcher?._pendingSourceId || this.dataControl.activeSourceId;
        const currentIndex = ids.indexOf(currentTargetId);
        const nextIndex = (currentIndex + direction + ids.length) % ids.length;
        this.switcher?.selectSource(ids[nextIndex]);
    }

    /* ── Counter ───────────────────────────────────────────────────────────── */

    /**
     * Cập nhật vị trí soft index / tổng số thẻ.
     */
    syncCounter(state = this.dataControl.getState()) {
        if (!this.counterEl) return;

        const total = state.total ?? state.cardCount ?? this.dataControl.items.length;
        const currentNum = !total || total === 0 ? 0 : state.softIndex + 1;
        const maxCards = Number(state.maxCards ?? this.dataControl.activeSource?.maxCards ?? Infinity);
        const limitSuffix = Number.isFinite(maxCards) ? ` | ${maxCards}` : "";

        const text = `${currentNum} / ${total}${limitSuffix}`;

        // `state:change` bắn rất thường, mà gán `textContent` là một lần ghi DOM
        // (thay text node) — chỉ ghi khi chuỗi thật sự đổi.
        if (this.counterEl.textContent !== text) this.counterEl.textContent = text;
    }

    /* ── Loader ────────────────────────────────────────────────────────────── */

    /**
     * Đồng bộ trạng thái hiển thị của loader spinner cạnh counter.
     * @param {Object} [state]
     */
    syncLoader(state = this.dataControl?.getState()) {
        if (!this.loaderEl) return;
        const status = state?.status ?? this.dataControl?.status;
        const isLoading =
            status === "fetching" ||
            status === "switching" ||
            Boolean(this.switcher?._isSwapping);

        this.loaderEl.classList.toggle("is-hidden", !isLoading);
        this.loaderEl.setAttribute("aria-hidden", String(!isLoading));
    }

    /* ── Meta Info (Top Bar) ───────────────────────────────────────────────── */

    /**
     * Đồng bộ thông tin ảnh đang chọn (loại, nguồn, dung lượng, độ phân giải) lên Top Bar.
     * @param {Object|null} [card]
     */
    syncMetaInfo(card = this.dataControl.softCard || this.dataControl.activeCard) {
        if (!this.metaInfoEl) return;
        if (!card) {
            if (this.metaInfoEl.innerHTML !== "") this.metaInfoEl.innerHTML = "";
            return;
        }

        const meta = resolveCardMeta(this.dataControl.activeSourceId, card);
        const parts = [];
        if (meta.leftHtml) parts.push(`<div class="wallpaper_meta_part">${meta.leftHtml}</div>`);
        if (meta.rightHtml) parts.push(`<div class="wallpaper_meta_part">${meta.rightHtml}</div>`);
        const html = parts.join('<span class="wallpaper_meta_sep">•</span>');

        if (this.metaInfoEl.innerHTML !== html) {
            this.metaInfoEl.innerHTML = html;
        }
    }

    /* ── Action Buttons ────────────────────────────────────────────────────── */

    /**
     * Ẩn cụm nút action với hiệu ứng fade out.
     */
    hideActions() {
        if (!this.actionsContainer) return;
        this.actionsContainer.classList.add("is-hidden");
    }

    /**
     * Render action buttons for active settled card.
     * @param {Object|null} card
     */
    async renderActions(card = this.dataControl.activeCard) {
        if (!this.actionsContainer) return;

        const token = ++this._token;
        const source = this.switcher?.activeSource;
        const actions = source?.actions || [];

        if (!card || actions.length === 0) {
            this.actionsContainer.innerHTML = "";
            this.actionsContainer.classList.add("hidden");
            this.actionsContainer.classList.add("is-hidden");
            return;
        }

        // Đảm bảo ở trạng thái ẩn trước khi cập nhật DOM các nút mới
        this.actionsContainer.classList.add("is-hidden");

        // Kiểm tra tính khả dụng của từng action
        const context = { source, dataControl: this.dataControl, switcher: this.switcher };
        const states = await Promise.all(
            actions.map(async (action) => {
                const verdict = action.isAvailable ? await action.isAvailable(card, context) : true;
                const resolved =
                    verdict === false || !action.resolveState
                        ? null
                        : await action.resolveState(card, context);
                return { verdict, resolved };
            })
        );

        if (token !== this._token) return;

        this.actionsContainer.innerHTML = "";
        actions.forEach((action, index) => {
            const { verdict, resolved } = states[index];
            if (verdict === false) return;

            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = "btn wallpaper_action";
            if (action.danger) btn.setAttribute("data-variant", "danger");
            btn.innerHTML = `<i data-icon="${resolved?.icon ?? action.icon}"></i><span></span>`;
            const label = t(
                resolved?.labelKey ?? action.labelKey,
                resolved?.fallback ?? action.fallback
            );
            btn.querySelector("span").textContent = label;
            btn.dataset.actionTitle = label;

            if (verdict?.disabled) {
                btn.dataset.blocked = "1";
                btn.dataset.blockReason = verdict.reason || "";
                btn.disabled = true;
                btn.title = verdict.reason || "";
            } else {
                btn.title = label;
            }

            btn.addEventListener("click", (e) => {
                e.stopPropagation();
                this._executeAction(action, card, btn);
            });

            this.actionsContainer.appendChild(btn);
        });

        if (this.actionsContainer.childElementCount > 0) {
            const wasHidden = this.actionsContainer.classList.contains("hidden");
            this.actionsContainer.classList.remove("hidden");
            if (wasHidden) {
                void this.actionsContainer.offsetWidth;
            }
            renderIcons(this.actionsContainer);
            this._applyBusyToActions();

            // Kích hoạt fade-in mượt mà khi card đã settle và các nút đã sẵn sàng
            requestAnimationFrame(() => {
                if (token === this._token) {
                    this.actionsContainer.classList.remove("is-hidden");
                }
            });
        } else {
            this.actionsContainer.classList.add("hidden");
            this.actionsContainer.classList.add("is-hidden");
        }
    }

    /**
     * Thực thi một hành động trên thẻ.
     */
    async _executeAction(action, card, triggerBtn = null) {
        const source = this.switcher?.activeSource;
        const context = { source, dataControl: this.dataControl, switcher: this.switcher };

        try {
            if (action.id === "remove") {
                await this._handleDeleteCard(card, true, triggerBtn);
            } else if (action.id === "removeFromCarousel") {
                await this._handleDeleteCard(card, false, triggerBtn);
            } else if (typeof action.run === "function") {
                await action.run(card, context);
                // Sau khi thêm vào BST, cập nhật lại trạng thái nút
                if (action.id === "add") {
                    this.renderActions(card);
                }
            }
        } catch (err) {
            console.error(`[SwitcherBar] Error executing action [${action.id}]:`, err);
        }
    }

    /**
     * Xóa / Gỡ thẻ khỏi danh sách thông qua DataControl.
     * @param {Object} card
     * @param {boolean} isPermanent - true: xóa vĩnh viễn khỏi Collection, false: gỡ khỏi carousel
     * @param {HTMLElement|null} [triggerBtn=null]
     */
    async _handleDeleteCard(card, isPermanent, triggerBtn = null) {
        if (isPermanent) {
            const confirmed = await showConfirm(
                t("sp.api.collection.delete_msg", "Bạn có chắc chắn muốn xóa hình nền này khỏi bộ sưu tập?"),
                {
                    title: t("sp.api.collection.delete_title", "Xác nhận xóa"),
                    okText: t("sp.api.collection.delete_btn", "Xóa"),
                    isDanger: true,
                    anchor: triggerBtn || this.actionsContainer,
                    placement: "top-right"
                }
            );
            if (!confirmed) return;
        }

        // Lấy đúng vị trí thẻ cần xóa TRƯỚC KHI animation rơi thẻ
        const targetIndex = this.dataControl.currentIndex;
        if (targetIndex < 0 || targetIndex >= this.dataControl.items.length) return;

        // Ẩn cụm nút thao tác ngay lập tức (fade out)
        this.hideActions();

        this.setBusy(true);
        try {
            // 1. Chạy animation rơi thẻ trên Carousel (tự thu hẹp DOM và chốt sang thẻ kế cận)
            const removed = this.switcher?.carousel
                ? await this.switcher.carousel.deleteActiveCard()
                : true;

            // Thẻ chưa rời DOM thì không được xóa dữ liệu: làm vậy sẽ để lại một
            // thẻ "ma" trên dải trong khi store đã mất bản ghi.
            if (!removed) {
                console.warn("[SwitcherBar] Carousel từ chối xóa thẻ đang chốt; bỏ qua.");
                return;
            }

            // 2. Xóa trong DataControl (cập nhật mảng items sạch & IndexedDB)
            await this.dataControl.deleteCard(targetIndex);

            // 3. Lượt hard-select trong lúc carousel dọn thẻ chạy khi store còn giữ
            // bản ghi cũ, nên nó không đưa thẻ kế cận lên desktop. Chốt lại theo
            // mảng đã xóa để desktop và carousel khớp nhau.
            if (this.dataControl.items.length > 0) {
                this.dataControl.setHardIndex(this.dataControl.currentIndex);
            }
        } finally {
            this.setBusy(false);
            this.syncCounter();
            this.renderActions(this.dataControl.activeCard);
            this.switcher?.syncEmptyState?.();
        }
    }

    /* ── Right Slot (Upload & Extra Settings) ───────────────────────────────── */

    /**
     * Synchronize right slot controls according to current source capabilities:
     * - Fetch button: visible when source.canGrow is true (for remote sources)
     * - Upload button: visible for Collection
     * - Settings button: visible when source has provider settings
     *
     * @param {string} [sourceId]
     */
    syncRightSlot(sourceId = this.dataControl.activeSourceId) {
        const id = sourceId || this.dataControl.activeSourceId || this.switcher?.activeSourceId;
        const source = (this.switcher?.sources && this.switcher.sources.find((s) => s.id === id))
            || this.dataControl.sources.get(id)
            || this.switcher?.activeSource;

        const isCollection = id === "collection";
        const canGrow = !isCollection && Boolean(source?.canGrow);
        const hasExtraSettings = isCollection || id === "wallhaven" || Boolean(source?.hasProviderSettings);

        if (this.fetchBtn) {
            this.fetchBtn.classList.toggle("hidden", !canGrow);
            const labelSpan = this.fetchBtn.querySelector("span");
            const label = source?.moreLabel || t("wallpaper_switcher.get_new_image", "Lấy ảnh mới");
            // Cùng lý do như `syncCounter`: đừng thay text node khi chuỗi không đổi.
            if (labelSpan && labelSpan.textContent !== label) {
                labelSpan.textContent = label;
            }
            if (this.fetchBtn.title !== label) this.fetchBtn.title = label;
        }
        if (this.uploadBtn) {
            this.uploadBtn.classList.toggle("hidden", !isCollection);
            const uploadLabel = t("sp.api.collection.upload_btn", "Tải lên ảnh / video");
            if (this.uploadBtn.title !== uploadLabel) this.uploadBtn.title = uploadLabel;
        }
        if (this.settingsBtn) {
            this.settingsBtn.classList.toggle("hidden", !hasExtraSettings);
            const sourceName = t(`wallpaper_switcher.source.${id}`, source?.name || id);
            const settingsLabel = t("wallpaper_switcher.extra_settings", { source: sourceName });
            const labelSpan = this.settingsBtn.querySelector("span");
            if (labelSpan && labelSpan.textContent !== settingsLabel) {
                labelSpan.textContent = settingsLabel;
            }
            if (this.settingsBtn.title !== settingsLabel) {
                this.settingsBtn.title = settingsLabel;
            }
        }
    }

    /* ── Busy State ────────────────────────────────────────────────────────── */

    /**
     * Kiểm tra xem hệ thống có đang thực hiện thao tác dữ liệu / CRUD hay không
     * (thêm thẻ, xóa thẻ, dọn dẹp mảng thẻ, tải lên, đổi nguồn).
     * @returns {boolean}
     */
    isDataBusy() {
        return Boolean(
            this._isBusy ||
            this.dataControl?.isBusy ||
            (this.dataControl?.status && this.dataControl.status !== "idle") ||
            this.switcher?._isSwapping ||
            this.switcher?.carousel?.isDeleting
        );
    }

    /**
     * Set busy state across the switcher bar.
     * @param {boolean} busy
     */
    setBusy(busy) {
        this._isBusy = Boolean(busy);
        const dataBusy = this.isDataBusy();

        this.syncLoader();

        if (this.fetchBtn) {
            const isFetching = this.dataControl?.status === "fetching";
            this.fetchBtn.classList.toggle("is-loading", isFetching);
            this.fetchBtn.disabled = dataBusy;
        }

        if (this.uploadBtn) {
            this.uploadBtn.disabled = dataBusy;
        }

        this._applyBusyToActions();
    }

    _applyBusyToActions() {
        if (!this.actionsContainer || this.actionsContainer.classList.contains("is-hidden")) return;
        this.actionsContainer.querySelectorAll("button").forEach((btn) => {
            const blocked = btn.dataset.blocked === "1";
            const disabled = this._isBusy || blocked;
            if (btn.disabled !== disabled) btn.disabled = disabled;
            if (blocked) return;

            if (this._isBusy) {
                const title = t("wallpaper_switcher.wait_for_wallpaper", "Đang tải hình nền…");
                if (btn.title !== title) btn.title = title;
            } else {
                const title = btn.dataset.actionTitle || "";
                if (btn.title !== title) btn.title = title;
            }
        });
    }
}
