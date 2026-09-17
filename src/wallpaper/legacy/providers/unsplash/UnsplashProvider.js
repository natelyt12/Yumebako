import { BaseProvider } from "../../BaseProvider.js";
import { getUnsplashData } from "/src/wallpaper/sources/api/unsplashAPI.js";
import { t } from "/src/core/i18n.js";
import { getSettings } from "/src/core/storageHandler.js";

export class UnsplashProvider extends BaseProvider {
    constructor() {
        super("unsplash", "Unsplash");
    }

    async init() {
        // No complex init needed for now
    }

    async fetch(options = {}) {
        const { refresh = false } = options;
        const data = await getUnsplashData(refresh);
        if (data?.error) {
            throw new Error(data.error);
        }
        if (!data || !data.blob) {
            throw new Error(t("sp.api.unsplash.no_result", "Không tìm thấy kết quả từ Unsplash."));
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
            author_name: data.author_name,
            author_url: data.author_url,
            description: data.description,
            download_location: data.download_location,
            queue_left: data.queue_left,
            queue_total: data.queue_total,
        };
        return this.currentData;
    }

    async download() {
        // Trigger Unsplash official download endpoint before saving to disk
        if (this.currentData?.download_location) {
            const apiKey = getSettings().unsplashApiKey;
            if (apiKey) {
                fetch(`${this.currentData.download_location}&client_id=${apiKey}`).catch(() => {});
            }
        }
        // Call the parent BaseProvider download method to actually download the blob
        await super.download();
    }

    getCollectionItemData() {
        // Trigger Unsplash official download endpoint when user explicitly adds to collection
        if (this.currentData?.download_location) {
            const apiKey = getSettings().unsplashApiKey;
            if (apiKey) {
                fetch(`${this.currentData.download_location}&client_id=${apiKey}`).catch(() => {});
            }
        }
        return super.getCollectionItemData();
    }

    getMetadataTooltip() {
        if (!this.currentData) return "";
        const d = this.currentData;
        
        let authorLink = d.author_name ? d.author_name : "Unknown";
        if (d.author_url) {
            // Unsplash guidelines require linking back to the photographer's profile
            const utmParams = "?utm_source=yumebako&utm_medium=referral";
            authorLink = `<a href="${d.author_url}${utmParams}" target="_blank">${d.author_name}</a>`;
        }

        let tooltip = `Photo by ${authorLink} on <a href="https://unsplash.com/?utm_source=yumebako&utm_medium=referral" target="_blank">Unsplash</a><br>Ratio: ${d.width}x${d.height}`;
        
        if (d.description) {
            tooltip += `<br>Desc: ${d.description}`;
        }
        return tooltip;
    }

    hasExtraSettings() {
        return false;
    }
}
