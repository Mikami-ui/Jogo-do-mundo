// Monumentos famosos modelados à mão (formas simples), colocados nas coordenadas reais.
import * as THREE from 'three';
import { RE, lonToMx, latToMy } from './geo.js';
import { getTextures } from './textures.js';
import { LAYER } from './collision.js';

const mats = new Map();
const M = (hex, emissive = 0) => {
  const k = hex + ':' + emissive;
  if (!mats.has(k)) mats.set(k, new THREE.MeshLambertMaterial({ color: hex, emissive: emissive ? hex : 0, emissiveIntensity: emissive }));
  return mats.get(k);
};
const box = (g, w, h, d, x, y, z, hex) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), M(hex)); m.position.set(x, y + h / 2, z); g.add(m); return m; };
const cyl = (g, r0, r1, h, x, y, z, hex, seg = 16) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(r1, r0, h, seg), M(hex)); m.position.set(x, y + h / 2, z); g.add(m); return m; };
const sph = (g, r, x, y, z, hex, sy = 1) => { const m = new THREE.Mesh(new THREE.SphereGeometry(r, 16, 12), M(hex)); m.position.set(x, y, z); m.scale.y = sy; g.add(m); return m; };

function cristo() {
  const g = new THREE.Group(), c = 0xc9cabf;
  box(g, 6, 8, 6, 0, 0, 0, 0x8d8e88);
  cyl(g, 3.2, 1.9, 20, 0, 8, 0, c, 10);           // túnica
  box(g, 28, 2.1, 2.2, 0, 24.2, 0, c);            // braços abertos
  box(g, 5.2, 5, 2.8, 0, 22.5, 0, c);             // ombros
  sph(g, 1.9, 0, 29.6, 0, c, 1.15);               // cabeça
  return g;
}
function eiffel() {
  const g = new THREE.Group(), c = 0x6b5138;
  const prof = [[62, 0], [36, 57], [19, 115], [10, 180], [5, 276], [2.2, 300], [0.6, 330]].map((p) => new THREE.Vector2(p[0], p[1]));
  const body = new THREE.Mesh(new THREE.LatheGeometry(prof, 4), M(c)); body.rotation.y = Math.PI / 4; g.add(body);
  box(g, 76, 4, 76, 0, 55, 0, c); box(g, 42, 3.5, 42, 0, 113, 0, c); box(g, 14, 5, 14, 0, 274, 0, c);
  return g;
}
function liberty() {
  const g = new THREE.Group(), v = 0x5fae98, gr = 0xb8b1a3, gr2 = 0xa49d8f;
  const patina = new THREE.MeshStandardMaterial({ color: v, roughness: 0.55, metalness: 0.25 });
  const add = (geo, mat, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); g.add(m); return m; };
  // Forte Wood: estrela de 11 pontas, 6 m de altura
  const star = new THREE.Shape();
  for (let i = 0; i < 22; i++) { const a = (i / 22) * Math.PI * 2, r = i % 2 ? 31 : 46; const x = Math.cos(a) * r, y = Math.sin(a) * r; i ? star.lineTo(x, y) : star.moveTo(x, y); }
  const sg = new THREE.ExtrudeGeometry(star, { depth: 7, bevelEnabled: false }); sg.rotateX(-Math.PI / 2); sg.translate(0, -1, 0);
  add(sg, M(gr2));
  // pedestal (até 47 m): base escalonada, corpo, cornija e balcão
  box(g, 32, 4, 32, 0, 6, 0, gr); box(g, 26, 4, 26, 0, 10, 0, gr);
  const ped = new THREE.CylinderGeometry(9.5 * Math.SQRT2, 11.5 * Math.SQRT2, 26, 4); ped.rotateY(Math.PI / 4); add(ped, M(gr), 0, 27, 0);
  box(g, 22, 3, 22, 0, 40, 0, gr2); box(g, 17, 4, 17, 0, 43, 0, gr);
  // manto (perfil de revolução), pescoço e cabeça
  const prof = [[0, 0], [6.4, 0], [6.6, 2], [6.0, 7], [5.3, 13], [4.8, 18], [4.3, 22], [3.9, 25], [3.5, 27], [2.9, 28.5], [1.2, 29.5], [0, 29.6]].map((p) => new THREE.Vector2(p[0], p[1]));
  add(new THREE.LatheGeometry(prof, 20), patina, 0, 47, 0);
  add(new THREE.CylinderGeometry(1.0, 1.2, 2.2, 10), patina, 0, 77.4, 0);
  const head = add(new THREE.SphereGeometry(2.2, 16, 12), patina, 0, 80.2, 0.2); head.scale.set(0.95, 1.2, 1.0);
  // coroa: faixa e 7 raios abertos para cima e para a frente (+z)
  add(new THREE.CylinderGeometry(2.4, 2.4, 0.9, 16), patina, 0, 82.0, 0.2);
  for (let i = 0; i < 7; i++) {
    const a = -1.05 + i * 0.35, ray = new THREE.Mesh(new THREE.ConeGeometry(0.35, 3.6, 5), patina);
    ray.position.set(Math.sin(a) * 2.9, 83.0 + Math.cos(a) * 0.9, 0.2 + Math.cos(a) * 1.2); ray.rotation.set(0.55 * Math.cos(a), 0, -a); g.add(ray);
  }
  // braço direito erguido com a tocha (ponta da chama a 93 m)
  const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.25, 12.8, 10), patina); arm.position.set(4.3, 81.5, 0.3); arm.rotation.z = -0.24; g.add(arm);
  add(new THREE.CylinderGeometry(0.75, 0.55, 2.6, 10), patina, 5.85, 88.9, 0.3);
  add(new THREE.CylinderGeometry(1.5, 1.1, 0.5, 14), M(0xc9a227), 5.85, 90.4, 0.3);
  add(new THREE.ConeGeometry(0.9, 2.6, 10), M(0xffc94a, 1.6), 5.85, 91.9, 0.3);
  // braço esquerdo dobrado segurando a tábua (4 × 7 m)
  const fa = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.9, 6, 10), patina); fa.position.set(-4.6, 70, 1.2); fa.rotation.set(0.9, 0, 0.35); g.add(fa);
  const tab = new THREE.Mesh(new THREE.BoxGeometry(4.1, 7.2, 0.8), patina); tab.position.set(-4.9, 68.5, 2.3); tab.rotation.set(-0.35, 0, 0.12); g.add(tab);
  return g;
}
function bigben() {
  const g = new THREE.Group(), c = 0xb89f6b;
  box(g, 12, 62, 12, 0, 0, 0, c); box(g, 14, 12, 14, 0, 62, 0, 0xa38a58);
  for (const [x, z, r] of [[7.1, 0, 0], [-7.1, 0, 0], [0, 7.1, 1], [0, -7.1, 1]]) { const f = new THREE.Mesh(new THREE.CylinderGeometry(4.2, 4.2, 0.4, 24), M(0xf2efe2, 0.25)); f.rotation.set(r ? Math.PI / 2 : 0, 0, r ? 0 : Math.PI / 2); f.position.set(x, 68, z); g.add(f); }
  const roof = cyl(g, 9.5, 0.4, 22, 0, 74, 0, 0x3d3a36, 4); roof.rotation.y = Math.PI / 4;
  return g;
}
function burj() {
  const g = new THREE.Group(), c = 0x9fb4c6;
  const tiers = [[30, 0, 160], [25, 160, 270], [21, 270, 370], [17, 370, 460], [13, 460, 550], [9, 550, 640], [5, 640, 730], [1.4, 730, 828]];
  for (const [r, a, b] of tiers) { const m = cyl(g, r, r * 0.9, b - a, 0, a, 0, c, 3); m.rotation.y = a * 0.003; const m2 = cyl(g, r * 0.62, r * 0.55, b - a + 14, 0, a, 0, 0xb9cad8, 12); }
  return g;
}
function pyramid(base, h) {
  const g = new THREE.Group(), D = 30; // a base continua 30 m para dentro do chão
  const T = getTextures(), map = T.rock.clone(), nm = T.rockN.clone();
  for (const t of [map, nm]) { t.repeat.set(26, 16); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.needsUpdate = true; }
  const mat = new THREE.MeshStandardMaterial({ color: 0xd8bf8f, map, normalMap: nm, normalScale: new THREE.Vector2(1.6, 1.6), roughness: 0.95 });
  const r = (base / Math.SQRT2) * (h + D) / h;
  const geo = new THREE.ConeGeometry(r, h + D, 4, 12); geo.translate(0, (h + D) / 2 - D, 0); geo.rotateY(Math.PI / 4);
  const m = new THREE.Mesh(geo, mat); g.add(m);
  return g;
}
function taj() {
  const g = new THREE.Group(), c = 0xece9df;
  box(g, 95, 7, 95, 0, 0, 0, c); box(g, 56, 30, 56, 0, 7, 0, c);
  cyl(g, 15, 15, 8, 0, 37, 0, c, 20); sph(g, 17, 0, 52, 0, c, 1.2); cyl(g, 0.6, 0.1, 9, 0, 70, 0, 0xc9a227, 6);
  for (const [x, z] of [[18, 18], [-18, 18], [18, -18], [-18, -18]]) { cyl(g, 5, 5, 5, x, 37, z, c, 12); sph(g, 5.5, x, 44, z, c, 1.1); }
  for (const [x, z] of [[44, 44], [-44, 44], [44, -44], [-44, -44]]) { cyl(g, 2.8, 2.2, 40, x, 7, z, c, 10); sph(g, 2.9, x, 48, z, c, 1.1); }
  return g;
}
function empire() {
  const g = new THREE.Group(), c = 0xb9ae98;
  box(g, 129, 26, 57, 0, 0, 0, c); box(g, 96, 66, 50, 0, 26, 0, c); box(g, 58, 230, 42, 0, 92, 0, c);
  box(g, 40, 30, 30, 0, 322, 0, c); box(g, 20, 30, 20, 0, 352, 0, 0xa59a84); cyl(g, 4, 0.5, 62, 0, 381, 0, 0x8d8777, 8);
  return g;
}
function cntower() {
  const g = new THREE.Group(), c = 0xbdbdb6;
  cyl(g, 22, 6, 335, 0, 0, 0, c, 3); cyl(g, 9, 6, 335, 0, 0, 0, c, 12);
  cyl(g, 14, 18, 8, 0, 335, 0, 0xd9d9d2); cyl(g, 18, 15, 14, 0, 343, 0, 0x8f1f1f); cyl(g, 5.5, 4, 90, 0, 357, 0, c, 10); cyl(g, 1.6, 0.4, 106, 0, 447, 0, 0xe8e8e8, 6);
  return g;
}
function skytree() {
  const g = new THREE.Group(), c = 0xdfe8ee;
  cyl(g, 34, 9, 350, 0, 0, 0, c, 3); cyl(g, 14, 9, 350, 0, 0, 0, c, 16);
  cyl(g, 14, 20, 12, 0, 340, 0, 0xc7d3dc); cyl(g, 20, 17, 24, 0, 352, 0, 0xaebccc); cyl(g, 9, 7, 70, 0, 376, 0, c, 12);
  cyl(g, 13, 11, 14, 0, 445, 0, 0xaebccc); cyl(g, 4, 1, 175, 0, 459, 0, 0xeef2f5, 8);
  return g;
}
function washington() {
  const g = new THREE.Group(), c = 0xe6e3da;
  const a = cyl(g, 11.8, 7.4, 152, 0, 0, 0, c, 4); a.rotation.y = Math.PI / 4;
  const b = cyl(g, 7.4, 0.2, 17, 0, 152, 0, c, 4); b.rotation.y = Math.PI / 4;
  return g;
}
function arch() {
  const g = new THREE.Group();
  const pts = [];
  for (let i = 0; i <= 40; i++) { const x = -96 + (192 * i) / 40; const y = 192 * (1 - (Math.cosh((x / 96) * 2.2) - 1) / (Math.cosh(2.2) - 1)); pts.push(new THREE.Vector3(x, Math.max(y, 0), 0)); }
  g.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 60, 5.5, 3), M(0xc7ccd1)));
  return g;
}
function eye() {
  const g = new THREE.Group(), c = 0xe9edf0;
  const w = new THREE.Mesh(new THREE.TorusGeometry(60, 1.4, 6, 48), M(c)); w.position.y = 68; g.add(w);
  for (let i = 0; i < 16; i++) { const sp = cyl(g, 0.35, 0.35, 120, 0, 8, 0, c, 4); sp.position.y = 68; sp.rotation.z = (i * Math.PI) / 16; }
  for (const sx of [-1, 1]) { const l = cyl(g, 1.6, 1.2, 76, sx * 14, 0, 16, c, 6); l.rotation.z = sx * 0.2; l.rotation.x = -0.22; }
  return g;
}

