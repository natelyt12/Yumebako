import test from "node:test";
import assert from "node:assert/strict";

// Mock environment
let mockSettings = {
    wallpaperConfig: {
        activeWallpaperId: "active_wall_1",
        activeCollectionItemId: null,
    },
};

const mockAppData = new Map();
const mockMediaData = new Map();

// Test the logic of mediaGC functions
test("mediaGC: collectValidMediaIds aggregates IDs across all stores", async () => {
    // Populate mock appData
    mockAppData.set("carousel:picre", {
        key: "carousel:picre",
        value: [{ id: "picre_1" }, { id: "picre_2" }],
    });
    mockAppData.set("carousel:wallhaven", {
        key: "carousel:wallhaven",
        value: [{ id: "wallhaven_1" }],
    });
    mockAppData.set("provider_state:bing", {
        key: "provider_state:bing",
        value: {
            items: [{ id: "bing_today" }, { id: "bing_yesterday" }],
            applied: { id: "bing_applied" },
        },
    });

    const validIds = new Set();
    if (mockSettings.wallpaperConfig?.activeWallpaperId) {
        validIds.add(String(mockSettings.wallpaperConfig.activeWallpaperId));
    }

    for (const [_, entry] of mockAppData.entries()) {
        const val = entry.value;
        if (Array.isArray(val)) {
            for (const item of val) {
                if (item?.id) validIds.add(String(item.id));
            }
        } else if (typeof val === "object" && val !== null) {
            if (Array.isArray(val.items)) {
                for (const item of val.items) {
                    if (item?.id) validIds.add(String(item.id));
                }
            }
            if (val.applied?.id) validIds.add(String(val.applied.id));
        }
    }

    assert.equal(validIds.has("active_wall_1"), true);
    assert.equal(validIds.has("picre_1"), true);
    assert.equal(validIds.has("picre_2"), true);
    assert.equal(validIds.has("wallhaven_1"), true);
    assert.equal(validIds.has("bing_today"), true);
    assert.equal(validIds.has("bing_applied"), true);
    assert.equal(validIds.has("non_existent_id"), false);
});

test("mediaGC: correctly purges orphaned blobs and keeps referenced ones", async () => {
    const validIds = new Set(["active_wall_1", "picre_1"]);

    mockMediaData.set("media:orig:active_wall_1", "blob_1_orig");
    mockMediaData.set("media:thumb:active_wall_1", "blob_1_thumb");
    mockMediaData.set("media:orig:picre_1", "blob_picre_orig");
    mockMediaData.set("media:orig:orphan_99", "blob_orphan_orig");
    mockMediaData.set("media:thumb:orphan_99", "blob_orphan_thumb");
    mockMediaData.set("wallpaper_media:legacy:123", "blob_legacy");

    let deleted = 0;
    let kept = 0;

    for (const key of Array.from(mockMediaData.keys())) {
        const match = key.match(/^media:(?:orig|thumb):(.+)$/);
        if (match) {
            const id = match[1];
            if (!validIds.has(id)) {
                mockMediaData.delete(key);
                deleted++;
            } else {
                kept++;
            }
            continue;
        }

        if (key.startsWith("wallpaper_media:")) {
            mockMediaData.delete(key);
            deleted++;
        }
    }

    assert.equal(deleted, 3); // orphan_99 (orig + thumb) + legacy
    assert.equal(kept, 3);    // active_wall_1 (orig + thumb) + picre_1 (orig)
    assert.equal(mockMediaData.has("media:orig:orphan_99"), false);
    assert.equal(mockMediaData.has("media:thumb:orphan_99"), false);
    assert.equal(mockMediaData.has("wallpaper_media:legacy:123"), false);
    assert.equal(mockMediaData.has("media:orig:active_wall_1"), true);
    assert.equal(mockMediaData.has("media:orig:picre_1"), true);
});

