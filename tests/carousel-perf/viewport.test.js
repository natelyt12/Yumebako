import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

import { createGeometry } from "../../src/wallpaper/ui/carousel/geometry.js";

const WIDTH = 3840;

function buildCards(document, count) {
  const cards = [];
  for (let i = 0; i < count; i += 1) {
    const card = document.createElement("div");
    card.innerHTML =
      '<div class="card-frame"><div class="card-bg"></div><div class="carousel-overlay"></div></div>';
    card.dataset.bgUrl = `https://example.test/${i}.jpg`;
    card._bgUrl = card.dataset.bgUrl;
    card._item = { id: String(i) };
    card._index = i;
    card._isImageLoaded = false;
    document.body.appendChild(card);
    cards.push(card);
  }
  return cards;
}

function expectedVisible(layout, viewportWidth) {
  return layout.widths.map(
    (width, i) => layout.lefts[i] + width > 0 && layout.lefts[i] < viewportWidth,
  );
}

test("viewport: chỉ nạp ảnh cho thẻ đang giao viewport, không dùng cửa sổ offset cố định", () => {
  const dom = new JSDOM("<!doctype html><body></body>");
  const cards = buildCards(dom.window.document, 200);
  const geometry = createGeometry();

  const layout = geometry.computeLayout(100, cards.length, WIDTH / 2);
  geometry.applyLayout(cards, layout, layout, 1, WIDTH / 2);

  const expected = expectedVisible(layout, WIDTH);
  cards.forEach((card, i) => {
    assert.equal(
      card._isImageLoaded,
      expected[i],
      `thẻ ${i}: trạng thái nạp ảnh phải khớp giao viewport`,
    );
    assert.equal(
      card.classList.contains("is-onscreen"),
      expected[i],
      `thẻ ${i}: class is-onscreen phải khớp giao viewport`,
    );
    assert.equal(
      card.querySelector(".card-bg").style.backgroundImage !== "",
      expected[i],
      `thẻ ${i}: background-image chỉ tồn tại khi thẻ trong viewport`,
    );
  });

  // Thẻ ngoài tâm nhưng vẫn nằm trong viewport phải được giữ ảnh — đây chính là
  // hành vi mà cửa sổ `offset <= 7` cũ làm sai.
  const farButVisible = expected.findIndex((visible, i) => visible && Math.abs(i - 100) > 7);
  assert.notEqual(farButVisible, -1, "phải có thẻ cách tâm > 7 bậc vẫn nằm trong viewport");
  assert.equal(cards[farButVisible]._isImageLoaded, true);
});

test("viewport: resize thu hẹp thì gỡ ảnh/layer của thẻ đã ra ngoài", () => {
  const dom = new JSDOM("<!doctype html><body></body>");
  const cards = buildCards(dom.window.document, 200);
  const geometry = createGeometry();
  const layout = geometry.computeLayout(100, cards.length, WIDTH / 2);

  geometry.applyLayout(cards, layout, layout, 1, WIDTH / 2);
  const loadedWide = cards.filter((card) => card._isImageLoaded).length;

  const narrowWidth = 700;
  geometry.applyLayout(cards, layout, layout, 1, narrowWidth / 2);
  const expectedNarrow = expectedVisible(layout, narrowWidth);
  const loadedNarrow = cards.filter((card) => card._isImageLoaded).length;

  assert.ok(loadedNarrow < loadedWide, "viewport hẹp phải giữ ít ảnh hơn");
  assert.equal(loadedNarrow, expectedNarrow.filter(Boolean).length);
  cards.forEach((card, i) => {
    assert.equal(card._isImageLoaded, expectedNarrow[i]);
    assert.equal(card.classList.contains("is-onscreen"), expectedNarrow[i]);
  });
});
