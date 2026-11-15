// Mundo vetorial (OpenStreetMap via OpenFreeMap): casas e prédios 3D com janelas, lagos e rios com água de verdade,
// e nomes de bairros, cidades, picos e lagos flutuando sobre o cenário.
import * as THREE from 'three';
import { ATMO_GLSL } from './atmosphere.js';
import { decodeMVT, toPolygons } from './mvt.js';
import { PMTiles, FetchSource } from './vendor/pmtiles.js';
import { makeMaterials, propGeometries, lin } from './scenery.js';
import { tileSize, tileMinX, tileMaxY, MERC_MAX, RE, mulberry, clamp } from './geo.js';

const s2l = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const DZ = 14;
const SW = 1.6, RC = 16; // largura da calçada (m); célula da grade de ruas (m)
const DOORS = [[0.36, 0.22, 0.13], [0.2, 0.3, 0.24], [0.16, 0.22, 0.36], [0.55, 0.52, 0.48], [0.42, 0.12, 0.1]].map((c) => c.map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)));
const CG = 5; // cada tile de detalhe é dividido em CG×CG quarteirões de prédios
const OV_CATALOG = 'https://stac.overturemaps.org/catalog.json';
const OV_KEYS = ['height', 'num_floors', 'min_height', 'is_underground', 'has_parts', 'roof_color', 'facade_color', 'class'];
const hex2lin = (h) => { const m = /^#?([0-9a-f]{6})$/i.exec(h || ''); if (!m) return null; const n = parseInt(m[1], 16); return [s2l((n >> 16) / 255), s2l(((n >> 8) & 255) / 255), s2l((n & 255) / 255)]; };
const inRing = (r, x, z) => { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const a = r[i], b = r[j]; if ((a[1] > z) !== (b[1] > z) && x < ((b[0] - a[0]) * (z - a[1])) / (b[1] - a[1]) + a[0]) c = !c; } return c; };
const TILEJSON = 'https://tiles.openfreemap.org/planet';
const WALLS = [[0.86, 0.83, 0.77], [0.93, 0.92, 0.89], [0.78, 0.71, 0.62], [0.88, 0.82, 0.73], [0.74, 0.74, 0.76], [0.82, 0.76, 0.7], [0.9, 0.86, 0.78]].map((c) => c.map(s2l));
const GLASS = [[0.5, 0.56, 0.62], [0.62, 0.64, 0.66], [0.42, 0.46, 0.52], [0.7, 0.68, 0.62], [0.55, 0.5, 0.46]].map((c) => c.map(s2l));
const ROOFS = [[0.36, 0.34, 0.34], [0.52, 0.31, 0.24], [0.44, 0.44, 0.47], [0.58, 0.36, 0.27], [0.3, 0.3, 0.32]].map((c) => c.map(s2l));
const RANGE = { landmark: 45e3, continent: 0, country: 0, state: 0, city: 260e3, town: 70e3, village: 22e3, suburb: 9e3, quarter: 7e3, neighbourhood: 4500, hamlet: 4500, isolated_dwelling: 1500, peak: 30e3, lake: 6000 };
const WEIGHT = { landmark: 6, city: 7, town: 4.5, peak: 3.2, village: 3, suburb: 2.6, quarter: 2.3, lake: 1.4, neighbourhood: 2, hamlet: 1.8, isolated_dwelling: 1 };

const WATER_VERT = /* glsl */`
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec3 vRel; varying vec2 vP;
uniform float uCamAltW;
void main(){
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vRel = wp.xyz - vec3(0.0, uCamAltW, 0.0);
  vP = position.xz;
  gl_Position = projectionMatrix * viewMatrix * wp;
  #include <logdepthbuf_vertex>
}`;
const WATER_FRAG = /* glsl */`
#include <common>
#include <logdepthbuf_pars_fragment>
${ATMO_GLSL}
uniform float uTime; uniform vec3 uMoon; uniform float uFrozen;
varying vec3 vRel; varying vec2 vP;
float h21(vec2 p){ p = fract(p*vec2(123.34, 456.21)); p += dot(p, p+45.32); return fract(p.x*p.y); }
float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(h21(i), h21(i+vec2(1,0)), f.x), mix(h21(i+vec2(0,1)), h21(i+vec2(1,1)), f.x), f.y); }
void main(){
  #include <logdepthbuf_fragment>
  float L = length(vRel);
  vec3 V = -vRel / L;
  vec2 q = vP*0.18 + vec2(uTime*0.35, uTime*0.22);
  float amp = 0.1 * (1.0 - smoothstep(300.0, 2500.0, L)) * (1.0 - uFrozen) + 0.015;
  vec3 n = normalize(vec3((vn(q) - 0.5)*amp + (vn(q*3.1 + 7.0) - 0.5)*amp*0.6, 1.0, (vn(q + 31.7) - 0.5)*amp + (vn(q*3.1 + 19.0) - 0.5)*amp*0.6));
  float fres = 0.03 + 0.97*pow(1.0 - max(dot(V, n), 0.0), 5.0);
  vec3 ts = sunTransmit(uCamAlt, uSunDir.y) * (1.0 - 0.78*uOvercast);
  vec3 deep = mix(vec3(0.015, 0.06, 0.075), vec3(0.55, 0.6, 0.66), uFrozen) * (ts*SUNK*(0.3 + 0.7*max(uSunDir.y, 0.0)) + uAmbient + uMoon);
  vec3 skyc = uAmbient*1.5 + ts*0.15 + uMoon;
  vec3 R = reflect(-V, n);
  float sd = max(dot(R, uSunDir), 0.0);
  vec3 col = mix(deep, skyc, fres*(1.0 - 0.7*uFrozen)) + ts*SUNK*(pow(sd, 400.0)*40.0 + pow(sd, 30.0)*0.35)*(1.0 - uOvercast)*(1.0 - 0.8*uFrozen);
  gl_FragColor = vec4(col, mix(0.78, 0.96, fres));
}`;

