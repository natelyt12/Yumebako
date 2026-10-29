import { getDefaultWallpaperEffects } from "/src/core/storageHandler.js";
import {
  generateImageThumbnail,
  generateVideoThumbnail,
} from "/src/core/utils/thumbnailGenerator.js";
import {
  getFromStore,
  saveToStore,
  saveManyToStore,
  removeManyFromStore,
} from "/src/core/db.js";

/**
 * collectionDb.js
 * ---------------------------------------------------------------------------
 * Storage for the personal wallpaper collection, split across two stores so the
 * list stays cheap to read:
 *
 *   appData   / "data:collection"  → [{ id, type, thumbnail, metadata, effects }]
 *   mediaData / "media:orig:<id>"  → the full-size Blob of one wallpaper
 *
 * Why: the collection used to be one single record holding every full-size
 * blob, so every operation (list, read one, add, delete) cost O(total media
 * size) — applying a wallpaper re-read and re-cloned the whole collection, which
 * showed up as ~1 s of extra startup time. With media keyed per id the list is a
 * few KB, reading one wallpaper touches one blob, and a write only touches the
 * files it changes. `mediaGC` already sweeps `media:orig:<id>` keys against the
 * live ids found in `data:collection`.
 *
 * Thumbnails stay inside the list entry on purpose: they are small, and keeping
 * them there lets the carousel draw every card without extra reads.
 */

const COLLECTION_KEY = "data:collection";
const MEDIA_STORE = "mediaData";

/** Key of one wallpaper's full-size Blob inside `mediaData`. */
export function mediaKey(id) {
  return `media:orig:${id}`;
}

/** A fresh, sortable id for a new collection entry. */
function createId(offset = 0) {
  return (
    String(Date.now() + offset) + "_" + Math.random().toString(36).slice(2, 7)
  );
}

/**
 * Build the metadata-only entry that lives in `data:collection`.
 * Everything heavy (`blob`) is stripped here, in one place.
 */
function toEntry(record, id) {
  return {
    id,
    type: record?.type || "unknown",
    thumbnail: record?.thumbnail instanceof Blob ? record.thumbnail : null,
    metadata: record?.metadata || {},
    effects: record?.effects
      ? JSON.parse(JSON.stringify(record.effects))
      : getDefaultWallpaperEffects(),
  };
}

/**
 * Persist the list and announce it. Every writer funnels through here so the
 * `wallpaper-collection-updated` contract (fresh array, no extra reads needed)
 * stays true for in-memory consumers.
 */
async function writeCollection(collection) {
  await saveToStore(COLLECTION_KEY, collection);
  window.dispatchEvent(
    new CustomEvent("wallpaper-collection-updated", {
      detail: { collection },
    }),
  );
  return collection;
}

/**
 * Load the collection list (metadata + thumbnails, never the full-size media).
 * @returns {Promise<Array>}
 */
export async function getCollection() {
  const data = await getFromStore(COLLECTION_KEY);
  return Array.isArray(data) ? data : [];
}

/**
 * Load the full-size media Blob of one collection entry.
 * @param {string} id
 * @returns {Promise<Blob|null>}
 */
export async function getCollectionBlob(id) {
  if (id === undefined || id === null) return null;
  const blob = await getFromStore(mediaKey(id), MEDIA_STORE);
  return blob instanceof Blob ? blob : null;
}

/**
 * Load one entry, list fields and media together.
 * @param {string} id
 * @returns {Promise<Object|null>} The record, or null when it is gone.
 */
export async function getCollectionItem(id) {
  if (id === undefined || id === null) return null;
  const collection = await getCollection();
  const entry = collection.find((item) => String(item.id) === String(id));
  if (!entry) return null;

  return { ...entry, blob: await getCollectionBlob(entry.id) };
}

/**
 * Add a new item to the collection.
 * @param {{ type: string, blob: Blob, thumbnail?: Blob|null, metadata?: Object }} item
 * @returns {Promise<Object>} The saved item (with generated id and its blob).
 */
