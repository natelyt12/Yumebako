import { RemoteSource } from "./RemoteSource.js";
import { SOURCE_ACTIONS } from "./sourceActions.js";
import { fetchBingDaily8, BING_STORAGE_KEY } from "/src/wallpaper/sources/api/bingAPI.js";
import { getFromStore, saveToStore } from "/src/core/db.js";
import { getSettings } from "/src/core/storageHandler.js";
import { t } from "/src/core/i18n.js";
import {
    formatResolution,
    getResolutionBadge,
    formatFileSize,
    formatDate,
    escapeHtml,
} from "./cardMeta.js";

/**
 * Format local date as YYYYMMDD string.
 * @returns {string}
 */
function getTodayDateString() {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, "0");
    const d = String(now.getDate()).padStart(2, "0");
    return `${y}${m}${d}`;
}

/**
 * BingSource.js
 * ---------------------------------------------------------------------------
 * Switcher source that provides Microsoft Bing daily wallpapers.
 * - Always maintains a fixed rolling window of the 8 latest daily wallpapers.
 * - Automatically checks application date upon opening to fetch fresh wallpapers.
 * - No manual "fetch more" button (canGrow = false).
 * - Single-Phase Pipeline: downloads high-resolution (4K/1080p) and caches blobs in mediaData.
 */
export class BingSource extends RemoteSource {
    static id = "bing";
    static label = "Bing";
    static providerId = "bing";
    static storageKey = BING_STORAGE_KEY;
    static maxCards = Infinity;

    /** Volatile: DataControl always calls fetchItems() to check the date on tab activation. */
    get isDynamic() {
        return true;
    }

    /** Fixed 8-card rolling archive: user cannot fetch more cards beyond the 8 daily cards. */
    get canGrow() {
        return false;
    }

    /** Actions available for Bing wallpapers (Download, View Source, Add to Collection). */
    get actions() {
        return [
            SOURCE_ACTIONS.download,
            SOURCE_ACTIONS.source,
            SOURCE_ACTIONS.add,
        ];
    }

    /** Settings sidebar panel for Resolution selection. */
    get hasProviderSettings() {
        return true;
    }

    /**
     * Always loads the 8 latest daily wallpapers.
     * Uses cached cards if still on the same date and same resolution;
     * otherwise queries Bing API, runs the Single-Phase Pipeline, and caches.
     *
     * @returns {Promise<Array<Object>>}
     */
    async fetchItems() {
        this._releaseAllThumbs();
        this.blobCache.clear();

        const key = this.constructor.storageKey;
        const storeData = (await getFromStore(key)) || {
            items: [],
            lastDate: null,
            lastResolution: null,
            current: null,
        };

        const settings = getSettings();
        const config = settings.bingConfig || {};
        const resolution = config.resolution || "1080p";
        const todayStr = getTodayDateString();

        const isSameDate = storeData.lastDate === todayStr;
        const isSameConfig = storeData.lastResolution === resolution;
        const hasValidCachedItems = Array.isArray(storeData.items) && storeData.items.length > 0;

        // 1. Nếu cùng ngày và cùng độ phân giải, dùng ngay danh sách trong IndexedDB (0ms trễ)
        if (isSameDate && isSameConfig && hasValidCachedItems) {
            for (const item of storeData.items) {
                await this.prepareThumb(item);
            }
            return storeData.items;
        }

        // 2. Sang ngày mới, lần đầu khởi động, hoặc vừa đổi cài đặt: Tải mới 8 ảnh
        try {
            const rawItems = await fetchBingDaily8({ resolution, strict: true });
            if (!rawItems || rawItems.length === 0) {
                if (hasValidCachedItems) {
                    for (const item of storeData.items) {
                        await this.prepareThumb(item);
                    }
                    return storeData.items;
                }
                return [];
            }

            const items = rawItems.map((entry) => this.toCarouselItem(entry, {
                id: String(entry.id),
                url: entry.url,
                sourceUrl: entry.sourceUrl || "https://www.bing.com",
                title: entry.title || "Bing Wallpaper",
                category: "Bing",
                thumbnailUrl: entry.thumbnailUrl || entry.url,
                width: entry.width || (resolution === "uhd" ? 3840 : 1920),
                height: entry.height || (resolution === "uhd" ? 2160 : 1080),
                size: entry.size || 0,
                copyright: entry.copyright || "",
                startDate: entry.startDate || "",
                raw: entry,
            }));

            // Chạy Single-Phase Pipeline song song cho 8 ảnh: tải blob gốc & sinh thumbnail 16:9
            await Promise.all(items.map((item) => this.processSinglePhasePipeline(item)));

            // Chuẩn bị mảng để lưu vào IndexedDB (reset blob URL thành null theo Anti-Pattern 3)
            const cleanItems = items.map((item) => ({
                ...item,
                thumbnailUrl: null,
            }));

            storeData.items = cleanItems;
            storeData.lastDate = todayStr;
            storeData.lastResolution = resolution;
            await saveToStore(key, storeData);

            return items;
        } catch (err) {
            console.error("[BingSource] Failed to fetch 8 daily wallpapers from Bing:", err);
            if (hasValidCachedItems) {
                for (const item of storeData.items) {
                    await this.prepareThumb(item);
                }
                return storeData.items;
            }
            throw err;
        }
    }

