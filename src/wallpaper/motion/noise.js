/**
 * noise.js
 * ---------------------------------------------------------------------------
 * Shared noise primitives for the procedural motion generators.
 * Pure functions, no state, no imports — safe to use from any motion impl.
 */

/**
 * Fast integer hash -> float in [0, 1). Deterministic for a given (n, seed).
 */
export function hash1(n, seed) {
    let h = Math.imul(n | 0, 0x27d4eb2d) ^ Math.imul(seed | 0, 0x9e3779b1);
    h ^= h >>> 15;
    h = Math.imul(h, 0x85ebca6b);
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
}

// Perlin's quintic fade — C2-continuous, avoids visible "kinks" at lattice points.
const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
const lerp = (a, b, t) => a + (b - a) * t;

/** Smooth 1D value noise in [0, 1). */
export function valueNoise1D(x, seed) {
    const i = Math.floor(x);
    const f = x - i;
    return lerp(hash1(i, seed), hash1(i + 1, seed), fade(f));
}

/**
 * Fractal Brownian motion (layered value noise) in ~[-1, 1].
 * Each octave adds finer detail at lower energy, producing natural, detailed
 * drift instead of a single slow wobble.
 *
 * @param {number} x - Sample position (noise-space, typically time * frequency).
 * @param {number} seed - Seed for this channel.
 * @param {number} octaves - Number of noise layers.
 * @param {number} lacunarity - Frequency multiplier per octave.
 * @param {number} gain - Amplitude multiplier per octave (persistence).
 */
export function fbm1D(x, seed, octaves = 4, lacunarity = 2.0, gain = 0.5) {
    let amp = 1;
    let freq = 1;
    let sum = 0;
    let norm = 0;

    for (let o = 0; o < octaves; o++) {
        // valueNoise1D -> [0,1), remap to signed [-1,1)
        sum += amp * (valueNoise1D(x * freq, seed + o * 1013) * 2 - 1);
        norm += amp;
        amp *= gain;
        freq *= lacunarity;
    }

    return norm > 0 ? sum / norm : 0;
}
