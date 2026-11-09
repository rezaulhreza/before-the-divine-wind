import * as THREE from 'three';
import { clamp, lerp, damp, smooth, TAU } from './core.js';

const mats = new Map(), geos = new Map();
export function M(color, o = {}) {
  const k = color + '|' + (o.r ?? 0.85) + '|' + (o.m ?? 0) + '|' + (o.e ?? 0) + '|' + (o.side ?? 0);
  if (!mats.has(k)) mats.set(k, new THREE.MeshStandardMaterial({ color, roughness: o.r ?? 0.85, metalness: o.m ?? 0, emissive: o.e ?? 0, side: o.side ?? THREE.FrontSide }));
  return mats.get(k);
}
const B = (w, h, d) => { const k = `${w},${h},${d}`; if (!geos.has(k)) geos.set(k, new THREE.BoxGeometry(w, h, d)); return geos.get(k); };
function add(parent, geo, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); m.castShadow = true; parent.add(m); return m;
}
const steel = () => M(0xdde4ec, { r: 0.28, m: 0.55, e: 0x1c2026 });

const JOINTS = ['hips', 'spine', 'chest', 'head', 'lArm', 'lFore', 'lHand', 'rArm', 'rFore', 'rHand', 'lThigh', 'lShin', 'lFoot', 'rThigh', 'rShin', 'rFoot'];
const newPose = () => { const p = { hy: 0 }; for (const j of JOINTS) p[j] = [0, 0, 0]; return p; };
const zero = (p) => { p.hy = 0; for (const j of JOINTS) { const a = p[j]; a[0] = a[1] = a[2] = 0; } };
const set = (a, x, y, z) => { a[0] = x; a[1] = y; a[2] = z; };

