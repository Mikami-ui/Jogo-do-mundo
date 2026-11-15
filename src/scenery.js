// Materiais PBR compartilhados e modelos dos elementos do cenário (poste, banco, placa, pedra, árvores detalhadas).
// Poucos materiais para o mundo inteiro: cada tipo de superfície usa um só, variando pela cor do vértice.
import * as THREE from 'three';
import { getTextures } from './textures.js';

const s2l = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
export const lin = (r, g, b) => [s2l(r), s2l(g), s2l(b)];

// junta geometrias simples numa só, com cor por vértice e UV (um draw call por tipo de objeto)
export function merge(parts) {
 // sem índice: cada triângulo com seus vértices
  parts = parts.map((p) => ({ g: p.g.index ? p.g.toNonIndexed() : p.g, c: p.c })); // sem índice: cada triângulo com seus vértices
  let n = 0; for (const p of parts) n += p.g.attributes.position.count;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = new Float32Array(n * 3), uv = new Float32Array(n * 2);
  let o = 0;
  for (const p of parts) {
    const g = p.g; const c = g.attributes.position.count;
    pos.set(g.attributes.position.array, o * 3); nor.set(g.attributes.normal.array, o * 3);
    if (g.attributes.uv) uv.set(g.attributes.uv.array, o * 2);
    for (let i = 0; i < c; i++) col.set(p.c, (o + i) * 3);
    o += c;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}
const box = (w, h, d, x, y, z, c, ry = 0) => { const g = new THREE.BoxGeometry(w, h, d); if (ry) g.rotateY(ry); g.translate(x, y + h / 2, z); return { g, c }; };
const cyl = (r0, r1, h, x, y, z, c, seg = 8, rx = 0, rz = 0, open = false) => { const g = new THREE.CylinderGeometry(r1, r0, h, seg, 1, open); g.translate(0, h / 2, 0); if (rx) g.rotateX(rx); if (rz) g.rotateZ(rz); g.translate(x, y, z); return { g, c }; };

// ---------- modelos (unidade: metros; origem no chão; +Z = lado da rua) ----------
export function propGeometries() {
  const metal = lin(0.2, 0.21, 0.23), wood = lin(0.45, 0.3, 0.17), conc = lin(0.62, 0.62, 0.6);
  // poste de luz: 6,5 m, braço sobre a rua e luminária
  const lamp = merge([cyl(0.1, 0.065, 6.4, 0, 0, 0, metal, 6, 0, 0, true), box(0.3, 0.35, 0.3, 0, 0, 0, lin(0.3, 0.31, 0.33)), cyl(0.045, 0.04, 1.7, 0, 6.35, 0, metal, 5, Math.PI / 2 - 0.12, 0, true), box(0.26, 0.09, 0.6, 0, 6.42, 1.75, lin(0.75, 0.76, 0.78))]);
  // lâmpada (emissiva à noite) separada, na mesma posição
  const bg = new THREE.PlaneGeometry(0.2, 0.5); bg.rotateX(Math.PI / 2); bg.translate(0, 6.415, 1.75);
  const bulb = merge([{ g: bg, c: [1, 1, 1] }]);
  // banco de praça: 1,6 m, ripas de madeira e pés de metal
  const bench = merge([box(1.6, 0.05, 0.42, 0, 0.42, 0, wood), box(1.6, 0.36, 0.05, 0, 0.5, -0.2, wood), box(0.06, 0.42, 0.42, -0.7, 0, 0, metal), box(0.06, 0.42, 0.42, 0.7, 0, 0, metal), box(0.06, 0.45, 0.05, -0.7, 0.42, -0.2, metal), box(0.06, 0.45, 0.05, 0.7, 0.42, -0.2, metal)]);
  // placa de PARE: poste de 2,2 m e octógono vermelho com borda branca
  const oct = new THREE.CylinderGeometry(0.34, 0.34, 0.03, 8); oct.rotateX(Math.PI / 2); oct.rotateZ(Math.PI / 8); oct.translate(0, 2.25, 0.03);
  const octB = new THREE.CylinderGeometry(0.37, 0.37, 0.02, 8); octB.rotateX(Math.PI / 2); octB.rotateZ(Math.PI / 8); octB.translate(0, 2.25, 0.012);
  const sign = merge([cyl(0.03, 0.03, 2.6, 0, 0, 0, lin(0.55, 0.56, 0.58), 5, 0, 0, true), { g: octB, c: lin(0.95, 0.95, 0.95) }, { g: oct, c: lin(0.78, 0.07, 0.07) }, box(0.34, 0.07, 0.01, 0, 2.215, 0.05, lin(0.96, 0.96, 0.96))]);
  // pedra: icosaedro deformado
  const rg = new THREE.IcosahedronGeometry(1, 1); const p = rg.attributes.position;
  for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i); const d = 0.78 + 0.3 * Math.sin(x * 3.1 + y * 1.7) * Math.cos(z * 2.3 + x) + 0.12 * Math.sin(y * 5.1 + z * 4.3); p.setXYZ(i, x * d, Math.max(y * d * 0.7, -0.25) + 0.25, z * d); }
  rg.computeVertexNormals();
  const uvr = new Float32Array(p.count * 2); for (let i = 0; i < p.count; i++) { uvr[i * 2] = p.getX(i) * 0.5 + p.getZ(i) * 0.3; uvr[i * 2 + 1] = p.getY(i) * 0.6 + p.getZ(i) * 0.2; }
  rg.setAttribute('uv', new THREE.BufferAttribute(uvr, 2));
  const rock = merge([{ g: rg, c: [1, 1, 1] }]);
  return { lamp, bulb, bench, sign, rock, conc };
}

