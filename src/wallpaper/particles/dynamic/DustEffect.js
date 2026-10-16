import { ParticleEffect } from "../ParticleEffect.js";
import { t } from "/src/core/i18n.js";

// ==========================================
// DUST EFFECT
// ==========================================
export class DustEffect extends ParticleEffect {
    static ID = "dust";
    static DEFAULTS = {
        count: 500,
        speed: 0.7,
        size: 1.0,
        blur: 0.6,
        angle: 0,
        opacity: 1.0,
        color: "#dce1e6",
    };

    init() {
        super.init();
        const count = this.config.count !== undefined ? this.config.count : DustEffect.DEFAULTS.count;
        this.time = 0;
        this.currentWind = 0;

        for (let i = 0; i < count; i++) {
            this.pushFlake(true);
        }
        this.particles.sort((a, b) => a.z - b.z);
    }

    pushFlake(firstTime = false) {
        const { width, height } = this.canvas;

        const rand = Math.random();
        let p = {
            x: Math.random() * width,
            y: firstTime ? Math.random() * height : height + 100,
            z: rand,
            swingSpeed: Math.random() * 0.02 + 0.005,
            swingStep: Math.random() * Math.PI * 2,
            windSensitivity: rand * 2.5 + 0.2,
        };

        if (rand > 0.97) {
            // Foreground (Cinematic blur)
            p.radius = Math.random() * 40 + 30;
            p.baseUpward = Math.random() * 8 + 6;
            p.baseOpacity = Math.random() * 0.1 + 0.02;
            p.isSoft = true;
        } else if (rand > 0.8) {
            // Midground
            p.radius = Math.random() * 3 + 2;
            p.baseUpward = Math.random() * 1.5 + 1;
            p.baseOpacity = Math.random() * 0.3 + 0.1;
            p.isSoft = false;
        } else {
            // Background
            p.radius = Math.random() * 1.2 + 0.2;
            p.baseUpward = Math.random() * 0.5 + 0.2;
            p.baseOpacity = Math.random() * 0.4 + 0.1;
            p.isSoft = false;
        }

        p.verticalSpeed = p.baseUpward * -1;
        this.particles.push(p);
    }

    update() {
        const { width, height } = this.canvas;
        const speedMultiplier = this.config.speed !== undefined ? this.config.speed : DustEffect.DEFAULTS.speed;
        const targetWind = this.config.angle !== undefined ? this.config.angle / 10 : DustEffect.DEFAULTS.angle / 10;

        this.time += 0.005;
        let naturalGust = Math.sin(this.time) * 0.1;
        this.currentWind += (targetWind + naturalGust - this.currentWind) * 0.03;

        this.particles.forEach((p) => {
            p.y += p.verticalSpeed * speedMultiplier;
            p.x += this.currentWind * p.windSensitivity;
            p.swingStep += p.swingSpeed;
            p.x += Math.cos(p.swingStep) * (p.z * 0.5);

            const limit = p.radius * 2 + 80;
            if (p.y < -limit) {
                p.y = height + limit;
                p.x = Math.random() * width;
            }
            if (p.x > width + limit) p.x = -limit;
            else if (p.x < -limit) p.x = width + limit;
        });
    }

    render() {
        const { ctx, particles, config } = this;
        const opcMultiplier = this.config.opacity !== undefined ? this.config.opacity : DustEffect.DEFAULTS.opacity;
        const sizeMultiplier = this.config.size !== undefined ? this.config.size : DustEffect.DEFAULTS.size;
        const blurMultiplier = this.config.blur !== undefined ? this.config.blur : DustEffect.DEFAULTS.blur;

        // Resolve clean RGB for gradients
        let rgb = "220, 225, 230";
        if (config.color && config.color.startsWith("#")) {
            const r = parseInt(config.color.slice(1, 3), 16);
            const g = parseInt(config.color.slice(3, 5), 16);
            const b = parseInt(config.color.slice(5, 7), 16);
            rgb = `${r}, ${g}, ${b}`;
        }

        particles.forEach((p) => {
            const alpha = Math.min(1, Math.max(0, p.baseOpacity * opcMultiplier));
            const radius = p.radius * sizeMultiplier;

            // Parallax depth hierarchy (relative to wallpaper = 1.0):
            // Background (z≈0): ~0.3x | Midground (z≈0.7): ~1.5x | Foreground (z=1): 4.0x | isSoft: 6.0x
            const amplitude = this.parallaxAmplitude !== undefined ? this.parallaxAmplitude : -30;
            const depthFactor = p.isSoft ? 6.0 : (0.3 + 3.7 * Math.pow(p.z, 1.4));
            const offsetX = (this.mouseX || 0) * amplitude * depthFactor;
            const offsetY = (this.mouseY || 0) * (amplitude * 0.65) * depthFactor;
            const renderX = p.x + offsetX;
            const renderY = p.y + offsetY;

            const drawRadius = radius * (p.isSoft ? (1 + blurMultiplier * 0.2) : 1);

            if (p.isSoft) {
                const gradient = ctx.createRadialGradient(renderX, renderY, 0, renderX, renderY, drawRadius);
                gradient.addColorStop(0, `rgba(${rgb}, ${alpha})`);
                gradient.addColorStop(0.5, `rgba(${rgb}, ${alpha * 0.3})`);
                gradient.addColorStop(1, `rgba(${rgb}, 0)`);
                ctx.fillStyle = gradient;
            } else {
                const innerR = blurMultiplier === 0 ? drawRadius * 0.99 : drawRadius * Math.max(0, 0.7 - 0.35 * blurMultiplier);
                const gradient = ctx.createRadialGradient(renderX, renderY, innerR, renderX, renderY, drawRadius);
                gradient.addColorStop(0, `rgba(${rgb}, ${alpha})`);
                gradient.addColorStop(0.7, `rgba(${rgb}, ${alpha * 0.6})`);
                gradient.addColorStop(1, `rgba(${rgb}, 0)`);
                ctx.fillStyle = gradient;
            }

            ctx.beginPath();
            ctx.arc(renderX, renderY, drawRadius, 0, Math.PI * 2);
            ctx.fill();
        });
    }

    static getSettingsSpec() {
        return [
            { key: "count", dataI18n: "particles.dust.count", label: t("particles.dust.count"), min: 10, max: 1000, step: 10, unit: t("unit.particles"), dataI18nUnit: "unit.particles" },
            { key: "speed", dataI18n: "particles.dust.speed", label: t("particles.dust.speed"), min: 0.1, max: 5, step: 0.1, unit: "x" },
            { key: "size", dataI18n: "particles.dust.size", label: t("particles.dust.size"), min: 0.1, max: 3.0, step: 0.1, unit: "x" },
            { key: "blur", dataI18n: "particles.dust.blur", label: t("particles.dust.blur"), min: 0.0, max: 2.0, step: 0.1, unit: "x" },
            { key: "angle", dataI18n: "particles.dust.angle", label: t("particles.dust.angle"), min: -10, max: 10, step: 1, unit: "°" },
            { key: "opacity", dataI18n: "particles.dust.opacity", label: t("particles.dust.opacity"), min: 0.1, max: 2, step: 0.1, unit: "x" }
        ];
    }
}
