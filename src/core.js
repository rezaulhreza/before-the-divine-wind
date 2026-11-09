import * as THREE from 'three';

// Shared game state. Every module reads and writes this hub.
export const G = {
  time: 0, dt: 0, rawDt: 0, timeScale: 1, slowUntil: 0, slowScale: 1,
  enemies: [], actors: [], projectiles: [], colliders: [], walls: [], interacts: [],
  stats: { open: 0, shadow: 0, routed: 0, deaths: 0 },
  fear: 0, maxTokens: 1, tokens: 0, mode: 'title', frameWaiters: [],
  bounds: null, shakeAmt: 0, checkpoint: null, onEnemyDown: null,
};

G.frame = () => new Promise((r) => G.frameWaiters.push(r));
G.slow = (scale, dur) => { G.slowScale = scale; G.slowUntil = performance.now() + dur * 1000; };
G.hitStop = (dur = 0.06) => G.slow(0.04, dur);
G.shake = (a) => { G.shakeAmt = Math.max(G.shakeAmt, a); };

export const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
export const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));
export const TAU = Math.PI * 2;
export function angDiff(a, b) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}
export const dampAngle = (a, b, k, dt) => a + angDiff(a, b) * (1 - Math.exp(-k * dt));
export function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const rand = (a = 1, b) => (b === undefined ? Math.random() * a : a + Math.random() * (b - a));
export const dist2 = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);
