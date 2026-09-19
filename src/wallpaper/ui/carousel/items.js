/**
 * items.js
 * ---------------------------------------------------------------------------
 * Mô hình dữ liệu mà động cơ carousel hiểu.
 *
 * Hai loại phần tử:
 *   - Thẻ ảnh  : `{ id, name, sub, url }` — `url` đã là ảnh hiển thị được.
 *     Video cũng chỉ là một tấm thumbnail, nên không có nhánh media riêng.
 *   - Thẻ hành động: `{ isAddCard: true, name, subLabel, loadingText, icon }`
 *     — "ô trống" ở cuối dải, cắm một handler vào để lấy thêm nội dung.
 *
 * Tầng này không biết gì về store/source; việc ánh xạ từ card của store sang
 * item là của adapter (xem `WallpaperSwitcher`).
 */

/** Ảnh thay thế khi thẻ chưa có thumbnail dùng được. */
export const FALLBACK_THUMBNAIL = "/image/fallback.jpg";

/** Cấu hình mặc định cho thẻ hành động, khi owner không truyền gì. */
export const DEFAULT_ACTION_ITEM = Object.freeze({
  name: "Lấy ảnh mới",
  subLabel: "Thêm mới",
  loadingText: "Đang tải ảnh...",
  icon: null,
});

/** `true` nếu item là thẻ hành động (ô "lấy thêm"). */
export function isActionItem(item) {
  return Boolean(item && item.isAddCard);
}

/**
 * Dựng thẻ hành động. `icon` nhận thẳng chuỗi `<svg>…</svg>`; để trống thì
 * template dùng dấu cộng mặc định.
 */
export function createActionItem(overrides = {}) {
  return {
    id: overrides.id || `action:${Date.now()}`,
    isAddCard: true,
    name: overrides.name || overrides.label || DEFAULT_ACTION_ITEM.name,
    subLabel: overrides.subLabel || DEFAULT_ACTION_ITEM.subLabel,
    loadingText: overrides.loadingText || DEFAULT_ACTION_ITEM.loadingText,
    icon: overrides.icon ?? DEFAULT_ACTION_ITEM.icon,
  };
}

/**
 * Ảnh sẽ vẽ lên thẻ. Ưu tiên thumbnail (nhẹ, đã sinh sẵn) rồi mới tới media gốc.
 */
export function resolveImageUrl(item) {
  if (!item) return FALLBACK_THUMBNAIL;
  return item.thumbnailUrl || item.image || item.url || FALLBACK_THUMBNAIL;
}

/**
 * Escape text trước khi nhét vào `innerHTML`. Tên wallpaper đến từ API ngoài
 * nên có thể chứa `<`, `&`… — không escape thì một tiêu đề xấu sẽ phá DOM thẻ.
 */
export function escapeHtml(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (char) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[char],
  );
}
