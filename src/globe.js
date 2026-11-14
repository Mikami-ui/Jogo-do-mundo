// Globo inteiro (visto da órbita), camada global de nuvens e céu físico.
import * as THREE from 'three';
import { ATMO_GLSL } from './atmosphere.js';
import { RE, DEG, latToMy, MERC_MAX } from './geo.js';
import { IMAGERY } from './terrain.js';

function sphereGeometry(w, h) {
  const pos = [], uv = [], idx = [];
  for (let j = 0; j <= h; j++) {
    const lat = (j / h - 0.5) * Math.PI;
    for (let i = 0; i <= w; i++) {
      const lon = (i / w - 0.5) * 2 * Math.PI;
      pos.push(Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat));
      uv.push(i / w, j / h);
    }
  }
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const a = j * (w + 1) + i, b = a + 1, c = a + w + 1, d = c + 1;
    idx.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

// monta textura equirretangular a partir de tiles Web Mercator
async function mercatorToEquirect(urlFn, z, W) {
  const n = 2 ** z, T = 256;
  const merc = document.createElement('canvas'); merc.width = merc.height = n * T;
  const mc = merc.getContext('2d');
  let ok = 0;
  const jobs = [];
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    jobs.push(fetch(urlFn(z, x, y), { mode: 'cors' }).then((r) => { if (!r.ok) throw 0; return r.blob(); })
      .then((b) => createImageBitmap(b)).then((bmp) => { mc.drawImage(bmp, x * T, y * T); ok++; }).catch(() => {}));
  }
  await Promise.all(jobs);
  if (ok < (n * n) / 2) return null;
  const out = document.createElement('canvas'); out.width = W; out.height = W / 2;
  const oc = out.getContext('2d');
  oc.fillStyle = '#dfe6ee'; oc.fillRect(0, 0, W, W / 2);
  for (let r = 0; r < W / 2; r++) {
    const lat = 90 - ((r + 0.5) / (W / 2)) * 180;
    if (Math.abs(lat) > 85) continue;
    const my = latToMy(lat);
    const sy = ((MERC_MAX - my) / (2 * MERC_MAX)) * n * T;
    oc.drawImage(merc, 0, Math.floor(sy), n * T, 1, 0, r, W, 1);
  }
  return out;
}

const GLOBE_VERT = /* glsl */`
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec2 vUv; varying vec3 vUp; varying vec3 vWp;
void main(){
  vUv = uv;
  vUp = normalize(mat3(modelMatrix) * position);
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWp = wp.xyz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  #include <logdepthbuf_vertex>
}`;
const GLOBE_FRAG = /* glsl */`
#include <common>
#include <logdepthbuf_pars_fragment>
${ATMO_GLSL}
uniform sampler2D uDay; uniform sampler2D uNight; uniform float uHasDay; uniform float uHasNight;
varying vec2 vUv; varying vec3 vUp; varying vec3 vWp;
void main(){
  #include <logdepthbuf_fragment>
  vec3 up = normalize(vUp);
  float mu = dot(up, uSunDir);
  vec3 alb = uHasDay > 0.5 ? texture2D(uDay, vUv).rgb : mix(vec3(0.01,0.03,0.08), vec3(0.06,0.08,0.04), step(0.5, fract(vUv.x*3.0)));
  vec3 ts = sunTransmit(0.0, mu);
  vec3 light = ts * SUNK * (0.3 + 0.85*max(mu, 0.0)) + vec3(0.02,0.03,0.05)*smoothstep(-0.2, 0.2, mu);
  vec3 col = alb * light;
  if (uHasNight > 0.5) {
    vec3 nl = texture2D(uNight, vUv).rgb;
    col += nl * nl * 0.25 * smoothstep(0.05, -0.12, mu) * vec3(1.0, 0.8, 0.55);
  }
  vec3 rel = vWp - vec3(0.0, uCamAlt, 0.0);
  float L = length(rel);
  vec3 T;
  vec3 aer = aerial(uCamAlt, 0.0, L, dot(rel/L, uSunDir), mu, T);
  gl_FragColor = vec4(col*T + aer, 1.0);
}`;

