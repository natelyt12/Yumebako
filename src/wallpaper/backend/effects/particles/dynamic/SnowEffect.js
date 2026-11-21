import { ParticleEffect, parseColorRgb } from "../ParticleEffect.js";
import { t } from "/src/core/i18n.js";

const SNOW_SPRITE_SIZE = 64;

function buildSnowSprite(rgb, blur, isSoft) {
    const c = document.createElement("canvas");
    c.width = SNOW_SPRITE_SIZE;
    c.height = SNOW_SPRITE_SIZE;
    const sCtx = c.getContext("2d");
    const h = SNOW_SPRITE_SIZE / 2;

    if (isSoft) {
        const grad = sCtx.createRadialGradient(h, h, 0, h, h, h);
        grad.addColorStop(0, `rgba(${rgb}, 1)`);
        grad.addColorStop(0.5, `rgba(${rgb}, 0.3)`);
        grad.addColorStop(1, `rgba(${rgb}, 0)`);
        sCtx.fillStyle = grad;
    } else {
        const innerR = blur === 0 ? h * 0.99 : h * Math.max(0, 0.7 - 0.35 * blur);
        const grad = sCtx.createRadialGradient(h, h, innerR, h, h, h);
        grad.addColorStop(0, `rgba(${rgb}, 1)`);
        grad.addColorStop(0.7, `rgba(${rgb}, 0.6)`);
        grad.addColorStop(1, `rgba(${rgb}, 0)`);
        sCtx.fillStyle = grad;
    }

    sCtx.beginPath();
    sCtx.arc(h, h, h, 0, Math.PI * 2);
    sCtx.fill();
    return c;
}

// ==========================================
// SNOW EFFECT
// ==========================================
export class SnowEffect extends ParticleEffect {
    static ID = "snow";
    static DEFAULTS = {
        count: 250,
        speed: 0.8,
        size: 2.0,
        blur: 0.6,
        angle: 3,
        opacity: 1.0,
        color: "#ffffff",
    };

    init() {
        super.init();
        const count = this.config.count !== undefined ? this.config.count : SnowEffect.DEFAULTS.count;
        this.time = 0;
        this.currentWind = 0;

        for (let i = 0; i < count; i++) {
            this.pushFlake(true);
        }
        // Sort to ensure foreground particles are drawn on top
        this.particles.sort((a, b) => a.z - b.z);
    }

    pushFlake(firstTime = false) {
        const { width, height } = this.canvas;

        const rand = Math.random();
        let p = {
            x: Math.random() * width,
            y: firstTime ? Math.random() * height : -100, // Snow falls down
            z: rand,
            swingSpeed: Math.random() * 0.02 + 0.005,
            swingStep: Math.random() * Math.PI * 2,
            windSensitivity: rand * 2.5 + 0.2,
        };

        if (rand > 0.97) {
            // Foreground (Cinematic blur)
            p.radius = Math.random() * 30 + 20; // 20 -> 50px for snow
            p.baseSpeed = Math.random() * 5 + 4; // fast falling
            p.baseOpacity = Math.random() * 0.2 + 0.05;
            p.isSoft = true;
        } else if (rand > 0.8) {
            // Midground
            p.radius = Math.random() * 3 + 2;
            p.baseSpeed = Math.random() * 1.5 + 1;
            p.baseOpacity = Math.random() * 0.5 + 0.2;
            p.isSoft = false;
        } else {
            // Background
            p.radius = Math.random() * 1.2 + 0.5;
            p.baseSpeed = Math.random() * 0.5 + 0.5;
            p.baseOpacity = Math.random() * 0.4 + 0.1;
            p.isSoft = false;
        }

        p.verticalSpeed = p.baseSpeed;
        this.particles.push(p);
    }

