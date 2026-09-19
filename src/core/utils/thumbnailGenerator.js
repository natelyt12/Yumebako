/**
 * Bề rộng tối đa của thumbnail sinh cục bộ.
 *
 * Thẻ carousel rộng 800 CSS px, nên trên màn HiDPI nó cần ~1600 điểm ảnh thật.
 * Mức 640 cũ chỉ bằng 40% lượng điểm ảnh cần thiết, và đó chính là lý do ảnh bìa
 * của các mục được cắt tại chỗ trông mờ hơn hẳn ảnh lấy từ API.
 */
export const THUMB_MAX_WIDTH = 1600;
/** Chất lượng JPEG của thumbnail sinh cục bộ. */
export const THUMB_QUALITY = 0.86;

/**
 * Generate a compressed JPEG thumbnail Blob for an image blob.
 * Không bao giờ phóng to: ảnh nhỏ hơn `maxWidth` được giữ nguyên kích thước.
 *
 * @param {Blob} blob
 * @param {Object} [options]
 * @param {number} [options.maxWidth=THUMB_MAX_WIDTH]
 * @param {number} [options.quality=THUMB_QUALITY]
 * @returns {Promise<Blob>}
 */
export function generateImageThumbnail(
  blob,
  { maxWidth = THUMB_MAX_WIDTH, quality = THUMB_QUALITY } = {},
) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(blob);

    img.onload = () => {
      const scale = Math.min(1, maxWidth / img.naturalWidth);
      const w = Math.round(img.naturalWidth * scale);
      const h = Math.round(img.naturalHeight * scale);

      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);

      canvas.toBlob(
        (thumbBlob) => {
          canvas.remove();
          if (thumbBlob) resolve(thumbBlob);
          else reject(new Error("Không thể tạo thumbnail ảnh"));
        },
        "image/jpeg",
        quality,
      );
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Không thể load ảnh để tạo thumbnail"));
    };

    img.src = url;
  });
}

/**
 * Generate a compressed JPEG thumbnail Blob from a video file using canvas.
 * @param {File|Blob} videoFile
 * @returns {Promise<Blob>}
 */
export function generateVideoThumbnail(videoFile) {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    const videoUrl = URL.createObjectURL(videoFile);

    const cleanup = () => {
      URL.revokeObjectURL(videoUrl);
      video.remove();
    };

    let timeoutId = setTimeout(() => {
      cleanup();
      canvas.remove();
      reject(new Error("Timeout khi tạo thumbnail video"));
    }, 10000);

    video.src = videoUrl;
    video.muted = true;
    video.playsInline = true;
    video.preload = "metadata";

    video.onloadedmetadata = () => {
      video.currentTime = 0.5;
    };

    video.onseeked = () => {
      clearTimeout(timeoutId);

      const MAX_W = 640;
      const scale = Math.min(1, MAX_W / (video.videoWidth || 640));
      canvas.width = Math.round((video.videoWidth || 640) * scale);
      canvas.height = Math.round((video.videoHeight || 360) * scale);
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      cleanup();
      canvas.toBlob(
        (thumbBlob) => {
          canvas.remove();
          if (thumbBlob) resolve(thumbBlob);
          else reject(new Error("Không thể tạo thumbnail video"));
        },
        "image/jpeg",
        0.85,
      );
    };

    video.onerror = () => {
      clearTimeout(timeoutId);
      cleanup();
      canvas.remove();
      reject(new Error("Không thể đọc video để tạo thumbnail"));
    };
  });
}

export function getImageDimensions(blob) {
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(blob);
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve({ width: 0, height: 0 });
    };
    img.src = url;
  });
}
