import * as THREE from 'three';
import { G, rand, TAU } from './core.js';
import { heightAt } from './world.js';

const VS = `attribute vec4 aCol; attribute float aSize; attribute float aRot; uniform float uPx; uniform float uFogD;
varying vec4 vCol; varying float vRot; varying float vFog;
void main(){ vCol = aCol; vRot = aRot; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv;
  float d = max(-mv.z, 0.1); gl_PointSize = min(aSize * uPx / d, 460.0); vFog = exp(-uFogD * uFogD * d * d); }`;
const FS = `uniform float uShape; uniform float uAdd; uniform vec3 uFogC; varying vec4 vCol; varying float vRot; varying float vFog;
void main(){ vec2 q = gl_PointCoord - 0.5; float c = cos(vRot), s = sin(vRot); q = vec2(c*q.x - s*q.y, s*q.x + c*q.y);
  float a = uShape < 0.5 ? smoothstep(0.5, 0.05, length(q)) : smoothstep(0.5, 0.4, length(q * vec2(1.0, 2.1)));
  if (a < 0.01) discard;
  vec3 col = mix(uFogC, vCol.rgb, mix(vFog, 1.0, uAdd));
  gl_FragColor = vec4(col, vCol.a * a * mix(1.0, vFog, uAdd)); }`;
const shared = { uPx: { value: 800 }, uFogD: { value: 0.005 }, uFogC: { value: new THREE.Color() } };

function makePoints(max, additive, shape) {
  const g = new THREE.BufferGeometry();
  const pos = new Float32Array(max * 3), col = new Float32Array(max * 4), size = new Float32Array(max), rot = new Float32Array(max);
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('aCol', new THREE.BufferAttribute(col, 4).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('aSize', new THREE.BufferAttribute(size, 1).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('aRot', new THREE.BufferAttribute(rot, 1).setUsage(THREE.DynamicDrawUsage));
  const m = new THREE.ShaderMaterial({
    vertexShader: VS, fragmentShader: FS, transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    uniforms: { ...shared, uShape: { value: shape }, uAdd: { value: additive ? 1 : 0 } },
  });
  const pts = new THREE.Points(g, m); pts.frustumCulled = false; pts.renderOrder = additive ? 4 : 3;
  return { pts, g, pos, col, size, rot };
}

class Particles {
  constructor(scene, max, additive = false, shape = 0) {
    Object.assign(this, makePoints(max, additive, shape));
    this.max = max; this.n = 0;
    this.vel = new Float32Array(max * 3); this.c0 = new Float32Array(max * 4); this.c1 = new Float32Array(max * 4);
    this.life = new Float32Array(max); this.maxLife = new Float32Array(max); this.s0 = new Float32Array(max); this.s1 = new Float32Array(max);
    this.grav = new Float32Array(max); this.drag = new Float32Array(max); this.spin = new Float32Array(max);
    scene.add(this.pts);
  }
  spawn(x, y, z, vx, vy, vz, life, s0, s1, c0, c1, grav = 0, drag = 0, spin = 0) {
    if (this.n >= this.max) return;
    const i = this.n++;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.life[i] = this.maxLife[i] = life; this.s0[i] = s0; this.s1[i] = s1; this.grav[i] = grav; this.drag[i] = drag; this.spin[i] = spin; this.rot[i] = Math.random() * TAU;
    this.c0.set(c0, i * 4); this.c1.set(c1, i * 4);
  }
  move(dst, src) {
    for (const a of [this.pos, this.vel]) { a[dst * 3] = a[src * 3]; a[dst * 3 + 1] = a[src * 3 + 1]; a[dst * 3 + 2] = a[src * 3 + 2]; }
    for (const a of [this.c0, this.c1]) for (let k = 0; k < 4; k++) a[dst * 4 + k] = a[src * 4 + k];
    for (const a of [this.life, this.maxLife, this.s0, this.s1, this.grav, this.drag, this.spin, this.rot]) a[dst] = a[src];
  }
  update(dt) {
    const { pos, vel, col, c0, c1 } = this;
    for (let i = 0; i < this.n; i++) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) { this.n--; if (i < this.n) this.move(i, this.n); i--; continue; }
      const t = 1 - this.life[i] / this.maxLife[i], dr = Math.max(0, 1 - this.drag[i] * dt);
      vel[i * 3] *= dr; vel[i * 3 + 2] *= dr; vel[i * 3 + 1] = vel[i * 3 + 1] * dr - this.grav[i] * dt;
      pos[i * 3] += vel[i * 3] * dt; pos[i * 3 + 1] += vel[i * 3 + 1] * dt; pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
      for (let k = 0; k < 4; k++) col[i * 4 + k] = c0[i * 4 + k] + (c1[i * 4 + k] - c0[i * 4 + k]) * t;
      this.size[i] = this.s0[i] + (this.s1[i] - this.s0[i]) * t; this.rot[i] += this.spin[i] * dt;
    }
    this.g.setDrawRange(0, this.n);
    for (const k of ['position', 'aCol', 'aSize', 'aRot']) this.g.attributes[k].needsUpdate = true;
  }
}

