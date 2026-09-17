import { RemoteSource } from "./RemoteSource.js";
import { fetchWallhavenQueue } from "/src/wallpaper/sources/api/wallhavenAPI.js";
import { getFromStore, saveToStore } from "/src/core/db.js";

/**
 * WallhavenSource.js
 * ---------------------------------------------------------------------------
 * Switcher source that queries the Wallhaven API using the user's saved
 * filters (`wallhavenConfig`).
 *
 * A single API call returns a batch of wallpapers that is kept in the app's
 * `data:wallhaven` queue; the carousel then materializes them one at a time as
 * the user reaches the trailing "+" card, refilling the queue when it runs dry.
 *
 * An unreachable API raises instead of yielding an empty batch, so the item can
 * report a retryable error rather than retiring itself as "nothing left".
 */
export class WallhavenSource extends RemoteSource {
    static id = "wallhaven";
    static label = "Wallhaven";
    static providerId = "wallhaven";
    static storageKey = "data:wallhaven";

    /** Take the next wallpaper off the persisted queue, refilling it if empty. */
    async fetchItem() {
        const key = this.constructor.storageKey;
        const storeData = (await getFromStore(key)) || { queue: [], current: null };
        const queue = Array.isArray(storeData.queue) ? storeData.queue : [];

        if (queue.length === 0) {
            // Strict on purpose: a network failure must surface as an error the
            // user can retry, never as "this feed has nothing left".
            queue.push(...(await fetchWallhavenQueue({ strict: true })));
            storeData.queue_total = queue.length;
        }

        const entry = queue.shift();
        if (!entry?.path) return null;

        storeData.queue = queue;
        await saveToStore(key, storeData);

        return this.toCarouselItem(entry, {
            id: String(entry.id),
            url: entry.path,
            sourceUrl: entry.short_url || entry.path,
            title: `${entry.category || "wallhaven"} • ${entry.dimension_x}×${entry.dimension_y}`,
            category: entry.category || "wallhaven",
            thumbnailUrl: entry.thumbs?.large || entry.thumbs?.original || entry.path,
            width: entry.dimension_x || 0,
            height: entry.dimension_y || 0,
            size: entry.file_size || 0,
        });
    }

    /** Title of the wallpaper restored from its persisted `current` record. */
    getSeedTitle(current) {
        return current.category ? `wallhaven • ${current.category}` : "wallhaven";
    }
}
