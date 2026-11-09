import * as THREE from 'three';
import { G, V3, clamp, damp, dampAngle, angDiff, rand, TAU } from './core.js';
import { Humanoid } from './humanoid.js';
import { heightAt, isTall, resolveCollisions } from './world.js';
import { fx, SwordTrail } from './fx.js';
import { audio } from './audio.js';
import { ui } from './ui.js';

const tA = new THREE.Vector3(), tB = new THREE.Vector3();
export const yawTo = (ax, az, bx, bz) => Math.atan2(bx - ax, bz - az);
const pick = (a) => a[Math.floor(Math.random() * a.length)];

// ------------------------------------------------------------------ actors (scripted characters)
export class Actor {
  constructor(look, x, z, yaw = 0) {
    this.h = new Humanoid(look); this.pos = V3(x, 0, z); this.yaw = yaw; this.speed = 0; this.goal = null; this.radius = 0.42; this.lift = 0; this.blockT = 0; this.duel = null;
    G.scene.add(this.h.root); G.actors.push(this); this.place();
  }
  place() { this.pos.y = heightAt(this.pos.x, this.pos.z) + this.lift; this.h.root.position.copy(this.pos); this.h.root.rotation.y = this.yaw; }
  goTo(x, z, speed = 3, stop = 0.25) { return new Promise((res) => { this.goal = { x, z, speed, stop, res }; }); }
  face(x, z) { this.yaw = yawTo(this.pos.x, this.pos.z, x, z); }
  kill(dir = 1) { this.h.dead = true; this.h.deadDir = dir; this.h.action = null; this.h.block = false; this.duel = null; this.goal?.res(); this.goal = null; }
  remove() { G.scene.remove(this.h.root); const i = G.actors.indexOf(this); if (i >= 0) G.actors.splice(i, 1); }
  stepGoal(dt) {
    if (!this.goal) { this.speed = 0; return; }
    const g = this.goal, dx = g.x - this.pos.x, dz = g.z - this.pos.z, d = Math.hypot(dx, dz);
    if (d < g.stop || G.cine.skip) { if (G.cine.skip) { this.pos.x = g.x; this.pos.z = g.z; } this.goal = null; this.speed = 0; g.res(); }
    else { this.yaw = dampAngle(this.yaw, Math.atan2(dx, dz), 10, dt); const st = Math.min(d, g.speed * dt); this.pos.x += (dx / d) * st; this.pos.z += (dz / d) * st; this.speed = g.speed; }
  }
  update(dt) {
    const h = this.h;
    if (h.dead) { h.speed = 0; h.update(dt); return; }
    this.stepGoal(dt);
    const d = this.duel;
    if (d) {
      this.face(d.foe.pos.x, d.foe.pos.z); d.t -= dt;
      if (d.act) {
        d.at += dt / 0.6; h.play(d.act, Math.min(d.at, 1));
        if (!d.hit && d.at > 0.5) { d.hit = true; if (!d.foe.h.dead) { d.foe.h.block = true; d.foe.blockT = 0.5; tA.copy(this.pos).lerp(d.foe.pos, 0.5); tA.y += 1.3; if (tA.distanceTo(G.camera.position) < 45) { fx.sparks(tA, 6); if (!G.cine.skip) audio.clang(0.12); } } }
        if (d.at >= 1) { h.action = null; d.act = null; d.t = rand(0.7, 2.2); }
      } else if (d.t <= 0 && !d.foe.duel?.act && !d.foe.h.dead) { d.act = pick(['slash1', 'slash2', 'overhead']); d.at = 0; d.hit = false; }
    }
    if (this.blockT > 0) { this.blockT -= dt; if (this.blockT <= 0) h.block = false; }
    h.speed = this.speed; h.update(dt); this.place();
  }
}
export function pairDuel(a, b) { a.duel = { foe: b, t: rand(0.3, 2), act: null, at: 0 }; b.duel = { foe: a, t: rand(1, 3), act: null, at: 0 }; a.face(b.pos.x, b.pos.z); b.face(a.pos.x, a.pos.z); }

// ------------------------------------------------------------------ player
const ATK = {
  l1: { clip: 'slash1', dur: 0.46, hit: [0.16, 0.3], dmg: 26, range: 2.5, arc: 1.3, lunge: 4.2, next: 'l2' },
  l2: { clip: 'slash2', dur: 0.46, hit: [0.15, 0.3], dmg: 26, range: 2.5, arc: 1.3, lunge: 4.2, next: 'l3' },
  l3: { clip: 'overhead', dur: 0.62, hit: [0.24, 0.4], dmg: 40, range: 2.6, arc: 1.0, lunge: 4.6, next: null },
  heavy: { clip: 'heavy', dur: 0.95, hit: [0.52, 0.66], dmg: 62, range: 2.8, arc: 1.0, lunge: 3.2, next: null, breaks: true, heavy: true },
};