export const LANDMARKS = [
  { id: 'cristo', foot: 4, peak: 180, name: 'Cristo Redentor', lat: -22.95192, lon: -43.21049, r: 25, rot: 15, build: cristo },
  { id: 'eiffel', foot: 55, name: 'Torre Eiffel', lat: 48.85837, lon: 2.29448, r: 75, rot: 45, build: eiffel },
  { id: 'liberdade', foot: 20, name: 'Estátua da Liberdade', lat: 40.68925, lon: -74.0445, r: 60, rot: -45, build: liberty },
  { id: 'bigben', foot: 7, name: 'Big Ben', lat: 51.50073, lon: -0.12463, r: 18, rot: 10, build: bigben },
  { id: 'eye', foot: 15, name: 'London Eye', lat: 51.50329, lon: -0.11955, r: 45, rot: 65, build: eye },
  { id: 'burj', foot: 28, name: 'Burj Khalifa', lat: 25.1972, lon: 55.27438, r: 70, rot: 0, build: burj },
  { id: 'quéops', foot: 115, name: 'Pirâmide de Quéops', lat: 29.97923, lon: 31.13423, r: 140, rot: 0, build: () => pyramid(230, 139) },
  { id: 'quéfren', foot: 107, name: 'Pirâmide de Quéfren', lat: 29.97611, lon: 31.13077, r: 130, rot: 0, build: () => pyramid(215, 136) },
  { id: 'miquerinos', foot: 52, name: 'Pirâmide de Miquerinos', lat: 29.97252, lon: 31.12825, r: 70, rot: 0, build: () => pyramid(105, 65) },
  { id: 'taj', foot: 40, name: 'Taj Mahal', lat: 27.17515, lon: 78.04215, r: 75, rot: 0, build: taj },
  { id: 'empire', foot: 50, name: 'Empire State', lat: 40.74844, lon: -73.98566, r: 75, rot: 29, build: empire },
  { id: 'cn', foot: 12, name: 'CN Tower', lat: 43.64257, lon: -79.38706, r: 40, rot: 0, build: cntower },
  { id: 'skytree', foot: 28, name: 'Tokyo Skytree', lat: 35.71006, lon: 139.8107, r: 50, rot: 0, build: skytree },
  { id: 'washington', foot: 8, name: 'Monumento a Washington', lat: 38.88948, lon: -77.03528, r: 25, rot: 0, build: washington },
  { id: 'arch', foot: 90, name: 'Gateway Arch', lat: 38.62469, lon: -90.18478, r: 110, rot: 80, build: arch },
];

