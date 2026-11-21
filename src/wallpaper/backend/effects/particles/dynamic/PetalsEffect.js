import { ParticleEffect, parseColorRgb } from "../ParticleEffect.js";
import { t } from "/src/core/i18n.js";

const PETAL_SPRITE_SIZE = 64;

function buildSoftPetalSprite(rgb) {
    const c = document.createElement("canvas");
    c.width = PETAL_SPRITE_SIZE;
    c.height = PETAL_SPRITE_SIZE;
    const sCtx = c.getContext("2d");
    const h = PETAL_SPRITE_SIZE / 2;
    const grad = sCtx.createRadialGradient(h, h, 0, h, h, h);
    grad.addColorStop(0, `rgba(${rgb}, 1)`);
    grad.addColorStop(1, `rgba(${rgb}, 0)`);
    sCtx.fillStyle = grad;
    sCtx.beginPath();
    sCtx.moveTo(h, 0);
    sCtx.quadraticCurveTo(h + h * 0.8, h * 0.5, h, PETAL_SPRITE_SIZE);
    sCtx.quadraticCurveTo(h - h * 0.8, h * 0.5, h, 0);
    sCtx.fill();
    return c;
}

// ==========================================
// PETALS EFFECT
// ==========================================
export class PetalsEffect extends ParticleEffect {
    static ID = "petals";
    static DEFAULTS = {
        count: 100,
        speed: 0.8,
        size: 1.5,
        angle: -6,
        opacity: 0.8,
        color: "#ffc0cb",
    };

    init() {
        super.init();
        const count = this.config.count !== undefined ? this.config.count : PetalsEffect.DEFAULTS.count;
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

        // Same layered logic as snow/dust
        let p = {
            x: Math.random() * width,
            y: firstTime ? Math.random() * height : -50,
            z: rand,
            rot: Math.random() * Math.PI * 2,
            rotSpeed: (Math.random() - 0.5) * 0.05,
            flip: Math.random() * Math.PI * 2,
            flipSpeed: Math.random() * 0.03 + 0.01,
            swingSpeed: Math.random() * 0.02 + 0.005,
            swingStep: Math.random() * Math.PI * 2,
            windSensitivity: rand * 2.5 + 0.2,
        };

        if (rand > 0.95) {
            // Foreground
            p.radius = Math.random() * 30 + 20;
            p.baseSpeed = Math.random() * 3 + 2;
            p.baseOpacity = Math.random() * 0.2 + 0.1;
            p.isSoft = true;
        } else if (rand > 0.7) {
            // Midground
            p.radius = Math.random() * 8 + 6;
            p.baseSpeed = Math.random() * 1.5 + 0.8;
            p.baseOpacity = Math.random() * 0.5 + 0.3;
            p.isSoft = false;
        } else {
            // Background
            p.radius = Math.random() * 3 + 2;
            p.baseSpeed = Math.random() * 0.5 + 0.4;
            p.baseOpacity = Math.random() * 0.6 + 0.2;
            p.isSoft = false;
        }

        this.particles.push(p);
    }

    update() {
        const { width, height } = this.canvas;
        const speedMultiplier = this.config.speed !== undefined ? this.config.speed : PetalsEffect.DEFAULTS.speed;
        const targetWind = this.config.angle !== undefined ? this.config.angle / 10 : PetalsEffect.DEFAULTS.angle / 10;

        this.time += 0.005;
        let naturalGust = Math.sin(this.time * 0.5) * 0.2;
        this.currentWind += (targetWind + naturalGust - this.currentWind) * 0.02;

        this.particles.forEach((p) => {
            p.y += p.baseSpeed * speedMultiplier;
            p.x += this.currentWind * p.windSensitivity;
            p.swingStep += p.swingSpeed;
            p.x += Math.cos(p.swingStep) * (p.z * 1.5); // More chao đảo than snow

            p.rot += p.rotSpeed;
            p.flip += p.flipSpeed;

            const limit = p.radius * 2;
            if (p.y > height + limit) {
                p.y = -limit;
                p.x = Math.random() * width;
            }
            if (p.x > width + limit) p.x = -limit;
            else if (p.x < -limit) p.x = width + limit;
        });
    }

