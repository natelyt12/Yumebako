import { BaseProvider } from "../../BaseProvider.js";
import { getWallhavenData } from "/src/wallpaper/sources/api/wallhavenAPI.js";
import { createWallhavenSettingsUI } from "./wallhavenUi.js";
import { getSettings, saveSettings } from "/src/core/storageHandler.js";
import { t } from "/src/core/i18n.js";

export class WallhavenProvider extends BaseProvider {
    constructor() {
        super("wallhaven", "Wallhaven");
    }

    async init() {
        const config = getSettings().wallhavenConfig || {};
        if (!config.categories) {
            config.categories = { general: true, anime: true, people: false };
            saveSettings({ wallhavenConfig: config });
        }
    }

    async fetch(options = {}) {
        const { refresh = false } = options;
        const data = await getWallhavenData(refresh);
        if (data?.error) {
            throw new Error(data.error);
        }
        if (!data || !data.blob) {
            throw new Error(t("sp.api.wallhaven.no_result", "Không tìm thấy kết quả từ Wallhaven."));
        }

        this.currentData = {
            blob: data.blob,
            type: "image",
            source: data.source,
            width: data.width,
            height: data.height,
            size: data.size,
            image: data.image,
            category: data.category,
            queue_left: data.queue_left,
            queue_total: data.queue_total,
        };
        return this.currentData;
    }

    getMetadataTooltip() {
        if (!this.currentData) return "";
        const d = this.currentData;
        const queueStr = `${(d.queue_total || 24) - (d.queue_left || 0)}/${d.queue_total || 24}`;
        return t("sp.api.wallhaven.imageMetadata", {
            width: d.width || "?",
            height: d.height || "?",
            size: d.size ? (d.size / 1024 / 1024).toFixed(2) : "?",
            category: d.category || "?",
            queue: queueStr,
        });
    }

    hasExtraSettings() {
        return true;
    }

    getExtraSettingsTitle() {
        return t("sp.api.wallhaven.title", "Cài đặt Wallhaven");
    }

    renderExtraSettings() {
        return createWallhavenSettingsUI(this);
    }
}
