import test from "node:test";
import assert from "node:assert/strict";
import { installWallpaperTestEnv } from "./helpers/mockEnv.js";

const env = installWallpaperTestEnv();

const { collectValidMediaIds, runMediaGC } = await import(
  "../src/wallpaper/backend/data/mediaGC.js"
);
const { saveSettings } = await import("../src/core/storageHandler.js");

test("mediaGC.collectValidMediaIds: aggregates IDs from real settings, DataControl, and appData while ignoring legacy dynamic carousel keys", async () => {
  env.reset();
  saveSettings({
    wallpaperConfig: {
      activeWallpaperId: "active_wall_1",
      activeCollectionItemId: "coll_active_1",
    },
  });

  env.db.appData.set("carousel:picre", [{ id: "picre_1" }, { id: "picre_2" }]);
  env.db.appData.set("carousel:wallhaven", [{ id: "wallhaven_1" }]);
  // Legacy dynamic keys must be ignored so stale snapshots do not pin orphaned blobs
  env.db.appData.set("carousel:collection", [{ id: "stale_coll_1" }]);
  env.db.appData.set("carousel:bing", [{ id: "stale_bing_1" }]);
  env.db.appData.set("provider_state:bing", {
    items: [{ id: "bing_today" }],
    applied: { id: "bing_applied" },
  });

  const validIds = await collectValidMediaIds({
    dataControl: { items: [{ id: "in_memory_1" }] },
  });

  assert.equal(validIds.has("active_wall_1"), true);
  assert.equal(validIds.has("coll_active_1"), true);
  assert.equal(validIds.has("picre_1"), true);
  assert.equal(validIds.has("picre_2"), true);
  assert.equal(validIds.has("wallhaven_1"), true);
  assert.equal(validIds.has("bing_today"), true);
  assert.equal(validIds.has("bing_applied"), true);
  assert.equal(validIds.has("in_memory_1"), true);
  assert.equal(validIds.has("stale_coll_1"), false);
  assert.equal(validIds.has("stale_bing_1"), false);
  assert.equal(validIds.has("non_existent_id"), false);
});

test("mediaGC.runMediaGC: purges orphaned and legacy mediaData blobs while preserving referenced ones", async () => {
  env.reset();
  saveSettings({
    wallpaperConfig: {
      activeWallpaperId: "active_wall_1",
      activeCollectionItemId: null,
    },
  });
  env.db.appData.set("carousel:picre", [{ id: "picre_1" }]);

  env.db.mediaData.set("media:orig:active_wall_1", "blob_1_orig");
  env.db.mediaData.set("media:thumb:active_wall_1", "blob_1_thumb");
  env.db.mediaData.set("media:orig:picre_1", "blob_picre_orig");
  env.db.mediaData.set("media:orig:orphan_99", "blob_orphan_orig");
  env.db.mediaData.set("media:thumb:orphan_99", "blob_orphan_thumb");
  env.db.mediaData.set("wallpaper_media:legacy:123", "blob_legacy");

  const stats = await runMediaGC({ dataControl: { items: [] } });

  assert.deepEqual(stats, { deleted: 3, kept: 3 });
  assert.equal(env.db.mediaData.has("media:orig:orphan_99"), false);
  assert.equal(env.db.mediaData.has("media:thumb:orphan_99"), false);
  assert.equal(env.db.mediaData.has("wallpaper_media:legacy:123"), false);
  assert.equal(env.db.mediaData.has("media:orig:active_wall_1"), true);
  assert.equal(env.db.mediaData.has("media:thumb:active_wall_1"), true);
  assert.equal(env.db.mediaData.has("media:orig:picre_1"), true);
});