export class Player {
  constructor() {
    this.h = new Humanoid({ kind: 'samurai', weapon: 'katana', player: true, own: true });
    this.pos = V3(); this.vel = V3(); this.yaw = 0; this.hp = 100; this.resolve = 0; this.radius = 0.4;
    this.state = 'move'; this.stT = 0; this.crouching = false; this.hidden = false; this.blocking = false; this.blockT = 0; this.locked = false; this.dead = false;
    this.atk = null; this.atkT = 0; this.hitSet = new Set(); this.queued = null; this.iframes = 0; this.dodge = V3(); this.dodgeCd = 0; this.target = null; this.combatT = 0; this.stepAcc = 0; this.swung = false;
    this.speed = 0; this.stealthTarget = null; this.interact = null;
    this.trail = new SwordTrail(G.scene); G.scene.add(this.h.root); this.h.setLook('samurai');
  }
  teleport(x, z, yaw = 0) { this.pos.set(x, heightAt(x, z), z); this.yaw = yaw; this.vel.set(0, 0, 0); this.sync(); }
  revive() { this.dead = false; this.hp = 100; this.state = 'move'; this.h.dead = false; this.h.deadT = 0; this.h.stagger = 0; this.h.action = null; this.locked = false; this.crouching = false; this.blocking = false; }
  sync() { this.pos.y = heightAt(this.pos.x, this.pos.z); this.h.root.position.copy(this.pos); this.h.root.rotation.y = this.yaw; }
  gain(v) { this.resolve = Math.min(3, this.resolve + v); }
  walkTo(x, z, speed = 2.4) { return new Promise((res) => { this.goal = { x, z, speed, res }; }); }
  move(dx, dz) {
    const ox = this.pos.x, oz = this.pos.z; this.pos.x += dx; this.pos.z += dz; resolveCollisions(this.pos, this.radius);
    for (const e of G.enemies) if (e.alive) { const ex = this.pos.x - e.pos.x, ez = this.pos.z - e.pos.z, d = Math.hypot(ex, ez), r = e.radius + this.radius; if (d < r && d > 1e-3) { this.pos.x = e.pos.x + (ex / d) * r; this.pos.z = e.pos.z + (ez / d) * r; } }
    if (G.bounds) { let best = null, bo = 1e9; for (const b of G.bounds) { const o = Math.hypot(this.pos.x - b.x, this.pos.z - b.z) - b.r; if (o < bo) { bo = o; best = b; } } if (bo > 0) { const d = Math.hypot(this.pos.x - best.x, this.pos.z - best.z); this.pos.x = best.x + ((this.pos.x - best.x) / d) * best.r; this.pos.z = best.z + ((this.pos.z - best.z) / d) * best.r; } }
    if (heightAt(this.pos.x, this.pos.z) < -0.45) { this.pos.x = ox; this.pos.z = oz; }
  }
  startAttack(name, wishYaw) {
    const a = ATK[name]; this.state = 'attack'; this.atk = a; this.atkT = 0; this.hitSet.clear(); this.queued = null; this.crouching = false; this.swung = false; this.h.setArmed(true); this.combatT = 5; this.blocking = false;
    const aim = wishYaw ?? this.yaw; let best = null, bs = 1e9;
    for (const e of G.enemies) { if (!e.alive) continue; const d = Math.hypot(e.pos.x - this.pos.x, e.pos.z - this.pos.z); if (d > 5.4) continue; const an = Math.abs(angDiff(aim, yawTo(this.pos.x, this.pos.z, e.pos.x, e.pos.z))); if ((wishYaw === undefined || an < 1.9) && d + an * 1.5 < bs) { bs = d + an * 1.5; best = e; } }
    this.target = best; this.yaw = best ? yawTo(this.pos.x, this.pos.z, best.pos.x, best.pos.z) : aim;
  }
  startDodge(wx, wz) {
    if (this.dodgeCd > 0) return;
    if (wx === 0 && wz === 0) { wx = -Math.sin(this.yaw); wz = -Math.cos(this.yaw); }
    this.dodge.set(wx, 0, wz); this.state = 'dodge'; this.stT = 0; this.iframes = 0.32; this.h.action = null; this.crouching = false; this.blocking = false;
    audio.swing(); fx.dust(this.pos, 5, 0.8);
  }
  receiveAttack(from, dmg, o = {}) {
    if (this.dead || this.locked || G.cine.active) return 'miss';
    if (this.iframes > 0) return 'dodged';
    const facing = Math.abs(angDiff(this.yaw, yawTo(this.pos.x, this.pos.z, from.pos.x, from.pos.z))) < 1.45;
    tA.copy(this.pos); tA.y += 1.3; tA.x += Math.sin(this.yaw) * 0.5; tA.z += Math.cos(this.yaw) * 0.5;
    if (this.blocking && facing && !o.unblockable) {
      if (this.blockT < 0.26 && !o.arrow) { fx.sparks(tA, 26); audio.parry(); G.slow(0.22, 0.42); G.shake(0.35); ui.flash(0.22, 0.3); this.gain(0.34); this.combatT = 5; return 'parried'; }
      fx.sparks(tA, 9); audio.clang(0.6); G.shake(0.15); this.vel.x -= Math.sin(this.yaw) * 3; this.vel.z -= Math.cos(this.yaw) * 3; return 'blocked';
    }
    this.hp = Math.max(this.minHp || 0, this.hp - dmg); ui.hurt(); audio.hit(); audio.grunt(true); G.shake(0.5); G.hitStop(0.05);
    const kx = this.pos.x - from.pos.x, kz = this.pos.z - from.pos.z, kd = Math.hypot(kx, kz) || 1; fx.blood(tA, kx / kd, kz / kd, 12); this.vel.x = (kx / kd) * 5; this.vel.z = (kz / kd) * 5;
    this.h.action = null; this.atk = null; this.combatT = 5; this.iframes = 0.6;
    if (this.hp <= 0) { this.hp = 0; this.dead = true; this.h.dead = true; this.h.deadDir = 1; this.h.deadT = 0; G.stats.deaths++; G.onPlayerDeath?.(); }
    else { this.state = 'stagger'; this.stT = 0; this.h.stagger = 1; }
    return 'hit';
  }
  findStealthTarget() {
    let best = null, bd = 2.5;
    for (const e of G.enemies) {
      if (!e.alive || e.alerted || e.T.boss || e.state === 'flee') continue;
      const d = Math.hypot(e.pos.x - this.pos.x, e.pos.z - this.pos.z); if (d > bd) continue;
      const behind = Math.abs(angDiff(e.yaw, yawTo(e.pos.x, e.pos.z, this.pos.x, this.pos.z))) > 1.6;
      if (behind || this.hidden) { best = e; bd = d; }
    }
    return best;
  }
  async assassinate(e) {
    this.locked = true; this.state = 'kill'; e.frozen = true; this.h.setArmed(true); this.crouching = false; this.vel.set(0, 0, 0);
    const nx = this.pos.x - e.pos.x, nz = this.pos.z - e.pos.z, nd = Math.hypot(nx, nz) || 1;
    this.pos.x = e.pos.x + (nx / nd) * 1.0; this.pos.z = e.pos.z + (nz / nd) * 1.0; this.yaw = yawTo(this.pos.x, this.pos.z, e.pos.x, e.pos.z);
    let t = 0, struck = false; G.slow(0.55, 0.8); audio.swing();
    while (t < 0.8) {
      t += await G.frame(); this.h.play('stab', Math.min(1, t / 0.8));
      if (!struck && t > 0.38) { struck = true; e.frozen = false; e.die('shadow', this); tA.copy(e.pos); tA.y += 1.2; fx.blood(tA, -nx / nd, -nz / nd, 26); audio.hit(); G.shake(0.3); G.hitStop(0.09); }
    }
    this.h.action = null; this.locked = false; this.state = 'move'; this.gain(0.34); this.combatT = 1.5;
  }
  update(dt) {
    const h = this.h, I = G.input;
    this.h.base.getWorldPosition(tA); this.h.tip.getWorldPosition(tB);
    this.trail.update(tA, tB, this.state === 'attack' && this.atk && this.atkT > this.atk.hit[0] - 0.06 && this.atkT < this.atk.hit[1] + 0.07, dt);
    if (this.dead) { h.speed = 0; h.update(dt); this.sync(); return; }
    const scripted = this.locked || G.cine.active || G.mode !== 'play';
    let wx = 0, wz = 0;
    if (!scripted) {
      const f = (I.keys.KeyW || I.keys.ArrowUp ? 1 : 0) - (I.keys.KeyS || I.keys.ArrowDown ? 1 : 0), r = (I.keys.KeyD || I.keys.ArrowRight ? 1 : 0) - (I.keys.KeyA || I.keys.ArrowLeft ? 1 : 0), cy = G.cam.yaw;
      wx = Math.sin(cy) * f - Math.cos(cy) * r; wz = Math.cos(cy) * f + Math.sin(cy) * r; const l = Math.hypot(wx, wz); if (l > 0) { wx /= l; wz /= l; }
    }
    const moving = wx !== 0 || wz !== 0, wishYaw = moving ? Math.atan2(wx, wz) : undefined;
    this.stT += dt; this.iframes -= dt; this.dodgeCd -= dt; this.combatT -= dt;
    let near = null, nd = 1e9, threat = false;
    for (const e of G.enemies) if (e.alive) { const d = Math.hypot(e.pos.x - this.pos.x, e.pos.z - this.pos.z); if (e.alerted && e.state !== 'flee' && d < 30) threat = true; if (d < nd) { nd = d; near = e; } }
    if (threat) this.combatT = Math.max(this.combatT, 2.5);
    this.inCombat = threat;
    let target = 0;
    if (scripted) {
      if (this.state !== 'kill') {
        h.block = false; this.blocking = false; if (this.state !== 'move') { this.state = 'move'; h.action = null; h.stagger = 0; }
        const g = this.goal;
        if (g) {
          const dx = g.x - this.pos.x, dz = g.z - this.pos.z, d = Math.hypot(dx, dz);
          if (d < 0.25 || G.cine.skip) { if (G.cine.skip) { this.pos.x = g.x; this.pos.z = g.z; } this.goal = null; this.vel.set(0, 0, 0); g.res(); }
          else { this.yaw = dampAngle(this.yaw, Math.atan2(dx, dz), 10, dt); this.vel.x = (dx / d) * g.speed; this.vel.z = (dz / d) * g.speed; }
        } else { this.vel.x = damp(this.vel.x, 0, 12, dt); this.vel.z = damp(this.vel.z, 0, 12, dt); }
      }
    }
    else if (this.state === 'move') {
      const was = this.blocking; this.blocking = !!I.mouse.r; if (this.blocking && !was) { this.blockT = 0; h.setArmed(true); this.crouching = false; } if (this.blocking) { this.blockT += dt; this.combatT = Math.max(this.combatT, 2); }
      if (I.pressed.KeyC || I.pressed.ControlLeft) { this.crouching = !this.crouching; }
      this.stealthTarget = this.findStealthTarget();
      let it = null; for (const x of G.interacts) if (Math.hypot(x.x - this.pos.x, x.z - this.pos.z) < x.r) it = x; this.interact = it;
      if (I.pressed.Space) this.startDodge(wx, wz);
      else if (I.pressed.KeyE && this.stealthTarget) this.assassinate(this.stealthTarget);
      else if (I.pressed.KeyE && it) it.fn();
      else if (I.mouse.lp) this.startAttack('l1', wishYaw);
      else if (I.pressed.KeyF) this.startAttack('heavy', wishYaw);
      else if (I.pressed.KeyR && this.resolve >= 1 && this.hp < 100) { this.resolve -= 1; this.hp = Math.min(100, this.hp + 45); audio.heal(); ui.flash(0.12, 0.6); }
      target = this.blocking ? 2.0 : this.crouching ? 2.5 : I.keys.ShiftLeft || I.keys.ShiftRight ? 7.6 : 5.0;
      if (I.keys.ShiftLeft && moving && this.crouching) this.crouching = false;
      this.vel.x = damp(this.vel.x, wx * target, 11, dt); this.vel.z = damp(this.vel.z, wz * target, 11, dt);
      if (this.blocking && near && nd < 9) this.yaw = dampAngle(this.yaw, yawTo(this.pos.x, this.pos.z, near.pos.x, near.pos.z), 14, dt);
      else if (moving) this.yaw = dampAngle(this.yaw, wishYaw, 12, dt);
      if (this.combatT <= 0 && h.armed && !this.blocking) h.setArmed(false); else if (this.combatT > 0 && !h.armed) h.setArmed(true);
    } else if (this.state === 'attack') {
      const a = this.atk; this.atkT += dt; const t = this.atkT / a.dur; h.play(a.clip, Math.min(t, 1));
      let sp = this.atkT < a.hit[0] + 0.06 ? a.lunge : 0;
      if (this.target?.alive) { const d = Math.hypot(this.target.pos.x - this.pos.x, this.target.pos.z - this.pos.z); if (this.atkT < a.hit[1]) this.yaw = dampAngle(this.yaw, yawTo(this.pos.x, this.pos.z, this.target.pos.x, this.target.pos.z), 18, dt); if (d < 1.55) sp = 0; else if (d > 2.2 && sp > 0) sp *= 1.7; } else sp *= 0.4;
      this.vel.x = Math.sin(this.yaw) * sp; this.vel.z = Math.cos(this.yaw) * sp;
      if (!this.swung && this.atkT >= a.hit[0] - 0.05) { this.swung = true; audio.swing(a.heavy); }
      if (this.atkT >= a.hit[0] && this.atkT <= a.hit[1]) this.checkHits(a);
      if (t > 0.25) { if (I.mouse.lp && a.next) this.queued = a.next; if (I.pressed.KeyF) this.queued = 'heavy'; }
      if (I.pressed.Space && t > 0.5) this.startDodge(wx, wz);
      else if (this.queued && t >= 0.74) this.startAttack(this.queued, wishYaw);
      else if (t >= 1) { this.state = 'move'; h.action = null; }
    } else if (this.state === 'dodge') {
      const t = this.stT / 0.36, sp = 13 - 9 * t; this.vel.x = this.dodge.x * sp; this.vel.z = this.dodge.z * sp;
      if (t >= 1) { this.state = 'move'; this.dodgeCd = 0.22; }
    } else if (this.state === 'stagger') {
      this.vel.x = damp(this.vel.x, 0, 8, dt); this.vel.z = damp(this.vel.z, 0, 8, dt); h.stagger = Math.max(0, 1 - this.stT / 0.38);
      if (this.stT > 0.38) { this.state = 'move'; h.stagger = 0; }
    }
    if (this.state !== 'kill') this.move(this.vel.x * dt, this.vel.z * dt);
    this.speed = Math.hypot(this.vel.x, this.vel.z);
    this.hidden = this.crouching && isTall(this.pos.x, this.pos.z);
    h.speed = this.state === 'attack' ? 0 : this.speed; h.crouch = this.crouching || (this.state === 'dodge' && this.stT < 0.26); h.block = this.blocking && this.state === 'move';
    if (this.state === 'move' && this.speed > 1) { this.stepAcc += this.speed * dt; if (this.stepAcc > 2.3) { this.stepAcc = 0; audio.step(this.crouching); if (this.speed > 6) fx.dust(this.pos, 1, 0.5); } }
    h.update(dt); this.sync();
  }
  checkHits(a) {
    for (const e of G.enemies) {
      if (!e.alive || this.hitSet.has(e)) continue;
      const dx = e.pos.x - this.pos.x, dz = e.pos.z - this.pos.z, d = Math.hypot(dx, dz);
      if (d > a.range + e.radius || Math.abs(angDiff(this.yaw, Math.atan2(dx, dz))) > a.arc) continue;
      this.hitSet.add(e);
      const res = e.takeHit(a.dmg, this, a); tA.copy(e.pos); tA.y += 1.25 * (e.h.o.scale || 1);
      if (res === 'blocked') { tA.lerp(this.pos, 0.3); fx.sparks(tA, 10); audio.clang(0.55); G.hitStop(0.04); G.shake(0.14); }
      else if (res !== 'miss') { fx.blood(tA, dx / d, dz / d, res === 'killed' ? 26 : 14); audio.hit(); G.hitStop(a.heavy || res === 'killed' ? 0.1 : 0.06); G.shake(a.heavy ? 0.4 : 0.22); if (res === 'killed') this.gain(0.34); }
    }
  }
}

