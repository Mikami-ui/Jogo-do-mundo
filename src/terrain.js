// Terreno em quadtree: elevação real (Terrain Tiles / Terrarium) + imagens de satélite,
// projetado numa esfera em torno da câmera (curvatura real da Terra até a órbita).
import * as THREE from 'three';
import { ATMO_GLSL } from './atmosphere.js';
import { RE, tileSize, tileMinX, tileMaxY, MERC_MAX, clamp, mulberry } from './geo.js';
import { treeGeometries } from './scenery.js';

const N = 32;                 // segmentos por tile
const ELEV_MAX_Z = 13;
const TREE_Z = 16;
export const IMAGERY = {
  esri: { name: 'Esri World Imagery', maxZ: 19, placeholder: 3600, url: (z, x, y) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`, credit: 'Imagens © Esri, Maxar, Earthstar Geographics' },
  s2: { name: 'Sentinel-2 cloudless (EOX)', maxZ: 15, url: (z, x, y) => `https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2020_3857/default/g/${z}/${y}/${x}.jpg`, credit: 'Sentinel-2 cloudless 2020 © EOX IT Services (dados Copernicus)' },
};
const ELEV_URL = (z, x, y) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;

// ---------------- agendador de downloads com prioridade ----------------
class Scheduler {
  constructor(max) { this.max = max; this.active = 0; this.jobs = new Map(); this.frame = 0; }
  want(key, prio, start) {
    let j = this.jobs.get(key);
    if (!j) { j = { key, prio, start, frame: this.frame }; this.jobs.set(key, j); }
    j.prio = prio; j.frame = this.frame;
  }
  update(frame) {
    this.frame = frame;
    if (!this.jobs.size) return;
    const list = [];
    for (const j of this.jobs.values()) {
      if (frame - j.frame > 20) { this.jobs.delete(j.key); j.cancel?.(); continue; }
      list.push(j);
    }
    this.pump();
  }
  // inicia os pedidos mais prioritários; chamado a cada quadro e sempre que um download termina
  pump() {
    while (this.active < this.max && this.jobs.size) {
      let best = null;
      for (const j of this.jobs.values()) if (!best || j.prio < best.prio) best = j;
      this.jobs.delete(best.key);
      this.active++;
      Promise.resolve().then(best.start).catch(() => {}).finally(() => { this.active--; this.pump(); });
    }
  }
  get pending() { return this.jobs.size + this.active; }
}

let readCanvas = null;
function getPixels(bmp) {
  if (!readCanvas) {
    readCanvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(256, 256) : Object.assign(document.createElement('canvas'), { width: 256, height: 256 });
    readCanvas.ctx = readCanvas.getContext('2d', { willReadFrequently: true });
  }
  const c = readCanvas.ctx;
  c.clearRect(0, 0, 256, 256);
  c.drawImage(bmp, 0, 0, 256, 256);
  return c.getImageData(0, 0, 256, 256).data;
}
async function fetchBitmap(url, signal, minBytes = 0) {
  const r = await fetch(url, { mode: 'cors', signal });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const blob = await r.blob();
  if (blob.size < minBytes) throw new Error('sem dados'); // tile "Map data not yet available"
  return createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
}

// ---------------- índice compartilhado (grade + saias) ----------------
const VERTS = (N + 1) * (N + 1) + 4 * (N + 1);
// step > 1 pula vértices: tiles de zoom alto usam a mesma grade de vértices com menos triângulos, porque o
// relevo real (zoom 13) não tem mais detalhe que isso — o desenho fica igual com uma fração dos triângulos.
function buildIndex(step = 1) {
  const idx = [];
  const g = (i, j) => j * (N + 1) + i;
  for (let j = 0; j < N; j += step) for (let i = 0; i < N; i += step) {
    const a = g(i, j), b = g(i + step, j), c = g(i, j + step), d = g(i + step, j + step);
    idx.push(a, c, b, b, c, d);
  }
  const base = (N + 1) * (N + 1);
  const edges = [
    (k) => g(k, 0), (k) => g(k, N), (k) => g(0, k), (k) => g(N, k),
  ];
  edges.forEach((e, s) => {
    for (let k = 0; k < N; k += step) {
      const a = e(k), b = e(k + step), c = base + s * (N + 1) + k, d = c + step;
      idx.push(a, b, c, b, d, c, a, c, b, b, c, d);
    }
  });
  return new THREE.BufferAttribute(new Uint16Array(idx), 1);
}

// ---------------- shaders ----------------
const VERT = /* glsl */`
#include <common>
#include <logdepthbuf_pars_vertex>
${ATMO_GLSL}
uniform vec2 uTileRel; uniform float uTileSize; uniform vec3 uMerc; uniform vec2 uCamLL; uniform vec2 uNoiseOff; uniform vec2 uDetOff; uniform mat4 uShadowMatrix;
varying vec2 vUv; varying vec3 vN; varying float vH; varying vec3 vRel; varying vec3 vAerial; varying vec3 vT;
varying float vDist; varying vec2 vNoise; varying float vSunMu; varying float vSlope; varying vec3 vUp; varying vec2 vDet; varying vec4 vShadow;
void main(){
  vec2 p = uTileRel + position.xz*uTileSize;
  float dp = length(p);
  float w = smoothstep(20000.0, 120000.0, dp);
  if (w > 0.0) {
    float mx = uMerc.x + position.x*uMerc.z;
    float my = uMerc.y - position.z*uMerc.z;
    float lon = mx/6378137.0;
    float lat = 2.0*atan(exp(my/6378137.0)) - 1.5707963;
    float dl = lon - uCamLL.y; dl -= 6.2831853*floor((dl+3.1415927)/6.2831853);
    float la1 = uCamLL.x;
    float s1 = sin((lat-la1)*0.5), s2 = sin(dl*0.5);
    float a = s1*s1 + cos(la1)*cos(lat)*s2*s2;
    float d = 2.0*ATM_R*asin(min(sqrt(a),1.0));
    float brg = atan(sin(dl)*cos(lat), cos(la1)*sin(lat) - sin(la1)*cos(lat)*cos(dl));
    p = mix(p, vec2(sin(brg), -cos(brg))*d, w);
    dp = length(p);
  }
  float h = position.y;
  float th = dp/ATM_R;
  vec2 dir = dp > 1e-3 ? p/dp : vec2(0.0, 1.0);
  float s = sin(th), c = cos(th), hs = sin(th*0.5);
  vec3 wp = vec3(dir.x*(ATM_R+h)*s, h*c - ATM_R*2.0*hs*hs, dir.y*(ATM_R+h)*s);
  vec3 ax = vec3(dir.y, 0.0, -dir.x);
  vec3 n = normal;
  vN = n*c + cross(ax, n)*s + ax*dot(ax, n)*(1.0-c);
  vUp = vec3(dir.x*s, c, dir.y*s);
  vSunMu = dot(vUp, uSunDir);
  vSlope = normal.y;
  vH = h; vUv = position.xz; vNoise = uNoiseOff + position.xz*uTileSize;
  vShadow = uShadowMatrix * vec4(wp, 1.0);
  vDet = uDetOff + position.xz*uTileSize; // coordenada pequena (0–64 m + tile), presa ao mundo: não perde precisão
  vec3 rel = wp - vec3(0.0, uCamAlt, 0.0);
  float L = max(length(rel), 0.01);
  vRel = rel; vDist = dp;
  vec3 T;
  vAerial = aerial(uCamAlt, h, L, dot(rel/L, uSunDir), vSunMu, T);
  vT = T;
  gl_Position = projectionMatrix * (viewMatrix * vec4(wp, 1.0));
  #include <logdepthbuf_vertex>
}`;

const FRAG = /* glsl */`
#include <common>
#include <packing>
#include <logdepthbuf_pars_fragment>
${ATMO_GLSL}
uniform sampler2D uTex; uniform sampler2D uDetail; uniform sampler2D uShadowMap; uniform float uShadowOn; uniform float uShadowTexel; uniform float uHasTex; uniform vec4 uUvX; uniform float uMaxDist;
uniform float uSnowLine; uniform float uAutumn; uniform float uWinter; uniform vec3 uMoon; uniform float uTime; uniform float uFade;
varying vec2 vUv; varying vec3 vN; varying float vH; varying vec3 vRel; varying vec3 vAerial; varying vec3 vT;
varying float vDist; varying vec2 vNoise; varying float vSunMu; varying float vSlope; varying vec3 vUp; varying vec2 vDet; varying vec4 vShadow;
float h21(vec2 p){ p = fract(p*vec2(123.34, 456.21)); p += dot(p, p+45.32); return fract(p.x*p.y); }
float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(h21(i), h21(i+vec2(1,0)), f.x), mix(h21(i+vec2(0,1)), h21(i+vec2(1,1)), f.x), f.y); }
float fbm(vec2 p){ return vn(p)*0.55 + vn(p*2.13)*0.28 + vn(p*4.7)*0.17; }
void main(){
  #include <logdepthbuf_fragment>
  if (vDist > uMaxDist) discard;
  vec3 n = normalize(vN);
  bool water = vH < 0.3;
  float nz = fbm(vNoise*0.004);
  vec3 alb;
  if (uHasTex > 0.5) {
    alb = texture2D(uTex, uUvX.xy + vUv*uUvX.zw).rgb;
  } else {
    vec3 grass = mix(vec3(0.05,0.09,0.03), vec3(0.11,0.12,0.05), nz);
    vec3 rock = mix(vec3(0.10,0.095,0.09), vec3(0.18,0.16,0.14), nz);
    alb = mix(rock, grass, smoothstep(0.7, 0.88, vSlope) * (1.0 - smoothstep(2200.0, 3000.0, vH)));
    if (water) alb = vec3(0.01, 0.03, 0.05);
  }
  float lum = dot(alb, vec3(0.2126, 0.7152, 0.0722));
  // faixa de areia na beira-mar: clara e amarelada na foto → é chão, não água
  if (water && uHasTex > 0.5 && alb.r > alb.b * 1.12 && lum > 0.16) water = false;
  // mar e lagoas rasas que o relevo marca 1–4 m acima de zero: azul-escuro na foto → é água
  else if (!water && uHasTex > 0.5 && vH < 12.0 && alb.b > alb.r * 2.2 && alb.b > alb.g * 0.85 && lum < 0.22) water = true;
  if (!water) {
    float green = clamp((alb.g - max(alb.r, alb.b)) * 12.0, 0.0, 1.0);
    // outono: folhas mudam de cor
    vec3 aut = vec3(alb.g*1.25 + alb.r*0.3, alb.g*0.62 + alb.r*0.1, alb.b*0.5);
    alb = mix(alb, aut, uAutumn * green * smoothstep(0.3, 0.7, nz + 0.2));
    // inverno sem neve: vegetação sem vida
    alb = mix(alb, vec3(lum)*vec3(1.08, 1.0, 0.88), uWinter * 0.4);
    // neve pela estação, altitude e inclinação
    float line = uSnowLine + (nz - 0.5) * 600.0;
    float sn = smoothstep(line - 250.0, line + 250.0, vH);
    float patchy = smoothstep(0.3, 0.62, fbm(vNoise * 0.021) + sn * 0.45 - 0.2);
    float snow = sn * smoothstep(0.52, 0.86, vSlope) * mix(patchy, 1.0, smoothstep(line + 250.0, line + 1100.0, vH));
    snow *= mix(1.0, 0.5, green);
    vec3 snowCol = vec3(0.6, 0.64, 0.7) * (0.6 + 0.9 * clamp(lum * 4.0, 0.0, 1.0));
    alb = mix(alb, snowCol, snow);
  }
  float dNear = 1.0 - smoothstep(20.0, 140.0, length(vRel));
  if (!water && dNear > 0.0) {
    // detalhe de perto: textura repetível ancorada no chão (4 m e 16 m), não na câmera
    vec3 d1 = texture2D(uDetail, vDet / 4.0).rgb, d2 = texture2D(uDetail, vDet / 16.0).rgb;
    alb *= 1.0 + dNear * ((d1.r - 0.5) * 0.5 + (d2.g - 0.5) * 0.3);
  }
  vec3 ts = sunTransmit(max(vH, 0.0), vSunMu) * (1.0 - 0.78*uOvercast);
  float ndl = max(dot(n, uSunDir), 0.0);
  // sombra das casas, árvores, postes e do personagem sobre o chão (mapa de sombra do sol, 4 amostras)
  float shd = 1.0;
  if (uShadowOn > 0.5) {
    vec3 sc = vShadow.xyz / vShadow.w;
    float e = max(abs(sc.x - 0.5), abs(sc.y - 0.5)) * 2.0;
    if (e < 1.0 && sc.z < 1.0 && sc.z > 0.0) {
      float s4 = 0.0;
      s4 += step(sc.z - 0.0007, unpackRGBAToDepth(texture2D(uShadowMap, sc.xy + vec2(-0.6, -0.4) * uShadowTexel)));
      s4 += step(sc.z - 0.0007, unpackRGBAToDepth(texture2D(uShadowMap, sc.xy + vec2(0.6, -0.5) * uShadowTexel)));
      s4 += step(sc.z - 0.0007, unpackRGBAToDepth(texture2D(uShadowMap, sc.xy + vec2(-0.5, 0.6) * uShadowTexel)));
      s4 += step(sc.z - 0.0007, unpackRGBAToDepth(texture2D(uShadowMap, sc.xy + vec2(0.4, 0.5) * uShadowTexel)));
      shd = mix(s4 * 0.25, 1.0, smoothstep(0.8, 1.0, e));
    }
  }
  vec3 light = ts * SUNK * (0.3 + 0.85*ndl) * mix(0.42, 1.0, shd) + uAmbient * 0.9 + uMoon * (0.4 + 0.6*max(n.y, 0.0));
  vec3 col = alb * light;
  if (water) {
    vec3 V = normalize(-vRel);
    float wd = length(vRel);
    vec2 q = vNoise*0.03 + uTime*0.2;
    float amp = 0.12 + 0.2*(1.0 - smoothstep(40.0, 1200.0, wd));
    vec3 wn = normalize(vUp + vec3(vn(q)-0.5 + (vn(q*4.3+3.0)-0.5)*0.5, 0.0, vn(q+17.3)-0.5 + (vn(q*4.3+9.0)-0.5)*0.5)*amp);
    float fres = 0.02 + 0.98*pow(1.0 - max(dot(V, wn), 0.0), 5.0);
    // de perto a foto de satélite do mar é só um borrão: puxa para a cor de água
    float tint = 0.25 + 0.45*(1.0 - smoothstep(60.0, 4000.0, wd));
    vec3 body = mix(alb, vec3(0.012, 0.075, 0.1), tint) * light;
    vec3 R = reflect(-V, wn);
    float sd = max(dot(R, uSunDir), 0.0);
    col = mix(body, uAmbient * 1.3 + ts * 0.05, fres * 0.8) + ts * SUNK * (pow(sd, 300.0) * 50.0 + pow(sd, 22.0) * 0.5) * (1.0 - uOvercast);
  }
  col = col * vT + vAerial;
  gl_FragColor = vec4(col, uFade);
}`;

// ---------------- cache de elevação ----------------
class ElevCache {
  constructor(sched) { this.map = new Map(); this.sched = sched; this.max = 220; }
  key(z, x, y) { return z + '/' + x + '/' + y; }
  get(z, x, y) {
    const k = this.key(z, x, y);
    const e = this.map.get(k);
    if (e && e.data) { this.map.delete(k); this.map.set(k, e); }
    return e;
  }
  request(z, x, y, prio) {
    const k = this.key(z, x, y);
    let e = this.map.get(k);
    if (!e) { e = { z, x, y, data: null, state: 'idle', retry: 0 }; this.map.set(k, e); }
    if (e.state === 'ok' || e.state === 'loading') return e;
    if (e.state === 'fail' && performance.now() < e.retry) return e;
    this.sched.want('e' + k, prio, async () => {
      e.state = 'loading';
      try {
        const bmp = await fetchBitmap(ELEV_URL(z, x, y));
        const px = getPixels(bmp); bmp.close?.();
        const d = new Float32Array(65536);
        for (let i = 0, j = 0; i < 65536; i++, j += 4) d[i] = px[j] * 256 + px[j + 1] + px[j + 2] / 256 - 32768;
        e.data = d; e.state = 'ok';
        this.evict();
      } catch (err) { e.state = 'fail'; e.retry = performance.now() + 5000; }
    });
    return e;
  }
  evict() {
    if (this.map.size <= this.max) return;
    for (const [k, e] of this.map) {
      if (this.map.size <= this.max) break;
      if (e.state !== 'loading') this.map.delete(k);
    }
  }
  clear() { this.map.clear(); }
}

// ---------------- cache de imagens ----------------
class TexCache {
  constructor(sched, renderer) { this.map = new Map(); this.sched = sched; this.renderer = renderer; this.failCount = 0; this.okCount = 0; }
  request(src, z, x, y, prio, needPixels) {
    const k = src + z + '/' + x + '/' + y;
    let e = this.map.get(k);
    if (!e) { e = { k, tex: null, pixels: null, state: 'idle', refs: 0, needPixels: false, last: 0 }; this.map.set(k, e); }
    e.needPixels ||= needPixels;
    if (e.state === 'idle') {
      this.sched.want('i' + k, prio, async () => {
        if (e.state !== 'idle') return;
        e.state = 'loading';
        try {
          const bmp = await fetchBitmap(IMAGERY[src].url(z, x, y), undefined, z >= 18 ? IMAGERY[src].placeholder || 0 : 0);
          if (e.needPixels) e.pixels = new Uint8ClampedArray(getPixels(bmp));
          const t = new THREE.Texture(bmp);
          t.colorSpace = THREE.SRGBColorSpace; t.flipY = false;
          t.anisotropy = Math.min(4, this.renderer.capabilities.getMaxAnisotropy());
          t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true;
          t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
          t.needsUpdate = true;
          t.onUpdate = () => { bmp.close?.(); };
          e.tex = t; e.state = 'ok'; this.okCount++;
        } catch (err) { e.state = 'fail'; this.failCount++; }
      });
    }
    return e;
  }
  acquire(e) { e.refs++; }
  release(e) { if (e) { e.refs--; e.last = performance.now(); } }
  gc() {
    if (this.map.size < 300) return;
    const now = performance.now();
    for (const [k, e] of this.map) {
      if (e.refs <= 0 && e.state !== 'loading' && now - e.last > 4000) { e.tex?.dispose(); this.map.delete(k); }
    }
  }
  clear() { for (const e of this.map.values()) e.tex?.dispose(); this.map.clear(); }
}

// ---------------- árvores ----------------
function makeTreeGeometry(broadleaf) {
  const parts = [];
  let cone, cone2, trunk;
  if (broadleaf) { // copa arredondada (florestas tropicais e temperadas quentes)
    cone = new THREE.IcosahedronGeometry(0.42, 0); cone.scale(1.25, 0.8, 1.25); cone.translate(0, 0.62, 0);
    cone2 = new THREE.TetrahedronGeometry(0.3, 0); cone2.scale(1.2, 0.8, 1.2); cone2.translate(0.14, 0.84, 0.08);
    trunk = new THREE.CylinderGeometry(0.04, 0.06, 0.4, 4, 1, true); trunk.translate(0, 0.2, 0);
  } else {
    cone = new THREE.ConeGeometry(0.36, 0.82, 6, 1, true); cone.translate(0, 0.59, 0);
    cone2 = new THREE.ConeGeometry(0.26, 0.5, 5, 1, true); cone2.translate(0, 0.78, 0);
    trunk = new THREE.CylinderGeometry(0.04, 0.06, 0.25, 4, 1, true); trunk.translate(0, 0.12, 0);
  }
  const add = (g, col) => { if (g.index) g = g.toNonIndexed(); const n = g.attributes.position.count; const c = new Float32Array(n * 3); for (let i = 0; i < n; i++) c.set(col, i * 3); g.setAttribute('color', new THREE.BufferAttribute(c, 3)); parts.push(g); };
  add(cone, broadleaf ? [0.03, 0.065, 0.02] : [0.026, 0.05, 0.022]); add(cone2, broadleaf ? [0.04, 0.08, 0.026] : [0.032, 0.062, 0.027]); add(trunk, [0.06, 0.042, 0.027]);
  let n = 0; parts.forEach((p) => (n += p.attributes.position.count));
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = new Float32Array(n * 3);
  let o = 0;
  for (const p of parts) { pos.set(p.attributes.position.array, o * 3); nor.set(p.attributes.normal.array, o * 3); col.set(p.attributes.color.array, o * 3); o += p.attributes.position.count; }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

// ---------------- nó da quadtree ----------------
class Node {
  constructor(tm, z, x, y, parent) {
    this.tm = tm; this.z = z; this.x = x; this.y = y; this.parent = parent;
    const n = 2 ** z;
    this.wx = ((x % n) + n) % n;
    this.size = tileSize(z);
    this.minX = tileMinX(z, x); this.maxY = tileMaxY(z, y);
    this.minH = parent ? parent.minH : -100; this.maxH = parent ? parent.maxH : 8900;
    this.children = null; this.mesh = null; this.ready = false; this.lastUsed = 0;
    this.imgZ = Math.min(z, tm.imgMaxZ);
    this.tex = null; this.trees = null; this.treesDone = false; this.heights = null;
  }
  get ez() { return Math.min(Math.max(this.z - 2, 0), ELEV_MAX_Z); }
  elevTile() { const ez = this.ez, s = 2 ** (this.z - ez); return { z: ez, x: Math.floor(this.wx / s), y: Math.floor(this.y / s), s }; }
  imgTile() { const s = 2 ** (this.z - this.imgZ); return { z: this.imgZ, x: Math.floor(this.wx / s), y: Math.floor(this.y / s), s }; }
  request(prio) {
    if (this.ready || this.dead) return;
    const tm = this.tm;
    const et = this.elevTile();
    const ee = tm.elev.request(et.z, et.x, et.y, prio);
    if (!this.tex || this.tex.state === 'idle') {
      // pede de novo a cada quadro enquanto estiver na fila (pedidos antigos são descartados pelo agendador)
      const it = this.imgTile();
      const e = tm.texs.request(tm.imgSrc, it.z, it.x, it.y, prio + 0.5, this.z === TREE_Z);
      if (!this.tex) { this.tex = e; tm.texs.acquire(e); }
    }
    if (this.tex.state === 'fail' && this.z - this.imgZ < 4 && this.imgZ > 0) {
      tm.texs.release(this.tex); this.imgZ--; this.tex = null; return;
    }
    if (ee.state === 'ok' && (this.tex.state === 'ok' || this.tex.state === 'fail')) this.build(ee.data, et);
  }
  build(data, et) {
    const tm = this.tm;
    const pos = new Float32Array(VERTS * 3), nor = new Float32Array(VERTS * 3);
    const sub = 256 / et.s;
    const ox = (this.wx - et.x * et.s) * sub, oy = (this.y - et.y * et.s) * sub;
    const H = new Float32Array((N + 1) * (N + 1));
    let mn = Infinity, mx = -Infinity;
    for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
      let h = sampleBilinear(data, ox + (i / N) * sub - 0.5, oy + (j / N) * sub - 0.5);
      if (h < 0) h = 0;
      H[j * (N + 1) + i] = h;
      if (h < mn) mn = h; if (h > mx) mx = h;
    }
    this.minH = mn; this.maxH = mx; this.heights = H;
    const cell = (this.size * tm.frame.k) / N;
    for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
      const k = j * (N + 1) + i;
      const hl = H[j * (N + 1) + Math.max(i - 1, 0)], hr = H[j * (N + 1) + Math.min(i + 1, N)];
      const hu = H[Math.max(j - 1, 0) * (N + 1) + i], hd = H[Math.min(j + 1, N) * (N + 1) + i];
      const dx = (hr - hl) / (cell * ((i > 0 && i < N) ? 2 : 1)), dz = (hd - hu) / (cell * ((j > 0 && j < N) ? 2 : 1));
      const il = 1 / Math.hypot(dx, 1, dz);
      pos[k * 3] = i / N; pos[k * 3 + 1] = H[k]; pos[k * 3 + 2] = j / N;
      nor[k * 3] = -dx * il; nor[k * 3 + 1] = il; nor[k * 3 + 2] = -dz * il;
    }
    const base = (N + 1) * (N + 1);
    const skirt = Math.max(this.size * tm.frame.k * 0.02, 5, (mx - mn) * 0.5);
    const edges = [(k) => [k, 0], (k) => [k, N], (k) => [0, k], (k) => [N, k]];
    edges.forEach((e, s) => {
      for (let k = 0; k <= N; k++) {
        const [i, j] = e(k), src = j * (N + 1) + i, dst = base + s * (N + 1) + k;
        pos[dst * 3] = i / N; pos[dst * 3 + 1] = H[src] - skirt; pos[dst * 3 + 2] = j / N;
        nor[dst * 3] = nor[src * 3]; nor[dst * 3 + 1] = nor[src * 3 + 1]; nor[dst * 3 + 2] = nor[src * 3 + 2];
      }
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.setIndex(tm.indices[Math.min(8, (this.z <= 16 ? 1 : this.z === 17 ? 2 : this.z === 18 ? 4 : 8) * (this.z <= tm.coarseZ ? 2 : 1))]);
    const it = this.imgTile();
    const ss = 1 / it.s;
    const has = this.tex.state === 'ok';
    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG,
      uniforms: {
        ...tm.G,
        uTex: { value: has ? this.tex.tex : null }, uHasTex: { value: has ? 1 : 0 },
        uUvX: { value: new THREE.Vector4((this.wx - it.x * it.s) * ss, (this.y - it.y * it.s) * ss, ss, ss) },
        uTileRel: { value: new THREE.Vector2() }, uTileSize: { value: 1 },
        uMerc: { value: new THREE.Vector3(this.minX, this.maxY, this.size) },
        uNoiseOff: { value: new THREE.Vector2(((this.minX * tm.frame.k) % 50000), ((-this.maxY * tm.frame.k) % 50000)) },
        uDetOff: { value: new THREE.Vector2() },
        uFade: { value: 1 },
      },
    });
    const m = new THREE.Mesh(geo, mat);
    m.frustumCulled = false; m.matrixAutoUpdate = false; m.visible = false;
    tm.group.add(m);
    this.mesh = m; this.ready = true;
    tm.built++;
  }
  // altura amostrada da grade do próprio tile (u,v em 0..1)
  heightUV(u, v) {
    const H = this.heights; if (!H) return 0;
    const fx = clamp(u, 0, 1) * N, fy = clamp(v, 0, 1) * N;
    const i = Math.min(Math.floor(fx), N - 1), j = Math.min(Math.floor(fy), N - 1);
    const tx = fx - i, ty = fy - j;
    const a = H[j * (N + 1) + i], b = H[j * (N + 1) + i + 1], c = H[(j + 1) * (N + 1) + i], d = H[(j + 1) * (N + 1) + i + 1];
    return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
  }
  ensureChildren() {
    if (this.children) return this.children;
    const z = this.z + 1, x = this.x * 2, y = this.y * 2, tm = this.tm;
    this.children = [new Node(tm, z, x, y, this), new Node(tm, z, x + 1, y, this), new Node(tm, z, x, y + 1, this), new Node(tm, z, x + 1, y + 1, this)];
    return this.children;
  }
  dispose() {
    this.dead = true;
    if (this.children) { this.children.forEach((c) => c.dispose()); this.children = null; }
    if (this.mesh) { this.tm.group.remove(this.mesh); this.mesh.geometry.dispose(); this.mesh.material.dispose(); this.mesh = null; }
    if (this.trees) { this.tm.treeGroup.remove(this.trees); this.trees.dispose(); this.trees = null; this.treeData = null; }
    if (this.treePg) { this.tm.physics?.removeGroup(this.treePg); this.treePg = null; }
    this.tm.texs.release(this.tex); this.tex = null; this.ready = false;
  }
}

function sampleBilinear(d, x, y) {
  x = clamp(x, 0, 255); y = clamp(y, 0, 255);
  const i = Math.min(Math.floor(x), 254), j = Math.min(Math.floor(y), 254);
  const tx = x - i, ty = y - j, o = j * 256 + i;
  return (d[o] * (1 - tx) + d[o + 1] * tx) * (1 - ty) + (d[o + 256] * (1 - tx) + d[o + 257] * tx) * ty;
}

// ---------------- gerenciador ----------------
export class Terrain {
  constructor(renderer, scene, frame, G) {
    this.renderer = renderer; this.frame = frame; this.G = G;
    this.group = new THREE.Group(); this.group.matrixAutoUpdate = false; scene.add(this.group);
    this.treeGroup = new THREE.Group(); scene.add(this.treeGroup);
    this.indices = { 1: buildIndex(1), 2: buildIndex(2), 4: buildIndex(4), 8: buildIndex(8) };
    this.schedE = new Scheduler(8); this.schedI = new Scheduler(16);
    this.elev = new ElevCache(this.schedE);
    this.texs = new TexCache(this.schedI, renderer);
    this.imgSrc = 'esri'; this.imgMaxZ = 17;
    this.maxZ = 17; this.splitF = 1.9; this.treesOn = true; this.treeDist = 2200; this.treeCount = 700;
    this.treeGeo = makeTreeGeometry(false); this.treeGeoB = makeTreeGeometry(true);
    this.detGeo = treeGeometries(); this.near = null; this.nearCap = 0; this.nearR = 0; this.nearT = 0; this.nearHidden = []; this.treeNodes = []; this.physics = null; this.treeFilter = null; this.shadows = false; this.shadowRange = 80;
    this._m4 = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._v1 = new THREE.Vector3(); this._v2 = new THREE.Vector3(); this._col = new THREE.Color(); this._up = new THREE.Vector3(0, 1, 0); this._zero = new THREE.Matrix4().makeScale(0, 0, 0);
    this.treeMat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
    this.frustum = new THREE.Frustum(); this.tmpM = new THREE.Matrix4(); this.sph = new THREE.Sphere();
    this.frameNo = 0; this.built = 0; this.rendered = [];
    this.roots = [];
    this.reset();
  }
  setQuality(q) {
    const Q = { baixa: [17, 1.25, true, 450, 160], media: [18, 1.7, true, 800, 330], alta: [19, 2.2, true, 1300, 600] }[q];
    [this.maxZ, this.splitF, this.treesOn, this.treeDist, this.treeCount] = Q;
    this.coarseZ = { baixa: 13, media: 12, alta: 0 }[q]; // até esse zoom a malha usa metade dos triângulos (terreno distante)
    this.imgMaxZ = Math.min(IMAGERY[this.imgSrc].maxZ, this.maxZ);
  }
  setImagery(src) { this.imgSrc = src; this.imgMaxZ = Math.min(IMAGERY[src].maxZ, this.maxZ); this.reset(); this.texs.clear(); }
  reset() {
    this.roots.forEach((r) => r.dispose());
    this.roots = [];
    for (let y = 0; y < 4; y++) for (let x = -2; x < 6; x++) this.roots.push(new Node(this, 2, x, y, null));
  }
  // altura do terreno (m) na posição local, usando o melhor dado carregado
  heightAt(x, z) {
    const f = this.frame;
    let mx = f.localToMx(x); const my = f.localToMy(z);
    mx = ((mx + MERC_MAX) % (2 * MERC_MAX) + 2 * MERC_MAX) % (2 * MERC_MAX) - MERC_MAX;
    for (let ez = ELEV_MAX_Z; ez >= 2; ez--) {
      const n = 2 ** ez, ts = tileSize(ez);
      const tx = Math.floor((mx + MERC_MAX) / ts), ty = Math.floor((MERC_MAX - my) / ts);
      if (ty < 0 || ty >= n) return { h: 0, ok: false };
      const e = this.elev.get(ez, tx, ty);
      if (e && e.data) {
        const px = ((mx + MERC_MAX) / ts - tx) * 256 - 0.5, py = ((MERC_MAX - my) / ts - ty) * 256 - 0.5;
        return { h: Math.max(sampleBilinear(e.data, px, py), 0), ok: true, z: ez, water: sampleBilinear(e.data, px, py) <= 0 };
      }
    }
    return { h: 0, ok: false };
  }
  // pede o relevo mais detalhado (zoom 13) do ponto, mesmo que nenhum tile de terreno o esteja usando ainda
  needElev(x, z) {
    const f = this.frame; let mx = f.localToMx(x); const my = f.localToMy(z);
    mx = ((mx + MERC_MAX) % (2 * MERC_MAX) + 2 * MERC_MAX) % (2 * MERC_MAX) - MERC_MAX;
    const ts = tileSize(ELEV_MAX_Z);
    this.elev.request(ELEV_MAX_Z, Math.floor((mx + MERC_MAX) / ts), Math.floor((MERC_MAX - my) / ts), 1);
  }
  // cor média da imagem de satélite (sRGB 0-255) na posição local, ou null
  colorAt(x, z) {
    const f = this.frame;
    let mx = f.localToMx(x); const my = f.localToMy(z);
    let n = this._colNode;
    if (!n || n.dead || mx < n.minX || mx >= n.minX + n.size || my > n.maxY || my <= n.maxY - n.size || !n.tex || !n.tex.pixels) {
      n = null;
      for (const r of this.roots) if (mx >= r.minX && mx < r.minX + r.size && my <= r.maxY && my > r.maxY - r.size) { n = r; break; }
      while (n && n.z < TREE_Z && n.children) { const i = (mx >= n.minX + n.size / 2 ? 1 : 0) + (my <= n.maxY - n.size / 2 ? 2 : 0); n = n.children[i]; }
      if (!n || n.z !== TREE_Z || !n.tex || !n.tex.pixels) return null;
      this._colNode = n;
    }
    const it = n.imgTile(), ss = 256 / it.s;
    const px = Math.min(255, Math.floor((n.wx - it.x * it.s) * ss + ((mx - n.minX) / n.size) * ss));
    const py = Math.min(255, Math.floor((n.y - it.y * it.s) * ss + ((n.maxY - my) / n.size) * ss));
    const o = (py * 256 + px) * 4, p = n.tex.pixels;
    return [p[o], p[o + 1], p[o + 2]];
  }
  update(camera, C, camAlt, maxDist) {
    const f = ++this.frameNo;
    this.schedE.update(f); this.schedI.update(f);
    camera.updateMatrixWorld();
    this.tmpM.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.tmpM);
    for (const n of this.rendered) if (n.mesh) n.mesh.visible = false;
    for (const n of this.rendered) if (n.trees) n.trees.visible = false;
    this.rendered.length = 0;
    this.C = C; this.camAlt = camAlt; this.maxDist = maxDist;
    for (const r of this.roots) this.select(r);
    const k = this.frame.k;
    for (const n of this.rendered) {
      const u = n.mesh.material.uniforms;
      u.uTileRel.value.set(this.frame.mercToLocalX(n.minX) - C.x, this.frame.mercToLocalZ(n.maxY) - C.z);
      u.uTileSize.value = n.size * k;
      const dx = (n.minX * k) % 64, dz = (-n.maxY * k) % 64; u.uDetOff.value.set(dx < 0 ? dx + 64 : dx, dz < 0 ? dz + 64 : dz);
      n.mesh.visible = true;
    }
    if (this.treesOn) this.updateTrees(C);
    if (f % 60 === 0) { this.prune(); this.texs.gc(); }
  }
  nodeDist(n) {
    const k = this.frame.k, C = this.C;
    const x0 = this.frame.mercToLocalX(n.minX) - C.x, z0 = this.frame.mercToLocalZ(n.maxY) - C.z, s = n.size * k;
    const dx = Math.max(x0 - 0, 0, 0 - (x0 + s)), dz = Math.max(z0 - 0, 0, 0 - (z0 + s));
    const dp = Math.hypot(dx, dz);
    const dh = this.camAlt - clamp(this.camAlt, n.minH, n.maxH);
    n._dp = dp; n._d = Math.hypot(dp, dh); n._cx = x0 + s / 2; n._cz = z0 + s / 2; n._s = s;
    return n._d;
  }
  visible(n) {
    const cd = Math.hypot(n._cx, n._cz);
    const th = cd / RE;
    if (th > 1.4) return false;
    const r = Math.max(cd, 1);
    const mh = (n.minH + n.maxH) / 2;
    const cy = mh * Math.cos(th) - RE * (1 - Math.cos(th));
    const scale = (RE + mh) * Math.sin(th) / r;
    this.sph.center.set(n._cx * scale, cy, n._cz * scale);
    this.sph.radius = n._s * 0.75 + (n.maxH - n.minH) * 0.5 + (n._s * n._s) / (4 * RE) + n._s * th * 0.5 + 50;
    return this.frustum.intersectsSphere(this.sph);
  }
  select(n) {
    n.lastUsed = this.frameNo;
    const d = this.nodeDist(n);
    if (n._dp > this.maxDist) return;
    if (n.z <= 3 && n._dp > Math.PI * RE * 0.6) return;
    const vis = this.visible(n);
    const prio = this.prio(n, vis);
    if (!n.ready) { n.request(prio); return; }
    const want = n.z < this.maxZ && d < n._s * this.splitF && (vis || d < n._s * 0.9) && n.z < 20;
    if (want) {
      const ch = n.ensureChildren();
      let all = true;
      for (const c of ch) {
        c.lastUsed = this.frameNo;
        if (!c.ready) {
          this.nodeDist(c);
          if (c._dp > this.maxDist) continue;
          c.request(this.prio(c, true)); if (!c.ready) all = false;
        }
      }
      if (all) { for (const c of ch) this.select(c); return; }
      // enquanto os filhos carregam, já pede os níveis mais finos que serão necessários
      for (const c of ch) this.prefetch(c, 0);
    }
    if (vis) this.rendered.push(n);
  }
  prio(n, vis) { return n.z + (4 * n._d) / (n._s * this.splitF) + (vis ? 0 : 8); }
  // tile ainda não carregado: estima a faixa de altitude pelo relevo já conhecido (evita pedir detalhe demais)
  estimate(c) {
    if (c.ready || c._est) return;
    const g = this.heightAt(this.frame.mercToLocalX(c.minX + c.size / 2), this.frame.mercToLocalZ(c.maxY - c.size / 2));
    if (!g.ok) return;
    const r = c.size * this.frame.k * 0.35;
    c.minH = g.h - r; c.maxH = g.h + r; c._est = g.z >= Math.min(c.z - 3, 12);
  }
  prefetch(n, depth) {
    if (n.z >= this.maxZ || depth > 8) return;
    this.nodeDist(n);
    if (n._dp > this.maxDist || n._d >= n._s * this.splitF) return;
    const vis = this.visible(n);
    if (!vis && n._d >= n._s * 0.9) return;
    for (const c of n.ensureChildren()) {
      c.lastUsed = this.frameNo;
      this.estimate(c);
      this.nodeDist(c);
      if (c._dp > this.maxDist) continue;
      if (!c.ready) c.request(this.prio(c, vis));
      this.prefetch(c, depth + 1);
    }
  }
  prune() {
    const old = this.frameNo - 90;
    const walk = (n) => {
      if (!n.children) return;
      if (n.children.every((c) => c.lastUsed < old)) { n.children.forEach((c) => c.dispose()); n.children = null; return; }
      n.children.forEach(walk);
    };
    this.roots.forEach(walk);
  }
  // árvores instanciadas nos tiles z16 próximos, posicionadas onde a imagem mostra floresta
  updateTrees(C) {
    const walk = (n) => {
      if (!n || n.z > TREE_Z || n.lastUsed !== this.frameNo) return;
      if (n.z === TREE_Z) {
        if (!n.ready) return;
        this.nodeDist(n);
        if (n._d > this.treeDist) return;
        if (!n.treesDone) { if (this.treeBudget-- > 0) this.buildTrees(n); else return; }
        if (n.trees) {
          n.trees.position.set(this.frame.mercToLocalX(n.minX) - C.x, 0, this.frame.mercToLocalZ(n.maxY) - C.z);
          const sc = this.frame.k / n.treeK; n.trees.scale.set(sc, 1, sc);
          n.trees.visible = true; n.trees.castShadow = this.shadows && n._d < this.shadowRange + 60; this.rendered.push(n); this.treeNodes.push(n);
        }
        return;
      }
      if (n.children) n.children.forEach(walk);
    };
    this.treeBudget = 2; this.treeNodes.length = 0;
    // garante que árvores sejam escondidas no próximo quadro
    this.roots.forEach(walk);
    this.updateNearTrees(C);
  }
  // LOD das árvores: as mais próximas trocam o modelo simples por um detalhado (tronco com casca, galhos, copa)
  setTreeLOD(bark, leaf, cap, radius, shadows) {
    this.shadows = shadows;
    for (const m of Object.values(this.near || {})) { this.treeGroup.remove(m); m.dispose(); }
    this.near = null; this.nearCap = cap; this.nearR = radius;
    for (const h of this.nearHidden) if (h[0].trees) { h[0].trees.setMatrixAt(h[1], h[2]); h[0].trees.instanceMatrix.needsUpdate = true; }
    this.nearHidden.length = 0; this.nearT = 0;
    if (!cap) return;
    this.near = {};
    for (const k of ['broad', 'conifer']) { const im = new THREE.InstancedMesh(this.detGeo[k], [bark, leaf], cap); im.count = 0; im.frustumCulled = false; im.castShadow = shadows; im.receiveShadow = shadows; this.treeGroup.add(im); this.near[k] = im; }
  }
  updateNearTrees(C) {
    if (!this.near) return;
    const f = this.frame, now = performance.now();
    if (now - this.nearT > 280) {
      this.nearT = now;
      for (const h of this.nearHidden) if (h[0].trees) { h[0].trees.setMatrixAt(h[1], h[2]); h[0].trees.instanceMatrix.needsUpdate = true; }
      this.nearHidden.length = 0;
      const cand = [], R2 = this.nearR * this.nearR;
      for (const n of this.treeNodes) {
        if (!n.treeData || !n.trees) continue;
        const ox = f.mercToLocalX(n.minX) - C.x, oz = f.mercToLocalZ(n.maxY) - C.z, sc = f.k / n.treeK;
        if (ox > this.nearR || oz > this.nearR || ox + n.size * f.k < -this.nearR || oz + n.size * f.k < -this.nearR) continue;
        n.treeData.forEach((t, i) => { const dx = ox + t.x * sc, dz = oz + t.z * sc, d = dx * dx + dz * dz; if (d < R2) cand.push([d, n, i, dx, dz]); });
      }
      cand.sort((a, b) => a[0] - b[0]);
      this.nearMx = f.localToMx(C.x); this.nearMy = f.localToMy(C.z);
      const cnt = { broad: 0, conifer: 0 }, M = this._m4, Q = this._q, P = this._v1, S = this._v2, col = this._col;
      for (const [, n, i, dx, dz] of cand) {
        const t = n.treeData[i], k = t.broad ? 'broad' : 'conifer';
        if (cnt[k] >= this.nearCap) continue;
        Q.setFromAxisAngle(this._up, t.rot);
        this.near[k].setMatrixAt(cnt[k], M.compose(P.set(dx, t.y, dz), Q, S.set(t.w, t.th, t.w)));
        this.near[k].setColorAt(cnt[k], col.setRGB(t.c[0], t.c[1], t.c[2]));
        cnt[k]++;
        const old = new THREE.Matrix4(); n.trees.getMatrixAt(i, old);
        this.nearHidden.push([n, i, old]); n.trees.setMatrixAt(i, this._zero); n.trees.instanceMatrix.needsUpdate = true;
      }
      for (const k of ['broad', 'conifer']) { const im = this.near[k]; im.count = cnt[k]; im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true; }
    }
    const x = f.mercToLocalX(this.nearMx) - C.x, z = f.mercToLocalZ(this.nearMy) - C.z;
    this.near.broad.position.set(x, 0, z); this.near.conifer.position.set(x, 0, z);
  }
  refreshTrees(x0, z0, size) {
    const f = this.frame;
    const walk = (n) => {
      if (n.z > TREE_Z) return;
      const nx = f.mercToLocalX(n.minX), nz = f.mercToLocalZ(n.maxY), ns = n.size * f.k;
      if (nx > x0 + size || nz > z0 + size || nx + ns < x0 || nz + ns < z0) return;
      if (n.z === TREE_Z) {
        if (!n.treesDone) return;
        this.nearHidden = this.nearHidden.filter((h) => h[0] !== n); this.nearT = 0;
        if (n.trees) { this.treeGroup.remove(n.trees); n.trees.dispose(); n.trees = null; n.treeData = null; }
        if (n.treePg) { this.physics?.removeGroup(n.treePg); n.treePg = null; }
        n.treesDone = false; return;
      }
      n.children?.forEach(walk);
    };
    this.roots.forEach(walk);
  }
  buildTrees(n) {
    n.treesDone = true;
    const e = n.tex;
    if (!e || !e.pixels || !n.heights) return;
    const it = n.imgTile(); const ss = 256 / it.s;
    const ox = (n.wx - it.x * it.s) * ss, oy = (n.y - it.y * it.s) * ss;
    const rnd = mulberry(n.wx * 7919 + n.y * 104729);
    const sizeL = n.size * this.frame.k;
    const mats = [], cols = [], data = [], items = [];
    const ox0 = this.frame.mercToLocalX(n.minX), oz0 = this.frame.mercToLocalZ(n.maxY);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    const snowLine = this.G.uSnowLine.value, upY = new THREE.Vector3(0, 1, 0);
    const tries = this.treeCount * 3;
    const alat = Math.abs(this.frame.toLatLon(this.frame.mercToLocalX(n.minX), this.frame.mercToLocalZ(n.maxY)).lat);
    // pinheiros só no frio: latitudes altas ou montanha; no resto, copas arredondadas
    const broad = alat < 37 || (alat < 57 && n.minH < 750);
    for (let t = 0; t < tries && mats.length < this.treeCount; t++) {
      const u = rnd(), v = rnd();
      const px = Math.min(255, Math.floor(ox + u * ss)), py = Math.min(255, Math.floor(oy + v * ss));
      const o = (py * 256 + px) * 4;
      const r = e.pixels[o], g = e.pixels[o + 1], b = e.pixels[o + 2];
      const lum = (r + g + b) / 3;
      if (!(lum < 88 && lum > 10 && g > r * 1.06 && g > b * 1.2)) continue;
      const h = n.heightUV(u, v);
      if (h < 1) continue;
      const hx = n.heightUV(u + 0.02, v) - n.heightUV(u - 0.02, v), hz = n.heightUV(u, v + 0.02) - n.heightUV(u, v - 0.02);
      const slope = Math.hypot(hx, hz) / (sizeL * 0.04);
      if (slope > 1.4) continue;
      if (this.treeFilter && !this.treeFilter(ox0 + u * sizeL, oz0 + v * sizeL)) continue; // não nasce em rua, calçada nem dentro de casa
      const th = broad ? 6 + rnd() * 9 : 9 + rnd() * 17 * (lum < 50 ? 1.2 : 0.8);
      p.set(u * sizeL, h - 0.5, v * sizeL);
      const rot = rnd() * 6.28; q.setFromAxisAngle(upY, rot);
      const w = th * (broad ? 0.75 + rnd() * 0.3 : 0.38 + rnd() * 0.17);
      s.set(w, th, w);
      m.compose(p, q, s); mats.push(m.clone());
      const snow = clamp((h - snowLine + 200) / 400, 0, 1) * 0.75;
      const c = 0.75 + rnd() * 0.5;
      cols.push([c * (1 - snow) + 16 * snow, c * (1 - snow) + 9 * snow, c * (1 - snow) + 19 * snow]);
      data.push({ x: u * sizeL, z: v * sizeL, y: h - 0.5, th, w, rot, broad, c: [c * (1 - snow) + 3 * snow, c * (1 - snow) + 2.4 * snow, c * (1 - snow) + 3.2 * snow] });
      // colisão só no tronco: raio do tronco, do chão até onde a copa começa — folhas e galhos não bloqueiam
      items.push({ t: 'c', x: u * sizeL, z: v * sizeL, r: Math.max(0.15, w * 0.045), y0: h - 1.5, y1: h - 0.5 + th * (broad ? 0.42 : 0.2), walk: false, tag: 'tree', id: `tree:${n.wx}/${n.y}:${Math.round(u * 4096)}:${Math.round(v * 4096)}`, ax: u * sizeL, az: v * sizeL, ay: h + 1.1 });
    }
    if (!mats.length) return;
    const im = new THREE.InstancedMesh(broad ? this.treeGeoB : this.treeGeo, this.treeMat, mats.length);
    const col = new THREE.Color();
    mats.forEach((mm, i) => { im.setMatrixAt(i, mm); im.setColorAt(i, col.setRGB(...cols[i])); });
    im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere(); im.visible = false; im.castShadow = !!this.shadows;
    n.trees = im; n.treeK = this.frame.k; n.treeData = data;
    if (this.physics) n.treePg = this.physics.addGroup(n.minX, n.maxY, this.frame.k, sizeL, items);
    this.treeGroup.add(im);
  }
  get loading() { return this.schedE.pending + this.schedI.pending; }
}
