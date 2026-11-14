// Efeitos: rastros de vapor nas mãos, cone de choque supersônico, anel do estrondo, spray de neve/água/poeira.
import * as THREE from 'three';
import { clamp } from './geo.js';

const TRAIL_VERT = /* glsl */`
#include <common>
#include <logdepthbuf_pars_vertex>
attribute float alpha; varying float vA;
void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); vA = alpha * smoothstep(1.5, 7.0, length(mv.xyz)); gl_Position = projectionMatrix * mv;
  #include <logdepthbuf_vertex>
}`;
const TRAIL_FRAG = /* glsl */`
#include <common>
#include <logdepthbuf_pars_fragment>
uniform vec3 uCol; varying float vA;
void main(){
  #include <logdepthbuf_fragment>
  gl_FragColor = vec4(uCol, vA); }`;

class Trail {
  constructor(scene, n = 48) {
    this.n = n; this.pts = []; // pontos em coordenadas de mundo (double)
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(n * 2 * 3); this.al = new Float32Array(n * 2);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('alpha', new THREE.BufferAttribute(this.al, 1));
    const idx = [];
    for (let i = 0; i < n - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    g.setIndex(idx);
    this.mat = new THREE.ShaderMaterial({ vertexShader: TRAIL_VERT, fragmentShader: TRAIL_FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      uniforms: { uCol: { value: new THREE.Color(1, 1, 1) } } });
    this.mesh = new THREE.Mesh(g, this.mat); this.mesh.frustumCulled = false; this.mesh.renderOrder = 7;
    scene.add(this.mesh); this.geo = g;
  }
  push(p) { this.pts.unshift(p); if (this.pts.length > this.n) this.pts.pop(); }
  update(C, camPos, strength, light, tint) {
    const P = this.pts, n = P.length;
    this.mesh.visible = n > 2 && strength > 0.01;
    if (!this.mesh.visible) return;
    this.mat.uniforms.uCol.value.setRGB(light * tint.r, light * tint.g, light * tint.b);
    const side = new THREE.Vector3(), d = new THREE.Vector3(), v = new THREE.Vector3();
    for (let i = 0; i < this.n; i++) {
      const ii = Math.min(i, n - 1);
      const p = P[ii];
      const q = ii < n - 1 ? P[ii + 1] : P[ii - 1];
      const px = p.x - C.x, py = p.y, pz = p.z - C.z;
      d.set(q.x - p.x, q.y - p.y, q.z - p.z);
      if (ii >= n - 1) d.negate();
      if (d.lengthSq() < 1e-8) d.set(0, 0, 1);
      d.normalize();
      v.set(px - camPos.x, py - camPos.y, pz - camPos.z).normalize();
      side.crossVectors(d, v).normalize();
      const t = i / (this.n - 1);
      const w = 0.03 + t * 0.55;
      this.pos.set([px + side.x * w, py + side.y * w, pz + side.z * w, px - side.x * w, py - side.y * w, pz - side.z * w], i * 6);
      const a = i >= n - 1 ? 0 : strength * (1 - t) * (1 - t) * Math.min(1, i / 2);
      this.al[i * 2] = a; this.al[i * 2 + 1] = a;
    }
    this.geo.attributes.position.needsUpdate = true; this.geo.attributes.alpha.needsUpdate = true;
  }
  clear() { this.pts.length = 0; }
}

const SHOCK_VERT = /* glsl */`
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec3 vN; varying vec3 vV; varying vec2 vUv;
void main(){ vUv = uv; vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
  #include <logdepthbuf_vertex>
}`;
const SHOCK_FRAG = /* glsl */`
#include <common>
#include <logdepthbuf_pars_fragment>
uniform float uI; uniform float uT; uniform vec3 uCol;
varying vec3 vN; varying vec3 vV; varying vec2 vUv;
float h21(vec2 p){ p = fract(p*vec2(123.34, 456.21)); p += dot(p, p+45.32); return fract(p.x*p.y); }
float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(h21(i), h21(i+vec2(1,0)), f.x), mix(h21(i+vec2(0,1)), h21(i+vec2(1,1)), f.x), f.y); }
void main(){
  #include <logdepthbuf_fragment>
  float fr = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.0);
  float n = vn(vec2(vUv.x*24.0, vUv.y*6.0 - uT*30.0));
  float swirl = vn(vec2(vUv.x*8.0 + vUv.y*6.0 + uT*4.0, vUv.y*3.0));
  float a = uI * (0.25 + fr*0.9) * (0.5 + n*0.7) * smoothstep(0.0, 0.25, vUv.y) * smoothstep(1.0, 0.55, vUv.y) * (0.6 + swirl*0.6);
  gl_FragColor = vec4(uCol, a);
}`;

export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.trailL = new Trail(scene); this.trailR = new Trail(scene); this.tint = new THREE.Color(1, 1, 1);
    // cone de vapor / choque
    const cg = new THREE.CylinderGeometry(0.15, 3.2, 7, 32, 8, true);
    cg.translate(0, -3.2, 0); cg.rotateX(-Math.PI / 2); // ponta na cabeça, abre para trás (+Z local)
    this.shockMat = new THREE.ShaderMaterial({ vertexShader: SHOCK_VERT, fragmentShader: SHOCK_FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      uniforms: { uI: { value: 0 }, uT: { value: 0 }, uCol: { value: new THREE.Color(1, 1, 1) } } });
    this.shock = new THREE.Mesh(cg, this.shockMat); this.shock.frustumCulled = false; this.shock.renderOrder = 8;
    scene.add(this.shock);
    // anel do estrondo sônico
    this.ring = new THREE.Mesh(new THREE.TorusGeometry(1, 0.08, 8, 64), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false }));
    this.ring.frustumCulled = false; this.ring.renderOrder = 8; scene.add(this.ring);
    this.ringT = 99; this.ringPos = { x: 0, y: 0, z: 0 }; this.ringDir = new THREE.Vector3();
    // partículas
    this.NP = 1500;
    this.pw = new Float64Array(this.NP * 3); this.pv = new Float32Array(this.NP * 3); this.pl = new Float32Array(this.NP); this.pmax = new Float32Array(this.NP); this.pgrow = new Float32Array(this.NP);
    const g = new THREE.BufferGeometry();
    this.ppos = new Float32Array(this.NP * 3); this.pcol = new Float32Array(this.NP * 4); this.psz = new Float32Array(this.NP);
    g.setAttribute('position', new THREE.BufferAttribute(this.ppos, 3));
    g.setAttribute('pcol', new THREE.BufferAttribute(this.pcol, 4));
    g.setAttribute('psz', new THREE.BufferAttribute(this.psz, 1));
    this.pmat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false,
      vertexShader: `#include <common>
#include <logdepthbuf_pars_vertex>
attribute vec4 pcol; attribute float psz; varying vec4 vC; uniform float uPx;
void main(){ vC = pcol; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix*mv; gl_PointSize = clamp(psz*uPx/ -mv.z, 0.0, 300.0);
#include <logdepthbuf_vertex>
}`,
      fragmentShader: `#include <common>
#include <logdepthbuf_pars_fragment>
varying vec4 vC; void main(){
#include <logdepthbuf_fragment>
vec2 c = gl_PointCoord-0.5; float a = smoothstep(0.5, 0.0, length(c)); gl_FragColor = vec4(vC.rgb, vC.a*a); }`,
      uniforms: { uPx: { value: 600 } } });
    this.points = new THREE.Points(g, this.pmat); this.points.frustumCulled = false; this.points.renderOrder = 9;
    scene.add(this.points); this.pgeo = g; this.pi = 0;
    this.t = 0;
  }
  emit(x, y, z, vx, vy, vz, life, size, kind) {
    const i = this.pi; this.pi = (this.pi + 1) % this.NP;
    this.pw[i * 3] = x; this.pw[i * 3 + 1] = y; this.pw[i * 3 + 2] = z;
    this.pv[i * 3] = vx; this.pv[i * 3 + 1] = vy; this.pv[i * 3 + 2] = vz;
    this.pl[i] = life; this.pmax[i] = life;
    this.psz[i] = size; this.pgrow[i] = kind === 'water' ? size * 0.9 : 6;
    const c = kind === 'snow' ? [1, 1, 1.05] : kind === 'water' ? [0.85, 0.9, 0.95] : [0.55, 0.47, 0.38];
    this.pcol[i * 4] = c[0]; this.pcol[i * 4 + 1] = c[1]; this.pcol[i * 4 + 2] = c[2];
  }
  burst(p, kind, n = 120, power = 1) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * 6.283, s = (5 + Math.random() * 25) * power;
      const w = kind === 'water';
      this.emit(p.x, (w ? Math.max(p.waterLevel || 0, p.ground) : p.ground) + 0.5, p.z, Math.cos(a) * s * (w ? 0.5 : 1), (4 + Math.random() * 18) * power * (w ? 0.6 : 1), Math.sin(a) * s * (w ? 0.5 : 1), w ? 0.7 + Math.random() * 0.8 : 1.5 + Math.random() * 1.5, w ? 1 + Math.random() * 2 : 3 + Math.random() * 5, kind);
    }
  }
  boom(p, f) { this.ringT = 0; this.ringPos = { x: p.x, y: p.y, z: p.z }; this.ringDir.copy(f); }
  clear() { this.trailL.clear(); this.trailR.clear(); this.pl.fill(0); }
  update(dt, p, C, camera, avatar, env) {
    this.t += dt;
    const f = p.forward(new THREE.Vector3());
    const m = p.mach, rho = Math.exp(-Math.max(p.y, 0) / 8500);
    // rastros das mãos (avatar está em coordenadas relativas à câmera)
    const vis = (p.mode === 'fly' || p.mode === 'glide') && p.speed > 90;
    const str = vis ? clamp((p.speed - 90) / 200, 0, 1) * 0.6 * clamp(rho * 1.4, 0, 1) * (0.35 + env.humidity * 0.5) : 0;
    for (const [tr, h] of [[this.trailL, avatar.handL], [this.trailR, avatar.handR]]) {
      if (vis) tr.push({ x: h.x + C.x, y: h.y, z: h.z + C.z }); else tr.clear();
      tr.update(C, camera.position, str, env.light, this.tint);
    }
    // cone de choque/vapor
    const near1 = Math.exp(-((m - 1) ** 2) / 0.006);
    const sup = clamp((m - 1.05) / 2, 0, 1) * 0.55;
    const I = (near1 * 0.9 + sup) * clamp(rho * 1.5, 0, 1) * (p.mode === 'fly' || p.mode === 'glide' ? 1 : 0);
    this.shockMat.uniforms.uI.value = I; this.shockMat.uniforms.uT.value = this.t;
    this.shockMat.uniforms.uCol.value.setRGB(env.light, env.light, env.light);
    this.shock.visible = I > 0.01;
    if (this.shock.visible) {
      this.shock.position.set(p.x - C.x + f.x * 1.3, p.y + f.y * 1.3, p.z - C.z + f.z * 1.3);
      this.shock.lookAt(this.shock.position.clone().sub(f));
      const st = 1 + clamp(m - 1, 0, 4) * 0.35;
      this.shock.scale.set(1 / Math.sqrt(st), 1 / Math.sqrt(st), st);
    }
    // anel
    this.ringT += dt;
    const ro = this.ring.material;
    ro.opacity = this.ringT < 1.2 ? (1 - this.ringT / 1.2) * 0.7 : 0;
    this.ring.visible = ro.opacity > 0.01;
    if (this.ring.visible) {
      const r = 2 + this.ringT * 60;
      this.ring.scale.setScalar(r);
      this.ring.position.set(this.ringPos.x - C.x, this.ringPos.y, this.ringPos.z - C.z);
      this.ring.lookAt(this.ring.position.clone().add(this.ringDir));
      ro.color.setRGB(env.light, env.light, env.light);
    }
    // spray ao voar rente ao chão
    if ((p.mode === 'fly' || p.mode === 'glide') && p.agl < 35 && p.speed > 30) {
      const kind = p.onWater ? 'water' : env.snowy ? 'snow' : 'dust';
      const n = Math.min(Math.floor(p.speed / 10 * (1 - p.agl / 35)), 25);
      for (let i = 0; i < n; i++) {
        const s = p.speed * 0.25;
        this.emit(p.x - f.x * (2 + Math.random() * 6) + (Math.random() - 0.5) * 4, p.ground + 0.3, p.z - f.z * (2 + Math.random() * 6) + (Math.random() - 0.5) * 4,
          (Math.random() - 0.5) * s + f.x * s, 3 + Math.random() * 12 * (1 - p.agl / 40), (Math.random() - 0.5) * s + f.z * s, 1 + Math.random() * 1.6, 2.5 + Math.random() * 4, kind);
      }
    }
    // integra partículas
    for (let i = 0; i < this.NP; i++) {
      const l = this.pl[i];
      if (l <= 0) { this.pcol[i * 4 + 3] = 0; this.ppos[i * 3 + 1] = -1e7; continue; }
      this.pl[i] = l - dt;
      this.pv[i * 3] *= 1 - dt * 1.5; this.pv[i * 3 + 2] *= 1 - dt * 1.5; this.pv[i * 3 + 1] = this.pv[i * 3 + 1] * (1 - dt * 1.2) - 4 * dt;
      this.pw[i * 3] += this.pv[i * 3] * dt; this.pw[i * 3 + 1] += this.pv[i * 3 + 1] * dt; this.pw[i * 3 + 2] += this.pv[i * 3 + 2] * dt;
      this.ppos[i * 3] = this.pw[i * 3] - C.x; this.ppos[i * 3 + 1] = this.pw[i * 3 + 1]; this.ppos[i * 3 + 2] = this.pw[i * 3 + 2] - C.z;
      const t = this.pl[i] / this.pmax[i];
      this.pcol[i * 4 + 3] = Math.min(t * 1.5, 1) * 0.75;
      this.psz[i] += dt * this.pgrow[i];
      const L = env.light;
      if (i % 1 === 0) { /* luz */ }
    }
    this.pmat.uniforms.uPx.value = window.innerHeight * 0.9 * env.pr;
    this.pgeo.attributes.position.needsUpdate = true; this.pgeo.attributes.pcol.needsUpdate = true; this.pgeo.attributes.psz.needsUpdate = true;
  }
}
