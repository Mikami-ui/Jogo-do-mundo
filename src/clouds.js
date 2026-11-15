// Nuvens locais (aglomerados de "puffs" em billboard) e precipitação (chuva/neve) ao redor da câmera.
import * as THREE from 'three';
import { ATMO_GLSL } from './atmosphere.js';
import { hash2, mulberry } from './geo.js';

const CLOUD_VERT = /* glsl */`
#include <common>
#include <logdepthbuf_pars_vertex>
${ATMO_GLSL}
attribute vec3 offset; attribute vec2 sz;
uniform vec3 uAnchor; uniform float uScale;
varying vec2 vC; varying vec3 vAer; varying vec3 vT; varying float vA; varying float vSeed; varying vec3 vView; varying float vLow;
void main(){
  vec3 wp = vec3(uAnchor.x + offset.x*uScale, offset.y, uAnchor.z + offset.z*uScale);
  float d = length(wp.xz);
  wp.y -= d*d/(2.0*ATM_R);
  vec4 mv = viewMatrix * vec4(wp, 1.0);
  float s = sz.x;
  mv.xy += position.xy * s;
  gl_Position = projectionMatrix * mv;
  #include <logdepthbuf_vertex>
  vC = position.xy * 2.0; vSeed = sz.y;
  vec3 rel = wp - vec3(0.0, uCamAlt, 0.0);
  float L = length(rel);
  vView = rel / L;
  vec3 T; vAer = aerial(uCamAlt, wp.y, L, dot(vView, uSunDir), uSunDir.y, T); vT = T;
  vA = smoothstep(s*0.15, s*0.9, -mv.z) * (1.0 - smoothstep(26000.0, 34000.0, d));
  vLow = offset.y;
}`;
const CLOUD_FRAG = /* glsl */`
#include <common>
#include <logdepthbuf_pars_fragment>
${ATMO_GLSL}
uniform float uDark; uniform float uOpacity;
varying vec2 vC; varying vec3 vAer; varying vec3 vT; varying float vA; varying float vSeed; varying vec3 vView; varying float vLow;
float h21(vec2 p){ p = fract(p*vec2(123.34, 456.21)); p += dot(p, p+45.32); return fract(p.x*p.y); }
float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(h21(i), h21(i+vec2(1,0)), f.x), mix(h21(i+vec2(0,1)), h21(i+vec2(1,1)), f.x), f.y); }
void main(){
  #include <logdepthbuf_fragment>
  vec2 q = vC + vSeed*13.0;
  float n = vn(q*1.6)*0.5 + vn(q*3.7)*0.3 + vn(q*8.1)*0.2;
  float r = length(vC);
  float a = smoothstep(1.0, 0.25, r + (n - 0.5)*0.75);
  if (a < 0.01) discard;
  float top = clamp(vC.y*0.5 + 0.5 + (n-0.5)*0.4, 0.0, 1.0);
  vec3 ts = sunTransmit(vLow, uSunDir.y);
  float fwd = pow(max(dot(vView, uSunDir), 0.0), 6.0);
  float shade = mix(0.42, 1.05, top) * (1.0 - uDark*0.55);
  vec3 col = ts*SUNK*(shade*0.95 + fwd*0.6) + uAmbient*(1.0 + top*0.5) + vec3(0.003,0.004,0.008);
  col = col*vT + vAer;
  gl_FragColor = vec4(col, a * vA * uOpacity);
}`;

