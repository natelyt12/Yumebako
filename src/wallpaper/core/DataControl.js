import { createSources } from "../sources/registry.js";
import { getFromStore, saveToStore, removeFromStore } from "/src/core/db.js";
import { getSettings, saveSettings } from "/src/core/storageHandler.js";

/**
 * DataControl.js
 * ---------------------------------------------------------------------------
 * TẦNG 2: Bộ não điều phối trung tâm (Single Source of Truth)
 *
 * Chịu trách nhiệm:
 *   1. Quản lý trạng thái hiện tại (active source, soft index, hard index, cards).
 *   2. Đọc/Ghi mảng thẻ sạch trực tiếp từ src/core/db.js (BakoDB/appData).
 *   3. Không nhét item giả (không kind: "more") vào dữ liệu.
 *   4. Cơ chế Pub/Sub (Event Emitter) cho UI Carousel, SwitcherBar và Desktop Renderer.
 */
export class DataControl {
    constructor() {
        this.sources = new Map();
        this.activeSourceId = null;

        /** Mảng các thẻ wallpaper THẬT của source hiện hành (không có kind: 'more') */
        this.items = [];
        this.currentIndex = 0; // Hard index (chốt)
        this.softIndex = 0;    // Soft index (đang lướt)

        this.isBusy = false;
        this.status = "idle";  // "idle" | "fetching" | "deleting" | "switching"

        /** @type {Map<string, Set<Function>>} */
        this._listeners = new Map();

        this._initSources();
    }

    /* ── Event Emitter (Pub / Sub) ─────────────────────────────────────────── */

    on(event, callback) {
        if (!this._listeners.has(event)) {
            this._listeners.set(event, new Set());
        }
        this._listeners.get(event).add(callback);
        return () => this.off(event, callback);
    }

    off(event, callback) {
        const set = this._listeners.get(event);
        if (set) set.delete(callback);
    }

    emit(event, payload) {
        const set = this._listeners.get(event);
        if (set) {
            set.forEach((cb) => {
                try {
                    cb(payload);
                } catch (err) {
                    console.error(`[DataControl] Error in listener for event "${event}":`, err);
                }
            });
        }
    }

    /* ── Khởi tạo ──────────────────────────────────────────────────────────── */

    _initSources() {
        const sourceList = createSources();
        sourceList.forEach((src) => this.sources.set(src.id, src));
    }

    /**
     * Khởi động DataControl với nguồn mặc định từ settings.
     */
    async init() {
        const settings = getSettings();
        const defaultSource = settings.wallpaperConfig?.source || "picre";
        const initialSourceId = this.sources.has(defaultSource) ? defaultSource : "picre";

        await this.switchSource(initialSourceId);
        return this;
    }

    /* ── Getters truy vấn trạng thái ──────────────────────────────────────── */

    get activeSource() {
        return this.sources.get(this.activeSourceId) || null;
    }

    get activeCard() {
        return this.items[this.currentIndex] || null;
    }

    get softCard() {
        return this.items[this.softIndex] || null;
    }

    get cardCount() {
        return this.items.length;
    }

    get tabs() {
        return Array.from(this.sources.values()).map((src) => ({
            id: src.id,
            name: src.name,
            canGrow: src.canGrow,
            hasExtraSettings: Boolean(src.hasProviderSettings),
        }));
    }

    /**
     * Ảnh chụp toàn bộ trạng thái (Dùng cho Status Monitor & Action Buttons).
     */
    getState() {
        return {
            sourceId: this.activeSourceId,
            sourceName: this.activeSource?.name || "",
            status: this.status,
            isBusy: this.isBusy,
            currentIndex: this.currentIndex,
            softIndex: this.softIndex,
            activeCard: this.activeCard,
            softCard: this.softCard,
            cardCount: this.cardCount,
            total: this.cardCount,
            items: [...this.items],
            canGrow: Boolean(this.activeSource?.canGrow),
            hasExtraSettings: Boolean(this.activeSource?.hasProviderSettings),
        };
    }

