import { rand } from './core.js';
import { VO } from './vo.js';

// All sound is synthesised: wind, rain, steel, drums, koto and flute.
const SCALE = [0, 1, 5, 7, 8, 12, 13, 17, 19, 20]; // in scale on D
const hz = (semi, base = 146.83) => base * Math.pow(2, semi / 12);
const voKey = (t) => t.toLowerCase().replace(/[^a-z0-9]/g, ''); // must match norm() in tools/make_voices.py
const voBuf = new Map();

export const audio = {
  ctx: null, mode: 'none', timer: 0, beat: 0, flutePhrase: 0, vol: {},
  init() {
    if (this.ctx) return;
    const c = (this.ctx = new (window.AudioContext || window.webkitAudioContext)());
    this.master = c.createGain(); this.master.gain.value = 0.85;
    const comp = c.createDynamicsCompressor(); comp.threshold.value = -16; comp.ratio.value = 4;
    this.master.connect(comp); comp.connect(c.destination);
    this.sfxBus = c.createGain(); this.sfxBus.connect(this.master);
    this.musicBus = c.createGain(); this.musicBus.gain.value = 0.8; this.musicBus.connect(this.master);
    // simple echo for space
    const dl = c.createDelay(1); dl.delayTime.value = 0.33; const fb = c.createGain(); fb.gain.value = 0.34; const lp = c.createBiquadFilter(); lp.frequency.value = 1800;
    this.echo = c.createGain(); this.echo.gain.value = 0.5; this.echo.connect(dl); dl.connect(lp); lp.connect(fb); fb.connect(dl); lp.connect(this.master);
    this.musicBus.connect(this.echo);
    this.voiceBus = c.createGain(); this.voiceBus.gain.value = 1.25; this.voiceBus.connect(this.master);
    const vs = c.createGain(); vs.gain.value = 0.16; this.voiceBus.connect(vs); vs.connect(this.echo);
    const len = c.sampleRate * 2, buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuf = buf;
    this.wind = this.loop('bandpass', 420, 0.5); this.rain = this.loop('highpass', 2600, 0.3); this.fire = this.loop('bandpass', 1100, 0.8); this.sea = this.loop('lowpass', 420, 0.3);
    this.drone = [73.42, 110, 146.83].map((f, i) => { const o = c.createOscillator(), g = c.createGain(); o.type = i === 2 ? 'triangle' : 'sine'; o.frequency.value = f; g.gain.value = 0; o.connect(g); g.connect(this.musicBus); o.start(); return g; });
  },
  loop(type, freq, q) {
    const c = this.ctx, s = c.createBufferSource(); s.buffer = this.noiseBuf; s.loop = true;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = c.createGain(); g.gain.value = 0; s.connect(f); f.connect(g); g.connect(this.master); s.start(Math.random());
    return { g, f };
  },
  noise(dur, type, f0, f1, vol, q = 1, when = 0) {
    if (!this.ctx) return; const c = this.ctx, t = c.currentTime + when, s = c.createBufferSource(); s.buffer = this.noiseBuf;
    const f = c.createBiquadFilter(); f.type = type; f.Q.value = q; f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + Math.min(0.02, dur * 0.2)); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(this.sfxBus); s.start(t, Math.random()); s.stop(t + dur + 0.05);
  },
  tone(freq, dur, type, vol, bus, { attack = 0.004, bend = 1, when = 0, vib = 0 } = {}) {
    if (!this.ctx) return; const c = this.ctx, t = c.currentTime + when, o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(freq * bend, t); if (bend !== 1) o.frequency.exponentialRampToValueAtTime(freq, t + Math.min(0.12, dur));
    if (vib) { const l = c.createOscillator(), lg = c.createGain(); l.frequency.value = 5.2; lg.gain.setValueAtTime(0, t); lg.gain.linearRampToValueAtTime(freq * vib, t + dur * 0.5); l.connect(lg); lg.connect(o.frequency); l.start(t); l.stop(t + dur + 0.1); }
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(bus || this.sfxBus); o.start(t); o.stop(t + dur + 0.05);
  },
  // --- recorded Japanese voice lines, looked up by their English subtitle
  loadVoice(f) {
    if (!voBuf.has(f)) voBuf.set(f, fetch(`audio/vo/${f}.mp3`).then((r) => r.arrayBuffer()).then((b) => this.ctx.decodeAudioData(b)).catch(() => null));
    return voBuf.get(f);
  },
  async preloadVoices() { if (!this.ctx) return; for (const k in VO) await this.loadVoice(VO[k].f); },
  voice(text) {
    const v = VO[voKey(text)]; if (!v || !this.ctx) return 0;
    this.stopVoice(); const id = (this.voiceId = (this.voiceId || 0) + 1);
    this.loadVoice(v.f).then((buf) => {
      if (!buf || id !== this.voiceId) return;
      const s = this.ctx.createBufferSource(); s.buffer = buf; s.connect(this.voiceBus); s.start(); this.voiceSrc = s;
      const t = this.ctx.currentTime; this.musicBus.gain.setTargetAtTime(0.36, t, 0.15); this.musicBus.gain.setTargetAtTime(0.8, t + buf.duration, 0.6);
    });
    return v.d;
  },
  stopVoice() {
    this.voiceId = (this.voiceId || 0) + 1;
    if (this.voiceSrc) { try { this.voiceSrc.stop(); } catch { /* already ended */ } this.voiceSrc = null; }
    if (this.ctx) { const t = this.ctx.currentTime; this.musicBus.gain.cancelScheduledValues(t); this.musicBus.gain.setTargetAtTime(0.8, t, 0.3); }
  },
  // --- effects
  swing(heavy) { this.noise(heavy ? 0.3 : 0.2, 'bandpass', heavy ? 500 : 900, heavy ? 2200 : 3800, heavy ? 0.4 : 0.28, 1.6); },
  clang(v = 0.5) { for (const f of [2140, 3270, 4410, 5790]) this.tone(f * rand(0.97, 1.03), rand(0.25, 0.6), 'sine', v * 0.16); this.noise(0.06, 'highpass', 5000, 3000, v * 0.5); },
  parry() { this.clang(0.9); this.tone(1760, 0.9, 'sine', 0.12); this.tone(2637, 1.2, 'sine', 0.08); },
  hit() { this.noise(0.14, 'lowpass', 1400, 200, 0.7); this.tone(110, 0.16, 'sine', 0.5, null, { bend: 1.8 }); this.noise(0.22, 'bandpass', 2400, 900, 0.22, 2); },
  thud(v = 0.6) { this.tone(70, 0.3, 'sine', v, null, { bend: 2 }); this.noise(0.12, 'lowpass', 500, 100, v * 0.6); },
  step(soft) { this.noise(0.07, 'lowpass', soft ? 500 : 900, 200, soft ? 0.035 : 0.09); },
  arrow() { this.noise(0.22, 'bandpass', 3000, 900, 0.22, 4); },
  twang() { this.tone(220, 0.25, 'triangle', 0.2, null, { bend: 1.5 }); },
  grunt(low) { this.tone(low ? 95 : 150, 0.22, 'sawtooth', 0.14, null, { bend: 1.4 }); this.noise(0.2, 'bandpass', 700, 400, 0.14, 3); },
  scream() { this.tone(520, 0.7, 'sawtooth', 0.09, null, { bend: 0.7, vib: 0.03 }); this.noise(0.6, 'bandpass', 1300, 900, 0.1, 5); },
  heal() { [0, 7, 12].forEach((s, i) => this.tone(hz(s, 587.33), 1.4, 'sine', 0.1, this.musicBus, { when: i * 0.12 })); },
  thunder() { this.noise(3.2, 'lowpass', 220, 40, 0.9, 0.5, 0.25); this.noise(0.5, 'lowpass', 900, 100, 0.5, 0.5, 0.2); },
  horn() { for (const f of [87.3, 87.9, 130.8]) this.tone(f, 3.2, 'sawtooth', 0.11, this.musicBus, { attack: 0.5, bend: 0.94 }); },
  bell() { for (const [f, v] of [[196, 0.2], [392.5, 0.12], [590, 0.08], [831, 0.05]]) this.tone(f, 5, 'sine', v, this.musicBus); },
  taiko(v = 1, hi = false) { this.tone(hi ? 110 : 62, hi ? 0.28 : 0.55, 'sine', 0.75 * v, this.musicBus, { bend: 2.2 }); this.noise(0.07, 'lowpass', hi ? 1800 : 600, 150, 0.4 * v); },
  rim() { this.noise(0.035, 'bandpass', 2400, 1800, 0.22, 5); },
  koto(semi, v = 0.2, when = 0) { const f = hz(semi, 293.66); this.tone(f, 2.2, 'triangle', v, this.musicBus, { bend: 1.025, when }); this.tone(f * 2, 0.8, 'sine', v * 0.35, this.musicBus, { when }); this.tone(f * 3.01, 0.3, 'sine', v * 0.15, this.musicBus, { when }); },
  flute(semi, dur, v = 0.13, when = 0) { const f = hz(semi, 587.33); this.tone(f, dur, 'sine', v, this.musicBus, { attack: 0.22, bend: 0.97, vib: 0.008, when }); this.tone(f * 2, dur, 'sine', v * 0.12, this.musicBus, { attack: 0.3, when }); },

  setAmbience(a) { if (!this.ctx) return; const t = this.ctx.currentTime; for (const k of ['wind', 'rain', 'fire', 'sea']) this[k].g.gain.setTargetAtTime(a[k] || 0, t, 0.8); },
  setMode(m) { if (this.mode === m) return; this.mode = m; this.timer = 0.4; this.beat = 0; },
  update(dt) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, m = this.mode, dv = m === 'none' ? 0 : m === 'combat' ? 0.05 : m === 'tension' ? 0.07 : 0.045;
    this.drone.forEach((g, i) => g.gain.setTargetAtTime(dv * (i === 2 ? 0.35 : 1), t, 1.5));
    this.wind.f.frequency.setTargetAtTime(380 + Math.sin(t * 0.23) * 140 + Math.sin(t * 0.71) * 60, t, 0.5);
    this.timer -= dt; if (this.timer > 0) return;
    const pick = (lo = 0, hi = SCALE.length) => SCALE[lo + Math.floor(Math.random() * (hi - lo))];
    if (m === 'calm') {
      const n = 2 + Math.floor(Math.random() * 4); let w = 0, i = Math.floor(Math.random() * 6);
      for (let k = 0; k < n; k++) { this.koto(SCALE[clampI(i)], 0.16, w); i += Math.random() < 0.6 ? 1 : -2; w += [0.22, 0.44, 0.66][Math.floor(Math.random() * 3)]; }
      this.timer = w + rand(2.2, 4.5);
    } else if (m === 'sorrow') {
      const ph = [[7, 2.6], [8, 1.2], [7, 1.2], [5, 3.2], [1, 1.4], [0, 3.8], [5, 2.2], [7, 3.6], [12, 2.8], [8, 1.4], [7, 4]];
      const [s, d] = ph[this.flutePhrase++ % ph.length]; this.flute(s - 12, d + 0.6); if (Math.random() < 0.5) this.koto(pick(0, 4) - 12, 0.12, 0.3);
      this.timer = d + rand(0.3, 1.4);
    } else if (m === 'tension') {
      this.taiko(0.55); if (this.beat % 4 === 3) this.taiko(0.4, true); if (Math.random() < 0.35) this.koto(pick(0, 3) - 12, 0.14, 0.5);
      this.beat++; this.timer = this.beat % 4 === 0 ? 2.4 : 1.2;
    } else if (m === 'combat') {
      const b = this.beat++ % 16, step = 0.2;
      if ([0, 3, 6, 8, 11, 14].includes(b)) this.taiko(b === 0 ? 1 : 0.7); if ([4, 12].includes(b)) this.taiko(0.6, true); if (b % 2 === 1) this.rim();
      if ([0, 6, 10].includes(b) && Math.random() < 0.8) this.koto(pick(0, 5) - 12, 0.17); if (b === 14 && Math.random() < 0.5) { this.koto(pick(4, 9), 0.13); this.koto(pick(4, 9), 0.13, 0.1); }
      this.timer = step;
    } else this.timer = 0.5;
  },
};
const clampI = (i) => Math.max(0, Math.min(SCALE.length - 1, i));
