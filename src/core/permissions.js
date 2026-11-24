import { EventBus } from "./eventBus.js";
import { EVENTS } from "./events.js";

/**
 * Standardized status codes returned by permission checks and requests.
 * @readonly
 * @enum {string}
 */
export const PERMISSION_STATUS = Object.freeze({
    GRANTED: "granted",
    DENIED: "denied",
    MISSING: "missing",
    UNSUPPORTED: "unsupported",
    ERROR: "error",
});

/**
 * @typedef {Object} PermissionQuery
 * @property {string[]} [permissions] - Chrome extension API permissions (e.g. "bookmarks", "tabs").
 * @property {string[]} [origins] - Host permission match patterns (e.g. "https://api.github.com/*").
 */

/**
 * @typedef {Object} PermissionResult
 * @property {boolean} granted - Whether the requested or checked permissions are granted.
 * @property {string} status - One of PERMISSION_STATUS values.
 * @property {string} source - Caller or widget identifier for UI diagnostics.
 * @property {PermissionQuery} query - Normalized permission query object.
 * @property {Error|null} [error] - Caught error instance if an exception occurred.
 * @property {string} [message] - Diagnostic message describing the failure or state.
 */

/**
 * @typedef {Object} GuardedActionResult
 * @property {boolean} ok - True when permissions are granted and the action completed without throwing.
 * @property {PermissionResult} permission - Result of the underlying permission check or request.
 * @property {any} data - Return value of the guarded action, or null on failure.
 * @property {Error|null} error - Caught error from either permission handling or action execution.
 */

let listenersAttached = false;

/**
 * Normalize a permission query into deduplicated arrays so Chrome API calls
 * and event payloads share a predictable shape.
 * @param {PermissionQuery} [query]
 * @returns {PermissionQuery}
 */
function normalizeQuery(query = {}) {
    const permissions = Array.isArray(query?.permissions)
        ? [...new Set(query.permissions.filter((p) => typeof p === "string" && p.trim()))]
        : [];
    const origins = Array.isArray(query?.origins)
        ? [...new Set(query.origins.filter((o) => typeof o === "string" && o.trim()))]
        : [];

    const normalized = {};
    if (permissions.length > 0) normalized.permissions = permissions;
    if (origins.length > 0) normalized.origins = origins;
    return normalized;
}

/**
 * Check whether the Chrome extension permissions API is available in the current runtime.
 * Returns false in plain web / Vite dev previews.
 * @returns {boolean}
 */
export function isPermissionApiAvailable() {
    return (
        typeof chrome !== "undefined" &&
        typeof chrome?.permissions?.contains === "function" &&
        typeof chrome?.permissions?.request === "function"
    );
}

/**
 * Attach global Chrome permission change listeners once so widgets and UI
 * stay synchronized when permissions are granted or revoked externally.
 */
export function initPermissionListeners() {
    if (listenersAttached || typeof chrome === "undefined" || !chrome?.permissions) {
        return;
    }

    if (typeof chrome.permissions.onAdded?.addListener === "function") {
        chrome.permissions.onAdded.addListener((added) => {
            EventBus.emit(
                EVENTS.PERMISSION_CHANGED,
                { action: "added", query: normalizeQuery(added) },
                "PermissionManager"
            );
        });
    }

    if (typeof chrome.permissions.onRemoved?.addListener === "function") {
        chrome.permissions.onRemoved.addListener((removed) => {
            EventBus.emit(
                EVENTS.PERMISSION_CHANGED,
                { action: "removed", query: normalizeQuery(removed) },
                "PermissionManager"
            );
        });
    }

    listenersAttached = true;
}

/**
 * Emit a standardized permission event on the global EventBus when DOM is available.
 * @param {string} eventName
 * @param {Object} payload
 */
function emitPermissionEvent(eventName, payload) {
    if (typeof document === "undefined") return;
    EventBus.emit(eventName, payload, payload.source || "PermissionManager");
}

