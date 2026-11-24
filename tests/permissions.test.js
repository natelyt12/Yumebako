import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>");
globalThis.document = dom.window.document;
globalThis.CustomEvent = dom.window.CustomEvent;

const { EVENTS } = await import("../src/core/events.js");
const { EventBus } = await import("../src/core/eventBus.js");
const {
    PERMISSION_STATUS,
    hasPermission,
    requestPermission,
    removePermission,
    withPermission,
} = await import("../src/core/permissions.js");

describe("core/permissions", () => {
    const originalChrome = globalThis.chrome;

    beforeEach(() => {
        delete globalThis.chrome;
    });

    afterEach(() => {
        if (originalChrome === undefined) {
            delete globalThis.chrome;
        } else {
            globalThis.chrome = originalChrome;
        }
    });

    it("returns UNSUPPORTED and emits PERMISSION_ERROR when chrome.permissions is missing", async () => {
        const events = [];
        const off = EventBus.on(EVENTS.PERMISSION_ERROR, (e) => events.push(e.detail), "test");

        const result = await hasPermission(
            { permissions: ["bookmarks"] },
            { source: "bookmarks-widget", notifyOnUnsupported: true }
        );

        off();
        assert.equal(result.granted, false);
        assert.equal(result.status, PERMISSION_STATUS.UNSUPPORTED);
        assert.equal(events.length, 1);
        assert.equal(events[0].source, "bookmarks-widget");
    });

    it("emits PERMISSION_REQUIRED when permission is missing and notifyOnMissing is true", async () => {
        globalThis.chrome = {
            permissions: {
                contains: async () => false,
                request: async () => false,
            },
        };

        const requiredEvents = [];
        const off = EventBus.on(EVENTS.PERMISSION_REQUIRED, (e) => requiredEvents.push(e.detail), "test");

        const result = await hasPermission(
            { permissions: ["tabs"] },
            { source: "tabs-widget", notifyOnMissing: true }
        );

        off();
        assert.equal(result.granted, false);
        assert.equal(result.status, PERMISSION_STATUS.MISSING);
        assert.equal(requiredEvents.length, 1);
        assert.deepEqual(requiredEvents[0].query, { permissions: ["tabs"] });
    });

    it("catches request errors (e.g. non-user-gesture) and notifies UI", async () => {
        globalThis.chrome = {
            permissions: {
                contains: async () => false,
                request: async () => {
                    throw new Error("permissions.request may only be called during a user gesture.");
                },
            },
        };

        const errors = [];
        const off = EventBus.on(EVENTS.PERMISSION_ERROR, (e) => errors.push(e.detail), "test");

        const result = await requestPermission(
            { permissions: ["history"] },
            { source: "history-widget" }
        );

        off();
        assert.equal(result.granted, false);
        assert.equal(result.status, PERMISSION_STATUS.ERROR);
        assert.match(result.message, /user gesture/i);
        assert.equal(errors.length, 1);
    });

    it("withPermission blocks action when missing and notifies UI", async () => {
        let actionCalled = false;
        globalThis.chrome = {
            permissions: {
                contains: async () => false,
                request: async () => false,
            },
        };

        const requiredEvents = [];
        const off = EventBus.on(EVENTS.PERMISSION_REQUIRED, (e) => requiredEvents.push(e.detail), "test");

        const res = await withPermission(
            { permissions: ["topSites"] },
            async () => {
                actionCalled = true;
                return ["https://example.com"];
            },
            { source: "topsites-widget" }
        );

        off();
        assert.equal(actionCalled, false);
        assert.equal(res.ok, false);
        assert.equal(res.permission.status, PERMISSION_STATUS.MISSING);
        assert.equal(requiredEvents.length, 1);
    });

    it("withPermission runs action when granted and catches action errors", async () => {
        globalThis.chrome = {
            permissions: {
                contains: async () => true,
                request: async () => true,
            },
        };

        const okRes = await withPermission(
            { permissions: ["bookmarks"] },
            async () => [{ title: "Docs" }],
            { source: "bookmarks-widget" }
        );
        assert.equal(okRes.ok, true);
        assert.deepEqual(okRes.data, [{ title: "Docs" }]);

        const errors = [];
        const off = EventBus.on(EVENTS.PERMISSION_ERROR, (e) => errors.push(e.detail), "test");

        const failRes = await withPermission(
            { permissions: ["bookmarks"] },
            async () => {
                throw new Error("Unexpected API failure");
            },
            { source: "bookmarks-widget" }
        );

        off();
        assert.equal(failRes.ok, false);
        assert.equal(failRes.error.message, "Unexpected API failure");
        assert.equal(errors.length, 1);
    });

    it("removePermission safely revokes permissions", async () => {
        globalThis.chrome = {
            permissions: {
                contains: async () => true,
                request: async () => true,
                remove: async () => true,
            },
        };

        const res = await removePermission({ permissions: ["bookmarks"] }, { source: "settings" });
        assert.equal(res.removed, true);
        assert.equal(res.status, PERMISSION_STATUS.MISSING);
    });
});
