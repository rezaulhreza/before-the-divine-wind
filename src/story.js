import * as THREE from 'three';
import { G, V3, rand } from './core.js';
import { world, LOC, at } from './world.js';
import { cine } from './cinema.js';
import { ui } from './ui.js';
import { audio } from './audio.js';
import { fx } from './fx.js';
import { Actor, Enemy, LOOKS, pairDuel, shootArrow, clearEnemies, clearActors, aliveCount, yawTo } from './game.js';

const SAM = (armor, lace) => ({ kind: 'samurai', weapon: 'katana', armor, lace, cloth: 0x2a2f45 });
const LORD = { kind: 'samurai', weapon: 'katana', armor: 0x1a2242, lace: 0xd8d2c4, crest: 'horns', cloth: 0x1c1c28, hair: 0x8f8f8f, scale: 1.04, beard: true };
const UNCLE = 'Lord Tadakatsu', KAZ = 'Kazuma', TEMUR = 'Temür';
const until = async (fn) => { while (!fn()) await G.frame(); };
const near = (x, z, r) => Math.hypot(G.player.pos.x - x, G.player.pos.z - z) < r;
const later = (sec, fn) => { cine.wait(sec).then(fn); };
// A spoken line during play: subtitle and voice, no camera.
const bark = (who, text, then) => { ui.subs(who, text); const d = audio.voice(text) || 2.4; later(d + 0.5, () => { if (then) then(); else if (!cine.active) ui.subs(null); }); };
const spawn = (list) => list.map(([type, x, z, o]) => new Enemy(type, x, z, o));
let marker = null;
export const getMarker = () => marker;
const goal = (text, x, z) => { ui.objective(text); marker = x === undefined ? null : at(x, z, 0); };

function resetScene() { clearEnemies(); clearActors(); for (const p of G.projectiles) G.scene.remove(p.mesh); G.projectiles.length = 0; G.interacts.length = 0; G.onEnemyDown = G.onTerror = G.onAlert = G.onBossPhase = null; ui.boss(null); ui.hint(null); marker = null; }

G.onPlayerDeath = async () => {
  ui.prompt(null); await cine.wait(1.8); ui.fade(1, 1.2); await cine.wait(1.5);
  ui.card('死', 'You fell', 'The island still waits.'); await cine.wait(2.6); ui.card(null);
  G.checkpoint?.(); G.player.revive(); await cine.wait(0.6); ui.fade(0, 1.4);
};

// ------------------------------------------------------------------ title
export function titleShot() {
  world.setAtmosphere('day'); G.musicBase = 'calm';
  G.player.teleport(-130, 97, 0); G.player.h.setLook('ronin'); G.player.h.setArmed(false); G.player.h.root.visible = false;
  cine.shot({ pos: [at(-121, 121, 2.2), at(-139, 119, 4.5)], look: [at(-130, 96, 5.2), at(-130, 92, 6)], dur: 70, fov: 38, linear: true });
}

