import * as THREE from 'three';

// Prancha + pernas + braços em primeira pessoa. Espaço local da prancha: -Z = proa, +Y = cima, +X = lado da parede (direita).
const skin = new THREE.Color('#a8683f');
const shorts = new THREE.Color('#1c2a3a');

function boardGeometry() {
  const s = new THREE.Shape();
  const L = 1.0; // metade do comprimento (Y)
  s.moveTo(0, L);
  s.bezierCurveTo(0.16, L * 0.72, 0.27, 0.25, 0.265, 0);
  s.bezierCurveTo(0.26, -0.45, 0.22, -0.8, 0.12, -L);
  s.lineTo(-0.12, -L);
  s.bezierCurveTo(-0.22, -0.8, -0.26, -0.45, -0.265, 0);
  s.bezierCurveTo(-0.27, 0.25, -0.16, L * 0.72, 0, L);
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.045, bevelEnabled: true, bevelThickness: 0.025, bevelSize: 0.025, bevelSegments: 3, curveSegments: 20 });
  g.rotateX(-Math.PI / 2); // Y(comprimento) -> -Z
  g.translate(0, 0.0, 0);
  return g;
}

function capsule(r, len, color) {
  const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 4, 10), new THREE.MeshStandardMaterial({ color, roughness: 0.7 }));
  m.frustumCulled = false; m.userData.r = r; m.userData.base = len + 2 * r;
  return m;
}
const UP = new THREE.Vector3(0, 1, 0);
function place(mesh, a, b) {
  mesh.position.copy(a).add(b).multiplyScalar(0.5);
  const d = new THREE.Vector3().subVectors(b, a);
  const len = d.length();
  mesh.quaternion.setFromUnitVectors(UP, d.normalize());
  mesh.userData.len = len;
}
// IK de dois ossos: devolve joelho/cotovelo
function ik(hip, foot, l1, l2, hint, out) {
  const d = new THREE.Vector3().subVectors(foot, hip);
  let dist = Math.min(d.length(), l1 + l2 - 0.005);
  const dir = d.clone().normalize();
  const a = (l1 * l1 - l2 * l2 + dist * dist) / (2 * dist);
  const h = Math.sqrt(Math.max(l1 * l1 - a * a, 0));
  const hn = hint.clone().sub(dir.clone().multiplyScalar(hint.dot(dir))).normalize();
  out.copy(hip).addScaledVector(dir, a).addScaledVector(hn, h);
  return out;
}

