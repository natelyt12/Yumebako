/**
 * Parse a `#rrggbb` hex string into `"r, g, b"` for Canvas2D `rgba()` templates.
 * @param {string} color
 * @param {string} [fallback="255, 255, 255"]
 * @returns {string}
 */
export function parseColorRgb(color, fallback = "255, 255, 255") {
    if (typeof color === "string" && color.startsWith("#") && color.length >= 7) {
        const r = parseInt(color.slice(1, 3), 16);
        const g = parseInt(color.slice(3, 5), 16);
        const b = parseInt(color.slice(5, 7), 16);
        if (!Number.isNaN(r) && !Number.isNaN(g) && !Number.isNaN(b)) {
            return `${r}, ${g}, ${b}`;
        }
    }
    return fallback;
}

/**
 * Base class for canvas-rendered desktop particle effects.
 */
export class ParticleEffect {
    /**
     * @param {HTMLCanvasElement} canvas
     * @param {CanvasRenderingContext2D} ctx
     * @param {Object} config
     */
    constructor(canvas, ctx, config) {
        this.canvas = canvas;
        this.ctx = ctx;
        this.config = config;
        this.particles = [];
        this.mouseX = 0;
        this.mouseY = 0;
        this.parallaxAmplitude = 0;
    }

    /**
     * Reset and initialize the particle pool.
     */
    init() {
        this.particles = [];
    }

    /**
     * Update normalized pointer offsets and parallax amplitude.
     * @param {number} x
     * @param {number} y
     * @param {number} [amplitude=0]
     */
    setMouse(x, y, amplitude = 0) {
        this.mouseX = x;
        this.mouseY = y;
        this.parallaxAmplitude = amplitude;
    }

    /** Advance particle simulation by one frame. */
    update() { }

    /** Draw particles onto the 2D canvas context. */
    render() { }

    /** Handle canvas resize events. */
    resize() { }
}
