import test from "node:test";
import assert from "node:assert/strict";

import {
  NetworkError,
  describeFetchError,
  isNetworkError,
} from "../src/wallpaper/core/errors.js";

/** `t` giả: chỉ cần đủ để khẳng định câu nào được chọn. */
const translate = (key, fallback) => (key === "sp.api.network_error" ? fallback : key);

test("isNetworkError: mọi kiểu 'không có phản hồi' của fetch đều là lỗi kết nối", () => {
  // `fetch()` khi offline/DNS/CORS: TypeError "Failed to fetch" (Chrome),
  // "NetworkError when attempting to fetch resource" (Firefox),
  // "Load failed" (Safari).
  assert.equal(isNetworkError(new TypeError("Failed to fetch")), true);
  assert.equal(isNetworkError(new TypeError("Load failed")), true);
  assert.equal(isNetworkError(new Error("NetworkError when attempting to fetch resource.")), true);
  assert.equal(isNetworkError(new NetworkError()), true);
});

test("isNetworkError: lỗi HTTP, lỗi dữ liệu và lỗi lập trình không bị coi là mất kết nối", () => {
  assert.equal(isNetworkError(new Error("HTTP error! status: 404")), false);
  assert.equal(isNetworkError(new Error("Invalid Picre response")), false);
  // TypeError của một bug lập trình không được đội lốt lỗi mạng.
  assert.equal(isNetworkError(new TypeError("wallpaper is not a function")), false);
  assert.equal(isNetworkError(null), false);
  assert.equal(isNetworkError(undefined), false);
});

test("describeFetchError: lỗi mạng đọc ra câu 'kiểm tra kết nối', lỗi khác giữ nguyên", () => {
  assert.equal(
    describeFetchError(new TypeError("Failed to fetch"), translate),
    "Failed to fetch, check your connection",
  );
  assert.equal(
    describeFetchError(new NetworkError(), translate),
    "Failed to fetch, check your connection",
  );
  assert.equal(
    describeFetchError(new Error("HTTP error! status: 404"), translate),
    "HTTP error! status: 404",
  );
  assert.equal(
    describeFetchError(undefined, translate),
    "",
    "không có thông điệp thì trả chuỗi rỗng để nơi gọi dùng câu dự phòng",
  );
});