export class Clouds {
  constructor(scene, G, frame) {
    this.frame = frame; this.G = G;
    this.MAX = 2600;
    const base = new THREE.PlaneGeometry(1, 1);
    const g = new THREE.InstancedBufferGeometry();
    g.index = base.index; g.setAttribute('position', base.attributes.position);
    this.offset = new THREE.InstancedBufferAttribute(new Float32Array(this.MAX * 3), 3);
    this.sz = new THREE.InstancedBufferAttribute(new Float32Array(this.MAX * 2), 2);
    this.offset.setUsage(THREE.DynamicDrawUsage); this.sz.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('offset', this.offset); g.setAttribute('sz', this.sz);
    g.instanceCount = 0;
    this.geo = g;
    this.mat = new THREE.ShaderMaterial({ vertexShader: CLOUD_VERT, fragmentShader: CLOUD_FRAG, transparent: true, depthWrite: false,
      uniforms: { ...G, uAnchor: { value: new THREE.Vector3() }, uScale: { value: 1 }, uDark: { value: 0 }, uOpacity: { value: 1 } } });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false; this.mesh.renderOrder = 4;
    scene.add(this.mesh);
    this.cover = -1; this.base = 2000; this.cellKey = ''; this.puffs = []; this.sortT = 0;
    this.CM = 4200; // tamanho da célula em metros Mercator
  }
  set(cover, base, dark) {
    if (Math.abs(cover - this.cover) > 0.02 || Math.abs(base - this.base) > 50) { this.cover = cover; this.base = base; this.cellKey = ''; }
    this.mat.uniforms.uDark.value = dark;
  }
  rebuild(mx, my) {
    const CM = this.CM, cx = Math.floor(mx / CM), cy = Math.floor(my / CM);
    const key = cx + ',' + cy;
    if (key === this.cellKey) return;
    this.cellKey = key;
    this.anchorMx = cx * CM; this.anchorMy = cy * CM; this.k0 = this.frame.k;
    const k = this.frame.k, R = 8;
    const puffs = [];
    const cov = this.cover;
    for (let j = -R; j <= R; j++) for (let i = -R; i <= R; i++) {
      const gx = cx + i, gy = cy + j;
      const hsh = hash2(gx, gy, 7);
      if (hsh > cov * 0.95) continue;
      const rnd = mulberry((gx * 73856093) ^ (gy * 19349663));
      const ccx = (i + rnd()) * CM * k, ccz = -(j + rnd()) * CM * k;
      const size = (500 + rnd() * 1100) * (0.7 + cov * 0.6);
      const big = cov > 0.75 ? 1.6 : 1;
      const count = Math.floor(5 + rnd() * 6 + cov * 8);
      const top = this.base + rnd() * 250;
      for (let p = 0; p < count && puffs.length < this.MAX; p++) {
        const ang = rnd() * 6.283, rr = Math.sqrt(rnd()) * size * big;
        const ox = ccx + Math.cos(ang) * rr, oz = ccz + Math.sin(ang) * rr;
        const edge = 1 - rr / (size * big);
        const oy = top + rnd() * size * 0.55 * (0.4 + edge);
        const s = (420 + rnd() * 650) * (0.6 + edge * 0.7) * (0.8 + cov * 0.5);
        puffs.push([ox, oy, oz, s, rnd()]);
      }
    }
    this.puffs = puffs;
    this.sortT = 0;
  }
  update(dt, C) {
    const f = this.frame;
    this.rebuild(f.localToMx(C.x), f.localToMy(C.z));
    const ax = f.mercToLocalX(this.anchorMx) - C.x, az = f.mercToLocalZ(this.anchorMy) - C.z;
    this.mat.uniforms.uAnchor.value.set(ax, 0, az);
    const sc = f.k / this.k0; this.mat.uniforms.uScale.value = sc;
    this.sortT -= dt;
    if (this.sortT <= 0) {
      this.sortT = 0.25;
      const ps = this.puffs, camY = this.G.uCamAlt.value;
      for (const p of ps) { const dx = ax + p[0] * sc, dz = az + p[2] * sc, dy = p[1] - camY; p.d = dx * dx + dy * dy + dz * dz; }
      ps.sort((a, b) => b.d - a.d);
      const o = this.offset.array, s = this.sz.array;
      for (let i = 0; i < ps.length; i++) { const p = ps[i]; o[i * 3] = p[0]; o[i * 3 + 1] = p[1]; o[i * 3 + 2] = p[2]; s[i * 2] = p[3]; s[i * 2 + 1] = p[4]; }
      this.offset.needsUpdate = true; this.sz.needsUpdate = true;
      this.geo.instanceCount = ps.length;
    }
    const alt = this.G.uCamAlt.value;
    this.mat.uniforms.uOpacity.value = 1 - Math.min(Math.max((alt - 14000) / 8000, 0), 1);
    this.mesh.visible = this.puffs.length > 0 && this.mat.uniforms.uOpacity.value > 0.01;
  }
}