const CLOUD_FRAG = /* glsl */`
#include <common>
#include <logdepthbuf_pars_fragment>
${ATMO_GLSL}
uniform float uCover; uniform float uFadeShell; uniform float uTime;
varying vec2 vUv; varying vec3 vUp; varying vec3 vWp; varying vec3 vE;
float h31(vec3 p){ p = fract(p*0.3183099 + 0.1); p *= 17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
float n3(vec3 x){ vec3 i = floor(x), f = fract(x); f = f*f*(3.0-2.0*f);
  return mix(mix(mix(h31(i), h31(i+vec3(1,0,0)), f.x), mix(h31(i+vec3(0,1,0)), h31(i+vec3(1,1,0)), f.x), f.y),
             mix(mix(h31(i+vec3(0,0,1)), h31(i+vec3(1,0,1)), f.x), mix(h31(i+vec3(0,1,1)), h31(i+vec3(1,1,1)), f.x), f.y), f.z); }
void main(){
  #include <logdepthbuf_fragment>
  vec3 p = vE * 9.0 + vec3(uTime*0.002, 0.0, 0.0);
  float f = 0.0, a = 0.5;
  for (int i = 0; i < 6; i++) { f += a*n3(p); p = p*2.07 + vec3(1.7, 9.2, 3.1); a *= 0.5; }
  float lat = abs(vE.z);
  float band = 0.08*cos(lat*9.0) + 0.06;  // faixas climáticas
  float cov = clamp(uCover*0.35 + 0.32 + band, 0.0, 0.95);
  float d = smoothstep(1.0 - cov, 1.0 - cov + 0.22, f);
  vec3 up = normalize(vUp);
  float mu = dot(up, uSunDir);
  vec3 ts = sunTransmit(7000.0, mu);
  vec3 col = vec3(0.95) * (ts * SUNK * (0.3 + 0.8*max(mu, 0.0)) + vec3(0.01,0.015,0.03));
  vec3 rel = vWp - vec3(0.0, uCamAlt, 0.0); float L = length(rel); vec3 T;
  vec3 aer = aerial(uCamAlt, 7000.0, L, dot(rel/L, uSunDir), mu, T);
  gl_FragColor = vec4(col*T + aer, d * 0.92 * uFadeShell);
}`;
const CLOUD_VERT = /* glsl */`
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec2 vUv; varying vec3 vUp; varying vec3 vWp; varying vec3 vE;
void main(){
  vE = position;
  vUp = normalize(mat3(modelMatrix) * position);
  vWp = (modelMatrix * vec4(position, 1.0)).xyz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  #include <logdepthbuf_vertex>
}`;

export class Globe {
  constructor(scene, G) {
    this.G = G;
    const geo = sphereGeometry(256, 128);
    this.mat = new THREE.ShaderMaterial({ vertexShader: GLOBE_VERT, fragmentShader: GLOBE_FRAG,
      uniforms: { ...G, uDay: { value: null }, uNight: { value: null }, uHasDay: { value: 0 }, uHasNight: { value: 0 } } });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.matrixAutoUpdate = false; this.mesh.frustumCulled = false; this.mesh.renderOrder = -5;
    scene.add(this.mesh);
    this.cloudMat = new THREE.ShaderMaterial({ vertexShader: CLOUD_VERT, fragmentShader: CLOUD_FRAG, transparent: true, depthWrite: false,
      uniforms: { ...G, uCover: { value: 0.5 }, uFadeShell: { value: 0 } } });
    this.clouds = new THREE.Mesh(sphereGeometry(192, 96), this.cloudMat);
    this.clouds.matrixAutoUpdate = false; this.clouds.frustumCulled = false; this.clouds.renderOrder = 5;
    scene.add(this.clouds);
    this.rot = new THREE.Matrix4(); this.tmp = new THREE.Matrix4();
  }
  async loadTextures(src = 'esri') {
    const day = await mercatorToEquirect(IMAGERY[src].url, 3, 4096);
    if (day) {
      const t = new THREE.CanvasTexture(day); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
      this.mat.uniforms.uDay.value = t; this.mat.uniforms.uHasDay.value = 1;
    }
    const night = await mercatorToEquirect((z, x, y) => `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_Black_Marble/default/2016-01-01/GoogleMapsCompatible_Level8/${z}/${y}/${x}.png`, 3, 2048);
    if (night) {
      const t = new THREE.CanvasTexture(night); t.colorSpace = THREE.SRGBColorSpace;
      this.mat.uniforms.uNight.value = t; this.mat.uniforms.uHasNight.value = 1;
    }
  }
  update(lat, lon, camAlt) {
    const p = lat * DEG, l = lon * DEG;
    const sp = Math.sin(p), cp = Math.cos(p), sl = Math.sin(l), cl = Math.cos(l);
    // linhas: leste, cima, sul
    this.rot.set(-sl, cl, 0, 0, cp * cl, cp * sl, sp, 0, sp * cl, sp * sl, -cp, 0, 0, 0, 0, 1);
    const place = (mesh, r) => {
      mesh.matrix.makeTranslation(0, -RE, 0).multiply(this.rot).multiply(this.tmp.makeScale(r, r, r));
      mesh.matrixWorldNeedsUpdate = true;
    };
    place(this.mesh, RE - 1500);
    place(this.clouds, RE + 7000);
    const fade = Math.min(Math.max((camAlt - 9000) / 14000, 0), 1);
    this.cloudMat.uniforms.uFadeShell.value = fade;
    this.clouds.visible = fade > 0.01;
  }
}

