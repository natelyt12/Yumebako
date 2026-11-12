import { ParticleEffect } from "../ParticleEffect.js";
import { t } from "/src/core/i18n.js";

// ==========================================
// DUST EFFECT — Anime-style light motes
// ==========================================

// Thông số tinh chỉnh "cảm giác" tổng thể của bụi
const TUNING = {
    // Tỉ lệ hạt tiền cảnh (bokeh lớn, mờ như ngoài tiêu cự ống kính) — 0.03 = 3% tổng số hạt
    bokehRatio: 0.03,
    // Tỉ lệ hạt trung cảnh (hạt sáng rõ, có thể lóe sáng lấp lánh)
    midRatio: 0.17,
    // Tuổi thọ mỗi hạt (giây) — hạt hiện dần rồi tan dần thay vì bật/tắt đột ngột
    lifeMin: 7,
    lifeMax: 18,
    // Cường độ dòng khí cuộn (px/frame) — càng lớn hạt càng uốn lượn theo luồng không khí
    flowStrength: 0.35,
    // Độ nhạy đổi hướng (0..1) — nhỏ = trôi bồng bềnh, lớn = phản ứng nhanh
    inertia: 0.04,
    // Xác suất lóe sáng mỗi frame của một hạt trung cảnh (được nhân với Twinkle)
    glintChance: 0.0003,
    // Thời lượng một lần lóe sáng (số frame ở 60fps)
    glintDuration: 45,
    // Góc tia nắng so với phương ngang (độ) — 65 = nắng chiếu chéo từ trên trái xuống
    beamAngle: 65,
    // Độ rộng dải nắng, tính theo tỉ lệ đường chéo màn hình
    beamWidth: 0.2,
    // Mức pha tông ấm/lạnh vào màu gốc để hạt có sắc độ tự nhiên (0 = đơn sắc)
    tintMix: 0.22,
};

const WARM = [255, 214, 160];
const COOL = [196, 222, 255];
const SPRITE_SIZE = 64;
const KIND_BG = 0;
const KIND_MID = 1;
const KIND_BOKEH = 2;

const parseHex = (hex) => {
    if (typeof hex !== "string" || !/^#[0-9a-f]{6}$/i.test(hex)) return [220, 225, 230];
    return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
};
const mixRgb = (a, b, k) => a.map((v, i) => Math.round(v + (b[i] - v) * k));
const smoothstep = (e0, e1, x) => {
    const k = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
    return k * k * (3 - 2 * k);
};
const makeCanvas = () => {
    const c = document.createElement("canvas");
    c.width = c.height = SPRITE_SIZE;
    return c;
};

// Small luminous mote: core (base radius = 0.22 of sprite half) + faint halo + hot white center.
// Edge blur both softens the core falloff and spreads it outward (energy-preserved by lowering
// the peak), so the change stays visible even on 2–3px motes.
function buildMoteSprite([r, g, b], blur) {
    const c = makeCanvas();
    const ctx = c.getContext("2d");
    const h = SPRITE_SIZE / 2;
    const rgba = (a) => `rgba(${r}, ${g}, ${b}, ${a})`;

    const halo = ctx.createRadialGradient(h, h, 0, h, h, h);
    halo.addColorStop(0, rgba(0.22));
    halo.addColorStop(0.3, rgba(0.05));
    halo.addColorStop(1, rgba(0));
    ctx.fillStyle = halo;
    ctx.fillRect(0, 0, SPRITE_SIZE, SPRITE_SIZE);

    const coreR = h * 0.22;
    const outerR = coreR * (1 + blur * 1.2);
    const innerR = coreR * Math.max(0, 0.95 - blur * 0.6);
    const peak = 1 / (1 + blur * 0.6);
    const core = ctx.createRadialGradient(h, h, innerR, h, h, outerR);
    core.addColorStop(0, rgba(peak));
    core.addColorStop(0.5, rgba(peak * 0.35));
    core.addColorStop(1, rgba(0));
    ctx.fillStyle = core;
    ctx.beginPath();
    ctx.arc(h, h, outerR, 0, Math.PI * 2);
    ctx.fill();

    const hotA = 0.6 * Math.max(0, 1 - blur * 0.45);
    if (hotA > 0) {
        const hot = ctx.createRadialGradient(h, h, 0, h, h, coreR * 0.6);
        hot.addColorStop(0, `rgba(255, 255, 255, ${hotA})`);
        hot.addColorStop(1, "rgba(255, 255, 255, 0)");
        ctx.fillStyle = hot;
        ctx.fillRect(0, 0, SPRITE_SIZE, SPRITE_SIZE);
    }
    return c;
}

// Out-of-focus bokeh disc with a slightly brighter rim, like a real lens.
// Edge blur goes from a crisp lens rim (0) to a fully diffused glow (2).
function buildBokehSprite([r, g, b], blur) {
    const c = makeCanvas();
    const ctx = c.getContext("2d");
    const h = SPRITE_SIZE / 2;
    const rgba = (a) => `rgba(${r}, ${g}, ${b}, ${a})`;
    const soft = Math.min(0.6, 0.03 + blur * 0.28);
    const rimA = 0.85 - Math.min(0.4, blur * 0.2);

    const disc = ctx.createRadialGradient(h, h, 0, h, h, h);
    disc.addColorStop(0, rgba(0.4));
    disc.addColorStop(1 - soft - 0.12, rgba(0.5));
    disc.addColorStop(1 - soft, rgba(rimA));
    disc.addColorStop(1, rgba(0));
    ctx.fillStyle = disc;
    ctx.fillRect(0, 0, SPRITE_SIZE, SPRITE_SIZE);
    return c;
}

// 4-point anime sparkle: two long streaks + two short diagonal streaks + center glow.
function buildStarSprite([r, g, b]) {
    const c = makeCanvas();
    const ctx = c.getContext("2d");
    const h = SPRITE_SIZE / 2;

    const streak = (angle, length, thickness) => {
        ctx.save();
        ctx.translate(h, h);
        ctx.rotate(angle);
        ctx.scale(length, thickness);
        const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, h);
        grad.addColorStop(0, "rgba(255, 255, 255, 1)");
        grad.addColorStop(0.25, `rgba(${r}, ${g}, ${b}, 0.6)`);
        grad.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(0, 0, h, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    };
    streak(0, 1, 0.05);
    streak(Math.PI / 2, 1, 0.05);
    streak(Math.PI / 4, 0.45, 0.04);
    streak(-Math.PI / 4, 0.45, 0.04);

    const glow = ctx.createRadialGradient(h, h, 0, h, h, h * 0.3);
    glow.addColorStop(0, "rgba(255, 255, 255, 0.9)");
    glow.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, SPRITE_SIZE, SPRITE_SIZE);
    return c;
}

