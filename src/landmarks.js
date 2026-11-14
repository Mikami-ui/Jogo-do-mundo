// Monumentos famosos modelados à mão (formas simples), colocados nas coordenadas reais.
import * as THREE from 'three';
import { RE, lonToMx, latToMy } from './geo.js';

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
  const g = new THREE.Group(), v = 0x5fae98, s = 0x9c958a;
  cyl(g, 30, 30, 6, 0, 0, 0, s, 11); box(g, 20, 27, 20, 0, 6, 0, s); box(g, 14, 14, 14, 0, 33, 0, s);
  cyl(g, 5.5, 3.2, 34, 0, 47, 0, v, 12); sph(g, 2.6, 0, 83, 0, v);
  const arm = cyl(g, 1.4, 1.1, 14, 3.2, 80, 0, v, 8); arm.rotation.z = -0.22;
  const torch = new THREE.Mesh(new THREE.SphereGeometry(1.5, 10, 8), M(0xffc94a, 1.6)); torch.position.set(4.9, 95, 0); g.add(torch);
  for (let i = 0; i < 7; i++) { const sp = cyl(g, 0.35, 0.05, 3.2, 0, 85, 0, v, 5); const a = -1.2 + i * 0.4; sp.position.set(Math.sin(a) * 2.6, 85.4 + Math.cos(a) * 1.6, 0); sp.rotation.z = -a; }
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
  const g = new THREE.Group();
  const m = new THREE.Mesh(new THREE.ConeGeometry(base / Math.SQRT2, h, 4), M(0xc9a96e)); m.position.y = h / 2; m.rotation.y = Math.PI / 4; g.add(m);
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
  { id: 'cristo', name: 'Cristo Redentor', lat: -22.95192, lon: -43.21049, r: 25, rot: 15, build: cristo },
  { id: 'eiffel', name: 'Torre Eiffel', lat: 48.85837, lon: 2.29448, r: 75, rot: 45, build: eiffel },
  { id: 'liberdade', name: 'Estátua da Liberdade', lat: 40.68925, lon: -74.0445, r: 60, rot: -35, build: liberty },
  { id: 'bigben', name: 'Big Ben', lat: 51.50073, lon: -0.12463, r: 18, rot: 10, build: bigben },
  { id: 'eye', name: 'London Eye', lat: 51.50329, lon: -0.11955, r: 45, rot: 65, build: eye },
  { id: 'burj', name: 'Burj Khalifa', lat: 25.1972, lon: 55.27438, r: 70, rot: 0, build: burj },
  { id: 'quéops', name: 'Pirâmide de Quéops', lat: 29.97923, lon: 31.13423, r: 140, rot: 0, build: () => pyramid(230, 139) },
  { id: 'quéfren', name: 'Pirâmide de Quéfren', lat: 29.97611, lon: 31.13077, r: 130, rot: 0, build: () => pyramid(215, 136) },
  { id: 'miquerinos', name: 'Pirâmide de Miquerinos', lat: 29.97252, lon: 31.12825, r: 70, rot: 0, build: () => pyramid(105, 65) },
  { id: 'taj', name: 'Taj Mahal', lat: 27.17515, lon: 78.04215, r: 75, rot: 0, build: taj },
  { id: 'empire', name: 'Empire State', lat: 40.74844, lon: -73.98566, r: 75, rot: 29, build: empire },
  { id: 'cn', name: 'CN Tower', lat: 43.64257, lon: -79.38706, r: 40, rot: 0, build: cntower },
  { id: 'skytree', name: 'Tokyo Skytree', lat: 35.71006, lon: 139.8107, r: 50, rot: 0, build: skytree },
  { id: 'washington', name: 'Monumento a Washington', lat: 38.88948, lon: -77.03528, r: 25, rot: 0, build: washington },
  { id: 'arch', name: 'Gateway Arch', lat: 38.62469, lon: -90.18478, r: 110, rot: 80, build: arch },
];

export class Landmarks {
  constructor(scene, frame, terrain, world) {
    this.frame = frame; this.terrain = terrain;
    this.group = new THREE.Group(); scene.add(this.group);
    this.items = LANDMARKS.map((L) => ({ ...L, mx: lonToMx(L.lon), my: latToMy(L.lat), obj: null, h: null, hz: -1, dist: Infinity }));
    world.exclude = this.items.map((i) => ({ mx: i.mx, my: i.my, r: i.r }));
    world.extraLabels = this.items.map((i) => ({ name: i.name, cls: 'landmark', mx: i.mx, my: i.my, rank: 0, range: 45e3, ele: 0, lm: i }));
    this.labels = world.extraLabels;
  }
  update(C) {
    const f = this.frame;
    for (let n = 0; n < this.items.length; n++) {
      const it = this.items[n];
      const p = f.toLocal(it.lat, it.lon);
      const dx = p.x - C.x, dz = p.z - C.z, d = Math.hypot(dx, dz);
      it.dist = d;
      if (d > 60000) { if (it.obj) it.obj.visible = false; continue; }
      if (!it.obj) { it.obj = it.build(); it.obj.rotation.y = -(it.rot || 0) * Math.PI / 180; this.group.add(it.obj); }
      if (it.hz < 13) { const g = this.terrain.heightAt(p.x, p.z); if (g.ok && g.z > it.hz) { it.h = g.h; it.hz = g.z; this.labels[n].ele = g.h + 60; this.labels[n].h = null; } }
      it.obj.visible = it.h != null;
      it.obj.position.set(dx, (it.h || 0) - 0.8 - (d * d) / (2 * RE), dz);
    }
  }
}