    /* ── Thao tác chuyển đổi Nguồn (Source) ─────────────────────────────────── */

    /**
     * Chuyển tab nguồn sang `sourceId`.
     * @param {string} sourceId
     * @param {number|null} [targetIndex=null]
     */
    async switchSource(sourceId, targetIndex = null) {
        if (!this.sources.has(sourceId)) {
            console.warn(`[DataControl] Source [${sourceId}] not found.`);
            return;
        }

        this.activeSourceId = sourceId;
        this.isBusy = true;
        this.status = "switching";
        this._notifyState();

        this.emit("source:change", {
            sourceId,
            source: this.activeSource,
        });

        let storedItems = [];

        if (this.activeSource?.isVolatile) {
            // Nguồn biến động (như Collection), luôn lấy danh sách mới nhất từ DB
            try {
                const fetched = await this.activeSource.fetchItems();
                if (Array.isArray(fetched)) {
                    storedItems = fetched.filter((it) => it && it.kind !== "more");
                }
            } catch (err) {
                console.error(`[DataControl] Failed to fetch items for volatile source [${sourceId}]:`, err);
            }
        } else {
            // Đọc danh sách thẻ từ BakoDB (appData)
            storedItems = (await getFromStore(`carousel:${sourceId}`)) || [];

            // Làm sạch: loại bỏ bất kỳ thẻ nào có dạng { kind: 'more' } cũ nếu còn sót lại trong DB
            if (Array.isArray(storedItems)) {
                storedItems = storedItems.filter((it) => it && it.kind !== "more");
            } else {
                storedItems = [];
            }

            // Nếu nguồn rỗng, gọi fetch ban đầu (seed)
            if (storedItems.length === 0 && this.activeSource) {
                try {
                    const initial = await this.activeSource.fetchItems();
                    if (Array.isArray(initial) && initial.length > 0) {
                        storedItems = initial.filter((it) => it && it.kind !== "more");
                        await this._persistCards(sourceId, storedItems);
                    }
                } catch (err) {
                    console.error(`[DataControl] Failed to seed source [${sourceId}]:`, err);
                    this.emit("error", {
                        action: "seed",
                        sourceId,
                        error: err,
                        message: err?.message || "Lỗi khi nạp ảnh ban đầu",
                    });
                }
            }

            // Phục hồi thumbnail hợp lệ (Object URL mới trong session hiện tại) cho các thẻ
            if (this.activeSource && typeof this.activeSource.prepareThumb === "function") {
                await Promise.all(
                    storedItems.map((item) => this.activeSource.prepareThumb(item).catch(() => null))
                );
            }
        }

        this.items = storedItems;

        // Xác định vị trí index mục tiêu
        let resolvedIndex = targetIndex;
        if (resolvedIndex === null || resolvedIndex === undefined) {
            const settings = getSettings();
            const config = settings.wallpaperConfig || {};
            const switcher = settings.wallpaperSwitcher || {};

            // 1. Nếu nguồn này trùng với nguồn active của desktop, tìm thẻ đang hiển thị
            if (config.source === sourceId) {
                const activeId = sourceId === "collection"
                    ? (config.activeCollectionItemId || config.activeWallpaperId)
                    : config.activeWallpaperId;
                if (activeId) {
                    const found = this.items.findIndex((item) => item.id === activeId);
                    if (found !== -1) {
                        resolvedIndex = found;
                    }
                }
            }

            // 2. Nếu chưa xác định được từ active wallpaper, kiểm tra index đã lưu riêng của nguồn này
            if (resolvedIndex === null || resolvedIndex === undefined) {
                const savedIndex = switcher.sourceIndices?.[sourceId];
                if (typeof savedIndex === "number" && savedIndex >= 0) {
                    resolvedIndex = savedIndex;
                }
            }

            // 3. Fallback về 0
            if (resolvedIndex === null || resolvedIndex === undefined) {
                resolvedIndex = 0;
            }
        }

        this.currentIndex = Math.max(0, Math.min(resolvedIndex, Math.max(0, this.items.length - 1)));
        this.softIndex = this.currentIndex;

        this.isBusy = false;
        this.status = "idle";
        this._notifyState();

        this.emit("cards:loaded", {
            sourceId,
            items: this.items,
            selectedIndex: this.currentIndex,
            source: this.activeSource,
        });
    }