// ------------------------------------------------------------------ prologue
async function prologue() {
  const P = G.player; resetScene(); world.setAtmosphere('storm'); G.musicBase = 'tension'; G.fear = 0; G.maxTokens = 1;
  P.h.root.visible = true; P.h.setLook('samurai'); P.h.setArmed(true); P.revive(); P.minHp = 14; P.resolve = 0; P.teleport(2.5, 283, 0);
  G.bounds = [{ x: 0, z: 292, r: 16 }];
  const uncle = new Actor(LORD, -1.5, 283.4, 0); uncle.h.setArmed(true);
  const cols = [[0x4a1012, 0xb8923a], [0x1c2a1c, 0xc8c2b4], [0x101a3a, 0xb8923a], [0x2a1a10, 0x8a1a12]], kinds = ['sword', 'shield', 'spear', 'sword'];
  const allies = [], foes = [];
  for (let i = 0; i < 10; i++) {
    const x = (i < 5 ? -25 + i * 4.2 : 7.5 + (i - 5) * 4.2) + rand(-0.5, 0.5);
    const a = new Actor(SAM(...cols[i % 4]), x, 283 + rand(-0.8, 0.8), 0); a.h.setArmed(true); allies.push(a);
    foes.push(new Actor(LOOKS[kinds[i % 4]], x + rand(-0.5, 0.5), 306 + rand(-1.5, 2.5), Math.PI));
  }
  const uFoe = new Actor(LOOKS.sword, -4.5, 307, Math.PI);
  for (let i = 0; i < 9; i++) new Actor(LOOKS[kinds[(i + 1) % 4]], -30 + i * 7.5 + rand(-2, 2), 312.5 + rand(-1, 1.5), Math.PI);

  await cine.run(async (c) => {
    c.shot({ pos: [V3(74, 36, 232), V3(36, 12, 260)], look: [V3(0, 6, 380), V3(-6, 2, 316)], dur: 20, fov: 36 });
    await c.fade(0, 3.5);
    await c.card('壱岐', 'Iki Island', 'The eleventh year of Bun’ei. Autumn, 1274.', 4.6);
    await c.narr('They came with the autumn tide. Nine hundred ships.');
    await c.narr('Eighty of us rode down to the shore to meet them.');
    c.shot({ pos: [at(-17, 285.2, 1.2), at(7, 286.2, 1.35)], look: [at(-8, 283, 1.5), at(14, 283, 1.45)], dur: 15, fov: 32 });
    await c.say(UNCLE, 'Kazuma. You stand at my right hand today.');
    await c.say(UNCLE, 'Whatever walks out of that sea, we meet it as samurai. Face to face. By name.');
    await c.say(KAZ, 'Yes, uncle.', 1.8);
    c.shot({ pos: [at(-3.4, 280.4, 2.0), at(-2.9, 281.3, 1.85)], look: at(3, 308, 1.4), dur: 8, fov: 40 });
    audio.horn(); await c.wait(2.6);
    await c.say(UNCLE, 'For Iki!', 1.5);
    audio.setMode('combat'); G.musicBase = 'combat';
    c.shot({ pos: [at(-15, 290.5, 0.7), at(-11, 293, 0.95)], look: [at(-2, 289, 1.4), at(1, 296, 1.3)], dur: 4.5, fov: 44 });
    const runs = [uncle.goTo(-4.5, 295.2, 6.4), uFoe.goTo(-4.5, 297.2, 5), P.walkTo(2.5, 291, 6.4)];
    allies.forEach((a, i) => { const z = 294.5 + rand(-1.2, 1.5); runs.push(a.goTo(a.pos.x, z, 6 + rand(0, 1)), foes[i].goTo(a.pos.x, z + 1.95, 4.6 + rand(0, 1))); });
    await Promise.all(runs);
    allies.forEach((a, i) => pairDuel(a, foes[i])); pairDuel(uncle, uFoe);
    await c.wait(0.4);
  });

  goal('Hold the shore');
  ui.hint('<kbd>Left click</kbd> to strike. Click again to chain three cuts.', 10);
  spawn([['sword', 3, 301.5, { yaw: Math.PI }]]).forEach((e) => e.alert(false));
  await until(() => aliveCount() === 0);
  ui.hint('<kbd>Right click</kbd> to block. Block at the last instant to parry.<br><kbd>Space</kbd> to dodge. A red flash cannot be blocked.', 12);
  spawn([['sword', -3, 303, { yaw: Math.PI }], ['spear', 7, 303.5, { yaw: Math.PI }]]).forEach((e) => e.alert(false));
  await until(() => aliveCount() === 0);
  await cine.wait(0.8);

  P.minHp = 0; const temur = new Actor(LOOKS.boss, 2, 313, Math.PI); temur.h.root.visible = false;
  await cine.run(async (c) => {
    goal(null); audio.horn(); G.musicBase = 'tension';
    c.shot({ pos: at(-8, 286.5, 1.2), look: [V3(0, 12, 325), V3(2, 34, 330)], dur: 3.4, fov: 42 });
    for (let i = 0; i < 90; i++) shootArrow(V3(rand(-70, 70), 6 + rand(0, 3), rand(346, 362)), at(rand(-27, 27), rand(283, 301), 0), { time: rand(2.7, 3.9), flaming: true });
    await c.say(UNCLE, 'Arrows! Kazuma, down!', 2.0);
    c.shot({ pos: [at(13, 280, 2.6), at(11, 281, 1.7)], look: at(-1, 293, 1), dur: 4, fov: 40 });
    for (const a of [...allies, ...foes.slice(0, 4)]) later(rand(0.7, 2.0), () => { a.kill(Math.random() < 0.5 ? 1 : -1); tmp.copy(a.pos); tmp.y += 1.2; fx.blood(tmp, 0, -1, 8); });
    later(1.3, () => { world.lightning(); G.shake(0.6); });
    await c.wait(1.7);
    ui.flash(0.9, 1.4); audio.hit(); P.h.dead = true; P.h.deadT = 0; P.h.deadDir = 1; ui.hurt();
    await c.wait(1.6); await c.fade(1, 0.9);
    for (const f of foes.slice(4)) { f.duel = null; f.h.action = null; }
    uncle.duel = null; uncle.h.action = null; uncle.pos.set(-1.5, 0, 296.2); uncle.yaw = 2.6; uncle.h.kneel = true; uncle.h.weapon.visible = false; uFoe.duel = null; uFoe.pos.set(-0.6, 0, 297.9); uFoe.yaw = -2.6; uFoe.h.action = null;
    P.pos.set(5.5, 0, 292.3); P.yaw = 2.2; temur.pos.set(-11, 0, 307); temur.h.root.visible = true; G.musicBase = 'sorrow';
    c.shot({ pos: [at(7.0, 289.0, 0.42), at(6.4, 289.2, 0.5)], look: at(-1.2, 297, 1.25), dur: 16, fov: 33 });
    await c.wait(1.2); await c.fade(0, 2.2);
    temur.goTo(-3.6, 296.1, 1.7).then(() => temur.face(-1.5, 296.2));
    await c.wait(6.5);
    await c.say(TEMUR, 'This one called out his name before he fought. As if I should know it.');
    await c.say(TEMUR, 'Chain him. Let the island watch its lord kneel.');
    await c.say(UNCLE, 'Kazuma… live.', 2.6);
    await c.fade(1, 2.5);
    await c.card('神風の前', 'Before the Divine Wind', '', 5);
  });
}
const tmp = new THREE.Vector3();