// ------------------------------------------------------------------ enemies
export const LOOKS = {
  sword: { kind: 'mongol', weapon: 'sabre', cloth: 0x7a5a2a, vest: true, leg: 0x2a1f18 },
  shield: { kind: 'mongol', weapon: 'sabre', shield: true, cloth: 0x3d4a5c, vest: true, leg: 0x2a1f18 },
  spear: { kind: 'mongol', weapon: 'spear', cloth: 0x6a2420, vest: true, leg: 0x2a1f18 },
  archer: { kind: 'mongol', weapon: 'bow', cloth: 0x4a5234, helm: 'fur', leg: 0x2a1f18 },
  boss: { kind: 'mongol', weapon: 'glaive', cloth: 0x1a1a22, vest: true, plume: true, pauldron: true, cape: true, scale: 1.27, leg: 0x14110f, skin: 0xa87a58, beard: true },
};
export const TYPES = {
  sword: { hp: 70, speed: 3.5, dmg: 15, range: 2.1, cd: [1.4, 2.6], wind: 0.62, clips: ['slash1', 'slash2', 'overhead'] },
  shield: { hp: 95, speed: 3.1, dmg: 15, range: 2.1, cd: [1.9, 3.1], wind: 0.66, guard: true, clips: ['slash1', 'overhead'] },
  spear: { hp: 80, speed: 3.3, dmg: 22, range: 3.2, cd: [2.2, 3.4], wind: 0.8, red: 0.5, clips: ['stab'] },
  archer: { hp: 45, speed: 3.3, dmg: 17, range: 2.0, cd: [2.6, 4.2], wind: 0.6, ranged: true, clips: ['slash1'] },
  boss: { hp: 480, speed: 4.1, dmg: 24, range: 3.4, cd: [0.8, 1.6], wind: 0.55, boss: true, clips: ['slash1', 'slash2', 'overhead'] },
};
const markGeo = new THREE.OctahedronGeometry(0.1, 0);

