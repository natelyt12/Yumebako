import { createSources } from "../sources/registry.js";
import { getFromStore, saveToStore } from "/src/core/db.js";
import { runMediaGC } from "./mediaGC.js";
import { getSettings, saveSettings } from "/src/core/storageHandler.js";

/**
 * A single wallpaper card item managed by DataControl.
 * Produced by BaseSource.toCarouselItem() and persisted in BakoDB.
 *
 * @typedef {Object} CardItem
 * @property {string}  id           - Unique identifier for the card.
 * @property {string}  source       - The source id that owns this card.
 * @property {string}  url          - Direct URL of the full-size media.
 * @property {string}  sourceUrl    - Canonical page URL (shown by "view source").
 * @property {string}  title        - Display title / file name.
 * @property {string}  category     - Optional tag / category string.
 * @property {"image"|"video"} mediaType - Media type of the card.
 * @property {string|null} thumbnailUrl  - Low-res thumbnail URL (may be a blob:, null when not yet generated).
 * @property {string}  trackUrl     - Analytics or referral tracking URL.
 * @property {boolean} local        - true when the file lives on-device.
 * @property {number}  width        - Original media width in pixels.
 * @property {number}  height       - Original media height in pixels.
 * @property {number}  size         - File size in bytes.
 * @property {number}  addedAt      - Unix timestamp (ms) when the card was added.
 */

/**
 * Named events emitted by DataControl.
 *
 * @typedef {"source:change" | "cards:loaded" | "card:soft" | "card:hard" | "card:added" | "card:deleted" | "feed:exhausted" | "feed:limit_reached" | "state:change" | "error"} DataControlEvent
 */

/**
 * Snapshot returned by DataControl.getState().
 *
 * @typedef {Object} DataControlState
 * @property {string}          sourceId        - Active source id.
 * @property {string}          sourceName      - Localized source name.
 * @property {"idle"|"fetching"|"deleting"|"switching"} status - Current busy status.
 * @property {boolean}         isBusy          - True while any async operation is running.
 * @property {number}          currentIndex    - Hard-settled index.
 * @property {number}          softIndex       - Scroll-preview index.
 * @property {CardItem|null}   activeCard      - Hard-settled card (or null).
 * @property {CardItem|null}   softCard        - Scroll-preview card (or null).
 * @property {number}          cardCount       - Total number of cards in the active source.
 * @property {number}          total           - Alias for cardCount.
 * @property {CardItem[]}      items           - Shallow copy of the cards array.
 * @property {boolean}         canGrow         - Whether fetchMore() is available.
 * @property {boolean}         hasExtraSettings - Whether the source has its own settings panel.
 * @property {number}          maxCards        - Max cards capacity for this source (e.g. 100 or Infinity).
 */

/**
 * DataControl.js
 * ---------------------------------------------------------------------------
 * TẦNG 2: Bộ não điều phối trung tâm (Single Source of Truth)
 *
 * Chịu trách nhiệm:
 *   1. Quản lý trạng thái hiện tại (active source, soft index, hard index, cards).
 *   2. Đọc/Ghi mảng thẻ sạch trực tiếp từ src/core/db.js (BakoDB/appData).
 *   3. Cơ chế Pub/Sub (Event Emitter) cho UI Carousel, SwitcherBar và Desktop Renderer.
 */
export class DataControl {
    constructor() {
        /** @type {Map<string, import("../sources/BaseSource.js").BaseSource>} */
        this.sources = new Map();
        /** @type {string|null} */
        this.activeSourceId = null;

        /** Mảng các thẻ wallpaper của source hiện hành
         * @type {CardItem[]} */
        this.items = [];
        /** Hard index — chốt khi cuộn dừng hẳn. @type {number} */
        this.currentIndex = 0;
        /** Soft index — đang lướt qua (chưa chốt). @type {number} */
        this.softIndex = 0;

        /** @type {boolean} */
        this.isBusy = false;
        /** @type {"idle" | "fetching" | "deleting" | "switching"} */
        this.status = "idle";

        /** @type {Map<string, Set<Function>>} */
        this._listeners = new Map();

        this._switchToken = 0;

        this._initSources();
    }

