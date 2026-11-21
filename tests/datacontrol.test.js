import test from "node:test";
import assert from "node:assert/strict";
import { installWallpaperTestEnv } from "./helpers/mockEnv.js";

const env = installWallpaperTestEnv();

const { DataControl, uniqueCards } = await import(
  "../src/wallpaper/backend/data/DataControl.js"
);
const { stripCardBlobs } = await import(
  "../src/wallpaper/backend/data/cardUtils.js"
);
const { getSettings } = await import("../src/core/storageHandler.js");

test("uniqueCards: deduplicates by normalized id while keeping first occurrence", () => {
  const result = uniqueCards([
    null,
    { id: "a", title: "first" },
    { id: "b", title: "second" },
    { id: "a", title: "dup-string" },
    { id: 7, title: "num-7" },
    { id: "7", title: "str-7" },
    undefined,
  ]);

  assert.deepEqual(
    result.map((c) => c.title),
    ["first", "second", "num-7"],
  );
});

test("stripCardBlobs: removes transient blob: thumbnailUrl and Blob fields before persistence", () => {
  const fakeBlob = new Blob(["img"], { type: "image/png" });
  const cleaned = stripCardBlobs({
    id: "wh_1",
    thumbnailUrl: "blob:https://example.local/123",
    blob: fakeBlob,
    raw: {
      id: "wh_1",
      thumbnail: fakeBlob,
      blob: fakeBlob,
      path: "https://example.com/1.jpg",
    },
  });

  assert.equal(cleaned.thumbnailUrl, null);
  assert.equal("blob" in cleaned, false);
  assert.equal("thumbnail" in cleaned.raw, false);
  assert.equal("blob" in cleaned.raw, false);
  assert.equal(cleaned.raw.path, "https://example.com/1.jpg");
});

test("DataControl._persistCards: skips dynamic sources (collection, bing) and strips blobs on static sources", async () => {
  env.reset();
  const dc = new DataControl();

  await dc._persistCards("collection", [{ id: "c1" }]);
  await dc._persistCards("bing", [{ id: "b1" }]);
  assert.equal(env.db.appData.has("carousel:collection"), false);
  assert.equal(env.db.appData.has("carousel:bing"), false);

  await dc._persistCards("wallhaven", [
    {
      id: "w1",
      thumbnailUrl: "blob:https://example.local/thumb-1",
      raw: { thumbnail: new Blob(["t"]) },
    },
    {
      id: "w1",
      thumbnailUrl: "blob:https://example.local/thumb-dup",
    },
    {
      id: "w2",
      thumbnailUrl: "https://cdn.example.com/thumb-2.jpg",
    },
  ]);

  const stored = env.db.appData.get("carousel:wallhaven");
  assert.equal(Array.isArray(stored), true);
  assert.equal(stored.length, 2);
  assert.equal(stored[0].thumbnailUrl, null);
  assert.equal("thumbnail" in stored[0].raw, false);
  assert.equal(stored[1].thumbnailUrl, "https://cdn.example.com/thumb-2.jpg");
});

test("DataControl.switchSource: cleans legacy carousel:bing key, deduplicates static source list, and normalizes effects", async () => {
  env.reset();
  env.db.appData.set("carousel:bing", [{ id: "stale_bing" }]);
  env.db.appData.set("carousel:picre", [
    { id: "p1", url: "https://example.com/p1.jpg" },
    { id: "p1", url: "https://example.com/p1-dup.jpg" },
    { id: "p2", url: "https://example.com/p2.jpg" },
  ]);

  const dc = new DataControl();
  // Stub picre source prepareThumb to avoid network calls
  const picreSource = dc.sources.get("picre");
  picreSource.prepareThumb = async (item) => item.url;

  await dc.switchSource("picre");

  assert.equal(dc.activeSourceId, "picre");
  assert.deepEqual(
    dc.items.map((c) => c.id),
    ["p1", "p2"],
  );
  assert.ok(dc.items[0].effects?.filter, "effects must be normalized");
  assert.equal(
    env.db.appData.get("carousel:picre").length,
    2,
    "self-heals persisted duplicate records",
  );

  // Switching to dynamic source cleans up legacy carousel:* key
  const bingSource = dc.sources.get("bing");
  bingSource.fetchItems = async () => [{ id: "b1", url: "https://bing.com/1.jpg" }];
  await dc.switchSource("bing");
  assert.equal(env.db.appData.has("carousel:bing"), false);
});

