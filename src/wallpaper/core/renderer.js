import { applyOnloadAnimation } from "/src/wallpaper/onload/index.js";
import { dataControl } from "/src/wallpaper/core/DataControl.js";
import { getSettings, subscribe } from "/src/core/storageHandler.js";

/**
 * renderer.js
 * ---------------------------------------------------------------------------
 * Handles drawing the wallpaper to the DOM (`.image` and `.video` layers).
 * Completely independent from fetching logic.
 */

const OVERLAY_FADE_MS = 400;

class WallpaperRenderer {
    constructor() {
        this.globalUI = null;
        this.hasActiveBackground = false;
        this.currentBlobUrl = null;
        this.currentType = null;
        this.currentId = null;
    }

    initUI() {
        if (this.globalUI) return;
        this.globalUI = {
            bg: document.querySelector(".image"),
            video: document.querySelector(".video"),
            overlay: document.querySelector(".overlay"),
        };
    }

    async _fadeToOverlay() {
        this.initUI();
        const overlay = this.globalUI?.overlay;
        if (!overlay) return;

        overlay.style.transition = `opacity ${OVERLAY_FADE_MS}ms var(--ease_in_out)`;
        if (Number(getComputedStyle(overlay).opacity) >= 1) return;

        overlay.style.opacity = 1;

        await new Promise((resolve) => {
            let timer = null;
            const finish = () => {
                overlay.removeEventListener("transitionend", onEnd);
                if (timer) clearTimeout(timer);
                resolve();
            };
            const onEnd = (event) => {
                if (event.target === overlay && event.propertyName === "opacity") finish();
            };

            overlay.addEventListener("transitionend", onEnd);
            timer = setTimeout(finish, OVERLAY_FADE_MS + 120);
        });
    }

    async apply(data, { firstRun = false } = {}) {
        this.initUI();
        const ui = this.globalUI;
        if (!ui) return;

        if (!data || !data.blob) {
            console.error("Invalid wallpaper data", data);
            return;
        }

        if (!firstRun && this.currentId && data.id && this.currentId === data.id) {
            return;
        }

        if (!firstRun) await this._fadeToOverlay();

        const oldBlob = this.currentBlobUrl;
        let newBlobUrl = URL.createObjectURL(data.blob);

        this.currentId = data.id || null;
        this.currentType = data.type;
        this.currentBlobUrl = newBlobUrl;
        this.hasActiveBackground = true;

        if (data.type === "video") {
            const collectionConfig = getSettings().collectionConfig || {};
            const soundEnabled = Boolean(collectionConfig.videoSound);
            const volume = Math.max(0, Math.min(1, collectionConfig.videoVolume ?? 0.5));

            document.querySelectorAll(".video").forEach((v) => {
                v.style.display = "block";
                const isBloom = v.parentElement?.classList.contains("bloom_container");
                v.muted = isBloom || !soundEnabled;
                v.volume = volume;
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
                tempImg.onload = () => applyOnloadAnimation();
                tempImg.onerror = () => applyOnloadAnimation();
                tempImg.src = newBlobUrl;
            } else {
                applyOnloadAnimation();
            }
        } else if (ui.overlay) {
            ui.overlay.style.opacity = 0;
        }
    }

    bindDataControl() {
        dataControl.on("card:hard", async ({ card, sourceId, firstRun }) => {
            if (!card) return;
            const source = dataControl.sources.get(sourceId) || dataControl.activeSource;
            if (!source) return;
            try {
                await source.apply(card, { firstRun: Boolean(firstRun) });
            } catch (err) {
                console.error("[WallpaperRenderer] Error applying wallpaper for card:", card.id, err);
            }
        });
    }
}

export const wallpaperRenderer = new WallpaperRenderer();
wallpaperRenderer.bindDataControl();

/**
 * Updates video wallpaper audio (muted state and volume level).
 * @param {Object} [config]
 */
export function updateVideoAudio(config = getSettings().collectionConfig) {
    const soundEnabled = Boolean(config?.videoSound);
    const volume = Math.max(0, Math.min(1, config?.videoVolume ?? 1));
    document.querySelectorAll(".video").forEach((v) => {
        const isBloom = v.parentElement?.classList.contains("bloom_container");
        v.muted = isBloom || !soundEnabled;
        v.volume = volume;
    });
}

subscribe("collectionConfig", (newConfig) => {
    updateVideoAudio(newConfig);
});
