import * as THREE from 'three';
import { ENVS } from './envs.js';
import { clamp, lerp, smoothstep, rad } from './util.js';
import { WaveMesh, sliceParams, surfacePoint, isUnderwater, sectionAt } from './wave.js';
import { createWorld } from './world.js';
import { makeWaterMaterial } from './water.js';
import { Rig } from './rig.js';
import { Particles } from './fx.js';
import { GameAudio } from './audio.js';

const G = 8.0;
const TAU = Math.PI * 2;
const wrapPi = (x) => { x = (x + Math.PI) % TAU; if (x < 0) x += TAU; return x - Math.PI; };

export class Game {
  constructor(canvas, hud) {
    this.hud = hud;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
    this.pr = this.isTouch ? Math.min(window.devicePixelRatio || 1, 1.0) * 0.85 : Math.min(window.devicePixelRatio || 1, 1.75);
    this.renderer.setPixelRatio(this.pr);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(80, 16 / 9, 0.12, 9000);
    this.scene.add(this.camera);
    this.audio = new GameAudio();
    this.rig = new Rig();
    this.rigGroup = new THREE.Group(); this.rigGroup.add(this.rig.root); this.scene.add(this.rigGroup);
    this.spray = new Particles(2600, '#ffffff'); this.mist = new Particles(2200, '#f2fbff'); this.bubbles = new Particles(300, '#bfefff', 0.1);
    this.trail = new Particles(900, '#ffffff');
    this.scene.add(this.spray.points, this.mist.points, this.trail.points, this.bubbles.points);
    this.input = { axis: 0, left: false, right: false, stall: false, tuck: false, grab: false, pump: false, jump: false, free: false };
    this.mouseDX = 0; this.mouseDY = 0;
    this.envIndex = 0; this.mode = 'menu'; this.t = 0; this.best = 0; this.score = 0;
    this.bot = false; this.camMode = 'fps'; this.locked = false; this.mousePos = undefined; this.sp = {}; this.S = {}; this.paused = false;
    this.lookYaw = 0; this.lookPitch = 0;
    this.camQ = new THREE.Quaternion(); this.camP = new THREE.Vector3(); this.camInit = false;
    this.setEnv(0);
    this.beginPaddle();
    this.resize();
  }

  setEnv(i) {
    this.envIndex = i; this.env = ENVS[i];
    if (this.world) this.world.dispose();
    this.world = createWorld(this.env, this.scene);
    if (this.waveMesh) { this.scene.remove(this.waveMesh.mesh); this.waveMesh.geometry.dispose(); }
    this.waveMesh = new WaveMesh(this.env);
    this.waveMesh.mesh = new THREE.Mesh(this.waveMesh.geometry, makeWaterMaterial(this.world.uniforms, false));
    this.waveMesh.mesh.renderOrder = 2; this.waveMesh.mesh.frustumCulled = false;
    this.scene.add(this.waveMesh.mesh);
    this.renderer.toneMappingExposure = this.env.exposure;
    // luz para a prancha/corpo
    this.beginPaddle();
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    for (const p of [this.spray, this.mist, this.trail, this.bubbles]) p.setScale(h * this.renderer.getPixelRatio());
  }

  // ---------- fases ----------
  beginPaddle() {
    this.mode = 'paddle'; this.pt = 0; this.tPhase = 0;
    this.z = 30; this.a = -27; this.theta = -Math.PI / 2; this.speed = 0; this.crouch = 0; this.prone = 1;
    this.bank = 0; this.lastPump = -9; this.tubeTime = 0; this.combo = 0; this.rideT = 0; this.airSpin = 0;
    const cp = sectionAt(this.z, this.env).cp;
    this.zp = this.z + 7 - cp * (27 / 6 + 0.9);
    this.driftF = 1; this.sceneryX = 0; this.waveScore = 0; this.lostT = 0; this.wipeMsg = '';
    this.sThetaPrev = 0; this.lookYaw = 0; this.lookPitch = 0; this.camInit = false; this.under = false;
    this.fade = 0; this.strokePh = 0; this.waveDone = false; this.comboT = 0; this.lastJump = -9; this.pumpPulse = 0; this.shake = 0; this.omega = 0; this.inTube = false; this.tubeAnn = false; this.stall = false; this.tuck = false; this.airGrab = 0; this.phi = 0;
    this.popup('Reme! Espaço quando a onda levantar', 4);
  }

  popup(text, sec = 1.6, big = false) { this.hud.popup(text, sec, big); }

  takeoff() {
    this.mode = 'takeoff'; this.tk = 0; this.tkA0 = this.a;
    this.audio.burst('pop');
    this.hud.hint('');
  }