test("DataControl.requestMore: enforces FIFO maxCards cap and protects active desktop card", async () => {
  env.reset();
  const dc = new DataControl();
  const wallhaven = dc.sources.get("wallhaven");
  wallhaven.deleteItem = async () => {};

  const existing = Array.from({ length: 20 }, (_, i) => ({
    id: `wh_${i}`,
    source: "wallhaven",
    url: `https://example.com/${i}.jpg`,
  }));
  env.db.appData.set("carousel:wallhaven", existing);
  wallhaven.prepareThumb = async (item) => item.url;

  await dc.switchSource("wallhaven", 0);
  // Mark wh_0 as active desktop wallpaper so FIFO eviction skips index 0 and drops wh_1
  await dc.commitAppliedCard(dc.items[0], {
    id: "wh_0",
    type: "image",
    effects: dc.items[0].effects,
  });

  wallhaven.fetchMore = async () => [
    { id: "wh_5", url: "https://example.com/dup.jpg" }, // duplicate in strip -> skipped
    { id: "wh_new", url: "https://example.com/new.jpg" },
    { id: "wh_new", url: "https://example.com/new-dup.jpg" }, // duplicate in batch -> skipped
  ];

  const added = await dc.requestMore();
  assert.equal(added?.id, "wh_new");
  assert.equal(dc.items.length, 20);
  assert.equal(dc.items[0].id, "wh_0", "active desktop card at index 0 is protected");
  assert.equal(
    dc.items.some((c) => c.id === "wh_1"),
    false,
    "oldest non-active card wh_1 is evicted",
  );
  assert.equal(dc.items[dc.items.length - 1].id, "wh_new");
  assert.equal(getSettings().wallpaperConfig.activeWallpaperId, "wh_0");
});

test("DataControl.init: does not emit redundant startup card:effects_changed cascade", async () => {
  env.reset();
  env.db.appData.set("carousel:picre", [
    { id: "p1", url: "https://example.com/p1.jpg" },
  ]);

  const { saveSettings } = await import("../src/core/storageHandler.js");
  saveSettings({
    wallpaperConfig: { source: "picre", activeWallpaperId: "p1" },
  });

  const dc = new DataControl();
  dc.sources.get("picre").prepareThumb = async (item) => item.url;

  let effectsChangedCount = 0;
  dc.on("card:effects_changed", () => {
    effectsChangedCount++;
  });

  await dc.init();
  assert.equal(
    effectsChangedCount,
    0,
    "initial subscribe() callbacks must not trigger updateActiveCardEffects() at startup",
  );
});

test("DataControl.sortCurrentItems: does not mutate cached sourceIndices in place", () => {
  env.reset();
  const { saveSettings } = globalThis.localStorage
    ? { saveSettings: null }
    : {};
  void saveSettings;

  const dc = new DataControl();
  dc.activeSourceId = "collection";
  dc.items = [
    { id: "c2", addedAt: 2 },
    { id: "c1", addedAt: 1 },
  ];
  dc.currentIndex = 0;

  const beforeRef = getSettings().wallpaperSwitcher?.sourceIndices;
  const beforeVal = beforeRef?.collection;

  const collectionSource = dc.sources.get("collection");
  const origSort = collectionSource.sortItems.bind(collectionSource);
  collectionSource.sortItems = (items) => [...items].reverse();

  dc.sortCurrentItems();

  assert.equal(dc.currentIndex, 1);
  if (beforeRef) {
    assert.equal(
      beforeRef.collection,
      beforeVal,
      "previous cached sourceIndices reference must not be mutated in place",
    );
  }
  assert.equal(getSettings().wallpaperSwitcher.sourceIndices.collection, 1);
  collectionSource.sortItems = origSort;
});

