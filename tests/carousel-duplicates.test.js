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
       <div id="stage"><div class="carousel-viewfinder"></div><div id="track"></div></div>
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

  const container = document.getElementById("stage");
  const track = document.getElementById("track");
  const viewfinder = container.querySelector(".carousel-viewfinder");

  const engine = new CarouselEngine({
    container,
    track,
    viewfinder,
  });

  try {
    await run({ document, engine, track, container, viewfinder });
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

test("syncItems: cập nhật _bgUrl và background-image khi ảnh đổi URL mới", () =>
  withEngine(async ({ engine, track }) => {
    engine.setItems([item("a"), item("b")], 0, { silent: true });
    const cardA = engine.els[0];

    // Giả lập thẻ đã nạp ảnh trước đó
    cardA._isImageLoaded = true;
    const bg = cardA.querySelector(".card-bg");
    bg.style.backgroundImage = 'url("blob:a")';

    // Đồng bộ lại với item mang URL mới
    const updatedA = { id: "a", name: "a", sub: "", url: "blob:a_new" };
    engine.syncItems([updatedA, item("b")], 0, { silent: true });

    assert.equal(engine.els[0], cardA, "vẫn giữ nguyên DOM node cũ");
    assert.equal(cardA._bgUrl, "blob:a_new", "URL phải được cập nhật");
    assert.equal(cardA.dataset.bgUrl, "blob:a_new");
    assert.ok(bg.style.backgroundImage.includes("blob:a_new"), "background-image phải được gán lại");
    assertTrackIntegrity(engine, track, "sau khi cập nhật url");
  }));

test("syncItems & setItems: danh sách rỗng chuyển container sang is-empty và ẩn viewfinder", () =>
  withEngine(async ({ engine, container, viewfinder }) => {
    engine.setItems([item("a"), item("b")], 0, { silent: true });
    assert.equal(container.classList.contains("is-empty"), false);
    assert.equal(viewfinder.classList.contains("is-hidden"), false);

    // Đồng bộ về danh sách rỗng
    engine.syncItems([], 0, { silent: true });
    assert.equal(engine.count, 0);
    assert.equal(container.classList.contains("is-empty"), true);
    assert.equal(viewfinder.classList.contains("is-hidden"), true);

    // Nạp lại danh sách mới
    engine.setItems([item("c")], 0, { silent: true });
    assert.equal(engine.count, 1);
    assert.equal(container.classList.contains("is-empty"), false);
    assert.equal(viewfinder.classList.contains("is-hidden"), false);
  }));

test("visibleIndexRange: trả về đúng dải index giao cắt với viewport", () =>
  withEngine(async ({ engine }) => {
    const manyItems = Array.from({ length: 20 }, (_, i) => item(`card_${i}`));
    engine.setItems(manyItems, 10, { silent: true });

    const range = engine.visibleIndexRange();
    assert.ok(range.first <= 10, "first index phải nằm về bên trái hoặc bằng tâm");
    assert.ok(range.last >= 10, "last index phải nằm về bên phải hoặc bằng tâm");
    assert.ok(range.first >= 0, "first không âm");
    assert.ok(range.last < 20, "last trong giới hạn danh sách");

    // Khi danh sách rỗng
    engine.setItems([], 0, { silent: true });
    const emptyRange = engine.visibleIndexRange();
    assert.deepEqual(emptyRange, { first: -1, last: -1 }, "danh sách rỗng trả về { first: -1, last: -1 }");
  }));

test("stepByKey: tôn trọng cooldown NAV_COOLDOWN_MS để chống spam phím", () =>
  withEngine(async ({ engine }) => {
    engine.setItems([item("a"), item("b"), item("c"), item("d")], 0, { silent: true });
    engine.setActive(true);

    let steppedDelta = 0;
    const originalStep = engine.step.bind(engine);
    engine.step = (delta) => {
      steppedDelta += delta;
      return originalStep(delta);
    };

    // Bấm phím lần 1
    engine.stepByKey(1);
    assert.equal(steppedDelta, 1, "lần bấm đầu tiên phải được kích hoạt");

    // Bấm phím dồn dập ngay lập tức (< 80ms)
    engine.stepByKey(1);
    engine.stepByKey(1);
    assert.equal(steppedDelta, 1, "các lần bấm trong khoảng cooldown phải bị bỏ qua");
  }));