/**
 * Build a standardized PermissionResult and optionally notify the UI.
 * @param {Object} params
 * @returns {PermissionResult}
 */
function createResult({
    granted,
    status,
    source = "unknown",
    query,
    error = null,
    message = "",
    notifyEvent = null,
}) {
    const result = {
        granted,
        status,
        source,
        query,
        error,
        message,
    };

    if (notifyEvent) {
        emitPermissionEvent(notifyEvent, result);
    }

    return result;
}

/**
 * Check whether the extension currently holds the specified permissions.
 * Never throws; returns a structured result and optionally notifies the UI if missing/unsupported.
 *
 * @param {PermissionQuery} query - Permissions and/or origins to check.
 * @param {Object} [options]
 * @param {string} [options.source="unknown"] - Caller/widget identifier.
 * @param {boolean} [options.notifyOnMissing=false] - Emit PERMISSION_REQUIRED when not granted.
 * @param {boolean} [options.notifyOnUnsupported=false] - Emit PERMISSION_ERROR when API is unavailable.
 * @returns {Promise<PermissionResult>}
 */
export async function hasPermission(query, options = {}) {
    const {
        source = "unknown",
        notifyOnMissing = false,
        notifyOnUnsupported = false,
    } = options;

    initPermissionListeners();
    const normalized = normalizeQuery(query);

    if (!isPermissionApiAvailable()) {
        return createResult({
            granted: false,
            status: PERMISSION_STATUS.UNSUPPORTED,
            source,
            query: normalized,
            message: "Extension permissions API is unavailable in this environment.",
            notifyEvent: notifyOnUnsupported ? EVENTS.PERMISSION_ERROR : null,
        });
    }

    try {
        const granted = await chrome.permissions.contains(normalized);
        return createResult({
            granted: Boolean(granted),
            status: granted ? PERMISSION_STATUS.GRANTED : PERMISSION_STATUS.MISSING,
            source,
            query: normalized,
            notifyEvent: !granted && notifyOnMissing ? EVENTS.PERMISSION_REQUIRED : null,
        });
    } catch (error) {
        return createResult({
            granted: false,
            status: PERMISSION_STATUS.ERROR,
            source,
            query: normalized,
            error,
            message: error?.message || "Failed to check extension permissions.",
            notifyEvent: EVENTS.PERMISSION_ERROR,
        });
    }
}

/**
 * Request optional permissions from the browser.
 * Note: Chrome MV3 requires this to be invoked directly from a user gesture (e.g., click).
 *
 * @param {PermissionQuery} query - Optional permissions and/or origins to request.
 * @param {Object} [options]
 * @param {string} [options.source="unknown"] - Caller/widget identifier.
 * @param {boolean} [options.notifyOnDeny=true] - Emit PERMISSION_REQUIRED if the user declines.
 * @param {boolean} [options.notifyOnError=true] - Emit PERMISSION_ERROR on runtime/API failure.
 * @returns {Promise<PermissionResult>}
 */
export async function requestPermission(query, options = {}) {
    const {
        source = "unknown",
        notifyOnDeny = true,
        notifyOnError = true,
    } = options;

    initPermissionListeners();
    const normalized = normalizeQuery(query);

    if (!isPermissionApiAvailable()) {
        return createResult({
            granted: false,
            status: PERMISSION_STATUS.UNSUPPORTED,
            source,
            query: normalized,
            message: "Extension permissions API is unavailable in this environment.",
            notifyEvent: notifyOnError ? EVENTS.PERMISSION_ERROR : null,
        });
    }

    try {
        const granted = await chrome.permissions.request(normalized);
        if (granted) {
            return createResult({
                granted: true,
                status: PERMISSION_STATUS.GRANTED,
                source,
                query: normalized,
            });
        }

        return createResult({
            granted: false,
            status: PERMISSION_STATUS.DENIED,
            source,
            query: normalized,
            message: "User declined the permission request.",
            notifyEvent: notifyOnDeny ? EVENTS.PERMISSION_REQUIRED : null,
        });
    } catch (error) {
        return createResult({
            granted: false,
            status: PERMISSION_STATUS.ERROR,
            source,
            query: normalized,
            error,
            message: error?.message || "Failed to request extension permissions.",
            notifyEvent: notifyOnError ? EVENTS.PERMISSION_ERROR : null,
        });
    }
}