// ---------------- céu (triângulo de tela cheia) ----------------
const SKY_VERT = /* glsl */`
uniform mat4 uInvProj; uniform mat4 uCamWorld;
varying vec3 vDir;
void main(){
  vec4 v = uInvProj * vec4(position.xy, -1.0, 1.0);
  vDir = (uCamWorld * vec4(v.xyz / v.w, 0.0)).xyz;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;
const SKY_FRAG = /* glsl */`
${ATMO_GLSL}
uniform vec3 uOverCol; uniform float uFlash;
varying vec3 vDir;
float h31(vec3 p){ p = fract(p*0.3183099 + 0.1); p *= 17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
void main(){
  vec3 rd = normalize(vDir);
  float hit;
  vec3 col = skyRadiance(rd, uCamAlt, hit);
  float lum = dot(col, vec3(0.3, 0.6, 0.1));
  if (hit < 0.5) {
    vec3 d = rd * 260.0; vec3 c = floor(d);
    float h = h31(c);
    if (h > 0.975) {
      vec3 sp = c + 0.5 + (vec3(h31(c+3.1), h31(c+7.7), h31(c+1.3)) - 0.5)*0.7;
      float b = smoothstep(0.09, 0.0, length(d - sp)) * pow((h - 0.975)/0.025, 3.0);
      float vis = clamp(1.0 - lum*25.0, 0.0, 1.0) * (1.0 - uOvercast*step(uCamAlt, 6000.0));
      col += b * vis * mix(vec3(0.8, 0.85, 1.0), vec3(1.0, 0.85, 0.7), h31(c+5.0)) * 1.5;
    }
  }
  float below = 1.0 - smoothstep(4000.0, 9000.0, uCamAlt);
  col = mix(col, uOverCol, uOvercast * below * smoothstep(-0.3, 0.1, rd.y) * 0.92);
  col += uFlash * vec3(0.7, 0.75, 1.0);
  gl_FragColor = vec4(col, 1.0);
}`;
export class Sky {
  constructor(scene, G) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    this.mat = new THREE.ShaderMaterial({ vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, depthTest: false, depthWrite: false,
      uniforms: { ...G, uInvProj: { value: new THREE.Matrix4() }, uCamWorld: { value: new THREE.Matrix4() }, uOverCol: { value: new THREE.Vector3() }, uFlash: { value: 0 } } });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false; this.mesh.renderOrder = -10;
    scene.add(this.mesh);
  }
  update(camera) {
    this.mat.uniforms.uInvProj.value.copy(camera.projectionMatrixInverse);
    this.mat.uniforms.uCamWorld.value.copy(camera.matrixWorld);
  }
}