    /* ── Thao tác chọn Thẻ (Navigation & Selection) ────────────────────────── */

    /**
     * Cập nhật thẻ Soft khi tâm lướt qua.
     * @param {number} index
     */
    setSoftIndex(index) {
        if (this.softIndex === index) return;

        this.softIndex = index;
        const card = index >= 0 && index < this.items.length ? this.items[index] : null;

        this.emit("card:soft", {
            index,
            card,
        });
        this._notifyState();
    }

    /**
     * Chốt thẻ Hard khi cuộn đã dừng hẳn (settled).
     * @param {number} index
     */
    setHardIndex(index) {
        if (this.items.length === 0 || index < 0 || index >= this.items.length) return;

        this.currentIndex = index;
        this.softIndex = index;

        const card = this.items[index] || null;

        // Lưu vết cài đặt hình nền và vị trí index của nguồn hiện tại
        const currentSettings = getSettings();
        const currentConfig = currentSettings.wallpaperConfig || {};
        const currentSwitcher = currentSettings.wallpaperSwitcher || {};
        const sourceIndices = { ...(currentSwitcher.sourceIndices || {}) };
        sourceIndices[this.activeSourceId] = index;

        const settingsUpdate = {
            wallpaperSwitcher: {
                ...currentSwitcher,
                activeSource: this.activeSourceId,
                sourceIndices,
            },
        };

        if (card?.id) {
            const hasChanged = currentConfig.activeWallpaperId !== card.id || currentConfig.source !== this.activeSourceId;
            if (hasChanged) {
                settingsUpdate.wallpaperConfig = {
                    ...currentConfig,
                    source: this.activeSourceId,
                    activeWallpaperId: card.id,
                    activeCollectionItemId: this.activeSourceId === "collection" ? card.id : currentConfig.activeCollectionItemId,
                };
            }
        }

        saveSettings(settingsUpdate);

        this.emit("card:hard", {
            index,
            card,
            sourceId: this.activeSourceId,
        });
        this._notifyState();
    }

    /* ── Lấy thêm ảnh mới (Fetch More) ─────────────────────────────────────── */

    /**
     * Yêu cầu nguồn nạp thêm ảnh mới (khi người dùng đến ô '+' hoặc bấm nút).
     * @returns {Promise<Object|null>} Thẻ mới vừa nạp xong, hoặc null nếu hết/lỗi.
     */
    async requestMore() {
        if (this.isBusy || !this.activeSource?.canGrow) return null;

        this.isBusy = true;
        this.status = "fetching";
        this._notifyState();

        try {
            const newItems = await this.activeSource.fetchMore();
            if (!newItems || newItems.length === 0) {
                // Nguồn đã cạn ảnh
                this.emit("feed:exhausted", { sourceId: this.activeSourceId });
                return null;
            }

            // Lọc bỏ nếu có phần tử kind: 'more'
            const validFresh = newItems.filter((it) => it && it.kind !== "more");
            this.items.push(...validFresh);
            await this._persistCards(this.activeSourceId, this.items);

            const latestCard = validFresh[0] || null;
            this.emit("card:added", {
                newCard: latestCard,
                addedCards: validFresh,
                allCards: this.items,
                index: this.items.length - 1,
            });

            return latestCard;
        } catch (err) {
            console.error(`[DataControl] Error fetching more from [${this.activeSourceId}]:`, err);
            this.emit("error", {
                action: "fetchMore",
                sourceId: this.activeSourceId,
                error: err,
                message: err?.message || "Không thể lấy thêm ảnh mới",
            });
            return null;
        } finally {
            this.isBusy = false;
            this.status = "idle";
            this._notifyState();
        }
    }

