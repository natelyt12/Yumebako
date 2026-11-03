import { ParticleEffect } from "../ParticleEffect.js";
import { t } from "/src/core/i18n.js";

// ==========================================
// VIGNETTE EFFECT
// ==========================================
export class VignetteEffect extends ParticleEffect {
    static ID = "vignette";
    static DEFAULTS = {
        opacity: 0.5,
        size: 0.7,
    };

    render() {
        const { ctx, canvas, config } = this;
        const opacity = config.opacity !== undefined ? config.opacity : VignetteEffect.DEFAULTS.opacity;
        const size = config.size !== undefined ? config.size : VignetteEffect.DEFAULTS.size;

        ctx.save();
        const centerX = canvas.width / 2;
        const centerY = canvas.height / 2;
        const radius = Math.sqrt(centerX ** 2 + centerY ** 2);

        const gradient = ctx.createRadialGradient(centerX, centerY, radius * (1 - size), centerX, centerY, radius);
        gradient.addColorStop(0, "rgba(0, 0, 0, 0)");
        gradient.addColorStop(1, `rgba(0, 0, 0, ${opacity})`);

        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.restore();
    }

    static getSettingsSpec() {
        return [
            { key: "opacity", dataI18n: "particles.vignette.opacity", label: t("particles.vignette.opacity"), min: 0, max: 1, step: 0.05, unit: "x" },
            { key: "size", dataI18n: "particles.vignette.size", label: t("particles.vignette.size"), min: 0.1, max: 1, step: 0.05, unit: "x" }
        ];
    }
}
