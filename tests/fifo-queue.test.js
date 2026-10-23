import test from "node:test";
import assert from "node:assert/strict";

/**
 * Pure test for FIFO rolling queue logic matching DataControl.
 */
function getPruneCandidateIndex(items, appliedId) {
  if (!items || items.length === 0) return null;

  let pruneIndex = 0;
  if (appliedId && items[0]?.id === appliedId && items.length > 1) {
    pruneIndex = 1;
  }

  if (appliedId && items[pruneIndex]?.id === appliedId) {
    return null;
  }

  return pruneIndex;
}

async function simulateRequestMore({
  items,
  currentIndex,
  cap,
  appliedId,
  freshItems,
  onPruneActive,
}) {
  let currentIdx = currentIndex;
  let softIdx = currentIndex;
  let prunedCard = null;

  if (Number.isFinite(cap)) {
    while (items.length + freshItems.length > cap && items.length > 0) {
      const pruneIndex = getPruneCandidateIndex(items, appliedId);
      if (pruneIndex === null || pruneIndex < 0 || pruneIndex >= items.length)
        break;

      const candidate = items[pruneIndex];
      const isPruningCurrent = pruneIndex === currentIdx;

      if (isPruningCurrent && typeof onPruneActive === "function") {
        await onPruneActive(candidate, pruneIndex);
      }

      items.splice(pruneIndex, 1);
      prunedCard = candidate;

      if (pruneIndex <= currentIdx) {
        currentIdx = Math.max(0, currentIdx - 1);
        softIdx = Math.max(0, softIdx - 1);
      }
    }
  }

  items.push(...freshItems);

  return {
    items,
    currentIndex: currentIdx,
    softIndex: softIdx,
    prunedCard,
  };
}

test("getPruneCandidateIndex: bảo vệ ảnh Desktop đang active (bỏ qua index 0 nếu là ảnh desktop)", () => {
  const items = [{ id: "card_applied" }, { id: "card_2" }, { id: "card_3" }];
  const pruneIdx = getPruneCandidateIndex(items, "card_applied");
  assert.equal(
    pruneIdx,
    1,
    "Thẻ index 0 là ảnh Desktop nên ứng viên bị cắt phải là index 1",
  );
});

test("getPruneCandidateIndex: trả về 0 nếu ảnh Desktop không nằm ở index 0", () => {
  const items = [{ id: "card_1" }, { id: "card_applied" }, { id: "card_3" }];
  const pruneIdx = getPruneCandidateIndex(items, "card_applied");
  assert.equal(
    pruneIdx,
    0,
    "Ảnh desktop ở vị trí khác thì thẻ số 0 cũ nhất bị cắt",
  );
});

test("requestMore: xoay vòng FIFO tĩnh lặng khi người dùng không đứng ở thẻ bị cắt", async () => {
  const items = [{ id: "card_1" }, { id: "card_2" }, { id: "card_3" }];
  let animatedCalled = false;

  const result = await simulateRequestMore({
    items: [...items],
    currentIndex: 2, // Người dùng đang đứng ở thẻ số 3 (index 2)
    cap: 3,
    appliedId: "some_other_wall",
    freshItems: [{ id: "card_new" }],
    onPruneActive: async () => {
      animatedCalled = true;
    },
  });

  assert.equal(
    animatedCalled,
    false,
    "Không kích hoạt animation vì người dùng không nhìn thẻ bị cắt",
  );
  assert.equal(
    result.items.length,
    3,
    "Tổng số thẻ phải được giữ nguyên bằng maxCards (3)",
  );
  assert.deepEqual(
    result.items.map((c) => c.id),
    ["card_2", "card_3", "card_new"],
    "Thẻ card_1 cũ nhất bị loại bỏ, card_new được chèn vào cuối",
  );
  assert.equal(
    result.currentIndex,
    1,
    "currentIndex phải lùi 1 nấc để giữ nguyên thẻ card_3 trước mắt người dùng",
  );
});

test("requestMore: kích hoạt onPruneActive khi người dùng đang đứng đúng tại thẻ bị cắt", async () => {
  const items = [{ id: "card_1" }, { id: "card_2" }, { id: "card_3" }];
  let animatedCardId = null;

  const result = await simulateRequestMore({
    items: [...items],
    currentIndex: 0, // Người dùng đang đứng ngay tại thẻ số 1 (index 0)
    cap: 3,
    appliedId: "card_applied",
    freshItems: [{ id: "card_fresh" }],
    onPruneActive: async (card) => {
      animatedCardId = card.id;
    },
  });

  assert.equal(
    animatedCardId,
    "card_1",
    "Phải kích hoạt animation xóa cho đúng thẻ card_1",
  );
  assert.equal(
    result.currentIndex,
    0,
    "currentIndex vẫn ở 0 (nhưng giờ trỏ vào card_2 cũ)",
  );
  assert.equal(result.items[0].id, "card_2");
  assert.equal(result.items[2].id, "card_fresh");
});

test("requestMore: bỏ ảnh trùng ID với dải hiện có và trùng ngay trong cùng batch", async () => {
  const items = [{ id: "card_1" }, { id: "card_2" }];

  const freshWithDuplicates = [
    { id: "card_2" }, // đã có trên dải
    { id: "card_3" }, // mới
    { id: "card_3" }, // lặp lại ngay trong batch
    { id: "card_4" }, // mới
  ];

  // Cùng phép lọc mà `DataControl.requestMore()` chạy trước khi nối vào dải.
  const existingIds = new Set(items.map((c) => String(c.id)));
  const uniqueFresh = freshWithDuplicates.filter((c) => {
    const key = String(c.id);
    if (existingIds.has(key)) return false;
    existingIds.add(key);
    return true;
  });

  assert.deepEqual(
    uniqueFresh.map((c) => c.id),
    ["card_3", "card_4"],
    "Mỗi id chỉ được vào dải một lần, kể cả khi batch tự lặp",
  );
});
