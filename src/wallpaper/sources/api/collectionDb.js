import { generateImageThumbnail, generateVideoThumbnail } from "/src/core/utils/thumbnailGenerator.js";
import { getFromStore, saveToStore } from "/src/core/db.js";

const COLLECTION_KEY = "data:collection";

/**
 * Load the full collection array from IndexedDB.
 * @returns {Promise<Array>}
 */
export async function getCollection() {
    const data = await getFromStore(COLLECTION_KEY);
    return Array.isArray(data) ? data : [];
}

/**
 * Load a single collection item by id.
 * @param {string} id
 * @returns {Promise<Object|null>} The record, or null when it is gone.
 */
export async function getCollectionItem(id) {
    const collection = await getCollection();
    return collection.find((item) => String(item.id) === String(id)) || null;
}

/**
 * Add a new item to the collection.
 * @param {{ type: string, blob: Blob, thumbnail?: Blob|null, metadata?: Object }} item
 * @returns {Promise<Object>} The saved item (with generated id).
 */
export async function addToCollection(item) {
    const collection = await getCollection();
    const newItem = {
        id: String(Date.now()) + "_" + Math.random().toString(36).slice(2, 7),
        type: item.type || "unknown",
        blob: item.blob,
        thumbnail: item.thumbnail || null,
        metadata: item.metadata || {},
    };
    collection.push(newItem);
    await saveToStore(COLLECTION_KEY, collection);
    window.dispatchEvent(new CustomEvent("wallpaper-collection-updated", { detail: { collection } }));
    return newItem;
}

/**
 * Remove an item from the collection by its id.
 * @param {string} id
 * @returns {Promise<Array>} Remaining items.
 */
export async function removeFromCollection(id) {
    const collection = await getCollection();
    const remaining = collection.filter((item) => item.id !== id);
    await saveToStore(COLLECTION_KEY, remaining);
    window.dispatchEvent(new CustomEvent("wallpaper-collection-updated", { detail: { collection: remaining } }));
    return remaining;
}

/**
 * Remove multiple items from the collection by their ids.
 * @param {Array<string>} ids
 * @returns {Promise<Array>} Remaining items.
 */
export async function removeMultipleFromCollection(ids) {
    const collection = await getCollection();
    const remaining = collection.filter((item) => !ids.includes(item.id));
    await saveToStore(COLLECTION_KEY, remaining);
    window.dispatchEvent(new CustomEvent("wallpaper-collection-updated", { detail: { collection: remaining } }));
    return remaining;
}

/**
 * Recovers missing blobs from collection items after importing from backup.
 * It will attempt to redownload the images using metadata.url.
 */
export async function recoverCollectionBlobs() {
    const collection = await getCollection();
    let updated = false;

    for (let i = 0; i < collection.length; i++) {
        let item = collection[i];
        if (!item.blob) {
            try {
                let downloadUrl = item.metadata?.url;

                if (downloadUrl) {
                    const res = await fetch(downloadUrl);
                    if (res.ok) {
                        item.blob = await res.blob();
                        
                        // Dynamically import thumbnail generator to avoid circular dependencies

                        const isVideo = item.blob.type.startsWith("video/");
                        item.thumbnail = isVideo ? await generateVideoThumbnail(item.blob) : await generateImageThumbnail(item.blob);
                        
                        updated = true;
                        console.log(`[Collection] Recovered blob for item ${item.id}`);
                    }
                }
            } catch (err) {
                console.error(`[Collection] Failed to recover blob for item ${item.id}:`, err);
            }
        }
    }

    if (updated) {
        await saveToStore(COLLECTION_KEY, collection);
        window.dispatchEvent(new CustomEvent("wallpaper-collection-updated", { detail: { collection } }));
    }
}