const K = (rArm, rFore, rHand, chestY, spineX, spineY = 0) => ({ rArm, rFore: [rFore, 0, 0], rHand: [rHand, 0, 0], chest: [0, chestY, 0], spine: [spineX, spineY, 0] });
const GUARD = K([-0.95, 0, 0.35], -0.85, 0.75, 0, 0.05);
export const CLIPS = {
  slash1: [[0, K([-2.2, 0, -0.3], -1.1, 0.25, -0.4, 0, -0.1)], [0.3, K([-2.45, 0, -0.4], -1.2, 0.15, -0.55, -0.05, -0.15)], [0.5, K([-1.3, 0, 0.3], -0.3, 0.9, 0.2, 0.15, 0.1)], [0.62, K([-0.5, 0, 0.9], -0.15, 1.15, 0.55, 0.25, 0.2)], [0.82, K([-0.45, 0, 0.95], -0.15, 1.15, 0.6, 0.25, 0.2)], [1, GUARD]],
  slash2: [[0, K([-0.7, 0, 0.95], -0.6, 0.9, 0.5, 0.15, 0.15)], [0.3, K([-0.6, 0, 1.05], -0.7, 1.0, 0.6, 0.2, 0.2)], [0.5, K([-1.35, 0, 0.2], -0.3, 0.6, 0, 0.05, 0)], [0.62, K([-2.0, 0, -0.8], -0.35, 0.1, -0.5, -0.1, -0.15)], [0.82, K([-2.05, 0, -0.85], -0.35, 0.1, -0.55, -0.1, -0.15)], [1, GUARD]],
  overhead: [[0, K([-2.7, 0, 0.1], -0.8, 0, 0, -0.1)], [0.34, K([-3.0, 0, 0.1], -1.0, -0.25, 0, -0.2)], [0.52, K([-1.5, 0, 0.15], -0.2, 0.9, 0, 0.2)], [0.64, K([-0.45, 0, 0.2], -0.1, 1.25, 0, 0.42)], [0.84, K([-0.4, 0, 0.2], -0.1, 1.25, 0, 0.45)], [1, GUARD]],
  heavy: [[0, K([-1.6, 0, 0.2], -1.0, 0.4, 0, 0)], [0.42, K([-3.1, 0, 0.1], -1.1, -0.3, 0, -0.28)], [0.52, K([-3.1, 0, 0.1], -1.1, -0.3, 0, -0.3)], [0.61, K([-1.4, 0, 0.15], -0.15, 0.95, 0, 0.25)], [0.68, K([-0.35, 0, 0.2], -0.05, 1.3, 0, 0.5)], [0.88, K([-0.3, 0, 0.2], -0.05, 1.3, 0, 0.52)], [1, GUARD]],
  stab: [[0, K([0.45, 0, 0.1], -1.7, 1.3, -0.45, 0, -0.1)], [0.36, K([0.55, 0, 0.1], -1.8, 1.3, -0.5, 0, -0.12)], [0.5, K([-1.45, 0, 0.3], -0.05, 1.5, 0.3, 0.22, 0.1)], [0.85, K([-1.45, 0, 0.3], -0.05, 1.5, 0.3, 0.24, 0.1)], [1, GUARD]],
  iai: [[0, K([-0.5, 0, 1.0], -1.2, 0.5, 0.5, 0.22, 0.15)], [0.5, K([-0.5, 0, 1.05], -1.25, 0.5, 0.55, 0.25, 0.15)], [0.64, K([-1.7, 0, -0.95], -0.1, 0.3, -0.6, 0.05, -0.2)], [1, K([-1.75, 0, -1.0], -0.1, 0.3, -0.62, 0.05, -0.2)]],
  sweep: [[0, K([-1.2, 0, -1.0], -0.5, 0.9, -0.8, 0, -0.25)], [0.45, K([-1.25, 0, -1.15], -0.55, 0.9, -0.95, 0, -0.3)], [0.62, K([-1.3, 0, 0.9], -0.2, 0.9, 0.9, 0.1, 0.3)], [0.85, K([-1.3, 0, 0.95], -0.2, 0.9, 0.95, 0.1, 0.3)], [1, GUARD]],
};
function sampleClip(clip, t, p) {
  let i = 0; while (i < clip.length - 2 && t > clip[i + 1][0]) i++;
  const a = clip[i], b = clip[i + 1], f = smooth(a[0], b[0], t);
  for (const j in a[1]) { const x = a[1][j], y = b[1][j], o = p[j]; o[0] = lerp(x[0], y[0], f); o[1] = lerp(x[1], y[1], f); o[2] = lerp(x[2], y[2], f); }
}

export class Humanoid {
  constructor(o = {}) {
    this.o = o; this.root = new THREE.Group(); this.rig = new THREE.Group(); this.root.add(this.rig); this.rig.scale.setScalar(o.scale || 1);
    const J = (this.J = {});
    const mk = (n, parent, x, y, z) => { const g = new THREE.Group(); g.position.set(x, y, z); parent.add(g); J[n] = g; };
    mk('hips', this.rig, 0, 0.94, 0); mk('spine', J.hips, 0, 0.08, 0); mk('chest', J.spine, 0, 0.24, 0); mk('head', J.chest, 0, 0.28, 0);
    mk('lArm', J.chest, 0.225, 0.2, 0); mk('lFore', J.lArm, 0, -0.29, 0); mk('lHand', J.lFore, 0, -0.27, 0);
    mk('rArm', J.chest, -0.225, 0.2, 0); mk('rFore', J.rArm, 0, -0.29, 0); mk('rHand', J.rFore, 0, -0.27, 0);
    mk('lThigh', J.hips, 0.1, -0.02, 0); mk('lShin', J.lThigh, 0, -0.45, 0); mk('lFoot', J.lShin, 0, -0.42, 0);
    mk('rThigh', J.hips, -0.1, -0.02, 0); mk('rShin', J.rThigh, 0, -0.45, 0); mk('rFoot', J.rShin, 0, -0.42, 0);
    this.tp = newPose(); this.cp = newPose();
    this.t = Math.random() * 10; this.phase = Math.random() * 6; this.speed = 0;
    this.crouch = false; this.armed = true; this.action = null; this.block = false; this.aim = false; this.stagger = 0; this.dead = false; this.deadT = 0; this.deadDir = 1;
    this.kneel = false; this.bound = false; this.bow = 0; this.flee = false; this.sit = false; this.twoHand = true; this.reach = 0;
    this.tip = new THREE.Object3D(); this.base = new THREE.Object3D(); this.parts = {};
    this.build();
  }

