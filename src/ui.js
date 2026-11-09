import * as THREE from 'three';

const $ = (s) => document.querySelector(s);
const v = new THREE.Vector3();
let hintTimer = 0;

export const ui = {
  mode(m) { document.body.classList.toggle('cine', m === 'cine'); document.body.classList.toggle('play', m === 'play'); },
  objective(text) { $('#objective').classList.toggle('on', !!text); if (text) $('#objective .text').textContent = text; },
  prompt(key, label) { const el = $('#prompt'); el.classList.toggle('on', !!key); if (key) { el.querySelector('kbd').textContent = key; el.querySelector('span').textContent = label; } },
  hint(html, dur = 8) { const el = $('#hint'); clearTimeout(hintTimer); if (!html) { el.classList.remove('on'); return; } el.innerHTML = html; el.classList.add('on'); hintTimer = setTimeout(() => el.classList.remove('on'), dur * 1000); },
  health(f) { $('#vitals .hp i').style.width = Math.max(0, f) * 100 + '%'; $('#hurt').style.opacity = f < 0.35 ? 0.55 * (1 - f / 0.35) + 0.15 : 0; },
  resolve(n) { document.querySelectorAll('#vitals .resolve b').forEach((b, i) => b.classList.toggle('on', i < Math.floor(n + 0.01))); },
  stealth(t) { const el = $('#stealth'); if (el.textContent !== t) el.textContent = t; },
  boss(name, f) { const el = $('#boss'); el.classList.toggle('on', !!name); if (name) { el.querySelector('.name').textContent = name; el.querySelector('i').style.width = Math.max(0, f) * 100 + '%'; } },
  hurt() { const el = $('#hurt'); el.style.transition = 'none'; el.style.opacity = 0.9; requestAnimationFrame(() => { el.style.transition = 'opacity 0.6s'; el.style.opacity = 0; }); },
  flash(a = 0.8, dur = 0.5) { const el = $('#flash'); el.style.transition = 'none'; el.style.opacity = a; requestAnimationFrame(() => requestAnimationFrame(() => { el.style.transition = `opacity ${dur}s`; el.style.opacity = 0; })); },
  fade(to, dur = 1) { const el = $('#fade'); el.style.transition = dur > 0 ? `opacity ${dur}s ease-in-out` : 'none'; el.style.opacity = to; },
  subs(who, text, narr = false) { const el = $('#subs'); if (!text) { el.classList.remove('on'); return; } el.classList.toggle('narr', narr); el.querySelector('.who').textContent = who || ''; el.querySelector('.line').textContent = text; el.classList.add('on'); },
  card(kanji, big, small) { const el = $('#card'); if (kanji === null) { el.classList.remove('on'); return; } el.querySelector('.kanji').textContent = kanji || ''; el.querySelector('.big').textContent = big || ''; el.querySelector('.small').textContent = small || ''; el.classList.add('on'); },
  choice(options) {
    return new Promise((res) => {
      const el = $('#choice'); el.innerHTML = '';
      const done = (i) => { el.classList.remove('on'); window.removeEventListener('keydown', onKey); res(i); };
      const onKey = (e) => { const i = ['Digit1', 'Digit2'].indexOf(e.code); if (i >= 0 && i < options.length) done(i); };
      options.forEach((o, i) => { const b = document.createElement('button'); b.innerHTML = `<kbd>${i + 1}</kbd><span class="t">${o.t}</span><span class="d">${o.d}</span>`; b.onclick = () => done(i); el.appendChild(b); });
      window.addEventListener('keydown', onKey); el.classList.add('on'); document.exitPointerLock?.();
    });
  },
  marker(pos, camera, from) {
    const el = $('#marker'); if (!pos) { el.style.display = 'none'; return; }
    v.copy(pos); v.y += 2.4; const d = from.distanceTo(pos); v.project(camera);
    if (v.z > 1 || d < 7) { el.style.display = 'none'; return; }
    const x = Math.max(0.04, Math.min(0.96, v.x * 0.5 + 0.5)) * innerWidth, y = Math.max(0.08, Math.min(0.9, -v.y * 0.5 + 0.5)) * innerHeight;
    el.style.display = 'flex'; el.style.transform = `translate(${x - 8}px, ${y - 8}px)`; el.querySelector('.dist').textContent = Math.round(d) + ' m';
  },
};
