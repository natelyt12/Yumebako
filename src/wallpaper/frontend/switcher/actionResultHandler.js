import { t } from "/src/core/i18n.js";
import { showNotification } from "/src/core/ui.js";

/**
 * Execute Layer 1 UI/DOM gestures (downloads, external links, toast notifications)
 * for headless action descriptors returned by Layer 3 `SOURCE_ACTIONS`.
 *
 * @param {string} actionId
 * @param {Object|null|undefined} result
 * @param {Object|null|undefined} [card=null]
 * @returns {void}
 */
export function handleCardActionResult(actionId, result, card = null) {
  if (!result || typeof result !== "object") return;

  if (actionId === "download") {
    if (result.ok && result.blob) {
      const url = URL.createObjectURL(result.blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = result.filename || `wallpaper_${card?.id ?? "image"}.jpg`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      return;
    }

    if (!result.ok) {
      showNotification(
        t(
          "sp.api.collection.download_error",
          "Không tìm thấy dữ liệu ảnh để tải",
        ),
        "error",
      );
    }
    return;
  }

  if (actionId === "source") {
    if (result.ok && typeof result.url === "string") {
      const trimmed = result.url.trim();
      if (/^https?:\/\//i.test(trimmed)) {
        window.open(trimmed, "_blank", "noopener,noreferrer");
      }
    }
    return;
  }

  if (actionId === "add") {
    if (result.action === "cancelled") return;

    if (result.ok) {
      if (result.action === "removed") {
        showNotification(
          t("sp.api.collection.remove_success", "Đã xóa khỏi bộ sưu tập"),
          "info",
        );
      } else if (result.action === "added") {
        showNotification(
          t(
            "sp.api.collection.add_success",
            "Đã thêm vào bộ sưu tập thành công!",
          ),
          "success",
        );
      }
      return;
    }

    if (result.reason === "no_blob") {
      showNotification(
        t(
          "sp.api.collection.no_blob_to_add",
          "Không có dữ liệu ảnh để thêm vào bộ sưu tập",
        ),
        "warning",
      );
    } else if (result.reason === "save_error") {
      showNotification(
        t("sp.api.collection.add_error", "Lỗi khi thêm vào bộ sưu tập"),
        "error",
      );
    }
  }
}
