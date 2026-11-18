import { Game } from './game.js';
import { Hud, buildMenu } from './ui.js';

const canvas = document.getElementById('c');
const hud = new Hud();
const game = new Game(canvas, hud);
window.__game = game;
hud.env(game.env);

let playing = false;
const menu = document.getElementById('menu'), pause = document.getElementById('pause');
buildMenu((i) => { game.setEnv(i); hud.env(game.env); game.bot = true; });
game.bot = true; // câmera de cinema no menu

function start() {
  game.audio.init(); game.audio.resume();
  menu.classList.add('hide'); playing = true;
  game.bot = false; game.score = 0; game.beginPaddle();
  hud.env(game.env);
  try { canvas.requestPointerLock && canvas.requestPointerLock(); } catch (e) {}
}
document.getElementById('play').onclick = start;
pause.onclick = () => { try { canvas.requestPointerLock(); } catch (e) {} game.paused = false; pause.classList.remove('on'); game.audio.resume(); };
document.addEventListener('pointerlockchange', () => {
  if (!playing) return;
  if (document.pointerLockElement !== canvas) { game.paused = true; pause.classList.add('on'); }
  else { game.paused = false; pause.classList.remove('on'); }
});
window.addEventListener('keydown', (e) => {
  if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
  if (e.repeat) return;
  if (!playing && e.code === 'Enter') { start(); return; }
  game.keyDown(e.code);
});
window.addEventListener('keyup', (e) => game.keyUp(e.code));
window.addEventListener('mousemove', (e) => { if (document.pointerLockElement === canvas) { game.mouseDX += e.movementX; game.mouseDY += e.movementY; } });
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