export class Enemy extends Actor {
  constructor(type, x, z, o = {}) {
    super(LOOKS[type], x, z, o.yaw ?? rand(TAU));
    const T = TYPES[type];
    Object.assign(this, { type, T, hp: T.hp * (o.hpMul || 1), alive: true, alerted: false, aware: 0, state: 'idle', stT: 0, cd: rand(0.4, 1.4), hasToken: false, tokenT: 0, strafe: Math.random() < 0.5 ? 1 : -1, strafeT: rand(1, 3), ring: rand(0, 1.6),
      open: 0, guardHits: 0, patrol: o.patrol || null, pi: 0, wait: rand(0, 2), homeYaw: this.yaw, radius: T.boss ? 0.62 : 0.42, frozen: false, alertIn: 0, red: false, clip: 'slash1', struck: false, combo: 0, stDur: 0.4, markT: 0, phase2: false, lookT: rand(TAU) });
    this.maxHp = this.hp; if (o.sit) this.h.sit = true;
    this.mark = new THREE.Mesh(markGeo, new THREE.MeshBasicMaterial({ color: 0xffd060, fog: false, depthTest: false })); this.mark.position.y = 2.2 * (LOOKS[type].scale || 1); this.mark.visible = false; this.mark.renderOrder = 9; this.h.root.add(this.mark);
    G.enemies.push(this);
  }
  release() { if (this.hasToken) { this.hasToken = false; G.tokens = Math.max(0, G.tokens - 1); } }
  alert(shout = true) {
    if (this.alerted || !this.alive) return;
    this.alerted = true; this.aware = 1; this.state = 'combat'; this.stT = 0; this.h.sit = false; this.markT = 1.2; this.cd = rand(0.5, 1.3); this.goal = null;
    if (shout) { audio.grunt(); for (const e of G.enemies) if (e !== this && e.alive && !e.alerted && e.pos.distanceTo(this.pos) < 17) e.alertIn = rand(0.4, 1.1); }
    G.onAlert?.(this);
  }
  perceive(P, dist, toP) {
    if (P.dead || G.cine.active) return 0;
    const ang = Math.abs(angDiff(this.yaw, toP)), night = G.world.name === 'night' || G.world.name === 'predawn' ? 0.72 : 1;
    if (dist < 1.25 && !(P.crouching && ang > 1.6)) return 4;
    const range = (P.hidden ? 2.6 : P.crouching ? 9 : 21) * night, cone = P.crouching ? 0.95 : 1.2;
    let v = 0; if (dist < range && ang < cone) v = (1 - dist / range) * 2.4 + 0.45;
    if (!P.crouching && P.speed > 6 && dist < 8) v = Math.max(v, 0.9);
    return v;
  }
  staggerFor(t, open) { this.release(); this.state = 'stagger'; this.stT = 0; this.stDur = t; this.h.action = null; this.h.aim = 0; this.combo = 0; if (open) this.open = t; this.h.stagger = 1; }
  takeHit(dmg, from, a) {
    if (!this.alive) return 'miss';
    const unaware = !this.alerted; if (unaware) { dmg *= 2.5; this.alert(true); }
    const facing = Math.abs(angDiff(this.yaw, yawTo(this.pos.x, this.pos.z, from.pos.x, from.pos.z))) < 1.2;
    const kx = this.pos.x - from.pos.x, kz = this.pos.z - from.pos.z, kd = Math.hypot(kx, kz) || 1;
    if (this.T.guard && facing && !a.breaks && this.state === 'combat' && this.open <= 0 && !unaware) {
      this.pos.x += (kx / kd) * 0.25; this.pos.z += (kz / kd) * 0.25;
      if (++this.guardHits >= 4) { this.guardHits = 0; this.staggerFor(1.2, true); } else if (!G.hintedGuard) { G.hintedGuard = true; ui.hint('His shield turns your blade. <kbd>F</kbd> a heavy strike breaks a guard.', 7); }
      return 'blocked';
    }
    if (this.open > 0) dmg *= 2.2;
    this.hp -= dmg; const kb = this.T.boss ? 0.15 : a.heavy ? 0.9 : 0.45; this.pos.x += (kx / kd) * kb; this.pos.z += (kz / kd) * kb; resolveCollisions(this.pos, this.radius);
    if (this.hp <= 0) { this.die('open', from); return 'killed'; }
    if (this.T.boss) { if (a.breaks && this.state !== 'leap') this.staggerFor(0.55, false); if (!this.phase2 && this.hp < this.maxHp * 0.5) { this.phase2 = true; G.onBossPhase?.(this); } }
    else this.staggerFor(a.breaks ? 0.95 : 0.42, a.breaks && this.T.guard);
    return 'hit';
  }
  die(cause, by) {
    if (!this.alive) return;
    this.alive = false; this.release(); const h = this.h; h.dead = true; h.deadDir = cause === 'shadow' ? -1 : 1; h.action = null; h.block = false; h.aim = 0; h.stagger = 0; h.sit = false; this.mark.visible = false; this.goal = null;
    audio.grunt(true); if (cause === 'shadow') G.stats.shadow++; else G.stats.open++;
    const left = G.enemies.filter((e) => e.alive && e.state !== 'flee');
    for (const e of left) {
      if (e.T.boss) continue; const d = e.pos.distanceTo(this.pos); if (d > 16) continue;
      const sees = Math.abs(angDiff(e.yaw, yawTo(e.pos.x, e.pos.z, this.pos.x, this.pos.z))) < 1.25 || e.alerted;
      if (G.fear > 0 && sees && Math.random() < G.fear * (cause === 'shadow' ? 1 : 0.5) * (left.length <= 3 ? 1.7 : 1)) e.terrify();
      else if (sees && d < 9 && !e.alerted) e.alertIn = rand(0.5, 1.0);
    }
    G.onEnemyDown?.(this, cause);
  }
  terrify() { if (!this.alive || this.state === 'flee') return; this.release(); this.state = 'flee'; this.stT = 0; this.alerted = true; this.h.flee = true; this.h.action = null; this.h.aim = 0; this.h.sit = false; this.h.weapon.visible = false; this.mark.visible = false; audio.scream(); G.onTerror?.(this); }
  windup(clip, red, wind) {
    this.state = 'windup'; this.stT = 0; this.clip = clip || pick(this.T.clips); this.red = red ?? Math.random() < (this.T.red || 0); this.windT = wind ?? this.T.wind; this.struck = false;
    this.h.tip.getWorldPosition(tA); fx.glint(tA, this.red); audio.grunt(this.T.boss); if (this.red) audio.tone(880, 0.25, 'square', 0.05);
  }
  update(dt) {
    const h = this.h, P = G.player;
    if (!this.alive) { if (!this.routed) { h.speed = 0; h.update(dt); } return; }
    if (this.frozen) { this.stepGoal(dt); h.speed = this.speed; h.update(dt); this.place(); return; }
    this.stT += dt; this.cd -= dt; if (this.open > 0) this.open -= dt;
    if (this.alertIn > 0) { this.alertIn -= dt; if (this.alertIn <= 0) this.alert(false); }
    const dx = P.pos.x - this.pos.x, dz = P.pos.z - this.pos.z, dist = Math.hypot(dx, dz), toP = Math.atan2(dx, dz), T = this.T;
    let mx = 0, mz = 0, spd = 0; h.block = false; h.stagger = 0;
    const fwdX = Math.sin(this.yaw), fwdZ = Math.cos(this.yaw);
    switch (this.state) {
      case 'idle': {
        const v = this.perceive(P, dist, toP);
        this.aware = clamp(this.aware + (v > 0 ? v * 1.15 : -0.3) * dt, 0, 1);
        if (this.aware >= 1) { this.alert(true); break; }
        if (this.aware > 0.3) this.yaw = dampAngle(this.yaw, toP, 2.2, dt);
        else if (this.patrol) {
          const g = this.patrol[this.pi], gx = g[0] - this.pos.x, gz = g[1] - this.pos.z, gd = Math.hypot(gx, gz);
          if (gd < 0.6) { this.wait -= dt; this.yaw += Math.sin(this.stT * 0.9) * 0.6 * dt; if (this.wait <= 0) { this.pi = (this.pi + 1) % this.patrol.length; this.wait = rand(1.5, 4); } }
          else { mx = gx / gd; mz = gz / gd; spd = 1.5; this.yaw = dampAngle(this.yaw, Math.atan2(gx, gz), 5, dt); }
        } else if (!h.sit) this.yaw = this.homeYaw + Math.sin(this.stT * 0.33 + this.lookT) * 0.55;
        break;
      }
      case 'combat': {
        this.yaw = dampAngle(this.yaw, toP, 9, dt); this.strafeT -= dt; if (this.strafeT <= 0) { this.strafe *= -1; this.strafeT = rand(1.5, 4); }
        const px = -dz / (dist || 1), pz = dx / (dist || 1), nx = dx / (dist || 1), nz = dz / (dist || 1);
        if (P.dead) break;
        if (T.ranged) {
          if (dist < 6.5) { mx = -nx; mz = -nz; spd = T.speed; } else if (dist > 24) { mx = nx; mz = nz; spd = T.speed * 1.3; } else { mx = px * this.strafe; mz = pz * this.strafe; spd = 1.1; }
          if (this.cd <= 0 && dist > 4 && dist < 34) { this.state = 'aim'; this.stT = 0; audio.grunt(); }
          else if (this.cd <= 0 && dist < 2.3) this.windup('slash1', false, 0.6);
        } else if (T.boss) {
          if (dist > T.range - 0.2) { mx = nx; mz = nz; spd = dist > 7 ? T.speed * 1.5 : T.speed; } else { mx = px * this.strafe; mz = pz * this.strafe; spd = 1.2; }
          if (this.cd <= 0) {
            if (dist > 6.5 && Math.random() < 0.7) { this.state = 'leap'; this.stT = 0; this.from = this.pos.clone(); this.to = V3(P.pos.x - nx * 1.7, 0, P.pos.z - nz * 1.7); h.tip.getWorldPosition(tA); fx.glint(tA, true); audio.grunt(true); }
            else if (dist < T.range + 0.5) { if (Math.random() < (this.phase2 ? 0.42 : 0.3)) this.windup('sweep', true, 0.85); else { this.combo = this.phase2 ? pick([2, 3, 3]) : pick([1, 2, 2]); this.windup(); } }
          }
        } else {
          if (!this.hasToken && this.cd <= 0 && dist < 10 && G.tokens < G.maxTokens) { this.hasToken = true; this.tokenT = 0; G.tokens++; }
          if (this.hasToken) { this.tokenT += dt; if (this.tokenT > 5) { this.release(); this.cd = rand(0.5, 1.5); } }
          const want = this.hasToken ? T.range * 0.82 : 4.0 + this.ring;
          if (dist > want + 0.35) { mx = nx; mz = nz; spd = dist > 9 ? T.speed * 1.55 : T.speed; }
          else if (dist < want - 0.9) { mx = -nx; mz = -nz; spd = 1.7; }
          if (!this.hasToken && dist < want + 2.5) { mx += px * this.strafe * 0.8; mz += pz * this.strafe * 0.8; spd = Math.max(spd, 1.3); }
          if (this.hasToken && dist < T.range + 0.25) this.windup();
          if (T.guard && dist < 6) h.block = true;
        }
        break;
      }
      case 'windup': {
        this.yaw = dampAngle(this.yaw, toP, 6, dt); const t = this.stT / this.windT; h.play(this.clip, Math.min(0.3, t * 0.3));
        if (t >= 1) { this.state = 'strike'; this.stT = 0; audio.swing(T.boss); }
        break;
      }
      case 'strike': {
        const dur = 0.34, t = this.stT / dur; h.play(this.clip, 0.3 + Math.min(1, t) * 0.55);
        if (this.stT < 0.16 && dist > 1.3) { mx = fwdX; mz = fwdZ; spd = this.clip === 'stab' ? 8 : 6; }
        if (!this.struck && this.stT >= 0.11) {
          this.struck = true; const sweep = this.clip === 'sweep', rng = T.range + (sweep ? 0.9 : 0.55);
          if (dist < rng && Math.abs(angDiff(this.yaw, toP)) < (sweep ? 1.9 : 1.0)) {
            const r = P.receiveAttack(this, T.dmg * (sweep ? 1.3 : 1), { unblockable: this.red });
            if (r === 'parried') { this.staggerFor(T.boss ? 1.25 : 1.7, true); break; }
            if (r === 'blocked') this.cd += 0.3;
          }
        }
        if (t >= 1) { if (this.combo > 1) { this.combo--; this.windup(undefined, false, 0.36); } else { this.state = 'recover'; this.stT = 0; this.combo = 0; } }
        break;
      }
      case 'recover': {
        const dur = T.boss ? 0.75 : 0.55; h.play(this.clip, 0.85 + Math.min(1, this.stT / dur) * 0.15);
        if (this.stT >= dur) { h.action = null; this.release(); this.state = 'combat'; this.cd = rand(T.cd[0], T.cd[1]) * (this.phase2 ? 0.7 : 1); }
        break;
      }
      case 'leap': {
        const t = Math.min(1, this.stT / 0.85); this.pos.x = this.from.x + (this.to.x - this.from.x) * t; this.pos.z = this.from.z + (this.to.z - this.from.z) * t; this.lift = Math.sin(t * Math.PI) * 2.8;
        h.play('overhead', 0.05 + t * 0.6); this.yaw = dampAngle(this.yaw, toP, 4, dt);
        if (t >= 1) { this.lift = 0; this.clip = 'overhead'; this.state = 'recover'; this.stT = 0; fx.dust(this.pos, 26, 2.6); G.shake(0.7); audio.thud(1); if (dist < 3.5) P.receiveAttack(this, 30, { unblockable: true }); }
        break;
      }
      case 'aim': {
        this.yaw = dampAngle(this.yaw, toP, 9, dt); h.aim = Math.min(1, this.stT / 0.9);
        if (this.stT > 0.75 && !this.struck) { this.struck = true; h.tip.getWorldPosition(tA); tA.copy(this.pos); tA.y += 1.5; fx.glint(tA, false); }
        if (this.stT >= T.wind + 0.65) {
          h.aim = 0; this.struck = false; this.state = 'combat'; this.cd = rand(T.cd[0], T.cd[1]);
          tA.set(this.pos.x + fwdX * 0.6, this.pos.y + 1.45, this.pos.z + fwdZ * 0.6); tB.set(P.pos.x + P.vel.x * 0.22, P.pos.y + 1.1, P.pos.z + P.vel.z * 0.22);
          shootArrow(tA, tB, { owner: this, dmg: T.dmg, speed: 36 }); audio.twang();
        }
        break;
      }
      case 'stagger': { h.stagger = Math.max(0.25, 1 - this.stT / this.stDur); if (this.stT >= this.stDur) { this.state = 'combat'; this.cd = Math.max(this.cd, rand(0.3, 0.8)); } break; }
      case 'flee': {
        const d = dist || 1; mx = -dx / d; mz = -dz / d; spd = T.speed * 1.75; this.yaw = dampAngle(this.yaw, Math.atan2(mx, mz), 10, dt);
        if (this.stT > 7 || dist > 55) { this.alive = false; this.routed = true; G.stats.routed++; G.scene.remove(h.root); G.onEnemyDown?.(this, 'routed'); return; }
        break;
      }
    }
    if (spd > 0) {
      const l = Math.hypot(mx, mz) || 1; this.pos.x += (mx / l) * spd * dt; this.pos.z += (mz / l) * spd * dt;
      for (const e of G.enemies) if (e !== this && e.alive) { const ex = this.pos.x - e.pos.x, ez = this.pos.z - e.pos.z, d = Math.hypot(ex, ez); if (d < 1.25 && d > 1e-3) { this.pos.x += (ex / d) * (1.25 - d) * 0.5; this.pos.z += (ez / d) * (1.25 - d) * 0.5; } }
      resolveCollisions(this.pos, this.radius);
      if (heightAt(this.pos.x, this.pos.z) < -0.3) { this.pos.x -= (mx / l) * spd * dt; this.pos.z -= (mz / l) * spd * dt; }
    }
    this.speed = damp(this.speed, spd, 10, dt);
    const m = this.mark; this.markT -= dt;
    if (this.markT > 0) { m.visible = true; m.material.color.set(0xff3020); m.scale.setScalar(1.5); }
    else if (!this.alerted && this.aware > 0.04) { m.visible = true; m.material.color.set(0xffd060); m.scale.set(0.5 + this.aware, 0.5 + this.aware * 1.6, 0.5 + this.aware); }
    else m.visible = false;
    m.rotation.y += dt * 3;
    h.speed = this.speed; h.update(dt); this.place();
  }
}

