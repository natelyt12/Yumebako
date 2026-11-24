/**
 * Local-only autocomplete provider querying Chrome bookmarks and history.
 * Never sends search queries to external autocomplete endpoints.
 */

// Số lượng gợi ý autocomplete tối đa hiển thị trong dropdown
const DEFAULT_LIMIT = 6;

/**
 * Build a local Chrome MV3 favicon URL for a suggestion, or null outside extension runtime.
 * @param {string} pageUrl
 * @param {number} [size=32]
 * @returns {string|null}
 */
export function getFaviconUrl(pageUrl, size = 32) {
  if (
    !pageUrl ||
    typeof chrome === "undefined" ||
    !chrome?.runtime?.id ||
    typeof chrome?.runtime?.getURL !== "function"
  ) {
    return null;
  }
  const url = new URL(chrome.runtime.getURL("/_favicon/"));
  url.searchParams.set("pageUrl", pageUrl);
  url.searchParams.set("size", String(size));
  return url.toString();
}

/**
 * Strip protocol and trailing slash for compact suggestion display.
 * @param {string} rawUrl
 * @returns {string}
 */
export function formatDisplayUrl(rawUrl) {
  if (typeof rawUrl !== "string") return "";
  return rawUrl.replace(/^https?:\/\//i, "").replace(/\/+$/, "");
}

function normalizeDedupKey(rawUrl) {
  return String(rawUrl || "").trim().replace(/\/+$/, "").toLowerCase();
}

function isHttpUrl(rawUrl) {
  return typeof rawUrl === "string" && /^https?:\/\//i.test(rawUrl.trim());
}

function scoreMatch(item, lowerQuery) {
  const title = (item.title || "").toLowerCase();
  const display = (item.displayUrl || "").toLowerCase();
  let score = item.source === "bookmark" ? 30 : 0;

  if (title.startsWith(lowerQuery)) score += 60;
  else if (title.includes(` ${lowerQuery}`)) score += 45;
  else if (title.includes(lowerQuery)) score += 25;

  if (display.startsWith(lowerQuery)) score += 50;
  else if (display.includes(lowerQuery)) score += 20;

  if (typeof item.visitCount === "number" && item.visitCount > 0) {
    score += Math.min(20, Math.log2(item.visitCount + 1) * 4);
  }
  return score;
}

async function queryBookmarks(query, maxResults) {
  if (typeof chrome === "undefined" || typeof chrome?.bookmarks?.search !== "function") {
    return [];
  }
  try {
    const items = await chrome.bookmarks.search(query);
    if (!Array.isArray(items)) return [];
    const results = [];
    for (const entry of items) {
      if (!isHttpUrl(entry?.url)) continue;
      results.push({
        id: `bm:${entry.id || entry.url}`,
        title: (entry.title || "").trim() || formatDisplayUrl(entry.url),
        url: entry.url,
        displayUrl: formatDisplayUrl(entry.url),
        source: "bookmark",
        visitCount: 0,
        lastVisitTime: entry.dateAdded || 0,
      });
      if (results.length >= maxResults * 2) break;
    }
    return results;
  } catch {
    return [];
  }
}

async function queryHistory(query, maxResults) {
  if (typeof chrome === "undefined" || typeof chrome?.history?.search !== "function") {
    return [];
  }
  try {
    const items = await chrome.history.search({
      text: query,
      startTime: 0,
      maxResults: maxResults * 2,
    });
    if (!Array.isArray(items)) return [];
    return items
      .filter((entry) => isHttpUrl(entry?.url))
      .map((entry) => ({
        id: `hs:${entry.id || entry.url}`,
        title: (entry.title || "").trim() || formatDisplayUrl(entry.url),
        url: entry.url,
        displayUrl: formatDisplayUrl(entry.url),
        source: "history",
        visitCount: entry.visitCount || 0,
        lastVisitTime: entry.lastVisitTime || 0,
      }));
  } catch {
    return [];
  }
}

/**
 * Fetch and rank local autocomplete suggestions from bookmarks and/or history.
 *
 * @param {string} query
 * @param {Object} [options]
 * @param {boolean} [options.bookmarks=false]
 * @param {boolean} [options.history=false]
 * @param {number} [options.limit=7]
 * @returns {Promise<Array<{ id: string, title: string, url: string, displayUrl: string, source: "bookmark"|"history" }>>}
 */
export async function fetchAutocompleteSuggestions(query, options = {}) {
  const { bookmarks = false, history = false, limit = DEFAULT_LIMIT } = options;
  const trimmed = typeof query === "string" ? query.trim() : "";
  if (!trimmed || (!bookmarks && !history)) {
    return [];
  }

  const [bookmarkItems, historyItems] = await Promise.all([
    bookmarks ? queryBookmarks(trimmed, limit) : Promise.resolve([]),
    history ? queryHistory(trimmed, limit) : Promise.resolve([]),
  ]);

  const byUrl = new Map();
  for (const item of [...bookmarkItems, ...historyItems]) {
    const key = normalizeDedupKey(item.url);
    if (!key) continue;
    const existing = byUrl.get(key);
    if (!existing) {
      byUrl.set(key, item);
    } else if (existing.source !== "bookmark" && item.source === "bookmark") {
      // Preserve visit metadata while prioritizing bookmark badge
      byUrl.set(key, {
        ...item,
        visitCount: existing.visitCount,
        lastVisitTime: existing.lastVisitTime,
      });
    }
  }

  const lowerQuery = trimmed.toLowerCase();
  return Array.from(byUrl.values())
    .sort((a, b) => {
      const diff = scoreMatch(b, lowerQuery) - scoreMatch(a, lowerQuery);
      if (diff !== 0) return diff;
      return (b.lastVisitTime || 0) - (a.lastVisitTime || 0);
    })
    .slice(0, limit)
    .map(({ id, title, url, displayUrl, source }) => ({
      id,
      title,
      url,
      displayUrl,
      source,
    }));
}
