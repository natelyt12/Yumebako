/**
 * items.js
 * ---------------------------------------------------------------------------
 * Mô hình dữ liệu mà động cơ carousel hiểu.
 *
 * Một loại phần tử duy nhất — thẻ ảnh `{ id, name, sub, url, card, metaLeft,
 * metaRight }`: `url` đã là ảnh hiển thị được, video cũng chỉ là một tấm
 * thumbnail nên không có nhánh media riêng.
 *
 * Tầng này không biết gì về store/source; việc ánh xạ từ card của store sang
 * item là của adapter (xem `WallpaperSwitcher`).
 */

/** Fallback image when thumbnail is missing. */
export const FALLBACK_THUMBNAIL = "/image/fallback.jpg";

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
