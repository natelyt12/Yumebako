import { RemoteSource } from "./RemoteSource.js";
import { fetchPicreMeta } from "/src/wallpaper/backend/sources/api/picreAPI.js";
import { t } from "/src/core/i18n.js";
import {
    getPicreSourceLabel,
    formatResolution,
    getResolutionBadge,
    formatFileSize,
} from "./cardMeta.js";

/**
 * PicreSource.js
 * ---------------------------------------------------------------------------
 * Switcher source for pic.re (anime wallpapers). The service exposes a single
 * random image endpoint, mapping cleanly onto one request per revealed card.
 *
 * pic.re returns no thumbnail, so `generateThumbnail` makes the base class
 * download the full image once and derive a compact JPEG thumbnail.
 */
export class PicreSource extends RemoteSource {
    static id = "picre";
    static label = "Picre";
    static providerId = "picre";
    static storageKey = "provider_state:picre";
    static generateThumbnail = true;

    /** @returns {boolean} */
    get hasProviderSettings() {
        return true;
    }

    /**
     * Fetch one random Picre wallpaper record.
     * @returns {Promise<Object|null>}
     */
    async fetchItem() {
        const meta = await fetchPicreMeta();
        if (!meta?.image) return null;

        return this.toCarouselItem(meta, {
            id: meta.image.split("/").pop(),
            url: meta.image,
            sourceUrl: meta.source || "",
            title: getPicreSourceLabel(meta.source) || "Picre",
            category: "Picre",
            thumbnailUrl: meta.image,
            width: meta.width || 0,
            height: meta.height || 0,
            size: meta.file_size || 0,
            raw: meta,
        });
    }

    /**
     * Title of the wallpaper restored from its persisted `applied` record.
     * @param {Object} applied
     * @returns {string}
     */
    getSeedTitle(applied) {
        return getPicreSourceLabel(applied.source) || "Picre";
    }

    // ─── Pure Structured Metadata ─────────────────────────────────────────────

    /**
     * Return pure structured summary metadata for a Picre card (zero HTML).
     * @param {Object} card
     * @returns {import("./BaseSource.js").MetaData|null}
     */
    getMetaData(card) {
        if (!card) return null;
        const platform = getPicreSourceLabel(card.sourceUrl || card.source) || "Picre";
        const badge = getResolutionBadge(card.width, card.height);
        const resolution = formatResolution(card.width, card.height);
        const size = formatFileSize(card.size);

        const segments = [{ type: "text", text: platform }];
        if (badge) {
            segments.push({ type: "badge", text: badge });
        } else if (size) {
            segments.push({ type: "text", text: size });
        }

        return { segments, badge, resolution, size };
    }

    /**
     * Return pure structured detail rows for a Picre card (zero HTML).
     * @param {Object} card
     * @returns {import("./BaseSource.js").MetaDetailRow[]}
     */
    getMetaDetails(card) {
        if (!card) return [];
        const details = [];

        const platform = getPicreSourceLabel(card.sourceUrl || card.source);
        if (platform) {
            details.push({
                kind: "text",
                key: "platform",
                label: t("sp.meta.platform", "Nền tảng"),
                value: platform,
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

        details.push({
            kind: "text",
            key: "source",
            label: t("sp.meta.source", "Nguồn ảnh"),
            value: "pic.re",
        });

        return details;
    }
}
