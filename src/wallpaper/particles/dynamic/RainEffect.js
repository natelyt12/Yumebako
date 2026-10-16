import { ParticleEffect } from "../ParticleEffect.js";
import { t } from "/src/core/i18n.js";

// ==========================================
// RAIN EFFECT
// ==========================================
export class RainEffect extends ParticleEffect {
    static ID = "rain";
    static DEFAULTS = {
        count: 240,
        speed: 2.0,
        angle: 5,
        opacity: 0.4,
        length: 3.0,
        color: "#ffffff",
    };

    init() {
        super.init();
        const count = this.config.count !== undefined ? this.config.count : RainEffect.DEFAULTS.count;
        this.time = 0;
        this.currentWind = 0;

        for (let i = 0; i < count; i++) {
            this.pushDrop(true);
        }
        // Sort to ensure foreground particles are drawn on top
        this.particles.sort((a, b) => a.z - b.z);
    }

    pushDrop(firstTime = false) {
        const { width, height } = this.canvas;

        const rand = Math.random();
        let p = {
            x: Math.random() * width,
            y: firstTime ? Math.random() * height : -100, // Rain falls down
            z: rand,
            windSensitivity: rand * 1.5 + 0.5,
        };

        if (rand > 0.95) {
            // Foreground
            p.length = Math.random() * 40 + 30;
            p.width = Math.random() * 2 + 1.5;
            p.baseSpeed = Math.random() * 15 + 10;
            p.baseOpacity = Math.random() * 0.2 + 0.1;
        } else if (rand > 0.7) {
            // Midground
            p.length = Math.random() * 20 + 10;
            p.width = Math.random() * 1 + 0.8;
            p.baseSpeed = Math.random() * 8 + 5;
            p.baseOpacity = Math.random() * 0.4 + 0.2;
        } else {
            // Background
            p.length = Math.random() * 10 + 5;
            p.width = Math.random() * 0.5 + 0.3;
            p.baseSpeed = Math.random() * 4 + 2;
            p.baseOpacity = Math.random() * 0.3 + 0.1;
        }

        p.verticalSpeed = p.baseSpeed;
        this.particles.push(p);
    }

    update() {
        const { width, height } = this.canvas;
        const speedMultiplier = this.config.speed !== undefined ? this.config.speed : RainEffect.DEFAULTS.speed;
        const targetWind = this.config.angle !== undefined ? this.config.angle / 10 : RainEffect.DEFAULTS.angle / 10;
        const lengthMultiplier = this.config.length !== undefined ? this.config.length : RainEffect.DEFAULTS.length;

        this.time += 0.005;
        let naturalGust = Math.sin(this.time * 2) * 0.2;

        this.currentWind += (targetWind + naturalGust - this.currentWind) * 0.1;

        this.particles.forEach((p) => {
            p.y += p.verticalSpeed * speedMultiplier;
            p.x += this.currentWind * p.windSensitivity * speedMultiplier;

            const limit = p.length * lengthMultiplier;
            if (p.y > height + limit) {
                p.y = -limit;
                p.x = Math.random() * width;
            }
            if (p.x > width + limit) p.x = -limit;
            else if (p.x < -limit) p.x = width + limit;
        });
    }

    render() {
        const { ctx, particles, config } = this;
        const opcMultiplier = this.config.opacity !== undefined ? this.config.opacity : RainEffect.DEFAULTS.opacity;
        const lengthMultiplier = this.config.length !== undefined ? this.config.length : RainEffect.DEFAULTS.length;

        let rgb = "255, 255, 255";
        if (config.color && config.color.startsWith("#")) {
            const r = parseInt(config.color.slice(1, 3), 16);
            const g = parseInt(config.color.slice(3, 5), 16);
            const b = parseInt(config.color.slice(5, 7), 16);
            rgb = `${r}, ${g}, ${b}`;
        }

        ctx.lineCap = "round";

        particles.forEach((p) => {
            const alpha = Math.min(1, Math.max(0, p.baseOpacity * opcMultiplier));

            // Parallax X-axis only (rain falls straight; no vertical shift).
            // Depth hierarchy: background rain barely shifts, foreground rain up to 4x wallpaper
            const amplitude = this.parallaxAmplitude !== undefined ? this.parallaxAmplitude : -30;
            const depthFactor = p.z * p.z * 4.0; // quadratic: bg≈0, fg≈4.0x
            const parallaxOffsetX = (this.mouseX || 0) * amplitude * depthFactor * 0.35;

            const headX = p.x + parallaxOffsetX;
            const headY = p.y;

            const dx = this.currentWind * p.windSensitivity;
            const dy = p.verticalSpeed;
            const dist = Math.sqrt(dx * dx + dy * dy);
            const currentLength = p.length * lengthMultiplier;
            const ldx = (dx / dist) * currentLength;
            const ldy = (dy / dist) * currentLength;

            const tailX = headX - ldx;
            const tailY = headY - ldy;

            // Create gradient from head to tail
            const grad = ctx.createLinearGradient(headX, headY, tailX, tailY);
            grad.addColorStop(0, `rgba(${rgb}, ${alpha})`);
            grad.addColorStop(1, `rgba(${rgb}, ${alpha * 0.25})`);

            ctx.strokeStyle = grad;
            ctx.lineWidth = p.width;

            ctx.beginPath();
            ctx.moveTo(headX, headY);
            ctx.lineTo(tailX, tailY);
            ctx.stroke();
        });
    }

    static getSettingsSpec() {
        return [
            { key: "count", dataI18n: "particles.rain.count", label: t("particles.rain.count"), min: 10, max: 1000, step: 1, unit: t("unit.drops"), dataI18nUnit: "unit.drops" },
            { key: "speed", dataI18n: "particles.rain.gravity", label: t("particles.rain.gravity"), min: 0.1, max: 5, step: 0.1, unit: "x" },
            { key: "length", dataI18n: "particles.rain.length", label: t("particles.rain.length"), min: 0.1, max: 5, step: 0.1, unit: "x" },
            { key: "angle", dataI18n: "particles.rain.windDirection", label: t("particles.rain.windDirection"), min: -30, max: 30, step: 1, unit: "°" },
            { key: "opacity", dataI18n: "particles.rain.opacity", label: t("particles.rain.opacity"), min: 0.1, max: 2, step: 0.1, unit: "x" }
        ];
    }
}
