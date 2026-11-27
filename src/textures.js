// Texturas procedurais repetíveis (tileable), pequenas (256 px) e compartilhadas por todos os objetos.
// Cada material usa albedo + normal map gerados aqui — nada é baixado da rede.
import * as THREE from 'three';

const S = 256;
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
// ruído de valor periódico: se repete exatamente a cada `period` células
function lattice(period, seed) { const r = rng(seed), g = new Float32Array(period * period); for (let i = 0; i < g.length; i++) g[i] = r(); return g; }
function pnoise(g, period, x, y) {
  const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = (i, j) => g[((j % period) + period) % period * period + ((i % period) + period) % period];
  return (a(xi, yi) * (1 - sx) + a(xi + 1, yi) * sx) * (1 - sy) + (a(xi, yi + 1) * (1 - sx) + a(xi + 1, yi + 1) * sx) * sy;
}
// fbm periódico em [0,1), u e v em 0..1
function fbm(seed, base, oct) {
  const lats = []; for (let o = 0; o < oct; o++) lats.push([lattice(base << o, seed + o * 17), base << o]);
  return (u, v) => { let s = 0, a = 0.5, n = 0; for (const [g, p] of lats) { s += a * pnoise(g, p, u * p, v * p); n += a; a *= 0.5; } return s / n; };
}
function field(fn) { const h = new Float32Array(S * S); for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) h[y * S + x] = fn(x / S, y / S); return h; }
function tex(data, srgb) {
  const t = new THREE.DataTexture(data, S, S, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
  t.anisotropy = 4; t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.needsUpdate = true;
  return t;
}
// albedo em tons de cinza (multiplicado pela cor do vértice) a partir de um campo 0..1
function albedo(h, lo, hi, tint) {
  const d = new Uint8Array(S * S * 4);
  for (let i = 0; i < S * S; i++) { const v = lo + (hi - lo) * h[i]; const c = Math.max(0, Math.min(255, 255 * v)); d[i * 4] = c * (tint ? tint[0] : 1); d[i * 4 + 1] = c * (tint ? tint[1] : 1); d[i * 4 + 2] = c * (tint ? tint[2] : 1); d[i * 4 + 3] = 255; }
  return tex(d, true);
}
// normal map a partir de um campo de altura (repetível)
function normal(h, strength) {
  const d = new Uint8Array(S * S * 4);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const l = h[y * S + ((x + S - 1) % S)], r = h[y * S + ((x + 1) % S)], u = h[((y + S - 1) % S) * S + x], dn = h[((y + 1) % S) * S + x];
    let nx = (l - r) * strength, ny = (u - dn) * strength; const il = 1 / Math.hypot(nx, ny, 1);
    const i = (y * S + x) * 4; d[i] = (nx * il * 0.5 + 0.5) * 255; d[i + 1] = (ny * il * 0.5 + 0.5) * 255; d[i + 2] = (il * 0.5 + 0.5) * 255; d[i + 3] = 255;
  }
  return tex(d, false);
}

let cache = null;
export function getTextures() {
  if (cache) return cache;
  const n1 = fbm(11, 8, 5), n2 = fbm(23, 4, 4), n3 = fbm(37, 32, 3), n4 = fbm(51, 2, 3);
  // reboco: manchas suaves + grão fino
  const plasterH = field((u, v) => n2(u, v) * 0.55 + n3(u, v) * 0.45);
  // telhas de barro: fileiras de meia-cana (8 fileiras × 12 telhas por repetição)
  const roofH = field((u, v) => { const row = v * 8, r = row - Math.floor(row); const col = u * 12 + (Math.floor(row) % 2) * 0.5; const c = Math.abs(Math.sin(col * Math.PI)); return 0.25 + 0.55 * c * (0.55 + 0.45 * r) + 0.2 * (1 - r) * (r < 0.12 ? 0 : 1) * 0.5 + n3(u, v) * 0.08; });
  // asfalto: brita fina, manchas e algumas trincas
  const asphH = field((u, v) => { const cr = Math.abs(n4(u + n2(u, v) * 0.15, v) - 0.5); return n3(u, v) * 0.6 + n1(u, v) * 0.3 + (cr < 0.012 ? -0.5 : 0) + 0.1; });
  // calçada: placas de concreto 2×2 por repetição, com juntas
  const slabH = field((u, v) => { const a = (u * 2) % 1, b = (v * 2) % 1, j = Math.min(a, 1 - a, b, 1 - b); return (j < 0.015 ? 0.15 : 0.7) + n3(u, v) * 0.22 + n2(u, v) * 0.08; });
  // casca de árvore: sulcos verticais
  const barkH = field((u, v) => { const s = n1(u * 1.0, v * 0.18) * 0.7 + n3(u, v * 0.4) * 0.3; return Math.abs(Math.sin((u * 14 + s * 3.2) * Math.PI)) * 0.7 + n3(u, v) * 0.3; });
  // folhagem: aglomerados de folhas
  const leafH = field((u, v) => { const a = n1(u, v), b = n3(u, v); return Math.pow(a, 0.8) * 0.6 + b * 0.4; });
  // pedra: facetas e veios
  const rockH = field((u, v) => n2(u, v) * 0.5 + Math.abs(n1(u, v) - 0.5) * 0.9 + n3(u, v) * 0.15);
  // detalhe do chão (terreno): R = grão fino, G = manchas médias, B = altura para relevo
  const dR = field((u, v) => n3(u, v) * 0.6 + n1(u, v) * 0.4), dG = field((u, v) => n2(u, v));
  const dd = new Uint8Array(S * S * 4);
  for (let i = 0; i < S * S; i++) { dd[i * 4] = dR[i] * 255; dd[i * 4 + 1] = dG[i] * 255; dd[i * 4 + 2] = (dR[i] * 0.5 + dG[i] * 0.5) * 255; dd[i * 4 + 3] = 255; }
  cache = {
    detail: tex(dd, false),
    plaster: albedo(plasterH, 0.78, 1.0), plasterN: normal(plasterH, 2.2),
    roof: albedo(roofH, 0.55, 1.05), roofN: normal(roofH, 5.5),
    asphalt: albedo(asphH, 0.72, 1.05), asphaltN: normal(asphH, 3.0),
    slab: albedo(slabH, 0.6, 1.0), slabN: normal(slabH, 3.5),
    bark: albedo(barkH, 0.5, 1.0), barkN: normal(barkH, 5.0),
    leaf: albedo(leafH, 0.55, 1.1), leafN: normal(leafH, 4.0),
    rock: albedo(rockH, 0.6, 1.05), rockN: normal(rockH, 4.5),
  };
  return cache;
}
