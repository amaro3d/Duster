import * as THREE from 'three';
import { clamp, lerp, smoothstep, rad } from './util.js';

// ---------- Geometria da onda ----------
// Frame da onda: crista paralela ao eixo Z. x+ = rumo à costa. A face é um arco de círculo
// com centro em (0, Rf): trilha (vale) em x=0, sobe para x<0. Quanto maior o "curl" k, mais
// o arco fecha (phi até 250°) e vira um tubo.
const NB = 12, NA = 10, NC = 3, NI = 38, NF = 10;
export const M = NB + NA + NC + NI + NF;
const LS = 80; // alcance da água espumante rumo à costa

export function sectionAt(z, env) {
  const sw = 1 + 0.16 * Math.sin(z * 0.021 + 1.3) + 0.09 * Math.sin(z * 0.057 + 0.5);
  const hollow = clamp(0.64 + 0.36 * Math.sin(z * 0.0145 + 0.8) + 0.12 * Math.sin(z * 0.047), 0, 1);
  const cp = env.cp * (1 + 0.07 * Math.sin(z * 0.011 + 2.0));
  return { H: env.H * sw, hollow, cp };
}

// parâmetros da fatia em z, com o ponto de quebra (peel) em zp
export function sliceParams(z, zp, env, o = {}) {
  const w = sectionAt(z, env);
  const zeta = zp - z; // >0: atrás do peel (já quebrou)
  const kmax = lerp(0.5, 1.0, w.hollow);
  const pitch = smoothstep(0, env.pitchLen, zeta);
  let k = kmax * pitch;
  const ahead = smoothstep(0, 1, clamp(-zeta / 80, 0, 1));
  let H = w.H * lerp(1, 0.55, ahead);
  const tubeLen = lerp(env.tubeMin, env.tubeMax, w.hollow);
  const c0 = env.pitchLen + tubeLen;
  const c = smoothstep(c0, c0 + 18, zeta); // lábio cai
  k *= 1 - c;
  H *= lerp(1, 0.5, c);
  H *= lerp(1, 0.55, smoothstep(c0 + 10, c0 + 100, zeta));
  // fim da onda: fechamento no cabo
  const closeout = smoothstep(env.zEnd - 30, env.zEnd + 20, z);
  const phi = lerp(rad(55), rad(250), Math.pow(k, 0.85));
  const tFrac = lerp(0.07, 1 - 2 * env.rf, k);
  const t = H * tFrac;
  const Hin = H - t;
  const den = 1 - Math.cos(Math.min(phi, Math.PI));
  const Rf = Hin / den;
  o.H = H; o.k = k; o.c = c; o.phi = phi; o.t = t; o.Rf = Rf; o.zeta = zeta; o.hollow = w.hollow; o.cp = w.cp;
  o.Lb = 4.2 * H;
  o.aMax = Rf * phi;
  o.soup = smoothstep(c0 - 4, c0 + 26, zeta) * 0.95;
  o.c0 = c0; o.closeout = closeout;
  return o;
}

// ponto da superfície interna (face) no comprimento de arco a (a>0 sobe a face; a<0 região plana)
export function surfacePoint(P, a, o = {}) {
  if (a <= 0) { o.x = -a; o.y = 0; o.tx = -1; o.ty = 0; o.nx = 0; o.ny = 1; o.phi = 0; return o; }
  const phi = a / P.Rf;
  const s = Math.sin(phi), c = Math.cos(phi);
  o.x = -P.Rf * s; o.y = P.Rf * (1 - c);
  o.tx = -c; o.ty = s; o.nx = s; o.ny = c; o.phi = phi;
  return o;
}

export function isUnderwater(P, x, y) {
  if (x >= 0) return y < 0.05;
  const r = Math.hypot(x, y - P.Rf);
  if (r > P.Rf && y < P.H) return true;
  return false;
}

