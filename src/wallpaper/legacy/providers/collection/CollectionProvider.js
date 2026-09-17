import { BaseProvider } from "../../BaseProvider.js";
import { getCollection } from "/src/wallpaper/sources/api/collectionDb.js";
import { createCollectionSettingsUI, cleanupCollectionUI } from "./collectionUi.js";
import { getSettings, saveSettings } from "/src/core/storageHandler.js";
import { t } from "/src/core/i18n.js";

export class CollectionProvider extends BaseProvider {
    constructor() {
        super("collection", "Bộ sưu tập");
    }

    get showAddToCollectionButton() {
        return false;
    }

    get showSourceButton() {
        return true;
    }

    get canViewSource() {
        const src = this.currentData?.source || this.currentData?.metadata?.source;
        return Boolean(src && /^https?:\/\//i.test(src));
    }

    get showExtraSettingsButton() {
        return true;
    }

    get extraSettingsOptions() {
        return { width: "800px" };
    }

    async fetch(options = {}) {
        const { refresh = false } = options;
        const collection = await getCollection();

        if (!collection || collection.length === 0) {
            this.onExtraSettingsClick();
            this.currentData = {
                type: "color",
                color: "#000000",
                metadata: { source: "local" },
            };
            return this.currentData;
        }

        const settings = getSettings();
        let item = null;

        if (!refresh && settings.wallpaperConfig?.activeCollectionItemId) {
            item = collection.find((i) => i.id === settings.wallpaperConfig.activeCollectionItemId);
        }

        if (!item) {
            item = refresh ? collection[Math.floor(Math.random() * collection.length)] : collection[0];
            if (settings.wallpaperConfig) {
                settings.wallpaperConfig.activeCollectionItemId = item.id;
                saveSettings({ wallpaperConfig: settings.wallpaperConfig });
            }
        }

        const isVideo = item.type === "video" || item.type === "local_video" || (item.blob && item.blob.type.startsWith("video/"));
        this.currentData = {
            blob: item.blob,
            type: isVideo ? "video" : "image",
            source: item.metadata?.source || "local",
            metadata: item.metadata || {},
            id: item.id,
        };
        return this.currentData;
    }

    getMetadataTooltip() {
        if (!this.currentData || !this.currentData.metadata || this.currentData.type === "color") {
            return t("sp.api.collection.empty_title", "Bộ sưu tập trống");
        }

        const data = this.currentData.metadata || {};
        const isVideo = this.currentData.type === "video";
        const rawSource = data.source || "";
        const isLocal = rawSource === "local" || !/^https?:\/\//i.test(rawSource);
        const providerName = data.providerName || data.provider;

        const typeKey = isVideo ? "typeVideo" : "typeImage";
        const mediaType = t("sp.api.collection.typeLabel", { type: t(`sp.api.collection.${typeKey}`) });
        
        let srcVal;
        if (providerName) {
            srcVal = providerName;
        } else if (isLocal) {
            srcVal = t("sp.api.collection.sourceLocal", "Local");
        } else {
            srcVal = rawSource;
        }
        
        const srcLabel = t("sp.api.collection.sourceLabel", { source: srcVal });
        const sizeMB = data.size ? t("sp.api.collection.sizeLabel", { size: (data.size / 1024 / 1024).toFixed(1) }) : "";
        const res = data.width && data.height ? t("sp.api.collection.resolutionLabel", { width: data.width, height: data.height }) : "";

        return [mediaType, srcLabel, sizeMB, res].filter(Boolean).join(" | ");
    }

    hasExtraSettings() {
        return true;
    }

    getExtraSettingsTitle() {
        return t("sp.api.collection.title", "Quản lý Bộ sưu tập");
    }

    async renderExtraSettings() {
        return await createCollectionSettingsUI();
    }

    onExtraSettingsClose() {
        cleanupCollectionUI();
    }
}