export class DustEffect extends ParticleEffect {
    static ID = "dust";
    static DEFAULTS = {
        count: 500,
        speed: 0.7,
        size: 1.0,
        blur: 0.6,
        angle: 0,
        opacity: 1.0,
        twinkle: 1.0,
        beam: 0.5,
        color: "#dce1e6",
    };

    _cfg(key) {
        return this.config[key] !== undefined ? this.config[key] : DustEffect.DEFAULTS[key];
    }

    init() {
        super.init();
        const count = this._cfg("count");
        this.time = 0;
        this.currentWind = 0;
        this.lastTime = 0;

        for (let i = 0; i < count; i++) {
            const p = {};
            this.spawn(p, true);
            this.particles.push(p);
        }
        this.particles.sort((a, b) => a.z - b.z);
    }

    /**
     * (Re)initializes a particle in place at a random screen position.
     * @param {Object} p - Particle object to mutate.
     * @param {boolean} [firstTime=false] - Start at a random life phase so the first frame is not empty.
     */
    spawn(p, firstTime = false) {
        const { width, height } = this.canvas;
        const rand = Math.random();

        p.x = Math.random() * width;
        p.y = Math.random() * height;
        p.z = rand;
        p.vx = 0;
        p.vy = 0;
        p.swingSpeed = Math.random() * 0.02 + 0.005;
        p.swingStep = Math.random() * Math.PI * 2;
        p.windSensitivity = rand * 2.5 + 0.2;
        p.twPhase = Math.random() * Math.PI * 2;
        p.twSpeed = Math.random() * 0.06 + 0.015;
        p.glint = 0;
        p.glintRot = 0;
        p.life = TUNING.lifeMin + Math.random() * (TUNING.lifeMax - TUNING.lifeMin);
        p.age = firstTime ? Math.random() * p.life : 0;

        const tintRoll = Math.random();
        p.tint = tintRoll < 0.3 ? 1 : tintRoll < 0.5 ? 2 : 0;

        if (rand > 1 - TUNING.bokehRatio) {
            p.kind = KIND_BOKEH;
            p.radius = Math.random() * 40 + 30;
            p.baseUpward = Math.random() * 0.8 + 0.4;
            p.baseOpacity = Math.random() * 0.1 + 0.04;
        } else if (rand > 1 - TUNING.bokehRatio - TUNING.midRatio) {
            p.kind = KIND_MID;
            p.radius = Math.random() * 2 + 1.5;
            p.baseUpward = Math.random() * 0.6 + 0.3;
            p.baseOpacity = Math.random() * 0.35 + 0.25;
        } else {
            p.kind = KIND_BG;
            p.radius = Math.random() * 1.1 + 0.3;
            p.baseUpward = Math.random() * 0.3 + 0.1;
            p.baseOpacity = Math.random() * 0.4 + 0.15;
        }
    }