// ------------------------------------------------------------------ act one: the way of the samurai
function villageSpawn(withDuelist) {
  const face = (x, z) => yawTo(x, z, -12, 30);
  const list = [['shield', 10, 17, { yaw: face(10, 17), hpMul: 1.25 }], ['sword', 15, 27, { yaw: face(15, 27) }], ['spear', 17, 16, { yaw: face(17, 16) }], ['archer', 24, 22, { yaw: face(24, 22) }], ['archer', 8, 33, { yaw: face(8, 33) }]];
  if (withDuelist) list.unshift(['sword', 6, 21, { yaw: face(6, 21) }]);
  return spawn(list);
}

async function act1() {
  const P = G.player; resetScene(); world.setAtmosphere('mist'); G.musicBase = 'calm'; G.fear = 0; G.maxTokens = 1;
  P.h.root.visible = true; P.revive(); P.minHp = 0; P.h.setLook('ronin'); P.h.setArmed(false); P.teleport(-70, 190, -2.47); P.h.kneel = true; P.resolve = 1;
  G.bounds = [{ x: -70, z: 190, r: 36 }, { x: -93, z: 160, r: 32 }, { x: -120, z: 130, r: 30 }, { x: -130, z: 98, r: 30 }, { x: -96, z: 82, r: 34 }, { x: -58, z: 62, r: 34 }, { x: -22, z: 42, r: 34 }, { x: 10, z: 20, r: 46 }];
  G.checkpoint = () => { P.teleport(-70, 190, -2.47); };

  await cine.run(async (c) => {
    c.shot({ pos: [at(-73.5, 193.5, 1.0), at(-73, 193, 1.3)], look: [at(-71, 191, 17), at(-70, 190, 0.7)], dur: 13, fov: [46, 36] });
    await c.fade(0, 3.5);
    await c.narr('I should have died on that beach.');
    await c.narr('A fisherman’s daughter pulled me from the tide and hid me in the bamboo. She did not stay to learn my name.');
    c.shot({ pos: [at(-66, 187.4, 0.9), at(-67.2, 186.6, 1.5)], look: at(-70, 190, 0.95), dur: 14, fov: 34 });
    await c.narr('Three days. They say my uncle lives. The invaders keep him at Castle Tsurugi, a trophy in chains.');
    P.h.kneel = false;
    await c.narr('I am the last samurai on Iki. So I will do this the way he taught me.');
  });
  goal('Follow the path to the mountain shrine', -130, 100);
  ui.hint('<kbd>W A S D</kbd> to move. <kbd>Shift</kbd> to run.', 9);

  await until(() => near(-100, 153, 16));
  world.setAtmosphere('day', 16);
  const scouts = () => spawn([['sword', -127.5, 126, { yaw: 0.64 }], ['shield', -131.5, 128, { yaw: 0.5 }]]);
  scouts(); G.checkpoint = () => { clearEnemies(); scouts(); P.teleport(-100, 153, -2.3); };
  ui.hint('Two scouts hold the shrine steps.<br><kbd>Right click</kbd> at the instant of a strike to parry.', 10);
  await until(() => aliveCount() === 0 && !P.dead);
  G.checkpoint = () => { P.teleport(-130, 112, Math.PI); };

  goal('Pray at the shrine', -130, 89.5);
  let prayed = false; G.interacts.push({ x: -130, z: 89.6, r: 2.8, label: 'Pray', fn: () => { prayed = true; } });
  await until(() => prayed); G.interacts.length = 0;

  await cine.run(async (c) => {
    goal(null); P.teleport(-130, 90.4, Math.PI); P.h.setArmed(false); P.h.kneel = true; G.musicBase = 'sorrow';
    c.shot({ pos: [at(-130, 101, 1.5), at(-130, 96.5, 1.2)], look: at(-130, 86, 2.7), dur: 11, fov: 34 });
    audio.bell(); await c.wait(3.2);
    c.shot({ pos: [at(-120.5, 99.5, 1.6), at(-122.5, 98, 1.5)], look: [at(-137, 101, 6.8), at(-136, 99, 6.2)], dur: 14, fov: 36 });
    await c.say(UNCLE + ', years ago', 'When you were small, you asked me why we announce ourselves before we fight.');
    await c.say(UNCLE + ', years ago', 'Because a man who hides his face has already decided to be ashamed of what he does.');
    c.shot({ pos: [at(-128.2, 88.2, 1.0), at(-128.5, 88.5, 0.95)], look: at(-130, 90.4, 0.95), dur: 6, fov: 28 });
    await c.say(KAZ, 'I remember, uncle.', 2.4);
    P.hp = 100; P.resolve = 3; audio.heal();
    world.setAtmosphere('sunset', 24);
    c.shot({ pos: [at(-124, 96, 3), at(-121, 95, 3.6)], look: [at(-60, 60, 12), at(8, 20, 24)], dur: 10, fov: 28 });
    await c.wait(2.5);
    await c.narr('Smoke, to the east. Hinode village.');
    await c.wait(1.2); P.h.kneel = false;
  });
  G.musicBase = 'tension'; goal('Reach Hinode village', 0, 26);
  ui.hint('Resolve fills as you fight. <kbd>R</kbd> spends it to heal.', 9);
  const foesV = villageSpawn(true); for (const e of foesV) e.frozen = true;
  G.checkpoint = () => { P.teleport(-130, 104, 2.2); };
  await until(() => near(10, 20, 31));

  // the standoff
  const duelist = foesV[0], A = { x: -9, z: 29 }, dir = { x: 0.882, z: -0.471 };
  let won = false;
  await cine.run(async (c) => {
    goal(null); P.teleport(-17, 33.2, yawTo(-17, 33.2, 6, 21)); P.h.setArmed(false);
    c.shot({ pos: [at(-24, 38, 2.4), at(-20.5, 35.6, 1.8)], look: at(8, 20, 2.6), dur: 9, fov: 36 });
    await P.walkTo(A.x, A.z, 2.2);
    await c.say(KAZ, 'I am Kazuma of clan Tachibana, nephew of Lord Tadakatsu!');
    await c.say(KAZ, 'Send me your best. I will face him as a samurai.');
    c.shot({ pos: [at(1.5, 15.5, 1.5), at(2.2, 16.2, 1.5)], look: at(9, 19.5, 1.5), dur: 7, fov: 34 });
    await c.say('Mongol captain', 'The dead lord’s pup. He wants a duel.');
    await c.say('Mongol captain', 'Give him one.', 1.8);
    c.noSkip = true; c.skip = false;
    const sx = A.x + dir.x * 4.3, sz = A.z + dir.z * 4.3, mx = A.x + dir.x * 2.15, mz = A.z + dir.z * 2.15;
    c.shot({ pos: [at(mx + 0.471 * 8.5, mz + 0.882 * 8.5, 1.0), at(mx + 0.471 * 6.6, mz + 0.882 * 6.6, 1.0)], look: at(mx, mz, 1.15), dur: 6, fov: 30 });
    await duelist.goTo(sx, sz, 1.6);
    duelist.face(A.x, A.z); P.yaw = yawTo(A.x, A.z, sx, sz); P.h.setArmed(false);
    ui.subs('', 'Hold left click. Release the instant he strikes.', true);
    await until(() => G.input.mouse.l);
    ui.subs(null); audio.setMode('none'); G.musicBase = 'none';
    let phase = 0, wait = rand(1.4, 2.4), feints = Math.floor(rand(0, 2.99)), st = 0, feintT = 0, res = null;
    while (!res) {
      const dt = await G.frame(), held = G.input.mouse.l;
      P.h.play('iai', 0.25);
      if (phase === 0) {
        if (!held) { res = 'early'; break; }
        wait -= dt; feintT -= dt;
        if (feintT > 0) duelist.h.play('overhead', 0.1); else duelist.h.action = null;
        if (wait <= 0) { if (feints-- > 0) { feintT = 0.22; wait = rand(1.0, 2.0); audio.step(); } else { phase = 1; duelist.h.tip.getWorldPosition(tmp); fx.glint(tmp, false); audio.grunt(); } }
      } else {
        st += dt; const d = Math.hypot(duelist.pos.x - P.pos.x, duelist.pos.z - P.pos.z);
        if (d > 1.7) { duelist.pos.x -= dir.x * 8.5 * dt; duelist.pos.z -= dir.z * 8.5 * dt; }
        duelist.h.play('overhead', 0.2 + Math.min(1, st / 0.5) * 0.45);
        if (!held) res = st <= 0.52 ? 'win' : 'late'; else if (st > 0.52) res = 'late';
      }
    }
    if (res === 'win') {
      won = true; G.slow(0.2, 1.3); audio.swing(true); P.h.setArmed(true);
      const fx0 = P.pos.x, fz0 = P.pos.z, tx = duelist.pos.x + dir.x * 2.4, tz = duelist.pos.z + dir.z * 2.4; let t = 0, cut = false;
      while (t < 1) { t += (await G.frame()) / 0.2; const k = Math.min(1, t); P.pos.x = fx0 + (tx - fx0) * k; P.pos.z = fz0 + (tz - fz0) * k; P.h.play('iai', 0.5 + k * 0.5);
        if (!cut && k > 0.5) { cut = true; duelist.frozen = false; duelist.alerted = true; duelist.die('open', P); tmp.copy(duelist.pos); tmp.y += 1.3; fx.blood(tmp, dir.x, dir.z, 34); audio.hit(); audio.parry(); ui.flash(0.5, 0.5); G.shake(0.5); } }
      await c.wait(1.7); P.h.action = null; P.gain(1);
    } else {
      duelist.frozen = false; duelist.h.action = null; duelist.alert(false); P.hp = Math.max(20, P.hp - 32); ui.hurt(); audio.hit(); G.shake(0.5); P.h.action = null; P.h.setArmed(true);
      await c.wait(0.5);
    }
    c.noSkip = false;
  });
  G.musicBase = 'combat'; G.maxTokens = 2; goal('Free Hinode village');
  for (const e of G.enemies) { e.frozen = false; e.alert(false); }
  ui.hint(won ? 'One cut. Now the rest come together.' : 'He was faster. Now they all come.', 5);
  G.checkpoint = () => { clearEnemies(); villageSpawn(false).forEach((e) => e.alert(false)); P.teleport(-9, 29, 2.0); P.resolve = Math.max(P.resolve, 1); };
  await until(() => aliveCount() === 0 && !P.dead);
  await cine.wait(1.2);

  const torches = []; for (let i = 0; i < 13; i++) { const x = 60 + i * 3.4 + rand(-1, 1), z = -15 - i * 2.0 + rand(-1.5, 1.5), f = { x, y: world.heightAt(x, z) + 2.1, z, s: 0.5, smoke: false }; torches.push(f); world.fires.push(f); }
  const crone = new Actor({ kind: 'villager', cloth: 0x5a544c, hair: 0xcfcfcf, scale: 0.9, skin: 0xa88668 }, -6, 34.5, 2.0);
  await cine.run(async (c) => {
    goal(null); G.musicBase = 'tension'; P.teleport(8, 29, 0.9); P.h.setArmed(false);
    c.shot({ pos: [at(8.5, 32.5, 1.9), at(9.5, 31.6, 1.8)], look: [at(60, -14, 9), at(84, -30, 11)], dur: 12, fov: 26 });
    audio.horn(); await c.wait(2.8);
    await c.narr('Horns, from the pass. I had shouted my name, and the next valley heard it.');
    crone.goTo(5.6, 30.4, 1.3, 0.3); P.yaw = yawTo(8, 29, -6, 34.5);
    c.shot({ pos: [at(9.6, 34.2, 1.5), at(9.0, 33.6, 1.45)], look: at(6.8, 29.7, 1.2), dur: 40, fov: 34 });
    await c.wait(7.5); P.yaw = yawTo(8, 29, 5.6, 30.4); G.musicBase = 'sorrow';
    await c.say('Old woman', 'You are Tadakatsu’s boy. I watched you. You stood in the open and called for them.');
    await c.say('Old woman', 'My husband stood in the open. My sons stood in the open.');
    await c.say('Old woman', 'Forty more are coming, young lord. They do not fight like you. Stop fighting like you.');
    c.shot({ pos: [at(5.0, 31.6, 1.4), at(5.2, 31.4, 1.42)], look: at(8, 29, 1.5), dur: 12, fov: 30 });
    await c.say(KAZ, 'A samurai does not strike from behind.');
    await c.say('Old woman', 'Then the samurai are all dead. Be something else.');
    crone.h.reach = 1;
    await c.narr('She gave me her husband’s travelling cloak, and his hat. I did not thank her. I did not know how.');
    await c.narr('My uncle would call it murder. My uncle is in a cage.');
    await c.fade(1, 2.2);
    P.h.setLook('ghost');
    for (const f of torches) world.fires.splice(world.fires.indexOf(f), 1);
    await c.card('影の道', 'The Way of Shadow', '', 4.5);
  });
}

