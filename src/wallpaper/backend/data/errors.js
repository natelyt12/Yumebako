/**
 * errors.js
 * ---------------------------------------------------------------------------
 * Cách nói một lỗi mạng cho người dùng.
 *
 * `fetch()` hỏng vì mất mạng, DNS sai hay CORS bị chặn đều ném ra đúng một
 * câu của trình duyệt — `TypeError: Failed to fetch` — câu đó không nói được
 * nguyên nhân và không dịch được. Mọi chỗ hiện thông báo cho người dùng đều đi
 * qua đây, để một lần mất mạng luôn đọc ra cùng một câu.
 *
 * File này cố tình không import gì: nó là phần duy nhất của đường báo lỗi chạy
 * được bằng Node, nên `t` của i18n được truyền vào chứ không import.
 */

/** Lỗi mạng do pipeline ảnh chủ động ném ra (xem `RemoteSource`). */
export class NetworkError extends Error {
    /**
     * @param {unknown} [cause] - Lỗi gốc, giữ lại để debug.
     */
    constructor(cause) {
        super("Network request failed");
        this.name = "NetworkError";
        this.cause = cause;
    }
}

/**
 * `true` nếu lỗi thuộc loại "có mạng trở lại thì thử lại được".
 *
 * `fetch()` không có phản hồi (offline, DNS, CORS bị chặn) đều ném `TypeError`
 * với đúng một câu đặc trưng của từng trình duyệt — Chrome "Failed to fetch",
 * Firefox "NetworkError when attempting to fetch resource", Safari "Load failed"
 * — nên nhận diện theo câu đó. Cố tình KHÔNG coi mọi `TypeError` là lỗi mạng:
 * một lỗi lập trình cũng là `TypeError`, và giấu nó sau câu "kiểm tra kết nối"
 * là chỉ đường sai cho người dùng.
 *
 * @param {unknown} error
 * @returns {boolean}
 */
export function isNetworkError(error) {
    if (error instanceof NetworkError) return true;
    return /failed to fetch|network ?error|load failed|internet disconnected/i.test(
        String(error?.message || ""),
    );
}

/**
 * Câu hiển thị cho người dùng từ một lỗi bất kỳ.
 *
 * @param {unknown} error
 * @param {(key: string, fallback?: string) => string} translate - `t` của i18n.
 * @returns {string} Chuỗi rỗng khi lỗi không có thông điệp nào — nơi gọi tự có
 *   câu dự phòng của nó.
 */
export function describeFetchError(error, translate) {
    if (isNetworkError(error)) {
        return translate("sp.api.network_error", "Failed to fetch, check your connection");
    }
    return String(error?.message || "");
}
