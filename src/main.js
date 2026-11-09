import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { G, clamp, damp, lerp, smooth } from './core.js';
import { buildWorld, world, heightAt } from './world.js';
import { fx } from './fx.js';
import { audio } from './audio.js';
import { ui } from './ui.js';
import { cine } from './cinema.js';
import { Player, updateProjectiles } from './game.js';
import { runStory, titleShot, getMarker } from './story.js';

const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
let pixelRatio = Math.min(devicePixelRatio, 1.5);
renderer.setPixelRatio(pixelRatio); renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.15, 3200);
Object.assign(G, { scene, camera, renderer, world, cine, audio, ui, focus: new THREE.Vector3(), camBlend: 0, musicBase: 'none',
  input: { keys: {}, pressed: {}, mouse: { l: false, r: false, lp: false }, dx: 0, dy: 0 },
  cam: { yaw: 0, pitch: 0.2, dist: 4.9, cur: 4.9, target: new THREE.Vector3() } });

buildWorld(scene);
fx.init(scene);
const player = (G.player = new Player());

// ---------- post processing
const buf = renderer.getDrawingBufferSize(new THREE.Vector2());
const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(buf.x, buf.y, { type: THREE.HalfFloatType, samples: 4 }));
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(buf.x / 2, buf.y / 2), 0.42, 0.8, 0.95); composer.addPass(bloom);
const grade = new ShaderPass({
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uSat: { value: 1 }, uTint: { value: new THREE.Color(1, 1, 1) }, uVig: { value: 0.85 }, uGrain: { value: 0.03 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float uTime, uSat, uVig, uGrain; uniform vec3 uTint; varying vec2 vUv;
    void main(){
      vec2 c = vUv - 0.5; float r2 = dot(c, c);
      vec3 col = vec3(texture2D(tDiffuse, vUv + c * r2 * 0.008).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - c * r2 * 0.008).b);
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(l), col, uSat) * uTint;
      col *= 1.0 - uVig * smoothstep(0.12, 0.8, r2 * 1.7);
      float g = fract(sin(dot(vUv * vec2(1920.0, 1080.0) + uTime * 61.0, vec2(12.9898, 78.233))) * 43758.5453) - 0.5;
      col += g * uGrain * (0.35 + l);
      gl_FragColor = vec4(max(col, 0.0), 1.0);
    }`,
});
composer.addPass(grade); composer.addPass(new OutputPass());

function resize() {
  renderer.setPixelRatio(pixelRatio); renderer.setSize(innerWidth, innerHeight); renderer.getDrawingBufferSize(buf);
  composer.setSize(buf.x, buf.y); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
}
addEventListener('resize', resize);

// ---------- input
const I = G.input;
addEventListener('keydown', (e) => { if (e.repeat) return; I.keys[e.code] = true; I.pressed[e.code] = true; if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault(); });
addEventListener('keyup', (e) => { I.keys[e.code] = false; });
addEventListener('blur', () => { I.keys = {}; I.mouse.l = I.mouse.r = false; });
canvas.addEventListener('mousedown', (e) => { if (e.button === 0) { I.mouse.l = true; I.mouse.lp = true; } if (e.button === 2) I.mouse.r = true; });
addEventListener('mouseup', (e) => { if (e.button === 0) I.mouse.l = false; if (e.button === 2) I.mouse.r = false; });
addEventListener('contextmenu', (e) => e.preventDefault());
addEventListener('mousemove', (e) => { if (document.pointerLockElement === canvas || e.buttons) { I.dx += e.movementX; I.dy += e.movementY; } });
const lock = () => { try { const p = canvas.requestPointerLock?.(); p?.catch?.(() => {}); } catch { /* pointer lock is optional */ } };
canvas.addEventListener('click', () => { if (G.mode === 'play' && document.pointerLockElement !== canvas) lock(); });
let wasLocked = false;
const pauseEl = document.getElementById('pause');
function setPaused(v) { G.paused = v; pauseEl.classList.toggle('on', v); if (audio.ctx) v ? audio.ctx.suspend() : audio.ctx.resume(); }
document.addEventListener('pointerlockchange', () => { const l = document.pointerLockElement === canvas; if (!l && wasLocked && G.mode === 'play' && !cine.active && !player.dead) setPaused(true); wasLocked = l; });
pauseEl.addEventListener('click', () => { setPaused(false); lock(); });

// ---------- camera
const camT = new THREE.Vector3(), want = new THREE.Vector3(), look = new THREE.Vector3(), lookT = new THREE.Vector3(), lastPos = new THREE.Vector3(), lastLook = new THREE.Vector3(), fwd = new THREE.Vector3();
let lastFov = 40, wasCine = true;
function updateCamera(raw) {
  const cam = G.cam, useCine = cine.active || G.mode !== 'play';
  if (!useCine && wasCine) { cam.yaw = player.yaw; cam.pitch = 0.2; cam.target.set(player.pos.x, player.pos.y + 1.55, player.pos.z); }
  wasCine = useCine;
  if (!useCine && !G.paused) { cam.yaw -= I.dx * 0.0023; cam.pitch = clamp(cam.pitch + I.dy * 0.0019, -0.3, 1.15); }
  camT.set(player.pos.x, player.pos.y + (player.crouching ? 1.2 : 1.55), player.pos.z);
  if (cam.target.distanceTo(camT) > 6) cam.target.copy(camT);
  cam.target.x = damp(cam.target.x, camT.x, 16, raw); cam.target.y = damp(cam.target.y, camT.y, 9, raw); cam.target.z = damp(cam.target.z, camT.z, 16, raw);
  cam.cur = damp(cam.cur, cam.dist + (player.inCombat ? 1.0 : 0) - (player.crouching ? 0.6 : 0), 3.5, raw);
  const cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch), d = cam.cur, rx = -Math.cos(cam.yaw), rz = Math.sin(cam.yaw), sh = 0.55;
  want.set(cam.target.x - Math.sin(cam.yaw) * cp * d + rx * sh, cam.target.y + sp * d + 0.12, cam.target.z - Math.cos(cam.yaw) * cp * d + rz * sh);
  const gh = heightAt(want.x, want.z) + 0.3; if (want.y < gh) want.y = gh;
  lookT.set(cam.target.x + rx * sh, cam.target.y + 0.12, cam.target.z + rz * sh);
  let fov = 52 + (player.speed > 6.5 ? 4 : 0);
  if (useCine) {
    camera.position.copy(cine.pos); const ch = heightAt(cine.pos.x, cine.pos.z) + 0.22; if (camera.position.y < ch) camera.position.y = ch;
    look.copy(cine.look); fov = cine.fov;
    if (camera.aspect < 1.6) fov = (Math.atan(Math.tan((fov * Math.PI) / 360) * Math.min(2.2, 1.6 / camera.aspect)) * 360) / Math.PI; // keep the framing in narrow windows
    lastPos.copy(camera.position); lastLook.copy(look); lastFov = fov; camera.fov = fov;
  } else if (G.camBlend > 0) {
    G.camBlend = Math.max(0, G.camBlend - raw / 1.3); const k = smooth(0, 1, G.camBlend);
    camera.position.copy(want).lerp(lastPos, k); look.copy(lookT).lerp(lastLook, k); camera.fov = lerp(fov, lastFov, k);
  } else { camera.position.copy(want); look.copy(lookT); camera.fov = damp(camera.fov, fov, 5, raw); }
  if (G.shakeAmt > 0.001) { const s = G.shakeAmt * 0.2; camera.position.x += (Math.random() - 0.5) * s; camera.position.y += (Math.random() - 0.5) * s; camera.position.z += (Math.random() - 0.5) * s; G.shakeAmt = damp(G.shakeAmt, 0, 7, raw); }
  camera.updateProjectionMatrix(); camera.lookAt(look);
  if (useCine) { fwd.copy(look).sub(camera.position); const l = fwd.length(); fwd.multiplyScalar(Math.min(20, l) / (l || 1)); G.focus.copy(camera.position).add(fwd); }
  else G.focus.copy(player.pos);
}

// ---------- hud, sound mix
let mixT = 0;
function updateHud(raw) {
  if (G.mode !== 'play') return;
  ui.health(player.hp / 100); ui.resolve(player.resolve);
  ui.stealth(cine.active ? '' : player.hidden ? 'Hidden in the grass' : player.crouching ? 'Crouched' : '');
  if (cine.active || player.dead || player.state !== 'move') ui.prompt(null);
  else if (player.stealthTarget) ui.prompt('E', 'Strike from the shadow');
  else if (player.interact) ui.prompt('E', player.interact.label);
  else ui.prompt(null);
  ui.marker(cine.active ? null : getMarker(), camera, player.pos);
  mixT -= raw; if (mixT > 0) return; mixT = 0.5;
  const a = world.atm; let fire = 0;
  for (const f of world.fires) fire = Math.max(fire, f.s * clamp(1 - Math.hypot(f.x - camera.position.x, f.z - camera.position.z) / 30, 0, 1));
  audio.setAmbience({ wind: 0.04 + a.wind * 0.05, rain: a.rain * 0.11, fire: Math.min(0.16, fire * 0.09), sea: clamp((camera.position.z - 230) / 60, 0, 1) * 0.16 });
  audio.setMode(player.dead ? 'sorrow' : player.inCombat && !cine.active ? 'combat' : G.musicBase);
}

// ---------- loop
let last = performance.now(), slowFrames = 0, frames = 0;
function tick(now) {
  requestAnimationFrame(tick);
  const raw = Math.min(0.05, (now - last) / 1000); last = now;
  if (G.paused) { I.pressed = {}; I.mouse.lp = false; I.dx = I.dy = 0; return; }
  const dt = raw * (now < G.slowUntil ? G.slowScale : 1);
  G.dt = dt; G.rawDt = raw; G.time += dt;
  cine.update(raw);
  player.update(dt);
  for (const a of [...G.actors]) a.update(dt);
  updateProjectiles(dt);
  updateCamera(raw);
  world.update(dt, raw, camera, G.focus, player.pos);
  fx.update(dt, camera, world.atm, world.fires, buf);
  audio.update(raw); updateHud(raw);
  const a = world.atm; renderer.toneMappingExposure = a.expo;
  grade.uniforms.uTime.value = G.time % 100; grade.uniforms.uSat.value = a.sat * (player.dead ? 0.35 : 1); grade.uniforms.uTint.value.copy(a.tint);
  composer.render();
  const w = G.frameWaiters; G.frameWaiters = []; for (const r of w) r(dt);
  I.pressed = {}; I.mouse.lp = false; I.dx = I.dy = 0;
  // drop resolution if the machine cannot hold the frame rate
  frames++; if (raw > 0.027) slowFrames++;
  if (frames >= 150) { if (slowFrames > 90 && pixelRatio > 0.8) { pixelRatio = Math.max(0.75, pixelRatio - 0.25); resize(); } frames = slowFrames = 0; }
}

// ---------- start
const params = new URLSearchParams(location.search), startAct = parseInt(params.get('act') || '0', 10);
titleShot();
const begin = document.getElementById('begin');
begin.disabled = false; begin.textContent = 'Begin';
ui.fade(0, 2.5);
begin.addEventListener('click', async () => {
  begin.disabled = true; audio.init(); audio.ctx.resume(); audio.preloadVoices(); lock();
  ui.fade(1, 1.4); document.getElementById('title').classList.add('off');
  await cine.wait(1.6);
  G.mode = 'play'; runStory(startAct).catch((e) => console.error(e));
});
addEventListener('unhandledrejection', (e) => console.error('story error', e.reason));
window.G = G;
// debug helpers: dbg.view(x, z, heightAboveGround, lookX, lookZ, lookHeight, fov), dbg.atm('night')
window.dbg = {
  view(x, z, dy, lx, lz, ldy, fov = 45) { cine.shot({ pos: new THREE.Vector3(x, heightAt(x, z) + dy, z), look: new THREE.Vector3(lx, heightAt(lx, lz) + ldy, lz), fov, dur: 1 }); },
  atm(name, dur = 0) { world.setAtmosphere(name, dur); },
};
requestAnimationFrame(tick);