// ------------------------------------------------------------------ act two: the way of shadow
function campSpawn() {
  const C = LOC.camp, f = (x, z) => yawTo(x, z, C.x, C.z);
  return spawn([
    ['sword', 112, -52, { patrol: [[112, -52], [121, -86], [140, -110]] }],
    ['spear', 180, -40, { patrol: [[180, -40], [192, -70], [177, -100]] }],
    ['sword', 150, -36, { patrol: [[150, -36], [126, -45], [150, -36], [172, -34]] }],
    ['sword', 147.3, -68.6, { yaw: f(147.3, -68.6), sit: true }], ['shield', 152.9, -71.6, { yaw: f(152.9, -71.6), sit: true }],
    ['sword', 139, -63.6, { yaw: yawTo(139, -63.6, 139, -66) }], ['spear', 159, -76.6, { yaw: yawTo(159, -76.6, 159, -79) }],
    ['archer', 164, -54, { yaw: 0.8 }], ['shield', 158.5, -66, { yaw: -1.6, hpMul: 1.4 }],
  ]);
}

async function act2() {
  const P = G.player; resetScene(); world.setAtmosphere('night'); G.musicBase = 'tension'; G.fear = 0.45; G.maxTokens = 2;
  P.h.root.visible = true; P.revive(); P.minHp = 0; P.h.setLook('ghost'); P.h.setArmed(false); P.h.kneel = false; P.teleport(110, -52, yawTo(110, -52, 150, -70)); P.crouching = true; P.resolve = Math.max(P.resolve, 1);
  G.bounds = [{ x: 150, z: -70, r: 64 }];
  const goro = new Actor({ kind: 'samurai', weapon: 'none', armor: 0x2a1a10, lace: 0x8a1a12, cloth: 0x2a2f45, hair: 0x555555 }, 154, -63.1, 2.6); goro.h.show('kabuto', false); goro.h.show('hilt', false); goro.h.show('sode', false); goro.h.kneel = true; goro.h.bound = true;
  campSpawn();
  let total = 9, barked = false;
  const count = () => goal(`Break the camp. ${aliveCount()} remain`);
  G.onEnemyDown = () => { count(); const left = G.enemies.filter((e) => e.alive && e.state !== 'flee'); if (left.length > 0 && left.length <= 2 && total - aliveCount() >= 4) for (const e of left) later(rand(0.4, 1.4), () => e.terrify()); };
  G.onTerror = () => { if (barked) return; barked = true; bark('Mongol warrior', 'It is not a man! It is not a man!'); };
  G.onAlert = () => { if (!G.hintedSeen) { G.hintedSeen = true; ui.hint('You are seen. Fight, or break their line of sight in the tall grass.', 7); } };
  G.checkpoint = () => { clearEnemies(); campSpawn(); total = 9; P.teleport(110, -52, yawTo(110, -52, 150, -70)); P.crouching = true; P.resolve = Math.max(P.resolve, 1); count(); };

  await cine.run(async (c) => {
    c.shot({ pos: [at(84, -28, 11), at(94, -36, 4.5)], look: at(150, -70, 3), dur: 16, fov: 34 });
    await c.fade(0, 3);
    await c.narr('The warband made camp in the pampas below the pass. Between me and the castle.');
    await c.narr('I would not go around them.');
    c.shot({ pos: [at(113.4, -54.6, 1.5), at(113, -54.4, 1.4)], look: at(110, -52, 0.9), dur: 8, fov: 32 });
    await c.narr('That night I stopped being his nephew. I became the thing in the grass.');
  });
  count();
  ui.hint('<kbd>C</kbd> to crouch. Tall grass hides you.<br>Come from behind, unseen: <kbd>E</kbd> strikes without a sound.<br>What they cannot see, they learn to fear.', 16);
  await until(() => aliveCount() === 0 && !P.dead);
  await cine.wait(1.5);

  await cine.run(async (c) => {
    goal(null); G.musicBase = 'sorrow'; P.crouching = false; P.teleport(151.5, -66.5, yawTo(151.5, -66.5, 154, -63.1)); P.h.setArmed(false);
    c.shot({ pos: [at(149.5, -60.8, 1.3), at(150.2, -61, 1.25)], look: at(153.2, -64.2, 1.0), dur: 26, fov: 34 });
    await P.walkTo(153.1, -64.3, 1.4); P.h.reach = 1; await c.wait(1.2); P.h.reach = 0; goro.h.bound = false; audio.step();
    await c.say('Goro', 'Lord Kazuma? I served your uncle twenty years. I watched you tonight, from this post.');
    await c.say('Goro', 'You came out of the grass like a…');
    await c.say(KAZ, 'Say it.', 1.7);
    await c.say('Goro', '…Like something they are afraid of.');
    c.shot({ pos: [at(155.4, -61.6, 0.9), at(155.2, -61.5, 0.95)], look: at(153.1, -64.3, 1.5), dur: 12, fov: 30 });
    await c.say('Goro', 'Lord Tadakatsu will never forgive what you have become.');
    await c.say(KAZ, 'He has to be alive to forgive me.');
    await c.fade(1, 2.2);
    await c.card('剣城', 'Castle Tsurugi', '', 4.2);
  });
}

