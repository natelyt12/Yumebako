import { t } from "/src/core/i18n.js";
import { showConfirm, showNotification } from "/src/core/ui.js";
import { addToCollection, getCollection, removeFromCollection } from "/src/wallpaper/sources/api/collectionDb.js";
import { generateImageThumbnail, generateVideoThumbnail } from "/src/core/utils/thumbnailGenerator.js";
import { isMoreItem } from "../stores/carouselSchema.js";

/**
 * sourceActions.js
 * ---------------------------------------------------------------------------
 * The action verbs the Switcher's bottom button row can offer. Each source
 * picks the subset that makes sense for its items via `BaseSource.actions`.
 *
 * An action receives `(card, context)` — the context carries the source that
 * owns the card, the store holding its window, and the switcher itself.
 * An action that changes the list animates that change on its own, through
 * `switcher.removeCardAnimated` + `store.remove` / `store.refresh`: the store is
 * the single source of truth and the view follows it, so nothing has to be
 * redrawn behind the action's back.
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
        showNotification(t("sp.api.collection.download_error", "Không tìm thấy dữ liệu ảnh để tải"), "error");
        return false;
    }

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `wallpaper_${card.id}.${extensionFor(blob.type)}`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Open the card's original page in a new tab. */
function viewSource(card, { source }) {
    const url = source.getSourceUrl(card);
    window.open(url, "_blank");
}

/** Only a card that came from a page has one to show: local files do not. */
function hasSourcePage(card) {
    return /^https?:\/\//i.test(card?.sourceUrl || "");
}

/** Copy the card's media into the personal collection. */
async function add(card, { source }) {
    const blob = await source.getBlob(card);
    if (!blob) {
        showNotification(t("sp.api.collection.no_blob_to_add", "Không có dữ liệu ảnh để thêm vào bộ sưu tập"), "warning");
        return;
    }

    const sourceUrl = source.getSourceUrl(card);
    const collection = await getCollection();
    if (sourceUrl && collection.some((entry) => entry.metadata?.source === sourceUrl)) {
        showNotification(t("sp.api.collection.already_saved", "Ảnh này đã có trong bộ sưu tập"), "info");
        return;
    }

    const isVideo = blob.type.startsWith("video/");
    const thumbnail = isVideo ? await generateVideoThumbnail(blob) : await generateImageThumbnail(blob);

    await addToCollection({
        type: isVideo ? "video" : "image",
        blob,
        thumbnail,
        metadata: {
            provider: source.id,
            providerName: source.name,
            source: sourceUrl || source.id,
            url: card.url || "",
            width: card.width,
            height: card.height,
            size: blob.size,
        },
    });

    showNotification(t("sp.api.collection.add_success", "Đã thêm vào bộ sưu tập thành công!"), "success");
}

/**
 * Find the card to fall back to when the current one is removed: the previous
 * card, falling back to the next one.
 *
 * The previous card is preferred because of where it leaves the space. This way
 * the card that leaves always sits at or after the new selection, so the row only
 * ever closes up beside and behind the centered card — nothing shifts underneath
 * it, and the axis has nothing to travel for. Deleting the first card is the one
 * case with no previous card, and there the track compensates.
 *
 * @param {Object} card - The card being removed.
 * @param {{ store: Object }} context
 * @returns {Object|null} The neighbour, when there was one.
 */
function findNeighbour(card, { store }) {
    const items = store.items;
    const at = items.findIndex((entry) => entry.id === card.id);
    if (at === -1) return null;

    const left = items[at - 1];
    if (left && !isMoreItem(left)) return left;

    const right = items[at + 1];
    if (right && !isMoreItem(right)) return right;

    return null;
}

/**
 * Drop the card from the carousel window. Non-destructive: nothing is removed
 * from the collection, nor from the provider's stored queue — the wallpaper
 * simply stops being offered while browsing.
 */
async function removeFromCarousel(card, context) {
    const { store, switcher } = context;
    const neighbour = findNeighbour(card, context);

    await switcher.removeCardAnimated(card, neighbour);
    await store.remove(card.id, { focusId: neighbour?.id });
    switcher.syncCarousel(store);
}

/**
 * Delete the card's media from the personal collection.
 */
async function remove(card, context) {
    const { store, switcher } = context;
    const confirmed = await showConfirm(t("sp.api.collection.delete_msg", "Bạn có chắc chắn muốn xóa hình nền này khỏi bộ sưu tập?"), {
        title: t("sp.api.collection.delete_title", "Xác nhận xóa"),
        okText: t("sp.api.collection.delete_btn", "Xóa"),
        isDanger: true,
    });
    if (!confirmed) return;

    const neighbour = findNeighbour(card, context);

    // Redrawing the window on the event would re-center it on a slot that is
    // about to shift.
    store.isMutating = true;
    try {
        await switcher.removeCardAnimated(card, neighbour);
        await removeFromCollection(card.id);
        await store.refresh({ focusId: neighbour?.id });
        switcher.syncCarousel(store);
    } finally {
        store.isMutating = false;
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
    return { disabled: true, reason: t("wallpaper_switcher.wait_for_wallpaper", "Đang tải hình nền…") };
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
        icon: "addToCollection",
        labelKey: "sp.api.collection.add_to_collection",
        fallback: "Thêm vào bộ sưu tập",
        /**
         * An image that is already in the collection has nothing to add, so the
         * button stays in place but disabled — the state reads as "nothing to do
         * here" rather than as a button that vanished.
         * @returns {Promise<boolean|{ disabled: true, reason: string }>}
         */
        async isAvailable(card, { source }) {
            const url = source.getSourceUrl(card);
            if (!url) return true;

            const collection = await getCollection();
            return collection.some((entry) => entry.metadata?.source === url)
                ? { disabled: true, reason: t("sp.api.collection.already_saved", "Ảnh này đã có trong bộ sưu tập") }
                : true;
        },
        run: add,
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
