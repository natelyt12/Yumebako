import { applyOnloadAnimation } from "/src/wallpaper/onload/index.js";
import { dataControl } from "/src/wallpaper/core/DataControl.js";
import { getSettings, saveSettings, subscribe, getDefaultWallpaperEffects } from "/src/core/storageHandler.js";
import { applyWallpaperFilters } from "./filter.js";
import { applyWallpaperPosition } from "../bgEditor.js";

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
        this._renderToken = 0;
        this._applyToken = 0;
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
        if (!ui) return false;

        if (!data || !data.blob) {
            console.error("Invalid wallpaper data", data);
            return false;
        }

        if (!firstRun && this.currentId && data.id && this.currentId === data.id) {
            return true;
        }

        const token = ++this._renderToken;

        if (!firstRun) await this._fadeToOverlay();
        // Nếu đã có request apply mới hơn trong lúc fade overlay -> huỷ request cũ ngay
        if (token !== this._renderToken) return false;

        const oldBlob = this.currentBlobUrl;
        let newBlobUrl = URL.createObjectURL(data.blob);

        // Giải mã bất đồng bộ ngoài Main Thread để triệt tiêu hiện tượng khựng khung hình
        if (data.type !== "video" && newBlobUrl) {
            try {
                const decoder = new Image();
                decoder.src = newBlobUrl;
                if (typeof decoder.decode === "function") {
                    await decoder.decode();
                }
            } catch {
                // Fallback tự nhiên nếu giải mã gặp lỗi
            }
        }

        // Nếu trong lúc giải mã đã có một request hình nền mới hơn -> huỷ ngay bản cũ để tránh đè giao diện
        if (token !== this._renderToken) {
            URL.revokeObjectURL(newBlobUrl);
            return false;
        }

        this.currentId = data.id || null;
        this.currentType = data.type;
        this.currentBlobUrl = newBlobUrl;
        this.hasActiveBackground = true;

        // Áp dụng bộ hiệu ứng riêng của hình nền này trong lúc overlay đang che kín màn hình
        const effects = data.effects || getDefaultWallpaperEffects();
        applyWallpaperFilters(effects.filter);
        applyWallpaperPosition(effects.position);

        dataControl.isApplyingCardEffects = true;
        try {
            const currentConf = getSettings().wallpaperConfig || {};
            saveSettings({
                wallpaperPosition: effects.position,
                wallpaperConfig: {
                    ...currentConf,
                    source: dataControl.activeSourceId || currentConf.source,
                    activeWallpaperId: data.id,
                    activeCollectionItemId: dataControl.activeSourceId === "collection" ? data.id : currentConf.activeCollectionItemId,
                    brightness: effects.filter?.brightness ?? 1,
                    contrast: effects.filter?.contrast ?? 1,
                    saturate: effects.filter?.saturate ?? 1,
                    bloom: effects.filter?.bloom ?? 0,
                    blur: effects.filter?.blur ?? 0,
                    mode: effects.position?.mode || currentConf.mode || "cover",
                },
                wavy: effects.wavy,
                particles: effects.particles,
                onload: effects.onload,
            });
        } finally {
            dataControl.isApplyingCardEffects = false;
        }

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
            applyOnloadAnimation();
        } else if (ui.overlay) {
            ui.overlay.style.opacity = 0;
        }

        return true;
    }

    bindDataControl() {
        dataControl.on("card:hard", async ({ card, sourceId, firstRun }) => {
            if (!card) return;
            const token = ++this._applyToken;
            const source = dataControl.sources.get(sourceId) || dataControl.activeSource;
            if (!source) return;
            try {
                const result = await source.apply(card, { firstRun: Boolean(firstRun) });
                if (result === false || token !== this._applyToken) return;
            } catch (err) {
                if (token !== this._applyToken) return;
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