  build() {
    const o = this.o, J = this.J, P = this.parts, kind = o.kind || 'mongol';
    const reg = (n, m) => { (P[n] ||= []).push(m); return m; };
    const uniq = (c, opt) => (o.own ? M(c, opt).clone() : M(c, opt));
    const skin = M(o.skin ?? 0xb98a68), cloth = (this.cloth = uniq(o.cloth ?? 0x30344a)), dark = M(0x15151a), leg = (this.leg = uniq(o.leg ?? 0x1d1d24));
    for (const [s, sx] of [['l', 1], ['r', -1]]) {
      add(J[s + 'Thigh'], B(0.17, 0.47, 0.19), cloth, 0, -0.22, 0); add(J[s + 'Shin'], B(0.12, 0.42, 0.13), leg, 0, -0.21, 0);
      add(J[s + 'Foot'], B(0.11, 0.07, 0.25), dark, 0, -0.035, 0.06); add(J[s + 'Arm'], B(0.115, 0.31, 0.115), cloth, 0, -0.14, 0);
      add(J[s + 'Fore'], B(0.09, 0.27, 0.09), leg, 0, -0.135, 0); add(J[s + 'Hand'], B(0.07, 0.09, 0.08), skin, 0, -0.04, 0);
      if (kind === 'samurai') {
        const lac = (this.lac ||= uniq(o.armor ?? 0x4a1012, { r: 0.42, m: 0.25 })), lace = M(o.lace ?? 0xb8923a, { r: 0.6 });
        reg('sode', add(J[s + 'Arm'], B(0.07, 0.27, 0.2), lac, sx * 0.075, -0.1, 0, 0, 0, sx * 0.22)); reg('sode', add(J[s + 'Arm'], B(0.075, 0.022, 0.205), lace, sx * 0.09, -0.18, 0, 0, 0, sx * 0.22));
        reg('armor', add(J[s + 'Thigh'], B(0.05, 0.3, 0.21), lac, sx * 0.1, -0.15, 0, 0, 0, sx * 0.12)); reg('armor', add(J[s + 'Shin'], B(0.135, 0.3, 0.145), lac, 0, -0.22, 0.005));
      } else if (kind === 'mongol') {
        add(J[s + 'Thigh'], B(0.06, 0.4, 0.22), cloth, sx * 0.09, -0.2, 0);
        if (o.pauldron) add(J[s + 'Arm'], B(0.09, 0.2, 0.22), M(0x26221e, { r: 0.5, m: 0.4 }), sx * 0.07, -0.06, 0, 0, 0, sx * 0.3);
      } else add(J[s + 'Thigh'], B(0.19, 0.5, 0.21), cloth, 0, -0.26, 0);
    }
    add(J.hips, B(0.33, 0.2, 0.22), cloth); add(J.spine, B(0.31, 0.26, 0.2), cloth, 0, 0.11, 0); add(J.chest, B(0.39, 0.3, 0.23), cloth, 0, 0.13, 0);
    add(J.head, B(0.09, 0.09, 0.09), skin, 0, 0.02, 0); add(J.head, B(0.19, 0.22, 0.2), skin, 0, 0.15, 0.005);
    const hair = M(o.hair ?? 0x0d0d10);
    for (const sx of [-1, 1]) { add(J.head, B(0.034, 0.016, 0.01), M(0x0b0b0d), sx * 0.048, 0.168, 0.106); add(J.head, B(0.05, 0.012, 0.012), hair, sx * 0.048, 0.196, 0.107, 0, 0, -sx * (kind === 'mongol' ? 0.3 : 0.12)); }
    add(J.head, B(0.03, 0.05, 0.02), skin, 0, 0.135, 0.11);
    if (o.beard) { add(J.head, B(0.12, 0.07, 0.03), hair, 0, 0.065, 0.1); add(J.head, B(0.1, 0.018, 0.02), hair, 0, 0.105, 0.108); }
    reg('hair', add(J.head, B(0.2, 0.09, 0.21), hair, 0, 0.235, -0.008)); reg('hair', add(J.head, B(0.2, 0.14, 0.06), hair, 0, 0.17, -0.085));

    if (kind === 'samurai') {
      const lac = this.lac, lace = M(o.lace ?? 0xb8923a, { r: 0.6 });
      reg('armor', add(J.chest, B(0.43, 0.34, 0.27), lac, 0, 0.11, 0)); for (const y of [0.0, 0.11, 0.22]) reg('armor', add(J.chest, B(0.436, 0.022, 0.276), lace, 0, y, 0));
      reg('armor', add(J.spine, B(0.36, 0.2, 0.25), lac, 0, 0.13, 0));
      reg('armor', add(J.hips, B(0.3, 0.28, 0.045), lac, 0, -0.2, 0.13, -0.12, 0, 0)); reg('armor', add(J.hips, B(0.3, 0.28, 0.045), lac, 0, -0.2, -0.13, 0.12, 0, 0));
      reg('hair', add(J.head, B(0.05, 0.06, 0.1), hair, 0, 0.3, -0.04));
      const hg = new THREE.Group(); J.head.add(hg); reg('kabuto', hg);
      add(hg, new THREE.SphereGeometry(0.13, 10, 6, 0, TAU, 0, Math.PI / 2), lac, 0, 0.2, 0);
      add(hg, new THREE.CylinderGeometry(0.135, 0.24, 0.13, 10, 1, true, 0.95, TAU - 1.9), M(o.armor ?? 0x4a1012, { r: 0.42, m: 0.25, side: THREE.DoubleSide }), 0, 0.15, 0);
      add(hg, B(0.14, 0.03, 0.06), lac, 0, 0.215, 0.13);
      const gold = M(0xd0a644, { r: 0.35, m: 0.7 }), cs = o.crest === 'horns' ? 1.5 : 1;
      for (const sx of [-1, 1]) add(hg, B(0.022, 0.2 * cs, 0.012), gold, sx * 0.055 * cs, 0.33 + 0.04 * cs, 0.12, 0, 0, -sx * 0.5);
      add(J.hips, B(0.035, 0.05, 0.85), M(0x101014, { r: 0.4 }), 0.19, -0.02, -0.12, -0.35, 0.1, 0);
      reg('hilt', add(J.hips, B(0.03, 0.035, 0.24), M(0x1a1420), 0.2, 0.17, 0.39, -0.35, 0.1, 0));
      if (o.player) {
        reg('kasa', add(J.head, new THREE.ConeGeometry(0.37, 0.16, 16), M(0xa8905a), 0, 0.31, 0));
        reg('mask', add(J.head, B(0.2, 0.11, 0.21), M(0x0e0e11), 0, 0.085, 0.006));
        reg('band', add(J.head, B(0.2, 0.035, 0.21), M(0xa8a294), 0, 0.2, 0.004)); reg('band', add(J.head, B(0.03, 0.2, 0.01), M(0xa8a294), 0.03, 0.12, -0.115, 0.2, 0, 0.1));
        const piv = new THREE.Group(); piv.position.set(0, 0.25, -0.125); J.chest.add(piv); this.cape = piv; reg('cape', piv);
        const cg = new THREE.PlaneGeometry(0.54, 1.05, 1, 3); cg.translate(0, -0.52, 0);
        add(piv, cg, M(0x0c0c10, { side: THREE.DoubleSide }));
        reg('cape', add(J.chest, B(0.44, 0.1, 0.3), M(0x0c0c10), 0, 0.27, 0));
      }
    } else if (kind === 'mongol') {
      const fur = M(0x241a12, { r: 1 }), leather = M(0x2a2420, { r: 0.55, m: 0.3 });
      add(J.chest, B(0.42, 0.33, 0.26), cloth, 0, 0.12, 0); add(J.spine, B(0.37, 0.26, 0.24), cloth, 0, 0.11, 0); add(J.hips, B(0.38, 0.07, 0.26), M(0x16110d), 0, 0.1, 0);
      add(J.hips, B(0.36, 0.4, 0.05), cloth, 0, -0.25, 0.12, -0.1, 0, 0); add(J.hips, B(0.36, 0.4, 0.05), cloth, 0, -0.25, -0.12, 0.1, 0, 0);
      if (o.vest) add(J.chest, B(0.44, 0.3, 0.28), leather, 0, 0.14, 0);
      add(J.chest, B(0.34, 0.07, 0.3), fur, 0, 0.3, 0); add(J.head, B(0.11, 0.035, 0.02), M(0x0d0d10), 0, 0.09, 0.106);
      if (o.helm === 'fur') add(J.head, new THREE.CylinderGeometry(0.1, 0.145, 0.13, 8), fur, 0, 0.28, 0);
      else {
        add(J.head, new THREE.CylinderGeometry(0.02, 0.128, 0.17, 8), steel(), 0, 0.335, 0); add(J.head, new THREE.CylinderGeometry(0.138, 0.138, 0.06, 8), fur, 0, 0.24, 0);
        add(J.head, B(0.22, 0.17, 0.04), leather, 0, 0.14, -0.115); for (const sx of [-1, 1]) add(J.head, B(0.04, 0.15, 0.14), leather, sx * 0.112, 0.14, -0.03);
        if (o.plume) { add(J.head, B(0.03, 0.14, 0.03), steel(), 0, 0.47, 0); add(J.head, B(0.06, 0.2, 0.1), M(0x8a1a12), 0, 0.5, -0.07, -0.5, 0, 0); }
      }
      if (o.cape) { const piv = new THREE.Group(); piv.position.set(0, 0.26, -0.14); J.chest.add(piv); this.cape = piv; const cg = new THREE.PlaneGeometry(0.62, 1.1, 1, 2); cg.translate(0, -0.55, 0); add(piv, cg, M(0x2a1e14, { side: THREE.DoubleSide, r: 1 })); }
    } else {
      add(J.hips, B(0.38, 0.5, 0.25), cloth, 0, -0.2, 0); add(J.chest, B(0.41, 0.32, 0.25), cloth, 0, 0.12, 0);
    }

    // weapon
    const w = new THREE.Group(); this.weapon = w; const hand = o.weapon === 'bow' ? J.lHand : J.rHand; hand.add(w); w.position.set(0, -0.05, 0);
    const wood = M(0x2a1c12), st = steel();
    if (o.weapon === 'katana') {
      add(w, B(0.03, 0.036, 0.26), M(0x16121c), 0, 0, 0.05); add(w, new THREE.CylinderGeometry(0.05, 0.05, 0.012, 8), M(0x8a7a4a, { m: 0.6, r: 0.4 }), 0, 0, 0.19, Math.PI / 2, 0, 0);
      add(w, B(0.011, 0.034, 0.5), st, 0, 0, 0.45); add(w, B(0.011, 0.03, 0.27), st, 0, 0.012, 0.82, -0.09, 0, 0);
      this.base.position.set(0, 0, 0.24); this.tip.position.set(0, 0.03, 0.97);
    } else if (o.weapon === 'sabre') {
      add(w, B(0.03, 0.036, 0.18), wood, 0, 0, 0.02); add(w, B(0.1, 0.03, 0.02), M(0x8a7a4a, { m: 0.6, r: 0.4 }), 0, 0, 0.12);
      add(w, B(0.012, 0.045, 0.42), st, 0, 0, 0.34); add(w, B(0.012, 0.05, 0.32), st, 0, 0.035, 0.68, -0.22, 0, 0);
      this.base.position.set(0, 0, 0.16); this.tip.position.set(0, 0.07, 0.86); this.twoHand = false;
    } else if (o.weapon === 'spear') {
      add(w, B(0.03, 0.03, 2.5), wood, 0, 0, 0.45); add(w, B(0.012, 0.05, 0.34), st, 0, 0, 1.86); add(w, B(0.05, 0.05, 0.06), M(0x8a1a12), 0, 0, 1.66);
      this.base.position.set(0, 0, 1.4); this.tip.position.set(0, 0, 2.03);
    } else if (o.weapon === 'glaive') {
      add(w, B(0.036, 0.036, 2.3), wood, 0, 0, 0.3); add(w, B(0.016, 0.11, 0.62), st, 0, 0.03, 1.72); add(w, B(0.016, 0.08, 0.2), st, 0, 0.08, 2.06, -0.5, 0, 0); add(w, B(0.06, 0.06, 0.08), M(0xd0a644, { m: 0.7, r: 0.35 }), 0, 0, 1.42);
      this.base.position.set(0, 0, 1.3); this.tip.position.set(0, 0.08, 2.15);
    } else if (o.weapon === 'bow') {
      const tg = new THREE.TorusGeometry(0.55, 0.014, 4, 12, Math.PI * 0.85); tg.rotateZ(-Math.PI * 0.925); tg.rotateY(Math.PI / 2); tg.translate(0, 0.55, 0);
      add(w, tg, wood); add(w, B(0.006, 0.006, 1.07), M(0xd8d2c4), 0, 0.42, 0); this.twoHand = false;
      add(J.chest, B(0.1, 0.5, 0.1), M(0x3a2a1a), -0.12, 0.1, -0.16, 0, 0, 0.4);
    } else this.twoHand = false;
    w.add(this.tip, this.base);
    if (o.shield) {
      const sg = new THREE.CylinderGeometry(0.37, 0.37, 0.04, 14); sg.rotateZ(Math.PI / 2);
      add(J.lFore, sg, M(0x4a3626), 0.075, -0.14, 0); const bg = new THREE.SphereGeometry(0.09, 8, 5); add(J.lFore, bg, M(0x8a8478, { m: 0.6, r: 0.4 }), 0.1, -0.14, 0);
      const rg = new THREE.TorusGeometry(0.36, 0.022, 4, 16); rg.rotateY(Math.PI / 2); add(J.lFore, rg, M(0x1c1814), 0.08, -0.14, 0);
    }
  }

