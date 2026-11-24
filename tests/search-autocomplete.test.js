import test from "node:test";
import assert from "node:assert/strict";
import {
  fetchAutocompleteSuggestions,
  formatDisplayUrl,
  getFaviconUrl,
} from "../src/widgets/search/autocomplete.js";

test("formatDisplayUrl strips http/https schemes and trailing slashes", () => {
  assert.equal(formatDisplayUrl("https://github.com/user/repo/"), "github.com/user/repo");
  assert.equal(formatDisplayUrl("http://localhost:3000/"), "localhost:3000");
});

test("getFaviconUrl builds Chrome _favicon URL when runtime is available", () => {
  const originalChrome = globalThis.chrome;
  globalThis.chrome = {
    runtime: {
      id: "ext-id",
      getURL: (path) => `chrome-extension://ext-id${path}`,
    },
  };
  try {
    assert.equal(
      getFaviconUrl("https://github.com/user/repo", 32),
      "chrome-extension://ext-id/_favicon/?pageUrl=https%3A%2F%2Fgithub.com%2Fuser%2Frepo&size=32",
    );
  } finally {
    globalThis.chrome = originalChrome;
  }
});

test("fetchAutocompleteSuggestions merges, deduplicates, and prioritizes bookmarks", async () => {
  const originalChrome = globalThis.chrome;
  globalThis.chrome = {
    bookmarks: {
      async search() {
        return [
          { id: "b1", title: "GitHub Dashboard", url: "https://github.com/" },
          { id: "b2", title: "Bookmarklet", url: "javascript:alert(1)" },
        ];
      },
    },
    history: {
      async search() {
        return [
          { id: "h1", title: "GitHub", url: "https://github.com", visitCount: 25, lastVisitTime: 200 },
          { id: "h2", title: "GitHub Docs", url: "https://docs.github.com/en", visitCount: 5, lastVisitTime: 100 },
        ];
      },
    },
  };

  try {
    const results = await fetchAutocompleteSuggestions("git", {
      bookmarks: true,
      history: true,
      limit: 5,
    });
    assert.equal(results.length, 2);
    assert.equal(results[0].source, "bookmark");
    assert.equal(results[0].url, "https://github.com/");
    assert.equal(results[1].source, "history");
    assert.equal(results[1].url, "https://docs.github.com/en");
  } finally {
    globalThis.chrome = originalChrome;
  }
});

test("fetchAutocompleteSuggestions returns empty array when disabled or blank", async () => {
  assert.deepEqual(
    await fetchAutocompleteSuggestions("   ", { bookmarks: true, history: true }),
    [],
  );
  assert.deepEqual(
    await fetchAutocompleteSuggestions("g", { bookmarks: false, history: false }),
    [],
  );
});
