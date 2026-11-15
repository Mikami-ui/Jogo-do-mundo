// Pós-processamento: borrão radial de velocidade, aberração cromática, vinheta, tonemapping ACES e saída sRGB.
import * as THREE from 'three';

export class Post {
  constructor(renderer) {
    this.renderer = renderer;
    this.rt = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: 0, depthBuffer: true });
    this.scene = new THREE.Scene();
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.mat = new THREE.ShaderMaterial({
      depthTest: false, depthWrite: false,
      uniforms: { tDiffuse: { value: this.rt.texture }, uBlur: { value: 0 }, uExposure: { value: 1 }, uTime: { value: 0 }, uFlash: { value: 0 }, uSamples: { value: 8 }, uVig: { value: 0.35 } },
      vertexShader: `varying vec2 vUv; void main(){ vUv = position.xy*0.5+0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      fragmentShader: /* glsl */`
uniform sampler2D tDiffuse; uniform float uBlur; uniform float uExposure; uniform float uTime; uniform float uFlash; uniform int uSamples; uniform float uVig;
varying vec2 vUv;
vec3 aces(vec3 x){ const float a=2.51, b=0.03, c=2.43, d=0.59, e=0.14; return clamp((x*(a*x+b))/(x*(c*x+d)+e), 0.0, 1.0); }
vec3 toSRGB(vec3 c){ return mix(c*12.92, 1.055*pow(c, vec3(1.0/2.4)) - 0.055, step(0.0031308, c)); }
float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233)))*43758.5453); }
void main(){
  vec2 c = vec2(0.5, 0.52);
  vec2 d = vUv - c;
  float r = length(d);
  float s = uBlur * smoothstep(0.08, 0.6, r);
  vec3 col = vec3(0.0);
  float jit = h(vUv*vec2(1920.0, 1080.0) + uTime);
  if (uSamples <= 1 || s < 0.002) {
    col = texture2D(tDiffuse, vUv).rgb;
  } else {
    float w = 0.0;
    for (int i = 0; i < 12; i++) {
      if (i >= uSamples) break;
      float t = (float(i) + jit) / float(uSamples);
      vec2 uv = vUv - d * s * t;
      col += texture2D(tDiffuse, uv).rgb; w += 1.0;
    }
    col /= w;
    // aberração cromática nas bordas
    float ca = s * 0.08;
    col.r = mix(col.r, texture2D(tDiffuse, vUv - d*ca).r, 0.5);
    col.b = mix(col.b, texture2D(tDiffuse, vUv + d*ca).b, 0.5);
  }
  col *= uExposure;
  col += uFlash;
  col = aces(col);
  float vig = 1.0 - uVig * smoothstep(0.35, 0.95, r*1.25) - uBlur*0.25*smoothstep(0.2, 0.8, r);
  col *= vig;
  col = toSRGB(col);
  col += (h(vUv*913.0 + uTime*7.0) - 0.5) * 0.012;
  gl_FragColor = vec4(col, 1.0);
}` });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    const m = new THREE.Mesh(g, this.mat); m.frustumCulled = false;
    this.scene.add(m);
  }
  setSize(w, h, pr) { this.rt.setSize(Math.floor(w * pr), Math.floor(h * pr)); }
  render(scene, camera) {
    this.renderer.setRenderTarget(this.rt);
    this.renderer.render(scene, camera);
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.scene, this.cam);
  }
}