// preenche uma fatia nos arrays (offset base em pontos)
const tmp = {};
export function fillSlice(P, z, pos, thick, foam, tip, base) {
  const { Rf, phi, t, H, Lb, c, soup, k } = P;
  const rho = Rf + t;
  const phiC = Math.min(phi, Math.PI);
  const xc = -rho * Math.sin(phiC), yc = Rf - rho * Math.cos(phiC);
  const xs = -Lb;
  const dx = xc - xs;
  let n = base;
  const put = (x, y, th, f, tp) => {
    pos[n * 3] = x; pos[n * 3 + 1] = y; pos[n * 3 + 2] = z;
    thick[n] = th; foam[n] = f; tip[n] = tp; n++;
  };
  const arcTipC = rho * (phi - phiC);
  const cBody = c * 0.95;
  // 1) costas (bezier)
  for (let i = 0; i < NB; i++) {
    const u = i / NB, v = 1 - u;
    const p1x = xs + 0.5 * dx, p2x = xc - 0.45 * dx;
    const x = v * v * v * xs + 3 * v * v * u * p1x + 3 * v * u * u * p2x + u * u * u * xc;
    const y = 3 * v * u * u * yc + u * u * u * yc;
    put(x, y, t + 0.5 * arcTipC + 8 * (1 - u) + 1.0, cBody * 0.8, 0);
  }
  // 2) arco externo (crista -> ponta)
  for (let j = 0; j < NA; j++) {
    const ph = lerp(phiC, phi, j / (NA - 1));
    const x = -rho * Math.sin(ph), y = Rf - rho * Math.cos(ph);
    const arc = rho * (phi - ph);
    const tp = Math.exp(-arc * 0.9);
    put(x, y, t + 0.5 * arc, Math.max(cBody, 0.5 * tp * k), tp);
  }
  // 3) cap da ponta
  {
    const ox = -rho * Math.sin(phi), oy = Rf - rho * Math.cos(phi);
    const ix = -Rf * Math.sin(phi), iy = Rf - Rf * Math.cos(phi);
    const mx = (ox + ix) * 0.5, my = (oy + iy) * 0.5;
    const dox = (ox - ix) / (t + 1e-6), doy = (oy - iy) / (t + 1e-6);
    // tangente de phi crescente: (-cos, sin)
    const tdx = -Math.cos(phi), tdy = Math.sin(phi);
    for (let j = 1; j <= NC; j++) {
      const ang = (Math.PI * j) / (NC + 1);
      const ca = Math.cos(ang), sa = Math.sin(ang);
      put(mx + (t * 0.5) * (ca * dox + sa * tdx), my + (t * 0.5) * (ca * doy + sa * tdy), t * 0.5, Math.max(cBody, 0.6 * k), 1);
    }
  }
  // 4) face interna (ponta -> vale)
  for (let j = 0; j < NI; j++) {
    const ph = phi * (1 - j / (NI - 1));
    const x = -Rf * Math.sin(ph), y = Rf * (1 - Math.cos(ph));
    const arc = Rf * (phi - ph);
    const tp = Math.exp(-arc * 0.9);
    // espuma na base da face (onde o lábio cai) + ponta
    const baseFoam = c * (0.55 + 0.45 * (1 - ph / (phi + 1e-6)));
    put(x, y, t + 0.45 * arc, Math.max(baseFoam, 0.45 * tp * k), tp);
  }
  // 5) plano rumo à costa
  for (let i = 1; i <= NF; i++) {
    const x = LS * Math.pow(i / NF, 1.6);
    const f = Math.min(1, soup * Math.pow(1 - x / LS, 0.6) + c * Math.exp(-x / 14) + 0.0);
    put(x, 0, 1.6 + 3.2 * Math.exp(-x / 7), f, -1);
  }
  return n;
}

export class WaveMesh {
  constructor(env) {
    this.env = env;
    const NBK = 70, NFW = 150;
    const offs = [];
    for (let i = -NBK; i <= NFW; i++) {
      const a = Math.abs(i);
      offs.push(i < 0 ? -(a * 0.55 + a * a * 0.0045) : a * 0.55 + a * a * 0.0105);
    }
    this.offs = offs;
    this.nz = offs.length;
    const count = this.nz * M;
    this.pos = new Float32Array(count * 3);
    this.thick = new Float32Array(count);
    this.foam = new Float32Array(count);
    this.tip = new Float32Array(count);
    const idx = [];
    for (let s = 0; s < this.nz - 1; s++) {
      for (let i = 0; i < M - 1; i++) {
        const A = s * M + i, B = s * M + i + 1, C = (s + 1) * M + i, D = (s + 1) * M + i + 1;
        idx.push(A, C, B, B, C, D);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aThick', new THREE.BufferAttribute(this.thick, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aFoam', new THREE.BufferAttribute(this.foam, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aTip', new THREE.BufferAttribute(this.tip, 1).setUsage(THREE.DynamicDrawUsage));
    g.setIndex(idx);
    this.geometry = g;
    this.P = {};
  }
  update(zc, zp) {
    let n = 0;
    for (let s = 0; s < this.nz; s++) {
      const z = zc + this.offs[s];
      sliceParams(z, zp, this.env, this.P);
      n = fillSlice(this.P, z, this.pos, this.thick, this.foam, this.tip, n);
    }
    const g = this.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.aThick.needsUpdate = true;
    g.attributes.aFoam.needsUpdate = true;
    g.attributes.aTip.needsUpdate = true;
    g.computeVertexNormals();
    g.computeBoundingSphere();
    g.boundingSphere.radius = 1e5;
  }
}
