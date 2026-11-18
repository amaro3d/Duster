import { ENVS } from './envs.js';

export class Hud {
  constructor() {
    const $ = (id) => document.getElementById(id);
    this.el = { speed: $('speed'), score: $('score'), best: $('best'), popup: $('popup'), hint: $('hint'), combo: $('combo'), bar: $('progress-fill'), tube: $('tube'), fade: $('fade'), envname: $('envname'), mode: $('modeb'), hud: $('hud') };
    this.pt = 0; this.lastText = '';
  }
  popup(text, sec = 1.6, big = false) {
    const p = this.el.popup; p.textContent = text; p.className = big ? 'big show' : 'show';
    clearTimeout(this.pt); this.pt = setTimeout(() => { p.className = ''; }, sec * 1000);
  }
  hint(t) { if (t !== this.lastText) { this.el.hint.textContent = t; this.el.hint.style.opacity = t ? 1 : 0; this.lastText = t; } }
  combo(t) { this.el.combo.textContent = t; }
  env(e) { this.el.envname.textContent = e.name; }
  update(g) {
    const e = this.el;
    const kmh = Math.round((g.speed || 0) * 3.6);
    e.speed.textContent = String(kmh);
    e.score.textContent = String(Math.floor(g.score + (g.waveScore || 0))).padStart(6, '0');
    e.best.textContent = String(Math.floor(g.best || 0)).padStart(6, '0');
    const prog = Math.max(0, Math.min(1, g.z / g.env.zEnd));
    e.bar.style.width = (prog * 100).toFixed(1) + '%';
    e.tube.style.opacity = g.inTube && g.mode === 'ride' ? 1 : 0;
    e.tube.textContent = g.inTube ? `TUBO  ${g.tubeTime.toFixed(1)}s` : '';
    e.combo.textContent = g.combo > 1 ? `COMBO ×${(1 + Math.min(g.combo, 8) * 0.25).toFixed(2)}` : '';
    e.fade.style.opacity = g.fade || 0;
    e.mode.textContent = g.bot ? 'MODO CINEMA' : '';
  }
}

export function buildMenu(onPick) {
  const wrap = document.getElementById('cards');
  ENVS.forEach((env, i) => {
    const d = document.createElement('button'); d.className = 'card'; d.dataset.i = i;
    const g = `linear-gradient(180deg, ${env.skyTop} 0%, ${env.skyHor} 46%, ${env.shallow} 52%, ${env.deep} 100%)`;
    d.innerHTML = `<span class="sw" style="background:${g}"></span><b>${env.name}</b><i>${env.sub}</i>`;
    d.onclick = () => { [...wrap.children].forEach((c) => c.classList.remove('on')); d.classList.add('on'); onPick(i); };
    wrap.appendChild(d);
    if (i === 0) d.classList.add('on');
  });
}