    _ensureVisualCache(color) {
        const key = color || "#ffc0cb";
        if (this._visualKey === key && this._softSprite && this._fillColor) {
            return { rgb: this._rgb, fillColor: this._fillColor, softSprite: this._softSprite };
        }
        this._visualKey = key;
        this._rgb = parseColorRgb(key, "255, 192, 203");
        this._fillColor = `rgb(${this._rgb})`;
        this._softSprite = buildSoftPetalSprite(this._rgb);
        return { rgb: this._rgb, fillColor: this._fillColor, softSprite: this._softSprite };
    }

    render() {
        const { ctx, particles, config } = this;
        const opcMultiplier = this.config.opacity !== undefined ? this.config.opacity : PetalsEffect.DEFAULTS.opacity;
        const sizeMultiplier = this.config.size !== undefined ? this.config.size : PetalsEffect.DEFAULTS.size;
        const { fillColor, softSprite } = this._ensureVisualCache(config.color);

        const amplitude = this.parallaxAmplitude !== undefined ? this.parallaxAmplitude : -30;
        const mx = (this.mouseX || 0) * amplitude;
        const my = (this.mouseY || 0) * (amplitude * 0.65);

        ctx.fillStyle = fillColor;
        ctx.strokeStyle = fillColor;
        ctx.lineWidth = 1;

        for (let i = 0; i < particles.length; i++) {
            const p = particles[i];
            const alpha = Math.min(1, Math.max(0, p.baseOpacity * opcMultiplier));
            if (alpha <= 0.002) continue;

            const flipScale = Math.cos(p.flip); // 3D scale simulation
            // Parallax depth hierarchy (relative to wallpaper = 1.0):
            // Background (z≈0): ~0.3x | Midground (z≈0.7): ~1.5x | Foreground (z=1): 4.0x | isSoft: 6.0x
            const depthFactor = p.isSoft ? 6.0 : (0.3 + 3.7 * Math.pow(p.z, 1.4));
            const renderX = p.x + mx * depthFactor;
            const renderY = p.y + my * depthFactor;
            const currentRadius = p.radius * sizeMultiplier;

            const cosR = Math.cos(p.rot);
            const sinR = Math.sin(p.rot);
            ctx.setTransform(cosR, sinR, -sinR * flipScale, cosR * flipScale, renderX, renderY);

            if (p.isSoft) {
                ctx.globalAlpha = alpha;
                ctx.drawImage(softSprite, -currentRadius, -currentRadius, currentRadius * 2, currentRadius * 2);
            } else {
                ctx.globalAlpha = alpha;
                ctx.beginPath();
                ctx.moveTo(0, -currentRadius);
                ctx.quadraticCurveTo(currentRadius * 0.8, -currentRadius * 0.5, 0, currentRadius);
                ctx.quadraticCurveTo(-currentRadius * 0.8, -currentRadius * 0.5, 0, -currentRadius);
                ctx.fill();

                if (currentRadius > 5) {
                    ctx.globalAlpha = alpha * 0.5;
                    ctx.beginPath();
                    ctx.moveTo(0, -currentRadius);
                    ctx.lineTo(0, currentRadius);
                    ctx.stroke();
                }
            }
        }
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalAlpha = 1;
    }

    static getSettingsSpec() {
        return [
            { key: "count", dataI18n: "particles.petals.count", label: t("particles.petals.count"), min: 10, max: 300, step: 10, unit: t("unit.petals"), dataI18nUnit: "unit.petals" },
            { key: "speed", dataI18n: "particles.petals.gravity", label: t("particles.petals.gravity"), min: 0.1, max: 5, step: 0.1, unit: "x" },
            { key: "size", dataI18n: "particles.petals.size", label: t("particles.petals.size"), min: 0.1, max: 3, step: 0.1, unit: "x" },
            { key: "angle", dataI18n: "particles.petals.angle", label: t("particles.petals.angle"), min: -30, max: 30, step: 1, unit: "°" },
            { key: "opacity", dataI18n: "particles.petals.opacity", label: t("particles.petals.opacity"), min: 0.1, max: 2, step: 0.1, unit: "x" }
        ];
    }
}
