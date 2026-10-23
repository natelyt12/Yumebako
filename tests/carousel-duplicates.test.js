import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

/**
 * Regression tests for duplicate ids reaching the carousel.
 *
 * Wallhaven's `random` sorting hands back wallpapers that are already in the
 * strip once the filter's result set is exhausted, and builds before the
 * `uniqueCards()` guard could write those duplicates into `carousel:*`. The
 * engine keys cards by id, so two cards with the same id used to share one DOM
 * element: the old slot lost its image and the extra node was left behind as a
 * ghost card that no layout ever wrote again.
 */

const WIDTH = 1788;

function mountEngine() {
  const dom = new JSDOM(
    `<!doctype html><html><body>
       <div id="stage"><div id="track"></div></div>
     </body></html>`,
    { pretendToBeVisual: true },
  );

  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.HTMLElement = dom.window.HTMLElement;
  globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
  globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
  globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);

  Object.defineProperty(dom.window.HTMLElement.prototype, "clientWidth", {
    configurable: true,
    get() {
      return this.id === "stage" ? WIDTH : 0;
    },
  });

  return { dom, document: dom.window.document };
}

/**
 * Dựng engine thật trên jsdom rồi dọn sạch sau mỗi test: listener của engine
 * gắn vào `window` là của riêng cửa sổ jsdom này, đóng cửa sổ mà không
 * `destroy()` thì cửa sổ kế tiếp thừa hưởng chúng.
 */
async function withEngine(run) {
  const { dom, document } = mountEngine();
  const { CarouselEngine } = await import(
    "../src/wallpaper/ui/carousel/CarouselEngine.js"
  );

  const engine = new CarouselEngine({
    container: document.getElementById("stage"),
    track: document.getElementById("track"),
  });

  try {
    await run({ document, engine, track: document.getElementById("track") });
  } finally {
    engine.destroy();
    dom.window.close();
  }
}

/** Card item in the shape the switcher hands to the engine. */
const item = (id) => ({ id, name: String(id), sub: "", url: `blob:${id}` });

const items = (...ids) => ids.map(item);

/**
 * The invariant the whole strip relies on: `engine.els` is exactly the track's
 * children, in order, with no element appearing twice. Anything else means some
 * slot is drawn without a card and some card is drawn twice.
 */
function assertTrackIntegrity(engine, track, label) {
  const children = [...track.querySelectorAll(".carousel-item")];
  assert.equal(
    engine.els.length,
    children.length,
    `${label}: số thẻ engine giữ phải bằng số node trong track`,
  );
  assert.equal(
    new Set(engine.els).size,
    engine.els.length,
    `${label}: không thẻ nào được xuất hiện hai lần trong engine.els`,
  );

  const ids = children.map((el) => el.dataset.id);
  assert.equal(new Set(ids).size, ids.length, `${label}: id thẻ trong DOM phải là duy nhất`);

  children.forEach((el, i) => {
    assert.equal(engine.els[i], el, `${label}: thứ tự els phải khớp DOM (vị trí ${i})`);
    assert.notEqual(el.style.width, "", `${label}: thẻ ${i} phải được layout ghi bề rộng`);
  });
}

test("setItems: danh sách có id trùng chỉ dựng một thẻ cho mỗi id", () =>
  withEngine(async ({ engine, track }) => {
    engine.setItems(items("a", "b", "b", "c"), 0, { silent: true });

    assert.equal(engine.count, 3, "bản ghi trùng id bị bỏ, giữ bản đầu tiên");
    assert.deepEqual(
      engine.items.map((entry) => entry.id),
      ["a", "b", "c"],
    );
    assertTrackIntegrity(engine, track, "setItems");
  }));

test("syncItems: roll thêm ảnh trùng id không làm vỡ dải", () =>
  withEngine(async ({ engine, track }) => {
    engine.setItems(items("a", "b", "c", "d"), 0, { silent: true });
    assertTrackIntegrity(engine, track, "trước khi roll");

    // Wallhaven trả lại "b" (ảnh đã có) cùng một ảnh mới "e" trong cùng batch.
    engine.syncItems(items("a", "b", "c", "d", "b", "e"), 0, { silent: true });

    assert.deepEqual(
      engine.items.map((entry) => entry.id),
      ["a", "b", "c", "d", "e"],
    );
    assertTrackIntegrity(engine, track, "sau khi roll");
  }));

test("syncItems: node mồ côi còn sót trong track được dọn", () =>
  withEngine(async ({ document, engine, track }) => {
    engine.setItems(items("a", "b", "c"), 0, { silent: true });

    // Thẻ ma của một lần đồng bộ lệch trước đó: nằm trong DOM nhưng không thuộc
    // `engine.els` nên chẳng layout nào ghi tới nữa.
    const ghost = document.createElement("div");
    ghost.className = "carousel-item mode-1";
    ghost.dataset.id = "ghost";
    track.appendChild(ghost);

    engine.syncItems(items("a", "b", "c"), 0, { silent: true });

    assert.equal(
      track.querySelector('[data-id="ghost"]'),
      null,
      "node ngoài danh sách phải bị gỡ chứ không nằm lại dải",
    );
    assertTrackIntegrity(engine, track, "sau khi dọn");
  }));

test("syncItems: id dạng số và dạng chuỗi của cùng bản ghi dùng lại một element", () =>
  withEngine(async ({ engine, track }) => {
    engine.setItems([item(7), item(8)], 0, { silent: true });
    const before = [...engine.els];

    // Store có thể trả lại cùng bản ghi với id đã được chuẩn hoá sang chuỗi.
    engine.syncItems(items("7", "8"), 0, { silent: true });

    assert.equal(engine.count, 2);
    engine.els.forEach((el, i) => {
      assert.equal(el, before[i], `thẻ ${i} phải giữ nguyên element (không dựng lại)`);
    });
    assertTrackIntegrity(engine, track, "sau khi chuẩn hoá id");
  }));
