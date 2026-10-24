import { t } from "/src/core/i18n.js";
import { getSettings } from "/src/core/storageHandler.js";

/**
 * Mảng đối chiếu nguồn ảnh Picre (domain match -> Tên hiển thị).
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
 * Suy ra chuẩn badge phân giải (4K UHD, 2K QHD, FHD, HD) dựa trên kích thước ngang/dọc.
 * @param {number} width
 * @param {number} height
 * @returns {string} Ví dụ: "4K UHD", "2K QHD", "FHD", "HD", hoặc ""
 */
export function getResolutionBadge(width, height) {
  if (!width || !height) return "";
  const maxDim = Math.max(width, height);
  const minDim = Math.min(width, height);
  if (maxDim >= 3840 || minDim >= 2160) return "4K UHD";
  if (maxDim >= 2560 || minDim >= 1440) return "2K QHD";
  if (maxDim >= 1920 || minDim >= 1080) return "FHD";
  if (maxDim >= 1280 || minDim >= 720) return "HD";
  return "";
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

/**
 * Định dạng ngày (YYYYMMDD hoặc timestamp) thành DD/MM/YYYY.
 * @param {string|number|Date} val
 * @returns {string}
 */
export function formatDate(val) {
  if (!val) return "";
  if (typeof val === "string" && /^\d{8}$/.test(val)) {
    const y = val.slice(0, 4);
    const m = val.slice(4, 6);
    const d = val.slice(6, 8);
    return `${d}/${m}/${y}`;
  }
  const date = new Date(val);
  if (isNaN(date.getTime())) return String(val);
  const d = String(date.getDate()).padStart(2, "0");
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const y = date.getFullYear();
  return `${d}/${m}/${y}`;
}

/**
 * Rút gọn số lượng lớn (ví dụ: 12500 -> 12.5k).
 * @param {number} num
 * @returns {string}
 */
export function formatNumber(num) {
  if (num === null || num === undefined || isNaN(num)) return "";
  const n = Number(num);
  if (n >= 1000000) return (n / 1000000).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, "") + "k";
  return String(n);
}

/**
 * Escape chuỗi HTML an toàn.
 * @param {any} str
 * @returns {string}
 */
export function escapeHtml(str) {
  if (str === null || str === undefined) return "";
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
 * Xử lý và trả về HTML cho 2 vế của thẻ (hàm fallback tương thích ngược).
 * @param {string} sourceId
 * @param {Object} card
 * @returns {{ leftHtml: string, rightHtml: string }}
 */
export function resolveCardMeta(sourceId, card) {
  if (!card) return { leftHtml: "", rightHtml: "" };

  const sizeStr = formatFileSize(card.size);
  const resStr =
    formatResolution(card.width, card.height) || card.resolution || "";

  const codeBlocks = [];
  if (sizeStr) codeBlocks.push(`<span>${escapeHtml(sizeStr)}</span>`);
  if (resStr) codeBlocks.push(`<span>${escapeHtml(resStr)}</span>`);

  const rightHtml = codeBlocks.join('<span class="card-meta-sep">•</span>');

  let leftHtml = "";
  if (sourceId === "collection") {
    const isVideo = card.mediaType === "video" || card.type?.includes("video");
    const typeText = t(
      `sp.meta.${isVideo ? "type_video" : "type_image"}`,
      isVideo ? "Video" : "Ảnh",
    );

    let srcText = "";
    const rawSource = card.metadata?.source || card.sourceUrl || "";
    const providerName = card.metadata?.providerName || "";
    const providerKey = card.metadata?.provider || "";

    if (providerName && providerKey !== "local") {
      srcText = providerName;
    } else if (
      providerKey === "wallhaven" ||
      rawSource.includes("wallhaven.cc")
    ) {
      srcText = "Wallhaven";
    } else if (
      providerKey === "unsplash" ||
      rawSource.includes("unsplash.com")
    ) {
      srcText = "Unsplash";
    } else if (providerKey === "picre" || rawSource.includes("pic.re")) {
      srcText = "Picre";
    } else if (providerKey === "bing" || rawSource.includes("bing.com")) {
      srcText = "Bing";
    } else if (rawSource && /^https?:\/\//i.test(rawSource)) {
      try {
        srcText = new URL(rawSource).hostname.replace(/^www\./, "");
      } catch {
        srcText = t("sp.meta.local_device", "Trên máy tính");
      }
    } else {
      srcText = t("sp.meta.local_device", "Trên máy tính");
    }

    leftHtml = `<span>${escapeHtml(typeText)}</span><span class="card-meta-sep">•</span><span>${escapeHtml(srcText)}</span>`;
  } else if (sourceId === "wallhaven") {
    const cardQuery = card.query !== undefined ? card.query : card.raw?.query;
    const wallhavenQuery =
      (typeof cardQuery === "string" ? cardQuery.trim() : null) ||
      getSettings()?.wallhavenConfig?.query?.trim() ||
      card.category ||
      t("sp.meta.random", "Ngẫu nhiên");
    leftHtml = `<span>${escapeHtml(wallhavenQuery)}</span>`;
  } else if (sourceId === "picre") {
    const sourceUrl = card.sourceUrl || card.source || "";
    const sourceName = getPicreSourceLabel(sourceUrl);
    leftHtml = `<span>${escapeHtml(sourceName)}</span>`;
  } else if (sourceId === "bing") {
    const title = card.title || card.metadata?.copyright || "Bing";
    leftHtml = `<span>${escapeHtml(title)}</span>`;
  } else {
    const title = card.title || card.category || sourceId;
    leftHtml = `<span>${escapeHtml(title)}</span>`;
  }

  return { leftHtml, rightHtml };
}
