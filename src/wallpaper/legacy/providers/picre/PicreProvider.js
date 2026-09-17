import { BaseProvider } from "../../BaseProvider.js";
import { getPicreData } from "/src/wallpaper/sources/api/picreAPI.js";
import { t } from "/src/core/i18n.js";

const SOURCE_MAP = [
    { match: "pixiv.net", label: "Pixiv" },
    { match: "deviantart.com", label: "DeviantArt" },
];

function getSourceLabel(url) {
    if (!url) return "";
    const lower = url.toLowerCase();
    const entry = SOURCE_MAP.find((s) => lower.includes(s.match));
    return entry ? entry.label : url;
}

export class PicreProvider extends BaseProvider {
    constructor() {
        super("picre", "Picre (Anime)");
    }

    async fetch(options = {}) {
        const { refresh = false } = options;
        const data = await getPicreData(refresh);
        if (!data || !data.blob) {
            throw new Error(t("sp.api.error", { provider: "Picre" }));
        }

        this.currentData = {
            blob: data.blob,
            type: "image",
            source: data.source,
            width: data.width,
            height: data.height,
            size: data.size,
            image: data.image,
        };
        return this.currentData;
    }

    getMetadataTooltip() {
        if (!this.currentData) return "";
        const data = this.currentData;
        const sizeMB = data.size ? (data.size / 1024 / 1024).toFixed(2) : "?";
        const sourceLabel = data.source ? getSourceLabel(data.source) : t("sp.api.picre.noInfo", "Nguồn không xác định");
        return t("sp.api.picre.imageMetadata", {
            width: data.width || "?",
            height: data.height || "?",
            size: sizeMB,
            source: sourceLabel,
        });
    }

    hasExtraSettings() {
        return false;
    }
}
