import { PROVIDER_REGISTRY } from "./registry.js";
import { getSettings, saveSettings, subscribe } from "/src/core/storageHandler.js";
import { showNotification } from "/src/core/ui.js";
import { renderIcons } from "/src/core/icon.js";
import { t } from "/src/core/i18n.js";
import { applyOnloadAnimation } from "/src/wallpaper/onload/index.js";
import { toggleBgEditorVisibility, applyWallpaperPosition } from "/src/wallpaper/bgEditor.js";
import { applyWallpaperFilters } from "/src/wallpaper/filter.js";
import { addToCollection, getCollection } from "./impl/collection/collectionDb.js";
import { generateImageThumbnail, generateVideoThumbnail } from "/src/core/utils/thumbnailGenerator.js";
import { setDropdownValue } from "/src/core/ui/dropdown.js";

class ProviderManager {
    constructor() {
        this.providers = {};
        this.activeProvider = null;
        this.globalUI = null;
        this.isTransitioning = false;
        this.hasActiveBackground = false;
        this.currentBlobUrl = null;
        this.currentType = null;
        this.isSubscribed = false;
    }

    /**
     * Boot the background provider system on startup.
     */
    async boot() {
        await this.initBackgroundUI();

        applyWallpaperPosition();
        applyWallpaperFilters();

        const settings = getSettings();
        const config = settings.wallpaperConfig || {};
        let source = config.source || "wallhaven";

        await this.switchProvider(source, true);
    }

    /**
     * Directly apply a Collection item as background.
     */
    async applyCollectionItem(item, firstRun = false) {
        if (!item?.blob) return;

        const settings = getSettings();
        if (!settings.wallpaperConfig) settings.wallpaperConfig = {};
        settings.wallpaperConfig.activeCollectionItemId = item.id;
        settings.wallpaperConfig.source = "collection";
        saveSettings({ wallpaperConfig: settings.wallpaperConfig });

        await this.switchProvider("collection", firstRun);
    }

    /**
     * Initialize all provider instances and bind UI elements.
     */
    async initBackgroundUI() {
        this.globalUI = {
            bg: document.querySelector(".image"),
            video: document.querySelector(".video"),
            overlay: document.querySelector(".overlay"),
        };

        // Instantiate providers if not created
        if (Object.keys(this.providers).length === 0) {
            const initPromises = [];
            for (const [key, ProviderClass] of Object.entries(PROVIDER_REGISTRY)) {
                this.providers[key] = new ProviderClass();
                initPromises.push(this.providers[key].init());
            }
            await Promise.all(initPromises);
        }

        // Lắng nghe sự kiện thay đổi cài đặt
        this.setupSettingsSubscription();

        // Overlay opacity should remain 1 at startup to prevent raw image flash

        // Synchronize DOM elements (useful for dynamically injected thumbnails)
        this.syncDOMBackgrounds();
    }

    /**
     * Bind UI elements that are dynamically injected when Settings menu opens.
     * Called by settingHandler.js
     */
    bindSettingsUI() {
        if (!this.globalUI) return;

        this.globalUI.loading = document.querySelector(".loading");
        this.globalUI.APIName = document.getElementById("api_name");
        this.globalUI.arrange_wallpaper = document.getElementById("arrange_wallpaper");
        this.globalUI.apiConfigSection = document.getElementById("api_config");
        this.globalUI.API_selector = document.getElementById("API_selector");

        this.globalUI.provider_info_tooltip = document.getElementById("provider_info_tooltip");
        this.globalUI.provider_changewall = document.getElementById("provider_changewall");
        this.globalUI.provider_source = document.getElementById("provider_source");
        this.globalUI.provider_download = document.getElementById("provider_download");
        this.globalUI.provider_add_to_collection = document.getElementById("provider_add_to_collection");
        this.globalUI.provider_extra_settings = document.getElementById("provider_extra_settings");

        this.setupOuterMenuEvents();

        if (this.globalUI.apiConfigSection) {
            renderIcons(this.globalUI.apiConfigSection);
        }

        // Restore active provider UI states
        if (this.activeProvider) {
            if (this.globalUI.API_selector) {
                setDropdownValue(this.globalUI.API_selector, this.activeProvider.id);
            }

            if (this.globalUI.APIName) {
                this.globalUI.APIName.innerText = this.activeProvider.name;
            }

            this.updateMenuUI();
            this.updateMetadataUI();
        }
    }

