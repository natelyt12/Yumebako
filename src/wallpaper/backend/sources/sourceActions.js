import { t } from "/src/core/i18n.js";
import {
  addToCollection,
  removeFromCollection,
  getCollection,
} from "/src/wallpaper/backend/sources/api/collectionDb.js";
import { trackDownloadOnce, withUnsplashUtm } from "./api/unsplashAPI.js";
import {
  generateImageThumbnail,
  generateVideoThumbnail,
} from "/src/wallpaper/backend/data/thumbnailGenerator.js";

/**
 * sourceActions.js
 * ---------------------------------------------------------------------------
 * Headless action descriptors and collection persistence helpers for Switcher cards.
 * Layer 3 never touches the DOM (`<a download>`, `window.open`), toast notifications
 * (`showNotification`), or Layer 1 UI controllers (`switcher.bar`).
 */

/**
 * Resolve a file extension from a Blob's MIME type.
 * @param {string} [mime=""]
 * @returns {string}
 */
function extensionFor(mime = "") {
  if (mime.includes("png")) return "png";
  if (mime.includes("webp")) return "webp";
  if (mime.includes("gif")) return "gif";
  if (mime.includes("mp4")) return "mp4";
  if (mime.includes("webm")) return "webm";
  return "jpg";
}

/**
 * Prepare a headless download descriptor (`{ ok, blob, filename }` or failure reason).
 * @param {Object} card
 * @param {{ source: Object }} context
 * @returns {Promise<{ ok: boolean, blob?: Blob, filename?: string, reason?: string }>}
 */
async function download(card, { source } = {}) {
  const blob = await source?.getBlob?.(card);
  if (!blob) {
    return { ok: false, reason: "no_blob" };
  }

  // Unsplash: a real file download is a "use" event. Safe no-op elsewhere.
  void trackDownloadOnce(card);

  return {
    ok: true,
    blob,
    filename: `wallpaper_${card.id}.${extensionFor(blob.type)}`,
  };
}

/**
 * Resolve the canonical external source page URL without opening a browser window.
 * @param {Object} card
 * @param {{ source: Object }} context
 * @returns {{ ok: boolean, url: string }}
 */
function viewSource(card, { source } = {}) {
  const rawUrl = source?.getSourceUrl?.(card) || card?.sourceUrl || "";
  if (!rawUrl) return { ok: false, url: "" };

  // Unsplash requires UTM parameters on links back to their site.
  const isUnsplash =
    source?.id === "unsplash" || card?.metadata?.provider === "unsplash";
  const url = isUnsplash ? withUnsplashUtm(rawUrl) : rawUrl;
  return { ok: Boolean(url), url };
}

/**
 * True when the card has an HTTP(S) canonical source page.
 * @param {Object} card
 * @returns {boolean}
 */
function hasSourcePage(card) {
  return /^https?:\/\//i.test(card?.sourceUrl || "");
}

/**
 * Find the matching collection entry for `card`, if any.
 * @param {Object} card
 * @param {Object|null} source
 * @param {Array<Object>} collection
 * @returns {Object|null}
 */
export function findCollectionEntry(card, source, collection) {
  if (!Array.isArray(collection) || collection.length === 0 || !card)
    return null;

  const sourceUrl = source?.getSourceUrl
    ? source.getSourceUrl(card)
    : card.sourceUrl || "";
  const cardUrl = card.url || "";
  const cardId =
    card.id !== undefined && card.id !== null ? String(card.id) : "";

  return (
    collection.find((entry) => {
      if (!entry) return false;
      const meta = entry.metadata || {};
      const entrySource = meta.source || "";
      const entryUrl = meta.url || "";
      const entryId = String(meta.id || entry.id || meta.wallpaperId || "");

      if (sourceUrl && (entrySource === sourceUrl || entryUrl === sourceUrl))
        return true;
      if (cardUrl && (entryUrl === cardUrl || entrySource === cardUrl))
        return true;
      if (
        cardId &&
        (entryId === cardId ||
          String(entry.id ?? "") === cardId ||
          String(meta.id ?? "") === cardId ||
          String(meta.wallpaperId ?? "") === cardId)
      )
        return true;

      return false;
    }) || null
  );
}

