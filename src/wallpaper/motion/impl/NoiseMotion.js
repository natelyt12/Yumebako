import { BaseMotion, MAX_DT } from "../BaseMotion.js";
import { fbm1D } from "../noise.js";
import { t } from "/src/core/i18n.js";

// ==========================================
// NOISE MOTION — fractal value noise (fBm)
// ==========================================
/**
 * Position = fBm(t) directly. Aperiodic, smooth and multi-scale: the slow
 * octaves read as a calm drift while the fine octaves add the small "texture"
 * that makes the movement feel non-repeating.
 *
 * MAGNITUDE exists because fBm only reaches ~0.35 of its theoretical [-1, 1]
 * range, while the panel's amplitude sliders are calibrated so that a value
 * roughly equals the pixel displacement of the removed classic-wave generator
 * (which reached ~1.0). Rotation is left untouched so its value stays literal
 * degrees.
 *
 * The defaults are deliberately tuned CALM: the drift is slow (low
 * `detailScale`), the finest octave is dropped (`octaves: 3`) and the fine-layer
 * weight is softened (`persistence: 0.45`). A faster, grainier drift reads as
 * jittery and caused mild dizziness, so the amplitude is instead carried by
 * larger translation (8px) with a smaller tilt (0.9°).
 */
export class NoiseMotion extends BaseMotion {
    static ID = "noise";
    static MAGNITUDE = 3.6;
    static DEFAULTS = {
        amplitudeX: 8,
        speedX: 1,
        amplitudeY: 8,
        speedY: 1.2,
        amplitudeRotate: 0.9,
        speedRotate: 0.7,
        detailScale: 0.17,
        octaves: 3,
        persistence: 0.45,
    };

    constructor(config, seed) {
        super(config, seed);
        this.time = (seed || 0) * 0.137;
    }

    sample(channel, time, speed) {
        const octaves = Math.max(1, Math.round(this.param("octaves")));
        return fbm1D(
            time * speed * this.param("detailScale"),
            this.seed + channel,
            octaves,
            2.0,
            this.param("persistence")
        );
    }

    update(dt) {
        this.time += Math.min(dt, MAX_DT);
        const time = this.time;

        return {
            x: this.sample(0, time, this.param("speedX")) * NoiseMotion.MAGNITUDE * this.param("amplitudeX"),
            y: this.sample(997, time, this.param("speedY")) * NoiseMotion.MAGNITUDE * this.param("amplitudeY"),
            rot: this.sample(313, time, this.param("speedRotate")) * this.param("amplitudeRotate"),
        };
    }

    reset() {
        this.time = Math.random() * 1000;
    }

    static getSettingsSpec() {
        return [
            { key: "amplitudeX", label: t("wavy.amp_x"), min: 0, max: 10, step: 1, unit: "px", group: "x", tooltipKey: "wavy.tip_amp_x" },
            { key: "speedX", label: t("wavy.speed_x"), min: 0.1, max: 4.0, step: 0.1, unit: "x", group: "x", tooltipKey: "wavy.tip_speed_x" },
            { key: "amplitudeY", label: t("wavy.amp_y"), min: 0, max: 10, step: 1, unit: "px", group: "y", tooltipKey: "wavy.tip_amp_y" },
            { key: "speedY", label: t("wavy.speed_y"), min: 0.1, max: 4.0, step: 0.1, unit: "x", group: "y", tooltipKey: "wavy.tip_speed_y" },
            { key: "amplitudeRotate", label: t("wavy.rot_angle"), min: 0, max: 3, step: 0.1, unit: "deg", group: "rot", tooltipKey: "wavy.tip_rotate" },
            { key: "speedRotate", label: t("wavy.rot_speed"), min: 0, max: 3.0, step: 0.1, unit: "x", group: "rot", tooltipKey: "wavy.tip_rotate_speed" },
            { key: "detailScale", label: t("wavy.motion_detail_scale"), min: 0.05, max: 1.0, step: 0.01, unit: "x", group: "detail", tooltipKey: "wavy.tip_detail_scale" },
            { key: "octaves", label: t("wavy.motion_octaves"), min: 1, max: 6, step: 1, unit: "", group: "detail", tooltipKey: "wavy.tip_octaves" },
            { key: "persistence", label: t("wavy.motion_persistence"), min: 0.2, max: 0.8, step: 0.05, unit: "x", group: "detail", tooltipKey: "wavy.tip_persistence" },
        ];
    }
}