export async function addToCollection(item) {
  const id = createId();
  const entry = toEntry(item, id);

  if (item?.blob instanceof Blob) {
    await saveManyToStore(
      [{ key: mediaKey(id), value: item.blob }],
      MEDIA_STORE,
    );
  }

  const collection = await getCollection();
  collection.push(entry);
  await writeCollection(collection);

  return { ...entry, blob: item?.blob instanceof Blob ? item.blob : null };
}

/**
 * Add multiple items to the collection in one pass: one transaction for all
 * media blobs, one write for the list.
 * @param {Array<{ type: string, blob: Blob, thumbnail?: Blob|null, metadata?: Object }>} items
 * @returns {Promise<Array<Object>>} The saved items.
 */
export async function addBatchToCollection(items) {
  if (!Array.isArray(items) || items.length === 0) return [];

  const entries = [];
  const media = [];

  items.forEach((item, index) => {
    const id = createId(index);
    entries.push(toEntry(item, id));
    if (item?.blob instanceof Blob) {
      media.push({ key: mediaKey(id), value: item.blob });
    }
  });

  await saveManyToStore(media, MEDIA_STORE);

  const collection = await getCollection();
  collection.push(...entries);
  await writeCollection(collection);

  return entries.map((entry, index) => ({
    ...entry,
    blob: items[index]?.blob instanceof Blob ? items[index].blob : null,
  }));
}

/**
 * Remove an item from the collection by its id, media included.
 * @param {string} id
 * @returns {Promise<Array>} Remaining items.
 */
export async function removeFromCollection(id) {
  return removeMultipleFromCollection([id]);
}

/**
 * Remove multiple items from the collection by their ids, media included.
 * @param {Array<string>} ids
 * @returns {Promise<Array>} Remaining items.
 */
export async function removeMultipleFromCollection(ids) {
  const targets = (Array.isArray(ids) ? ids : []).filter(
    (id) => id !== undefined && id !== null,
  );
  if (targets.length === 0) return getCollection();

  const targetIds = new Set(targets.map((id) => String(id)));
  const collection = await getCollection();
  const remaining = collection.filter(
    (item) => !targetIds.has(String(item.id)),
  );

  await removeManyFromStore(
    targets.map((id) => mediaKey(id)),
    MEDIA_STORE,
  );

  return writeCollection(remaining);
}

/**
 * Recovers missing media for collection entries after importing a backup: the
 * imported list carries metadata but the blob files did not come along, so they
 * are downloaded again from `metadata.url` and stored under `media:orig:<id>`.
 */
export async function recoverCollectionBlobs() {
  const collection = await getCollection();
  let updated = false;

  for (const entry of collection) {
    const existing = await getCollectionBlob(entry.id);
    if (existing) continue;

    try {
      const downloadUrl = entry.metadata?.url;
      if (!downloadUrl) continue;

      const res = await fetch(downloadUrl);
      if (!res.ok) continue;

      const blob = await res.blob();
      const isVideo = blob.type.startsWith("video/");
      const thumbnail = isVideo
        ? await generateVideoThumbnail(blob)
        : await generateImageThumbnail(blob);

      await saveToStore(mediaKey(entry.id), blob, MEDIA_STORE);
      entry.thumbnail = thumbnail;
      updated = true;
      console.log(`[Collection] Recovered blob for item ${entry.id}`);
    } catch (err) {
      console.error(
        `[Collection] Failed to recover blob for item ${entry.id}:`,
        err,
      );
    }
  }

  if (updated) await writeCollection(collection);
}

/**
 * Update effects profile for a collection item. Only the list is written — the
 * media of the item is untouched, so this stays cheap no matter how big the
 * collection is.
 * @param {string} id
 * @param {Object} effects
 */
export async function updateCollectionItemEffects(id, effects) {
  if (id === undefined || id === null || !effects) return;

  const collection = await getCollection();
  const entry = collection.find((it) => String(it.id) === String(id));
  if (!entry) return;

  entry.effects = JSON.parse(JSON.stringify(effects));
  await writeCollection(collection);
}
