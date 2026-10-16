import { ParticleEffect } from "../ParticleEffect.js";
import { t } from "/src/core/i18n.js";

// ==========================================
// FIREFLIES EFFECT
// ==========================================
export class FirefliesEffect extends ParticleEffect {
    static ID = "fireflies";
    static DEFAULTS = {
        count: 40,
        speed: 0.8,
        size: 0.8,
        opacity: 0.6,
        showDots: false,
    };

    init() {
        super.init();
        const count = this.config.count !== undefined ? this.config.count : FirefliesEffect.DEFAULTS.count;

        for (let i = 0; i < count; i++) {
            this.particles.push(this.createParticle(true));
        }
        this.particles.sort((a, b) => a.z - b.z);
    }

    createParticle(firstTime = false) {
        const { width, height } = this.canvas;
        const rand = Math.random();
        let p = {
            x: Math.random() * width,
            y: firstTime ? Math.random() * height : height + 100,
            z: rand,
            vx: (Math.random() - 0.5) * 0.3,
            vy: (Math.random() - 0.5) * 0.3,
            alpha: Math.random(),
            pulseSpeed: Math.random() * 0.02 + 0.005,
            angle: Math.random() * Math.PI * 2,
            angleSpeed: (Math.random() - 0.5) * 0.01,
        };

        if (rand > 0.95) {
            // Foreground (Cinematic)
            p.radius = Math.random() * 40 + 30;
            p.depthMult = 1.5;
            p.baseOpacity = 0.03;
            p.isSoft = true;
        } else if (rand > 0.7) {
            // Midground
            p.radius = Math.random() * 5 + 3;
            p.depthMult = 1.0;
            p.baseOpacity = 0.3;
            p.isSoft = false;
        } else {
            // Background
            p.radius = Math.random() * 1.5 + 0.5;
            p.depthMult = 0.5;
            p.baseOpacity = 0.6;
            p.isSoft = false;
        }

        return p;
    }

    update() {
        const { width, height } = this.canvas;
        const speedMultiplier = this.config.speed || FirefliesEffect.DEFAULTS.speed;

        this.particles.forEach((p) => {
            p.angle += p.angleSpeed * speedMultiplier;
            // Move generally upward like dust, but with organic sway
            p.x += (p.vx + Math.cos(p.angle) * 0.2) * speedMultiplier * p.depthMult;
            p.y += (p.vy - 0.2 + Math.sin(p.angle) * 0.2) * speedMultiplier * p.depthMult;

            p.alpha += p.pulseSpeed * speedMultiplier;
            if (p.alpha > 1 || p.alpha < 0) p.pulseSpeed *= -1;

            const limit = p.radius * 2 + 100;
            if (p.y < -limit) p.y = height + limit;
            if (p.y > height + limit) p.y = -limit;
            if (p.x < -limit) p.x = width + limit;
            if (p.x > width + limit) p.x = -limit;
        });
    }

    render() {
        const { ctx, particles, config } = this;
        const sizeMult = config.size || 0.8;
        const opcMult = config.opacity || 0.6;
        const showDots = config.showDots !== undefined ? config.showDots : false;

        particles.forEach((p) => {
            const currentAlpha = Math.max(0, p.alpha * p.baseOpacity * opcMult * 2);
            const r = p.radius * sizeMult;

            // Parallax depth hierarchy (relative to wallpaper = 1.0):
            // Background (z≈0): ~0.3x | Midground (z≈0.7): ~1.5x | Foreground (z=1): 4.0x | isSoft: 6.0x
            const amplitude = this.parallaxAmplitude !== undefined ? this.parallaxAmplitude : -30;
            const depthFactor = p.isSoft ? 6.0 : (0.3 + 3.7 * Math.pow(p.z, 1.4));
            const offsetX = (this.mouseX || 0) * amplitude * depthFactor;
            const offsetY = (this.mouseY || 0) * (amplitude * 0.65) * depthFactor;
            const renderX = p.x + offsetX;
            const renderY = p.y + offsetY;

            if (p.isSoft) {
                // Foreground blur
                const gradient = ctx.createRadialGradient(renderX, renderY, 0, renderX, renderY, r);
                gradient.addColorStop(0, `rgba(255, 255, 255, ${currentAlpha})`);
                gradient.addColorStop(0.5, `rgba(255, 255, 255, ${currentAlpha * 0.2})`);
                gradient.addColorStop(1, "rgba(255, 255, 255, 0)");
                ctx.fillStyle = gradient;
                ctx.beginPath();
                ctx.arc(renderX, renderY, r, 0, Math.PI * 2);
                ctx.fill();
            } else {
                // Mid/Background soft glow
                const gradient = ctx.createRadialGradient(renderX, renderY, 0, renderX, renderY, r * 3);
                gradient.addColorStop(0, `rgba(255, 255, 255, ${currentAlpha})`);
                gradient.addColorStop(1, "rgba(255, 255, 255, 0)");
                ctx.fillStyle = gradient;
                ctx.beginPath();
                ctx.arc(renderX, renderY, r * 3, 0, Math.PI * 2);
                ctx.fill();

                if (showDots && p.z < 0.9) {
                    ctx.fillStyle = `rgba(255, 255, 255, ${currentAlpha * 0.8})`;
                    ctx.beginPath();
                    ctx.arc(renderX, renderY, r * 0.5, 0, Math.PI * 2);
                    ctx.fill();
                }
            }
        });
    }

    static getSettingsSpec() {
        return [
            { key: "count", dataI18n: "particles.fireflies.count", label: t("particles.fireflies.count"), min: 10, max: 300, step: 10, unit: t("unit.fireflies"), dataI18nUnit: "unit.fireflies" },
            { key: "speed", dataI18n: "particles.fireflies.speed", label: t("particles.fireflies.speed"), min: 0.1, max: 2, step: 0.1, unit: "x" },
            { key: "size", dataI18n: "particles.fireflies.size", label: t("particles.fireflies.size"), min: 0.1, max: 2, step: 0.1, unit: "x" },
            { key: "opacity", dataI18n: "particles.fireflies.opacity", label: t("particles.fireflies.opacity"), min: 0.1, max: 1, step: 0.1, unit: "x" }
        ];
    }
}
