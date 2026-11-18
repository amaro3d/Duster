import * as THREE from 'three';

const vs = `
attribute float aSize; attribute float aAlpha; varying float vA;
uniform float uScale;
void main(){
  vA = aAlpha;
  vec4 mv = modelViewMatrix*vec4(position,1.);
  gl_PointSize = clamp(aSize*uScale/max(-mv.z,0.1), 1., 220.);
  gl_Position = projectionMatrix*mv;
}`;
const fs = `
uniform vec3 uColor; varying float vA; uniform float uGlow;
void main(){
  vec2 c = gl_PointCoord-0.5; float d = length(c);
  float a = smoothstep(0.5,0.0,d); a*=a;
  gl_FragColor = vec4(uColor + uGlow*a, a*vA);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export class Particles {
  constructor(max, color, glow = 0) {
    this.max = max; this.n = 0;
    this.pos = new Float32Array(max * 3); this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max); this.maxLife = new Float32Array(max);
    this.size = new Float32Array(max); this.alpha = new Float32Array(max); this.grow = new Float32Array(max);
    this.s0 = new Float32Array(max);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo = g;
    this.mat = new THREE.ShaderMaterial({
      vertexShader: vs, fragmentShader: fs, transparent: true, depthWrite: false,
      uniforms: { uColor: { value: new THREE.Color(color) }, uScale: { value: 600 }, uGlow: { value: glow } },
    });
    this.points = new THREE.Points(g, this.mat); this.points.frustumCulled = false; this.points.renderOrder = 5;
    this.head = 0;
    for (let i = 0; i < max; i++) { this.life[i] = 0; this.pos[i * 3 + 1] = -1e4; }
  }
  emit(x, y, z, vx, vy, vz, life, size, grow = 0) {
    const i = this.head; this.head = (this.head + 1) % this.max;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.life[i] = life; this.maxLife[i] = life; this.s0[i] = size; this.grow[i] = grow;
  }
  update(dt, gravity = -9.8, drag = 0.6) {
    const d = Math.exp(-drag * dt);
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) { this.alpha[i] = 0; continue; }
      this.life[i] -= dt;
      const k = i * 3;
      this.vel[k + 1] += gravity * dt;
      this.vel[k] *= d; this.vel[k + 1] *= d; this.vel[k + 2] *= d;
      this.pos[k] += this.vel[k] * dt; this.pos[k + 1] += this.vel[k + 1] * dt; this.pos[k + 2] += this.vel[k + 2] * dt;
      const t = 1 - this.life[i] / this.maxLife[i];
      this.alpha[i] = Math.min(1, t * 8) * (1 - t) * 0.9;
      this.size[i] = this.s0[i] * (1 + this.grow[i] * t);
      if (this.life[i] <= 0) { this.pos[k + 1] = -1e4; this.alpha[i] = 0; }
    }
    const a = this.geo.attributes;
    a.position.needsUpdate = a.aSize.needsUpdate = a.aAlpha.needsUpdate = true;
  }
  setScale(h) { this.mat.uniforms.uScale.value = h * 0.9; }
}