    /* ── Xóa thẻ (Delete Card) ─────────────────────────────────────────────── */

    /**
     * Xóa một thẻ khỏi danh sách và giải phóng dữ liệu trong IndexedDB.
     * @param {number} [targetIndex=this.currentIndex]
     * @returns {Promise<boolean>}
     */
    async deleteCard(targetIndex = this.currentIndex) {
        if (this.isBusy || this.items.length === 0) return false;
        if (targetIndex < 0 || targetIndex >= this.items.length) return false;

        this.isBusy = true;
        this.status = "deleting";
        this._notifyState();

        const cardToDelete = this.items[targetIndex];

        try {
            // 1. Nếu source có logic xóa riêng (ví dụ CollectionDb):
            if (typeof this.activeSource?.deleteItem === "function") {
                await this.activeSource.deleteItem(cardToDelete);
            }

            // 2. Dọn Blob trong mediaData nếu có
            if (cardToDelete?.id) {
                await removeFromStore(`media:orig:${cardToDelete.id}`, "mediaData");
                await removeFromStore(`media:thumb:${cardToDelete.id}`, "mediaData");
                await removeFromStore(`wallpaper_media:${this.activeSourceId}:${cardToDelete.id}`, "mediaData");
            }

            // 3. Xóa khỏi mảng dữ liệu
            this.items.splice(targetIndex, 1);
            await this._persistCards(this.activeSourceId, this.items);

            // 4. Tính toán index kế cận (ưu tiên thẻ bên trái, khớp chuẩn xác với CarouselEngine)
            const nextIndex = Math.max(0, Math.min(targetIndex > 0 ? targetIndex - 1 : 0, this.items.length - 1));
            this.currentIndex = nextIndex;
            this.softIndex = nextIndex;

            // Cập nhật lại index đã lưu cho nguồn này
            const currentSwitcher = getSettings().wallpaperSwitcher || {};
            const sourceIndices = { ...(currentSwitcher.sourceIndices || {}) };
            sourceIndices[this.activeSourceId] = nextIndex;
            saveSettings({
                wallpaperSwitcher: {
                    ...currentSwitcher,
                    sourceIndices,
                },
            });

            this.emit("card:deleted", {
                deletedCard: cardToDelete,
                deletedIndex: targetIndex,
                remainingItems: this.items,
                newIndex: nextIndex,
            });

            return true;
        } catch (err) {
            console.error(`[DataControl] Error deleting card from [${this.activeSourceId}]:`, err);
            this.emit("error", {
                action: "deleteCard",
                sourceId: this.activeSourceId,
                error: err,
                message: err?.message || "Lỗi khi xóa thẻ",
            });
            return false;
        } finally {
            this.isBusy = false;
            this.status = "idle";
            this._notifyState();
        }
    }

    /* ── Private Helpers ───────────────────────────────────────────────────── */

    async _persistCards(sourceId, cards) {
        // Chỉ lưu danh sách các object sạch vào appData
        // Không lưu chuỗi `blob:` vào IndexedDB vì object URL sẽ bị hủy sau khi reload trang!
        const cleanCards = cards
            .filter((c) => c && c.kind !== "more")
            .map((c) => {
                const item = { ...c };
                if (typeof item.thumbnailUrl === "string" && item.thumbnailUrl.startsWith("blob:")) {
                    item.thumbnailUrl = null;
                }
                return item;
            });
        await saveToStore(`carousel:${sourceId}`, cleanCards);
    }

    _notifyState() {
        this.emit("state:change", this.getState());
    }
}

export const dataControl = new DataControl();