export class World {
  constructor(scene, frame, terrain, G, camera) {
    this.scene = scene; this.frame = frame; this.terrain = terrain; this.G = G; this.camera = camera;
    this.cells = new Map(); this.inflight = 0; this.template = null; this.failed = false; this.on = true; this.labelsOn = true;
    this.radius = 1; this.snowRoof = false; this.night = { value: 0 }; this.pm = null; this.bDist = 900; this.pDist = 300;
    this.group = new THREE.Group(); scene.add(this.group);
    this.time = { value: 0 };
    this.props = propGeometries();
    this.setQuality('media');
    this.exclude = []; this.extraLabels = [];
    this.wMat = new THREE.ShaderMaterial({ vertexShader: WATER_VERT, fragmentShader: WATER_FRAG, transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, side: THREE.DoubleSide,
      uniforms: { ...G, uCamAltW: G.uCamAlt, uFrozen: { value: 0 } } });
    // rótulos em DOM
    this.labelEl = document.getElementById('labels');
    this.pool = [];
    for (let i = 0; i < 16; i++) { const d = document.createElement('div'); d.className = 'wl'; d.style.display = 'none'; this.labelEl?.appendChild(d); this.pool.push({ el: d, lab: null }); }
    this.active = []; this.tick = 0; this.v = new THREE.Vector3();
    this.init();
  }
  // materiais por qualidade: troca nos objetos já criados sem reconstruir a geometria
  setQuality(q) {
    this.quality = q;
    const old = this.mats;
    this.mats = makeMaterials(q, { night: this.night, time: this.time });
    this.shadows = q !== 'baixa';
    this.group.traverse((o) => { if (o.isMesh && o.userData.mat) { o.material = this.mats[o.userData.mat]; o.castShadow = this.shadows && o.userData.cast; o.receiveShadow = this.shadows; } });
    if (old) for (const m of Object.values(old)) m.dispose();
  }
  mesh(geo, mat, cast) { const m = new THREE.Mesh(geo, this.mats[mat]); m.userData.mat = mat; m.userData.cast = !!cast; m.castShadow = this.shadows && !!cast; m.receiveShadow = this.shadows; return m; }
  async init() {
    // prédios do mundo inteiro (OSM + contornos detectados por satélite): Overture Maps, release mais recente
    this.pmReady = (async () => {
      try {
        const cat = await (await fetch(OV_CATALOG)).json();
        let url = null;
        try { const bc = await (await fetch(`https://stac.overturemaps.org/${cat.latest}/buildings/catalog.json`)).json(); url = bc.links.find((l) => l.rel === 'pmtiles')?.href; } catch (e) { /* tenta o padrão */ }
        url = url || `https://tiles.overturemaps.org/${cat.latest}/buildings.pmtiles`;
        const pm = new PMTiles(new FetchSource(url));
        await pm.getHeader();
        this.pm = pm;
      } catch (e) { this.pm = null; }
      return this.pm;
    })();
    try {
      const r = await fetch(TILEJSON); if (!r.ok) throw 0;
      const j = await r.json();
      this.template = j.tiles[0];
    } catch (e) { this.failed = true; }
  }
  clear() { for (const c of this.cells.values()) this.disposeCell(c); this.cells.clear(); }
  disposeCell(c) { c.dead = true; for (const m of c.meshes || []) { this.group.remove(m); if (!m.isInstancedMesh) m.geometry.dispose(); else m.dispose(); } for (const g of c.pgroups || []) this.physics?.removeGroup(g); if (c.chunks) for (const ch of c.chunks) this.physics?.removeGroup(ch.pg); c.meshes = []; c.pgroups = []; c.labels = []; c.chunks = null; c.waterPolys = null; c.segs = null; c.roadGrid = null; }
  wantCell(z, x, y, detail) {
    const n = 2 ** z; if (y < 0 || y >= n) return null;
    const key = z + '/' + x + '/' + y;
    let c = this.cells.get(key);
    if (!c) {
      if (this.inflight >= 3) return null;
      c = { z, x, y, key, detail, state: 'loading', meshes: [], labels: [], amx: tileMinX(z, x), amy: tileMaxY(z, y) };
      this.cells.set(key, c); this.load(c);
    }
    c.used = this.tick;
    return c;
  }
  async load(c) {
    this.inflight++;
    try {
      const n = 2 ** c.z, wx = ((c.x % n) + n) % n;
      const r = await fetch(this.template.replace('{z}', c.z).replace('{x}', wx).replace('{y}', c.y));
      if (r.status === 204 || r.status === 404) { c.state = 'built'; return; }
      if (!r.ok) throw new Error('mvt ' + r.status);
      const buf = new Uint8Array(await r.arrayBuffer());
      let ov = null;
      if (c.detail) {
        const pm = await Promise.race([this.pmReady, new Promise((res) => setTimeout(() => res(null), 7000))]);
        if (pm) try { const t = await pm.getZxy(c.z, wx, c.y); if (t && t.data) ov = decodeMVT(new Uint8Array(t.data), ['building', 'building_part'], OV_KEYS); } catch (e) { ov = null; }
      }
      c.layers = decodeMVT(buf, c.detail ? [ov ? '-' : 'building', 'water', 'waterway', 'transportation', 'place', 'mountain_peak', 'water_name'] : ['place', 'mountain_peak', 'water_name']);
      if (ov) c.layers.ov = ov;
      this.readLabels(c);
      c.state = c.detail ? 'data' : 'built';
      if (!c.detail) c.layers = null;
    } catch (e) { c.state = 'fail'; c.retry = performance.now() + 8000; }
    finally { this.inflight--; }
  }
  readLabels(c) {
    const ts = tileSize(c.z);
    const add = (L, kind) => {
      if (!L) return;
      for (const f of L.features) {
        const p = f.props, g = f.geom[0]; if (!g || !p.name) continue;
        let cls = kind || p.class;
        if (kind === 'peak' && p.class !== 'peak' && p.class !== 'volcano') continue;
        if (!(RANGE[cls] > 0)) continue;
        if (!c.detail && !(cls === 'city' || cls === 'town' || cls === 'peak' || (cls === 'village' && c.z >= 9))) continue;
        if (c.detail && (cls === 'city' || cls === 'town')) continue; // vêm dos tiles de visão geral
        if (c.z < 8 && cls !== 'city') continue;
        const pt = g[Math.floor(g.length / 2)];
        if (pt[0] < 0 || pt[1] < 0 || pt[0] >= L.extent || pt[1] >= L.extent) continue;
        const name = p['name:pt'] || p['name:latin'] || p.name;
        c.labels.push({ name: kind === 'peak' && p.ele ? `${name} · ${Math.round(p.ele)} m` : name, cls, ele: kind === 'peak' ? +p.ele || 0 : null, rank: p.rank || 9,
          mx: c.amx + (pt[0] / L.extent) * ts, my: c.amy - (pt[1] / L.extent) * ts, range: RANGE[cls] * (cls === 'peak' && p.rank <= 1 ? 2.5 : 1) * (cls === 'city' && c.z < 8 ? 12 : 1) });
      }
    };
    add(c.layers.place); add(c.layers.mountain_peak, 'peak'); add(c.layers.water_name, 'lake');
  }
  build(c) {
    const f = this.frame, T = this.terrain, k = f.k;
    const ts = tileSize(c.z), sizeL = ts * k;
    const ax = f.mercToLocalX(c.amx), az = f.mercToLocalZ(c.amy);
    // ruas, calçadas e casas são assentadas no relevo: só constrói com o relevo definitivo (zoom 13) carregado,
    // senão ficariam enterradas ou flutuando quando o relevo detalhado chegasse
    const probe = T.heightAt(ax + sizeL * 0.5, az + sizeL * 0.5);
    if (!probe.ok || probe.z < 13) { T.needElev(ax + sizeL * 0.5, az + sizeL * 0.5); return false; }
    c.k = k;
    const H = (x, z) => T.heightAt(ax + x, az + z).h;
    const rnd = mulberry(c.x * 31 + c.y * 17);
    // ---- prédios: só registra os contornos por quarteirão; a malha 3D é criada quando o jogador chega perto ----
    c.chunks = [];
    for (let i = 0; i < CG * CG; i++) c.chunks.push({ recs: [], mesh: null, fp: null, cx: ((i % CG) + 0.5) * sizeL / CG, cz: (Math.floor(i / CG) + 0.5) * sizeL / CG });
    const addB = (L, ov) => {
      if (!L) return;
      const s = sizeL / L.extent;
      for (const ft of L.features) {
        const pr = ft.props;
        if (pr.hide_3d || pr.is_underground || (ov && pr.has_parts && L.name === 'building')) continue;
        const h = ov ? +pr.height || (pr.num_floors > 0 ? pr.num_floors * 3.1 + 1 : 0) : +pr.render_height || 0;
        const minH = ov ? +pr.min_height || 0 : +pr.render_min_height || 0;
        for (const poly of toPolygons(ft.geom)) {
          const rings = [poly.outer, ...poly.holes].map((r) => r.map((p) => [p[0] * s, p[1] * s]));
          const outer = rings[0];
          const area = poly.area * s * s;
          if (outer.length < 3 || area < 7) continue;
          let cx = 0, cz = 0;
          for (const p of outer) { cx += p[0]; cz += p[1]; }
          cx /= outer.length; cz /= outer.length;
          if (cx < 0 || cz < 0 || cx >= sizeL || cz >= sizeL) continue; // fica com o tile vizinho
          if (this.exclude.some((e) => Math.hypot((c.amx + cx / k - e.mx) * k, (c.amy - cz / k - e.my) * k) < e.r)) continue;
          c.chunks[Math.min(CG - 1, Math.floor(cx / sizeL * CG)) + CG * Math.min(CG - 1, Math.floor(cz / sizeL * CG))].recs.push({ rings, area, h, minH, cx, cz, fc: hex2lin(pr.facade_color), rc: hex2lin(pr.roof_color) });
        }
      }
    };
    if (c.layers.ov) { addB(c.layers.ov.building, true); addB(c.layers.ov.building_part, true); } else addB(c.layers.building, false);
    c.recGrid = new Map();
    for (const ch of c.chunks) for (const r of ch.recs) {
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      for (const p of r.rings[0]) { if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; if (p[1] < z0) z0 = p[1]; if (p[1] > z1) z1 = p[1]; }
      for (let gz = Math.floor((z0 - 1.5) / 32); gz <= Math.floor((z1 + 1.5) / 32); gz++) for (let gx = Math.floor((x0 - 1.5) / 32); gx <= Math.floor((x1 + 1.5) / 32); gx++) { const key = gx * 4096 + gz; let a = c.recGrid.get(key); if (!a) c.recGrid.set(key, (a = [])); a.push(r); }
    }
    // ---- água: lagos, rios, canais ----
    const wpos = [];
    const W = c.layers.water;
    if (W) {
      const s = sizeL / W.extent;
      for (const ft of W.features) {
        if (ft.props.class === 'swimming_pool' || ft.props.intermittent === 1) continue;
        const ocean = ft.props.class === 'ocean'; // o mar já é desenhado pelo terreno; aqui só serve para saber onde se nada
        for (const poly of toPolygons(ft.geom)) {
          const rings = [poly.outer, ...poly.holes].map((r) => r.map((p) => [clamp(p[0], -64, W.extent + 64) * s, clamp(p[1], -64, W.extent + 64) * s]));
          const flat = rings.flat();
          let tris = [];
          if (!ocean) try { tris = THREE.ShapeUtils.triangulateShape(rings[0].map((p) => new THREE.Vector2(p[0], p[1])), rings.slice(1).map((r) => r.map((p) => new THREE.Vector2(p[0], p[1])))); } catch (e) { /* ignora */ }
          const lake = ft.props.class !== 'river' && !ocean;
          let lvl = Infinity;
          if (lake) for (const p of rings[0]) lvl = Math.min(lvl, H(p[0], p[1]));
          let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
          for (const p of rings[0]) { if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; if (p[1] < z0) z0 = p[1]; if (p[1] > z1) z1 = p[1]; }
          (c.waterPolys ||= []).push({ x0, x1, z0, z1, rings, level: lake ? lvl + 0.7 : null, ocean });
          for (const tr of tris) for (const ii of tr) { const p = flat[ii]; if (!p) continue; wpos.push(p[0], (lake ? lvl : H(p[0], p[1])) + 0.7, p[1]); }
        }
      }
    }
    const WW = c.layers.waterway;
    if (WW) {
      const s = sizeL / WW.extent;
      for (const ft of WW.features) {
        const cl = ft.props.class;
        if (ft.props.brunnel === 'tunnel' || ft.props.intermittent === 1) continue;
        const hw = cl === 'river' ? 5 : cl === 'canal' ? 4 : cl === 'stream' ? 1.3 : 0;
        if (!hw) continue;
        for (const line of ft.geom) {
          for (let i = 0; i < line.length - 1; i++) {
            const a = [line[i][0] * s, line[i][1] * s], b = [line[i + 1][0] * s, line[i + 1][1] * s];
            const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz); if (l < 0.01) continue;
            const nx = (-dz / l) * hw, nz = (dx / l) * hw;
            const ha = H(a[0], a[1]) + 0.6, hb = H(b[0], b[1]) + 0.6;
            wpos.push(a[0] - nx, ha, a[1] - nz, a[0] + nx, ha, a[1] + nz, b[0] + nx, hb, b[1] + nz, a[0] - nx, ha, a[1] - nz, b[0] + nx, hb, b[1] + nz, b[0] - nx, hb, b[1] - nz);
          }
        }
      }
    }
    // ---- ruas, estradas, pontes e trilhos; calçadas com meio-fio; postes, bancos e placas ----
    const TR = c.layers.transportation;
    c.segs = []; c.roadGrid = new Map(); c.pgroups = [];
    const items = []; // colisores dos elementos da célula
    const gridAdd = (i, sg) => { const m = sg.hw + SW + 0.5; for (let gz = Math.floor((Math.min(sg.az, sg.bz) - m) / RC); gz <= Math.floor((Math.max(sg.az, sg.bz) + m) / RC); gz++) for (let gx = Math.floor((Math.min(sg.ax, sg.bx) - m) / RC); gx <= Math.floor((Math.max(sg.ax, sg.bx) + m) / RC); gx++) { const key = gx * 4096 + gz; let a = c.roadGrid.get(key); if (!a) c.roadGrid.set(key, (a = [])); a.push(i); } };
    // área urbana: há construção a menos de ~40 m
    const occ = new Set();
    for (const ch of c.chunks) for (const r of ch.recs) { const gx = Math.floor(r.cx / 32), gz = Math.floor(r.cz / 32); for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) occ.add((gx + dx) * 4096 + gz + dz); }
    const urban = (x, z) => occ.has(Math.floor(x / 32) * 4096 + Math.floor(z / 32));
    if (TR) {
      const s = sizeL / TR.extent;
      const RW = { motorway: 6.5, trunk: 5.5, primary: 4.8, secondary: 4.2, tertiary: 3.6, minor: 2.9, service: 1.8, busway: 3, rail: 1.3 };
      const lines = [];
      for (const ft of TR.features) {
        const p = ft.props, cl = p.class;
        const hw = RW[cl];
        if (!hw || ft.type !== 2 || p.brunnel === 'tunnel') continue;
        if (cl === 'rail' && p.subclass && p.subclass !== 'rail') continue;
        const bridge = p.brunnel === 'bridge';
        const mark = cl === 'rail' ? 0 : hw >= 5.5 ? 2 : hw >= 3.6 ? 1 : 0;
        const g0 = cl === 'rail' ? 0.05 : cl === 'service' ? 0.085 : 0.06 + (c.x * 7 + c.y) % 3 * 0.004;
        for (const line of ft.geom) {
          const pts = []; // reamostra para acompanhar o relevo
          for (let i = 0; i < line.length; i++) {
            const a = [line[i][0] * s, line[i][1] * s];
            if (i > 0) { const b = pts[pts.length - 1], l = Math.hypot(a[0] - b[0], a[1] - b[1]), n = Math.min(Math.ceil(l / 26), 40); for (let q = 1; q < n; q++) pts.push([b[0] + (a[0] - b[0]) * q / n, b[1] + (a[1] - b[1]) * q / n]); }
            pts.push(a);
          }
          if (pts.length < 2) continue;
          const cum = [0];
          for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
          const tot = cum[cum.length - 1]; if (tot < 1) continue;
          const h0 = H(pts[0][0], pts[0][1]), h1 = H(pts[pts.length - 1][0], pts[pts.length - 1][1]);
          const ys = [], ns = [];
          for (let i = 0; i < pts.length; i++) {
            const a = pts[Math.max(i - 1, 0)], b = pts[Math.min(i + 1, pts.length - 1)];
            const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1;
            ns.push([-dz / l, dx / l]);
            const t = cum[i] / tot;
            let y = H(pts[i][0], pts[i][1]) + 0.4;
            if (bridge) y = Math.max(y, h0 + (h1 - h0) * t + Math.sin(Math.PI * t) * Math.min(tot * 0.035, 30) + 1.2);
            ys.push(y);
          }
          const L = { pts, cum, ys, ns, hw, cl, mark, g0, bridge, li: lines.length, s0: c.segs.length };
          for (let i = 0; i < pts.length - 1; i++) { const sg = { ax: pts[i][0], az: pts[i][1], bx: pts[i + 1][0], bz: pts[i + 1][1], ya: ys[i], yb: ys[i + 1], hw, li: L.li, rail: cl === 'rail' }; gridAdd(c.segs.push(sg) - 1, sg); }
          lines.push(L);
        }
      }
      const rp = [], rc = [], ru = [], rt = [], walks = {};
      const quad = (P, a, b, d, e) => P.push(a[0], a[1], a[2], b[0], b[1], b[2], d[0], d[1], d[2], a[0], a[1], a[2], d[0], d[1], d[2], e[0], e[1], e[2]);
      const lamps = [], benches = [], signs = [];
      const cs = lin(0.6, 0.59, 0.56), cc = lin(0.72, 0.71, 0.68), ce = lin(0.4, 0.4, 0.39);
      const inTile = (x, z) => x >= 0 && z >= 0 && x < sizeL && z < sizeL;
      for (const L of lines) {
        const { pts, cum, ys, ns, hw, mark, g0 } = L, n = pts.length;
        const E = (i, off, dy) => [pts[i][0] + ns[i][0] * off, ys[i] + dy, pts[i][1] + ns[i][1] * off];
        for (let i = 0; i < n - 1; i++) { // pista + taludes laterais
          quad(rp, E(i, -hw, 0), E(i, hw, 0), E(i + 1, hw, 0), E(i + 1, -hw, 0));
          ru.push(-1, cum[i], mark, 1, cum[i], mark, 1, cum[i + 1], mark, -1, cum[i], mark, 1, cum[i + 1], mark, -1, cum[i + 1], mark);
          rt.push(0, cum[i] / 4, hw / 2, cum[i] / 4, hw / 2, cum[i + 1] / 4, 0, cum[i] / 4, hw / 2, cum[i + 1] / 4, 0, cum[i + 1] / 4);
          for (let v = 0; v < 6; v++) rc.push(g0, g0, g0 * 1.06);
          for (const sd of [-1, 1]) {
            quad(rp, E(i, sd * hw, 0), E(i, sd * (hw + 0.5), -0.75), E(i + 1, sd * (hw + 0.5), -0.75), E(i + 1, sd * hw, 0));
            for (let v = 0; v < 6; v++) { ru.push(0, 0, 0); rt.push(0, 0); rc.push(g0 * 0.7, g0 * 0.68, g0 * 0.62); }
          }
        }
        if (L.bridge || !(L.cl === 'minor' || L.cl === 'tertiary' || L.cl === 'secondary' || L.cl === 'primary')) continue;
        const ph = ((L.li * 7919) % 36);
        for (const sd of [-1, 1]) for (let i = 0; i < n - 1; i++) {
          // ponto da calçada no trecho i: t ao longo do trecho, off = distância do eixo da rua, dy = altura sobre a pista
          const SP = (t, off, dy) => [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t + sd * (ns[i][0] + (ns[i + 1][0] - ns[i][0]) * t) * off, ys[i] + (ys[i + 1] - ys[i]) * t + dy, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t + sd * (ns[i][1] + (ns[i + 1][1] - ns[i][1]) * t) * off];
          const free = (t) => { const q = SP(t, hw + SW / 2, 0); return !this.roadNear(c, q[0], q[2], L.li, 0.35); };
          const mid = SP(0.5, hw + SW / 2, 0);
          if (!urban(mid[0], mid[2])) continue;
          // a calçada para antes das ruas que cruzam: o trecho é cortado em pedaços e só ficam os livres
          let pieces;
          if (free(0) && free(0.5) && free(1)) pieces = [[0, 1]];
          else {
            pieces = []; const np = Math.max(2, Math.ceil((cum[i + 1] - cum[i]) / 3));
            for (let q = 0; q < np; q++) { if (!(free(q / np) && free((q + 0.5) / np) && free((q + 1) / np))) continue; const last = pieces[pieces.length - 1]; if (last && last[1] === q / np) last[1] = (q + 1) / np; else pieces.push([q / np, (q + 1) / np]); }
            if (!pieces.length) continue;
          }
          c.segs[L.s0 + i][sd > 0 ? 'swR' : 'swL'] = pieces;
          const ci = Math.min(CG - 1, Math.max(0, Math.floor(mid[0] / sizeL * CG))) + CG * Math.min(CG - 1, Math.max(0, Math.floor(mid[2] / sizeL * CG)));
          const W = walks[ci] || (walks[ci] = { p: [], c: [], t: [] });
          for (const [t0, t1] of pieces) {
            const u0 = (cum[i] + (cum[i + 1] - cum[i]) * t0) / 2, u1 = (cum[i] + (cum[i + 1] - cum[i]) * t1) / 2;
            const a0 = SP(t0, hw, 0.15), a1 = SP(t0, hw + SW, 0.15), b0 = SP(t1, hw, 0.15), b1 = SP(t1, hw + SW, 0.15);
            quad(W.p, a0, a1, b1, b0); W.t.push(0, u0, SW / 2, u0, SW / 2, u1, 0, u0, SW / 2, u1, 0, u1);
            for (let v = 0; v < 6; v++) W.c.push(cs[0], cs[1], cs[2]);
            quad(W.p, SP(t0, hw, -0.02), a0, b0, SP(t1, hw, -0.02)); // meio-fio
            for (let v = 0; v < 6; v++) { W.c.push(cc[0], cc[1], cc[2]); W.t.push(0, 0); }
            quad(W.p, a1, SP(t0, hw + SW, -0.75), SP(t1, hw + SW, -0.75), b1); // borda externa até o terreno
            for (let v = 0; v < 6; v++) { W.c.push(ce[0], ce[1], ce[2]); W.t.push(0, 0); }
          }
          const has = (t) => pieces.some((r) => t >= r[0] && t <= r[1]);
          // postes (lado direito, a cada 36 m) e bancos (lado esquerdo, alguns quarteirões)
          const place = (t, off) => { const x = pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t, z = pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t, nx = ns[i][0], nz = ns[i][1]; return [x + sd * nx * off, ys[i] + (ys[i + 1] - ys[i]) * t + 0.15, z + sd * nz * off, Math.atan2(-sd * nx, -sd * nz)]; };
          const k0 = Math.floor((cum[i] + ph) / 36), k1 = Math.floor((cum[i + 1] + ph) / 36);
          if (sd > 0 && k1 > k0) { const tq = (k1 * 36 - ph - cum[i]) / (cum[i + 1] - cum[i]), q = place(tq, hw + SW - 0.3); if (has(tq) && inTile(q[0], q[2])) lamps.push(q); }
          const j0 = Math.floor((cum[i] + ph * 2) / 90), j1 = Math.floor((cum[i + 1] + ph * 2) / 90);
          if (sd < 0 && j1 > j0 && (L.li * 31 + j1 * 17) % 3 === 0) { const tq = (j1 * 90 - ph * 2 - cum[i]) / (cum[i + 1] - cum[i]), q = place(tq, hw + SW - 0.42); if (has(tq) && inTile(q[0], q[2])) benches.push(q); }
        }
        // placa de PARE onde a rua começa num cruzamento
        if ((L.cl === 'minor' || L.cl === 'tertiary') && cum[cum.length - 1] > 30 && urban(pts[0][0], pts[0][1]) && this.roadNear(c, pts[0][0], pts[0][1], L.li, 1.2)) {
          const t = Math.min(1, 6 / Math.max(cum[1], 0.1)), x = pts[0][0] + (pts[1][0] - pts[0][0]) * t, z = pts[0][1] + (pts[1][1] - pts[0][1]) * t, off = hw + 0.55;
          const q = [x + ns[0][0] * off, ys[0] + 0.15, z + ns[0][1] * off, Math.atan2(pts[1][0] - pts[0][0], pts[1][1] - pts[0][1])];
          if (inTile(q[0], q[2]) && !this.roadNear(c, q[0], q[2], L.li, 0.2)) signs.push(q);
        }
      }
      const mk = (P, C, U, mat, extra) => { if (!P.length) return; const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2)); if (extra) g.setAttribute('ruv', new THREE.Float32BufferAttribute(extra, 3)); g.computeVertexNormals(); const m = this.mesh(g, mat, false); m.renderOrder = 1; c.meshes.push(m); this.group.add(m); return m; };
      mk(rp, rc, rt, 'road', ru);
      // calçadas: uma malha por quarteirão, desenhada só perto do jogador
      for (const ci in walks) { const W = walks[ci]; const m = mk(W.p, W.c, W.t, 'walk'); if (m) { m.visible = false; (c.chunks[ci].props ||= []).push(m); } }
      // elementos instanciados: um draw call por tipo
      const inst = (geo, mat, list, cast) => { if (!list.length) return; const im = new THREE.InstancedMesh(geo, this.mats[mat], list.length); im.userData.mat = mat; im.userData.cast = cast; im.castShadow = this.shadows && cast; im.receiveShadow = false; const M4 = new THREE.Matrix4(), Q = new THREE.Quaternion(), UP = new THREE.Vector3(0, 1, 0), S1 = new THREE.Vector3(1, 1, 1), V = new THREE.Vector3(); list.forEach((q, i) => { Q.setFromAxisAngle(UP, q[3]); if (q[4]) S1.set(q[4], q[5], q[4]); im.setMatrixAt(i, M4.compose(V.set(q[0], q[1], q[2]), Q, S1)); if (q[6]) im.setColorAt(i, new THREE.Color(q[6][0], q[6][1], q[6][2])); }); im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere(); c.meshes.push(im); this.group.add(im); return im; };
      // postes, bancos e placas agrupados por quarteirão: só os próximos do jogador são desenhados
      const byChunk = (list) => { const m = new Map(); for (const q of list) { const i = Math.min(CG - 1, Math.max(0, Math.floor(q[0] / sizeL * CG))) + CG * Math.min(CG - 1, Math.max(0, Math.floor(q[2] / sizeL * CG))); let a = m.get(i); if (!a) m.set(i, (a = [])); a.push(q); } return m; };
      for (const [geo, mat, list, cast] of [[this.props.lamp, 'prop', lamps, true], [this.props.bulb, 'bulb', lamps, false], [this.props.bench, 'prop', benches, true], [this.props.sign, 'prop', signs, true]]) {
        for (const [ci, sub] of byChunk(list)) { const im = inst(geo, mat, sub, cast); if (im) { im.visible = false; (c.chunks[ci].props ||= []).push(im); } }
      }
      const id = (t, i) => `${t}:${c.x}/${c.y}:${i}`;
      lamps.forEach((q, i) => items.push({ t: 'c', x: q[0], z: q[2], r: 0.16, y0: q[1] - 1, y1: q[1] + 6.4, walk: false, tag: 'post', id: id('post', i), ax: q[0], az: q[2], ay: q[1] + 1.2 }));
      signs.forEach((q, i) => items.push({ t: 'c', x: q[0], z: q[2], r: 0.08, y0: q[1] - 1, y1: q[1] + 2.6, walk: false, tag: 'sign', id: id('sign', i), ax: q[0], az: q[2], ay: q[1] + 1.4 }));
      benches.forEach((q, i) => items.push({ t: 'b', x: q[0], z: q[2], hx: 0.82, hz: 0.26, c: Math.cos(q[3]), s: -Math.sin(q[3]), y0: q[1] - 0.5, y1: q[1] + 0.52, tag: 'bench', id: id('bench', i), ax: q[0], az: q[2], ay: q[1] + 0.7 }));
    }
    // ---- pedras em terreno natural inclinado (fora de ruas, casas e água) ----
    {
      const rocks = [], rr = mulberry(c.x * 131 + c.y * 71);
      for (let t = 0; t < 260 && rocks.length < 70; t++) {
        const x = rr() * sizeL, z = rr() * sizeL;
        if (urban(x, z) || this.roadNear(c, x, z, -1, 4)) continue;
        const h = H(x, z); if (h < 0.5) continue;
        const sl = Math.hypot(H(x + 3, z) - H(x - 3, z), H(x, z + 3) - H(x, z - 3)) / 6;
        if (sl < 0.14) continue;
        const col = T.colorAt(ax + x, az + z);
        if (col && (col[1] > col[0] * 1.06 && col[1] > col[2] || col[2] > col[0] * 1.3)) continue; // mata ou água
        const r = 0.4 + rr() * rr() * 1.7, g = col ? Math.min(1, 150 / Math.max(col[0], col[1], col[2], 1)) : 1;
        rocks.push([x, h - r * 0.12, z, rr() * 6.28, r, r * (0.65 + rr() * 0.4), col ? lin((col[0] * g + 30) / 255, (col[1] * g + 28) / 255, (col[2] * g + 26) / 255) : lin(0.5, 0.48, 0.45)]);
      }
      if (rocks.length) {
        const im = new THREE.InstancedMesh(this.props.rock, this.mats.rock, rocks.length); im.userData.mat = 'rock'; im.userData.cast = true; im.castShadow = this.shadows; im.receiveShadow = this.shadows;
        const M4 = new THREE.Matrix4(), Q = new THREE.Quaternion(), UP = new THREE.Vector3(0, 1, 0), V = new THREE.Vector3(), S1 = new THREE.Vector3();
        rocks.forEach((q, i) => { Q.setFromAxisAngle(UP, q[3]); im.setMatrixAt(i, M4.compose(V.set(q[0], q[1], q[2]), Q, S1.set(q[4], q[5], q[4]))); im.setColorAt(i, new THREE.Color(q[6][0], q[6][1], q[6][2])); items.push({ t: 'c', x: q[0], z: q[2], r: q[4] * 0.8, y0: q[1] - 1, y1: q[1] + q[5] * 0.85, tag: 'rock', id: `rock:${c.x}/${c.y}:${i}`, ax: q[0], az: q[2], ay: q[1] + q[5] }); });
        im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere(); c.meshes.push(im); this.group.add(im);
      }
    }
    if (items.length && this.physics) c.pgroups.push(this.physics.addGroup(c.amx, c.amy, k, sizeL, items));
    if (wpos.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(wpos, 3));
      const m = new THREE.Mesh(g, this.wMat); m.frustumCulled = false; m.renderOrder = 2; c.meshes.push(m); this.group.add(m);
    }
    c.state = 'built'; c.layers = null;
    this.onCellBuilt?.(c, ax, az, sizeL);
    return true;
  }
  update(C, camAlt, agl) {
    this.tick++; this.agl = Math.max(agl, 0);
    const f = this.frame;
    const show = this.on && agl < 7000;
    this.group.visible = show;
    if (!this.template) { this.hideLabels(); return; }
    const mx = f.localToMx(C.x), my = f.localToMy(C.z);
    const tile = (z) => { const ts = tileSize(z); return [Math.floor((mx + MERC_MAX) / ts), Math.floor((MERC_MAX - my) / ts)]; };
    // tiles de visão geral (rótulos)
    if (this.labelsOn) {
      const lz = camAlt > 60000 ? 5 : 9;
      const [lx, ly] = tile(lz);
      for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) this.wantCell(lz, lx + i, ly + j, false);
    }
    if (show) {
      const [cx, cy] = tile(DZ);
      // só os tiles de detalhe realmente próximos (cada um traz milhares de casas)
      const R = this.radius, want = [], tsL = tileSize(DZ) * f.k, reach = Math.max(this.bDist + 100, 450);
      for (let j = -R; j <= R; j++) for (let i = -R; i <= R; i++) {
        const x0 = f.mercToLocalX(tileMinX(DZ, cx + i)) - C.x, z0 = f.mercToLocalZ(tileMaxY(DZ, cy + j)) - C.z;
        const d = Math.hypot(Math.max(x0, 0, -(x0 + tsL)), Math.max(z0, 0, -(z0 + tsL)));
        if (d < reach) want.push([cx + i, cy + j, d]);
      }
      want.sort((a, b) => a[2] - b[2]);
      let budget = 1;
      for (const [x, y] of want) {
        const c = this.wantCell(DZ, x, y, true);
        if (c && c.state === 'data' && budget > 0 && this.build(c)) budget--; // uma célula por quadro; as que esperam o relevo não travam as outras
      }
    }
    if (show) this.updateChunks(C);
    const now = performance.now();
    for (const c of this.cells.values()) {
      if (c.state === 'fail' && now > c.retry) { this.cells.delete(c.key); continue; }
      if (this.tick - c.used > 600 && c.state !== 'loading') { this.disposeCell(c); this.cells.delete(c.key); continue; }
      if (c.meshes.length) {
        const px = f.mercToLocalX(c.amx) - C.x, pz = f.mercToLocalZ(c.amy) - C.z, s = f.k / c.k;
        for (const m of c.meshes) { m.position.set(px, 0, pz); m.scale.set(s, 1, s); }
      }
    }
    this.updateLabels(C, camAlt);
  }
  // célula de detalhe e coordenadas locais dela para um ponto do mundo
  cellAt(x, z) {
    const f = this.frame, mx = f.localToMx(x), my = f.localToMy(z), ts = tileSize(DZ);
    const c = this.cells.get(DZ + '/' + Math.floor((mx + MERC_MAX) / ts) + '/' + Math.floor((MERC_MAX - my) / ts));
    if (!c || c.state !== 'built' || !c.k) return null;
    this._lx = (mx - c.amx) * c.k; this._lz = (c.amy - my) * c.k;
    return c;
  }
  // prédio sob o ponto: { top, base } (alturas absolutas) ou null
  buildingAt(x, z) {
    const c = this.cellAt(x, z); if (!c || !c.chunks) return null;
    const lx = this._lx, lz = this._lz, sizeL = tileSize(DZ) * c.k;
    const gx = Math.floor(lx / sizeL * CG), gz = Math.floor(lz / sizeL * CG);
    let best = null;
    for (let j = gz - 1; j <= gz + 1; j++) for (let i = gx - 1; i <= gx + 1; i++) {
      if (i < 0 || j < 0 || i >= CG || j >= CG) continue;
      const fp = c.chunks[i + j * CG].fp; if (!fp) continue;
      for (const b of fp) {
        if (b.t !== 'p' || lx < b.x0 || lx > b.x1 || lz < b.z0 || lz > b.z1 || !inRing(b.ring, lx, lz)) continue;
        if (!best || b.y1 > best.top) best = { top: b.y1, base: b.y0 };
      }
    }
    return best;
  }
  // água doce sob o ponto (lago, rio largo): nível da superfície, ou null
  waterAt(x, z) {
    const c = this.cellAt(x, z); if (!c || !c.waterPolys) return null;
    const lx = this._lx, lz = this._lz;
    for (const w of c.waterPolys) {
      if (lx < w.x0 || lx > w.x1 || lz < w.z0 || lz > w.z1 || !inRing(w.rings[0], lx, lz)) continue;
      let hole = false; for (let i = 1; i < w.rings.length; i++) if (inRing(w.rings[i], lx, lz)) { hole = true; break; }
      if (!hole) return { level: w.level, ocean: w.ocean };
    }
    return null;
  }
  // cria/descarta as malhas 3D dos quarteirões conforme a distância
  updateChunks(C) {
    const f = this.frame; let best = null, bd = Infinity;
    for (const c of this.cells.values()) {
      if (!c.chunks || c.state !== 'built') continue;
      const ox = f.mercToLocalX(c.amx) - C.x, oz = f.mercToLocalZ(c.amy) - C.z, s = f.k / c.k;
      const half = (tileSize(DZ) * f.k) / CG / 2;
      for (const ch of c.chunks) {
        if (!ch.recs.length && !ch.props) continue;
        // distância até a borda do quarteirão (não até o centro): o que está ao lado do jogador nunca some
        const d = Math.hypot(Math.max(Math.abs(ox + ch.cx * s) - half, 0), Math.max(Math.abs(oz + ch.cz * s) - half, 0));
        if (ch.props) for (const m of ch.props) m.visible = d < this.pDist;
        if (!ch.recs.length) continue;
        if (!ch.mesh && !ch.empty && d < this.bDist && d < bd) { bd = d; best = [c, ch, d < 90]; }
        else if (ch.mesh && !ch.fine && d < 60 && d < bd) { bd = d; best = [c, ch, true]; } // chegou perto: refaz com os detalhes finos
        else if (ch.mesh && d > this.bDist * 1.5 + 150) { for (const m of [ch.mesh, ch.roof]) if (m) { this.group.remove(m); m.geometry.dispose(); c.meshes.splice(c.meshes.indexOf(m), 1); } this.physics?.removeGroup(ch.pg); ch.mesh = ch.roof = null; ch.fp = null; ch.pg = null; }
      }
    }
    if (best) {
      const [c, ch, fine] = best;
      if (ch.mesh) { for (const m of [ch.mesh, ch.roof]) if (m) { this.group.remove(m); m.geometry.dispose(); c.meshes.splice(c.meshes.indexOf(m), 1); } this.physics?.removeGroup(ch.pg); ch.mesh = ch.roof = null; ch.pg = null; }
      this.buildChunk(c, ch, fine);
    }
  }
  // árvore pode nascer aqui? não em rua, calçada nem dentro (ou colada) de construção
  treeOk(x, z) {
    const c = this.cellAt(x, z); if (!c) return true;
    const lx = this._lx, lz = this._lz;
    if (this.roadDist(c, lx, lz) < SW + 0.8) return false;
    const a = c.recGrid && c.recGrid.get(Math.floor(lx / 32) * 4096 + Math.floor(lz / 32));
    if (a) for (const r of a) { const R = r.rings[0]; if (inRing(R, lx, lz) || inRing(R, lx + 1.2, lz) || inRing(R, lx - 1.2, lz) || inRing(R, lx, lz + 1.2) || inRing(R, lx, lz - 1.2)) return false; }
    return true;
  }
  // distância até a borda da rua mais próxima (negativa = em cima da pista); Infinity se não há rua por perto
  roadDist(c, lx, lz, exceptLi = -1, reach = 1) {
    let best = Infinity; if (!c.roadGrid) return best;
    const gx0 = Math.floor(lx / RC), gz0 = Math.floor(lz / RC);
    for (let gz = gz0 - reach + 1; gz <= gz0 + reach - 1; gz++) for (let gx = gx0 - reach + 1; gx <= gx0 + reach - 1; gx++) {
      const a = c.roadGrid.get(gx * 4096 + gz); if (!a) continue;
      for (const i of a) {
        const sg = c.segs[i]; if (sg.li === exceptLi) continue;
        const ex = sg.bx - sg.ax, ez = sg.bz - sg.az, l2 = ex * ex + ez * ez, t = l2 > 0 ? Math.max(0, Math.min(1, ((lx - sg.ax) * ex + (lz - sg.az) * ez) / l2)) : 0;
        const d = Math.hypot(lx - sg.ax - ex * t, lz - sg.az - ez * t) - sg.hw;
        if (d < best) best = d;
      }
    }
    return best;
  }
  roadNear(c, lx, lz, exceptLi, margin) { return this.roadDist(c, lx, lz, exceptLi) < margin; }
  // piso construído sob o ponto: altura absoluta da pista ou da calçada (15 cm acima), ou null se é só terreno
  surfaceAt(x, z) {
    const c = this.cellAt(x, z); if (!c || !c.roadGrid) return null;
    const lx = this._lx, lz = this._lz, a = c.roadGrid.get(Math.floor(lx / RC) * 4096 + Math.floor(lz / RC)); if (!a) return null;
    let walk = null;
    for (const i of a) {
      const sg = c.segs[i]; if (sg.rail) continue;
      const ex = sg.bx - sg.ax, ez = sg.bz - sg.az, l2 = ex * ex + ez * ez; if (l2 <= 0) continue;
      const t = Math.max(0, Math.min(1, ((lx - sg.ax) * ex + (lz - sg.az) * ez) / l2));
      const dx = lx - sg.ax - ex * t, dz = lz - sg.az - ez * t, d = Math.hypot(dx, dz), y = sg.ya + (sg.yb - sg.ya) * t;
      if (d <= sg.hw) return { y, kind: 'road' };
      if (d <= sg.hw + SW && t > 0 && t < 1) { const sw = -ez * dx + ex * dz > 0 ? sg.swR : sg.swL; if (sw && sw.some((r) => t >= r[0] && t <= r[1])) walk = { y: y + 0.15, kind: 'walk' }; }
    }
    return walk;
  }
  buildChunk(c, ch, fine = true) {
    const f = this.frame, T = this.terrain;
    const ax = f.mercToLocalX(c.amx), az = f.mercToLocalZ(c.amy), sc = f.k / c.k;
    const probe = T.heightAt(ax + ch.cx * sc, az + ch.cz * sc);
    if (!probe.ok || probe.z < 13) { T.needElev(ax + ch.cx * sc, az + ch.cz * sc); return; }
    const H = (x, z) => T.heightAt(ax + x * sc, az + z * sc).h;
    const rnd = mulberry(c.x * 31 + c.y * 17 + Math.round(ch.cx));
    // paredes (+ portas, calhas, muros) num mesh; telhados em outro: dois materiais, dois draw calls por quarteirão
    const wp = [], wc = [], wu = [], wt = [], rp = [], rc = [], rt = [], items = [];
    const wtri = (a, b, d, col) => { wp.push(a[0], a[1], a[2], b[0], b[1], b[2], d[0], d[1], d[2]); for (let v = 0; v < 3; v++) { wc.push(col[0], col[1], col[2]); wu.push(-1, -1); } wt.push(a[0] * 0.3 + a[2] * 0.3, a[1] * 0.33, b[0] * 0.3 + b[2] * 0.3, b[1] * 0.33, d[0] * 0.3 + d[2] * 0.3, d[1] * 0.33); };
    const wquad = (a, b, d, e, col) => { wtri(a, b, d, col); wtri(a, d, e, col); };
    // caixa orientada (eixo u = (ux, uz)): 12 triângulos
    const wbox = (cx, y0, cz, hl, y1, ht, ux, uz, col) => {
      const P = (su, y, sv) => [cx + ux * hl * su - uz * ht * sv, y, cz + uz * hl * su + ux * ht * sv];
      const b = [P(-1, y0, -1), P(1, y0, -1), P(1, y0, 1), P(-1, y0, 1)], t = [P(-1, y1, -1), P(1, y1, -1), P(1, y1, 1), P(-1, y1, 1)];
      for (let i = 0; i < 4; i++) wquad(b[i], b[(i + 1) % 4], t[(i + 1) % 4], t[i], col);
      wquad(t[0], t[1], t[2], t[3], col);
    };
    let ax0 = 1, az0 = 0;
    const rtri = (a, b, d, col, sh) => { rp.push(a[0], a[1], a[2], b[0], b[1], b[2], d[0], d[1], d[2]); for (const q of [a, b, d]) { rc.push(col[0] * sh, col[1] * sh, col[2] * sh); rt.push((q[0] * ax0 + q[2] * az0) / 1.6, (-q[0] * az0 + q[2] * ax0) / 1.6 + q[1] * 0.4); } };
    const gut = lin(0.42, 0.43, 0.45);
    ch.recs.forEach((r, bi) => {
      const rnd = mulberry((Math.round(r.cx * 7) * 73856093) ^ (Math.round(r.cz * 7) * 19349663) ^ (c.x * 83492791 + c.y)); // sorteio próprio de cada casa: a mesma casa sai sempre igual
      const outer = r.rings[0], N = outer.length;
      let gmin = Infinity, gmax = -Infinity, x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      for (const p of outer) { const gh = H(p[0], p[1]); if (gh < gmin) gmin = gh; if (gh > gmax) gmax = gh; if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; if (p[1] < z0) z0 = p[1]; if (p[1] > z1) z1 = p[1]; }
      // altura: a real quando existe; senão estimada pelo tamanho da construção
      let h = r.h;
      if (!(h > 0)) h = r.area < 45 ? 2.8 + rnd() * 0.6 : r.area < 170 ? 3.3 + rnd() * 1.2 : r.area < 500 ? 4.5 + rnd() * 3 : 6 + rnd() * 5;
      const base = gmin - 1.5 + r.minH, top = Math.min(gmax, gmin + 4) + h;
      const sh = 0.85 + rnd() * 0.3;
      const fc = r.fc || (h > 45 ? GLASS : WALLS)[Math.floor(rnd() * (h > 45 ? GLASS.length : WALLS.length))];
      const wcol = [fc[0] * sh, fc[1] * sh, fc[2] * sh];
      let rcol = r.rc;
      if (!rcol && this.snowRoof) rcol = [0.62, 0.66, 0.72];
      if (!rcol) { // telhado com a cor que aparece na foto de satélite
        const sat = T.colorAt(ax + r.cx * sc, az + r.cz * sc);
        if (sat) { const m = Math.max(sat[0], sat[1], sat[2], 1), g = Math.min(1, 150 / m) * 0.9; rcol = lin(Math.min(255, sat[0] * g + 18) / 255, Math.min(255, sat[1] * g + 14) / 255, Math.min(255, sat[2] * g + 12) / 255); }
        else rcol = ROOFS[Math.floor(rnd() * ROOFS.length)];
      }
      const uo = Math.floor(rnd() * 500) * 2.9;
      for (const ring of r.rings) { // paredes com janelas
        let u = uo;
        for (let i = 0; i < ring.length; i++) {
          const a = ring[i], b = ring[(i + 1) % ring.length], len = Math.hypot(b[0] - a[0], b[1] - a[1]);
          wp.push(a[0], base, a[1], b[0], base, b[1], b[0], top, b[1], a[0], base, a[1], b[0], top, b[1], a[0], top, a[1]);
          const v0 = base - (gmin + r.minH), v1 = top - (gmin + r.minH);
          wu.push(u, v0, u + len, v0, u + len, v1, u, v0, u + len, v1, u, v1);
          wt.push(u / 3, v0 / 3, (u + len) / 3, v0 / 3, (u + len) / 3, v1 / 3, u / 3, v0 / 3, (u + len) / 3, v1 / 3, u / 3, v1 / 3);
          for (let v = 0; v < 6; v++) wc.push(wcol[0], wcol[1], wcol[2]);
          u += len;
        }
      }
      // eixo do telhado = aresta mais longa
      let li = 0, ll = 0; for (let i = 0; i < N; i++) { const a = outer[i], b = outer[(i + 1) % N], l = Math.hypot(b[0] - a[0], b[1] - a[1]); if (l > ll) { ll = l; li = i; } }
      ax0 = (outer[(li + 1) % N][0] - outer[li][0]) / (ll || 1); az0 = (outer[(li + 1) % N][1] - outer[li][1]) / (ll || 1);
      let roofTop = top;
      const small = r.rings.length === 1 && r.area < 420 && h < 13 && r.minH === 0;
      if (small && N <= 8) {
        // beiral: o telhado avança 40 cm além das paredes; calha cinza na borda e um cano de descida
        const EV = outer.map((p) => { const dx = p[0] - r.cx, dz = p[1] - r.cz, l = Math.hypot(dx, dz) || 1; return [p[0] + (dx / l) * 0.4, top - 0.05, p[1] + (dz / l) * 0.4]; });
        if (fine) { for (let i = 0; i < N; i++) { const a = EV[i], b = EV[(i + 1) % N]; wquad([a[0], a[1] - 0.14, a[2]], [b[0], b[1] - 0.14, b[2]], b, a, gut); }
          const cp = EV[0]; wbox(cp[0], gmin - 0.3, cp[2], 0.045, top - 0.1, 0.045, 1, 0, gut); }
        if (N === 4) { // duas águas com cumeeira no eixo maior
          const l1 = Math.hypot(outer[(li + 2) % 4][0] - outer[(li + 1) % 4][0], outer[(li + 2) % 4][1] - outer[(li + 1) % 4][1]);
          const q = [EV[li], EV[(li + 1) % 4], EV[(li + 2) % 4], EV[(li + 3) % 4]];
          const rh = Math.min(3.6, l1 * 0.3 + 0.4), ins = Math.min(l1 * 0.45, ll * 0.3) / (ll || 1);
          const mA = [(q[0][0] + q[3][0]) / 2, (q[0][2] + q[3][2]) / 2], mB = [(q[1][0] + q[2][0]) / 2, (q[1][2] + q[2][2]) / 2];
          const A = [mA[0] + (mB[0] - mA[0]) * ins, top + rh, mA[1] + (mB[1] - mA[1]) * ins], Bq = [mB[0] + (mA[0] - mB[0]) * ins, top + rh, mB[1] + (mA[1] - mB[1]) * ins];
          rtri(q[0], q[1], Bq, rcol, 1); rtri(q[0], Bq, A, rcol, 1); rtri(q[2], q[3], A, rcol, 0.84); rtri(q[2], A, Bq, rcol, 0.84); rtri(q[1], q[2], Bq, rcol, 0.92); rtri(q[3], q[0], A, rcol, 0.92);
          roofTop = top + rh * 0.5;
          if (rnd() < 0.25 && fine) wbox(A[0] + (Bq[0] - A[0]) * 0.3, top + rh * 0.4, A[2] + (Bq[2] - A[2]) * 0.3, 0.28, top + rh + 0.55, 0.28, ax0, az0, lin(0.5, 0.31, 0.25)); // chaminé
        } else {
          const rh = Math.min(3.4, Math.sqrt(r.area) * 0.2 + 0.6);
          for (let i = 0; i < N; i++) rtri(EV[i], EV[(i + 1) % N], [r.cx, top + rh, r.cz], rcol, 0.85 + (i % 2) * 0.15);
          roofTop = top + rh * 0.4;
        }
      } else {
        const flat = r.rings.flat();
        let tris = [];
        try { tris = THREE.ShapeUtils.triangulateShape(outer.map((p) => new THREE.Vector2(p[0], p[1])), r.rings.slice(1).map((q) => q.map((p) => new THREE.Vector2(p[0], p[1])))); } catch (e) { /* polígono inválido */ }
        for (const tr of tris) { const a = flat[tr[0]], b = flat[tr[1]], d = flat[tr[2]]; if (a && b && d) rtri([a[0], top, a[1]], [b[0], top, b[1]], [d[0], top, d[1]], rcol, 0.9); }
        for (let i = 0; i < N; i++) { const a = outer[i], b = outer[(i + 1) % N]; wquad([a[0], top, a[1]], [b[0], top, b[1]], [b[0], top + 0.45, b[1]], [a[0], top + 0.45, a[1]], [wcol[0] * 0.9, wcol[1] * 0.9, wcol[2] * 0.9]); } // platibanda
        roofTop = top;
      }
      // porta: na parede mais próxima de uma rua (ou na mais longa), com batente e degrau
      let door = null;
      if (r.minH === 0 && r.rings.length === 1) {
        let best = Infinity, bi2 = -1;
        for (let i = 0; i < N; i++) { const a = outer[i], b = outer[(i + 1) % N], l = Math.hypot(b[0] - a[0], b[1] - a[1]); if (l < 1.7) continue; const d = this.roadDist(c, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2, -1, 3); const sc2 = d === Infinity ? 1e6 - l : d; if (sc2 < best) { best = sc2; bi2 = i; } }
        if (bi2 >= 0) {
          const a = outer[bi2], b = outer[(bi2 + 1) % N], l = Math.hypot(b[0] - a[0], b[1] - a[1]), ux = (b[0] - a[0]) / l, uz = (b[1] - a[1]) / l;
          const mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2; let nx = uz, nz = -ux;
          if (inRing(outer, mx + nx * 0.3, mz + nz * 0.3)) { nx = -nx; nz = -nz; }
          const gy = H(mx, mz), dcol = DOORS[Math.floor(rnd() * DOORS.length)], fr = lin(0.82, 0.8, 0.76);
          const Q = (su, y, off) => [mx + ux * su + nx * off, y, mz + uz * su + nz * off];
          wquad(Q(-0.47, gy, 0.06), Q(0.47, gy, 0.06), Q(0.47, gy + 2.05, 0.06), Q(-0.47, gy + 2.05, 0.06), dcol);
          if (fine) { wquad(Q(-0.6, gy, 0.035), Q(0.6, gy, 0.035), Q(0.6, gy + 2.2, 0.035), Q(-0.6, gy + 2.2, 0.035), fr);
            wbox(mx + nx * 0.3, gy - 0.3, mz + nz * 0.3, 0.7, gy + 0.14, 0.3, ux, uz, lin(0.55, 0.54, 0.52)); }
          door = [mx + nx * 0.95, mz + nz * 0.95, gy + 1];
        }
      }
      items.push({ t: 'p', ring: outer, x0, x1, z0, z1, y0: base, y1: roofTop, tag: door ? 'house' : null, id: `house:${c.x}/${c.y}:${Math.round(r.cx * 2)}:${Math.round(r.cz * 2)}`, ax: door ? door[0] : r.cx, az: door ? door[1] : r.cz, ay: door ? door[2] : gmin + 1 });
      // muro baixo de quintal em parte das casas, com portão voltado para a porta
      if (small && door && r.area > 35 && rnd() < 0.3 && fine) {
        let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
        for (const p of outer) { const u = p[0] * ax0 + p[1] * az0, v = -p[0] * az0 + p[1] * ax0; if (u < u0) u0 = u; if (u > u1) u1 = u; if (v < v0) v0 = v; if (v > v1) v1 = v; }
        const m = 2.2 + rnd() * 1.6; u0 -= m; u1 += m; v0 -= m; v1 += m;
        const W = (u, v) => [u * ax0 - v * az0, u * az0 + v * ax0];
        const cor = [W(u0, v0), W(u1, v0), W(u1, v1), W(u0, v1)];
        const free = (x, z) => this.roadDist(c, x, z, -1, 2) > 0.4 + SW && !ch.recs.some((o, oi) => oi !== bi && inRing(o.rings[0], x, z));
        let okW = true;
        for (let i = 0; i < 4 && okW; i++) for (const t of [0, 0.25, 0.5, 0.75]) { const a = cor[i], b = cor[(i + 1) % 4]; if (!free(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)) { okW = false; break; } }
        if (okW) {
          const mcol = [wcol[0] * 0.88, wcol[1] * 0.88, wcol[2] * 0.86];
          for (let i = 0; i < 4; i++) {
            const a = cor[i], b = cor[(i + 1) % 4], l = Math.hypot(b[0] - a[0], b[1] - a[1]), ux = (b[0] - a[0]) / l, uz = (b[1] - a[1]) / l;
            // portão: vão de 1,8 m no trecho do lado da porta mais próximo dela
            const td = ((door[0] - a[0]) * ux + (door[1] - a[1]) * uz) / l, dd = Math.abs(-(door[0] - a[0]) * uz + (door[1] - a[1]) * ux);
            const parts = td > 0.1 && td < 0.9 && dd < m + 1.2 ? [[0, td - 0.9 / l], [td + 0.9 / l, 1]] : [[0, 1]];
            for (const [t0, t1] of parts) {
              if (t1 - t0 < 0.02) continue;
              const cx = a[0] + (b[0] - a[0]) * (t0 + t1) / 2, cz = a[1] + (b[1] - a[1]) * (t0 + t1) / 2, hl = l * (t1 - t0) / 2, gy = H(cx, cz);
              wbox(cx, gy - 0.5, cz, hl, gy + 1.15, 0.07, ux, uz, mcol);
              items.push({ t: 'b', x: cx, z: cz, hx: hl, hz: 0.09, c: ux, s: uz, y0: gy - 0.5, y1: gy + 1.15, tag: 'wall', id: `wall:${c.x}/${c.y}:${Math.round(cx * 2)}:${Math.round(cz * 2)}`, ax: cx, az: cz, ay: gy + 0.8 });
            }
          }
        }
      }
    });
    if (!wp.length) { ch.empty = true; return; }
    const mkm = (P, C, U, mat, extra) => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2)); if (extra) g.setAttribute('wuv', new THREE.Float32BufferAttribute(extra, 2)); g.computeVertexNormals(); g.computeBoundingSphere(); const m = this.mesh(g, mat, true); c.meshes.push(m); this.group.add(m); return m; };
    ch.mesh = mkm(wp, wc, wt, 'wall', wu);
    ch.roof = rp.length ? mkm(rp, rc, rt, 'roof') : null;
    ch.fp = items; ch.fine = fine;
    if (this.physics) ch.pg = this.physics.addGroup(c.amx, c.amy, c.k, tileSize(DZ) * c.k, items);
    this.onChunkBuilt?.(c, ch);
  }
  // cidades conhecidas ao redor (para as corridas)
  cities() {
    const out = new Map();
    for (const c of this.cells.values()) if (c.z === 9) for (const l of c.labels) if (l.cls === 'city' || l.cls === 'town') out.set(l.name, l);
    return [...out.values()];
  }
  hideLabels() { for (const p of this.pool) if (p.lab) { p.el.style.display = 'none'; p.lab = null; } }
  updateLabels(C, camAlt) {
    if (!this.labelsOn || !this.labelEl) { this.hideLabels(); return; }
    const f = this.frame, cam = this.camera, W = window.innerWidth, Hh = window.innerHeight, v = this.v;
    const project = (l) => {
      const dx = f.mercToLocalX(l.mx) - C.x, dz = f.mercToLocalZ(l.my) - C.z;
      const d = Math.hypot(dx, dz);
      if (l.h == null || (this.tick % 120 === 0 && !l.hok)) { const g = this.terrain.heightAt(dx + C.x, dz + C.z); l.h = Math.max(g.ok ? g.h : 0, l.ele || 0); l.hok = g.ok; }
      const y = l.h + (l.cls === 'peak' ? 25 : 35) + d * 0.012 - (d * d) / (2 * RE);
      v.set(dx, y, dz);
      l.d = Math.hypot(d, y - camAlt);
      v.applyMatrix4(cam.matrixWorldInverse);
      if (v.z > -1) return false;
      v.applyMatrix4(cam.projectionMatrix);
      l.sx = (v.x * 0.5 + 0.5) * W; l.sy = (-v.y * 0.5 + 0.5) * Hh;
      return l.sx > 40 && l.sx < W - 40 && l.sy > 50 && l.sy < Hh - 90;
    };
    if (this.tick % 12 === 0) {
      const cand = [];
      const seen = new Set();
      const groups = [...this.cells.values()]; groups.push({ z: 0, labels: this.extraLabels });
      for (const c of groups) for (const l of c.labels) {
        if (camAlt > 60000 && c.z > 5) continue;
        if (seen.has(l.name)) continue;
        // no chão só aparecem os nomes de perto; quanto mais alto, mais longe se enxerga
        if (!project(l) || l.d > Math.min(l.range, 2500 + this.agl * 70) || l.d < 60) continue;
        seen.add(l.name);
        l.score = (WEIGHT[l.cls] || 1) * (1 - l.d / l.range) + (10 - Math.min(l.rank, 10)) * 0.05;
        cand.push(l);
      }
      cand.sort((a, b) => b.score - a.score);
      const chosen = [];
      for (const l of cand) {
        if (chosen.length >= this.pool.length) break;
        if (chosen.some((o) => Math.abs(o.sx - l.sx) < 130 && Math.abs(o.sy - l.sy) < 26)) continue;
        chosen.push(l);
      }
      const set = new Set(chosen);
      for (const p of this.pool) if (p.lab && !set.has(p.lab)) { p.el.style.display = 'none'; p.lab.slot = null; p.lab = null; }
      for (const l of chosen) {
        if (l.slot) continue;
        const p = this.pool.find((q) => !q.lab); if (!p) break;
        p.lab = l; l.slot = p; p.el.textContent = (l.cls === 'peak' ? '▲ ' : '') + l.name; p.el.className = 'wl wl-' + l.cls; p.el.style.display = 'block';
      }
    }
    for (const p of this.pool) {
      const l = p.lab; if (!l) continue;
      if (!project(l)) { p.el.style.opacity = 0; continue; }
      p.el.style.transform = `translate(${l.sx.toFixed(1)}px, ${l.sy.toFixed(1)}px) translate(-50%, -100%)`;
      p.el.style.opacity = clamp(1.6 * (1 - l.d / l.range) + 0.25, 0, 1).toFixed(2);
    }
  }
}