    /**
     * Bind click handlers to Outer Menu buttons.
     */
    setupOuterMenuEvents() {
        if (!this.globalUI) return;

        this.globalUI.provider_changewall?.addEventListener("mousedown", () => {
            this.changeWallpaper({ refresh: true });
        });

        this.globalUI.provider_source?.addEventListener("mousedown", () => {
            this.activeProvider?.viewSource();
        });

        this.globalUI.provider_download?.addEventListener("mousedown", () => {
            this.activeProvider?.download();
        });

        this.globalUI.provider_add_to_collection?.addEventListener("mousedown", async () => {
            await this.handleAddToCollection();
        });

        this.globalUI.provider_extra_settings?.addEventListener("mousedown", () => {
            this.handleOpenExtraSettings();
        });
    }

    /**
     * Subscribe to wallpaperConfig settings changes.
     */
    setupSettingsSubscription() {
        if (this.isSubscribed) return;
        this.isSubscribed = true;
        let isInitialTrigger = true;

        document.addEventListener("dropdownChange", async (event) => {
            const { id, value } = event.detail;

            if (id === "API_selector") {
                const current = getSettings().wallpaperConfig || {};
                if (current.source !== value) {
                    saveSettings({ wallpaperConfig: { ...current, source: value } });
                }
            }
        });

        subscribe("wallpaperConfig", async (newConfig) => {
            if (isInitialTrigger) {
                isInitialTrigger = false;
                return; // Prevent race condition with loadInitialBackground's switchProvider(..., true)
            }
            if (!this.globalUI) return;
            const source = newConfig?.source || "wallhaven";

            if (this.providers[source] && (!this.activeProvider || this.activeProvider.id !== source)) {
                await this.switchProvider(source, false);
            }
        });
    }

    /**
     * Switch current provider to target source.
     * @param {string} sourceId
     * @param {boolean} [firstRun=false]
     */
    async switchProvider(sourceId, firstRun = false) {
        if (this.isTransitioning) return;
        this.isTransitioning = true;

        let targetProvider = this.providers[sourceId];
        if (!targetProvider) {
            targetProvider = this.providers["wallhaven"] || this.providers["collection"];
            sourceId = targetProvider.id;
        }

        this.activeProvider = targetProvider;

        // Update UI Selector
        if (this.globalUI?.API_selector) {
            setDropdownValue(this.globalUI.API_selector, sourceId);
        }

        if (this.globalUI?.APIName) {
            this.globalUI.APIName.innerText = targetProvider.name;
        }

        toggleBgEditorVisibility(true);

        // Show/hide Outer Menu buttons based on provider capability flags
        this.updateMenuUI();

        // Perform initial fetch for the provider
        await this.changeWallpaper({ refresh: false, firstRun });

        this.isTransitioning = false;
        this._collectionFetchToken = Symbol();
    }

    /**
     * Updates outer menu button visibility and disabled states based on active provider capability flags and lock state.
     * 
     * @param {boolean} [locked=false] - Flag indicating whether the system is busy loading/transitioning wallpaper.
     */
    updateMenuUI(locked = false) {
        const ui = this.globalUI;
        const p = this.activeProvider;
        if (!ui || !p) return;

        // Global states: loading indicator and source selector dropdown
        if (ui.loading) ui.loading.style.opacity = locked ? 1 : 0;
        if (ui.API_selector) ui.API_selector.disabled = locked;
        if (ui.apiConfigSection) ui.apiConfigSection.style.display = "block";

        /**
         * Helper to set button visibility and disabled state.
         * @param {HTMLElement|null} el - The button element to update
         * @param {boolean} isVisible - Whether the button should be displayed
         * @param {boolean} [isDisabled=locked] - Disabled state (defaults to locked)
         */
        const setBtnState = (el, isVisible, isDisabled = locked) => {
            if (!el) return;
            el.style.display = isVisible ? "flex" : "none";
            el.disabled = isDisabled;
        };

        // Standard action buttons based on activeProvider flags
        setBtnState(ui.provider_changewall, p.showChangewallButton);
        setBtnState(ui.provider_source, p.showSourceButton, locked || !p.canViewSource);
        setBtnState(ui.provider_download, p.showDownloadButton);
        setBtnState(ui.provider_extra_settings, p.showExtraSettingsButton);

        // 'Add to collection' button (requires checking if the wallpaper is already saved)
        if (ui.provider_add_to_collection) {
            const isSaved = !locked && !!this.currentIsSaved;
            setBtnState(ui.provider_add_to_collection, p.showAddToCollectionButton, locked || isSaved);
            ui.provider_add_to_collection.title = isSaved ? t("sp.api.collection.already_saved", "Ảnh này đã có trong bộ sưu tập") : "";
            ui.provider_add_to_collection.style.opacity = (locked || isSaved) ? "0.5" : "";
        }

        // Dynamic icon & label for the Extra Settings button (Collection uses a distinct icon, others use settings gear)
        if (ui.provider_extra_settings) {
            const isCollection = p.id === "collection";
            const icon = ui.provider_extra_settings.querySelector("i:first-of-type, i[data-icon]");
            const span = ui.provider_extra_settings.querySelector("span[data-i18n]");

            if (icon) icon.setAttribute("data-icon", isCollection ? "manageCollection" : "settings");
            if (span) {
                const i18nKey = isCollection ? "sp.api.collection.title" : "sp.api.common.extra_settings";
                const fallbackText = isCollection ? "Quản lý Bộ sưu tập" : "Cài đặt bổ sung";
                span.setAttribute("data-i18n", i18nKey);
                span.innerText = t(i18nKey, fallbackText);
            }
            if (typeof renderIcons === "function") {
                renderIcons(ui.provider_extra_settings);
            }
        }
    }