    _ensureSprites() {
        const color = this._cfg("color");
        const blur = this._cfg("blur");
        const key = `${color}|${blur}`;
        if (this._spriteKey === key) return;
        this._spriteKey = key;

        const base = parseHex(color);
        const tints = [base, mixRgb(base, WARM, TUNING.tintMix), mixRgb(base, COOL, TUNING.tintMix)];
        this.sprites = {
            [KIND_BG]: tints.map((c) => buildMoteSprite(c, blur)),
            [KIND_MID]: tints.map((c) => buildMoteSprite(c, blur)),
            [KIND_BOKEH]: tints.map((c) => buildBokehSprite(c, blur)),
            star: buildStarSprite(mixRgb(base, WARM, TUNING.tintMix)),
        };
    }

    update() {
        const { width, height } = this.canvas;
        const speed = this._cfg("speed");
        const twinkle = this._cfg("twinkle");
        const targetWind = this._cfg("angle") / 10;

        // Frame-rate independent step, normalized to 60fps (prevents 2x speed on 120Hz screens).
        const now = performance.now();
        const dt = this.lastTime ? Math.min(3, (now - this.lastTime) / 16.667) : 1;
        this.lastTime = now;

        this.time += 0.005 * dt;
        const gust = Math.sin(this.time) * 0.1 + Math.sin(this.time * 2.7 + 1.3) * 0.05;
        this.currentWind += (targetWind + gust - this.currentWind) * 0.03 * dt;

        const ft = this.time * 2;
        const flow = TUNING.flowStrength;
        const inertia = Math.min(1, TUNING.inertia * dt);
        const glintChance = TUNING.glintChance * twinkle * dt;

        for (let i = 0; i < this.particles.length; i++) {
            const p = this.particles[i];

            p.age += dt / 60;
            if (p.age >= p.life) {
                this.spawn(p);
                continue;
            }

            // Coherent pseudo-curl air currents: nearby motes share the same eddies,
            // so the dust drifts in visible swirls instead of independent random paths.
            const fx = Math.sin(p.y * 0.004 + ft * 1.3) + Math.sin((p.x + p.y) * 0.0023 - ft * 0.9) * 0.6;
            const fy = Math.cos(p.x * 0.0035 - ft * 1.1) * 0.6 + Math.sin((p.x - p.y) * 0.002 + ft * 0.7) * 0.4;
            const depthSpeed = 0.35 + p.z * 0.9;

            p.swingStep += p.swingSpeed * dt;
            const tx = fx * flow * depthSpeed + Math.cos(p.swingStep) * p.z * 0.4;
            const ty = -p.baseUpward + fy * flow * depthSpeed * 0.6;
            p.vx += (tx - p.vx) * inertia;
            p.vy += (ty - p.vy) * inertia;

            p.x += (p.vx * speed + this.currentWind * p.windSensitivity) * dt;
            p.y += p.vy * speed * dt;

            p.twPhase += p.twSpeed * dt;
            if (p.glint > 0) {
                p.glint -= dt;
            } else if (p.kind === KIND_MID && Math.random() < glintChance) {
                p.glint = TUNING.glintDuration;
                p.glintRot = (Math.random() - 0.5) * 0.6;
            }

            const limit = p.radius * 4 + 80;
            if (p.y < -limit) p.y = height + limit;
            else if (p.y > height + limit) p.y = -limit;
            if (p.x > width + limit) p.x = -limit;
            else if (p.x < -limit) p.x = width + limit;
        }
    }

