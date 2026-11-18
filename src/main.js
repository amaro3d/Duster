import { Game } from './game.js';
import { Hud, buildMenu } from './ui.js';

const canvas = document.getElementById('c');
const hud = new Hud();
const game = new Game(canvas, hud);
window.__game = game;
hud.env(game.env);

let playing = false;
if (game.isTouch) document.body.classList.add('touch');
const menu = document.getElementById('menu'), pause = document.getElementById('pause');
buildMenu((i) => { game.setEnv(i); hud.env(game.env); game.bot = true; });
game.bot = true; // câmera de cinema no menu

function start() {
  game.audio.init(); game.audio.resume();
  menu.classList.add('hide'); playing = true; document.body.classList.add('playing');
  game.bot = false; game.score = 0; game.beginPaddle();
  hud.env(game.env);
  if (game.isTouch) {
    try { const r = document.documentElement.requestFullscreen && document.documentElement.requestFullscreen(); if (r && r.catch) r.catch(() => {}); } catch (e) {}
    try { screen.orientation && screen.orientation.lock && screen.orientation.lock('landscape').catch(() => {}); } catch (e) {}
  } else { try { canvas.requestPointerLock && canvas.requestPointerLock(); } catch (e) {} }
}
document.getElementById('play').onclick = start;
pause.onclick = () => { try { canvas.requestPointerLock(); } catch (e) {} game.paused = false; pause.classList.remove('on'); game.audio.resume(); };
document.addEventListener('pointerlockchange', () => {
  if (!playing || game.isTouch) return;
  if (document.pointerLockElement !== canvas) { game.locked = false; game.paused = true; pause.classList.add('on'); }
  else { game.locked = true; game.paused = false; pause.classList.remove('on'); }
});
window.addEventListener('keydown', (e) => {
  if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
  if (e.repeat) return;
  if (!playing && e.code === 'Enter') { start(); return; }
  game.keyDown(e.code);
});
window.addEventListener('keyup', (e) => game.keyUp(e.code));
window.addEventListener('mousemove', (e) => {
  if (document.pointerLockElement === canvas) { game.locked = true; game.mouseDX += e.movementX; game.mouseDY += e.movementY; }
  else { game.locked = false; if (playing && !game.bot) game.mousePos = e.clientX / window.innerWidth; }
});
document.addEventListener('pointerlockerror', () => { game.locked = false; game.paused = false; pause.classList.remove('on'); });
window.addEventListener('resize', () => game.resize());
canvas.addEventListener('mousedown', () => { if (playing && document.pointerLockElement !== canvas) { try { canvas.requestPointerLock(); } catch (e) {} } });

let last = performance.now();
function frame(now) {
  const dt = Math.min((now - last) / 1000, 0.05); last = now;
  if (!window.__manual) { game.update(dt); game.render(); }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
// API para testes
window.__api = {
  step(sec, dt = 1 / 60) { const n = Math.round(sec / dt); for (let i = 0; i < n; i++) game.update(dt); },
  render() { game.render(); },
};

// ---- controles de toque ----
const stick = document.getElementById('stick'), knob = document.getElementById('knob');
let stickId = null;
function setAxis(e) {
  const r = stick.getBoundingClientRect(), cx = r.left + r.width / 2;
  let v = (e.clientX - cx) / (r.width / 2); v = Math.max(-1, Math.min(1, v));
  game.input.axis = Math.abs(v) < 0.12 ? 0 : v;
  knob.style.transform = `translate(${v * 44}px,0)`;
}
stick.addEventListener('pointerdown', (e) => { stickId = e.pointerId; stick.setPointerCapture(e.pointerId); setAxis(e); e.preventDefault(); });
stick.addEventListener('pointermove', (e) => { if (e.pointerId === stickId) setAxis(e); });
const endStick = (e) => { if (e.pointerId === stickId) { stickId = null; game.input.axis = 0; knob.style.transform = ''; } };
stick.addEventListener('pointerup', endStick); stick.addEventListener('pointercancel', endStick);
document.querySelectorAll('#tbtns button').forEach((b) => {
  const k = b.dataset.k;
  b.addEventListener('pointerdown', (e) => { b.setPointerCapture(e.pointerId); b.classList.add('on'); game.keyDown(k); e.preventDefault(); });
  const up = () => { b.classList.remove('on'); game.keyUp(k); };
  b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up);
});
document.addEventListener('contextmenu', (e) => e.preventDefault());