/**
 * Check whether `card` already exists in `collection`.
 * @param {Object} card
 * @param {Object|null} source
 * @param {Array<Object>} collection
 * @returns {boolean}
 */
export function isCardInCollection(card, source, collection) {
  return Boolean(findCollectionEntry(card, source, collection));
}

/**
 * Copy one card's media into the personal collection.
 * @param {Object} card
 * @param {Object} source
 * @returns {Promise<boolean>} true when the card was stored.
 */
async function addCardToCollection(card, source) {
  const blob = await source.getBlob(card);
  if (!blob) return false;

  const sourceUrl = source.getSourceUrl(card);
  const isVideo = blob.type.startsWith("video/");
  const thumbnail = isVideo
    ? await generateVideoThumbnail(blob)
    : await generateImageThumbnail(blob);

  // Unsplash: saving the photo locally is also a "use".
  void trackDownloadOnce(card);

  await addToCollection({
    type: isVideo ? "video" : "image",
    blob,
    thumbnail,
    metadata: {
      id: card.id,
      provider: source.id,
      providerName: source.name,
      source: sourceUrl || card.url || source.id,
      url: card.url || "",
      width: card.width,
      height: card.height,
      size: blob.size,
      title: card.title || "",
      category: card.category || "",
      query: card.query !== undefined ? card.query : card.raw?.query || "",
      raw: card.raw || null,
      copyright: card.copyright || "",
      startDate: card.startDate || "",
      user: card.user || null,
      downloadTracked: card.downloadTracked === true,
    },
  });

  return true;
}

/**
 * Headless toggle: add or remove `card` from the personal collection.
 * @param {Object} card
 * @param {Object} [context]
 * @returns {Promise<{ ok: boolean, action: "added"|"removed"|"cancelled"|"add", id?: string, reason?: string }>}
 */
async function toggleCollection(card, context = {}) {
  const { source, dataControl } = context;
  const collection = await getCollection();
  const existing = findCollectionEntry(card, source, collection);

  if (existing) {
    if (typeof context.confirmRemove === "function") {
      const confirmed = await context.confirmRemove(card, existing);
      if (!confirmed) return { ok: false, action: "cancelled" };
    }
    await removeFromCollection(existing.id);
    dataControl?.emit?.("collection:updated", {
      action: "removed",
      id: existing.id,
      card,
    });
    return { ok: true, action: "removed", id: existing.id };
  }

  const added = await addCardToCollection(card, source);
  if (!added) {
    return { ok: false, action: "add", reason: "no_blob" };
  }

  dataControl?.emit?.("collection:updated", {
    action: "added",
    card,
  });
  return { ok: true, action: "added" };
}

/**
 * Shared batch-add helper returning structured counts (`addedCount`, `skippedCount`, `failedCount`).
 * Deduplicates both against the existing collection and within the input `cards` batch.
 *
 * @param {Array<Object>} cards
 * @param {Object} source
 * @returns {Promise<{ addedCount: number, skippedCount: number, failedCount: number }>}
 */