// Colisão a partir do próprio modelo: cada peça é fatiada na altura e cada fatia vira uma caixa
// (as fatias de um cone viram degraus). Fatias com vãos (pernas, arco, roda) viram várias caixas.
function buildColliderShapes(obj) {
  const keepPos = obj.position.clone(), keepRot = obj.rotation.y;
  obj.position.set(0, 0, 0); obj.rotation.y = 0; obj.updateMatrixWorld(true);
  const shapes = [], boxes = [], v = new THREE.Vector3(), a = new THREE.Vector3(), b = new THREE.Vector3();
  obj.traverse((m) => {
    if (!m.isMesh) return;
    const g = m.geometry; g.computeBoundingBox();
    const bb = g.boundingBox.clone().applyMatrix4(m.matrixWorld), sz = bb.getSize(v);
    if (Math.max(sz.x, sz.y, sz.z) < 1.5) return; // detalhes pequenos (raios da coroa, chama) não bloqueiam
    // grade horizontal da peça (no máximo 40 × 40 células) e pontos da superfície a cada meia célula
    const cell = Math.max(1, Math.max(sz.x, sz.z) / 40), stepL = cell / 2;
    const P = g.attributes.position, idx = g.index, pts = [];
    const tri = (i) => (idx ? idx.getX(i) : i);
    const n = idx ? idx.count : P.count;
    // pontos sobre toda a superfície de cada triângulo (não só nas arestas): faces grandes e lisas também contam
    const C3 = new THREE.Vector3();
    for (let i = 0; i < n; i += 3) {
      a.fromBufferAttribute(P, tri(i)).applyMatrix4(m.matrixWorld); b.fromBufferAttribute(P, tri(i + 1)).applyMatrix4(m.matrixWorld); C3.fromBufferAttribute(P, tri(i + 2)).applyMatrix4(m.matrixWorld);
      const n1 = Math.min(400, Math.max(1, Math.ceil(a.distanceTo(b) / stepL))), n2 = Math.min(400, Math.max(1, Math.ceil(a.distanceTo(C3) / stepL)));
      for (let u = 0; u <= n1; u++) for (let w = 0; w <= n2; w++) {
        const fu = u / n1, fw = w / n2; if (fu + fw > 1.0001) continue;
        pts.push([a.x + (b.x - a.x) * fu + (C3.x - a.x) * fw, a.y + (b.y - a.y) * fu + (C3.y - a.y) * fw, a.z + (b.z - a.z) * fu + (C3.z - a.z) * fw]);
      }
      // arestas BC finas (triângulos alongados) também
      const k = Math.max(1, Math.ceil(b.distanceTo(C3) / stepL));
      for (let q = 0; q <= k; q++) pts.push([b.x + (C3.x - b.x) * q / k, b.y + (C3.y - b.y) * q / k, b.z + (C3.z - b.z) * q / k]);
    }
    const nb = Math.max(1, Math.min(24, Math.ceil(sz.y / 4))), bh = sz.y / nb;
    const gx0 = bb.min.x - cell, gz0 = bb.min.z - cell, W = Math.ceil((bb.max.x - gx0) / cell) + 2, H = Math.ceil((bb.max.z - gz0) / cell) + 2;
    for (let k = 0; k < nb; k++) {
      const y0 = bb.min.y + k * bh, y1 = y0 + bh;
      // marca as células com superfície nesta fatia
      const mark = new Uint8Array(W * H);
      for (const p of pts) if (p[1] >= y0 - 0.01 && p[1] <= y1 + 0.01) mark[Math.floor((p[2] - gz0) / cell) * W + Math.floor((p[0] - gx0) / cell)] = 1;
      // preenche o interior fechado (casca oca vira sólido): o que não se alcança pela borda fica cheio.
      // A busca usa as paredes engrossadas em 1 célula para não "vazar" por frestas na diagonal.
      const wall = new Uint8Array(W * H);
      for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) if (mark[z * W + x]) for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) { const xx = x + dx, zz = z + dz; if (xx >= 0 && zz >= 0 && xx < W && zz < H) wall[zz * W + xx] = 1; }
      const out = new Uint8Array(W * H), st = [];
      for (let x = 0; x < W; x++) { st.push(x, (H - 1) * W + x); } for (let z = 0; z < H; z++) { st.push(z * W, z * W + W - 1); }
      while (st.length) { const i = st.pop(); if (out[i] || wall[i]) continue; out[i] = 1; const x = i % W, z = (i - x) / W; if (x > 0) st.push(i - 1); if (x < W - 1) st.push(i + 1); if (z > 0) st.push(i - W); if (z < H - 1) st.push(i + W); }
      const solid = (i) => mark[i] || (!out[i] && !wall[i]) || (wall[i] && !out[i] && isEnclosed(i));
      const isEnclosed = (i) => { const x = i % W, z = (i - x) / W; for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const xx = x + dx, zz = z + dz; if (xx < 0 || zz < 0 || xx >= W || zz >= H || out[zz * W + xx]) return false; } return true; };
      // linhas da grade viram caixas; linhas iguais e vizinhas se juntam numa só
      let prev = [];
      for (let z = 0; z < H; z++) {
        const runs = [];
        for (let x = 0; x < W; x++) { if (!solid(z * W + x)) continue; let e = x; while (e + 1 < W && solid(z * W + e + 1)) e++; runs.push([x, e]); x = e; }
        const next = [];
        for (const r of runs) { const p = prev.find((q) => q.x0 === r[0] && q.x1 === r[1]); if (p) { p.z1 = z; next.push(p); } else { const q = { x0: r[0], x1: r[1], z0: z, z1: z }; next.push(q); boxes.push(q); } }
        prev = next;
      }
      for (const q of boxes.splice(0)) shapes.push({ x: gx0 + (q.x0 + q.x1 + 1) / 2 * cell, z: gz0 + (q.z0 + q.z1 + 1) / 2 * cell, hx: (q.x1 - q.x0 + 1) / 2 * cell, hz: (q.z1 - q.z0 + 1) / 2 * cell, y0, y1 });
    }
  });
  obj.position.copy(keepPos); obj.rotation.y = keepRot; obj.updateMatrixWorld(true);
  return shapes;
}