    /**
     * Change wallpaper via active provider fetch.
     * Implements smart fallback logic.
     * @param {{ refresh?: boolean, firstRun?: boolean }} options
     */
    async changeWallpaper(options = {}) {
        const { refresh = false, firstRun = false } = options;
        if (!this.activeProvider) return;

        this.updateMenuUI(true);
        if (!firstRun && this.globalUI?.overlay) {
            this.globalUI.overlay.style.opacity = 1;

            // Fade out any secondary backgrounds (like thumbnails) before changing
            document.querySelectorAll(".image, .video").forEach(el => {
                if (el !== this.globalUI.bg && el !== this.globalUI.video) {
                    el.style.transition = "opacity 0.3s ease-in-out";
                    el.style.opacity = 0;
                }
            });

            await new Promise((r) => setTimeout(r, 400));
        }

        try {
            const data = await this.activeProvider.fetch({ refresh, firstRun });
            await this.applyPayload(data, firstRun);
            this.hasActiveBackground = true;

            await this._syncCollectionState();
            this.updateMetadataUI();
        } catch (error) {
            console.error(`[ProviderManager] Fetch error from [${this.activeProvider.id}]:`, error);
            const detailMsg = error?.message || (typeof error === "string" ? error : "");
            const providerName = this.activeProvider?.name || this.activeProvider?.id || "";
            const msg = detailMsg ? `${providerName}: ${detailMsg}` : t("sp.api.error", { provider: providerName });
            showNotification(msg, "error");

            if (this.globalUI?.provider_info_tooltip) {
                this.globalUI.provider_info_tooltip.innerHTML = msg;
            }

            // Smart Fallback Rule:
            // If we already have an active background, fade overlay back out & keep current image!
            // If NO active background (first run failed), fallback to Collection.
            if (this.hasActiveBackground && !firstRun) {
                if (this.globalUI?.overlay) {
                    this.globalUI.overlay.style.opacity = 0;
                }
            } else {
                console.warn("[ProviderManager] First run failed or no background active; falling back to Collection");
                if (this.activeProvider.id !== "collection" && this.providers["collection"]) {
                    this.activeProvider = this.providers["collection"];
                    const data = await this.activeProvider.fetch({ refresh: false, firstRun });
                    await this.applyPayload(data, firstRun);
                    this.hasActiveBackground = true;
                    await this._syncCollectionState();
                    this.updateMetadataUI();
                }
            }
        } finally {
            this.updateMenuUI(false);

            // Fade in any secondary backgrounds (like thumbnails) after changing
            if (!firstRun) {
                document.querySelectorAll(".image, .video").forEach(el => {
                    if (el !== this.globalUI.bg && el !== this.globalUI.video) {
                        el.style.opacity = 1;
                    }
                });
            }
        }
    }

    /**
     * Apply wallpaper data payload to DOM (.image or .video layer).
     * @param {Object} data
     * @param {boolean} firstRun
     */
    async applyPayload(data, firstRun = false) {
        const ui = this.globalUI;
        if (!ui) return;

        const oldBlob = this.currentBlobUrl;
        let newBlobUrl = null;

        if (!data) {
            console.error("Invalid wallpaper data", data);
            return;
        }

        this.currentType = data.type;

        if (data.blob) {
            newBlobUrl = URL.createObjectURL(data.blob);
            this.currentBlobUrl = newBlobUrl;
        }

        if (data.type === "video") {
            document.querySelectorAll(".video").forEach((v) => {
                v.style.display = "block";
                if (newBlobUrl) {
                    v.src = newBlobUrl;
                    v.play().catch(() => { });
                }
            });
            document.querySelectorAll(".image").forEach((img) => {
                img.style.display = "";
                img.style.backgroundImage = "none";
                img.style.backgroundColor = "";
            });
        } else {
            document.querySelectorAll(".video").forEach((v) => {
                v.style.display = "none";
                v.pause();
                v.removeAttribute("src");
            });
            document.querySelectorAll(".image").forEach((img) => {
                img.style.display = "";
                img.style.backgroundColor = "";
                if (newBlobUrl) {
                    img.style.backgroundImage = `url(${newBlobUrl})`;
                } else {
                    img.style.backgroundImage = "none";
                }
            });
        }

        if (oldBlob && oldBlob !== newBlobUrl) {
            URL.revokeObjectURL(oldBlob);
        }

        if (firstRun) {
            if (data.type !== "video" && newBlobUrl) {
                const tempImg = new Image();
                tempImg.onload = () => {
                    applyOnloadAnimation();
                };
                tempImg.onerror = () => {
                    applyOnloadAnimation();
                };
                tempImg.src = newBlobUrl;
            } else {
                applyOnloadAnimation();
            }
        } else if (ui.overlay) {
            ui.overlay.style.opacity = 0;
        }
    }