    /** Title of the wallpaper restored from its persisted `applied` record. */
    getSeedTitle(applied) {
        return this._getCleanTitle(applied);
    }

    /** Trích xuất tiêu đề thực tế của ảnh Bing, tránh trường hợp API trả về "Info" */
    _getCleanTitle(card) {
        const rawTitle = card?.title?.trim();
        if (rawTitle && !/^info$/i.test(rawTitle) && !/^bing\b/i.test(rawTitle)) {
            return rawTitle;
        }
        const copyright = card?.copyright || card?.raw?.copyright;
        if (copyright) {
            const subject = copyright.split("(")[0].trim();
            if (subject && !/^info$/i.test(subject)) return subject;
        }
        return (rawTitle && !/^info$/i.test(rawTitle)) ? rawTitle : "Bing";
    }

    // ─── Chip Info (Collapsed & Hover Expand) ─────────────────────────────────

    getChipSummary(card) {
        if (!card) return "";
        const title = this._getCleanTitle(card);
        const dateStr = formatDate(card.startDate || card.raw?.startDate);
        const badge = getResolutionBadge(card.width, card.height);

        const parts = [
            `<span>${escapeHtml(title)}</span>`,
        ];

        if (dateStr) {
            parts.push(`<span>${escapeHtml(dateStr)}</span>`);
        } else if (badge) {
            parts.push(`<span class="meta_badge">${escapeHtml(badge)}</span>`);
        }

        return parts.join('<span class="card-meta-sep">•</span>');
    }

    getChipDetails(card) {
        if (!card) return [];
        const details = [];

        const title = this._getCleanTitle(card);
        if (title) {
            details.push({
                label: t("sp.meta.title", "Tiêu đề"),
                value: title,
            });
        }

        const dateStr = formatDate(card.startDate || card.raw?.startDate);
        if (dateStr) {
            details.push({
                label: t("sp.meta.date_released", "Ngày phát hành"),
                value: dateStr,
            });
        }

        const badge = getResolutionBadge(card.width, card.height);
        const res = formatResolution(card.width, card.height);
        if (res) {
            const badgeHtml = badge ? ` <span class="meta_badge">${escapeHtml(badge)}</span>` : "";
            details.push({
                label: t("sp.meta.resolution", "Độ phân giải"),
                value: `${escapeHtml(res)}${badgeHtml}`,
                html: true,
            });
        }

        const size = formatFileSize(card.size);
        if (size) {
            details.push({
                label: t("sp.meta.filesize", "Dung lượng"),
                value: size,
            });
        }

        const copyright = card.copyright || card.raw?.copyright;
        if (copyright) {
            details.push({
                label: t("sp.meta.copyright", "Bản quyền"),
                value: copyright,
                stacked: true,
            });
        }

        details.push({
            label: t("sp.meta.source", "Nguồn ảnh"),
            value: "Microsoft Bing",
        });

        return details;
    }
}