// Petals, embers or leaves that drift on the wind around the camera.
class Ambient {
  constructor(scene, n) {
    Object.assign(this, makePoints(n, false, 1));
    this.count = n; this.seed = new Float32Array(n);
    for (let i = 0; i < n; i++) { this.pos[i * 3] = rand(-22, 22); this.pos[i * 3 + 1] = rand(-4, 12); this.pos[i * 3 + 2] = rand(-22, 22); this.seed[i] = Math.random(); }
    scene.add(this.pts);
  }
  update(dt, cam, atm, t) {
    const { pos, col, size, rot, seed } = this, shown = Math.floor(this.count * atm.ambN), w = atm.wind, g = atm.ambGlow;
    for (let i = 0; i < this.count; i++) {
      const s = seed[i], k = i * 3;
      pos[k] += (1.5 * w + Math.sin(t * 1.3 + s * 40) * 0.9) * dt;
      pos[k + 1] += (-0.55 - s * 0.5 + Math.sin(t * 2.1 + s * 70) * 0.5 + (g > 2 ? 1.1 : 0)) * dt;
      pos[k + 2] += (0.7 * w + Math.cos(t * 1.1 + s * 55) * 0.9) * dt;
      let dx = pos[k] - cam.x, dz = pos[k + 2] - cam.z, dy = pos[k + 1] - cam.y;
      if (dx > 22) pos[k] -= 44; else if (dx < -22) pos[k] += 44;
      if (dz > 22) pos[k + 2] -= 44; else if (dz < -22) pos[k + 2] += 44;
      if (dy < -5 || pos[k + 1] < heightAt(pos[k], pos[k + 2]) + 0.03) pos[k + 1] = cam.y + rand(4, 12); else if (dy > 13) pos[k + 1] = cam.y - 4;
      const v = 0.8 + s * 0.4;
      col[i * 4] = atm.amb.r * g * v; col[i * 4 + 1] = atm.amb.g * g * v; col[i * 4 + 2] = atm.amb.b * g * v; col[i * 4 + 3] = i < shown ? 0.95 : 0;
      size[i] = g > 2 ? 0.05 + s * 0.05 : 0.11 + s * 0.09; rot[i] += (1.5 + s * 3) * dt;
    }
    for (const k of ['position', 'aCol', 'aSize', 'aRot']) this.g.attributes[k].needsUpdate = true;
  }
}

export class SwordTrail {
  constructor(scene, color = 0xdfeeff, K = 14) {
    this.K = K; this.samples = [];
    for (let i = 0; i < K; i++) this.samples.push({ b: new THREE.Vector3(), t: new THREE.Vector3(), a: 0 });
    this.pos = new Float32Array(K * 6); this.alpha = new Float32Array(K * 2);
    const g = new THREE.BufferGeometry(), idx = [];
    for (let i = 0; i < K - 1; i++) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3)); g.setAttribute('aA', new THREE.BufferAttribute(this.alpha, 1)); g.setIndex(idx);
    this.mesh = new THREE.Mesh(g, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, uniforms: { uC: { value: new THREE.Color(color) } },
      vertexShader: 'attribute float aA; varying float vA; void main(){ vA = aA; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'uniform vec3 uC; varying float vA; void main(){ gl_FragColor = vec4(uC * 1.6, vA * 0.55); }',
    }));
    this.mesh.frustumCulled = false; scene.add(this.mesh); this.g = g;
  }
  update(base, tip, active, dt) {
    const last = this.samples.pop();
    last.b.copy(base); last.t.copy(tip); last.a = active ? 1 : 0;
    this.samples.unshift(last);
    for (let i = 0; i < this.K; i++) {
      const s = this.samples[i]; if (i > 0) s.a = Math.max(0, s.a - dt * 7);
      this.pos.set([s.b.x, s.b.y, s.b.z, s.t.x, s.t.y, s.t.z], i * 6);
      const a = s.a * (1 - i / this.K); this.alpha[i * 2] = a * 0.2; this.alpha[i * 2 + 1] = a;
    }
    this.g.attributes.position.needsUpdate = true; this.g.attributes.aA.needsUpdate = true;
  }
}