// ------------------------------------------------------------------ act three: the uncle
const gateSpawn = () => spawn([
  ['shield', 37.4, -181.6, { yaw: 0 }], ['spear', 42.6, -181.6, { yaw: 0 }],
  ['sword', 30, -166, { patrol: [[30, -166], [51, -171]] }], ['sword', 24, -177, { patrol: [[24, -177], [29, -160]] }], ['archer', 47, -177, { yaw: 0.3 }],
]);

async function act3() {
  const P = G.player; resetScene(); world.setAtmosphere('predawn'); G.musicBase = 'tension'; G.fear = 0.35; G.maxTokens = 2; world.gate.close();
  P.h.root.visible = true; P.revive(); P.minHp = 0; P.h.setLook('ghost'); P.h.setArmed(false); P.h.kneel = false; P.teleport(40, -143, Math.PI); P.crouching = true; P.hp = 100; P.resolve = Math.max(P.resolve, 2);
  G.bounds = [{ x: 40, z: -165, r: 30 }, { x: 40, z: -215, r: 43 }];
  gateSpawn();
  const count = () => goal(`Clear the gate. ${aliveCount()} remain`, 40, -183);
  G.onEnemyDown = count;
  G.checkpoint = () => { clearEnemies(); gateSpawn(); P.teleport(40, -143, Math.PI); P.crouching = true; P.resolve = Math.max(P.resolve, 2); };
  await cine.run(async (c) => {
    c.shot({ pos: [V3(84, 60, -138), V3(66, 53, -158)], look: [V3(40, 46, -218), V3(40, 48, -224)], dur: 18, fov: 32 });
    later(2.4, () => world.lightning());
    await c.fade(0, 3);
    await c.narr('Castle Tsurugi. My uncle’s hall, where he taught me to hold a sword.');
    await c.narr('I came home through the grass, like a thief.');
  });
  count();
  await until(() => aliveCount() === 0 && !P.dead);
  G.onEnemyDown = null; world.gate.open(); goal('Enter the castle', 40, -196);
  G.checkpoint = () => { P.teleport(40, -176, Math.PI); };
  await until(() => P.pos.z < -190.5 && Math.abs(P.pos.x - 40) < 6 && !P.dead);

  const uncle = new Actor({ ...LORD, weapon: 'none' }, 40, -227.2, 0); uncle.h.show('kabuto', false); uncle.h.show('hair', true); uncle.h.show('hilt', false); uncle.h.kneel = true; uncle.h.bound = true;
  let boss = new Enemy('boss', 40, -221.5, { yaw: 0 }); boss.frozen = true;
  await cine.run(async (c) => {
    goal(null); P.crouching = false; P.teleport(40, -196.5, Math.PI); world.gate.close(); G.musicBase = 'tension';
    c.shot({ pos: [at(41.6, -190.5, 2.5), at(41.2, -192.6, 2.1)], look: at(40, -221.5, 2), dur: 12, fov: 36 });
    await c.wait(1.5);
    await c.say(TEMUR, 'So this is the ghost. My men say it is a demon with no face.');
    await c.say(TEMUR, 'I see a boy in a dead farmer’s hat.');
    c.shot({ pos: [at(37.6, -224.3, 1.0), at(37.9, -224.5, 1.0)], look: at(40, -227.2, 0.95), dur: 9, fov: 30 });
    await c.say(UNCLE, 'Kazuma…? No. Tell me the camp below was not you. Tell me those were not your hands.');
    c.shot({ pos: [at(41.3, -199.3, 1.45), at(41.1, -199.1, 1.45)], look: at(40, -196.5, 1.5), dur: 6, fov: 28 });
    await c.say(KAZ, 'I am taking you home, uncle.');
    c.shot({ pos: [at(42, -217.6, 0.8), at(41.6, -217.9, 0.85)], look: at(40, -221.5, 2.0), dur: 12, fov: 32 });
    await c.say(TEMUR, 'Your lord taught me your custom. A name for a name, in the open, and then we see.');
    later(1.2, () => world.lightning());
    await c.say(TEMUR, 'I am Temür. Come, and be a samurai one last time.');
  });
  const startBoss = () => {
    boss.frozen = false; boss.alert(false); G.musicBase = 'combat'; G.fear = 0;
    G.onBossPhase = (b) => {
      bark(TEMUR, 'Enough custom. Kill him.', () => bark(UNCLE, 'Coward! He faced you alone!'));
      world.lightning(); spawn([['sword', 21, -210, {}], ['shield', 59, -212, {}]]).forEach((e) => e.alert(false));
      ui.hint('He has broken his own rule. Nothing binds you now.', 6);
    };
  };
  startBoss(); goal('Defeat Temür');
  G.checkpoint = () => { clearEnemies(); boss = new Enemy('boss', 40, -221.5, { yaw: 0 }); startBoss(); P.teleport(40, -196.5, Math.PI); P.resolve = Math.max(P.resolve, 2); };
  while (boss.alive || P.dead) { await G.frame(); ui.boss('Temür, Noyan of the Eastern Fleet', boss.hp / boss.maxHp); }
  ui.boss(null); G.slow(0.25, 1.6); G.onBossPhase = null; G.checkpoint = null; P.minHp = 1;
  for (const e of G.enemies) if (e.alive) e.terrify();
  await cine.wait(2.2); await until(() => aliveCount() === 0);
  await ending(uncle);
}