// ---------- árvores detalhadas (LOD de perto): tronco com casca, galhos e copa em blocos de folhagem ----------
function withUV(g, su, sv) { // UV cilíndrica simples para casca/folhas
  const p = g.attributes.position, uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) { uv[i * 2] = (Math.atan2(p.getZ(i), p.getX(i)) / (2 * Math.PI) + 0.5) * su; uv[i * 2 + 1] = p.getY(i) * sv; }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); return g;
}
export function treeGeometries() {
  const mk = (broad) => {
    const bark = [], leaf = [];
    const brown = lin(0.36, 0.27, 0.19), R = (i) => Math.abs(Math.sin(i * 12.9898) * 43758.5453) % 1;
    if (broad) {
      bark.push({ g: withUV(new THREE.CylinderGeometry(0.035, 0.06, 0.46, 7, 2).translate(0, 0.23, 0), 2, 6), c: brown });
      for (let i = 0; i < 4; i++) { // galhos
        const a = (i / 4) * Math.PI * 2 + 0.4, g = new THREE.CylinderGeometry(0.012, 0.024, 0.3, 5); g.translate(0, 0.15, 0); g.rotateZ(-0.75 - R(i) * 0.3); g.rotateY(a); g.translate(0, 0.36 + R(i + 5) * 0.06, 0);
        bark.push({ g: withUV(g, 1, 6), c: brown });
      }
      const blobs = [[0, 0.72, 0, 0.3], [0.2, 0.62, 0.08, 0.22], [-0.19, 0.64, -0.05, 0.23], [0.04, 0.6, -0.21, 0.22], [-0.05, 0.63, 0.2, 0.21], [0.1, 0.86, -0.04, 0.2], [-0.12, 0.82, 0.08, 0.19]];
      blobs.forEach(([x, y, z, r], i) => {
        const g = new THREE.IcosahedronGeometry(r, 1); const p = g.attributes.position;
        for (let v = 0; v < p.count; v++) { const d = 1 + 0.16 * Math.sin(p.getX(v) * 23 + i) * Math.cos(p.getY(v) * 19 + p.getZ(v) * 17); p.setXYZ(v, p.getX(v) * d, p.getY(v) * d * 0.85, p.getZ(v) * d); }
        g.computeVertexNormals(); withUV(g, 3, 5); g.translate(x, y, z);
        const sh = 0.8 + R(i + 9) * 0.4; leaf.push({ g, c: lin(0.2 * sh, 0.36 * sh, 0.13 * sh) });
      });
    } else {
      bark.push({ g: withUV(new THREE.CylinderGeometry(0.02, 0.05, 0.9, 6, 1).translate(0, 0.45, 0), 2, 8), c: brown });
      for (let i = 0; i < 6; i++) { // camadas de ramos do pinheiro
        const t = i / 5, g = new THREE.ConeGeometry(0.34 - t * 0.25, 0.3 - t * 0.08, 9, 1, true); withUV(g, 4, 6); g.translate(0, 0.3 + t * 0.6, 0);
        const sh = 0.75 + R(i) * 0.35; leaf.push({ g, c: lin(0.13 * sh, 0.25 * sh, 0.12 * sh) });
      }
    }
    const gb = merge(bark), gl = merge(leaf);
    // um só buffer com dois grupos (casca, folhas) → dois materiais
    const nb = gb.attributes.position.count, nl = gl.attributes.position.count;
    const g = new THREE.BufferGeometry();
    for (const k of ['position', 'normal', 'color', 'uv']) { const sz = k === 'uv' ? 2 : 3, a = new Float32Array((nb + nl) * sz); a.set(gb.attributes[k].array, 0); a.set(gl.attributes[k].array, nb * sz); g.setAttribute(k, new THREE.BufferAttribute(a, sz)); }
    g.addGroup(0, nb, 0); g.addGroup(nb, nl, 1);
    return g;
  };
  return { broad: mk(true), conifer: mk(false) };
}

