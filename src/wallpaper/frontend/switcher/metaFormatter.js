/**
 * metaFormatter.js
 * ---------------------------------------------------------------------------
 * Layer 1 HTML/DOM formatting utilities for structured card metadata returned
 * by Layer 3 sources (`getMetaData` and `getMetaDetails`).
 */

/**
 * Escape special HTML characters for safe DOM insertion.
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
 * Format structured summary metadata produced by `source.getMetaData(card)` into
 * HTML for the Top Bar chip summary.
 *
 * @param {{ segments?: Array<Object> }|null|undefined} metaData
 * @returns {string}
 */
export function formatMetaSummaryHtml(metaData) {
  if (!metaData || !Array.isArray(metaData.segments)) return "";
  const parts = [];
  for (const seg of metaData.segments) {
    if (!seg) continue;
    if (seg.type === "author") {
      if (seg.name) {
        parts.push(
          `<span>${escapeHtml(seg.prefix || "")} <strong>${escapeHtml(seg.name)}</strong></span>`,
        );
      }
    } else if (seg.type === "badge") {
      if (seg.text) {
        parts.push(`<span class="meta_badge">${escapeHtml(seg.text)}</span>`);
      }
    } else if (seg.text) {
      parts.push(`<span>${escapeHtml(seg.text)}</span>`);
    }
  }
  return parts.join('<span class="card-meta-sep">•</span>');
}

/**
 * Format structured detail rows produced by `source.getMetaDetails(card)` into
 * `{ label, value, html?, stacked? }` view descriptors for Layer 1 panels.
 *
 * @param {Array<Object>|null|undefined} rows
 * @returns {Array<{ label: string, value: string, html?: boolean, stacked?: boolean }>}
 */
export function formatMetaDetailRows(rows) {
  if (!Array.isArray(rows)) return [];
  const details = [];

  for (const row of rows) {
    if (!row) continue;
    if (row.kind === "link") {
      if (!row.text) continue;
      const rawUrl = typeof row.url === "string" ? row.url.trim() : "";
      const safeUrl = /^https?:\/\//i.test(rawUrl) ? rawUrl : "";
      details.push({
        label: row.label,
        value: safeUrl
          ? `<a href="${escapeHtml(safeUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(row.text)}</a>`
          : String(row.text),
        html: Boolean(safeUrl),
      });
    } else if (row.kind === "resolution") {
      if (!row.value) continue;
      const badgeHtml = row.badge
        ? ` <span class="meta_badge">${escapeHtml(row.badge)}</span>`
        : "";
      details.push({
        label: row.label,
        value: `${escapeHtml(row.value)}${badgeHtml}`,
        html: true,
      });
    } else if (row.kind === "stats") {
      const items = Array.isArray(row.items) ? row.items : [];
      if (items.length === 0) continue;
      const value = items
        .map(
          (stat) =>
            `<span class="meta_stat_item"><i data-icon="${escapeHtml(stat.icon)}"></i> <span>${escapeHtml(stat.value)}</span></span>`,
        )
        .join("");
      details.push({
        label: row.label,
        value,
        html: true,
      });
    } else if (row.value !== undefined && row.value !== "") {
      details.push({
        label: row.label,
        value: String(row.value),
        ...(row.stacked ? { stacked: true } : {}),
      });
    }
  }

  return details;
}