async function ending(uncle) {
  const P = G.player; let pick = 0;
  await cine.run(async (c) => {
    c.noSkip = true; goal(null); ui.subs(null); G.musicBase = 'sorrow'; world.setAtmosphere('dawn', 50);
    await c.fade(1, 1.5);
    P.teleport(40, -219.6, Math.PI); P.h.setArmed(false); uncle.h.kneel = false; uncle.h.bound = false; uncle.pos.set(40, 0, -223.6); uncle.yaw = 0;
    c.shot({ pos: [at(47.5, -221.6, 1.5), at(46, -221.6, 1.45)], look: at(40, -221.6, 1.35), dur: 40, fov: 30 });
    await c.wait(1); await c.fade(0, 2.5);
    await c.narr('Temür died the way he asked me to fight. In the open.');
    await c.say(UNCLE, 'Nine days I watched from that post. I prayed you had died on the beach.');
    await c.say(UNCLE, 'Better that, than what the guards whispered. The thing in the grass.');
    await c.say(KAZ, 'It worked, uncle. You are free. The island can be free.');
    c.shot({ pos: [at(41.4, -220.4, 1.6), at(41.2, -220.6, 1.6)], look: at(40, -223.6, 1.62), dur: 30, fov: 26 });
    await c.say(UNCLE, 'It worked. That is what frightens me.');
    await c.say(UNCLE, 'The Shogun will ask who threw down the code on Iki. He will ask me. And he will want a head.');
    await c.say(UNCLE, 'Kneel, Kazuma. Take off that hat. Swear to the code again, here, and I will stand before the Shogun and speak for you.');
    await c.say(UNCLE, 'Or walk out of that gate, and I have no nephew.');
    c.shot({ pos: [at(38.4, -222.6, 1.5), at(38.6, -222.4, 1.5)], look: at(40, -219.6, 1.5), dur: 40, fov: 28 });
    pick = await ui.choice([{ t: 'Kneel', d: 'Return to the code. Stand beside him.' }, { t: 'Walk away', d: 'Keep the shadow. Keep the island.' }]);
    if (pick === 0) {
      P.h.setLook('ronin'); P.h.kneel = true; P.h.bow = 0.5; audio.bell();
      c.shot({ pos: [at(46, -217.4, 0.7), at(44.6, -217, 0.95)], look: at(40, -221.6, 1.0), dur: 26, fov: 30 });
      await c.wait(2.5);
      await c.say(KAZ, 'I did what was needed. I will not tell you it was right.');
      uncle.goTo(40, -220.9, 0.9, 0.1); await c.wait(3); uncle.h.reach = 0.9;
      await c.say(UNCLE, 'No. But you will say so standing beside me. Get up, samurai.');
      await c.wait(1.5);
      const hy = world.heightAt(40, -236);
      c.shot({ pos: [V3(40, hy + 16, -234), V3(40, hy + 21, -238)], look: [V3(10, 22, -80), V3(0, 12, 60)], dur: 40, fov: 34 });
      await c.narr('Lord Tadakatsu spoke for his nephew before the Shogun’s envoy, and was believed. Mostly.');
      await c.narr('Kazuma never wore the hat again. He kept it.');
      await c.narr('Seven years later the fleet came back. Four thousand ships. He met them on the beach, by name, in daylight.');
      await c.narr('And then the wind came.');
    } else {
      await c.say(KAZ, 'I cannot kneel, uncle. Not while one of their ships sits in the bay.');
      await c.say(UNCLE, 'Then I have no nephew.', 2.8);
      await c.say(KAZ, 'No. But you have an island.', 3);
      world.gate.open(); P.yaw = 0;
      c.shot({ pos: [at(38.6, -226.2, 1.75), at(38.9, -225.6, 1.7)], look: at(40, -200, 1.4), dur: 22, fov: 34 });
      P.walkTo(40, -184, 1.5); await c.wait(5);
      await c.say(UNCLE, 'Kazuma.', 2.2); await c.wait(1.2);
      await c.say(UNCLE, '…Do not let them see your face.', 3.6);
      await c.fade(1, 2.5);
      const K = LOC.cliff, hk = world.heightAt(K.x, K.z); P.goal = null; P.teleport(K.x + 4.6, K.z - 1.1, 0.86);
      c.shot({ pos: [V3(K.x - 3.0, hk + 2.6, K.z - 4.9), V3(K.x - 2.2, hk + 2.0, K.z - 3.9)], look: V3(K.x + 28, hk + 0.9, K.z + 22), dur: 40, fov: 36 });
      await c.fade(0, 3);
      await c.narr('No chronicle of Iki records his name. The invaders had one for him, and they did not say it after dark.');
      await c.narr('Seven years later their fleet came back, four thousand ships, and a great wind rose and broke it on the rocks.');
      await c.narr('The fishermen of Iki say the wind had practice.');
    }
    await c.wait(1.5); await c.fade(1, 3.5);
    const s = G.stats;
    ui.card('神風', 'The Divine Wind', `${pick === 0 ? 'The way of the samurai' : 'The way of shadow'}\nFaced in the open: ${s.open}.  Taken from the shadow: ${s.shadow}.  Fled in terror: ${s.routed}.\n\nClick to begin again`);
    await c.wait(2); document.exitPointerLock?.();
    await new Promise((r) => window.addEventListener('pointerdown', r, { once: true }));
    location.reload();
  });
}

export async function runStory(from = 0) {
  const acts = [prologue, act1, act2, act3];
  for (let i = from; i < acts.length; i++) await acts[i]();
}