    /* ── Event Emitter (Pub / Sub) ─────────────────────────────────────────── */

    /**
     * Subscribe to a DataControl event.
     * @param {DataControlEvent} event
     * @param {(payload: any) => void} callback
     * @returns {() => void} Unsubscribe function.
     */
    on(event, callback) {
        if (!this._listeners.has(event)) {
            this._listeners.set(event, new Set());
        }
        this._listeners.get(event).add(callback);
        return () => this.off(event, callback);
    }

    /**
     * Unsubscribe a previously registered callback.
     * @param {DataControlEvent} event
     * @param {(payload: any) => void} callback
     */
    off(event, callback) {
        const set = this._listeners.get(event);
        if (set) set.delete(callback);
    }

    /**
     * Emit an event to all registered listeners.
     * @param {DataControlEvent} event
     * @param {any} payload
     */
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
     * @returns {DataControlState}
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
            maxCards: Number(this.activeSource?.maxCards ?? Infinity),
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

        const switchToken = ++this._switchToken;

        this.activeSourceId = sourceId;
        this.isBusy = true;
        this.status = "switching";
        this._notifyState();

        this.emit("source:change", {
            sourceId,
            source: this.activeSource,
        });

        let storedItems = [];

        if (this.activeSource?.isDynamic) {
            // Nguồn biến động (như Collection), luôn lấy danh sách mới nhất từ DB
            try {
                const fetched = await this.activeSource.fetchItems();
                if (this._switchToken !== switchToken) return;
                if (Array.isArray(fetched)) {
                    storedItems = fetched.filter(Boolean);
                }
            } catch (err) {
                if (this._switchToken !== switchToken) return;
                console.error(`[DataControl] Failed to fetch items for volatile source [${sourceId}]:`, err);
            }
        } else {
            // Đọc danh sách thẻ từ BakoDB (appData)
            const rawStored = await getFromStore(`carousel:${sourceId}`);
            if (this._switchToken !== switchToken) return;
            storedItems = Array.isArray(rawStored) ? rawStored.filter(Boolean) : [];

            // Phục hồi thumbnail hợp lệ (Object URL mới trong session hiện tại) cho các thẻ
            if (this.activeSource && typeof this.activeSource.prepareThumb === "function") {
                await Promise.all(
                    storedItems.map((item) => this.activeSource.prepareThumb(item).catch(() => null))
                );
                if (this._switchToken !== switchToken) return;
            }
        }

