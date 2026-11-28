import { RemoteSource } from "./RemoteSource.js";
import { SOURCE_ACTIONS } from "./sourceActions.js";
import {
    fetchBingDaily8,
    clearBingCache,
    BING_STORAGE_KEY,
} from "/src/wallpaper/backend/sources/api/bingAPI.js";
import { uniqueCards, stripCardBlobs } from "../data/cardUtils.js";
import { getFromStore, saveToStore } from "/src/core/db.js";
import { getSettings } from "/src/core/storageHandler.js";
import { t } from "/src/core/i18n.js";
import {
    formatResolution,
    getResolutionBadge,
    formatFileSize,
    formatDate,
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
 * - Maintains a rolling window of up to 8 latest daily wallpapers.
 * - Automatically checks the local date on activation to fetch fresh wallpapers.
 * - No manual "fetch more" button (`canGrow = false`).
 * - Single-Phase Pipeline: downloads high-resolution (4K/1080p) and caches blobs in `mediaData`.
 */
export class BingSource extends RemoteSource {
    static id = "bing";
    static label = "Bing";
    static providerId = "bing";
    static storageKey = BING_STORAGE_KEY;
    static maxCards = Infinity;

    /** Volatile: DataControl always calls `fetchItems()` to check the date on tab activation. */
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
     * Hydrate thumbnail Object URLs in parallel and release stale ones.
     * @param {Array<Object>} cachedItems
     * @returns {Promise<Array<Object>>}
     * @private
     */
    async _hydrateCachedItems(cachedItems) {
        await Promise.all(
            cachedItems.map((item) => this.prepareThumb(item).catch(() => null)),
        );
        this._releaseUnusedThumbs(
            new Set(cachedItems.map((i) => String(i.id))),
        );
        return cachedItems;
    }

    /**
     * Load the 8 latest daily wallpapers.
     * Reuses cached cards when date and resolution match; otherwise fetches from
     * Bing API, executes the Single-Phase Pipeline safely with `Promise.allSettled`,
     * deduplicates, strips transient blob URLs before saving, and releases stale thumbs.
     *
     * @returns {Promise<Array<Object>>}
     */
    async fetchItems() {
        const key = this.constructor.storageKey;
        const storeData = (await getFromStore(key)) || {
            items: [],
            lastDate: null,
            lastResolution: null,
            current: null,
        };

        const cachedItems = uniqueCards(
            Array.isArray(storeData.items) ? storeData.items : [],
        );

        const settings = getSettings();
        const config = settings.bingConfig || {};
        const resolution = config.resolution || "1080p";
        const todayStr = getTodayDateString();

        const isSameDate = storeData.lastDate === todayStr;
        const isSameConfig = storeData.lastResolution === resolution;
        const hasValidCachedItems = cachedItems.length > 0;

        // 1. Same date and resolution: hydrate cached items immediately.
        if (isSameDate && isSameConfig && hasValidCachedItems) {
            return this._hydrateCachedItems(cachedItems);
        }

        // 2. New day, first boot, or resolution changed: fetch fresh daily wallpapers.
        try {
            const rawItems = await fetchBingDaily8({ resolution, strict: true });
            if (!rawItems || rawItems.length === 0) {
                if (hasValidCachedItems) {
                    return this._hydrateCachedItems(cachedItems);
                }
                this._releaseUnusedThumbs(new Set());
                return [];
            }

            const items = uniqueCards(
                rawItems.map((entry) =>
                    this.toCarouselItem(entry, {
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
                    }),
                ),
            );

            // Execute Single-Phase Pipeline across all items without failing the whole batch on one error.
            const settled = await Promise.allSettled(
                items.map((item) =>
                    this.processSinglePhasePipeline(item).then(() => item),
                ),
            );

            const succeeded = [];
            let firstError = null;
            for (const outcome of settled) {
                if (outcome.status === "fulfilled" && outcome.value) {
                    succeeded.push(outcome.value);
                } else if (outcome.status === "rejected" && !firstError) {
                    firstError = outcome.reason;
                }
            }

            if (succeeded.length === 0) {
                if (hasValidCachedItems) {
                    return this._hydrateCachedItems(cachedItems);
                }
                this._releaseUnusedThumbs(new Set());
                throw firstError || new Error("Failed to fetch Bing daily wallpapers");
            }

            const finalItems = uniqueCards(succeeded);
            this._releaseUnusedThumbs(
                new Set(finalItems.map((i) => String(i.id))),
            );

            storeData.items = finalItems.map(stripCardBlobs);
            storeData.lastDate = todayStr;
            storeData.lastResolution = resolution;
            await saveToStore(key, storeData);

            return finalItems;
        } catch (err) {
            console.error("[BingSource] Failed to fetch 8 daily wallpapers from Bing:", err);
            if (hasValidCachedItems) {
                return this._hydrateCachedItems(cachedItems);
            }
            this._releaseUnusedThumbs(new Set());
            throw err;
        }
    }

    /**
     * Clear Bing's persisted daily snapshot and release in-memory caches.
     * @returns {Promise<void>}
     */
    async clearCache() {
        await clearBingCache();
        this._releaseAllThumbs();
        this.blobCache.clear();
    }

    /**
     * Update `effects` on matching items in Bing's persisted daily snapshot.
     * @param {(item: Object) => boolean} matchFn
     * @param {Object} effects
     * @returns {Promise<boolean>}
     */
    async updateCachedEffects(matchFn, effects) {
        if (typeof matchFn !== "function" || !effects) return false;
        const key = this.constructor.storageKey;
        const storeData = await getFromStore(key);
        if (!Array.isArray(storeData?.items) || storeData.items.length === 0) {
            return false;
        }

        let changed = false;
        for (const item of storeData.items) {
            if (item && matchFn(item)) {
                item.effects = JSON.parse(JSON.stringify(effects));
                changed = true;
            }
        }

        if (changed) {
            await saveToStore(key, storeData);
        }
        return changed;
    }

    /**
     * Title of the wallpaper restored from its persisted `applied` record.
     * @param {Object} applied
     * @returns {string}
     */
    getSeedTitle(applied) {
        return this._getCleanTitle(applied);
    }

    /**
     * Extract a clean subject title for a Bing card, avoiding generic "Info" titles.
     * @param {Object} card
     * @returns {string}
     * @private
     */
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

    // ─── Pure Structured Metadata ─────────────────────────────────────────────

    /**
     * Return pure structured summary metadata for a Bing card (zero HTML).
     * @param {Object} card
     * @returns {import("./BaseSource.js").MetaData|null}
     */
    getMetaData(card) {
        if (!card) return null;
        const title = this._getCleanTitle(card);
        const dateStr = formatDate(card.startDate || card.raw?.startDate);
        const badge = getResolutionBadge(card.width, card.height);
        const resolution = formatResolution(card.width, card.height);
        const size = formatFileSize(card.size);

        const segments = [{ type: "text", text: title }];
        if (dateStr) {
            segments.push({ type: "text", text: dateStr });
        } else if (badge) {
            segments.push({ type: "badge", text: badge });
        }

        return { segments, badge, resolution, size };
    }

    /**
     * Return pure structured detail rows for a Bing card (zero HTML).
     * @param {Object} card
     * @returns {import("./BaseSource.js").MetaDetailRow[]}
     */
    getMetaDetails(card) {
        if (!card) return [];
        const details = [];

        const title = this._getCleanTitle(card);
        if (title) {
            details.push({
                kind: "text",
                key: "title",
                label: t("sp.meta.title", "Tiêu đề"),
                value: title,
            });
        }

        const dateStr = formatDate(card.startDate || card.raw?.startDate);
        if (dateStr) {
            details.push({
                kind: "text",
                key: "date_released",
                label: t("sp.meta.date_released", "Ngày phát hành"),
                value: dateStr,
            });
        }

        const badge = getResolutionBadge(card.width, card.height);
        const res = formatResolution(card.width, card.height);
        if (res) {
            details.push({
                kind: "resolution",
                key: "resolution",
                label: t("sp.meta.resolution", "Độ phân giải"),
                value: res,
                ...(badge ? { badge } : {}),
            });
        }

        const size = formatFileSize(card.size);
        if (size) {
            details.push({
                kind: "text",
                key: "filesize",
                label: t("sp.meta.filesize", "Dung lượng"),
                value: size,
            });
        }

        const copyright = card.copyright || card.raw?.copyright;
        if (copyright) {
            details.push({
                kind: "text",
                key: "copyright",
                label: t("sp.meta.copyright", "Bản quyền"),
                value: copyright,
                stacked: true,
            });
        }

        details.push({
            kind: "text",
            key: "source",
            label: t("sp.meta.source", "Nguồn ảnh"),
            value: "Microsoft Bing",
        });

        return details;
    }
}