  launch(jump) {
    const S = this.S, sp = this.speed, th = this.theta;
    const P = surfacePoint(S, this.a, {});
    const nx = P.nx, ny = P.ny;
    const kick = jump ? 5.6 : 1.2;
    this.vel = new THREE.Vector3(sp * Math.sin(th) * P.tx + kick * nx, sp * Math.sin(th) * P.ty + kick * ny, sp * Math.cos(th));
    this.pos3 = new THREE.Vector3(P.x + nx * 0.2, P.y + ny * 0.2, this.z);
    this.mode = 'air'; this.airT = 0; this.airYaw = 0; this.airSpinRate = 0; this.airSpinTot = 0; this.airGrab = 0; this.airMaxY = this.pos3.y;
    this.popup('AR!', 0.8);
    this.audio.burst('pop');
  }

  wipeout(msg) {
    if (this.mode === 'wipe') return;
    const S = this.S;
    const P = this.mode === 'air' ? { x: this.pos3.x, y: this.pos3.y } : surfacePoint(S, this.a, {});
    this.pos3 = new THREE.Vector3(P.x, P.y + 0.8, this.z);
    const v = this.mode === 'air' ? this.vel.clone() : new THREE.Vector3(this.speed * Math.sin(this.theta) * (P.tx || 0), this.speed * Math.sin(this.theta) * (P.ty || 0), this.speed * Math.cos(this.theta));
    this.vel = v.multiplyScalar(0.7); this.vel.x += 3.5;
    this.mode = 'wipe'; this.wt = 0; this.wipeMsg = msg;
    this.wipeRot = new THREE.Vector3((Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6);
    this.wipeQ = this.camera.quaternion.clone();
    this.audio.burst('splash');
    this.waveScore = Math.floor(this.waveScore);
    this.score += this.waveScore;
    this.best = Math.max(this.best, this.score);
    this.popup(msg, 2.6, true);
    this.hud.combo('');
    this.shake = 1;
  }

  endRide(msg) {
    if (this.mode === 'end') return;
    this.mode = 'end'; this.et = 0;
    this.score += Math.floor(this.waveScore); this.best = Math.max(this.best, this.score);
    this.popup(msg, 3.0, true);
  }

  award(pts, label) {
    this.combo = this.combo > 0 ? this.combo : 0;
    const mult = 1 + Math.min(this.combo, 8) * 0.25;
    const v = Math.round(pts * mult);
    this.waveScore += v; this.combo++; this.comboT = 4;
    this.popup(`${label} +${v}`, 1.4);
    this.audio.burst('trick');
  }

  // ---------- entrada ----------
  keyDown(code) {
    const i = this.input;
    if (code === 'KeyA' || code === 'ArrowLeft') i.left = true;
    else if (code === 'KeyD' || code === 'ArrowRight') i.right = true;
    else if (code === 'KeyS' || code === 'ArrowDown' || code === 'ControlLeft') i.stall = true;
    else if (code === 'ShiftLeft' || code === 'ShiftRight') i.tuck = true;
    else if (code === 'KeyQ' || code === 'KeyE') i.grab = true;
    else if (code === 'Space') { if (!i.jump) i.pump = true; i.jump = true; i.jumpPressed = true; }
    else if (code === 'KeyW' || code === 'ArrowUp') { i.pump = true; }
    else if (code === 'AltLeft') i.free = true;
    else if (code === 'KeyB') { this.bot = !this.bot; this.popup(this.bot ? 'Piloto automático (modo cinema)' : 'Controle manual', 1.8); }
    else if (code === 'KeyV') { this.camMode = this.camMode === 'fps' ? 'side' : 'fps'; }
    else if (code === 'KeyR') { this.beginPaddle(); }
    else if (code === 'KeyN') { this.setEnv((this.envIndex + 1) % ENVS.length); this.hud.env(this.env); }
  }
  keyUp(code) {
    const i = this.input;
    if (code === 'KeyA' || code === 'ArrowLeft') i.left = false;
    else if (code === 'KeyD' || code === 'ArrowRight') i.right = false;
    else if (code === 'KeyS' || code === 'ArrowDown' || code === 'ControlLeft') i.stall = false;
    else if (code === 'ShiftLeft' || code === 'ShiftRight') i.tuck = false;
    else if (code === 'KeyQ' || code === 'KeyE') i.grab = false;
    else if (code === 'Space') i.jump = false;
    else if (code === 'AltLeft') i.free = false;
  }

  // ---------- piloto automático ----------
  botInput(S) {
    const b = { steer: 0, stall: false, tuck: false, pump: false };
    if (this.mode === 'paddle') { if (this.a > -1.5) b.jump = true; return b; }
    if (this.mode !== 'ride') return b;
    const zt = 22 + 6 * Math.sin(this.t * 0.37);
    const phiT = rad(34) + 0.35 * Math.sin(this.t * 0.8) + 0.25 * Math.sin(this.t * 0.31);
    const phi = this.a > 0 ? this.a / S.Rf : 0;
    let thD = clamp((phiT - phi) * 2.2, -0.9, 0.9);
    // ficar no ponto: ajustar velocidade
    if (S.zeta < zt - 5) { b.stall = true; }
    if (S.zeta > zt + 8) { b.tuck = true; thD += 0.05; if (this.t - this.lastPump > 0.6) b.pump = true; }
    b.steer = clamp((thD - this.theta) * 3.0, -1, 1);
    return b;
  }

  // ---------- atualização ----------
  update(dt) {
    if (this.paused) return;
    dt = Math.min(dt, 1 / 20);
    this.t += dt;
    const inp = this.input;
    const bi = this.bot ? this.botInput(this.S) : null;
    let steer = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
    let stall = inp.stall, tuck = inp.tuck, pump = inp.pump, jump = inp.jump;
    if (inp.axis) steer = clamp(steer + inp.axis, -1, 1);
    if (bi) { steer = bi.steer; stall = bi.stall; tuck = bi.tuck; if (bi.pump) pump = true; if (bi.jump) pump = true; }
    let mdx = inp.free ? 0 : this.mouseDX; this.mouseDX = 0;
    if (this.mousePos !== undefined && !this.locked) { const m = this.mousePos - 0.5; if (Math.abs(m) > 0.06) mdx += Math.sign(m) * (Math.abs(m) - 0.06) * 260 * dt * 3.2; }
    const mdy = this.mouseDY; this.mouseDY = 0;
    if (inp.free) { this.lookYaw = clamp(this.lookYaw - 0, -1.8, 1.8); }
    // peel avança
    const cp = sectionAt(this.zp, this.env).cp;
    this.zp += cp * dt;
    // fatia no z do surfista
    sliceParams(this.z, this.zp, this.env, this.S);
    const S = this.S;
    if (this.mode === 'menu') { this.updateMenu(dt); }
    else if (this.mode === 'paddle') this.updatePaddle(dt, pump);
    else if (this.mode === 'takeoff') this.updateTakeoff(dt, steer);
    else if (this.mode === 'ride') this.updateRide(dt, steer, mdx, stall, tuck, pump, jump);
    else if (this.mode === 'air') this.updateAir(dt, steer, mdx, jump);
    else if (this.mode === 'wipe') this.updateWipe(dt);
    else if (this.mode === 'end') this.updateEnd(dt);
    inp.pump = false;
    // deriva do cenário
    this.driftF = this.mode === 'paddle' ? 1 : Math.max(0, this.driftF - dt / 1.6);
    this.sceneryX -= this.env.cp * 0.7 * this.driftF * dt;
    this.updateCamera(dt, mdy, mdx);
    this.updateFx(dt);
    this.comboT -= dt; if (this.comboT < 0 && this.combo > 0) { this.combo = 0; }
    this.hud.update(this);
  }

  updateMenu(dt) {
    // câmera orbital/cinema no menu: usa piloto automático
    this.bot = true; this.mode = 'paddle';
  }

  updatePaddle(dt, pump) {
    this.pt += dt;
    this.a += 6.0 * dt;
    this.strokePh += dt * 5.5;
    this.prone = 1; this.crouch = 0;
    this.theta = -Math.PI / 2;
    this.speed = 0;
    this.hud.hint(this.a > -6 ? 'ESPAÇO — levantar!' : '');
    if (pump && this.a > -6) this.takeoff();
    else if (this.a > 4.5) this.takeoff();
  }

  updateTakeoff(dt) {
    this.tk += dt;
    const T = 0.9, k = clamp(this.tk / T, 0, 1), e = k * k * (3 - 2 * k);
    const S = this.S;
    this.a = lerp(this.tkA0, 0.52 * S.aMax, e);
    this.theta = lerp(-Math.PI / 2, -1.2, e);
    this.prone = 1 - smoothstep(0.0, 0.6, k);
    this.crouch = Math.min(1, smoothstep(0.1, 0.5, k) * 0.95);
    this.speed = lerp(1, 6.0, e);
    this.strokePh += dt * 6;
    if (k >= 1) { this.mode = 'ride'; this.rideT = 0; this.prone = 0; this.speed = 6.0; this.z += 0; this.popup('Desce a parede!', 1.2); }
  }

  updateRide(dt, steer, mdx, stall, tuck, pump, jump) {
    const S = this.S, env = this.env;
    this.rideT += dt;
    let th = this.theta, sp = this.speed;
    // gravidade na face
    const sinB = this.a > 0 ? Math.sin(Math.min(this.a / S.Rf, Math.PI)) : 0;
    sp += -G * sinB * Math.sin(th) * dt;
    th += (-G * sinB * Math.cos(th) / Math.max(sp, 5)) * dt * 0.32;
    // direção
    const speedF = 0.7 + 0.3 * clamp(sp / 12, 0, 1);
    const dTh = steer * 2.1 * speedF * dt + mdx * 0.0042;
    th += dTh;
    this.omega = dTh / dt;
    // assistência na primeira curva (bottom turn)
    const assist = Math.max(0, 1 - this.rideT / 1.8);
    if (assist > 0 && Math.abs(steer) < 0.1 && Math.abs(mdx) < 0.5) th += (0.05 - th) * 2.6 * assist * dt;
    if (Math.abs(steer) < 0.1 && Math.abs(mdx) < 0.5 && this.rideT > 0.9) {
      const tgt = -0.04 + clamp((1.4 - this.a) * 0.3, 0, 0.6); // trim automático: volta para a face
      th += (tgt - th) * (this.a < 0.5 ? 1.6 : 0.5) * dt;
    }
    th = clamp(th, -2.6, 2.6);
    // empuxo da onda (bolso)
    const zc = 15, hw = 28;
    const x = (S.zeta - zc) / hw;
    const pocket = Math.abs(x) < 1 ? 0.5 * (1 + Math.cos(Math.PI * x)) : 0;
    const faceF = smoothstep(-3.0, 0.6, this.a);
    const T0 = 6.6 * pocket * faceF * (tuck ? 1.15 : 1) * (S.H / 4.6 > 1.3 ? 1.1 : 1);
    sp += T0 * dt;
    const drag = 0.12 * sp + 0.032 * sp * sp * (tuck ? 0.78 : 1) * (stall ? 2.6 : 1);
    sp -= drag * dt;
    if (stall) sp -= 2.2 * dt;
    if (pump && this.t - this.lastPump > 0.45 && sp < 17) { sp += 1.8; this.lastPump = this.t; this.pumpPulse = 1; this.audio.burst('pop'); }
    sp = clamp(sp, 0.3, 21);
    // integra
    this.z += sp * Math.cos(th) * dt;
    this.a += sp * Math.sin(th) * dt;
    this.theta = th; this.speed = sp;
    this.stall = stall; this.tuck = tuck;
    const Sn = sliceParams(this.z, this.zp, env, this.S);
    // faixa de mergulho de fase
    const phi = this.a > 0 ? this.a / Sn.Rf : 0;
    this.phi = phi;
    // detecta manobras
    const sT = Math.sin(th);
    if (this.sThetaPrev > 0.1 && sT < -0.1 && phi > rad(48) && sp > 8) this.award(300 + Math.round(phi * 120), 'TOP TURN');
    if (this.sThetaPrev < -0.1 && sT > 0.1 && phi < rad(32) && sp > 8) this.award(150, 'BOTTOM TURN');
    if (Math.abs(sT - this.sThetaPrev) > 0.0 && Math.abs(sT) > 0.05) this.sThetaPrev = sT;
    // pontuação: velocidade + tubo
    const inTube = Sn.k > 0.6 && Sn.zeta > env.pitchLen * 0.3 && Sn.zeta < Sn.c0 && phi < rad(100) && this.a > -1;
    this.inTube = inTube;
    this.waveScore += sp * 0.6 * dt + (Math.abs(this.omega || 0) > 1.0 ? 8 * dt : 0);
    if (inTube) {
      this.tubeTime += dt; this.waveScore += (25 + sp * 2) * dt;
      if (this.tubeTime > 2.0 && !this.tubeAnn) { this.tubeAnn = true; this.popup('NO TUBO!', 1.4, true); }
    } else { if (this.tubeTime > 1.2) this.award(Math.round(Math.min(this.tubeTime, 12) * 90), `TUBO ${this.tubeTime.toFixed(1)}s`); this.tubeTime = 0; this.tubeAnn = false; }
    // floater sobre a espuma
    this.floater = Sn.c > 0.3 && phi > rad(75);
    if (this.floater) this.waveScore += 120 * dt;
    // lábio caiu em cima: wipeout
    if (Sn.c > 0.55 && !this.floater && Sn.zeta > Sn.c0) { this.wipeout('A ESPUMA TE PEGOU'); return; }
    if (Sn.c > 0.8) { this.wipeout('A ONDA FECHOU'); return; }
    // perdeu a onda (saiu pela parte plana)
    if (this.a < -4.5) { this.lostT += dt; if (this.lostT > 1.1) { this.endRide('Perdeu a onda'); return; } } else this.lostT = 0;
    // topo / lábio
    const aLip = Math.min(Sn.aMax - 0.25, Sn.Rf * rad(98));
    if (this.a > aLip) {
      if (Sn.phi > rad(100) || Sn.k > 0.3) {
        if (Math.sin(th) > 0.12 && sp > 6.5) { this.launch(jump); return; }
        this.a = aLip - 0.1; this.theta = Math.min(th, -0.2);
      } else {
        if (sp > 5) { this.endRide('KICKOUT!'); this.waveScore += 200; return; }
        this.a = aLip - 0.1; this.theta = Math.min(th, -0.2);
      }
    }
    // fim da onda
    if (this.z > env.zEnd + 10) { this.endRide('FIM DA ONDA'); this.waveScore += 400; return; }
    // empurrãozinho de pulo em cima do lábio
    if (jump && phi > rad(38) && phi < rad(100) && sp > 6.5 && this.t - this.lastJump > 0.6) { this.lastJump = this.t; this.launch(true); return; }
  }

  updateAir(dt, steer, mdx, jump) {
    this.airT += dt;
    const v = this.vel;
    v.y -= 9.8 * dt;
    this.pos3.addScaledVector(v, dt);
    this.z = this.pos3.z;
    this.airMaxY = Math.max(this.airMaxY, this.pos3.y);
    // giro
    const target = steer * 6.5 + mdx * 0.2 * 6.5 / Math.max(dt, 0.001) * 0.002;
    this.airSpinRate += (target - this.airSpinRate) * Math.min(1, dt * 8);
    this.airYaw += this.airSpinRate * dt; this.airSpinTot += Math.abs(this.airSpinRate * dt);
    this.airGrab = this.input.grab ? 1 : 0;
    const S = sliceParams(this.z, this.zp, this.env, this.S);
    const x = this.pos3.x, y = this.pos3.y;
    let landed = false, la = 0, onFlat = false, lip = false;
    if (x >= 0) { if (y <= 0.05) { landed = true; onFlat = true; la = -x; } }
    else {
      const dy = y - S.Rf, r = Math.hypot(x, dy);
      const phiP = Math.atan2(-x, -dy);
      if (r >= S.Rf - 0.02 && phiP > 0 && phiP < S.phi + 0.05) {
        landed = true; la = S.Rf * phiP;
        if (phiP > rad(112)) lip = true;
      } else if (r >= S.Rf && phiP >= S.phi + 0.05) {
        const yBack = S.H * smoothstep(-S.Lb, -0.25 * S.Rf, x);
        if (y < yBack) { this.endRide('Por cima da onda'); this.score += 0; return; }
      }
    }
    if (this.pos3.y < -2) landed = true;
    if (landed) {
      if (lip) { this.wipeout('BATEU NO LÁBIO'); return; }
      const P = surfacePoint(S, la, {});
      const vn = this.vel.x * P.nx + this.vel.y * P.ny;
      const yawErr = Math.abs(wrapPi(this.airYaw * 1.0 + 0.0));
      const err = Math.min(yawErr, Math.abs(Math.abs(yawErr) - Math.PI));
      if (err > 0.75 || vn < -12) { this.wipeout(err > 0.75 ? 'ATERRISSAGEM RUIM' : 'IMPACTO FORTE'); return; }
      // pontuação do aéreo
      const spins = this.airSpinTot / Math.PI;
      const half = Math.round(spins);
      const airPts = Math.round(this.airT * 380 + half * 420 + (this.airGrab ? 160 : 0) + Math.max(0, this.airMaxY - 2) * 90);
      const label = half >= 2 ? `${half * 180}°` : half === 1 ? 'REVERT' : 'AÉREO';
      this.award(airPts, label + (this.airGrab ? ' + GRAB' : ''));
      this.audio.burst('land');
      // volta à onda
      this.a = la; const tz = this.vel.z, ta = this.vel.x * P.tx + this.vel.y * P.ty;
      this.speed = Math.hypot(tz, ta) * 0.92; this.theta = Math.atan2(ta, tz);
      this.mode = 'ride'; this.sThetaPrev = 0; this.rideT = 3;
      this.shake = 0.5;
    }
  }

  updateWipe(dt) {
    this.wt += dt;
    const v = this.vel;
    this.vel.multiplyScalar(Math.exp(-1.6 * dt));
    v.y += (this.wt < 0.6 ? -9.0 : 0.8) * dt;
    this.pos3.addScaledVector(v, dt);
    this.z = this.pos3.z;
    const S = sliceParams(this.z, this.zp, this.env, this.S);
    const under = this.wt > 0.25 && this.wt < 2.3;
    this.under = under;
    // fade
    this.fade = smoothstep(2.4, 3.1, this.wt);
    if (this.wt > 3.2) { this.beginPaddle(); this.under = false; }
  }

  updateEnd(dt) {
    this.et += dt;
    // segue em frente (planando)
    this.speed *= Math.exp(-0.25 * dt);
    this.z += this.speed * dt * Math.cos(this.theta);
    this.fade = smoothstep(3.0, 4.2, this.et);
    if (this.et > 4.4) { this.beginPaddle(); }
  }

  // ---------- câmera ----------
  boardFrame(out) {
    const S = this.S;
    if (this.mode === 'air') {
      const hv = Math.hypot(this.vel.x, this.vel.z);
      const pitch = Math.atan2(this.vel.y, Math.max(hv, 0.1)) * 0.5;
      // direção horizontal base = +z (a prancha continua apontando ao longo da onda) girada pelo yaw do giro
      const yaw = this.airYaw;
      const F = new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)).normalize();
      const R = new THREE.Vector3().crossVectors(F, new THREE.Vector3(0, 1, 0)).normalize();
      const U = new THREE.Vector3().crossVectors(R, F).normalize();
      out.pos = this.pos3.clone(); out.F = F; out.R = R; out.U = U; return out;
    }
    const a = this.a;
    const P = surfacePoint(S, a, {});
    const th = this.theta;
    const F = new THREE.Vector3(Math.sin(th) * P.tx, Math.sin(th) * P.ty, Math.cos(th)).normalize();
    const U = new THREE.Vector3(P.nx, P.ny, 0);
    let R = new THREE.Vector3().crossVectors(F, U).normalize();
    // inclinação lateral ao carvar
    const targetBank = clamp(-(this.omega || 0) * 0.05, -0.16, 0.16);
    this.bank += (targetBank - this.bank) * 0.12;
    const b = this.bank;
    const U2 = U.clone().multiplyScalar(Math.cos(b)).addScaledVector(R, Math.sin(b));
    const R2 = R.clone().multiplyScalar(Math.cos(b)).addScaledVector(U, -Math.sin(b));
    out.pos = new THREE.Vector3(P.x, P.y, this.z).addScaledVector(U, 0.03);
    out.F = F; out.R = R2; out.U = U2; return out;
  }

  updateCamera(dt, mdy, mdx) {
    const cam = this.camera;
    const frame = this.frame || (this.frame = {});
    // pose do corpo
    if (this.mode === 'wipe') {
      // câmera caindo/rolando
      const q = this.wipeQ;
      const dq = new THREE.Quaternion().setFromEuler(new THREE.Euler(this.wipeRot.x * dt * Math.exp(-this.wt * 0.4), this.wipeRot.y * dt * Math.exp(-this.wt * 0.4), this.wipeRot.z * dt * Math.exp(-this.wt * 0.4)));
      q.multiply(dq);
      cam.position.copy(this.pos3); cam.quaternion.copy(q);
      const S = this.S;
      this.under = this.under && true;
      this.rigGroup.visible = this.wt < 0.9;
      this.rigGroup.position.copy(this.pos3).add(new THREE.Vector3(0.5, 0.3, 0.5).multiplyScalar(Math.min(this.wt, 1.5) * 0.8));
      this.rigGroup.quaternion.copy(q).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(this.wt * 2, this.wt * 3, 0)));
      this.camInit = false;
      this.fovTarget(86);
      return;
    }
    this.boardFrame(frame);
    const { pos, F, R, U } = frame;
    // postura
    let crouchT = 0.15;
    const sp = this.speed;
    if (this.mode === 'ride') {
      crouchT = 0.22 + clamp(Math.abs(this.omega || 0) / 2.6, 0, 1) * 0.42 + (this.tuck ? 0.5 : 0) + (this.inTube ? 0.3 : 0) + (this.stall ? 0.2 : 0);
      crouchT += this.pumpPulse ? this.pumpPulse * 0.35 : 0;
      if (this.rideT < 0.7) crouchT = Math.max(crouchT, 0.85 - this.rideT * 0.6);
    } else if (this.mode === 'air') crouchT = 0.65 + 0.25 * this.airGrab;
    else if (this.mode === 'takeoff') crouchT = this.crouch;
    this.pumpPulse = Math.max(0, (this.pumpPulse || 0) - dt * 3.2);
    this.crouch += (clamp(crouchT, 0, 1) - this.crouch) * (1 - Math.exp(-dt * 9));
    const proneY = 0.36;
    const standY = lerp(1.62, 0.98, this.crouch);
    const camY = lerp(standY, proneY, this.prone);
    const phi = this.a > 0 ? this.a / Math.max(this.S.Rf, 0.1) : 0;
    const wall = this.mode === 'ride' || this.mode === 'takeoff' ? clamp(0.25 + 0.75 * (this.stall ? 1 : 0) + phi * 0.4, 0, 1) : 0.2;
    // prancha + corpo
    const M = new THREE.Matrix4().makeBasis(R, U, F.clone().negate());
    this.rigGroup.visible = true;
    this.rigGroup.position.copy(pos);
    this.rigGroup.quaternion.setFromRotationMatrix(M);
    this.rig.update({ camY, prone: this.prone, wall, stroke: this.strokePh, grab: this.airGrab || 0, t: this.t });
    // câmera na cabeça
    const lean = this.prone > 0.5 ? new THREE.Vector3(0, 0, 0.0) : new THREE.Vector3(0.12, 0, 0.0);
    const head = pos.clone().addScaledVector(U, camY).addScaledVector(R, lean.x).addScaledVector(F, this.prone > 0.5 ? 0.15 : 0.0 + lean.z);
    // olhar: mouse Y inclina, livre com ALT
    if (this.input.free) { this.lookYaw = clamp(this.lookYaw + mdx * 0.003, -2.2, 2.2); }
    this.lookPitch = clamp(this.lookPitch - mdy * 0.0025, -0.9, 0.9);
    const rec = 1 - Math.exp(-dt * (this.input.free ? 0.3 : 2.2));
    this.lookYaw += (0 - this.lookYaw) * rec;
    this.lookPitch += (0 - this.lookPitch) * (1 - Math.exp(-dt * 0.9));
    // olhar para a parede ao carvar para cima
    const carveLook = this.mode === 'ride' ? clamp(Math.sin(this.theta), -1, 1) * -0.08 : 0;
    // pronação: olhar um pouco para baixo na remada
    // câmera: o corpo se inclina para compensar a inclinação da parede — a cabeça fica mais "em pé"
    const blend = this.mode === 'air' ? 0.35 : (this.prone > 0.5 ? 0.15 : 0.6);
    // alivia o pitch: quem desce a parede olha para frente, não para dentro da água
    const Fh = new THREE.Vector3(F.x, 0, F.z); if (Fh.lengthSq() < 1e-4) Fh.set(0, 0, 1); Fh.normalize();
    const pitchRelief = this.mode === 'air' ? 0.3 : (this.prone > 0.5 ? 0.35 : 0.28);
    const Fc = F.clone().multiplyScalar(1 - pitchRelief).addScaledVector(Fh, pitchRelief).normalize();
    const Uc = U.clone().multiplyScalar(1 - blend).addScaledVector(new THREE.Vector3(0, 1, 0), blend).normalize();
    const Rc = new THREE.Vector3().crossVectors(Fc, Uc).normalize();
    const Uc2 = new THREE.Vector3().crossVectors(Rc, Fc).normalize();
    const base = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(Rc, Uc2, Fc.clone().negate()));
    const tilt = new THREE.Quaternion().setFromEuler(new THREE.Euler(this.lookPitch + (this.prone > 0.5 ? -0.12 : -0.05), this.lookYaw + carveLook, 0, 'YXZ'));
    let q = base.clone().multiply(tilt);
    // chão trêmulo / respiração
    const shake = (this.shake || 0) * 0.04 + (this.mode === 'ride' ? clamp(sp / 20, 0, 1) * 0.006 : 0.002);
    this.shake = Math.max(0, (this.shake || 0) - dt * 2.2);
    const sh = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.sin(this.t * 31) * shake, Math.sin(this.t * 27 + 1) * shake, Math.sin(this.t * 19) * shake * 1.5));
    q.multiply(sh);
    if (this.camMode === 'side') {
      // debug: vista lateral (câmera do lado do mar)
      const c = pos.clone().add(new THREE.Vector3(-16, 4.5, -9));
      cam.position.copy(c); cam.lookAt(pos.clone().add(new THREE.Vector3(0, 1.5, 6))); cam.fov = 60; cam.updateProjectionMatrix();
    } else if (this.camMode === 'rig') {
      const c = pos.clone().addScaledVector(R, -1.9).addScaledVector(U, 1.3).addScaledVector(F, -1.2);
      cam.position.copy(c); cam.lookAt(pos.clone().addScaledVector(U, 0.8)); cam.fov = 55; cam.updateProjectionMatrix();
    } else {
      if (!this.camInit) { this.camQ.copy(q); this.camP.copy(head); this.camInit = true; }
      this.camQ.slerp(q, 1 - Math.exp(-dt * 16));
      this.camP.copy(head);
      cam.position.copy(this.camP); cam.quaternion.copy(this.camQ);
    }
    this.fovTarget(78 + clamp(sp, 0, 20) * 0.85 + this.crouch * 3 + (this.mode === 'air' ? 6 : 0));
  }

  fovTarget(f) {
    const c = this.camera; c.fov += (f - c.fov) * 0.08; c.updateProjectionMatrix();
  }

  // ---------- efeitos ----------
  updateFx(dt) {
    const S = this.S, f = this.frame;
    const sp = this.speed;
    const riding = this.mode === 'ride' || this.mode === 'takeoff';
    // spray da prancha
    if (f && (riding || this.mode === 'paddle')) {
      const tail = f.pos.clone().addScaledVector(f.F, -0.85).addScaledVector(f.U, 0.06);
      const amount = riding ? sp * dt * 60 * (0.4 + Math.min(1, Math.abs(this.omega || 0) * 0.35)) : (this.mode === 'paddle' ? 2 : 0);
      let n = Math.floor(amount + Math.random());
      while (n-- > 0) {
        const sideSign = Math.random() < 0.5 ? -1 : 1;
        const s = 0.5 + Math.random();
        this.spray.emit(tail.x + (Math.random() - 0.5) * 0.3, tail.y, tail.z + (Math.random() - 0.5) * 0.3,
          -f.F.x * sp * 0.3 + f.R.x * sideSign * (1.5 + Math.random() * 3) + f.U.x * 3, -f.F.y * sp * 0.3 + f.U.y * (2 + Math.random() * 4), -f.F.z * sp * 0.3 + f.R.z * sideSign * 2 + f.U.z * 3,
          0.7 + Math.random() * 0.6, 0.18 * s, 1.5);
      }
      // trilha de espuma
      if (riding && sp > 3 && this.trailAcc !== undefined) {
        // acumula posição na água
      }
    }
    // espuma/brilho do lábio (vento de terra sopra o spray para o mar)
    if (this.S && this.waveMesh) {
      const zc = this.z;
      for (let i = 0; i < 18; i++) {
        const z = zc - 30 + Math.random() * 110;
        const P = sliceParams(z, this.zp, this.env, {});
        if (P.k < 0.4) { if (Math.random() < 0.5) continue; }
        const tp = surfacePoint(P, Math.min(P.aMax, P.Rf * Math.PI * 1.3), {});
        // ponto da crista externa
        const ox = tp.x, oy = tp.y + P.t * 0.5;
        this.mist.emit(ox + (Math.random() - 0.5), oy, z, -3 - Math.random() * 3, 1.5 + Math.random() * 2.5, (Math.random() - 0.5) * 3, 1.0 + Math.random() * 1.4, 0.45 + Math.random() * 0.5, 2.0);
      }
    }
    // bolhas debaixo d'água
    if (this.mode === 'wipe' && this.under) {
      for (let i = 0; i < 4; i++) this.bubbles.emit(this.pos3.x + (Math.random() - 0.5) * 2, this.pos3.y + (Math.random() - 0.5) * 2, this.pos3.z + (Math.random() - 0.5) * 2, 0, 1.5 + Math.random() * 1.5, 0, 1.4 + Math.random(), 0.1 + Math.random() * 0.1, 0);
    }
    // espirro no pouso/wipe
    if (this.mode === 'wipe' && this.wt < 0.35) {
      for (let i = 0; i < 40; i++) this.spray.emit(this.pos3.x, this.pos3.y, this.pos3.z, (Math.random() - 0.5) * 9, Math.random() * 8, (Math.random() - 0.5) * 9, 1 + Math.random(), 0.5 + Math.random() * 0.7, 1.5);
    }
    this.spray.update(dt, -9.8, 0.8);
    this.mist.update(dt, -0.6, 0.35);
    this.bubbles.update(dt, 0.0, 1.2);
    this.trail.update(dt, 0, 1);
    // áudio
    const tube = this.inTube ? 1 : 0;
    const crash = clamp(1 - Math.abs(this.S.zeta - 25) / 60, 0, 1) * (this.mode === 'paddle' ? 0.5 : 1);
    this.audio.set({ speed: sp, riding: riding || this.mode === 'air' ? riding : false, carve: clamp(Math.abs(this.omega || 0) / 2.5, 0, 1), air: this.mode === 'air', tube: tube * 0.9, crash, under: this.mode === 'wipe' && this.under });
  }

  // ---------- render ----------
  render() {
    const cam = this.camera;
    const zc = this.mode === 'wipe' ? this.pos3.z : this.z;
    this.waveMesh.update(zc, this.zp);
    // frame do cenário: x do mundo desloca com sceneryX
    this.world.root.position.x = this.sceneryX;
    // água: fluxo relativo ao quadro da onda (padrão do mundo acompanha o cenário)
    const flowX = -this.sceneryX;
    this.world.update(cam, this.t, flowX, this.under);
    this.world.uniforms.uCam.value.copy(cam.position);
    this.waveMesh.mesh.material.uniforms.uCam.value.copy(cam.position);
    const u = this.under;
    this.scene.background = u ? new THREE.Color(this.env.deep).multiplyScalar(0.9) : null;
    this.scene.fog.color.set(u ? this.env.deep : this.env.fog); this.scene.fog.density = u ? 0.03 : this.env.fogD;
    this.renderer.render(this.scene, cam);
  }
}
