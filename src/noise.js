import { rng, lerp } from './core.js';

// Seeded 2D gradient noise with fbm and ridged variants.
export function createNoise(seed) {
  const r = rng(seed);
  const p = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
  const perm = new Uint8Array(512);
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const grad = (h, x, y) => {
    switch (h & 7) {
      case 0: return x + y; case 1: return x - y; case 2: return -x + y; case 3: return -x - y;
      case 4: return x; case 5: return -x; case 6: return y; default: return -y;
    }
  };
  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  function n(x, y) {
    const X = Math.floor(x), Y = Math.floor(y);
    x -= X; y -= Y;
    const xi = X & 255, yi = Y & 255, u = fade(x), v = fade(y);
    const a = perm[xi] + yi, b = perm[xi + 1] + yi;
    return lerp(
      lerp(grad(perm[a], x, y), grad(perm[b], x - 1, y), u),
      lerp(grad(perm[a + 1], x, y - 1), grad(perm[b + 1], x - 1, y - 1), u), v) * 0.7;
  }
  function fbm(x, y, o = 4) {
    let a = 0.5, f = 1, s = 0;
    for (let i = 0; i < o; i++) { s += a * n(x * f, y * f); f *= 2.03; a *= 0.5; }
    return s;
  }
  function ridged(x, y, o = 5) {
    let a = 0.5, f = 1, s = 0, w = 1;
    for (let i = 0; i < o; i++) {
      let v = 1 - Math.abs(n(x * f, y * f)) * 1.6;
      v = Math.max(0, v); v *= v * w; w = Math.min(1, v * 2);
      s += a * v; f *= 2.1; a *= 0.5;
    }
    return s;
  }
  return { n, fbm, ridged };
}
