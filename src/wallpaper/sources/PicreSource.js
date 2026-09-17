import { RemoteSource } from "./RemoteSource.js";
import { fetchPicreMeta } from "/src/wallpaper/sources/api/picreAPI.js";

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
    static storageKey = "data:picre";
    static generateThumbnail = true;

    async fetchItem() {
        const meta = await fetchPicreMeta();
        if (!meta?.image) return null;

        return this.toCarouselItem(meta, {
            id: meta.image.split("/").pop(),
            url: meta.image,
            sourceUrl: meta.source || "",
            title: getSourceLabel(meta.source) || "Picre",
            category: "Picre",
            thumbnailUrl: meta.image,
            width: meta.width || 0,
            height: meta.height || 0,
            size: meta.file_size || 0,
        });
    }

    /** Title of the wallpaper restored from its persisted `current` record. */
    getSeedTitle(current) {
        return getSourceLabel(current.source) || "Picre";
    }
}
