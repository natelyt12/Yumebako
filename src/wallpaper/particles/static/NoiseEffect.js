import { ParticleEffect } from "../ParticleEffect.js";
import { t } from "/src/core/i18n.js";

// ==========================================
// TV NOISE EFFECT
// ==========================================
export class NoiseEffect extends ParticleEffect {
    static ID = "noise";
    static DEFAULTS = {
        opacity: 0.1,
        brightness: 0.5,
    };

    init() {
        super.init();
        this.noiseCanvases = [];
        this.frameCount = 0;

        // Pre-render 3 frames of noise for high performance
        for (let i = 0; i < 3; i++) {
            const nc = document.createElement("canvas");
            nc.width = 256;
            nc.height = 256;
            const nctx = nc.getContext("2d");
            const imgData = nctx.createImageData(256, 256);
            const data = imgData.data;
            for (let j = 0; j < data.length; j += 4) {
                const val = Math.random() * 255;
                data[j] = val;
                data[j + 1] = val;
                data[j + 2] = val;
                data[j + 3] = 255;
            }
            nctx.putImageData(imgData, 0, 0);
            this.noiseCanvases.push(nc);
        }
    }

    update() {
        this.frameCount++;
    }

    render() {
        const { ctx, canvas, config } = this;
        const opacity = config.opacity !== undefined ? config.opacity : NoiseEffect.DEFAULTS.opacity;
        const brightness = config.brightness !== undefined ? config.brightness : NoiseEffect.DEFAULTS.brightness;

        ctx.save();
        ctx.globalAlpha = opacity;

        // Cycle through noise frames
        const frame = this.noiseCanvases[this.frameCount % 3];
        const pattern = ctx.createPattern(frame, "repeat");
        ctx.fillStyle = pattern;

        // Shift pattern randomly for organic flickering
        const offsetX = Math.floor(Math.random() * 256);
        const offsetY = Math.floor(Math.random() * 256);
        ctx.translate(offsetX, offsetY);

        // Fill with brightness adjustment via globalCompositeOperation if needed,
        // but simple globalAlpha is usually best for static
        ctx.fillRect(-offsetX, -offsetY, canvas.width, canvas.height);

        // Subtle horizontal scanline simulation
        if (Math.random() > 0.5) {
            ctx.fillStyle = `rgba(255, 255, 255, ${opacity * 0.2})`;
            ctx.fillRect(-offsetX, Math.random() * canvas.height - offsetY, canvas.width, 2);
        }

        ctx.restore();
    }

    static getSettingsSpec() {
        return [
            { key: "opacity", dataI18n: "particles.noise.opacity", label: t("particles.noise.opacity"), min: 0, max: 0.4, step: 0.01, unit: "x" }
        ];
    }
}
