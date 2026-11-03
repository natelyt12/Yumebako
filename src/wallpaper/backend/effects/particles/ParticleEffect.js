export class ParticleEffect {
    constructor(canvas, ctx, config) {
        this.canvas = canvas;
        this.ctx = ctx;
        this.config = config;
        this.particles = [];
        this.mouseX = 0;
        this.mouseY = 0;
        this.parallaxAmplitude = 0;
    }
    init() {
        this.particles = [];
    }
    setMouse(x, y, amplitude = 0) {
        this.mouseX = x;
        this.mouseY = y;
        this.parallaxAmplitude = amplitude;
    }
    update() { }
    render() { }
    resize() { }
    static getSettingsHTML() {
        return "";
    }
}