// ---------------- precipitação ----------------
const PRECIP_VERT = /* glsl */`
#include <common>
#include <logdepthbuf_pars_vertex>
uniform vec3 uOff; uniform float uBox; uniform float uTime; uniform float uSnow; uniform vec3 uWind; uniform float uCamY; uniform vec3 uVel;
attribute float side;
varying float vA;
void main(){
  vec3 fall = uSnow > 0.5 ? vec3(sin(uTime*0.7 + position.x*40.0)*0.8, -1.4, cos(uTime*0.5 + position.z*30.0)*0.8) : vec3(0.0, -9.0, 0.0);
  fall += uWind;
  vec3 p = mod(position*uBox + fall*uTime - uOff, uBox) - uBox*0.5;
  vec3 streak = uSnow > 0.5 ? vec3(0.0) : (fall - uVel) * 0.03;
  p -= streak * side;
  p.y += uCamY;
  vA = 1.0 - smoothstep(uBox*0.3, uBox*0.5, length(p - vec3(0.0, uCamY, 0.0)));
  vec4 mv = viewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = uSnow > 0.5 ? clamp(90.0 / -mv.z, 1.5, 9.0) : 1.0;
  #include <logdepthbuf_vertex>
}`;
const PRECIP_FRAG = /* glsl */`
#include <common>
#include <logdepthbuf_pars_fragment>
uniform vec3 uCol; uniform float uAmt; uniform float uSnow;
varying float vA;
void main(){
  #include <logdepthbuf_fragment>
  float a = vA * uAmt;
  if (uSnow > 0.5) { vec2 c = gl_PointCoord - 0.5; a *= smoothstep(0.5, 0.15, length(c)); }
  gl_FragColor = vec4(uCol, a * (uSnow > 0.5 ? 0.9 : 0.35));
}`;
export class Precip {
  constructor(scene) {
    const n = 6000;
    const pos = new Float32Array(n * 2 * 3), side = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      const x = Math.random(), y = Math.random(), z = Math.random();
      pos.set([x, y, z, x, y, z], i * 6); side[i * 2] = 0; side[i * 2 + 1] = 1;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('side', new THREE.BufferAttribute(side, 1));
    this.uniforms = { uOff: { value: new THREE.Vector3() }, uBox: { value: 60 }, uTime: { value: 0 }, uSnow: { value: 0 }, uWind: { value: new THREE.Vector3() },
      uCamY: { value: 0 }, uVel: { value: new THREE.Vector3() }, uCol: { value: new THREE.Color(1, 1, 1) }, uAmt: { value: 0 } };
    const mat = new THREE.ShaderMaterial({ vertexShader: PRECIP_VERT, fragmentShader: PRECIP_FRAG, uniforms: this.uniforms, transparent: true, depthWrite: false });
    this.lines = new THREE.LineSegments(g, mat);
    this.points = new THREE.Points(g, mat);
    [this.lines, this.points].forEach((m) => { m.frustumCulled = false; m.renderOrder = 6; m.visible = false; scene.add(m); });
    this.t = 0;
  }
  update(dt, C, camY, type, amount, wind, vel, light) {
    this.t += dt;
    const u = this.uniforms;
    const box = type === 'snow' ? 70 : 50;
    u.uBox.value = box; u.uTime.value = this.t % 1000;
    u.uOff.value.set(((C.x % box) + box) % box, ((camY % box) + box) % box, ((C.z % box) + box) % box);
    u.uCamY.value = camY; u.uSnow.value = type === 'snow' ? 1 : 0;
    u.uWind.value.copy(wind); u.uVel.value.copy(vel);
    u.uAmt.value = amount;
    u.uCol.value.setRGB(light, light, light * 1.05);
    this.lines.visible = type === 'rain' && amount > 0.01;
    this.points.visible = type === 'snow' && amount > 0.01;
  }
}
