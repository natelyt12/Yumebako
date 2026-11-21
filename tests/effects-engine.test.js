import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { installWallpaperTestEnv } from "./helpers/mockEnv.js";

installWallpaperTestEnv();

function setupEffectsDom() {
  const dom = new JSDOM(
    `<!doctype html><html><body>
      <div class="wallpaper_effect_container"></div>
      <div class="static_effect_container"></div>
    </body></html>`,
  );

  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.HTMLElement = dom.window.HTMLElement;

  let rafCalls = 0;
  let nextRafId = 1;
  globalThis.requestAnimationFrame = () => {
    rafCalls++;
    return nextRafId++;
  };
  globalThis.cancelAnimationFrame = () => {};

  // Minimal 2D canvas stub for Node/jsdom without native canvas package
  dom.window.HTMLCanvasElement.prototype.getContext = function () {
    const noop = () => {};
    const grad = { addColorStop: noop };
    return {
      clearRect: noop,
      save: noop,
      restore: noop,
      fillRect: noop,
      beginPath: noop,
      arc: noop,
      fill: noop,
      stroke: noop,
      moveTo: noop,
      lineTo: noop,
      quadraticCurveTo: noop,
      translate: noop,
      rotate: noop,
      scale: noop,
      setTransform: noop,
      drawImage: noop,
      createRadialGradient: () => grad,
      createLinearGradient: () => grad,
    };
  };

  return {
    dom,
    getRafCalls: () => rafCalls,
  };
}

test("EffectsEngine: static effects draw once without starting a 60fps rAF loop, and loadState skips identical state", async () => {
  const { dom, getRafCalls } = setupEffectsDom();
  try {
    const { EffectsEngine } = await import(
      "../src/wallpaper/backend/effects/particles/EffectsEngine.js"
    );

    const engine = new EffectsEngine();
    const state = {
      enabled: true,
      dynamicEnabled: true,
      staticEnabled: true,
      dynamic: [],
      static: [{ id: "vig_1", type: "vignette", enabled: true, config: {} }],
    };

    engine.loadState(state);
    assert.equal(engine.staticLayers.size, 1);
    assert.equal(getRafCalls(), 0, "static effect must not start rAF loop");

    const canvasBefore = engine.staticLayers.get("vig_1").canvas;

    // Reloading identical state must be a no-op (preserve existing canvas)
    engine.loadState({
      enabled: true,
      dynamic: [],
      static: [{ id: "vig_1", type: "vignette", enabled: true, config: {} }],
    });
    assert.equal(
      engine.staticLayers.get("vig_1").canvas,
      canvasBefore,
      "identical loadState should skip stopAll + rebuild",
    );

    // Adding a dynamic effect invalidates signature so loadState can revert
    engine.addEffect("snow_1", "dynamic", "snow", { count: 10 });
    assert.equal(getRafCalls(), 1, "dynamic effect starts rAF loop");

    engine.loadState(state);
    assert.equal(engine.dynamicLayers.size, 0, "loadState reverted preview effect");
    assert.equal(engine.staticLayers.size, 1);

    engine.stopAll();
  } finally {
    dom.window.close();
  }
});

test("EffectsEngine.markStateSynced prevents loadState rebuild after incremental auto-save edits", async () => {
  const { dom } = setupEffectsDom();
  try {
    const { EffectsEngine } = await import(
      "../src/wallpaper/backend/effects/particles/EffectsEngine.js"
    );

    const engine = new EffectsEngine();
    assert.equal(engine.addEffect("snow_1", "dynamic", "snow", { count: 10 }), true);
    const liveCanvas = engine.dynamicLayers.get("snow_1").canvas;

    const syncedState = {
      enabled: true,
      dynamicEnabled: true,
      staticEnabled: false,
      dynamic: [{ id: "snow_1", type: "snow", enabled: true, config: { count: 10 } }],
      static: [],
    };
    engine.markStateSynced(syncedState);
    engine.loadState(syncedState);

    assert.equal(
      engine.dynamicLayers.get("snow_1").canvas,
      liveCanvas,
      "markStateSynced keeps live effect canvas intact on subsequent loadState",
    );

    engine.stopAll();
  } finally {
    dom.window.close();
  }
});

test("createAutoSaver debounces schedule calls and supports flush, cancel, and now", async () => {
  const { createAutoSaver } = await import(
    "../src/wallpaper/frontend/customize/state.js"
  );

  let saves = 0;
  const saver = createAutoSaver(() => {
    saves++;
  }, 15);

  saver.schedule();
  saver.schedule();
  assert.equal(saves, 0, "schedule coalesces rapid tweaks asynchronously");

  await new Promise((r) => setTimeout(r, 35));
  assert.equal(saves, 1, "coalesced rapid schedule calls fire once");

  saver.schedule();
  saver.flush();
  assert.equal(saves, 2, "flush commits pending debounced edit immediately");

  saver.flush();
  assert.equal(saves, 2, "flush is a no-op when nothing is pending");

  saver.schedule();
  saver.cancel();
  await new Promise((r) => setTimeout(r, 35));
  assert.equal(saves, 2, "cancel drops pending debounced edit");

  saver.now();
  assert.equal(saves, 3, "now commits immediately");
});
