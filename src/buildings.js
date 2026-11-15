// Prédios 3D a partir do OpenStreetMap (Overpass API), extrudados sobre o relevo real.
import * as THREE from 'three';
import { tileSize, tileMinX, tileMaxY, MERC_MAX, lonToMx, latToMy, mulberry } from './geo.js';

const Z = 15;
const SERVERS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
const s2l = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const WALLS = [[0.86, 0.83, 0.77], [0.93, 0.92, 0.89], [0.78, 0.71, 0.62], [0.88, 0.82, 0.73], [0.74, 0.74, 0.76], [0.82, 0.76, 0.7]].map((c) => c.map(s2l));
const ROOFS = [[0.33, 0.32, 0.33], [0.48, 0.3, 0.24], [0.42, 0.42, 0.45], [0.55, 0.5, 0.45]].map((c) => c.map(s2l));

export class Buildings {
  constructor(scene, frame, terrain) {
    this.scene = scene; this.frame = frame; this.terrain = terrain;
    this.cells = new Map(); this.inflight = 0; this.next = 0; this.server = 0; this.on = true; this.snowRoof = false;
    this.mat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
    this.group = new THREE.Group(); scene.add(this.group);
    this.failStreak = 0;
  }
  clear() { for (const c of this.cells.values()) this.disposeCell(c); this.cells.clear(); }
  disposeCell(c) { if (c.mesh) { this.group.remove(c.mesh); c.mesh.geometry.dispose(); c.mesh = null; } c.dead = true; }
  update(C, agl) {
    const f = this.frame;
    const show = this.on && agl < 4500;
    this.group.visible = show;
    if (!show) return;
    const mx = f.localToMx(C.x), my = f.localToMy(C.z);
    const ts = tileSize(Z), n = 2 ** Z;
    const cx = Math.floor((mx + MERC_MAX) / ts), cy = Math.floor((MERC_MAX - my) / ts);
    const R = agl < 1500 ? 2 : 1;
    const want = [];
    for (let j = -R; j <= R; j++) for (let i = -R; i <= R; i++) want.push([cx + i, cy + j, i * i + j * j]);
    want.sort((a, b) => a[2] - b[2]);
    const now = performance.now();
    for (const [x, y] of want) {
      const key = x + '/' + y;
      let c = this.cells.get(key);
      if (!c) {
        if (this.inflight > 0 || now < this.next) continue;
        c = { x, y, key, state: 'loading', data: null, mesh: null };
        this.cells.set(key, c);
        this.load(c);
      }
      if (c.state === 'data') this.build(c);
    }
    for (const c of this.cells.values()) {
      const far = Math.abs(c.x - cx) > R + 2 || Math.abs(c.y - cy) > R + 2;
      if (far && c.state !== 'loading') { this.disposeCell(c); this.cells.delete(c.key); continue; }
      if (c.mesh) {
        c.mesh.position.set(f.mercToLocalX(c.amx) - C.x, 0, f.mercToLocalZ(c.amy) - C.z);
        const s = f.k / c.k; c.mesh.scale.set(s, 1, s);
      }
    }
  }
  async load(c) {
    this.inflight++;
    const n = 2 ** Z, ts = tileSize(Z);
    const wx = ((c.x % n) + n) % n;
    const w = (tileMinX(Z, wx) / 6378137) * 57.29578, e = (tileMinX(Z, wx + 1) / 6378137) * 57.29578;
    const nn = (2 * Math.atan(Math.exp(tileMaxY(Z, c.y) / 6378137)) - Math.PI / 2) * 57.29578;
    const s = (2 * Math.atan(Math.exp(tileMaxY(Z, c.y + 1) / 6378137)) - Math.PI / 2) * 57.29578;
    const q = `[out:json][timeout:20];way["building"](${s.toFixed(6)},${w.toFixed(6)},${nn.toFixed(6)},${e.toFixed(6)});out geom qt 4000;`;
    try {
      const r = await fetch(SERVERS[this.server], { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
      if (!r.ok) throw new Error('overpass ' + r.status);
      const d = await r.json();
      c.data = d.elements || []; c.state = c.dead ? 'dead' : 'data';
      this.failStreak = 0;
      this.next = performance.now() + 600;
    } catch (err) {
      this.failStreak++;
      this.server = (this.server + 1) % SERVERS.length;
      this.cells.delete(c.key);
      this.next = performance.now() + Math.min(2000 * this.failStreak, 20000);
    } finally { this.inflight--; }
  }
  build(c) {
    const f = this.frame, T = this.terrain;
    // precisa do relevo carregado no centro da célula
    const ts = tileSize(Z);
    c.amx = tileMinX(Z, c.x); c.amy = tileMaxY(Z, c.y); c.k = f.k;
    const ax = f.mercToLocalX(c.amx), az = f.mercToLocalZ(c.amy);
    const probe = T.heightAt(ax + ts * f.k * 0.5, az + ts * f.k * 0.5);
    if (!probe.ok || probe.z < 11) return;
    const pos = [], col = [];
    const rnd = mulberry(c.x * 31 + c.y * 17);
    const k = f.k;
    for (const el of c.data) {
      const g = el.geometry; if (!g || g.length < 4) continue;
      const pts = [];
      for (const p of g) pts.push([(lonToMx(p.lon) - c.amx) * k, -(latToMy(p.lat) - c.amy) * k]);
      const fst = pts[0], lst = pts[pts.length - 1];
      if (fst[0] === lst[0] && fst[1] === lst[1]) pts.pop();
      if (pts.length < 3) continue;
      const t = el.tags || {};
      let h = parseFloat(t.height);
      const lv = parseFloat(t['building:levels']);
      if (!(h > 0)) h = lv > 0 ? lv * 3.1 + 1.5 : (t.building === 'house' || t.building === 'detached' ? 6.5 : t.building === 'garage' || t.building === 'shed' ? 3 : 8 + rnd() * 6);
      let minH = parseFloat(t.min_height) || 0;
      let gmin = Infinity, gmax = -Infinity;
      for (const p of pts) { const gh = T.heightAt(ax + p[0], az + p[1]).h; gmin = Math.min(gmin, gh); gmax = Math.max(gmax, gh); }
      const base = gmin - 1.5 + minH, top = gmax + h;
      const wc = WALLS[Math.floor(rnd() * WALLS.length)], rc = this.snowRoof ? [0.8, 0.82, 0.86] : ROOFS[Math.floor(rnd() * ROOFS.length)];
      const shade = 0.85 + rnd() * 0.3;
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i], b = pts[(i + 1) % pts.length];
        pos.push(a[0], base, a[1], b[0], base, b[1], b[0], top, b[1], a[0], base, a[1], b[0], top, b[1], a[0], top, a[1]);
        for (let v = 0; v < 6; v++) col.push(wc[0] * shade, wc[1] * shade, wc[2] * shade);
      }
      const contour = pts.map((p) => new THREE.Vector2(p[0], p[1]));
      let tris;
      try { tris = THREE.ShapeUtils.triangulateShape(contour, []); } catch (e) { tris = []; }
      for (const tr of tris) for (const ii of tr) { pos.push(pts[ii][0], top, pts[ii][1]); col.push(rc[0], rc[1], rc[2]); }
    }
    c.state = 'built'; c.data = null;
    if (!pos.length) return;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, this.mat);
    m.frustumCulled = false;
    c.mesh = m; this.group.add(m);
  }
}
