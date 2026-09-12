import { BaseMotion, MAX_DT } from "../BaseMotion.js";
import { fbm1D } from "../noise.js";
import { t } from "/src/core/i18n.js";

// ==========================================
// ORGANIC MOTION — noise-steered damped spring
// ==========================================
/**
 * The "hand-held camera" model used by most 3D engines:
 *
 *     accel = -stiffness * pos - damping * vel + drive * noise(t)
 *
 * Unlike the other generators the noise drives *acceleration/velocity*, not
 * position, so the motion carries momentum from the previous frame and reads as
 * physical rather than as a moving curve.
 *
 * `drive` is kept equal to `stiffness` on purpose: that makes the static gain
 * exactly 1, so the output stays bounded around ±1 and the panel amplitude
 * sliders keep the same meaning as everywhere else. Higher stiffness therefore
 * only raises the natural frequency (the spring tracks finer noise detail
 * instead of ringing at its own frequency).
 *
 * `damping` controls the damping ratio ζ = damping / (2·√stiffness):
 *   ζ < 1 → underdamped, more swing and overshoot.
 *   ζ ≈ 1 → critically damped, heavy and smooth.
 */
export class OrganicMotion extends BaseMotion {
    static ID = "organic";
    static MAGNITUDE = 3.2;
    static DEFAULTS = {
        amplitudeX: 6,
        speedX: 1,
        amplitudeY: 6,
        speedY: 1.2,
        amplitudeRotate: 1.0,
        speedRotate: 0.8,
        stiffness: 2.2,
        damping: 1.4,
        detailScale: 0.22,
        persistence: 0.5,
    };

    constructor(config, seed) {
        super(config, seed);
        this.time = (seed || 0) * 0.137;
        this.axes = {
            x: { pos: 0, vel: 0, channel: 0 },
            y: { pos: 0, vel: 0, channel: 997 },
            rot: { pos: 0, vel: 0, channel: 313 },
        };
    }

    sample(channel, time, speed) {
        // Organic keeps a fixed 4 octaves; the exposed spring constants are what
        // shapes this generator, not the noise layering.
        return fbm1D(
            time * speed * this.param("detailScale"),
            this.seed + channel,
            4,
            2.0,
            this.param("persistence")
        );
    }

    step(axis, noise, dt, stiffness, damping) {
        const accel = -stiffness * axis.pos - damping * axis.vel + stiffness * noise;
        axis.vel += accel * dt;
        axis.pos += axis.vel * dt;
    }

    update(dt) {
        const h = Math.min(dt, MAX_DT);
        this.time += h;

        const stiffness = Math.max(0.01, this.param("stiffness"));
        const damping = Math.max(0, this.param("damping"));

        this.step(this.axes.x, this.sample(0, this.time, this.param("speedX")), h, stiffness, damping);
        this.step(this.axes.y, this.sample(997, this.time, this.param("speedY")), h, stiffness, damping);
        this.step(this.axes.rot, this.sample(313, this.time, this.param("speedRotate")), h, stiffness, damping);

        const M = OrganicMotion.MAGNITUDE;

        return {
            x: this.axes.x.pos * M * this.param("amplitudeX"),
            y: this.axes.y.pos * M * this.param("amplitudeY"),
            rot: this.axes.rot.pos * this.param("amplitudeRotate"),
        };
    }

    reset() {
        this.time = Math.random() * 1000;
        // Ease in from a small random offset rather than snapping to centre.
        Object.values(this.axes).forEach((axis) => {
            axis.pos = (Math.random() - 0.5) * 0.2;
            axis.vel = 0;
        });
    }

    static getSettingsSpec() {
        return [
            { key: "amplitudeX", label: t("wavy.amp_x"), min: 0, max: 10, step: 1, unit: "px", group: "x", tooltipKey: "wavy.tip_amp_x" },
            { key: "speedX", label: t("wavy.speed_x"), min: 0.1, max: 4.0, step: 0.1, unit: "x", group: "x", tooltipKey: "wavy.tip_speed_x" },
            { key: "amplitudeY", label: t("wavy.amp_y"), min: 0, max: 10, step: 1, unit: "px", group: "y", tooltipKey: "wavy.tip_amp_y" },
            { key: "speedY", label: t("wavy.speed_y"), min: 0.1, max: 4.0, step: 0.1, unit: "x", group: "y", tooltipKey: "wavy.tip_speed_y" },
            { key: "amplitudeRotate", label: t("wavy.rot_angle"), min: 0, max: 3, step: 0.1, unit: "deg", group: "rot", tooltipKey: "wavy.tip_rotate" },
            { key: "speedRotate", label: t("wavy.rot_speed"), min: 0, max: 3.0, step: 0.1, unit: "x", group: "rot", tooltipKey: "wavy.tip_rotate_speed" },
            { key: "stiffness", label: t("wavy.organic_stiffness"), min: 0.5, max: 8.0, step: 0.1, unit: "x", group: "spring", tooltipKey: "wavy.tip_stiffness" },
            { key: "damping", label: t("wavy.organic_damping"), min: 0.3, max: 4.0, step: 0.1, unit: "x", group: "spring", tooltipKey: "wavy.tip_damping" },
            { key: "detailScale", label: t("wavy.motion_detail_scale"), min: 0.05, max: 1.0, step: 0.01, unit: "x", group: "spring", tooltipKey: "wavy.tip_detail_scale" },
            { key: "persistence", label: t("wavy.motion_persistence"), min: 0.2, max: 0.8, step: 0.05, unit: "x", group: "spring", tooltipKey: "wavy.tip_persistence" },
        ];
    }
}
