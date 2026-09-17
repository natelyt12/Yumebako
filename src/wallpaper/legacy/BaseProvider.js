import { t, translateDOM } from "/src/core/i18n.js";
import { openSidebarSubmenu } from "/src/core/ui/submenu.js";

/**
 * Base abstract class for all Wallpaper Providers.
 * Each provider handles fetching images/media, managing its internal settings,
 * rendering its extra settings submenu, and providing item metadata for the Collection.
 */
export class BaseProvider {
    /**
     * @param {string} id - Unique identifier for the provider (e.g. "wallhaven", "picre", "collection")
     * @param {string} name - Human readable display name or translation key
     */
    constructor(id, name) {
        this.id = id;
        this._name = name;
        this.currentData = null;
        this.currentBlobUrl = null;
        this.isDirty = false;
    }

    get name() {
        return t(`sp.api_selector.${this.id}_option`, this._name);
    }

    // ─── Capability Flags (Show/Hide Buttons in Outer Menu) ───────────────────

    get showChangewallButton() {
        return true;
    }

    get showSourceButton() {
        return Boolean(this.currentData?.source || this.currentData?.metadata?.source);
    }

    get canViewSource() {
        const src = this.currentData?.source || this.currentData?.metadata?.source;
        return Boolean(src && /^https?:\/\//i.test(src));
    }

    get showDownloadButton() {
        return Boolean(this.currentData?.blob);
    }

    get showAddToCollectionButton() {
        return Boolean(this.currentData?.blob);
    }

    get showExtraSettingsButton() {
        return this.hasExtraSettings();
    }

    // ─── Lifecycle & Operations ───────────────────────────────────────────────

    async init() {}

    async fetch(options = {}) {
        throw new Error(`fetch() must be implemented by provider [${this.id}]`);
    }

    cleanup() {
        if (this.currentBlobUrl) {
            URL.revokeObjectURL(this.currentBlobUrl);
            this.currentBlobUrl = null;
        }
    }

    viewSource() {
        const src = this.currentData?.source || this.currentData?.metadata?.source;
        if (src && /^https?:\/\//i.test(src)) {
            window.open(src, "_blank");
        }
    }

    async download() {
        if (!this.currentData?.blob) return;

        const timestamp = Date.now();
        const mime = this.currentData.blob.type;
        let ext = "jpg";
        if (mime === "image/png") ext = "png";
        else if (mime === "image/webp") ext = "webp";
        else if (mime === "image/gif") ext = "gif";
        else if (mime.startsWith("video/mp4")) ext = "mp4";
        else if (mime.startsWith("video/webm")) ext = "webm";

        const filename = `${this.id}_wallpaper_${timestamp}.${ext}`;
        const a = document.createElement("a");
        const url = URL.createObjectURL(this.currentData.blob);
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    getCollectionItemData() {
        if (!this.currentData?.blob) return null;
        return {
            blob: this.currentData.blob,
            type: this.currentData.type || "image",
            metadata: {
                provider: this.id,
                providerName: this.name,
                source: this.currentData.source || this.currentData.metadata?.source || this.id,
                url: this.currentData.image || this.currentData.url || "",
                width: this.currentData.width || this.currentData.metadata?.width,
                height: this.currentData.height || this.currentData.metadata?.height,
                size: this.currentData.blob.size,
            },
        };
    }

    getMetadataTooltip() {
        return "";
    }

    // ─── Submenu Extra Settings ───────────────────────────────────────────────

    hasExtraSettings() {
        return false;
    }

    getExtraSettingsTitle() {
        return t(`sp.api.${this.id}.title`, this.name);
    }

    get extraSettingsOptions() {
        return {};
    }

    onExtraSettingsClose() {}

    /**
     * Trigger action when Extra Settings button is clicked on Outer Menu.
     * Passes the cloned template node directly to openSidebarSubmenu.
     */
    async onExtraSettingsClick() {
        if (!this.hasExtraSettings()) return;

        const contentNode = await this.renderExtraSettings();
        if (!contentNode) return;

        translateDOM(contentNode);

        const defaultOptions = {
            canPreview: true,
            isDirty: () => this.isDirty,
            onCancel: () => this.revertSettings(),
            onBeforeClose: () => this.onExtraSettingsClose(),
        };

        openSidebarSubmenu(
            this.getExtraSettingsTitle(),
            contentNode,
            { ...defaultOptions, ...this.extraSettingsOptions }
        );
    }

    revertSettings() {
        this.isDirty = false;
    }
}
