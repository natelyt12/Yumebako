import { ParticleEffect } from "../ParticleEffect.js";
import { t } from "/src/core/i18n.js";

// ==========================================
// CINEMATIC FRAME EFFECT
// ==========================================
export class CinematicEffect extends ParticleEffect {
    static ID = "cinematic";
    static DEFAULTS = {
        thickness: 10,
        opacity: 1.0,
    };

    render() {
        const { ctx, canvas, config } = this;
        const thickness = config.thickness !== undefined ? config.thickness : CinematicEffect.DEFAULTS.thickness;
        const opacity = config.opacity !== undefined ? config.opacity : CinematicEffect.DEFAULTS.opacity;

        const barHeight = (canvas.height * (thickness / 100));

        ctx.save();
        ctx.fillStyle = `rgba(0, 0, 0, ${opacity})`;

        // Top bar
        ctx.fillRect(0, 0, canvas.width, barHeight);
        // Bottom bar
        ctx.fillRect(0, canvas.height - barHeight, canvas.width, barHeight);

        ctx.restore();
    }

    static getSettingsSpec() {
        return [
            { key: "thickness", dataI18n: "particles.cinematic.thickness", label: t("particles.cinematic.thickness"), min: 0, max: 30, step: 0.5, unit: "%" },
            { key: "opacity", dataI18n: "particles.cinematic.opacity", label: t("particles.cinematic.opacity"), min: 0, max: 1, step: 0.05, unit: "x" }
        ];
    }
}
