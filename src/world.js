import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { clamp, lerp, smoothstep, fbm2, noise2, mulberry32 } from './util.js';
import { GLSL_COMMON, makeUniforms, makeWaterMaterial, setEnvUniforms } from './water.js';

const C = (h) => new THREE.Color(h);

// ---------- Céu ----------
const skyVert = `varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = projectionMatrix*modelViewMatrix*vec4(position,1.); gl_Position = p.xyww; }`;
const skyFrag = `
uniform vec3 uSunDir, uSunCol, uTop, uMid, uHor; uniform float uTime, uCloud, uStars, uSunI, uNight; uniform vec3 uCamPos;
varying vec3 vDir;
${GLSL_COMMON}
void main(){
  vec3 d = normalize(vDir);
  float h = max(d.y, -0.2);
  vec3 c = mix(uHor, uMid, smoothstep(0.0,0.22,h));
  c = mix(c, uTop, smoothstep(0.15,0.85,h));
  float sd = max(dot(d,uSunDir),0.);
  float glow = pow(sd, 5.)*0.28 + pow(sd, 40.)*0.45;
  c += uSunCol*glow*uSunI;
  float disc = smoothstep(0.99975, 0.99985, sd);
  c += uSunCol*disc*(uNight>0.5 ? 1.6 : 6.0);
  // nuvens
  if(d.y > 0.01){
    vec2 uv = d.xz/(d.y+0.18)*0.9 + vec2(uTime*0.004, 0.);
    float n = fbm(uv*1.4);
    float cl = smoothstep(0.5 - uCloud*0.22, 0.78, n) * smoothstep(0.0, 0.25, d.y) * uCloud;
    float lit = 0.55 + 0.45*clamp(dot(normalize(vec3(d.xz,0.2)),normalize(uSunDir.xzy*vec3(1.,1.,1.)))*0.5+0.5,0.,1.);
    vec3 cc = mix(uHor*0.85, uSunCol*0.95+0.15, lit) * (uNight>0.5?0.25:1.0);
    c = mix(c, cc, cl*0.85);
  }
  if(uStars>0.5 && d.y>0.0){
    vec2 su = d.xz/(d.y+0.3)*60.;
    float s = step(0.9965, hash12(floor(su)));
    c += vec3(0.9,0.95,1.)*s*smoothstep(0.05,0.4,d.y)*(0.6+0.4*sin(uTime*2.+hash12(floor(su))*30.));
  }
  gl_FragColor = vec4(c,1.);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

function createSky(env) {
  const g = new THREE.SphereGeometry(5000, 32, 16);
  const m = new THREE.ShaderMaterial({
    vertexShader: skyVert, fragmentShader: skyFrag, side: THREE.BackSide, depthWrite: false, depthTest: false,
    uniforms: {
      uSunDir: { value: new THREE.Vector3(...env.sunDir).normalize() }, uSunCol: { value: C(env.sunColor) },
      uTop: { value: C(env.skyTop) }, uMid: { value: C(env.skyMid) }, uHor: { value: C(env.skyHor) },
      uTime: { value: 0 }, uCloud: { value: env.cloud }, uStars: { value: env.stars || 0 }, uSunI: { value: env.sunI }, uNight: { value: env.night || 0 },
      uCamPos: { value: new THREE.Vector3() },
    },
  });
  const mesh = new THREE.Mesh(g, m);
  mesh.renderOrder = -10; mesh.frustumCulled = false;
  return mesh;
}

// ---------- Terra ----------
function landHeight(x, z, env) {
  const L = env.land, bx = L.beachX;
  const dx = x - bx;
  let h;
  if (dx < -10) h = -6;
  else {
    h = Math.max(dx, -10) * 0.05 - 0.2;
    h += L.hill * smoothstep(40, 200, dx) * (0.25 + fbm2(x * 0.006, z * 0.006, 4));
    const r = 1 - Math.abs(2 * fbm2(x * 0.0032 + 10, z * 0.0032, 5) - 1);
    h += L.mount * smoothstep(300, 700, dx) * r * r;
    h += 5 * smoothstep(0, 30, dx) * (fbm2(x * 0.03, z * 0.03, 3) - 0.4);
  }
  // cabo rochoso no fim da onda
  const cape = smoothstep(env.zEnd + 5, env.zEnd + 70, z);
  if (cape > 0 && x > -140) {
    const ch = (20 + 26 * fbm2(x * 0.02 + 3, z * 0.02, 4)) * smoothstep(-140, -70, x);
    h = Math.max(h, lerp(-6, ch, cape));
  }
  return h;
}

function colorFor(h, slope, x, z, env, rnd) {
  const T = env.land.tint.map(C);
  const col = new THREE.Color();
  if (h < 2.2) col.copy(T[0]).lerp(T[1], smoothstep(1.6, 3.6, h) * 0.5);
  else if (h < 160) col.copy(T[1]).lerp(T[2], smoothstep(10, 140, h));
  else col.copy(T[2]).lerp(T[3], smoothstep(140, 320, h));
  col.lerp(T[3], smoothstep(0.55, 1.0, slope) * 0.8);
  const n = 0.85 + 0.3 * noise2(x * 0.05, z * 0.05);
  col.multiplyScalar(n);
  return col;
}

function createLand(env) {
  const g = new THREE.Group();
  const x0 = -150, x1 = env.land.beachX + 1100, z0 = -420, z1 = env.zEnd + 800;
  const step = 9;
  const cols = Math.floor((x1 - x0) / step), rows = Math.floor((z1 - z0) / step);
  const pos = new Float32Array((cols + 1) * (rows + 1) * 3), colA = new Float32Array((cols + 1) * (rows + 1) * 3);
  const H = new Float32Array((cols + 1) * (rows + 1));
  for (let j = 0; j <= rows; j++) for (let i = 0; i <= cols; i++) {
    const x = x0 + i * step, z = z0 + j * step;
    H[j * (cols + 1) + i] = landHeight(x, z, env);
  }
  for (let j = 0; j <= rows; j++) for (let i = 0; i <= cols; i++) {
    const k = j * (cols + 1) + i;
    const x = x0 + i * step, z = z0 + j * step;
    const h = H[k];
    const hx = H[j * (cols + 1) + Math.min(i + 1, cols)] - H[j * (cols + 1) + Math.max(i - 1, 0)];
    const hz = H[Math.min(j + 1, rows) * (cols + 1) + i] - H[Math.max(j - 1, 0) * (cols + 1) + i];
    const slope = clamp(Math.hypot(hx, hz) / (2 * step), 0, 1.5) / 1.1;
    pos[k * 3] = x; pos[k * 3 + 1] = h; pos[k * 3 + 2] = z;
    const c = colorFor(h, slope, x, z, env);
    colA[k * 3] = c.r; colA[k * 3 + 1] = c.g; colA[k * 3 + 2] = c.b;
  }
  const idx = [];
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const a = j * (cols + 1) + i, b = a + 1, c = a + cols + 1, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colA, 3));
  geo.setIndex(idx); geo.computeVertexNormals();
  const land = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 }));
  g.add(land);

  // ilhas do lado do mar
  const rnd = mulberry32(7);
  for (let i = 0; i < 4; i++) {
    const R = 260 + rnd() * 320, Hh = 60 + rnd() * 120;
    const isl = makeIsland(R, Hh, env, i);
    isl.position.set(-1100 - rnd() * 1600, -4, 200 + rnd() * 1500 - 300);
    g.add(isl);
  }
  // vegetação / construções
  if (env.land.kind !== 'rocky') g.add(createPalms(env, H, { x0, z0, step, cols, rows }));
  if (env.land.kind === 'urban') g.add(createBuildings(env));
  if (env.land.kind === 'night') g.add(createBuildings(env, true));
  g.add(createRocks(env));
  return g;
}

function makeIsland(R, Hh, env, seed) {
  const rings = 22, seg = 56;
  const pos = [], col = [], idx = [];
  for (let r = 0; r <= rings; r++) for (let s = 0; s <= seg; s++) {
    const t = r / rings, ang = (s / seg) * Math.PI * 2;
    const rad = R * t;
    const x = Math.cos(ang) * rad, z = Math.sin(ang) * rad;
    const n = 0.6 + 0.8 * fbm2(x * 0.004 + seed * 9, z * 0.004, 4);
    const prof = Math.pow(Math.max(0, 1 - t * t), 1.4);
    const y = Hh * prof * n * (0.7 + 0.5 * fbm2(x * 0.012, z * 0.012, 3));
    pos.push(x, y, z);
    const c = new THREE.Color().copy(C(env.land.tint[2])).lerp(C(env.land.tint[3]), smoothstep(0.55, 1.0, y / Hh));
    c.multiplyScalar(0.8 + 0.4 * noise2(x * 0.02, z * 0.02));
    col.push(c.r, c.g, c.b);
  }
  for (let r = 0; r < rings; r++) for (let s = 0; s < seg; s++) {
    const a = r * (seg + 1) + s, b = a + 1, c = a + seg + 1, d = c + 1;
    idx.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx); g.computeVertexNormals();
  return new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }));
}

function paintGeo(geo, color) {
  const n = geo.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = color.r; a[i * 3 + 1] = color.g; a[i * 3 + 2] = color.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(a, 3));
  if (!geo.attributes.uv) geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  return geo;
}

function palmGeometry(night) {
  const parts = [];
  const trunk = new THREE.CylinderGeometry(0.012, 0.025, 1, 5, 4); trunk.translate(0, 0.5, 0);
  const tp = trunk.attributes.position;
  for (let i = 0; i < tp.count; i++) { const y = tp.getY(i); tp.setX(i, tp.getX(i) + 0.1 * y * y); }
  parts.push(paintGeo(trunk.toNonIndexed(), C(night ? '#2a2420' : '#6b5238')));
  for (let f = 0; f < 8; f++) {
    const fr = new THREE.ConeGeometry(0.06, 0.55, 4); fr.scale(1, 1, 0.12); fr.translate(0, 0.275, 0);
    fr.rotateZ(Math.PI / 2 - 0.55); // quase horizontal, caindo
    fr.rotateY((f / 8) * Math.PI * 2 + 0.3);
    fr.translate(0.02, 1.0, 0);
    parts.push(paintGeo(fr.toNonIndexed(), C(night ? '#16382e' : '#2f7a34')));
  }
  return mergeGeometries(parts.map((p) => { p.deleteAttribute('normal'); return p; }).map((p) => { p.computeVertexNormals(); return p; }));
}

function createPalms(env, H, G) {
  const geo = palmGeometry(env.night);
  const N = 520;
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, side: THREE.DoubleSide });
  const mesh = new THREE.InstancedMesh(geo, mat, N);
  const rnd = mulberry32(11);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  let n = 0, tries = 0;
  while (n < N && tries < 20000) {
    tries++;
    const x = env.land.beachX + 6 + Math.pow(rnd(), 1.6) * 170;
    const z = -300 + rnd() * (env.zEnd + 700);
    const h = landHeight(x, z, env);
    if (h < 0.4 || h > 28) continue;
    const sc = 6 + rnd() * 5;
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd() * 6.28);
    p.set(x, h - 0.3, z); s.set(sc, sc, sc);
    m.compose(p, q, s); mesh.setMatrixAt(n++, m);
  }
  mesh.count = n; mesh.instanceMatrix.needsUpdate = true; mesh.frustumCulled = false;
  return mesh;
}

function windowTexture(night) {
  const c = document.createElement('canvas'); c.width = 128; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = night ? '#06080c' : '#f2f2ee'; g.fillRect(0, 0, 128, 256);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 6; x++) {
    const lit = Math.random() < 0.55;
    g.fillStyle = night ? (lit ? '#ffd08a' : '#101722') : '#6f8fa8';
    g.fillRect(8 + x * 20, 8 + y * 15.5, 12, 8);
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4;
  return t;
}

function createBuildings(env, night = false) {
  const N = 260, rnd = mulberry32(5);
  const geo = new THREE.BoxGeometry(1, 1, 1); geo.translate(0, 0.5, 0);
  const tex = windowTexture(night);
  const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85, emissive: night ? new THREE.Color('#ffffff') : new THREE.Color('#000000'), emissiveMap: night ? tex : null, emissiveIntensity: night ? 0.9 : 0 });
  const mesh = new THREE.InstancedMesh(geo, mat, N);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  const pal = ['#f1ece0', '#dcd6c8', '#e8d8c0', '#c9d3d8', '#f5f0e6', '#d9c8b0'];
  let n = 0;
  for (let i = 0; i < N; i++) {
    const z = -300 + rnd() * (env.zEnd + 700);
    const x = env.land.beachX + 34 + Math.pow(rnd(), 1.4) * 150;
    const h = landHeight(x, z, env);
    if (h < 0.3 || h > 40) continue;
    const w = 18 + rnd() * 26, d = 18 + rnd() * 26, ht = 28 + Math.pow(rnd(), 2.2) * 150;
    p.set(x, h - 1, z); s.set(w, ht, d); q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd() < 0.5 ? 0 : 0.05);
    m.compose(p, q, s); mesh.setMatrixAt(n, m); mesh.setColorAt(n, C(pal[(rnd() * pal.length) | 0]).multiplyScalar(night ? 0.55 : 1)); n++;
  }
  mesh.count = n; mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true; mesh.frustumCulled = false;
  return mesh;
}

function createRocks(env) {
  const rnd = mulberry32(3), N = 26;
  const geo = new THREE.IcosahedronGeometry(1, 1);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) { const f = 0.75 + 0.5 * noise2(p.getX(i) * 3 + 5, p.getZ(i) * 3 + p.getY(i) * 2); p.setXYZ(i, p.getX(i) * f, p.getY(i) * f * 0.8, p.getZ(i) * f); }
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ color: C(env.land.tint[3]).multiplyScalar(1.1), roughness: 1 });
  const mesh = new THREE.InstancedMesh(geo, mat, N);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), pp = new THREE.Vector3();
  for (let i = 0; i < N; i++) {
    const sc = 1.6 + rnd() * 4.5;
    pp.set(60 + rnd() * (env.land.beachX - 70), -sc * 0.25, -200 + rnd() * (env.zEnd + 400));
    s.set(sc * (0.8 + rnd() * 0.6), sc * (0.7 + rnd() * 0.5), sc * (0.8 + rnd() * 0.6));
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd() * 6);
    m.compose(pp, q, s); mesh.setMatrixAt(i, m);
  }
  mesh.frustumCulled = false;
  return mesh;
}

// ---------- Fundo do mar (recife) ----------
const seabedVert = `
uniform float uBeachX; uniform vec2 uFlow; varying vec3 vWPos; varying vec2 vLoc;
${GLSL_COMMON}
void main(){
  vec4 wp = modelMatrix*vec4(position,1.);
  vec2 lp = wp.xz + uFlow; vLoc = lp;
  wp.y = floorY(lp, uBeachX);
  vWPos = wp.xyz;
  gl_Position = projectionMatrix*viewMatrix*wp;
}`;
const seabedFrag = `
uniform vec3 uCam, uSunCol, uFog, uShallow; uniform float uTime, uSunI, uFogD, uBeachX, uNight;
varying vec3 vWPos; varying vec2 vLoc;
${GLSL_COMMON}
void main(){
  vec2 p = vLoc;
  float lump = fbm(p*0.06);
  float coral = smoothstep(0.52,0.8,lump);
  vec3 sand = vec3(0.86,0.78,0.58);
  vec3 reef = mix(vec3(0.18,0.30,0.22), vec3(0.45,0.25,0.18), fbm(p*0.3));
  vec3 base = mix(sand, reef, coral);
  float c1 = fbm(p*0.9 + vec2(uTime*0.22, uTime*0.12));
  float c2 = fbm(p*1.7 - vec2(uTime*0.17, uTime*0.2));
  float caus = pow(1.-abs(c1+c2-1.0), 6.);
  vec3 col = base*(0.35 + 0.45*uSunI) + uSunCol*uSunI*caus*0.55 + uShallow*0.08;
  col *= mix(1., 0.35, uNight);
  float dist = length(uCam - vWPos);
  float fogF = 1.-exp(-uFogD*uFogD*dist*dist);
  col = mix(col, uFog, fogF);
  gl_FragColor = vec4(col,1.);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

function createSeabed(env) {
  const g = new THREE.PlaneGeometry(env.land.beachX + 140, 1100, 90, 150); g.rotateX(-Math.PI / 2);
  g.translate((env.land.beachX + 140) / 2 - 80, 0, 0);
  const m = new THREE.ShaderMaterial({
    vertexShader: seabedVert, fragmentShader: seabedFrag,
    uniforms: {
      uBeachX: { value: env.land.beachX }, uFlow: { value: new THREE.Vector2() }, uCam: { value: new THREE.Vector3() }, uSunCol: { value: C(env.sunColor) }, uFog: { value: C(env.fog) },
      uShallow: { value: C(env.shallow) }, uTime: { value: 0 }, uSunI: { value: env.sunI }, uFogD: { value: env.fogD }, uNight: { value: env.night || 0 },
    },
  });
  const mesh = new THREE.Mesh(g, m); mesh.frustumCulled = false; mesh.renderOrder = 0;
  return mesh;
}

// ---------- Mundo completo ----------
export function createWorld(env, scene) {
  const root = new THREE.Group();
  const sky = createSky(env);
  const land = createLand(env);
  const seabed = createSeabed(env);
  const uniforms = makeUniforms(env);
  seabed.material.uniforms.uFlow = uniforms.uFlow;
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(9000, 9000, 1, 1).rotateX(-Math.PI / 2), makeWaterMaterial(uniforms, true));
  sea.position.y = -0.07; sea.renderOrder = 1; sea.frustumCulled = false;
  sea.material.polygonOffset = true; sea.material.polygonOffsetFactor = 4; sea.material.polygonOffsetUnits = 8;
  root.add(sky, land, seabed, sea);
  const sun = new THREE.DirectionalLight(C(env.sunColor), env.sunI * 2.4);
  sun.position.set(...env.sunDir).multiplyScalar(500);
  const hemi = new THREE.HemisphereLight(C(env.skyMid), C(env.hemiG), env.night ? 0.55 : 0.9);
  root.add(sun, hemi);
  scene.add(root);
  scene.fog = new THREE.FogExp2(C(env.fog), env.fogD);
  return {
    root, sky, land, seabed, sea, sun, hemi, uniforms,
    update(cam, t, flowX, under) {
      uniforms.uCam.value.copy(cam.position); uniforms.uTime.value = t; uniforms.uFlow.value.set(flowX, 0);
      uniforms.uUnder.value = under ? 1 : 0;
      sky.material.uniforms.uTime.value = t; sky.position.copy(cam.position); sky.visible = !under;
      sea.position.x = Math.round(cam.position.x / 200) * 200; sea.position.z = Math.round(cam.position.z / 200) * 200;
      seabed.material.uniforms.uCam.value.copy(cam.position); seabed.material.uniforms.uTime.value = t;
      seabed.position.z = Math.round(cam.position.z / 100) * 100;
    },
    dispose() {
      scene.remove(root);
      root.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) { (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose()); } });
    },
  };
}