        if (this._switchToken !== switchToken) return;

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
     * @returns {Promise<CardItem|null>} Thẻ mới vừa nạp xong, hoặc null nếu hết/lỗi/chạm ngưỡng.
     */
    async requestMore() {
        if (this.isBusy || !this.activeSource?.canGrow) return null;

        const cap = Number(this.activeSource?.maxCards);
        if (Number.isFinite(cap) && this.items.length >= cap) {
            this.emit("feed:limit_reached", {
                sourceId: this.activeSourceId,
                cap,
                count: this.items.length,
            });
            return null;
        }

        const currentSourceId = this.activeSourceId;
        this.isBusy = true;
        this.status = "fetching";
        this._notifyState();

        try {
            const newItems = await this.activeSource.fetchMore();
            if (this.activeSourceId !== currentSourceId) return null;

            if (!newItems || newItems.length === 0) {
                // Nguồn đã cạn ảnh
                this.emit("feed:exhausted", { sourceId: this.activeSourceId });
                return null;
            }

            const validFresh = newItems.filter(Boolean);
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

    /* ── Dọn dẹp lịch sử ảnh (Clear History) ───────────────────────────────── */

    /**
     * Dọn dẹp toàn bộ lịch sử cuộn ảnh của nguồn `sourceId`.
     * Giữ lại duy nhất 1 thẻ ảnh nếu nguồn này đang được áp dụng trên màn hình Desktop.
     *
     * @param {string} [sourceId=this.activeSourceId]
     * @returns {Promise<boolean>}
     */
    async clearSourceHistory(sourceId = this.activeSourceId) {
        if (this.isBusy || !sourceId) return false;

        const source = this.sources.get(sourceId);
        if (!source) return false;

        this.isBusy = true;
        this.status = "deleting";
        this._notifyState();

        try {
            const isCurrentlyActive = this.activeSourceId === sourceId;
            let itemsToProcess = [];

            if (isCurrentlyActive) {
                itemsToProcess = [...this.items];
            } else {
                const rawStored = await getFromStore(`carousel:${sourceId}`);
                itemsToProcess = Array.isArray(rawStored) ? rawStored.filter(Boolean) : [];
            }

            if (itemsToProcess.length === 0) {
                return true;
            }

            // Kiểm tra xem nguồn này có đang đặt hình nền cho Desktop không
            const wallpaperConfig = getSettings().wallpaperConfig || {};
            const isDesktopSource = wallpaperConfig.source === sourceId;
            const appliedId = isDesktopSource
                ? wallpaperConfig.activeWallpaperId || wallpaperConfig.activeCollectionItemId
                : null;

            // Tìm thẻ đang được desktop áp dụng (nếu có)
            let preservedCard = null;
            if (appliedId) {
                preservedCard = itemsToProcess.find((c) => c?.id === appliedId) || null;
            }

            // Các thẻ bị loại bỏ
            const removedCards = itemsToProcess.filter((c) => c !== preservedCard);

            // Giải phóng bộ nhớ RAM các thẻ bị loại bỏ
            for (const card of removedCards) {
                if (typeof source?.deleteItem === "function") {
                    await source.deleteItem(card);
                }
            }

            const remainingCards = preservedCard ? [preservedCard] : [];
            await this._persistCards(sourceId, remainingCards);

            // Kích hoạt dọn dẹp GC chạy ngầm sau khi xóa lịch sử
            if (typeof window !== "undefined" && typeof window.requestIdleCallback === "function") {
                window.requestIdleCallback(() => runMediaGC(), { timeout: 4000 });
            } else {
                setTimeout(() => runMediaGC(), 1000);
            }

            // Cập nhật index đã lưu về 0
            const currentSwitcher = getSettings().wallpaperSwitcher || {};
            const sourceIndices = { ...(currentSwitcher.sourceIndices || {}) };
            sourceIndices[sourceId] = 0;
            saveSettings({
                wallpaperSwitcher: {
                    ...currentSwitcher,
                    sourceIndices,
                },
            });

            // Nếu đây là nguồn đang mở trong carousel, cập nhật bộ nhớ tại chỗ và bắn sự kiện
            if (isCurrentlyActive) {
                this.items = remainingCards;
                this.currentIndex = 0;
                this.softIndex = 0;

                this.emit("cards:loaded", {
                    sourceId,
                    items: this.items,
                    currentIndex: 0,
                });
            }

            return true;
        } catch (err) {
            console.error(`[DataControl] Error clearing source history for [${sourceId}]:`, err);
            this.emit("error", {
                action: "clearSourceHistory",
                sourceId,
                error: err,
                message: err?.message || "Lỗi khi dọn dẹp lịch sử",
            });
            return false;
        } finally {
            this.isBusy = false;
            this.status = "idle";
            this._notifyState();
        }
    }

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
            // 1. Nếu source có logic xóa riêng (ví dụ CollectionDb) hoặc giải phóng RAM
            if (typeof this.activeSource?.deleteItem === "function") {
                await this.activeSource.deleteItem(cardToDelete);
            }

            // 2. Xóa khỏi mảng dữ liệu và cập nhật IndexedDB
            this.items.splice(targetIndex, 1);
            await this._persistCards(this.activeSourceId, this.items);

            // Xóa "bóng ma": Nếu dải thẻ đã rỗng, xóa luôn record current ở Data queue
            if (this.items.length === 0) {
                const storageKey = this.activeSource?.constructor?.storageKey;
                if (storageKey) {
                    const storeData = await getFromStore(storageKey);
                    if (storeData && storeData.applied) {
                        storeData.applied = null;
                        await saveToStore(storageKey, storeData);
                    }
                }
            }

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
            .filter(Boolean)
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