    update() {
        const { width, height } = this.canvas;
        const speedMultiplier = this.config.speed !== undefined ? this.config.speed : SnowEffect.DEFAULTS.speed;
        const targetWind = this.config.angle !== undefined ? this.config.angle / 10 : SnowEffect.DEFAULTS.angle / 10;

        this.time += 0.005;
        let naturalGust = Math.sin(this.time) * 0.1;
        this.currentWind += (targetWind + naturalGust - this.currentWind) * 0.03;

        this.particles.forEach((p) => {
            p.y += p.verticalSpeed * speedMultiplier;
            p.x += this.currentWind * p.windSensitivity;
            p.swingStep += p.swingSpeed;
            p.x += Math.cos(p.swingStep) * (p.z * 0.5);

            const limit = p.radius * 2 + 100;
            if (p.y > height + limit) {
                // Snow falls across the bottom
                p.y = -limit;
                p.x = Math.random() * width;
            }
            if (p.x > width + limit) p.x = -limit;
            else if (p.x < -limit) p.x = width + limit;
        });
    }

    _ensureSprites(color, blur) {
        const key = `${color || ""}|${blur}`;
        if (this._spriteKey === key && this._sprites) return this._sprites;
        this._spriteKey = key;
        const rgb = parseColorRgb(color, "255, 255, 255");
        this._sprites = {
            soft: buildSnowSprite(rgb, blur, true),
            sharp: buildSnowSprite(rgb, blur, false),
        };
        return this._sprites;
    }

    render() {
        const { ctx, particles, config } = this;
        const opcMultiplier = this.config.opacity !== undefined ? this.config.opacity : SnowEffect.DEFAULTS.opacity;
        const sizeMultiplier = this.config.size !== undefined ? this.config.size : SnowEffect.DEFAULTS.size;
        const blurMultiplier = this.config.blur !== undefined ? this.config.blur : SnowEffect.DEFAULTS.blur;

        const { soft, sharp } = this._ensureSprites(config.color, blurMultiplier);
        const amplitude = this.parallaxAmplitude !== undefined ? this.parallaxAmplitude : -30;
        const mx = (this.mouseX || 0) * amplitude;
        const my = (this.mouseY || 0) * (amplitude * 0.65);

        for (let i = 0; i < particles.length; i++) {
            const p = particles[i];
            const alpha = Math.min(1, Math.max(0, p.baseOpacity * opcMultiplier));
            if (alpha <= 0.002) continue;

            const radius = p.radius * sizeMultiplier;

            // Parallax depth hierarchy (relative to wallpaper = 1.0):
            // Background (z≈0): ~0.3x | Midground (z≈0.7): ~1.5x | Foreground (z=1): 4.0x | isSoft: 6.0x
            const depthFactor = p.isSoft ? 6.0 : (0.3 + 3.7 * Math.pow(p.z, 1.4));
            const renderX = p.x + mx * depthFactor;
            const renderY = p.y + my * depthFactor;

            const drawRadius = radius * (p.isSoft ? (1 + blurMultiplier * 0.2) : 1);
            const sprite = p.isSoft ? soft : sharp;

            ctx.globalAlpha = alpha;
            ctx.drawImage(sprite, renderX - drawRadius, renderY - drawRadius, drawRadius * 2, drawRadius * 2);
        }
        ctx.globalAlpha = 1;
    }

    static getSettingsSpec() {
        return [
            { key: "count", dataI18n: "particles.snow.count", label: t("particles.snow.count"), min: 10, max: 1000, step: 10, unit: t("unit.particles"), dataI18nUnit: "unit.particles" },
            { key: "speed", dataI18n: "particles.snow.gravity", label: t("particles.snow.gravity"), min: 0.1, max: 5, step: 0.1, unit: "x" },
            { key: "size", dataI18n: "particles.snow.size", label: t("particles.snow.size"), min: 0.1, max: 3.0, step: 0.1, unit: "x" },
            { key: "blur", dataI18n: "particles.snow.blur", label: t("particles.snow.blur"), min: 0.0, max: 2.0, step: 0.1, unit: "x" },
            { key: "angle", dataI18n: "particles.snow.windDirection", label: t("particles.snow.windDirection"), min: -30, max: 30, step: 1, unit: "°" },
            { key: "opacity", dataI18n: "particles.snow.opacity", label: t("particles.snow.opacity"), min: 0.1, max: 2, step: 0.1, unit: "x" }
        ];
    }
}
