import { RemoteSource } from "./RemoteSource.js";
import { fetchPicreMeta } from "/src/wallpaper/sources/api/picreAPI.js";
import { t } from "/src/core/i18n.js";
import {
    getPicreSourceLabel,
    formatResolution,
    getResolutionBadge,
    formatFileSize,
    escapeHtml,
} from "./cardMeta.js";

/**
 * PicreSource.js
 * ---------------------------------------------------------------------------
 * Switcher source for pic.re (anime wallpapers). The service only exposes a
 * single random image endpoint, so it maps perfectly onto the lazy model:
 * one request per revealed card.
 *
 * pic.re returns no thumbnail, so items would otherwise have to decode the
 * full resolution image. `generateThumbnail` makes the base class download it
 * once and derive a small JPEG — that blob is then reused for apply/download.
 */
export class PicreSource extends RemoteSource {
    static id = "picre";
    static label = "Picre";
    static providerId = "picre";
    static storageKey = "provider_state:picre";
    static generateThumbnail = true;

    get hasProviderSettings() {
        return true;
    }

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

    /** Title of the wallpaper restored from its persisted `current` record. */
    getSeedTitle(applied) {
        return getPicreSourceLabel(applied.source) || "Picre";
    }

    // ─── Chip Info (Collapsed & Hover Expand) ─────────────────────────────────

    getChipSummary(card) {
        if (!card) return "";
        const platform = getPicreSourceLabel(card.sourceUrl || card.source) || "Picre";
        const badge = getResolutionBadge(card.width, card.height);
        const size = formatFileSize(card.size);

        const parts = [
            `<span>${escapeHtml(platform)}</span>`,
        ];

        if (badge) {
            parts.push(`<span class="meta_badge">${escapeHtml(badge)}</span>`);
        } else if (size) {
            parts.push(`<span>${escapeHtml(size)}</span>`);
        }

        return parts.join('<span class="card-meta-sep">•</span>');
    }

    getChipDetails(card) {
        if (!card) return [];
        const details = [];

        const platform = getPicreSourceLabel(card.sourceUrl || card.source);
        if (platform) {
            details.push({
                label: t("sp.meta.platform", "Nền tảng"),
                value: platform,
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

        details.push({
            label: t("sp.meta.source", "Nguồn ảnh"),
            value: "pic.re",
        });

        return details;
    }
}