    /**
     * Synchronizes the active background state to all .image and .video elements in the DOM.
     * Useful when new background elements (like thumbnails) are dynamically injected.
     */
    syncDOMBackgrounds() {
        if (!this.hasActiveBackground) return;

        if (this.currentBlobUrl) {
            if (this.currentType === "video") {
                document.querySelectorAll(".video").forEach((v) => {
                    v.style.display = "block";
                    if (v.src !== this.currentBlobUrl) {
                        v.src = this.currentBlobUrl;
                        v.play().catch(() => { });
                    }
                });
                document.querySelectorAll(".image").forEach((img) => {
                    img.style.display = "";
                    img.style.backgroundImage = "none";
                    img.style.backgroundColor = "";
                });
            } else {
                document.querySelectorAll(".video").forEach((v) => {
                    v.style.display = "none";
                    v.pause();
                    v.removeAttribute("src");
                });
                document.querySelectorAll(".image").forEach((img) => {
                    img.style.display = "";
                    img.style.backgroundColor = "";
                    if (!img.style.backgroundImage || !img.style.backgroundImage.includes(this.currentBlobUrl)) {
                        img.style.backgroundImage = `url(${this.currentBlobUrl})`;
                    }
                });
            }
        }
    }

    updateMetadataUI() {
        if (!this.globalUI || !this.activeProvider) return;
        const tooltip = this.activeProvider.getMetadataTooltip();
        if (this.globalUI.provider_info_tooltip) {
            this.globalUI.provider_info_tooltip.innerHTML = tooltip;
        }
        this.updateMenuUI();
    }

    async _syncCollectionState() {
        this.currentIsSaved = false;
        if (!this.activeProvider || !this.activeProvider.showAddToCollectionButton) return;

        const itemData = this.activeProvider.getCollectionItemData();
        if (itemData?.metadata?.source) {
            const collection = await getCollection();
            this.currentIsSaved = collection.some(i => i.metadata?.source === itemData.metadata.source);
        }
    }

    /**
     * Handle "Thêm vào bộ sưu tập" action.
     */
    async handleAddToCollection() {
        if (!this.activeProvider) return;
        const itemData = this.activeProvider.getCollectionItemData();
        if (!itemData || !itemData.blob) {
            showNotification(t("sp.api.collection.no_blob_to_add", "Không có dữ liệu ảnh để thêm vào bộ sưu tập"), "warning");
            return;
        }

        try {
            const collection = await getCollection();
            const isSaved = collection.some(i => i.metadata?.source === itemData.metadata?.source && itemData.metadata?.source);
            if (isSaved) {
                showNotification(t("sp.api.collection.already_saved", "Ảnh này đã có trong bộ sưu tập"), "info");
                return;
            }

            let thumbnail = null;
            if (itemData.type === "video" || itemData.blob.type.startsWith("video/")) {
                thumbnail = await generateVideoThumbnail(itemData.blob);
            } else {
                thumbnail = await generateImageThumbnail(itemData.blob);
            }

            await addToCollection({
                type: itemData.type,
                blob: itemData.blob,
                thumbnail: thumbnail,
                metadata: itemData.metadata,
            });

            showNotification(t("sp.api.collection.add_success", "Đã thêm vào bộ sưu tập thành công!"), "success");
            this.currentIsSaved = true;
            this.updateMenuUI(); // Refresh UI to disable the button
        } catch (err) {
            console.error("[ProviderManager] Error adding to collection:", err);
            showNotification(t("sp.api.collection.add_failed", "Không thể thêm vào bộ sưu tập"), "error");
        }
    }

    /**
     * Handle "Cài đặt bổ sung" button click by triggering activeProvider's onExtraSettingsClick.
     */
    handleOpenExtraSettings() {
        if (!this.activeProvider || !this.activeProvider.hasExtraSettings()) return;
        this.activeProvider.onExtraSettingsClick();
    }
}

export const providerManager = new ProviderManager();