    render() {
        const { ctx, particles } = this;
        const { width, height } = this.canvas;
        const opc = this._cfg("opacity");
        const sizeMul = this._cfg("size");
        const blur = this._cfg("blur");
        const twinkle = this._cfg("twinkle");
        const beam = this._cfg("beam");

        this._ensureSprites();
        const sprites = this.sprites;

        // Sunbeam band: motes crossing it light up, like dust caught in a ray of light.
        const ang = (TUNING.beamAngle * Math.PI) / 180;
        const nx = Math.sin(ang);
        const ny = -Math.cos(ang);
        const projMin = Math.min(0, height * ny);
        const projMax = Math.max(0, width * nx);
        const beamCenter = projMin + (projMax - projMin) * (0.38 + 0.12 * Math.sin(this.time * 0.15));
        const beamW = Math.hypot(width, height) * TUNING.beamWidth;
        const invBeamW2 = 1 / (beamW * beamW);

        const amplitude = this.parallaxAmplitude !== undefined ? this.parallaxAmplitude : -30;
        const mx = (this.mouseX || 0) * amplitude;
        const my = (this.mouseY || 0) * amplitude * 0.65;

        ctx.globalCompositeOperation = "lighter";

        for (let i = 0; i < particles.length; i++) {
            const p = particles[i];
            const k = p.age / p.life;
            const envelope = smoothstep(0, 0.2, k) * (1 - smoothstep(0.75, 1, k));
            if (envelope <= 0) continue;

            // Parallax depth hierarchy (relative to wallpaper = 1.0):
            // Background (z≈0): ~0.3x | Midground (z≈0.7): ~1.5x | Foreground (z=1): 4.0x | bokeh: 6.0x
            const depthFactor = p.kind === KIND_BOKEH ? 6.0 : 0.3 + 3.7 * Math.pow(p.z, 1.4);
            const x = p.x + mx * depthFactor;
            const y = p.y + my * depthFactor;

            let beamGain = 1;
            if (beam > 0) {
                const d = x * nx + y * ny - beamCenter;
                beamGain = Math.max(0.1, 1 - beam * 0.4 + beam * 1.4 * Math.exp(-d * d * invBeamW2));
            }

            const shimmer = Math.max(0, 1 - twinkle * 0.35 * (0.5 + 0.5 * Math.sin(p.twPhase)));
            const glintK = p.glint > 0 ? Math.sin(Math.PI * (1 - p.glint / TUNING.glintDuration)) : 0;
            const alpha = Math.min(1, p.baseOpacity * opc * envelope * shimmer * beamGain * (1 + glintK));
            if (alpha < 0.003) continue;

            let half;
            if (p.kind === KIND_BOKEH) {
                // Slow "focus breathing" makes the bokeh feel like a living lens.
                half = p.radius * sizeMul * (1 + blur * 0.2) * (1 + 0.06 * Math.sin(p.twPhase * 0.5));
            } else {
                half = p.radius * sizeMul * 4;
            }

            ctx.globalAlpha = alpha;
            ctx.drawImage(sprites[p.kind][p.tint], x - half, y - half, half * 2, half * 2);

            if (glintK > 0) {
                const starHalf = Math.max(10, p.radius * sizeMul * 9) * (0.6 + 0.4 * glintK);
                ctx.globalAlpha = Math.min(1, glintK * opc * envelope * beamGain * 0.9);
                ctx.save();
                ctx.translate(x, y);
                ctx.rotate(p.glintRot + glintK * 0.25);
                ctx.drawImage(sprites.star, -starHalf, -starHalf, starHalf * 2, starHalf * 2);
                ctx.restore();
            }
        }

        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = "source-over";
    }

    static getSettingsSpec() {
        return [
            { key: "count", dataI18n: "particles.dust.count", label: t("particles.dust.count"), min: 100, max: 2000, step: 20, unit: t("unit.particles"), dataI18nUnit: "unit.particles" },
            { key: "speed", dataI18n: "particles.dust.speed", label: t("particles.dust.speed"), min: 0.1, max: 5, step: 0.1, unit: "x" },
            { key: "size", dataI18n: "particles.dust.size", label: t("particles.dust.size"), min: 0.1, max: 3.0, step: 0.1, unit: "x" },
            { key: "opacity", dataI18n: "particles.dust.opacity", label: t("particles.dust.opacity"), min: 0.1, max: 2, step: 0.1, unit: "x" },
            { key: "angle", dataI18n: "particles.dust.angle", label: t("particles.dust.angle"), tooltipKey: "particles.dust.tip_angle", min: -10, max: 10, step: 1, unit: "°" },
            { key: "twinkle", dataI18n: "particles.dust.twinkle", label: t("particles.dust.twinkle"), tooltipKey: "particles.dust.tip_twinkle", min: 0, max: 2, step: 0.1, unit: "x", defaultValue: DustEffect.DEFAULTS.twinkle },
            { key: "color", type: "color", dataI18n: "particles.dust.color", label: t("particles.dust.color") }
        ];
    }
}
