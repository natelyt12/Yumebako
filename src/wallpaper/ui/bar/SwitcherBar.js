import { renderIcons } from "/src/core/icon.js";
import { t } from "/src/core/i18n.js";
import { showConfirm, showNotification } from "/src/core/ui.js";
import { isActionItem } from "../carousel/items.js";

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

        this.tabsContainer = container.querySelector("#wallpaper_source_tabs");
        this.counterEl = container.querySelector("#wallpaper_switcher_counter");
        this.actionsContainer = container.querySelector("#wallpaper_switcher_actions");
        this.uploadBtn = container.querySelector("#wallpaper_upload_btn");
        this.settingsBtn = container.querySelector("#wallpaper_source_settings");

        this.tabButtons = new Map();
        this._token = 0;
        this._isBusy = false;
    }

    /**
     * Khởi tạo và đăng ký lắng nghe DataControl.
     */
    init() {
        this._bindEvents();
        this.renderTabs();
        this.syncState(this.dataControl.getState());

        // Lắng nghe sự kiện từ DataControl
        this.dataControl.on("state:change", (state) => this.syncState(state));
        this.dataControl.on("source:change", ({ sourceId }) => {
            this.renderTabs();
            this.syncRightSlot(sourceId);
            this.renderActions(null);
        });
        this.dataControl.on("cards:loaded", () => {
            this.renderActions(this.dataControl.activeCard);
        });
        this.dataControl.on("card:hard", ({ card }) => this.renderActions(card));

        return this;
    }

    _bindEvents() {
        // Upload button (cho Collection)
        this.uploadBtn?.addEventListener("click", () => {
            this.switcher?.requestUpload?.();
        });

        // Settings button (cho nguồn có setting riêng như Wallhaven)
        this.settingsBtn?.addEventListener("click", () => {
            showNotification(t("wallpaper_switcher.extra_settings_hint", "Cài đặt của nguồn"), "info");
        });
    }

    /**
     * Đồng bộ giao diện tổng thể theo State của DataControl.
     * @param {Object} state
     */
    syncState(state) {
        this.setBusy(state.isBusy || state.status !== "idle");
        this.syncCounter(state);
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
                if (source.id !== this.dataControl.activeSourceId) {
                    this.switcher?.selectSource(source.id);
                }
            });

            this.tabsContainer.appendChild(btn);
            this.tabButtons.set(source.id, btn);
        });

        renderIcons(this.tabsContainer);
    }

    /**
     * Cập nhật highlight cho tab đang active.
     */
    syncActiveTab(activeSourceId) {
        this.tabButtons.forEach((btn, id) => {
            btn.classList.toggle("active", id === activeSourceId);
        });
    }

    /**
     * Chuyển tab kế tiếp / trước đó (phím tắt ArrowUp/ArrowDown).
     */
    stepTab(direction) {
        const sources = this.switcher?.availableSources || [];
        if (sources.length < 2) return;

        const ids = sources.map((s) => s.id);
        const currentIndex = ids.indexOf(this.dataControl.activeSourceId);
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
        if (!total || total === 0) {
            this.counterEl.textContent = "0 / 0";
            return;
        }

        const isAction = state.softIndex >= total;
        const position = isAction ? null : state.softIndex + 1;

        this.counterEl.textContent = position ? `${position} / ${total}` : `— / ${total}`;
    }

    /* ── Action Buttons ────────────────────────────────────────────────────── */

    /**
     * Vẽ các nút thao tác tương ứng với thẻ đang được chốt.
     * @param {Object|null} card
     */
    async renderActions(card = this.dataControl.activeCard) {
        if (!this.actionsContainer) return;

        const token = ++this._token;
        const source = this.switcher?.activeSource;
        const actions = source?.actions || [];

        if (!card || isActionItem(card) || actions.length === 0) {
            this.actionsContainer.innerHTML = "";
            this.actionsContainer.classList.add("hidden");
            return;
        }

        // Kiểm tra tính khả dụng của từng action
        const context = { source, dataControl: this.dataControl, switcher: this.switcher };
        const verdicts = await Promise.all(
            actions.map((action) => (action.isAvailable ? action.isAvailable(card, context) : true))
        );

        if (token !== this._token) return;

        this.actionsContainer.innerHTML = "";
        actions.forEach((action, index) => {
            const verdict = verdicts[index];
            if (verdict === false) return;

            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = `icon_button wallpaper_action${action.danger ? " danger_btn" : ""}`;
            btn.innerHTML = `<i data-icon="${action.icon}"></i><span></span>`;
            btn.querySelector("span").textContent = t(action.labelKey, action.fallback);

            if (verdict?.disabled) {
                btn.dataset.blocked = "1";
                btn.dataset.blockReason = verdict.reason || "";
                btn.disabled = true;
                btn.title = verdict.reason || "";
            }

            btn.addEventListener("click", (e) => {
                e.stopPropagation();
                this._executeAction(action, card);
            });

            this.actionsContainer.appendChild(btn);
        });

        if (this.actionsContainer.childElementCount > 0) {
            this.actionsContainer.classList.remove("hidden");
            renderIcons(this.actionsContainer);
        } else {
            this.actionsContainer.classList.add("hidden");
        }

        this._applyBusyToActions();
    }

    /**
     * Thực thi một hành động trên thẻ.
     */
    async _executeAction(action, card) {
        const source = this.switcher?.activeSource;
        const context = { source, dataControl: this.dataControl, switcher: this.switcher };

        try {
            if (action.id === "remove") {
                await this._handleDeleteCard(card, true);
            } else if (action.id === "removeFromCarousel") {
                await this._handleDeleteCard(card, false);
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
     */
    async _handleDeleteCard(card, isPermanent) {
        if (isPermanent) {
            const confirmed = await showConfirm(
                t("sp.api.collection.delete_msg", "Bạn có chắc chắn muốn xóa hình nền này khỏi bộ sưu tập?"),
                {
                    title: t("sp.api.collection.delete_title", "Xác nhận xóa"),
                    okText: t("sp.api.collection.delete_btn", "Xóa"),
                    isDanger: true,
                }
            );
            if (!confirmed) return;
        }

        // Lấy đúng vị trí thẻ cần xóa TRƯỚC KHI animation rơi thẻ
        const targetIndex = this.dataControl.currentIndex;
        if (targetIndex < 0 || targetIndex >= this.dataControl.items.length) return;

        this.setBusy(true);
        try {
            // 1. Xóa trong DataControl (cập nhật mảng items sạch & IndexedDB)
            await this.dataControl.deleteCard(targetIndex);

            // 2. Chạy animation rơi thẻ trên Carousel (tự thu hẹp DOM và chốt sang thẻ kế cận)
            if (this.switcher?.carousel) {
                await this.switcher.carousel.deleteActiveCard();
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
     * Tự động đồng bộ slot bên phải theo thuộc tính của nguồn hiện tại:
     * - collection: hiện Upload + Extra Settings
     * - wallhaven: chỉ hiện Extra Settings (ẩn Upload)
     * - picre (và các nguồn khác): ẩn cả hai nút
     *
     * @param {string} [sourceId]
     */
    syncRightSlot(sourceId = this.dataControl.activeSourceId) {
        const id = sourceId || this.dataControl.activeSourceId;
        const source = this.switcher?.sources?.find((s) => s.id === id) || this.switcher?.activeSource;

        const isCollection = id === "collection";
        const hasExtraSettings = isCollection || id === "wallhaven" || Boolean(source?.hasProviderSettings);

        if (this.uploadBtn) {
            this.uploadBtn.classList.toggle("hidden", !isCollection);
        }
        if (this.settingsBtn) {
            this.settingsBtn.classList.toggle("hidden", !hasExtraSettings);
        }
    }

    /* ── Busy State ────────────────────────────────────────────────────────── */

    /**
     * Bật/tắt trạng thái bận cho toàn bộ thanh bar khi carousel di chuyển hoặc fetch.
     * @param {boolean} busy
     */
    setBusy(busy) {
        this._isBusy = Boolean(busy);
        this._applyBusyToActions();
    }

    _applyBusyToActions() {
        if (!this.actionsContainer) return;
        this.actionsContainer.querySelectorAll("button").forEach((btn) => {
            const blocked = btn.dataset.blocked === "1";
            btn.disabled = this._isBusy || blocked;
            if (!blocked) {
                if (this._isBusy) btn.title = t("wallpaper_switcher.wait_for_wallpaper", "Đang tải hình nền…");
                else btn.removeAttribute("title");
            }
        });
    }
}
