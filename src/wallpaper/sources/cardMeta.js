import { t } from "/src/core/i18n.js";
import { getSettings } from "/src/core/storageHandler.js";

/**
 * Mảng đối chiếu nguồn ảnh Picre (domain match -> Tên hiển thị).
 * Bạn có thể dễ dàng bổ sung các nguồn/link mới vào mảng này.
 */
export const PICRE_SOURCE_MAP = [
    { match: "pixiv.net", label: "Pixiv" },
    { match: "deviantart.com", label: "DeviantArt" },
    { match: "twitter.com", label: "Twitter" },
    { match: "x.com", label: "X" },
    { match: "artstation.com", label: "ArtStation" },
    { match: "danbooru.donmai.us", label: "Danbooru" },
    { match: "safebooru.org", label: "Safebooru" },
    { match: "gelbooru.com", label: "Gelbooru" },
    { match: "yande.re", label: "Yande.re" },
    { match: "konachan.com", label: "Konachan" },
];

/**
 * Định dạng độ phân giải (Resolution) từ width & height.
 * @param {number} width
 * @param {number} height
 * @returns {string} Ví dụ: "1920×1080", "2560×1440", "3840×2160"...
 */
export function formatResolution(width, height) {
    if (!width || !height) return "";
    return `${width}×${height}`;
}

/**
 * Định dạng dung lượng file (bytes -> KB/MB/GB).
 * @param {number} bytes
 * @returns {string} Ví dụ: "2.4 MB", "850 KB"
 */
export function formatFileSize(bytes) {
    if (!bytes || bytes <= 0) return "";
    const units = ["B", "KB", "MB", "GB"];
    let size = bytes;
    let unitIndex = 0;
    while (size >= 1024 && unitIndex < units.length - 1) {
        size /= 1024;
        unitIndex++;
    }
    return `${size >= 100 || unitIndex === 0 ? Math.round(size) : size.toFixed(1)} ${units[unitIndex]}`;
}

function escapeHtml(str) {
    if (!str) return "";
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

/**
 * Tìm nhãn nguồn tương ứng của URL trong PICRE_SOURCE_MAP.
 * @param {string} url
 * @returns {string}
 */
export function getPicreSourceLabel(url) {
    if (!url) return "Picre";
    const lower = url.toLowerCase();
    const entry = PICRE_SOURCE_MAP.find((s) => lower.includes(s.match));
    if (entry) return entry.label;

    if (/^https?:\/\//i.test(url)) {
        try {
            return new URL(url).hostname.replace(/^www\./, "");
        } catch {
            return "Picre";
        }
    }
    return url || "Picre";
}

/**
 * Xử lý và trả về HTML cho 2 vế của thẻ: Left (nguồn) và Right (thông số kỹ thuật codeblock).
 * @param {string} sourceId
 * @param {Object} card
 * @returns {{ leftHtml: string, rightHtml: string }}
 */
export function resolveCardMeta(sourceId, card) {
    if (!card) return { leftHtml: "", rightHtml: "" };

    // ── VẾ PHẢI (Right - Cố định chung mọi nguồn) ───────────────────────────
    // Cấu trúc: <code><file_size></code> • <code><resolution></code>
    const sizeStr = formatFileSize(card.size);
    const resStr = formatResolution(card.width, card.height) || card.resolution || "";

    const codeBlocks = [];
    if (sizeStr) codeBlocks.push(`<code>${escapeHtml(sizeStr)}</code>`);
    if (resStr) codeBlocks.push(`<code>${escapeHtml(resStr)}</code>`);

    const rightHtml = codeBlocks.join('<span class="card-meta-sep">•</span>');

    // ── VẾ TRÁI (Left - Thay đổi theo nguồn) ────────────────────────────────
    let leftHtml = "";

    if (sourceId === "collection") {
        // Collection: <type ảnh> • <nguồn>
        const isVideo = card.mediaType === "video" || card.type?.includes("video");
        const typeText = t(
            `sp.api.collection.${isVideo ? "typeVideo" : "typeImage"}`,
            isVideo ? "Video" : "Ảnh"
        );

        let srcText = "";
        const rawSource = card.metadata?.source || card.sourceUrl || "";
        const providerName = card.metadata?.providerName || "";
        const providerKey = card.metadata?.provider || "";

        if (providerName && providerKey !== "local") {
            srcText = providerName;
        } else if (rawSource === "local" || providerKey === "local" || card.local) {
            srcText = t("sp.api.collection.sourceLocal", "Trên máy");
        } else if (providerKey === "wallhaven" || rawSource.includes("wallhaven.cc")) {
            srcText = "Wallhaven";
        } else if (providerKey === "picre" || rawSource.includes("pic.re")) {
            srcText = "Picre";
        } else if (/^https?:\/\//i.test(rawSource)) {
            try {
                srcText = new URL(rawSource).hostname.replace(/^www\./, "");
            } catch {
                srcText = t("sp.api.collection.sourceLocal", "Trên máy");
            }
        } else {
            srcText = t("sp.api.collection.sourceLocal", "Trên máy");
        }

        leftHtml = `<span>${escapeHtml(typeText)}</span><span class="card-meta-sep">•</span><span>${escapeHtml(srcText)}</span>`;
    } else if (sourceId === "wallhaven") {
        // Remote / Wallhaven: <search query>
        const settings = getSettings();
        const wallhavenQuery = settings?.api_config?.wallhaven?.query || card.category || "Wallhaven";
        leftHtml = `<span>${escapeHtml(wallhavenQuery)}</span>`;
    } else if (sourceId === "picre") {
        // Remote / Picre: <tên nguồn> (từ PICRE_SOURCE_MAP)
        const sourceUrl = card.sourceUrl || card.source || "";
        const sourceName = getPicreSourceLabel(sourceUrl);
        leftHtml = `<span>${escapeHtml(sourceName)}</span>`;
    } else {
        // Fallback nguồn khác (Unsplash, etc.)
        const title = card.title || card.category || sourceId;
        leftHtml = `<span>${escapeHtml(title)}</span>`;
    }

    return { leftHtml, rightHtml };
}