  show(name, v) { for (const m of this.parts[name] || []) m.visible = v; }
  setArmed(v) { this.armed = v; this.weapon.visible = v; this.show('hilt', !v); }
  setLook(look) {
    const g = look === 'ghost', s = look === 'samurai';
    this.show('kabuto', s); this.show('sode', !g); this.show('kasa', g); this.show('mask', g); this.show('cape', g); this.show('band', look === 'ronin'); this.show('hair', !s);
    this.lac.color.set(g ? 0x121216 : 0x4a1012); this.cloth.color.set(g ? 0x15151b : 0x30344a); this.lac.roughness = g ? 0.8 : 0.42;
  }
  play(name, t) { (this.action ||= { name, t }).name = name; this.action.t = t; }

  update(dt) {
    const p = this.tp; zero(p); this.t += dt; const t = this.t, sp = this.speed, moving = sp > 0.2;
    if (moving) this.phase += dt * (2.6 + sp * 1.25);
    const run = clamp((sp - 2.5) / 4.5, 0, 1), s = Math.sin(this.phase), c = Math.cos(this.phase);
    let k = 13;
    if (this.dead) {
      this.deadT = Math.min(1, this.deadT + dt / 0.8); const e = this.deadT * this.deadT;
      this.rig.rotation.x = -e * 1.5 * this.deadDir; this.rig.position.y = e * 0.13;
      set(p.lArm, -0.3, 0, 1.15); set(p.rArm, -0.2, 0, -1.0); set(p.lFore, -0.5, 0, 0); set(p.rFore, -0.3, 0, 0);
      set(p.lThigh, -0.25, 0, 0.18); set(p.rThigh, 0.1, 0, -0.22); set(p.lShin, 0.5, 0, 0); set(p.rShin, 0.15, 0, 0); set(p.head, -0.3 * this.deadDir, 0.4, 0); set(p.spine, -0.15 * this.deadDir, 0, 0);
      k = 8;
    } else if (this.kneel || this.sit) {
      p.hy = this.sit ? -0.66 : -0.6;
      if (this.sit) { set(p.lThigh, -1.55, 0, 0.55); set(p.rThigh, -1.55, 0, -0.55); set(p.lShin, 2.1, 0, 0); set(p.rShin, 2.1, 0, 0); set(p.lArm, -0.5, 0, 0.1); set(p.rArm, -0.5, 0, -0.1); set(p.lFore, -0.9, 0, 0); set(p.rFore, -0.9, 0, 0); p.spine[0] = 0.25; }
      else { set(p.lThigh, -1.5, 0, 0.08); set(p.rThigh, -1.5, 0, -0.08); set(p.lShin, 2.55, 0, 0); set(p.rShin, 2.55, 0, 0); set(p.lFoot, 0.6, 0, 0); set(p.rFoot, 0.6, 0, 0);
        if (this.bound) { set(p.lArm, 0.65, 0, -0.3); set(p.rArm, 0.65, 0, 0.3); set(p.lFore, -0.7, 0, 0); set(p.rFore, -0.7, 0, 0); p.head[0] = 0.32 + Math.sin(t * 0.8) * 0.03; p.spine[0] = 0.18; }
        else { set(p.lArm, -0.35, 0, 0.05); set(p.rArm, -0.35, 0, -0.05); set(p.lFore, -1.0, 0, 0); set(p.rFore, -1.0, 0, 0); p.spine[0] = 0.08; } }
      p.spine[0] += this.bow * 0.75; p.head[0] += this.bow * 0.3; p.chest[0] = Math.sin(t * 1.4) * 0.012; k = 5;
    } else {
      if (moving) {
        const sw = lerp(0.42, 0.95, run);
        p.lThigh[0] = -s * sw - 0.12 * run; p.rThigh[0] = s * sw - 0.12 * run;
        p.lShin[0] = Math.max(0, c) * sw * 1.25 + 0.12; p.rShin[0] = Math.max(0, -c) * sw * 1.25 + 0.12;
        set(p.lArm, s * sw * 0.7, 0, 0.1); set(p.rArm, -s * sw * 0.7, 0, -0.1); p.lFore[0] = -0.25 - 0.75 * run; p.rFore[0] = -0.25 - 0.75 * run;
        p.spine[0] = 0.05 + 0.2 * run; p.chest[1] = s * 0.1; p.hips[1] = -s * 0.07; p.hy = -Math.abs(c) * 0.03 * (0.5 + run); p.head[0] = -0.1 * run;
      } else {
        p.chest[0] = Math.sin(t * 1.5) * 0.015; set(p.lArm, 0, 0, 0.09); set(p.rArm, 0, 0, -0.09); p.lFore[0] = -0.14; p.rFore[0] = -0.14; p.head[1] = Math.sin(t * 0.37) * 0.12;
      }
      if (this.crouch) { p.hy -= 0.25; p.lThigh[0] -= 0.85; p.rThigh[0] -= 0.85; p.lShin[0] += 1.45; p.rShin[0] += 1.45; p.spine[0] += 0.42; p.head[0] -= 0.42; }
      const still = sp < 1.2;
      if (this.action) {
        sampleClip(CLIPS[this.action.name], this.action.t, p); k = 26;
        if (still) { p.lThigh[0] = -0.55; p.lShin[0] = 0.62; p.rThigh[0] = 0.42; p.rShin[0] = 0.25; p.hy -= 0.09; }
      } else if (this.block) {
        if (this.o.shield) { set(p.rArm, -0.5, 0, -0.2); p.rFore[0] = -0.9; p.rHand[0] = 0.6; }
        else { set(p.rArm, -1.25, 0, 0.3); set(p.rFore, -1.3, 0, 0); set(p.rHand, 0.9, 1.25, 0); p.spine[0] += 0.05; }
        k = 22;
      } else if (this.aim) {
        set(p.lArm, -1.5, 0, -0.05); set(p.lFore, 0, 0, 0); set(p.rArm, -1.42, 0, -0.35); set(p.rFore, -2.1 * this.aim, 0, 0); p.head[1] = 0.1;
      } else if (this.flee) {
        set(p.lArm, -2.6 + s * 0.3, 0, 0.45); set(p.rArm, -2.6 - s * 0.3, 0, -0.45); p.lFore[0] = -0.5; p.rFore[0] = -0.5; p.spine[0] = 0.3;
      } else if (this.armed && this.weapon.visible) {
        if (this.o.weapon === 'bow') { set(p.lArm, -0.5, 0, 0.1); p.lFore[0] = -0.6; }
        else if (run > 0.3) { set(p.rArm, 0.25 - s * 0.15, 0, -0.28); p.rFore[0] = -0.45; p.rHand[0] = 0.95; }
        else { const g = this.twoHand ? 1 : 0.7; set(p.rArm, -0.95 * g, 0, 0.35 * g); p.rFore[0] = -0.85; p.rHand[0] = 0.75; p.spine[0] += 0.05; p.hy -= still ? 0.04 : 0; if (still) { p.lThigh[0] -= 0.28; p.lShin[0] += 0.36; p.rThigh[0] += 0.16; p.rShin[0] += 0.1; } }
      }
      const upper = this.action || this.block || (this.armed && this.weapon.visible && run <= 0.3 && !this.aim && !this.flee);
      if (upper && this.twoHand) { set(p.lArm, p.rArm[0] * 0.85 - 0.05, 0, -0.5 + p.rArm[2] * 0.5); p.lFore[0] = p.rFore[0] * 0.8 - 0.35; }
      if (this.o.shield && !this.flee) { const up = this.block ? 1 : 0.55; set(p.lArm, -0.35 - 0.3 * up, -1.35, 0.1); set(p.lFore, -1.35, 0, 0); }
      if (this.reach > 0) { set(p.rArm, -1.3 * this.reach, 0, 0.2); p.rFore[0] = -0.4 * this.reach; }
      if (this.stagger > 0) { const g = Math.min(1, this.stagger); p.spine[0] -= 0.42 * g; p.head[0] -= 0.3 * g; p.rArm[2] -= 0.7 * g; p.lArm[2] += 0.7 * g; p.hy -= 0.05 * g; p.lThigh[0] += 0.3 * g; k = 20; }
      p.spine[0] += this.bow * 0.7;
      this.rig.rotation.x = damp(this.rig.rotation.x, 0, 10, dt); this.rig.position.y = damp(this.rig.position.y, 0, 10, dt);
    }
    if (!this.kneel && !this.sit && !this.dead) { p.lFoot[0] = clamp(-(p.lThigh[0] + p.lShin[0]) * 0.8, -0.7, 0.5); p.rFoot[0] = clamp(-(p.rThigh[0] + p.rShin[0]) * 0.8, -0.7, 0.5); }
    const cp = this.cp, J = this.J;
    for (const j of JOINTS) { const a = cp[j], b = p[j]; a[0] = damp(a[0], b[0], k, dt); a[1] = damp(a[1], b[1], k, dt); a[2] = damp(a[2], b[2], k, dt); J[j].rotation.set(a[0], a[1], a[2]); }
    cp.hy = damp(cp.hy, p.hy, k, dt); J.hips.position.y = 0.94 + cp.hy;
    if (this.cape) this.cape.rotation.x = 0.1 + Math.min(sp, 8) * 0.09 + Math.sin(t * 4.3) * 0.035 * (1 + sp * 0.4) + (this.crouch ? 0.3 : 0);
  }
}