/**
 * Revoke previously granted optional permissions.
 *
 * @param {PermissionQuery} query - Optional permissions and/or origins to remove.
 * @param {Object} [options]
 * @param {string} [options.source="unknown"] - Caller/widget identifier.
 * @returns {Promise<{ removed: boolean, status: string, source: string, query: PermissionQuery, error: Error|null, message: string }>}
 */
export async function removePermission(query, options = {}) {
    const { source = "unknown" } = options;
    const normalized = normalizeQuery(query);

    if (typeof chrome === "undefined" || typeof chrome?.permissions?.remove !== "function") {
        return {
            removed: false,
            status: PERMISSION_STATUS.UNSUPPORTED,
            source,
            query: normalized,
            error: null,
            message: "Extension permissions API is unavailable in this environment.",
        };
    }

    try {
        const removed = await chrome.permissions.remove(normalized);
        return {
            removed: Boolean(removed),
            status: removed ? PERMISSION_STATUS.MISSING : PERMISSION_STATUS.ERROR,
            source,
            query: normalized,
            error: null,
            message: removed ? "" : "Could not revoke the specified permissions.",
        };
    } catch (error) {
        emitPermissionEvent(EVENTS.PERMISSION_ERROR, {
            granted: false,
            status: PERMISSION_STATUS.ERROR,
            source,
            query: normalized,
            error,
            message: error?.message || "Failed to remove extension permissions.",
        });
        return {
            removed: false,
            status: PERMISSION_STATUS.ERROR,
            source,
            query: normalized,
            error,
            message: error?.message || "Failed to remove extension permissions.",
        };
    }
}

/**
 * Guard a UI or widget action behind a permission check (and optional prompt).
 * Catches both permission failures and action runtime errors, emitting UI notifications
 * instead of letting unhandled exceptions break the caller.
 *
 * @param {PermissionQuery} query - Required permissions and/or origins.
 * @param {Function} action - Async or sync callback to execute when permissions are granted.
 * @param {Object} [options]
 * @param {string} [options.source="unknown"] - Caller/widget identifier.
 * @param {boolean} [options.autoRequest=false] - Request permission if missing (only use inside a user gesture).
 * @param {boolean} [options.notifyOnMissing=true] - Emit PERMISSION_REQUIRED when permission is missing.
 * @param {boolean} [options.notifyOnError=true] - Emit PERMISSION_ERROR when permission or action throws.
 * @returns {Promise<GuardedActionResult>}
 */
export async function withPermission(query, action, options = {}) {
    const {
        source = "unknown",
        autoRequest = false,
        notifyOnMissing = true,
        notifyOnError = true,
    } = options;

    let permission = await hasPermission(query, {
        source,
        notifyOnMissing: !autoRequest && notifyOnMissing,
        notifyOnUnsupported: notifyOnError,
    });

    if (!permission.granted && autoRequest && permission.status !== PERMISSION_STATUS.UNSUPPORTED) {
        permission = await requestPermission(query, {
            source,
            notifyOnDeny: notifyOnMissing,
            notifyOnError,
        });
    }

    if (!permission.granted) {
        return {
            ok: false,
            permission,
            data: null,
            error: permission.error || null,
        };
    }

    try {
        const data = await action();
        return {
            ok: true,
            permission,
            data,
            error: null,
        };
    } catch (error) {
        if (notifyOnError) {
            emitPermissionEvent(EVENTS.PERMISSION_ERROR, {
                granted: true,
                status: PERMISSION_STATUS.ERROR,
                source,
                query: permission.query,
                error,
                message: error?.message || "Action failed while executing with granted permissions.",
            });
        }
        return {
            ok: false,
            permission,
            data: null,
            error,
        };
    }
}