export class Landmarks {
  constructor(scene, frame, terrain, world) {
    this.frame = frame; this.terrain = terrain;
    this.group = new THREE.Group(); scene.add(this.group);
    this.items = LANDMARKS.map((L) => ({ ...L, mx: lonToMx(L.lon), my: latToMy(L.lat), obj: null, h: null, hz: -1, dist: Infinity }));
    world.exclude = this.items.map((i) => ({ mx: i.mx, my: i.my, r: i.r }));
    world.extraLabels = this.items.map((i) => ({ name: i.name, cls: 'landmark', mx: i.mx, my: i.my, rank: 0, range: 45e3, ele: 0, lm: i }));
    this.labels = world.extraLabels;
  }
  // altura de assentamento: o ponto mais baixo do chão sob a pegada (assim nada fica flutuando em declive)
  ground(it, p) {
    const T = this.terrain;
    // monumento de cume (Cristo): o mapa de relevo pode ter o topo do morro deslocado; encaixa no ponto mais alto por perto
    if (it.peak) {
      let best = -1e9, bx = 0, bz = 0;
      for (const [R, st, cx, cz] of [[it.peak, 10, 0, 0], [12, 2, null, null]]) {
        const ox = cx ?? bx, oz = cz ?? bz;
        for (let dx = -R; dx <= R; dx += st) for (let dz = -R; dz <= R; dz += st) { if (Math.hypot(dx + ox, dz + oz) > it.peak) continue; const g = T.heightAt(p.x + ox + dx, p.z + oz + dz); if (g.ok && g.h > best) { best = g.h; bx = ox + dx; bz = oz + dz; } }
      }
      it.off = [bx, bz]; p = { x: p.x + bx, z: p.z + bz };
    }
    const g0 = T.heightAt(p.x, p.z); if (!g0.ok) return null;
    let h = g0.h;
    for (const fr of [0.5, 1]) for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2, g = T.heightAt(p.x + Math.cos(a) * it.foot * fr, p.z + Math.sin(a) * it.foot * fr); if (g.ok) h = Math.min(h, g.h); }
    return { h, z: g0.z };
  }
  // colisores do monumento (caixas orientadas) no sistema de colisão do jogo
  collide(it) {
    if (!this.physics) return;
    this.physics.removeGroup(it.pg); it.pg = null;
    it.shapes ||= buildColliderShapes(it.obj);
    const f = this.frame, th = -(it.rot || 0) * Math.PI / 180, c = Math.cos(th), s = Math.sin(th);
    let ext = 10; for (const q of it.shapes) ext = Math.max(ext, Math.hypot(q.x, q.z) + Math.hypot(q.hx, q.hz) + 5);
    const S = ext * 2, items = it.shapes.map((q, i) => ({
      t: 'b', x: S / 2 + q.x * c + q.z * s, z: S / 2 - q.x * s + q.z * c, hx: q.hx, hz: q.hz, c, s: -s,
      y0: it.h + q.y0, y1: it.h + q.y1, layer: LAYER.STATIC, id: `lm:${it.id}:${i}`,
    }));
    const o = it.off || [0, 0];
    it.pg = this.physics.addGroup(it.mx + (o[0] - S / 2) / f.k, it.my - (o[1] - S / 2) / f.k, f.k, S, items);
  }
  update(C) {
    const f = this.frame;
    for (let n = 0; n < this.items.length; n++) {
      const it = this.items[n];
      const p = f.toLocal(it.lat, it.lon);
      const o = it.off || [0, 0], dx = p.x + o[0] - C.x, dz = p.z + o[1] - C.z, d = Math.hypot(dx, dz);
      it.dist = d;
      if (d > 60000) { if (it.obj) it.obj.visible = false; if (it.pg) { this.physics?.removeGroup(it.pg); it.pg = null; it.hz = -1; } continue; }
      if (!it.obj) { it.obj = it.build(); it.obj.rotation.y = -(it.rot || 0) * Math.PI / 180; this.group.add(it.obj); }
      if (it.hz < 13) { const g = this.ground(it, p); if (g && g.z > it.hz) { it.h = g.h - 0.3; it.hz = g.z; this.labels[n].ele = g.h + 60; this.labels[n].h = null; if (it.off) { this.labels[n].mx = it.mx + it.off[0] / f.k; this.labels[n].my = it.my - it.off[1] / f.k; } it.obj.position.y = it.h; this.collide(it); } }
      it.obj.visible = it.h != null;
      it.obj.position.set(dx, (it.h || 0) - (d * d) / (2 * RE), dz);
    }
  }
}
