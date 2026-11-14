// Mundo vetorial (OpenStreetMap via OpenFreeMap): casas e prédios 3D com janelas, lagos e rios com água de verdade,
// e nomes de bairros, cidades, picos e lagos flutuando sobre o cenário.
import * as THREE from 'three';
import { ATMO_GLSL } from './atmosphere.js';
import { decodeMVT, toPolygons } from './mvt.js';
import { tileSize, tileMinX, tileMaxY, MERC_MAX, RE, mulberry, clamp } from './geo.js';

const DZ = 14;
const TILEJSON = 'https://tiles.openfreemap.org/planet';
const s2l = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const WALLS = [[0.86, 0.83, 0.77], [0.93, 0.92, 0.89], [0.78, 0.71, 0.62], [0.88, 0.82, 0.73], [0.74, 0.74, 0.76], [0.82, 0.76, 0.7], [0.9, 0.86, 0.78]].map((c) => c.map(s2l));
const GLASS = [[0.5, 0.56, 0.62], [0.62, 0.64, 0.66], [0.42, 0.46, 0.52], [0.7, 0.68, 0.62], [0.55, 0.5, 0.46]].map((c) => c.map(s2l));
const ROOFS = [[0.36, 0.34, 0.34], [0.52, 0.31, 0.24], [0.44, 0.44, 0.47], [0.58, 0.36, 0.27], [0.3, 0.3, 0.32]].map((c) => c.map(s2l));
const RANGE = { continent: 0, country: 0, state: 0, city: 260e3, town: 70e3, village: 22e3, suburb: 9e3, quarter: 7e3, neighbourhood: 4500, hamlet: 4500, isolated_dwelling: 1500, peak: 30e3, lake: 6000 };
const WEIGHT = { city: 7, town: 4.5, peak: 3.2, village: 3, suburb: 2.6, quarter: 2.3, lake: 1.4, neighbourhood: 2, hamlet: 1.8, isolated_dwelling: 1 };

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
    this.radius = 1; this.snowRoof = false; this.night = { value: 0 };
    this.group = new THREE.Group(); scene.add(this.group);
    this.bMat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
    this.bMat.onBeforeCompile = (sh) => {
      sh.uniforms.uNightW = this.night;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec2 wuv; varying vec2 vWuv;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWuv = wuv;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec2 vWuv; uniform float uNightW; float wLit = 0.0;')
        .replace('#include <color_fragment>', `#include <color_fragment>
  if (vWuv.y > -0.5) {
    vec2 wc = vec2(vWuv.x / 2.9, vWuv.y / 3.0);
    vec2 wf = fract(wc), wid = floor(wc);
    float win = step(0.24, wf.x)*step(wf.x, 0.76)*step(0.36, wf.y)*step(wf.y, 0.8);
    float wh = fract(sin(dot(wid, vec2(12.9898, 78.233)))*43758.5453);
    // de longe o padrão vira uma média suave (sem pontilhado)
    float fw = max(fwidth(vWuv.x) / 2.9, fwidth(vWuv.y) / 3.0);
    float near = 1.0 - smoothstep(0.18, 0.5, fw);
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.06, 0.08, 0.1), mix(0.1, win*(0.3 + 0.25*wh), near));
    wLit = mix(0.09, win*step(0.6, wh)*(0.5 + wh), near);
  }`)
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += wLit * uNightW * vec3(1.0, 0.62, 0.28) * 0.14;');
    };
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
  async init() {
    try {
      const r = await fetch(TILEJSON); if (!r.ok) throw 0;
      const j = await r.json();
      this.template = j.tiles[0];
    } catch (e) { this.failed = true; }
  }
  clear() { for (const c of this.cells.values()) this.disposeCell(c); this.cells.clear(); }
  disposeCell(c) { c.dead = true; for (const m of c.meshes || []) { this.group.remove(m); m.geometry.dispose(); } c.meshes = []; c.labels = []; }
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
      c.layers = decodeMVT(buf, c.detail ? ['building', 'water', 'waterway', 'place', 'mountain_peak', 'water_name'] : ['place', 'mountain_peak', 'water_name']);
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
    const probe = T.heightAt(ax + sizeL * 0.5, az + sizeL * 0.5);
    if (!probe.ok || probe.z < 11) return;
    c.k = k;
    const H = (x, z) => T.heightAt(ax + x, az + z).h;
    const rnd = mulberry(c.x * 31 + c.y * 17);
    // ---- prédios ----
    const B = c.layers.building;
    if (B) {
      const pos = [], col = [], wuv = [];
      const s = sizeL / B.extent;
      for (const ft of B.features) {
        if (ft.props.hide_3d) continue;
        let h = +ft.props.render_height || 6; const minH = +ft.props.render_min_height || 0;
        for (const poly of toPolygons(ft.geom)) {
          const rings = [poly.outer, ...poly.holes].map((r) => r.map((p) => [p[0] * s, p[1] * s]));
          const outer = rings[0];
          if (outer.length < 3) continue;
          const area = poly.area * s * s;
          if (area < 6) continue;
          let gmin = Infinity, gmax = -Infinity, cx = 0, cz = 0;
          for (const p of outer) { const gh = H(p[0], p[1]); if (gh < gmin) gmin = gh; if (gh > gmax) gmax = gh; cx += p[0]; cz += p[1]; }
          cx /= outer.length; cz /= outer.length;
          const base = gmin - 1.5 + minH, top = Math.min(gmax, gmin + 4) + h;
          const wc = (h > 45 ? GLASS : WALLS)[Math.floor(rnd() * (h > 45 ? GLASS.length : WALLS.length))], sh = 0.85 + rnd() * 0.3;
          const rc = this.snowRoof ? [0.62, 0.66, 0.72] : ROOFS[Math.floor(rnd() * ROOFS.length)];
          const uo = Math.floor(rnd() * 500) * 2.9;
          for (const ring of rings) {
            let u = uo;
            for (let i = 0; i < ring.length; i++) {
              const a = ring[i], b = ring[(i + 1) % ring.length];
              const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
              pos.push(a[0], base, a[1], b[0], base, b[1], b[0], top, b[1], a[0], base, a[1], b[0], top, b[1], a[0], top, a[1]);
              const v0 = base - (gmin + minH), v1 = top - (gmin + minH);
              wuv.push(u, v0, u + len, v0, u + len, v1, u, v0, u + len, v1, u, v1);
              for (let v = 0; v < 6; v++) col.push(wc[0] * sh, wc[1] * sh, wc[2] * sh);
              u += len;
            }
          }
          // telhado: de quatro águas para casas pequenas, plano para o resto
          const small = rings.length === 1 && outer.length <= 8 && area < 320 && h < 13;
          if (small) {
            const rh = Math.min(3.8, Math.sqrt(area) * 0.24 + 0.8);
            for (let i = 0; i < outer.length; i++) {
              const a = outer[i], b = outer[(i + 1) % outer.length];
              pos.push(a[0], top, a[1], b[0], top, b[1], cx, top + rh, cz);
              for (let v = 0; v < 3; v++) { col.push(rc[0], rc[1], rc[2]); wuv.push(-1, -1); }
            }
          } else {
            const flat = rings.flat();
            let tris = [];
            try { tris = THREE.ShapeUtils.triangulateShape(outer.map((p) => new THREE.Vector2(p[0], p[1])), rings.slice(1).map((r) => r.map((p) => new THREE.Vector2(p[0], p[1])))); } catch (e) { /* polígono inválido */ }
            for (const tr of tris) for (const ii of tr) { const p = flat[ii]; if (!p) continue; pos.push(p[0], top, p[1]); col.push(rc[0] * 0.9, rc[1] * 0.9, rc[2] * 0.9); wuv.push(-1, -1); }
          }
        }
      }
      if (pos.length) {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
        g.setAttribute('wuv', new THREE.Float32BufferAttribute(wuv, 2));
        g.computeVertexNormals();
        const m = new THREE.Mesh(g, this.bMat); m.frustumCulled = false; c.meshes.push(m); this.group.add(m);
      }
    }
    // ---- água: lagos, rios, canais ----
    const wpos = [];
    const W = c.layers.water;
    if (W) {
      const s = sizeL / W.extent;
      for (const ft of W.features) {
        if (ft.props.class === 'ocean' || ft.props.class === 'swimming_pool' || ft.props.intermittent === 1) continue;
        for (const poly of toPolygons(ft.geom)) {
          const rings = [poly.outer, ...poly.holes].map((r) => r.map((p) => [clamp(p[0], -64, W.extent + 64) * s, clamp(p[1], -64, W.extent + 64) * s]));
          const flat = rings.flat();
          let tris = [];
          try { tris = THREE.ShapeUtils.triangulateShape(rings[0].map((p) => new THREE.Vector2(p[0], p[1])), rings.slice(1).map((r) => r.map((p) => new THREE.Vector2(p[0], p[1])))); } catch (e) { /* ignora */ }
          const lake = ft.props.class !== 'river';
          let lvl = Infinity;
          if (lake) for (const p of rings[0]) lvl = Math.min(lvl, H(p[0], p[1]));
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
    if (wpos.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(wpos, 3));
      const m = new THREE.Mesh(g, this.wMat); m.frustumCulled = false; m.renderOrder = 2; c.meshes.push(m); this.group.add(m);
    }
    c.state = 'built'; c.layers = null;
  }
  update(C, camAlt, agl) {
    this.tick++;
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
      const R = this.radius, want = [];
      for (let j = -R; j <= R; j++) for (let i = -R; i <= R; i++) want.push([cx + i, cy + j, i * i + j * j]);
      want.sort((a, b) => a[2] - b[2]);
      let budget = 1;
      for (const [x, y] of want) {
        const c = this.wantCell(DZ, x, y, true);
        if (c && c.state === 'data' && budget-- > 0) this.build(c);
      }
    }
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
      for (const c of this.cells.values()) for (const l of c.labels) {
        if (camAlt > 60000 && c.z > 5) continue;
        if (seen.has(l.name)) continue;
        if (!project(l) || l.d > l.range || l.d < 120) continue;
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
