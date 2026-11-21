/**
 * cardUtils.js
 * ---------------------------------------------------------------------------
 * Cycle-free card list utilities shared across Layer 2 (DataControl) and
 * Layer 3 (Source Adapters).
 */

/**
 * Deduplicate card items by `id`, keeping the first occurrence.
 * Cards without an `id` are preserved as-is.
 *
 * @template {Record<string, any>} T
 * @param {T[]} cards
 * @returns {T[]}
 */
export function uniqueCards(cards) {
  if (!Array.isArray(cards)) return [];

  const seen = new Set();
  const unique = [];
  for (const card of cards) {
    if (!card) continue;
    const id = card.id;
    if (id !== undefined && id !== null && id !== "") {
      const key = String(id);
      if (seen.has(key)) continue;
      seen.add(key);
    }
    unique.push(card);
  }
  return unique;
}

/**
 * Strip transient `blob:` Object URLs and `Blob` instances from a card item
 * before persisting it to IndexedDB (`appData`).
 * Node-safe: checks `typeof Blob !== "undefined"`.
 *
 * @template {Record<string, any>} T
 * @param {T} card
 * @returns {T}
 */
export function stripCardBlobs(card) {
  if (!card || typeof card !== "object") return card;

  const hasBlobCtor = typeof Blob !== "undefined";
  const item = { ...card };

  if (
    typeof item.thumbnailUrl === "string" &&
    item.thumbnailUrl.startsWith("blob:")
  ) {
    item.thumbnailUrl = null;
  }

  for (const [key, val] of Object.entries(item)) {
    if (hasBlobCtor && val instanceof Blob) {
      delete item[key];
    }
  }

  if (item.raw && typeof item.raw === "object") {
    const cleanRaw = { ...item.raw };
    delete cleanRaw.thumbnail;
    delete cleanRaw.blob;
    if (hasBlobCtor) {
      for (const [key, val] of Object.entries(cleanRaw)) {
        if (val instanceof Blob) {
          delete cleanRaw[key];
        }
      }
    }
    item.raw = cleanRaw;
  }

  return item;
}
