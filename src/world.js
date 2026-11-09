import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { G, clamp, lerp, smooth, rng, TAU } from './core.js';
import { createNoise } from './noise.js';

export const SIZE = 800, SEG = 320, N = SEG + 1, CELL = SIZE / SEG, HALF = SIZE / 2;
export const LOC = {
  beach: { x: 0, z: 296 }, bamboo: { x: -70, z: 190 }, shrine: { x: -130, z: 95 },
  village: { x: 10, z: 20 }, camp: { x: 150, z: -70 }, fort: { x: 40, z: -215 }, cliff: { x: -12, z: -200 },
};

const noise = createNoise(11);
const R = rng(2024);
const rr = (a, b) => a + R() * (b - a);

// Flattened areas. fr = flat radius, dr = bare earth radius.
const ZONES = [
  { x: -70, z: 190, fr: 26, h: 9, dr: 0 },
  { x: -130, z: 95, fr: 22, h: 17, dr: 9 },
  { x: 10, z: 20, fr: 40, h: 10, dr: 27 },
  { x: 150, z: -70, fr: 50, h: 14, dr: 20 },
  { x: 40, z: -215, fr: 45, h: 42, dr: 44, b: 2.7 },
  { x: -12, z: -200, fr: 9, h: 47, dr: 0 },
];
const TALL = [
  { x: 150, z: -70, r0: 21, r1: 52 },
  { x: 54, z: -166, r0: 0, r1: 13 }, { x: 26, z: -160, r0: 0, r1: 11 }, { x: 40, z: -150, r0: 0, r1: 9 },
  { x: -92, z: 80, r0: 0, r1: 13 }, { x: -30, z: 52, r0: 0, r1: 10 },
];
const PATHS = [
  [[0, 284], [-28, 252], [-56, 218], [-70, 192]],
  [[-70, 190], [-90, 165], [-118, 138], [-130, 118], [-130, 98]],
  [[-130, 100], [-105, 84], [-60, 62], [-22, 40], [2, 26]],
  [[20, 10], [60, -15], [100, -38], [130, -58]],
  [[150, -92], [120, -128], [72, -148], [40, -164], [40, -186]],
];
function pathDist(x, z) {
  let best = 1e9;
  for (const p of PATHS) for (let i = 0; i < p.length - 1; i++) {
    const ax = p[i][0], az = p[i][1], bx = p[i + 1][0], bz = p[i + 1][1];
    const vx = bx - ax, vz = bz - az;
    const t = clamp(((x - ax) * vx + (z - az) * vz) / (vx * vx + vz * vz), 0, 1);
    const d = Math.hypot(x - ax - vx * t, z - az - vz * t);
    if (d < best) best = d;
  }
  return best;
}
const bambooFactor = (x, z) => 1 - smooth(52, 74, Math.min(Math.hypot(x + 70, z - 190), Math.hypot(x + 94, z - 158) + 26));

function rawHeight(x, z) {
  const warp = noise.fbm(x * 0.004 + 10, z * 0.004 - 3, 3) * 70;
  const d = Math.hypot(x, z * 0.92) + warp;
  const m = 1 - smooth(300, 385, d);
  let h = 9 + noise.fbm(x * 0.007, z * 0.007, 5) * 24;
  if (h < 2.8) h = 2.8 - (2.8 - h) * 0.15;
  const mt = smooth(-110, -300, z);
  h += noise.ridged(x * 0.006 + 3, z * 0.006, 5) * 100 * mt * mt;
  h = h * m - (1 - m) * 10;
  const bt = smooth(238, 268, z) * (1 - smooth(150, 230, Math.abs(x)));
  h = lerp(h, Math.max(-4, (318 - z) * 0.07), bt);
  for (const zn of ZONES) {
    const t = 1 - smooth(zn.fr, zn.fr * (zn.b || 1.9), Math.hypot(x - zn.x, z - zn.z));
    if (t > 0) h = lerp(h, zn.h, t);
  }
  return h;
}

const heights = new Float32Array(N * N);
const tallMask = new Float32Array(N * N);
for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) heights[j * N + i] = rawHeight(-HALF + i * CELL, -HALF + j * CELL);

function sample(arr, x, z) {
  const fx = clamp((x + HALF) / CELL, 0, SEG - 0.001), fz = clamp((z + HALF) / CELL, 0, SEG - 0.001);
  const i = fx | 0, j = fz | 0, u = fx - i, v = fz - j, a = j * N + i;
  return lerp(lerp(arr[a], arr[a + 1], u), lerp(arr[a + N], arr[a + N + 1], u), v);
}
export const heightAt = (x, z) => sample(heights, x, z);
export const isTall = (x, z) => sample(tallMask, x, z) > 0.45;
export const at = (x, z, dy = 0) => new THREE.Vector3(x, heightAt(x, z) + dy, z);

// ------------------------------------------------------------------ shared uniforms
const uTime = { value: 0 }, uWind = { value: 1 };
const cv = (hex) => new THREE.Color(hex);

function canvasTex(size, draw) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d'); draw(g, size);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}
function flowerTex(hue0, hue1, sat, l0, l1, core) {
  return canvasTex(256, (g, s) => {
    for (let i = 0; i < 80; i++) {
      const a = R() * TAU, r = Math.sqrt(R()) * s * 0.43, x = s / 2 + Math.cos(a) * r, y = s / 2 + Math.sin(a) * r;
      const rad = s * (0.035 + R() * 0.05);
      g.fillStyle = `hsl(${rr(hue0, hue1)},${sat}%,${rr(l0, l1)}%)`;
      for (let k = 0; k < 5; k++) {
        const pa = (k / 5) * TAU + a;
        g.beginPath(); g.ellipse(x + Math.cos(pa) * rad * 0.6, y + Math.sin(pa) * rad * 0.6, rad * 0.6, rad * 0.4, pa, 0, TAU); g.fill();
      }
      if (core) { g.fillStyle = core; g.beginPath(); g.arc(x, y, rad * 0.2, 0, TAU); g.fill(); }
    }
  });
}
const texBlossom = flowerTex(336, 352, 85, 80, 95, '#c9517a');
const texMaple = flowerTex(4, 30, 88, 38, 55, null);
const texBamboo = canvasTex(256, (g, s) => {
  for (let i = 0; i < 46; i++) {
    const x = rr(0.15, 0.85) * s, y = rr(0.12, 0.8) * s, a = rr(0.5, 2.6), len = rr(0.16, 0.28) * s;
    g.fillStyle = `hsl(${rr(78, 104)},${rr(40, 58)}%,${rr(26, 46)}%)`;
    g.beginPath(); g.ellipse(x + Math.cos(a) * len * 0.5, y + Math.sin(a) * len * 0.5, len * 0.5, len * 0.085, a, 0, TAU); g.fill();
  }
});
const texDetail = canvasTex(256, (g, s) => {
  const im = g.createImageData(s, s);
  for (let i = 0; i < s * s; i++) { const v = 200 + R() * 55; im.data[i * 4] = im.data[i * 4 + 1] = im.data[i * 4 + 2] = v; im.data[i * 4 + 3] = 255; }
  g.putImageData(im, 0, 0);
  for (let i = 0; i < 260; i++) { g.fillStyle = `rgba(${R() < 0.5 ? 0 : 255},${R() < 0.5 ? 0 : 255},0,0.035)`; g.beginPath(); g.arc(R() * s, R() * s, rr(3, 14), 0, TAU); g.fill(); }
});
texDetail.wrapS = texDetail.wrapT = THREE.RepeatWrapping; texDetail.repeat.set(220, 220);

