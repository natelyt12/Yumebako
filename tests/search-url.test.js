import test from "node:test";
import assert from "node:assert/strict";
import {
  EXTRA_PROVIDERS,
  getPrefixSuggestions,
  parseDirectUrl,
  resolvePrefixCommand,
} from "../src/widgets/search/providers.js";

test("parseDirectUrl accepts explicit http and https URLs", () => {
  assert.equal(parseDirectUrl("https://github.com/user/repo"), "https://github.com/user/repo");
  assert.equal(parseDirectUrl("  http://localhost:5173/test  "), "http://localhost:5173/test");
});

test("parseDirectUrl prepends scheme for domains, localhost, and IPv4", () => {
  assert.equal(parseDirectUrl("youtube.com/watch?v=123"), "https://youtube.com/watch?v=123");
  assert.equal(parseDirectUrl("example.com"), "https://example.com/");
  assert.equal(parseDirectUrl("localhost:3000"), "http://localhost:3000/");
  assert.equal(parseDirectUrl("127.0.0.1:8080/api"), "http://127.0.0.1:8080/api");
});

test("parseDirectUrl rejects search queries, emails, bare filenames, and unsafe schemes", () => {
  assert.equal(parseDirectUrl(""), null);
  assert.equal(parseDirectUrl("hello google.com"), null);
  assert.equal(parseDirectUrl("search.js"), null);
  assert.equal(parseDirectUrl("photo.png"), null);
  assert.equal(parseDirectUrl("user@gmail.com"), null);
  assert.equal(parseDirectUrl("javascript:alert(1)"), null);
});

test("getPrefixSuggestions lists all extra providers on / and filters by prefix or label", () => {
  const all = getPrefixSuggestions("/");
  assert.equal(all.length, EXTRA_PROVIDERS.length);
  assert.deepEqual(
    getPrefixSuggestions("/you").map((item) => item.providerId),
    ["youtube"],
  );
  assert.deepEqual(
    getPrefixSuggestions("/google").map((item) => item.providerId),
    ["google_ai"],
  );
  assert.deepEqual(getPrefixSuggestions("youtube"), []);
});

test("resolvePrefixCommand matches exact /prefix with or without query", () => {
  const match = resolvePrefixCommand("/youtube lo-fi beats");
  assert.equal(match?.provider.id, "youtube");
  assert.equal(match?.prefixLength, 8);
  assert.equal(match?.hasSpace, true);
  assert.equal(match?.restQuery, "lo-fi beats");
  const bare = resolvePrefixCommand("/google-ai");
  assert.equal(bare?.provider.id, "google_ai");
  assert.equal(bare?.hasSpace, false);
  assert.equal(resolvePrefixCommand("/unknown test"), null);
});
