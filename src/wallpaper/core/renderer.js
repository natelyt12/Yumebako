import { applyOnloadAnimation } from "/src/wallpaper/onload/index.js";

/**
 * renderer.js
 * ---------------------------------------------------------------------------
 * Handles drawing the wallpaper to the DOM (`.image` and `.video` layers).
 * Completely independent from fetching logic.
 */

const OVERLAY_FADE_MS = 500;

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
            document.querySelectorAll(".video").forEach((v) => {
                v.style.display = "block";
                if (newBlobUrl) {
                    v.src = newBlobUrl;
                    v.play().catch(() => {});
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
}

export const wallpaperRenderer = new WallpaperRenderer();