export class Rig {
  constructor() {
    this.root = new THREE.Group();
    const bm = new THREE.MeshStandardMaterial({ color: '#f3f6f6', roughness: 0.35, metalness: 0.0 });
    this.board = new THREE.Mesh(boardGeometry(), bm); this.board.frustumCulled = false;
    this.root.add(this.board);
    // listra central + logo
    const str = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.004, 1.9), new THREE.MeshStandardMaterial({ color: '#1e2a30', roughness: 0.6 }));
    str.position.set(0, 0.074, 0.0); this.root.add(str);
    const logo = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.004, 0.06), new THREE.MeshStandardMaterial({ color: '#0e1417', roughness: 0.5 }));
    logo.position.set(0, 0.075, -0.62); logo.rotation.y = 0.0; this.root.add(logo);
    const tint = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.003, 0.5), new THREE.MeshStandardMaterial({ color: '#7fd6cf', roughness: 0.4, transparent: true, opacity: 0.0 }));
    this.legs = [capsule(0.088, 0.3, shorts), capsule(0.066, 0.3, skin), capsule(0.088, 0.3, shorts), capsule(0.066, 0.3, skin)];
    this.arms = [capsule(0.036, 0.3, skin), capsule(0.032, 0.3, skin), capsule(0.036, 0.3, skin), capsule(0.032, 0.3, skin)];
    this.hands = [new THREE.Mesh(new THREE.SphereGeometry(0.055, 12, 10), new THREE.MeshStandardMaterial({ color: skin, roughness: 0.7 })), new THREE.Mesh(new THREE.SphereGeometry(0.055, 12, 10), new THREE.MeshStandardMaterial({ color: skin, roughness: 0.7 }))];
    this.feet = [new THREE.Mesh(new THREE.BoxGeometry(0.27, 0.07, 0.11), new THREE.MeshStandardMaterial({ color: skin, roughness: 0.7 })), new THREE.Mesh(new THREE.BoxGeometry(0.27, 0.07, 0.11), new THREE.MeshStandardMaterial({ color: skin, roughness: 0.7 }))];
    [...this.legs, ...this.arms, ...this.hands, ...this.feet].forEach((m) => { m.frustumCulled = false; this.root.add(m); });
    this.k = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  }
  // p: {camY (altura dos olhos sobre o convés), prone, wall (0..1 mão na parede), stroke (fase da remada), grab, t}
  update(p) {
    const cam = new THREE.Vector3(0, p.camY, 0);
    const T = p.t;
    const prone = p.prone;
    // ---- pernas ----
    const standHip = Math.max(p.camY - 0.68, 0.2);
    const lerpV = (a, b, t) => new THREE.Vector3().lerpVectors(a, b, t);
    const hipF = lerpV(new THREE.Vector3(0.03, standHip, -0.14), new THREE.Vector3(0.0, 0.14, 0.45), prone);
    const hipB = lerpV(new THREE.Vector3(0.03, standHip, 0.14), new THREE.Vector3(0.0, 0.14, 0.62), prone);
    const footF = lerpV(new THREE.Vector3(0.0, 0.09, -0.38), new THREE.Vector3(0.05, 0.1, 0.78), prone);
    const footB = lerpV(new THREE.Vector3(0.0, 0.09, 0.5), new THREE.Vector3(-0.05, 0.1, 0.9), prone);
    const hintF = new THREE.Vector3(0.9, 0.25, -0.25).normalize();
    const hintB = new THREE.Vector3(0.9, 0.25, 0.1).normalize();
    ik(hipF, footF, 0.46, 0.44, hintF, this.k[0]);
    ik(hipB, footB, 0.46, 0.44, hintB, this.k[1]);
    place(this.legs[0], hipF, this.k[0]); place(this.legs[1], this.k[0], footF);
    place(this.legs[2], hipB, this.k[1]); place(this.legs[3], this.k[1], footB);
    this.feet[0].position.copy(footF).add(new THREE.Vector3(0.06, 0, 0)); this.feet[1].position.copy(footB).add(new THREE.Vector3(0.06, 0, 0));
    this.feet.forEach((f) => { f.rotation.set(0, 0, 0); f.visible = prone < 0.5; });
    this.legs[0].visible = this.legs[1].visible = this.legs[2].visible = this.legs[3].visible = true;
    // ---- braços ----
    const shR = new THREE.Vector3(0.24, p.camY - 0.2, 0.02), shL = new THREE.Vector3(-0.22, p.camY - 0.2, 0.0);
    let handR, handL;
    const sw = Math.sin(T * 1.3) * 0.04;
    if (prone > 0.5) {
      // remada alternada
      const ph = p.stroke;
      const sR = (Math.sin(ph) * 0.5 + 0.5), sL = (Math.sin(ph + Math.PI) * 0.5 + 0.5);
      const strokeHand = (s, side) => new THREE.Vector3(side * 0.34, 0.16 - 0.2 * Math.max(0, Math.sin(ph + (side > 0 ? 0 : Math.PI)) * -1), -0.95 + 0.75 * s);
      handR = strokeHand(sR, 1); handL = strokeHand(sL, -1);
      shR.set(0.2, 0.3, -0.25); shL.set(-0.2, 0.3, -0.25);
    } else {
      // parede à direita: estende a mão para a água
      const wall = p.wall;
      handR = new THREE.Vector3(0.62 + 0.4 * wall, 0.28 + (1 - wall) * 0.32 + sw, -0.5 - 0.15 * wall);
      handL = new THREE.Vector3(-0.55, p.camY - 0.62 + sw, -0.45);
      if (p.grab > 0.5) { handR.set(0.28, 0.12, -0.2); handL.set(-0.06, 0.12, -0.4); }
    }
    ik(shR, handR, 0.3, 0.3, new THREE.Vector3(0.3, -0.6, 0.6).normalize(), this.k[2]);
    ik(shL, handL, 0.3, 0.3, new THREE.Vector3(-0.3, -0.6, 0.6).normalize(), this.k[3]);
    place(this.arms[0], shR, this.k[2]); place(this.arms[1], this.k[2], handR);
    place(this.arms[2], shL, this.k[3]); place(this.arms[3], this.k[3], handL);
    this.hands[0].position.copy(handR); this.hands[1].position.copy(handL);
    this.arms[0].visible = this.arms[1].visible = this.arms[2].visible = this.arms[3].visible = true;
    // alturas: capsulas esticadas conforme len
    const stretch = (m) => { const l = m.userData.len || 0.3; m.scale.set(1, (l + m.userData.r * 1.2) / m.userData.base + 0.0001, 1); };
    this.legs.forEach((m) => stretch(m)); this.arms.forEach((m) => stretch(m));
  }
}
