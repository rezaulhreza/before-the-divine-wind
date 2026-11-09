import * as THREE from 'three';
import { G, smooth } from './core.js';
import { ui } from './ui.js';

const ev = (x, t, out) => {
  if (typeof x === 'function') return out.copy(x(t));
  if (Array.isArray(x)) return out.copy(x[0]).lerp(x[1], t);
  return out.copy(x);
};

// Scripted camera, subtitles and title cards. Scripts are async functions.
export const cine = {
  active: false, skip: false, pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: 40, s: null, st: 0, waits: [], hold: 0,
  update(dt) {
    if (this.active && !this.noSkip && G.input.keys.Enter) { this.hold += dt; if (this.hold > 0.5 && !this.skip) { this.skip = true; G.audio.stopVoice(); } } else this.hold = 0;
    for (let i = this.waits.length - 1; i >= 0; i--) { const w = this.waits[i]; w.t -= dt; if (w.t <= 0 || this.skip) { this.waits.splice(i, 1); w.res(); } }
    if (this.noSkip !== this.wasNoSkip) { this.wasNoSkip = this.noSkip; document.body.classList.toggle('noskip', !!this.noSkip); }
    const s = this.s; if (!s) return;
    this.st = Math.min(1, this.st + dt / s.dur);
    const t = s.linear ? this.st : smooth(0, 1, this.st);
    ev(s.pos, t, this.pos); ev(s.look, t, this.look);
    this.fov = Array.isArray(s.fov) ? s.fov[0] + (s.fov[1] - s.fov[0]) * t : s.fov ?? 38;
  },
  wait(sec) { return this.skip ? Promise.resolve() : new Promise((res) => this.waits.push({ t: sec, res })); },
  shot(s) { this.s = { dur: 6, ...s }; this.st = 0; this.update(0); },
  async say(who, text, dur) { if (this.skip) return; ui.subs(who, text, false); const v = G.audio.voice(text); await this.wait(v ? Math.max(v + 0.35, dur ?? 0, 1.5) : dur ?? 1.5 + text.length * 0.055); ui.subs(null); await this.wait(0.3); },
  async narr(text, dur) { if (this.skip) return; ui.subs('', text, true); const v = G.audio.voice(text); await this.wait(v ? Math.max(v + 0.5, dur ?? 0, 2) : dur ?? 1.8 + text.length * 0.058); ui.subs(null); await this.wait(0.45); },
  async card(kanji, big, small, dur = 4.5) { if (this.skip) return; ui.card(kanji, big, small); await this.wait(dur); ui.card(null); await this.wait(1.5); },
  async fade(to, dur = 1.2) { ui.fade(to, this.skip ? 0 : dur); await this.wait(dur); },
  async run(fn) {
    this.active = true; this.skip = false; this.noSkip = false; ui.mode('cine'); ui.prompt(null); ui.hint(null);
    try { await fn(this); } finally { ui.subs(null); ui.card(null); this.active = false; this.skip = false; this.noSkip = false; this.s = null; this.waits.length = 0; ui.mode('play'); G.camBlend = 1; }
  },
};