// ---------- materiais ----------
// quality: 'baixa' usa Lambert sem normal map (mais leve); 'media'/'alta' usam PBR (Standard) com normal map
export function makeMaterials(quality, uniforms) {
  const T = getTextures(), pbr = quality !== 'baixa';
  const M = (o) => {
    const { normalMap, normalScale, roughness, metalness, ...rest } = o;
    if (!pbr) return new THREE.MeshLambertMaterial(rest);
    const o2 = { ...rest, roughness: roughness ?? 0.85, metalness: metalness ?? 0 };
    if (normalMap) { o2.normalMap = normalMap; o2.normalScale = new THREE.Vector2(normalScale || 1, normalScale || 1); }
    return new THREE.MeshStandardMaterial(o2);
  };
  const wall = M({ vertexColors: true, side: THREE.DoubleSide, map: T.plaster, normalMap: T.plasterN, normalScale: 0.6, roughness: 0.9 });
  wall.onBeforeCompile = (sh) => {
    sh.uniforms.uNightW = uniforms.night;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec2 wuv; varying vec2 vWuv;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvWuv = wuv;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec2 vWuv; uniform float uNightW; float wLit = 0.0; float wGlass = 0.0;')
      .replace('#include <color_fragment>', `#include <color_fragment>
  if (vWuv.y > -0.5) {
    vec2 wc = vec2(vWuv.x / 2.9, vWuv.y / 3.0);
    vec2 wf = fract(wc), wid = floor(wc);
    float win = step(0.24, wf.x)*step(wf.x, 0.76)*step(0.36, wf.y)*step(wf.y, 0.8);
    float frame = step(0.2, wf.x)*step(wf.x, 0.8)*step(0.31, wf.y)*step(wf.y, 0.84) - win; // moldura e peitoril
    float wh = fract(sin(dot(wid, vec2(12.9898, 78.233)))*43758.5453);
    float fw = max(fwidth(vWuv.x) / 2.9, fwidth(vWuv.y) / 3.0);
    float near = 1.0 - smoothstep(0.4, 1.0, fw);
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.78, 0.76, 0.72), frame * near * 0.85);
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.05, 0.07, 0.09), mix(0.14, win*(0.5 + 0.3*wh), near));
    diffuseColor.rgb *= 1.0 - 0.3 * (1.0 - smoothstep(0.35, 0.5, vWuv.y)) * near; // rodapé mais escuro
    wGlass = win * near;
    wLit = mix(0.09, win*step(0.6, wh)*(0.5 + wh), near);
  }`)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += wLit * uNightW * vec3(1.0, 0.62, 0.28) * 0.14;');
    if (pbr) sh.fragmentShader = sh.fragmentShader.replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.12, wGlass);');
  };
  const roof = M({ vertexColors: true, side: THREE.DoubleSide, map: T.roof, normalMap: T.roofN, normalScale: 1.0, roughness: 0.8 });
  const road = M({ vertexColors: true, map: T.asphalt, normalMap: T.asphaltN, normalScale: 0.5, roughness: 0.92, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3, side: THREE.DoubleSide });
  road.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec3 ruv; varying vec3 vRuv;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvRuv = ruv;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vRuv;')
      .replace('#include <color_fragment>', `#include <color_fragment>
  {
    float fu = fwidth(vRuv.x), au = abs(vRuv.x), far = 1.0 - smoothstep(0.25, 0.7, fu * 6.0);
    if (vRuv.z > 0.5) {
      float mk = (1.0 - smoothstep(0.035, 0.035 + fu, au)) * step(0.45, fract(vRuv.y / 9.0));
      if (vRuv.z > 1.5) mk = max(mk, smoothstep(0.8 - fu, 0.8, au) * (1.0 - smoothstep(0.88, 0.88 + fu, au)));
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.62, 0.62, 0.58), mk * far);
    }
    // sarjeta escurecida na borda e boca de lobo a cada 30 m
    diffuseColor.rgb *= 1.0 - 0.25 * smoothstep(0.86, 1.0, au) * far;
    float grate = step(0.9, au) * step(fract(vRuv.y / 30.0), 0.035);
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.012), grate * far);
  }`);
  };
  const walk = M({ vertexColors: true, map: T.slab, normalMap: T.slabN, normalScale: 0.7, roughness: 0.95, side: THREE.DoubleSide });
  const prop = M({ vertexColors: true, roughness: 0.55, metalness: 0.35 });
  const rock = M({ vertexColors: true, map: T.rock, normalMap: T.rockN, normalScale: 1.2, roughness: 0.95 });
  const bulb = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const bark = M({ vertexColors: true, map: T.bark, normalMap: T.barkN, normalScale: 1.0, roughness: 0.95 });
  const leaf = M({ vertexColors: true, map: T.leaf, normalMap: T.leafN, normalScale: 0.8, roughness: 0.8 });
  // vento leve nas copas (só desloca as folhas; o tronco fica parado)
  leaf.onBeforeCompile = (sh) => {
    sh.uniforms.uTimeT = uniforms.time;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTimeT;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
  #ifdef USE_INSTANCING
    float ph = instanceMatrix[3].x * 0.7 + instanceMatrix[3].z * 0.9;
  #else
    float ph = 0.0;
  #endif
  transformed.x += sin(uTimeT * 1.3 + ph + position.y * 6.0) * 0.012 * position.y;
  transformed.z += cos(uTimeT * 1.1 + ph * 1.3 + position.y * 5.0) * 0.010 * position.y;`);
  };
  return { wall, roof, road, walk, prop, rock, bulb, bark, leaf };
}