// Foliage built from alpha cards with outward normals: soft, rounded shading.
function foliageMat(map, color = 0xffffff, emissive = 0x000000) {
  const m = new THREE.MeshLambertMaterial({ map, alphaTest: 0.42, side: THREE.DoubleSide, color, emissive });
  m.onBeforeCompile = (s) => {
    s.uniforms.uTime = uTime; s.uniforms.uWind = uWind;
    s.vertexShader = 'uniform float uTime; uniform float uWind;\n' + s.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      #ifdef USE_INSTANCING
        float ph = instanceMatrix[3].x * 0.37 + instanceMatrix[3].z * 0.23;
      #else
        float ph = 0.0;
      #endif
      float sw = sin(uTime * 1.6 + ph + position.y * 0.5) * 0.07 + sin(uTime * 3.3 + ph * 1.7 + position.x * 1.3) * 0.035;
      transformed.x += sw * uWind * max(position.y, 0.0) * 0.4;
      transformed.z += sw * uWind * max(position.y, 0.0) * 0.25;`);
    s.fragmentShader = s.fragmentShader.replace('#include <normal_fragment_begin>', 'float faceDirection = 1.0; vec3 normal = normalize( vNormal ); vec3 nonPerturbedNormal = normal;');
  };
  return m;
}
function depthMat(map) { return new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map, alphaTest: 0.42 }); }

function foliageGeo(blobs, perBlob, size, squash = 0.8) {
  const pos = [], nor = [], uv = [], idx = [];
  const d = new THREE.Vector3(), t1 = new THREE.Vector3(), t2 = new THREE.Vector3(), qn = new THREE.Vector3(), c = new THREE.Vector3();
  for (const b of blobs) for (let k = 0; k < perBlob; k++) {
    d.set(rr(-1, 1), rr(-1, 1), rr(-1, 1)).normalize();
    const rad = b.r * (0.5 + 0.5 * R());
    c.set(b.x + d.x * rad, b.y + d.y * rad * squash, b.z + d.z * rad);
    qn.set(d.x + rr(-0.9, 0.9), d.y + rr(-0.9, 0.9), d.z + rr(-0.9, 0.9)).normalize();
    t1.set(rr(-1, 1), rr(-1, 1), rr(-1, 1)).cross(qn).normalize(); t2.crossVectors(qn, t1);
    const s = size * rr(0.75, 1.25), base = pos.length / 3;
    const nx = d.x, ny = d.y + 0.35, nz = d.z, nl = Math.hypot(nx, ny, nz);
    for (const [a, bb] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      pos.push(c.x + (t1.x * a + t2.x * bb) * s, c.y + (t1.y * a + t2.y * bb) * s, c.z + (t1.z * a + t2.z * bb) * s);
      nor.push(nx / nl, ny / nl, nz / nl); uv.push((a + 1) / 2, (bb + 1) / 2);
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}
function limb(a, b, r1, r2) {
  const dir = b.clone().sub(a), len = dir.length();
  const g = new THREE.CylinderGeometry(r2, r1, len, 6, 1);
  g.translate(0, len / 2, 0);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize()));
  g.translate(a.x, a.y, a.z);
  return g;
}
function treeVariant(spread, height, cards, size) {
  const limbs = [], blobs = [];
  const base = new THREE.Vector3(0, -0.4, 0), mid = new THREE.Vector3(rr(-0.4, 0.4), height * 0.3, rr(-0.4, 0.4)), fork = new THREE.Vector3(mid.x + rr(-0.3, 0.3), height * 0.48, mid.z + rr(-0.3, 0.3));
  limbs.push(limb(base, mid, 0.34, 0.26), limb(mid, fork, 0.26, 0.2));
  const nb = 4 + Math.floor(R() * 2);
  for (let i = 0; i < nb; i++) {
    const a = (i / nb) * TAU + rr(-0.4, 0.4), rad = spread * rr(0.6, 1), tip = new THREE.Vector3(fork.x + Math.cos(a) * rad, height * rr(0.72, 0.95), fork.z + Math.sin(a) * rad);
    const elbow = fork.clone().lerp(tip, 0.55); elbow.y += 0.3;
    limbs.push(limb(fork, elbow, 0.17, 0.11), limb(elbow, tip, 0.11, 0.05));
    blobs.push({ x: tip.x, y: tip.y + 0.2, z: tip.z, r: spread * rr(0.5, 0.68) });
    blobs.push({ x: elbow.x * 1.1, y: elbow.y + 0.9, z: elbow.z * 1.1, r: spread * rr(0.36, 0.5) });
  }
  blobs.push({ x: fork.x, y: height * 1.02, z: fork.z, r: spread * 0.62 });
  return { trunk: mergeGeometries(limbs), leaves: foliageGeo(blobs, cards, size) };
}

// ------------------------------------------------------------------ atmosphere presets
const PRESETS = {
  storm: { top: '#18202c', hor: '#c96a36', sun: '#ff7b3a', sunI: 3.0, sunDir: [-0.45, 0.12, 0.88], hemiS: '#6c80a0', hemiG: '#33261f', hemiI: 2.0, fog: '#6a4638', fogD: 0.0068, cloud: 0.8, cloudCol: '#2c2b35', stars: 0, rain: 0.4, expo: 1.0, wind: 1.6, amb: '#ff7a2a', ambN: 0.55, ambGlow: 3.2, sat: 0.92, tint: '#ffe2cc', lightning: 1 },
  mist: { top: '#8fb3c9', hor: '#f0e6cf', sun: '#fff0cc', sunI: 3.0, sunDir: [0.55, 0.5, 0.35], hemiS: '#d4e4ea', hemiG: '#566a44', hemiI: 2.3, fog: '#cdd8cc', fogD: 0.015, cloud: 0.4, cloudCol: '#ffffff', stars: 0, rain: 0, expo: 0.95, wind: 0.7, amb: '#b9d07a', ambN: 0.3, ambGlow: 1, sat: 1.0, tint: '#f4fff0', lightning: 0 },
  day: { top: '#3f7fc8', hor: '#dfeaf2', sun: '#fff2d8', sunI: 3.6, sunDir: [0.4, 0.62, 0.45], hemiS: '#bcd8f0', hemiG: '#5f7044', hemiI: 2.2, fog: '#d9e6ee', fogD: 0.0032, cloud: 0.42, cloudCol: '#ffffff', stars: 0, rain: 0, expo: 0.95, wind: 1.0, amb: '#ffc9da', ambN: 1, ambGlow: 1, sat: 1.08, tint: '#fffaf2', lightning: 0 },
  sunset: { top: '#2a3560', hor: '#ff9a58', sun: '#ff7a38', sunI: 3.6, sunDir: [-0.78, 0.17, 0.3], hemiS: '#8088c0', hemiG: '#3c2c28', hemiI: 2.5, fog: '#9a6654', fogD: 0.0058, cloud: 0.5, cloudCol: '#4a3c58', stars: 0, rain: 0, expo: 1.0, wind: 1.2, amb: '#ff8a3a', ambN: 0.85, ambGlow: 3.2, sat: 1.05, tint: '#fff0e2', lightning: 0 },
  night: { top: '#03060d', hor: '#16233a', sun: '#93b4ff', sunI: 2.4, sunDir: [0.35, 0.55, -0.5], hemiS: '#3a5a8c', hemiG: '#10151d', hemiI: 2.1, fog: '#0c131e', fogD: 0.0105, cloud: 0.68, cloudCol: '#0e1524', stars: 0.6, rain: 1, expo: 1.08, wind: 1.3, amb: '#8fa0b8', ambN: 0, ambGlow: 1, sat: 0.82, tint: '#d4e2ff', lightning: 0.35 },
  predawn: { top: '#0e1428', hor: '#6e5a74', sun: '#b4c0f0', sunI: 2.6, sunDir: [0.7, 0.32, 0.4], hemiS: '#52668f', hemiG: '#1b1820', hemiI: 2.4, fog: '#262a3c', fogD: 0.0066, cloud: 0.86, cloudCol: '#161829', stars: 0.1, rain: 0.8, expo: 1.05, wind: 1.7, amb: '#ff8a3a', ambN: 0.3, ambGlow: 3, sat: 0.88, tint: '#dfe2ff', lightning: 1 },
  dawn: { top: '#5f86c4', hor: '#ffc49a', sun: '#ffcf9a', sunI: 3.5, sunDir: [0.8, 0.18, 0.3], hemiS: '#cfc6e2', hemiG: '#64504a', hemiI: 2.0, fog: '#f0c6b4', fogD: 0.0042, cloud: 0.45, cloudCol: '#ffb49a', stars: 0, rain: 0, expo: 1.0, wind: 1.1, amb: '#ffc4d8', ambN: 1, ambGlow: 1, sat: 1.06, tint: '#fff0e4', lightning: 0 },
};
const COLS = ['top', 'hor', 'sun', 'hemiS', 'hemiG', 'fog', 'cloudCol', 'amb', 'tint'];
const NUMS = ['sunI', 'hemiI', 'fogD', 'cloud', 'stars', 'rain', 'expo', 'wind', 'ambN', 'ambGlow', 'sat', 'lightning'];
for (const p of Object.values(PRESETS)) { for (const k of COLS) p[k] = cv(p[k]); p.sunDir = new THREE.Vector3(...p.sunDir).normalize(); }
function clonePreset(p) { const o = {}; for (const k of COLS) o[k] = p[k].clone(); for (const k of NUMS) o[k] = p[k]; o.sunDir = p.sunDir.clone(); return o; }

export const world = {
  fires: [], atm: clonePreset(PRESETS.day), from: null, to: null, lerpT: 1, lerpDur: 1, flash: 0, nextBolt: 8,
  uTime, heightAt, isTall, gate: null, name: 'day',
  setAtmosphere(name, dur = 0) {
    this.name = name;
    if (dur <= 0) { this.atm = clonePreset(PRESETS[name]); this.lerpT = 1; return; }
    this.from = clonePreset(this.atm); this.to = PRESETS[name]; this.lerpT = 0; this.lerpDur = dur;
  },
  lightning() { this.flash = 1; G.audio?.thunder(); },
};

// ------------------------------------------------------------------ build
export function buildWorld(scene) {
  const M = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: o.r ?? 0.9, metalness: o.m ?? 0, emissive: o.e ?? 0, emissiveIntensity: o.ei ?? 1, side: o.side ?? THREE.FrontSide, flatShading: !!o.flat });
  const mats = {
    wood: M(0x4a3526), woodD: M(0x241a14), woodL: M(0x8a6a48), plaster: M(0xcfc4ae), thatch: M(0x8f7a4a, { side: THREE.DoubleSide }), char: M(0x15110f, { side: THREE.DoubleSide }),
    stone: M(0x77736c, { flat: true }), red: M(0xa8261a, { r: 0.6 }), black: M(0x121214, { r: 0.6 }), tile: M(0x2a2e36, { r: 0.7, side: THREE.DoubleSide }), felt: M(0xb9ae98), feltD: M(0x6e5c48),
    gold: M(0xc9a040, { m: 0.6, r: 0.4 }), glow: M(0xffb060, { e: 0xff8a30, ei: 3.5 }), hull: M(0x2a1d16), sail: M(0x6a2a1c, { side: THREE.DoubleSide }),
  };
  const add = (parent, geo, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => {
    const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); m.castShadow = m.receiveShadow = true; parent.add(m); return m;
  };
  const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
  const cyl = (a, b, h, s = 8) => new THREE.CylinderGeometry(a, b, h, s);
  const group = (x, z, rot = 0, dy = 0) => { const g = new THREE.Group(); g.position.set(x, heightAt(x, z) + dy, z); g.rotation.y = rot; scene.add(g); return g; };
  const fire = (x, y, z, s, smoke = true) => world.fires.push({ x, y, z, s, smoke });
  const collide = (x, z, r) => G.colliders.push({ x, z, r });

  // ---------- terrain
  const geo = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG); geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  for (let i = 0; i < N * N; i++) pos.setY(i, heights[i]);
  geo.computeVertexNormals();
  const nrm = geo.attributes.normal, col = new Float32Array(N * N * 3), grassMask = new Float32Array(N * N);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const k = j * N + i, x = -HALF + i * CELL, z = -HALF + j * CELL, h = heights[k], slope = 1 - nrm.getY(k);
    const n1 = clamp(noise.fbm(x * 0.035, z * 0.035, 3) + 0.5, 0, 1), n2 = noise.fbm(x * 0.15 + 7, z * 0.15, 2);
    let r = lerp(0.06, 0.135, n1), g = lerp(0.14, 0.235, n1), b = lerp(0.03, 0.062, n1);
    const hi = smooth(34, 62, h); r = lerp(r, 0.24, hi); g = lerp(g, 0.225, hi); b = lerp(b, 0.12, hi);
    const bam = bambooFactor(x, z); r = lerp(r, 0.19, bam * 0.65); g = lerp(g, 0.19, bam * 0.65); b = lerp(b, 0.085, bam * 0.65);
    const rk = smooth(0.2, 0.4, slope + n2 * 0.08), rv = 0.8 + n2 * 0.5;
    r = lerp(r, 0.27 * rv, rk); g = lerp(g, 0.255 * rv, rk); b = lerp(b, 0.24 * rv, rk);
    const sn = smooth(72, 88, h + (n1 - 0.5) * 20) * (1 - smooth(0.5, 0.75, slope));
    r = lerp(r, 0.86, sn); g = lerp(g, 0.88, sn); b = lerp(b, 0.92, sn);
    let dirt = 0;
    for (const zn of ZONES) if (zn.dr > 0) dirt = Math.max(dirt, 1 - smooth(zn.dr * 0.78, zn.dr * 1.15, Math.hypot(x - zn.x, z - zn.z) + n2 * 6));
    dirt = Math.max(dirt, (1 - smooth(1.0, 3.8, pathDist(x, z) + n2 * 1.6)) * 0.92);
    const dv = 0.85 + n2 * 0.45;
    r = lerp(r, 0.25 * dv, dirt); g = lerp(g, 0.19 * dv, dirt); b = lerp(b, 0.125 * dv, dirt);
    const sd = 1 - smooth(1.6, 3.6, h + n2 * 1.4), wet = 1 - smooth(-0.2, 1.0, h);
    r = lerp(r, lerp(0.6, 0.3, wet), sd); g = lerp(g, lerp(0.53, 0.26, wet), sd); b = lerp(b, lerp(0.39, 0.2, wet), sd);
    col[k * 3] = r; col[k * 3 + 1] = g; col[k * 3 + 2] = b;
    const gm = smooth(2.6, 3.8, h) * (1 - rk) * (1 - smooth(48, 58, h)) * (1 - dirt) * (1 - bam * 0.7);
    grassMask[k] = gm;
    let tall = 0;
    for (const t of TALL) {
      const d = Math.hypot(x - t.x, z - t.z);
      tall = Math.max(tall, (t.r0 > 0 ? smooth(t.r0 - 2, t.r0 + 3, d) : 1) * (1 - smooth(t.r1 - 6, t.r1, d + n2 * 5)));
    }
    tallMask[k] = tall * smooth(0.2, 0.6, gm);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const uvA = geo.attributes.uv; // keep 0..1, repeat set on texture
  uvA.needsUpdate = true;
  const terrain = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96, metalness: 0, map: texDetail }));
  terrain.receiveShadow = true; scene.add(terrain);

  const hm = new Uint16Array(N * N * 4);
  for (let i = 0; i < N * N; i++) { hm[i * 4] = THREE.DataUtils.toHalfFloat(heights[i]); hm[i * 4 + 1] = THREE.DataUtils.toHalfFloat(grassMask[i]); hm[i * 4 + 2] = THREE.DataUtils.toHalfFloat(tallMask[i]); hm[i * 4 + 3] = THREE.DataUtils.toHalfFloat(1); }
  const hmTex = new THREE.DataTexture(hm, N, N, THREE.RGBAFormat, THREE.HalfFloatType);
  hmTex.magFilter = hmTex.minFilter = THREE.LinearFilter; hmTex.needsUpdate = true;
  const hmU = { uHM: { value: hmTex }, uHalf: { value: HALF }, uCell: { value: CELL }, uN: { value: N } };

  // ---------- sky
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { uFog: { value: cv(0) }, uTop: { value: cv(0) }, uHor: { value: cv(0) }, uSun: { value: cv(0) }, uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uCloudCol: { value: cv(0) }, uCloud: { value: 0.5 }, uStars: { value: 0 }, uTime, uSunI: { value: 1 }, uFlash: { value: 0 } },
    vertexShader: `varying vec3 vDir; void main(){ vDir = position; vec4 p = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * p; gl_Position.z = gl_Position.w; }`,
    fragmentShader: `
      varying vec3 vDir; uniform vec3 uTop, uHor, uSun, uSunDir, uCloudCol, uFog; uniform float uCloud, uStars, uTime, uSunI, uFlash;
      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f); return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y); }
      float fbm(vec2 p){ float a = 0.5, s = 0.0; for(int i=0;i<5;i++){ s += a*vn(p); p = p*2.03 + vec2(1.7, 9.2); a *= 0.5; } return s; }
      void main(){
        vec3 d = normalize(vDir);
        float h = clamp(d.y, 0.0, 1.0);
        vec3 col = mix(uHor, uTop, 1.0 - exp(-h * 4.2));
        col = mix(col, uHor * 0.5, smoothstep(0.0, -0.3, d.y));
        float sd = max(dot(d, uSunDir), 0.0);
        col += uSun * uSunI * (pow(sd, 5.0) * 0.07 + pow(sd, 48.0) * 0.16);
        float st = hash(floor(d.xz / (abs(d.y) + 0.35) * 190.0));
        col += step(0.9965, st) * uStars * (0.55 + 0.45 * sin(uTime * 2.0 + st * 80.0)) * smoothstep(0.02, 0.3, d.y) * 1.6;
        vec2 cp = d.xz / (max(d.y, 0.0) + 0.13);
        float n = fbm(cp * 0.85 + vec2(uTime * 0.011, uTime * 0.004)) * 0.72 + fbm(cp * 2.4 - vec2(uTime * 0.018, 0.0)) * 0.28;
        float cov = smoothstep(1.0 - uCloud, 1.32 - uCloud, n + 0.14);
        vec3 cc = mix(uCloudCol, uCloudCol * 0.4 + uSun * 0.95, pow(sd, 16.0) * 0.7);
        cc *= 0.72 + 0.5 * fbm(cp * 3.1 + 4.0);
        cc += uSun * (1.0 - cov) * 0.22 * pow(sd, 2.0);
        col = mix(col, cc, cov * smoothstep(0.0, 0.13, d.y) * 0.94);
        col += uSun * pow(sd, 1100.0) * 9.0 * (1.0 - cov * 0.8);
        col = mix(col, uFog, smoothstep(0.07, -0.01, d.y) * 0.8);
        col += uFlash * vec3(0.55, 0.65, 1.0) * (0.25 + 0.9 * n);
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 20), skyMat);
  sky.scale.setScalar(1500); sky.frustumCulled = false; sky.renderOrder = -10; scene.add(sky);

  // ---------- water
  const waterMat = new THREE.ShaderMaterial({
    fog: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uDeep: { value: cv('#0b2a3a') }, uShallow: { value: cv('#2f7f86') }, uSkyH: { value: cv(0) }, uSkyT: { value: cv(0) }, uSun: { value: cv(0) }, uSunDir: { value: new THREE.Vector3() }, uAmb: { value: 1 }, uT: { value: 0 }, uHM: { value: null }, uHalf: { value: HALF }, uCell: { value: CELL }, uN: { value: N } }]),
    vertexShader: `varying vec3 vW;
      #include <common>
      #include <fog_pars_vertex>
      void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vec4 mvPosition = viewMatrix * w; gl_Position = projectionMatrix * mvPosition;
      #include <fog_vertex>
      }`,
    fragmentShader: `varying vec3 vW; uniform vec3 uDeep, uShallow, uSkyH, uSkyT, uSun, uSunDir; uniform float uT, uAmb, uHalf, uCell, uN; uniform sampler2D uHM;
      #include <common>
      #include <fog_pars_fragment>
      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f); return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y); }
      void main(){
        vec2 p = vW.xz; vec3 n = vec3(0.0, 1.0, 0.0);
        vec2 d1 = normalize(vec2(0.3, -1.0)), d2 = normalize(vec2(-0.6, -0.8)), d3 = normalize(vec2(0.8, -0.5));
        n.xz -= d1 * 0.10 * cos(dot(d1, p) * 0.35 + uT * 1.1);
        n.xz -= d2 * 0.07 * cos(dot(d2, p) * 0.9 + uT * 1.7);
        n.xz -= d3 * 0.05 * cos(dot(d3, p) * 2.1 + uT * 2.4);
        n.xz += (vec2(vn(p * 1.3 + uT * 0.6), vn(p * 1.3 - uT * 0.5 + 9.0)) - 0.5) * 0.22;
        n = normalize(n);
        vec3 V = normalize(cameraPosition - vW);
        float fres = pow(1.0 - max(dot(n, V), 0.0), 4.0) * 0.92 + 0.05;
        vec3 Rf = reflect(-V, n); Rf.y = abs(Rf.y);
        vec3 skyc = mix(uSkyH, uSkyT, pow(clamp(Rf.y, 0.0, 1.0), 0.55));
        float sr = max(dot(Rf, uSunDir), 0.0);
        vec3 spec = uSun * (pow(sr, 220.0) * 5.0 + pow(sr, 24.0) * 0.35);
        float depth = -texture2D(uHM, ((p + uHalf) / uCell + 0.5) / uN).r;
        vec3 base = mix(uShallow, uDeep, smoothstep(0.0, 5.0, depth)) * uAmb;
        vec3 col = mix(base, skyc, fres) + spec;
        float fo = smoothstep(0.75, 0.0, depth + sin(uT * 1.3 + p.x * 0.35 + vn(p * 0.4) * 6.0) * 0.28) * (0.55 + 0.45 * vn(p * 3.0 + uT));
        col = mix(col, vec3(0.92) * (uAmb * 0.8 + 0.1) + uSun * 0.1, fo * 0.85);
        gl_FragColor = vec4(col, 1.0);
        #include <fog_fragment>
      }`,
  });
  waterMat.uniforms.uHM.value = hmTex;
  const water = new THREE.Mesh(new THREE.PlaneGeometry(3600, 3600), waterMat); water.rotation.x = -Math.PI / 2; water.position.y = 0; scene.add(water);

  // ---------- grass
  const GS = 60, GCOUNT = 215000;
  const bg = new THREE.InstancedBufferGeometry();
  bg.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, 0, 0, 0.5, 0, 0, -0.34, 0.5, 0, 0.34, 0.5, 0, 0, 1, 0], 3));
  bg.setIndex([0, 1, 2, 2, 1, 3, 2, 3, 4]);
  const off = new Float32Array(GCOUNT * 4);
  for (let i = 0; i < GCOUNT; i++) { off[i * 4] = R() * GS; off[i * 4 + 1] = R() * GS; off[i * 4 + 2] = R(); off[i * 4 + 3] = R(); }
  bg.setAttribute('aOff', new THREE.InstancedBufferAttribute(off, 4)); bg.instanceCount = GCOUNT;
  const grassMat = new THREE.ShaderMaterial({
    side: THREE.DoubleSide, fog: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uS: { value: GS }, uFocus: { value: new THREE.Vector3() }, uPlayer: { value: new THREE.Vector3() }, uT: { value: 0 }, uWindS: { value: 1 }, uHM: { value: null }, uHalf: { value: HALF }, uCell: { value: CELL }, uN: { value: N }, uBase: { value: cv('#14290d') }, uTip: { value: cv('#6c9634') }, uTallTip: { value: cv('#e8dcb4') }, uLight: { value: cv(0xffffff) } }]),
    vertexShader: `
      attribute vec4 aOff; uniform float uS, uT, uWindS, uHalf, uCell, uN; uniform vec3 uFocus, uPlayer; uniform sampler2D uHM;
      varying float vY; varying float vTall; varying float vShade;
      #include <common>
      #include <fog_pars_vertex>
      void main(){
        vec2 wp = mod(aOff.xy - uFocus.xz, uS) - uS * 0.5 + uFocus.xz;
        vec4 hm = texture2D(uHM, ((wp + uHalf) / uCell + 0.5) / uN);
        float fade = 1.0 - smoothstep(uS * 0.34, uS * 0.49, length(wp - uFocus.xz));
        float present = step(aOff.z * 0.92 + 0.06, hm.g);
        float tall = smoothstep(0.3, 0.6, hm.b);
        float hgt = (0.34 + aOff.w * 0.5) * (1.0 + tall * 2.3) * fade * present;
        float wid = 0.075 * (1.0 + tall * 0.4) * present * fade;
        float ang = aOff.z * 43.98;
        vec3 p = vec3(wp.x, hm.r - 0.06, wp.y);
        p.xz += vec2(cos(ang), sin(ang)) * position.x * wid;
        float y = position.y;
        float g = sin(uT * 1.25 + wp.x * 0.11 + wp.y * 0.16) * 0.5 + sin(uT * 2.6 + wp.x * 0.31 - wp.y * 0.23) * 0.25 + sin(uT * 0.6 + wp.x * 0.03) * 0.3;
        vec2 bend = vec2(0.85, 0.5) * (g * 0.5 + 0.3) * uWindS * hgt * 0.75;
        vec2 away = wp - uPlayer.xz; float pd = length(away);
        bend += away / (pd + 0.001) * (1.0 - smoothstep(0.0, 1.25, pd)) * 0.7 * hgt;
        p.xz += bend * y * y;
        p.y += hgt * y * (1.0 - 0.28 * length(bend) * y);
        vY = y; vTall = tall; vShade = 0.72 + 0.28 * aOff.w + g * 0.16 * y;
        vec4 mvPosition = viewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: `
      uniform vec3 uBase, uTip, uTallTip, uLight; varying float vY; varying float vTall; varying float vShade;
      #include <common>
      #include <fog_pars_fragment>
      void main(){
        vec3 tip = mix(uTip, uTallTip, vTall * smoothstep(0.45, 1.0, vY));
        vec3 col = mix(uBase, tip, vY * (0.4 + 0.6 * vY)) * vShade * uLight;
        gl_FragColor = vec4(col, 1.0);
        #include <fog_fragment>
      }`,
  });
  grassMat.uniforms.uHM.value = hmTex;
  const grass = new THREE.Mesh(bg, grassMat); grass.frustumCulled = false; scene.add(grass);

  // ---------- rain
  const RN = 3200, rp = new Float32Array(RN * 6), rs = new Float32Array(RN * 2);
  for (let i = 0; i < RN; i++) { const x = R() * 44, y = R() * 30, z = R() * 44; rp.set([x, y, z, x, y, z], i * 6); rs[i * 2] = 0; rs[i * 2 + 1] = 1; }
  const rg = new THREE.BufferGeometry(); rg.setAttribute('position', new THREE.BufferAttribute(rp, 3)); rg.setAttribute('aEnd', new THREE.BufferAttribute(rs, 1));
  const rainMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, uniforms: { uT: { value: 0 }, uCam: { value: new THREE.Vector3() }, uA: { value: 0 }, uCol: { value: cv('#aab8cc') } },
    vertexShader: `attribute float aEnd; uniform float uT; uniform vec3 uCam; varying float vA;
      void main(){ vec3 p = position; p.y = mod(p.y - uT * 26.0, 30.0); p.x += (30.0 - p.y) * -0.12; p.xz = mod(p.xz - uCam.xz, 44.0) - 22.0 + uCam.xz; p.y += uCam.y - 12.0;
        p.y += aEnd * 0.85; p.x += aEnd * 0.1; vA = aEnd; gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0); }`,
    fragmentShader: `uniform float uA; uniform vec3 uCol; varying float vA; void main(){ gl_FragColor = vec4(uCol, uA * (0.15 + 0.4 * vA)); }`,
  });
  const rain = new THREE.LineSegments(rg, rainMat); rain.frustumCulled = false; rain.renderOrder = 5; scene.add(rain);

  // ---------- lights
  const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1); scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffffff, 3); sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048); const sc = sun.shadow.camera; sc.left = -42; sc.right = 42; sc.top = 42; sc.bottom = -42; sc.near = 1; sc.far = 260;
  sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.06; scene.add(sun, sun.target);
  const fireLights = [];
  for (let i = 0; i < 4; i++) { const l = new THREE.PointLight(0xff7a30, 0, 42, 1.5); scene.add(l); fireLights.push(l); }
  scene.fog = new THREE.FogExp2(0xffffff, 0.005);

  // ---------- vegetation
  const dummy = new THREE.Object3D();
  function instanced(geo, mat, list, opts = {}) {
    const m = new THREE.InstancedMesh(geo, mat, list.length);
    list.forEach((t, i) => {
      dummy.position.set(t.x, t.y ?? heightAt(t.x, t.z), t.z); dummy.rotation.set(t.rx ?? 0, t.ry ?? 0, t.rz ?? 0); dummy.scale.set(t.sx ?? t.s ?? 1, t.sy ?? t.s ?? 1, t.sz ?? t.s ?? 1);
      dummy.updateMatrix(); m.setMatrixAt(i, dummy.matrix); if (t.c) m.setColorAt(i, t.c);
    });
    m.castShadow = opts.cast ?? true; m.receiveShadow = opts.recv ?? false; m.frustumCulled = false;
    if (opts.depth) m.customDepthMaterial = opts.depth;
    scene.add(m); return m;
  }
  const inZone = (x, z, k = 1) => ZONES.some((zn) => Math.hypot(x - zn.x, z - zn.z) < zn.fr * k);

  // sakura and maple
  const barkMat = M(0x2a1d1a);
  const blossomMat = foliageMat(texBlossom, 0xffffff, 0x2a1016), blossomDepth = depthMat(texBlossom);
  const mapleMat = foliageMat(texMaple, 0xd2c2c2, 0x100300), mapleDepth = depthMat(texMaple);
  const sakuraSpots = [], mapleSpots = [];
  const tree = (list, x, z, s = 1) => { list.push({ x, z, s: s * rr(0.9, 1.2), ry: R() * TAU }); collide(x, z, 0.45 * s); };
  for (let i = 0; i < 11; i++) { const a = (i / 11) * TAU + 0.3, rad = rr(11, 19); const x = -130 + Math.cos(a) * rad, z = 93 + Math.sin(a) * rad; if (Math.abs(x + 130) < 4.5 && z > 96) continue; (i % 4 === 3 ? tree(mapleSpots, x, z) : tree(sakuraSpots, x, z, 1.15)); }
  tree(sakuraSpots, -122, 106, 1.2); tree(sakuraSpots, -138, 107, 1.1);
  tree(sakuraSpots, 2, 26, 1.25); tree(sakuraSpots, 21, 12, 1.0); tree(sakuraSpots, -16, -2, 1.1);
  tree(sakuraSpots, LOC.cliff.x, LOC.cliff.z, 1.5); tree(sakuraSpots, 60, -198, 1.25); tree(sakuraSpots, 20, -232, 1.1);
  tree(sakuraSpots, -66, 176, 1.1);
  for (let i = 0; i < 60; i++) {
    const p = PATHS[1 + (i % 2)], k = Math.floor(R() * (p.length - 1)), t = R();
    const x = lerp(p[k][0], p[k + 1][0], t) + rr(-13, 13), z = lerp(p[k][1], p[k + 1][1], t) + rr(-13, 13);
    if (pathDist(x, z) < 4.5 || inZone(x, z, 1.0) || bambooFactor(x, z) > 0.2) continue;
    tree(R() < 0.55 ? sakuraSpots : mapleSpots, x, z);
  }
  for (let i = 0; i < 40; i++) { const x = rr(-250, 250), z = rr(-120, 230); if (heightAt(x, z) < 4 || inZone(x, z, 1.3) || pathDist(x, z) < 5 || bambooFactor(x, z) > 0.1 || Math.hypot(x - 150, z + 70) < 56) continue; tree(R() < 0.5 ? sakuraSpots : mapleSpots, x, z); }
  for (let v = 0; v < 3; v++) {
    const tv = treeVariant(rr(2.6, 3.2), rr(5.2, 6.4), 34, 0.62), list = sakuraSpots.filter((_, i) => i % 3 === v);
    instanced(tv.trunk, barkMat, list); instanced(tv.leaves, blossomMat, list, { depth: blossomDepth });
  }
  for (let v = 0; v < 2; v++) {
    const tv = treeVariant(rr(2.2, 2.8), rr(4.6, 5.6), 30, 0.55), list = mapleSpots.filter((_, i) => i % 2 === v);
    instanced(tv.trunk, barkMat, list); instanced(tv.leaves, mapleMat, list, { depth: mapleDepth });
  }

  // bamboo
  const stalks = [];
  for (let i = 0; i < 5200 && stalks.length < 1500; i++) {
    const x = rr(-170, 0), z = rr(105, 268);
    if (bambooFactor(x, z) < 0.25 + R() * 0.4 || pathDist(x, z) < 2.7 || Math.hypot(x + 70, z - 190) < 5.5 || heightAt(x, z) < 3.2) continue;
    const s = rr(0.8, 1.35);
    stalks.push({ x, z, s, ry: R() * TAU, rx: rr(-0.06, 0.06), rz: rr(-0.06, 0.06), c: new THREE.Color().setHSL(rr(0.2, 0.27), rr(0.4, 0.6), rr(0.22, 0.36)) });
  }
  const stalkGeo = cyl(0.055, 0.085, 10, 6); stalkGeo.translate(0, 5, 0);
  instanced(stalkGeo, M(0xffffff, { r: 0.6 }), stalks);
  const bambooLeaves = foliageGeo([0.52, 0.62, 0.72, 0.8, 0.88, 0.96].map((t) => ({ x: rr(-0.3, 0.3), y: t * 10, z: rr(-0.3, 0.3), r: 1.25 - t * 0.5 })), 7, 0.62, 0.6);
  instanced(bambooLeaves, foliageMat(texBamboo, 0xdfffc8), stalks.map((s) => ({ ...s, c: null })), { depth: depthMat(texBamboo) });

  // pines
  const pineParts = [];
  const paint = (g, hex, v = 0) => { const c = cv(hex), n = g.attributes.position.count, a = new Float32Array(n * 3); for (let i = 0; i < n; i++) { const k = 1 + (R() - 0.5) * v; a[i * 3] = c.r * k; a[i * 3 + 1] = c.g * k; a[i * 3 + 2] = c.b * k; } g.setAttribute('color', new THREE.BufferAttribute(a, 3)); return g; };
  { const t = cyl(0.14, 0.26, 3.4, 6); t.translate(0, 1.5, 0); pineParts.push(paint(t, '#2b1d14'));
    [[2.3, 2.6, 3.0], [1.9, 2.4, 4.5], [1.45, 2.2, 5.9], [0.95, 2.0, 7.2]].forEach(([r, h, y]) => { const c = new THREE.ConeGeometry(r, h, 7); c.translate(0, y, 0); pineParts.push(paint(c, '#16301c', 0.5)); }); }
  const pineGeo = mergeGeometries(pineParts);
  const pines = [];
  for (let i = 0; i < 9000 && pines.length < 1150; i++) {
    const x = rr(-380, 380), z = rr(-380, 250), h = heightAt(x, z);
    if (h < 4 || h > 74 || inZone(x, z, 1.25) || pathDist(x, z) < 6 || bambooFactor(x, z) > 0.05 || Math.hypot(x - 150, z + 70) < 58) continue;
    if (noise.fbm(x * 0.012 + 40, z * 0.012, 2) < 0.02 - smooth(-120, -260, z) * 0.3) continue;
    if (Math.abs(heightAt(x + 2, z) - h) + Math.abs(heightAt(x, z + 2) - h) > 2.6) continue;
    pines.push({ x, z, sx: rr(0.8, 1.3), sy: rr(0.9, 1.7), sz: rr(0.8, 1.3), ry: R() * TAU, y: h - 0.2 });
    if (Object.values(LOC).some((l) => Math.hypot(x - l.x, z - l.z) < 110)) collide(x, z, 0.4);
  }
  instanced(pineGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: true }), pines);

  // rocks
  const rockGeo = new THREE.DodecahedronGeometry(1, 0); { const p = rockGeo.attributes.position; for (let i = 0; i < p.count; i++) p.setXYZ(i, p.getX(i) * rr(0.8, 1.2), p.getY(i) * rr(0.6, 1), p.getZ(i) * rr(0.8, 1.2)); rockGeo.computeVertexNormals(); }
  const rocks = [];
  for (let i = 0; i < 520; i++) { const x = rr(-340, 340), z = rr(-360, 320); if (inZone(x, z, 0.9) || pathDist(x, z) < 3.5) continue; const s = rr(0.4, 2.4) * (z < -150 ? 1.6 : 1); rocks.push({ x, z, sx: s * rr(0.8, 1.5), sy: s * rr(0.5, 1), sz: s * rr(0.8, 1.5), ry: R() * TAU, y: heightAt(x, z) - s * 0.25 }); if (s > 1.2) collide(x, z, s * 0.85); }
  instanced(rockGeo, M(0x5c5852, { flat: true }), rocks, { recv: true });

  // ---------- structures
  function gableGeo(w, d, h, over = 0.5) {
    const hw = w / 2 + over, hd = d / 2 + over;
    const v = [[-hw, 0, -hd], [hw, 0, -hd], [hw, 0, hd], [-hw, 0, hd], [-hw, h, 0], [hw, h, 0]];
    const f = [3, 2, 5, 3, 5, 4, 1, 0, 4, 1, 4, 5, 0, 3, 4, 2, 1, 5, 0, 1, 2, 0, 2, 3], p = [];
    for (const i of f) p.push(...v[i]);
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3)); g.computeVertexNormals(); return g;
  }
  const hipGeo = (w, h, d) => { const g = new THREE.ConeGeometry(1, 1, 4, 1); g.rotateY(Math.PI / 4); g.scale(w / 1.414, h, d / 1.414); g.translate(0, h / 2, 0); return g; };
  function house(x, z, rot, w, d, burn) {
    const g = group(x, z, rot), wall = burn ? mats.char : (R() < 0.5 ? mats.plaster : mats.woodL);
    add(g, box(w + 0.5, 0.5, d + 0.5), mats.stone, 0, 0.05, 0);
    add(g, box(w, 2.3, d), wall, 0, 1.45, 0);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) add(g, box(0.22, 2.5, 0.22), mats.woodD, sx * w / 2, 1.5, sz * d / 2);
    add(g, box(1.1, 1.8, 0.1), mats.woodD, 0, 1.2, d / 2 + 0.02);
    const roof = add(g, gableGeo(w, d, 2.2, 0.8), burn ? mats.char : mats.thatch, 0, 2.6, 0);
    if (burn) { roof.rotation.z = rr(-0.08, 0.08); const c = Math.cos(rot), s = Math.sin(rot), y = g.position.y;
      fire(x, y + 3.6, z, 2.4); fire(x + c * w * 0.3, y + 3.0, z - s * w * 0.3, 1.7); fire(x - c * w * 0.3 + s * 1.5, y + 1.4, z + s * w * 0.3 + c * 1.5, 1.3, false); }
    collide(x, z, Math.max(w, d) * 0.56);
  }
  function torii(x, z, rot = 0, s = 1) {
    const g = group(x, z, rot);
    for (const sx of [-1, 1]) { add(g, cyl(0.16 * s, 0.2 * s, 4.3 * s, 10), mats.red, sx * 1.7 * s, 2.15 * s, 0); add(g, cyl(0.26 * s, 0.28 * s, 0.4 * s, 10), mats.black, sx * 1.7 * s, 0.2 * s, 0); collide(x + Math.cos(rot) * sx * 1.7 * s, z - Math.sin(rot) * sx * 1.7 * s, 0.3 * s); }
    add(g, box(4.9 * s, 0.26 * s, 0.4 * s), mats.red, 0, 4.3 * s, 0); add(g, box(5.4 * s, 0.14 * s, 0.5 * s), mats.black, 0, 4.5 * s, 0);
    for (const sx of [-1, 1]) add(g, box(0.9 * s, 0.14 * s, 0.5 * s), mats.black, sx * 2.6 * s, 4.58 * s, 0, 0, 0, sx * 0.22);
    add(g, box(4.1 * s, 0.2 * s, 0.22 * s), mats.red, 0, 3.45 * s, 0); add(g, box(0.3 * s, 0.62 * s, 0.14 * s), mats.red, 0, 3.87 * s, 0);
  }
  function lantern(x, z, lit = true) {
    const g = group(x, z);
    add(g, cyl(0.3, 0.36, 0.25, 6), mats.stone, 0, 0.12, 0); add(g, cyl(0.12, 0.14, 0.9, 6), mats.stone, 0, 0.7, 0); add(g, box(0.5, 0.1, 0.5), mats.stone, 0, 1.2, 0);
    add(g, box(0.34, 0.34, 0.34), lit ? mats.glow : mats.stone, 0, 1.42, 0); add(g, hipGeo(0.8, 0.3, 0.8), mats.stone, 0, 1.6, 0);
    collide(x, z, 0.35);
  }
  const clothMat = (color) => {
    const m = new THREE.MeshLambertMaterial({ color, side: THREE.DoubleSide });
    m.onBeforeCompile = (s) => { s.uniforms.uTime = uTime; s.uniforms.uWind = uWind; s.vertexShader = 'uniform float uTime; uniform float uWind;\n' + s.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      transformed.z += sin(uTime * 4.2 + position.y * 2.2 + position.x * 3.5 + modelMatrix[3].x) * 0.16 * position.x * uWind;`); };
    return m;
  };
  const clothRed = clothMat(0x7a1c14), clothWhite = clothMat(0xd8d2c4), clothBlue = clothMat(0x1c2742);
  function banner(x, z, mat, rot = 0, h = 4.6) {
    const g = group(x, z, rot);
    add(g, cyl(0.04, 0.05, h, 5), mats.woodD, 0, h / 2, 0);
    const pg = new THREE.PlaneGeometry(0.85, 2.6, 5, 8); pg.translate(0.45, 0, 0);
    const c = add(g, pg, mat, 0, h - 1.4, 0); c.castShadow = false;
    add(g, box(0.9, 0.04, 0.04), mats.woodD, 0.45, h - 0.08, 0);
  }
  function campfire(x, z, s = 1) {
    const g = group(x, z);
    for (let i = 0; i < 7; i++) { const a = (i / 7) * TAU; add(g, rockGeo, mats.stone, Math.cos(a) * 0.62 * s, 0.05, Math.sin(a) * 0.62 * s).scale.setScalar(0.2 * s); }
    for (let i = 0; i < 4; i++) add(g, cyl(0.07, 0.07, 1.1 * s, 5), mats.char, 0, 0.3, 0, 1.0, (i / 4) * TAU, 0);
    fire(x, g.position.y + 0.35, z, 0.95 * s, false); collide(x, z, 0.7 * s);
  }
  function brazier(x, z) {
    const g = group(x, z);
    for (let i = 0; i < 3; i++) { const a = (i / 3) * TAU; add(g, cyl(0.035, 0.035, 1.5, 4), mats.black, Math.cos(a) * 0.22, 0.7, Math.sin(a) * 0.22, Math.sin(a) * 0.25, 0, -Math.cos(a) * 0.25); }
    add(g, cyl(0.38, 0.22, 0.3, 8), mats.black, 0, 1.45, 0); fire(x, g.position.y + 1.6, z, 0.7, false); collide(x, z, 0.4);
  }
  function yurt(x, z, r = 3) {
    const g = group(x, z, R() * TAU);
    add(g, cyl(r, r, 2.0, 14), mats.felt, 0, 1.0, 0); add(g, cyl(r + 0.04, r + 0.04, 0.22, 14), mats.red, 0, 1.75, 0);
    add(g, new THREE.CylinderGeometry(0.5, r + 0.25, 1.5, 14), mats.feltD, 0, 2.75, 0); add(g, box(1.1, 1.7, 0.12), mats.woodD, 0, 0.85, r);
    collide(x, z, r + 0.2);
  }
  function tower(x, z) {
    const g = group(x, z);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) add(g, cyl(0.12, 0.15, 6.4, 6), mats.wood, sx * 1.1, 3.2, sz * 1.1, sz * 0.05, 0, -sx * 0.05);
    add(g, box(3, 0.16, 3), mats.wood, 0, 5.0, 0); for (const s of [-1, 1]) { add(g, box(3, 0.7, 0.08), mats.wood, 0, 5.5, s * 1.46); add(g, box(0.08, 0.7, 3), mats.wood, s * 1.46, 5.5, 0); }
    add(g, hipGeo(4, 1.2, 4), mats.thatch, 0, 6.9, 0); collide(x, z, 1.6);
  }
  const logs = [];
  function palisade(x1, z1, x2, z2) {
    const len = Math.hypot(x2 - x1, z2 - z1), n = Math.ceil(len / 0.5);
    for (let i = 0; i <= n; i++) { const x = lerp(x1, x2, i / n) + rr(-0.05, 0.05), z = lerp(z1, z2, i / n) + rr(-0.05, 0.05); logs.push({ x, z, sy: rr(3.5, 4.3), y: heightAt(x, z) - 0.3, ry: R() * TAU }); }
    G.walls.push({ x1, z1, x2, z2, t: 0.45 });
  }
  function ship(x, z, rot, s = 1, lit = false) {
    const g = new THREE.Group(); g.position.set(x, 0.2, z); g.rotation.y = rot; g.scale.setScalar(s); scene.add(g);
    const hg = new THREE.BoxGeometry(5.4, 2.8, 20, 2, 1, 10), p = hg.attributes.position;
    for (let i = 0; i < p.count; i++) { const t = p.getZ(i) / 10, y = p.getY(i); p.setX(i, p.getX(i) * (1 - 0.78 * t * t) * (y < 0 ? 0.6 : 1)); p.setY(i, y + t * t * 1.5 + (t > 0 ? t * t * 0.8 : 0)); }
    hg.computeVertexNormals(); add(g, hg, mats.hull, 0, 0.8, 0);
    add(g, cyl(0.16, 0.2, 11, 6), mats.woodD, 0, 7, 0.5); const sl = add(g, new THREE.PlaneGeometry(7, 6.5), mats.sail, 0, 8, 0.75);
    for (let i = 0; i < 5; i++) add(g, box(7.1, 0.07, 0.07), mats.woodD, 0, 5.2 + i * 1.4, 0.82);
    add(g, cyl(0.1, 0.12, 6, 5), mats.woodD, 0, 4.4, -6); add(g, new THREE.PlaneGeometry(3.6, 3.4), mats.sail, 0, 5.2, -5.85);
    if (lit) add(g, box(0.3, 0.3, 0.3), mats.glow, 0, 2.6, 9);
    sl.castShadow = false;
  }

  // beach
  for (let i = 0; i < 22; i++) { const x = rr(-330, 330), z = rr(352, 560); ship(x, z, Math.PI + rr(-0.25, 0.25), rr(1.0, 1.7), i % 3 === 0); }
  for (const [x, z, r] of [[-26, 319, 2.9], [14, 321, 3.3], [44, 318, 3.0], [-58, 320, 3.2]]) ship(x, z, r, 0.55);
  for (const [x, z, s] of [[-22, 306, 1.5], [26, 309, 1.3], [-48, 300, 1.1], [56, 301, 1.2], [6, 312, 0.9]]) { const g = group(x, z, R() * TAU); for (let i = 0; i < 5; i++) add(g, box(rr(1.5, 3), 0.16, 0.3), mats.char, rr(-0.8, 0.8), rr(0.1, 0.5), rr(-0.8, 0.8), rr(-0.4, 0.4), R() * TAU, rr(-0.4, 0.4)); fire(x, g.position.y + 0.5, z, s, true); }
  for (let i = 0; i < 9; i++) banner(-32 + i * 8 + rr(-1, 1), 279 + rr(-1.5, 1.5), i % 2 ? clothWhite : clothBlue, rr(-0.4, 0.4));
  for (let i = 0; i < 40; i++) { const g = group(rr(-60, 60), rr(286, 314), R() * TAU); add(g, cyl(0.012, 0.012, 0.8, 4), mats.woodL, 0, 0.3, 0, rr(0.2, 0.7), 0, 0); }

  // bamboo wake site, road markers
  torii(-90, 165, 0.785, 0.9);
  lantern(-67, 186, false); lantern(-116, 141, true);

  // shrine
  torii(-130, 111, 0, 1.15); torii(-130, 121, 0, 0.9);
  for (let i = 0; i < 9; i++) { const z = 112 + i * 1.1, g = group(-130, z, 0, -0.12); add(g, box(4.2, 0.24, 1.15), mats.stone); }
  { const g = group(-130, 84);
    add(g, box(8, 0.7, 6.6), mats.stone, 0, 0.3, 0); add(g, box(7, 0.18, 5.6), mats.wood, 0, 0.74, 0);
    for (const sx of [-1, -0.33, 0.33, 1]) for (const sz of [-1, 1]) add(g, cyl(0.15, 0.15, 3, 8), mats.red, sx * 3.1, 2.3, sz * 2.4);
    add(g, box(6.2, 3, 0.16), mats.plaster, 0, 2.3, -2.4); for (const sx of [-1, 1]) add(g, box(0.16, 3, 3.2), mats.plaster, sx * 3.1, 2.3, -0.8);
    add(g, box(7.4, 0.3, 6), mats.red, 0, 3.9, 0); add(g, hipGeo(10, 2.6, 8.6), mats.tile, 0, 4.0, 0); add(g, box(3.4, 0.28, 0.4), mats.gold, 0, 6.5, 0);
    add(g, box(1.5, 0.7, 0.8), mats.woodD, 0, 1.15, 1.6); add(g, box(0.5, 0.5, 0.3), mats.gold, 0, 2.6, -2.2);
    for (let i = 0; i < 3; i++) add(g, box(3, 0.22, 0.5), mats.stone, 0, 0.5 - i * 0.2, 3.5 + i * 0.5);
    G.walls.push({ x1: -134, z1: 81.4, x2: -126, z2: 81.4, t: 0.5 }, { x1: -133.4, z1: 81.4, x2: -133.4, z2: 86, t: 0.4 }, { x1: -126.6, z1: 81.4, x2: -126.6, z2: 86, t: 0.4 }); }
  lantern(-126.4, 96); lantern(-133.6, 96); lantern(-126.4, 104); lantern(-133.6, 104);
  banner(-124, 90, clothWhite, 0.3, 3.6);

  // village
  [[-8, 6, 0.3, 6.5, 5, 1], [28, 6, -0.4, 6, 5, 1], [33, 28, 1.2, 7, 5, 0], [14, 44, 0.1, 6.5, 5, 1], [-10, 36, 1.5, 6, 4.6, 0], [10, -9, 0, 7, 5.4, 0], [-22, 18, 0.9, 5.6, 4.6, 1]].forEach((h) => house(...h));
  { const g = group(12, 23); add(g, cyl(0.95, 0.95, 0.8, 10), mats.stone, 0, 0.4, 0); for (const s of [-1, 1]) add(g, box(0.12, 2, 0.12), mats.wood, s * 0.8, 1.2, 0); add(g, gableGeo(1.6, 1, 0.5, 0.2), mats.thatch, 0, 2.2, 0); collide(12, 23, 1.1); }
  for (let i = 0; i < 16; i++) { const a = (i / 16) * TAU, x = 10 + Math.cos(a) * rr(30, 34), z = 20 + Math.sin(a) * rr(30, 34); if (pathDist(x, z) < 5) continue; const g = group(x, z, a + 1.57); add(g, box(3.4, 0.08, 0.08), mats.woodL, 0, 0.9, 0); add(g, box(3.4, 0.08, 0.08), mats.woodL, 0, 0.5, 0); for (const s of [-1, 1]) add(g, box(0.1, 1.1, 0.1), mats.wood, s * 1.6, 0.55, 0); }
  { const g = group(4, 14, 0.6); add(g, box(2.2, 0.5, 1.2), mats.wood, 0, 0.7, 0); for (const s of [-1, 1]) add(g, cyl(0.5, 0.5, 0.1, 10), mats.woodD, 0, 0.5, s * 0.7, Math.PI / 2, 0, 0); collide(4, 14, 1.2); }
  banner(18, 24, clothRed, 1.0); banner(0, 12, clothRed, 2.0);

  // mongol camp
  const C = LOC.camp;
  campfire(C.x, C.z, 1.7); campfire(C.x - 11, C.z + 4, 1); campfire(C.x + 9, C.z - 9, 1);
  [0.5, 1.6, 2.65, 3.75, 4.85, 5.85].forEach((a, i) => yurt(C.x + Math.cos(a) * 15.5, C.z + Math.sin(a) * 15.5, i === 0 ? 3.6 : 3));
  tower(C.x + 17, C.z + 13); tower(C.x - 18, C.z - 10);
  for (let i = 0; i < 6; i++) banner(C.x + Math.cos(i * 1.05 + 0.2) * 19.5, C.z + Math.sin(i * 1.05 + 0.2) * 19.5, clothRed, R() * TAU, 5);
  { const g = group(C.x + 4, C.z + 6); add(g, cyl(0.14, 0.16, 2.6, 6), mats.wood, 0, 1.3, 0); collide(C.x + 4, C.z + 6, 0.35); }
  for (const [dx, dz, r] of [[-5, -8, 0.4], [7, 9, 2]]) { const g = group(C.x + dx, C.z + dz, r); for (const s of [-1, 1]) add(g, box(0.1, 1.5, 0.1), mats.wood, s * 0.9, 0.75, 0); add(g, box(2, 0.08, 0.08), mats.wood, 0, 1.3, 0); for (let i = 0; i < 4; i++) add(g, box(0.04, 2.0, 0.04), mats.woodL, -0.6 + i * 0.4, 0.95, 0.12, 0.15, 0, 0); }

  // castle
  const F = LOC.fort, fx0 = F.x - 30, fx1 = F.x + 30, fz0 = F.z - 30, fz1 = F.z + 30;
  palisade(fx0, fz0, fx1, fz0); palisade(fx0, fz0, fx0, fz1); palisade(fx1, fz0, fx1, fz1); palisade(fx0, fz1, F.x - 4, fz1); palisade(F.x + 4, fz1, fx1, fz1);
  { const g = group(F.x, fz1);
    for (const s of [-1, 1]) add(g, box(0.7, 5.6, 0.7), mats.woodD, s * 4, 2.6, 0);
    add(g, box(9.6, 0.6, 0.9), mats.woodD, 0, 5.4, 0); add(g, gableGeo(9, 1.6, 1.2, 0.6), mats.tile, 0, 5.7, 0);
    const doors = [-1, 1].map((s) => { const piv = new THREE.Group(); piv.position.set(s * 3.7, 0, 0); g.add(piv); add(piv, box(3.7, 4.6, 0.22), mats.wood, -s * 1.85, 2.4, 0); add(piv, box(3.7, 0.2, 0.26), mats.black, -s * 1.85, 3.6, 0); add(piv, box(3.7, 0.2, 0.26), mats.black, -s * 1.85, 1.2, 0); return piv; });
    const wall = { x1: F.x - 4, z1: fz1, x2: F.x + 4, z2: fz1, t: 0.45 }; G.walls.push(wall);
    world.gate = { doors, wall, openT: 0, target: 0, open() { this.target = 1; const i = G.walls.indexOf(wall); if (i >= 0) G.walls.splice(i, 1); G.audio?.thud(0.9); }, close() { this.target = 0; if (!G.walls.includes(wall)) G.walls.push(wall); } }; }
  tower(fx0 + 3, fz1 - 3); tower(fx1 - 3, fz1 - 3);
  { const g = group(F.x, F.z - 22);
    add(g, box(19, 1.6, 11), mats.stone, 0, 0.6, 0); add(g, box(15, 4, 8), mats.plaster, 0, 3.4, 0);
    for (let i = -3; i <= 3; i++) add(g, box(0.3, 4, 0.3), mats.woodD, i * 2.45, 3.4, 4.02);
    add(g, box(2.6, 2.8, 0.2), mats.woodD, 0, 2.8, 4.06); add(g, hipGeo(20, 3.2, 13), mats.tile, 0, 5.4, 0);
    add(g, box(8.5, 3, 5), mats.plaster, 0, 9.2, 0); add(g, hipGeo(12.5, 3.2, 8.6), mats.tile, 0, 10.7, 0); add(g, box(4.2, 0.3, 0.4), mats.gold, 0, 13.85, 0);
    for (let i = 0; i < 4; i++) add(g, box(6, 0.4, 0.8), mats.stone, 0, 1.2 - i * 0.4, 5.9 + i * 0.8);
    G.walls.push({ x1: F.x - 9.5, z1: F.z - 16.5, x2: F.x + 9.5, z2: F.z - 16.5, t: 0.6 }, { x1: F.x - 9.5, z1: F.z - 16.5, x2: F.x - 9.5, z2: F.z - 28, t: 0.6 }, { x1: F.x + 9.5, z1: F.z - 16.5, x2: F.x + 9.5, z2: F.z - 28, t: 0.6 }); }
  for (const [dx, dz] of [[-13, 9], [13, 9], [-13, -9], [13, -9]]) brazier(F.x + dx, F.z + dz);
  for (let i = 0; i < 5; i++) { banner(fx0 + 2, fz0 + 8 + i * 11, clothRed, 0, 5.2); banner(fx1 - 2, fz0 + 8 + i * 11, clothRed, Math.PI, 5.2); }
  { const g = group(F.x, F.z - 13); add(g, cyl(0.16, 0.18, 2.4, 6), mats.woodD, 0, 1.2, 0); add(g, box(1.6, 0.14, 0.14), mats.woodD, 0, 2.0, 0); }
  yurt(F.x - 20, F.z + 16, 2.8); yurt(F.x + 21, F.z - 2, 2.8);
  lantern(F.x - 5, fz1 + 5, true); lantern(F.x + 5, fz1 + 5, true);

  const logGeo = mergeGeometries([(() => { const c = cyl(0.25, 0.27, 1, 6); c.translate(0, 0.5, 0); return c; })(), (() => { const c = new THREE.ConeGeometry(0.25, 0.1, 6); c.translate(0, 1.05, 0); return c; })()]);
  instanced(logGeo, mats.wood, logs, { recv: true });

  // ---------- per-frame update
  const tmp = new THREE.Vector3(), lightDir = new THREE.Vector3();
  world.update = (dt, rawDt, camera, focus, playerPos) => {
    uTime.value += dt;
    const a = world.atm;
    if (world.lerpT < 1) {
      world.lerpT = Math.min(1, world.lerpT + rawDt / world.lerpDur);
      const t = smooth(0, 1, world.lerpT), f = world.from, to = world.to;
      for (const k of COLS) a[k].copy(f[k]).lerp(to[k], t);
      for (const k of NUMS) a[k] = lerp(f[k], to[k], t);
      a.sunDir.copy(f.sunDir).lerp(to.sunDir, t).normalize();
    }
    if (a.lightning > 0.05) { world.nextBolt -= rawDt * a.lightning; if (world.nextBolt <= 0) { world.nextBolt = 7 + Math.random() * 14; world.lightning(); } }
    world.flash = Math.max(0, world.flash - rawDt * 2.6);
    const fl = world.flash * (0.6 + 0.4 * Math.sin(uTime.value * 70));
    uWind.value = a.wind;
    scene.fog.color.copy(a.fog).addScalar(fl * 0.12); scene.fog.density = a.fogD;
    hemi.color.copy(a.hemiS); hemi.groundColor.copy(a.hemiG); hemi.intensity = a.hemiI + fl * 5;
    sun.color.copy(a.sun); sun.intensity = a.sunI;
    lightDir.copy(a.sunDir); if (lightDir.y < 0.2) { lightDir.y = 0.2; lightDir.normalize(); }
    sun.target.position.copy(focus); sun.position.copy(focus).addScaledVector(lightDir, 110);
    const su = skyMat.uniforms; su.uFog.value.copy(scene.fog.color); su.uTop.value.copy(a.top); su.uHor.value.copy(a.hor); su.uSun.value.copy(a.sun); su.uSunDir.value.copy(a.sunDir); su.uCloudCol.value.copy(a.cloudCol); su.uCloud.value = a.cloud; su.uStars.value = a.stars; su.uSunI.value = a.sunI; su.uFlash.value = fl;
    sky.position.copy(camera.position);
    const amb = (a.hemiS.r + a.hemiS.g + a.hemiS.b) / 3 * a.hemiI * 0.3 + a.sunI * 0.1;
    const wu = waterMat.uniforms; wu.uSkyH.value.copy(a.hor); wu.uSkyT.value.copy(a.top); wu.uSun.value.copy(a.sun).multiplyScalar(a.sunI * 0.4); wu.uSunDir.value.copy(a.sunDir); wu.uT.value = uTime.value; wu.uAmb.value = clamp(amb, 0.05, 1.2);
    const gu = grassMat.uniforms; gu.uFocus.value.copy(focus); gu.uPlayer.value.copy(playerPos); gu.uT.value = uTime.value; gu.uWindS.value = a.wind;
    gu.uLight.value.copy(a.sun).multiplyScalar(a.sunI * 0.5); tmp.set(a.hemiS.r * 0.75 + a.hemiG.r * 0.25, a.hemiS.g * 0.75 + a.hemiG.g * 0.25, a.hemiS.b * 0.75 + a.hemiG.b * 0.25).multiplyScalar(a.hemiI);
    gu.uLight.value.r = (gu.uLight.value.r + tmp.x) / Math.PI + fl; gu.uLight.value.g = (gu.uLight.value.g + tmp.y) / Math.PI + fl; gu.uLight.value.b = (gu.uLight.value.b + tmp.z) / Math.PI + fl;
    const ru = rainMat.uniforms; ru.uT.value = uTime.value; ru.uCam.value.copy(camera.position); ru.uA.value = a.rain; rain.visible = a.rain > 0.02;
    ru.uCol.value.copy(a.hemiS).multiplyScalar(1.6).addScalar(0.15);
    // nearest fires get the pooled lights
    const near = world.fires.map((f) => ({ f, d: Math.hypot(f.x - focus.x, f.z - focus.z) - f.s * 4 })).sort((p, q) => p.d - q.d);
    fireLights.forEach((l, i) => {
      const n = near[i];
      if (!n || n.d > 60 || n.f.off) { l.intensity = 0; return; }
      const t = uTime.value; l.position.set(n.f.x, n.f.y + 1.2, n.f.z);
      l.intensity = 95 * n.f.s * (0.8 + 0.14 * Math.sin(t * 17 + i * 3) + 0.1 * Math.sin(t * 31 + i));
    });
    const gt = world.gate; if (gt && gt.openT !== gt.target) { gt.openT = clamp(gt.openT + Math.sign(gt.target - gt.openT) * rawDt * 0.6, 0, 1); const e = smooth(0, 1, gt.openT); gt.doors[0].rotation.y = e * 1.75; gt.doors[1].rotation.y = -e * 1.75; }
  };
  world.sun = sun; world.hemi = hemi;
  return world;
}

// Push a circle out of trees, buildings and walls.
export function resolveCollisions(p, radius) {
  for (const c of G.colliders) {
    const dx = p.x - c.x, dz = p.z - c.z, rr2 = c.r + radius;
    if (Math.abs(dx) < rr2 && Math.abs(dz) < rr2) { const d = Math.hypot(dx, dz); if (d < rr2 && d > 1e-4) { p.x = c.x + (dx / d) * rr2; p.z = c.z + (dz / d) * rr2; } }
  }
  for (const w of G.walls) {
    const vx = w.x2 - w.x1, vz = w.z2 - w.z1, t = clamp(((p.x - w.x1) * vx + (p.z - w.z1) * vz) / (vx * vx + vz * vz), 0, 1);
    const cx = w.x1 + vx * t, cz = w.z1 + vz * t, dx = p.x - cx, dz = p.z - cz, d = Math.hypot(dx, dz), rr2 = w.t + radius;
    if (d < rr2 && d > 1e-4) { p.x = cx + (dx / d) * rr2; p.z = cz + (dz / d) * rr2; }
  }
}
