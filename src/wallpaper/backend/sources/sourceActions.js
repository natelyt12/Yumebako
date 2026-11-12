import { t } from "/src/core/i18n.js";
import { showNotification } from "/src/core/ui.js";
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
 * The action verbs the Switcher's bottom button row can offer. Each source
 * picks the subset that makes sense for its items via `BaseSource.actions`.
 * Actions receive `(card, context)` and are executed via SwitcherBar & DataControl.
 */

/** File extension matching a blob's mime type. */
function extensionFor(mime = "") {
  if (mime.includes("png")) return "png";
  if (mime.includes("webp")) return "webp";
  if (mime.includes("gif")) return "gif";
  if (mime.includes("mp4")) return "mp4";
  if (mime.includes("webm")) return "webm";
  return "jpg";
}

/** Save the card's media to disk. */
async function download(card, { source }) {
  const blob = await source.getBlob(card);
  if (!blob) {
    showNotification(
      t(
        "sp.api.collection.download_error",
        "Không tìm thấy dữ liệu ảnh để tải",
      ),
      "error",
    );
    return false;
  }

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `wallpaper_${card.id}.${extensionFor(blob.type)}`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);

  // Unsplash: a real file download is a "use" event. Safe no-op elsewhere.
  void trackDownloadOnce(card);
}

/** Open the card's original page in a new tab. */
function viewSource(card, { source }) {
  const url = source.getSourceUrl(card);
  // Unsplash requires UTM on links back to their site.
  const isUnsplash =
    source?.id === "unsplash" || card?.metadata?.provider === "unsplash";
  window.open(isUnsplash ? withUnsplashUtm(url) : url, "_blank");
}

/** Only a card that came from a page has one to show: local files do not. */
function hasSourcePage(card) {
  return /^https?:\/\//i.test(card?.sourceUrl || "");
}

/** Tìm bản ghi tương ứng trong bộ sưu tập (nếu có). */
export function findCollectionEntry(card, source, collection) {
  if (!Array.isArray(collection) || collection.length === 0 || !card)
    return null;

  const sourceUrl = source?.getSourceUrl
    ? source.getSourceUrl(card)
    : card.sourceUrl || "";
  const cardUrl = card.url || "";
  const cardId = String(card.id || "");

  return (
    collection.find((entry) => {
      const meta = entry.metadata || {};
      const entrySource = meta.source || "";
      const entryUrl = meta.url || "";
      const entryId = String(meta.id || entry.id || meta.wallpaperId || "");

      if (sourceUrl && (entrySource === sourceUrl || entryUrl === sourceUrl))
        return true;
      if (cardUrl && (entryUrl === cardUrl || entrySource === cardUrl))
        return true;
      if (cardId && (entryId === cardId || meta.id === cardId)) return true;

      return false;
    }) || null
  );
}

/** Kiểm tra xem một thẻ đã tồn tại trong bộ sưu tập chưa. */
export function isCardInCollection(card, source, collection) {
  return Boolean(findCollectionEntry(card, source, collection));
}

/**
 * Copy one card's media into the personal collection.
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

  // Unsplash: saving the photo locally is also a "use". `trackDownloadOnce`
  // sets the flag synchronously so the metadata below records it and a later
  // download from the collection will not re-send the tracking request.
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

/** Toggle thêm hoặc xóa ảnh khỏi bộ sưu tập cá nhân. */
async function toggleCollection(card, context) {
  const { source } = context;
  const collection = await getCollection();
  const existing = findCollectionEntry(card, source, collection);

  if (existing) {
    // Dropping the saved copy also drops its customizations, so it goes
    // through the same warning the Collection delete action shows. The guard
    // lives in the UI layer; without it (headless calls) we remove directly.
    if (typeof context.confirmRemove === "function") {
      const confirmed = await context.confirmRemove(card, existing);
      if (!confirmed) return;
    }
    await removeFromCollection(existing.id);
    showNotification(
      t("sp.api.collection.remove_success", "Đã xóa khỏi bộ sưu tập"),
      "info",
    );
    return;
  }

  const added = await addCardToCollection(card, source);
  if (!added) {
    showNotification(
      t(
        "sp.api.collection.no_blob_to_add",
        "Không có dữ liệu ảnh để thêm vào bộ sưu tập",
      ),
      "warning",
    );
    return;
  }

  showNotification(
    t("sp.api.collection.add_success", "Đã thêm vào bộ sưu tập thành công!"),
    "success",
  );
}

/**
 * Bulk add: copy every card that is not already in the collection yet.
 * Used by the manage view's multi-select mode (history / infinite sources).
 * @param {Array<Object>} cards
 * @param {Object} source
 * @returns {Promise<number>} how many cards were added
 */
export async function addCardsToCollection(cards, source) {
  if (!Array.isArray(cards) || cards.length === 0) return 0;

  let collection = [];
  try {
    collection = await getCollection();
  } catch (err) {
    console.error("[sourceActions] Failed to read collection:", err);
  }

  let added = 0;
  for (const card of cards) {
    if (!card || isCardInCollection(card, source, collection)) continue;
    try {
      if (await addCardToCollection(card, source)) added++;
    } catch (err) {
      console.error("[sourceActions] Failed to add card to collection:", err);
    }
  }
  return added;
}

/**
 * Drop the card from the carousel window.
 */
async function removeFromCarousel(card, context) {
  if (context?.switcher?.bar) {
    await context.switcher.bar._handleDeleteCard(card, false);
  } else if (context?.dataControl) {
    await context.dataControl.deleteCard();
  }
}

/**
 * Delete the card's media from the personal collection.
 */
async function remove(card, context) {
  if (context?.switcher?.bar) {
    await context.switcher.bar._handleDeleteCard(card, true);
  } else if (context?.dataControl) {
    await context.dataControl.deleteCard();
  }
}

/**
 * A wallpaper that has not landed yet must not be removed.
 *
 * The apply that is on its way finishes by writing the card's id back into the
 * store as the applied wallpaper. If the card has been removed by then, that id
 * points at nothing: the media of the wallpaper on the desktop gets freed, and
 * the store believes it is showing something it no longer holds. Both remove
 * verbs therefore wait for the swap to be over.
 *
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