// ------------------------------------------------------------------ arrows
const arrowGeo = (() => { const g = new THREE.CylinderGeometry(0.012, 0.012, 0.9, 4); g.rotateX(Math.PI / 2); return g; })();
const arrowMat = new THREE.MeshStandardMaterial({ color: 0x6a5238, roughness: 0.8 });
export function shootArrow(from, to, o = {}) {
  const mesh = new THREE.Mesh(arrowGeo, arrowMat); mesh.position.copy(from); G.scene.add(mesh);
  const d = from.distanceTo(to), time = o.time ?? d / (o.speed || 34), vel = to.clone().sub(from).divideScalar(time); vel.y += 0.5 * 9.8 * time;
  G.projectiles.push({ mesh, pos: mesh.position, vel, life: 9, stuck: false, owner: o.owner, dmg: o.dmg || 0, flaming: !!o.flaming, onLand: o.onLand });
}
export function updateProjectiles(dt) {
  const P = G.player;
  for (let i = G.projectiles.length - 1; i >= 0; i--) {
    const p = G.projectiles[i];
    if (p.stuck) { p.life -= dt; if (p.flaming && p.life > 4 && Math.random() < 0.5) fx.flame(p.pos.x, p.pos.y + 0.25, p.pos.z, 0.2); if (p.life <= 0) { G.scene.remove(p.mesh); G.projectiles.splice(i, 1); } continue; }
    p.vel.y -= 9.8 * dt; p.pos.addScaledVector(p.vel, dt); tA.copy(p.pos).add(p.vel); p.mesh.lookAt(tA);
    if (p.flaming) fx.flame(p.pos.x, p.pos.y, p.pos.z, 0.4);
    if (p.dmg > 0 && p.owner && Math.hypot(p.pos.x - P.pos.x, p.pos.z - P.pos.z) < 0.55 && p.pos.y > P.pos.y + 0.2 && p.pos.y < P.pos.y + 1.9) {
      const r = P.receiveAttack(p.owner, p.dmg, { arrow: true });
      if (r !== 'dodged' && r !== 'miss') { G.scene.remove(p.mesh); G.projectiles.splice(i, 1); continue; }
      p.dmg = 0;
    }
    if (p.pos.y <= heightAt(p.pos.x, p.pos.z) + 0.05) { p.stuck = true; p.life = p.flaming ? 9 : 6; p.onLand?.(p); if (p.pos.distanceTo(G.camera.position) < 30) audio.noise(0.05, 'lowpass', 900, 300, 0.12); }
  }
}

export function clearEnemies() { for (const e of G.enemies) { G.scene.remove(e.h.root); const i = G.actors.indexOf(e); if (i >= 0) G.actors.splice(i, 1); } G.enemies.length = 0; G.tokens = 0; }
export function clearActors() { for (const a of [...G.actors]) if (!(a instanceof Enemy)) a.remove(); }
export const aliveCount = () => G.enemies.filter((e) => e.alive).length;
