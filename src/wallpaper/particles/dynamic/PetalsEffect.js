import { ParticleEffect } from "../ParticleEffect.js";
import { t } from "/src/core/i18n.js";

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

    render() {
        const { ctx, particles, config } = this;
        const color = config.color || "#ffc0cb";
        const opcMultiplier = this.config.opacity !== undefined ? this.config.opacity : PetalsEffect.DEFAULTS.opacity;
        const sizeMultiplier = this.config.size !== undefined ? this.config.size : PetalsEffect.DEFAULTS.size;

        let rgb = "255, 192, 203";
        if (color.startsWith("#")) {
            const r = parseInt(color.slice(1, 3), 16);
            const g = parseInt(color.slice(3, 5), 16);
            const b = parseInt(color.slice(5, 7), 16);
            rgb = `${r}, ${g}, ${b}`;
        }

        particles.forEach((p) => {
            const alpha = Math.min(1, Math.max(0, p.baseOpacity * opcMultiplier));
            const flipScale = Math.cos(p.flip); // 3D scale simulation
            // Parallax depth hierarchy (relative to wallpaper = 1.0):
            // Background (z≈0): ~0.3x | Midground (z≈0.7): ~1.5x | Foreground (z=1): 4.0x | isSoft: 6.0x
            const amplitude = this.parallaxAmplitude !== undefined ? this.parallaxAmplitude : -30;
            const depthFactor = p.isSoft ? 6.0 : (0.3 + 3.7 * Math.pow(p.z, 1.4));
            const offsetX = (this.mouseX || 0) * amplitude * depthFactor;
            const offsetY = (this.mouseY || 0) * (amplitude * 0.65) * depthFactor;
            const renderX = p.x + offsetX;
            const renderY = p.y + offsetY;
            const currentRadius = p.radius * sizeMultiplier;

            ctx.save();
            ctx.translate(renderX, renderY);
            ctx.rotate(p.rot);
            ctx.scale(1, flipScale); // Flip on one axis

            if (p.isSoft) {
                const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, currentRadius);
                grad.addColorStop(0, `rgba(${rgb}, ${alpha})`);
                grad.addColorStop(1, `rgba(${rgb}, 0)`);
                ctx.fillStyle = grad;
            } else {
                ctx.fillStyle = `rgba(${rgb}, ${alpha})`;
            }

            // Draw a basic petal shape (leaf-like)
            ctx.beginPath();
            ctx.moveTo(0, -currentRadius);
            ctx.quadraticCurveTo(currentRadius * 0.8, -currentRadius * 0.5, 0, currentRadius);
            ctx.quadraticCurveTo(-currentRadius * 0.8, -currentRadius * 0.5, 0, -currentRadius);
            ctx.fill();

            // Add a subtle line in middle
            if (!p.isSoft && currentRadius > 5) {
                ctx.strokeStyle = `rgba(${rgb}, ${alpha * 0.5})`;
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(0, -currentRadius);
                ctx.lineTo(0, currentRadius);
                ctx.stroke();
            }

            ctx.restore();
        });
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