export const fx = {
  init(scene) {
    this.scene = scene;
    this.fire = new Particles(scene, 5000, true);
    this.smoke = new Particles(scene, 3000, false);
    this.ambient = new Ambient(scene, 900);
    this.acc = new Map();
  },
  update(dt, camera, atm, fires, buf) {
    shared.uPx.value = buf.y / (2 * Math.tan((camera.fov * Math.PI) / 360));
    shared.uFogD.value = atm.fogD; shared.uFogC.value.copy(atm.fog);
    const cp = camera.position, br = Math.min(1, (atm.hemiS.r + atm.hemiS.g + atm.hemiS.b) / 3 * atm.hemiI * 0.5 + 0.08);
    for (const f of fires) {
      if (f.off) continue;
      const d = Math.hypot(f.x - cp.x, f.z - cp.z); if (d > 190) continue;
      const lod = d > 90 ? 0.45 : 1, s = f.s;
      let a = (this.acc.get(f) || 0) + dt * 34 * lod * Math.sqrt(s);
      while (a > 1) {
        a -= 1; const r = 0.42 * s;
        this.fire.spawn(f.x + rand(-r, r), f.y + rand(0, 0.25 * s), f.z + rand(-r, r), rand(-0.3, 0.3) + atm.wind * 0.35, rand(1.5, 3.3) * s ** 0.7, rand(-0.3, 0.3), rand(0.45, 0.95), rand(0.8, 1.25) * s ** 0.8, 0.12 * s, [2.1, 1.05, 0.28, 0.7], [1.6, 0.2, 0.02, 0]);
        if (Math.random() < 0.09) this.fire.spawn(f.x + rand(-r, r), f.y + 0.4 * s, f.z + rand(-r, r), rand(-1, 1) + atm.wind, rand(2, 5), rand(-1, 1), rand(1, 2.4), 0.07, 0.03, [3, 1.4, 0.3, 1], [2, 0.4, 0.05, 0], -0.6, 0.4);
        if (f.smoke && Math.random() < 0.085) this.smoke.spawn(f.x + rand(-r, r), f.y + 1.2 * s, f.z + rand(-r, r), rand(-0.3, 0.3) + atm.wind * 0.9, rand(1.8, 3.2), rand(-0.3, 0.3) + atm.wind * 0.4, rand(5, 9), 1.6 * s, 6.5 * s, [0.34 * br + 0.1, 0.2 * br + 0.03, 0.14 * br, 0.4], [0.12 * br, 0.11 * br, 0.11 * br, 0], -0.05, 0.12, rand(-0.3, 0.3));
      }
      this.acc.set(f, a);
    }
    this.fire.update(dt); this.smoke.update(dt);
    this.ambient.update(dt, cp, atm, G.time);
  },
  blood(p, dx, dz, n = 16) {
    for (let i = 0; i < n; i++) this.smoke.spawn(p.x, p.y, p.z, dx * rand(1, 4) + rand(-1.4, 1.4), rand(0.5, 3.5), dz * rand(1, 4) + rand(-1.4, 1.4), rand(0.35, 0.7), rand(0.06, 0.15), 0.03, [0.42, 0.01, 0.01, 0.95], [0.25, 0, 0, 0.5], 11, 0.5);
  },
  sparks(p, n = 14) {
    for (let i = 0; i < n; i++) this.fire.spawn(p.x, p.y, p.z, rand(-5, 5), rand(-1, 5), rand(-5, 5), rand(0.15, 0.4), rand(0.05, 0.1), 0.02, [4, 3.2, 1.6, 1], [3, 0.8, 0.1, 0], 12, 1.5);
    this.fire.spawn(p.x, p.y, p.z, 0, 0, 0, 0.1, 0.75, 0.15, [1.5, 1.35, 1.0, 0.8], [1, 0.8, 0.4, 0]);
  },
  dust(p, n = 8, s = 1) {
    for (let i = 0; i < n; i++) this.smoke.spawn(p.x + rand(-0.4, 0.4) * s, p.y + 0.1, p.z + rand(-0.4, 0.4) * s, rand(-1.6, 1.6) * s, rand(0.2, 1.1), rand(-1.6, 1.6) * s, rand(0.5, 1.1), 0.4 * s, 1.5 * s, [0.42, 0.37, 0.3, 0.3], [0.42, 0.37, 0.3, 0], 0, 1.6);
  },
  glint(p, red) {
    this.fire.spawn(p.x, p.y, p.z, 0, 0, 0, 0.3, 0.12, 0.62, red ? [3.2, 0.2, 0.1, 1] : [1.7, 1.7, 2.1, 1], red ? [2.4, 0.08, 0.04, 0] : [1.2, 1.2, 1.6, 0]);
    this.fire.spawn(p.x, p.y, p.z, 0, 0, 0, 0.2, 0.05, 0.16, [5, 5, 5, 1], [4, 4, 4, 0]);
  },
  flame(x, y, z, s = 0.3) {
    this.fire.spawn(x, y, z, rand(-0.2, 0.2), rand(0.4, 1), rand(-0.2, 0.2), rand(0.2, 0.4), s, 0.04, [2.6, 1.4, 0.4, 0.9], [1.6, 0.2, 0.02, 0]);
  },
};