export async function addCardsBatchToCollection(cards, source) {
  if (!Array.isArray(cards) || cards.length === 0 || !source) {
    return { addedCount: 0, skippedCount: 0, failedCount: 0 };
  }

  let collection = [];
  try {
    collection = await getCollection();
  } catch (err) {
    console.error("[sourceActions] Failed to read collection:", err);
  }

  const localCollection = Array.isArray(collection) ? [...collection] : [];
  const seenBatchKeys = new Set();
  let addedCount = 0;
  let skippedCount = 0;
  let failedCount = 0;

  for (const card of cards) {
    if (!card) {
      skippedCount++;
      continue;
    }

    const batchKeys = [];
    if (card.id !== undefined && card.id !== null && card.id !== "") {
      batchKeys.push(`id:${card.id}`);
    }
    const rawSourceUrl = source?.getSourceUrl
      ? source.getSourceUrl(card)
      : card.sourceUrl || "";
    const normalizedSourceUrl =
      typeof rawSourceUrl === "string" ? rawSourceUrl.trim() : "";
    const normalizedCardUrl =
      typeof card.url === "string" ? card.url.trim() : "";

    if (normalizedSourceUrl) {
      batchKeys.push(`url:${normalizedSourceUrl}`);
    }
    if (normalizedCardUrl && normalizedCardUrl !== normalizedSourceUrl) {
      batchKeys.push(`url:${normalizedCardUrl}`);
    }

    if (
      batchKeys.some((key) => seenBatchKeys.has(key)) ||
      isCardInCollection(card, source, localCollection)
    ) {
      skippedCount++;
      continue;
    }
    batchKeys.forEach((key) => seenBatchKeys.add(key));

    try {
      const stored = await addCardToCollection(card, source);
      if (stored) {
        addedCount++;
        localCollection.push({
          id: card.id,
          metadata: {
            id: card.id,
            source: normalizedSourceUrl || normalizedCardUrl || source.id,
            url: normalizedCardUrl,
          },
        });
      } else {
        failedCount++;
      }
    } catch (err) {
      failedCount++;
      console.error("[sourceActions] Failed to add card to collection:", err);
    }
  }

  return { addedCount, skippedCount, failedCount };
}

/**
 * Headless carousel removal descriptor runner (delegates to DataControl if provided).
 * @param {Object} _card
 * @param {Object} [context]
 * @returns {Promise<boolean>}
 */
async function removeFromCarousel(_card, context = {}) {
  if (typeof context?.dataControl?.deleteCard === "function") {
    return context.dataControl.deleteCard();
  }
  return false;
}

/**
 * Headless collection deletion descriptor runner (delegates to DataControl if provided).
 * @param {Object} _card
 * @param {Object} [context]
 * @returns {Promise<boolean>}
 */
async function remove(_card, context = {}) {
  if (typeof context?.dataControl?.deleteCard === "function") {
    return context.dataControl.deleteCard();
  }
  return false;
}

/**
 * Guard preventing deletion while a card is still pending apply settlement.
 * @param {Object} card
 * @returns {true|{ disabled: true, reason: string }}
 */
function isSettled(card) {
  if (!card?.pending) return true;
  return {
    disabled: true,
    reason: t("wallpaper_switcher.wait_for_wallpaper", "Đang tải hình nền…"),
  };
}

export const SOURCE_ACTIONS = {
  download: {
    id: "download",
    icon: "collectionDownload",
    labelKey: "sp.api.common.downloadWallpaper",
    fallback: "Tải hình nền",
    run: download,
  },
  source: {
    id: "source",
    icon: "collectionSource",
    labelKey: "sp.api.common.viewSource",
    fallback: "Xem nguồn ảnh",
    isAvailable: hasSourcePage,
    run: viewSource,
  },
  removeFromCarousel: {
    id: "removeFromCarousel",
    icon: "close",
    labelKey: "wallpaper_switcher.remove_from_carousel",
    fallback: "Bỏ khỏi danh sách",
    isAvailable: isSettled,
    run: removeFromCarousel,
  },
  add: {
    id: "add",
    icon: "star",
    labelKey: "sp.api.collection.add_to_collection",
    fallback: "Thêm vào bộ sưu tập",
    async resolveState(card, { source }) {
      const collection = await getCollection();
      const inCollection = isCardInCollection(card, source, collection);
      if (inCollection) {
        return {
          icon: "starFill",
          labelKey: "sp.api.collection.remove_from_collection",
          fallback: "Bỏ khỏi bộ sưu tập",
        };
      }
      return {
        icon: "star",
        labelKey: "sp.api.collection.add_to_collection",
        fallback: "Thêm vào bộ sưu tập",
      };
    },
    run: toggleCollection,
  },
  remove: {
    id: "remove",
    icon: "collectionRemove",
    labelKey: "sp.api.collection.delete_btn",
    fallback: "Xóa",
    isAvailable: isSettled,
    run: remove,
    danger: true,
  },
};
