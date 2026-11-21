/**
 * Domain match table mapping Picre source URLs to display labels.
 */
export const PICRE_SOURCE_MAP = [
  { match: "pixiv.net", label: "Pixiv" },
  { match: "deviantart.com", label: "DeviantArt" },
  { match: "twitter.com", label: "X" },
  { match: "x.com", label: "X" },
  { match: "artstation.com", label: "ArtStation" },
  { match: "danbooru.donmai.us", label: "Danbooru" },
  { match: "safebooru.org", label: "Safebooru" },
  { match: "gelbooru.com", label: "Gelbooru" },
  { match: "yande.re", label: "Yande.re" },
  { match: "konachan.com", label: "Konachan" },
];

/**
 * Format pixel dimensions into a resolution string.
 * @param {number} width
 * @param {number} height
 * @returns {string} Example: "1920×1080", "2560×1440", "3840×2160".
 */
export function formatResolution(width, height) {
  if (!width || !height) return "";
  return `${width}×${height}`;
}

/**
 * Derive a short resolution tier badge ("8K", "4K", "2K", "FHD", "HD", or "").
 * @param {number} width
 * @param {number} height
 * @returns {string}
 */
export function getResolutionBadge(width, height) {
  if (!width || !height) return "";
  const maxDim = Math.max(width, height);
  const minDim = Math.min(width, height);
  if (maxDim >= 7680 || minDim >= 4320) return "8K";
  if (maxDim >= 3840 || minDim >= 2160) return "4K";
  if (maxDim >= 2560 || minDim >= 1440) return "2K";
  if (maxDim >= 1920 || minDim >= 1080) return "FHD";
  if (maxDim >= 1280 || minDim >= 720) return "HD";
  return "";
}

/**
 * Format byte count into a human-readable size string (B, KB, MB, GB).
 * @param {number} bytes
 * @returns {string}
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
 * Format a YYYYMMDD string, timestamp, or Date into DD/MM/YYYY.
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
 * Abbreviate large counts (e.g. 12500 -> "12.5k", 1200000 -> "1.2M").
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
 * Resolve the display label for a Picre origin URL.
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
