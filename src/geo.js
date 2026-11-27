// Geografia: Web Mercator, referencial local plano (leste = +X, sul = +Z, cima = +Y), sol.
export const RM = 6378137;            // raio usado pela projeção Web Mercator
export const RE = 6371000;            // raio da esfera usada na renderização
export const DEG = Math.PI / 180;
export const MERC_MAX = Math.PI * RM;
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };

export const lonToMx = (lon) => lon * DEG * RM;
export const latToMy = (lat) => { lat = clamp(lat, -85.0511, 85.0511); return RM * Math.log(Math.tan(Math.PI / 4 + (lat * DEG) / 2)); };
export const mxToLon = (mx) => mx / RM / DEG;
export const myToLat = (my) => (2 * Math.atan(Math.exp(my / RM)) - Math.PI / 2) / DEG;
export const wrapLon = (lon) => ((((lon + 180) % 360) + 360) % 360) - 180;

export const tileSize = (z) => (2 * MERC_MAX) / 2 ** z;
export const tileMinX = (z, x) => -MERC_MAX + x * tileSize(z);
export const tileMaxY = (z, y) => MERC_MAX - y * tileSize(z);

// Referencial local: origem em (lat0, lon0). Escala k converte metros Mercator em metros reais na esfera.
export class Frame {
  constructor(lat = 0, lon = 0) { this.set(lat, lon); }
  set(lat, lon) {
    this.lat0 = lat; this.lon0 = lon;
    this.omx = lonToMx(lon); this.omy = latToMy(lat);
    this.k = Math.cos(lat * DEG) * RE / RM;
  }
  mercToLocalX(mx) { return (mx - this.omx) * this.k; }
  mercToLocalZ(my) { return -(my - this.omy) * this.k; }
  localToMx(x) { return this.omx + x / this.k; }
  localToMy(z) { return this.omy - z / this.k; }
  toLatLon(x, z) { return { lat: myToLat(this.localToMy(z)), lon: wrapLon(mxToLon(this.localToMx(x))) }; }
  toLocal(lat, lon) {
    let mx = lonToMx(lon);
    // escolhe a cópia do mundo mais próxima da origem (antimeridiano)
    while (mx - this.omx > MERC_MAX) mx -= 2 * MERC_MAX;
    while (mx - this.omx < -MERC_MAX) mx += 2 * MERC_MAX;
    return { x: this.mercToLocalX(mx), z: this.mercToLocalZ(latToMy(lat)) };
  }
}

// Posição do sol (aprox. de baixa precisão, suficiente para jogo). Retorna elevação e azimute (norte, horário) em rad.
export function sunPosition(ms, lat, lon) {
  const d = ms / 86400000 - 10957.5;
  const g = (357.529 + 0.98560028 * d) * DEG;
  const q = 280.459 + 0.98564736 * d;
  const L = (q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * DEG;
  const e = (23.439 - 0.00000036 * d) * DEG;
  const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L));
  const dec = Math.asin(Math.sin(e) * Math.sin(L));
  const gmst = (((18.697374558 + 24.06570982441908 * d) % 24) + 24) % 24;
  const H = gmst * 15 * DEG + lon * DEG - ra;
  const phi = lat * DEG;
  const el = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H));
  const az = Math.atan2(-Math.sin(H), Math.tan(dec) * Math.cos(phi) - Math.sin(phi) * Math.cos(H));
  return { el, az };
}
export function sunDirLocal(el, az, out) {
  out.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
  return out;
}
// velocidade do som (m/s) pela atmosfera padrão
export function speedOfSound(alt) {
  const T = 288.15 - 0.0065 * clamp(alt, 0, 11000);
  return 20.05 * Math.sqrt(T);
}
export function dayOfYear(ms) {
  const d = new Date(ms); const start = Date.UTC(d.getUTCFullYear(), 0, 1);
  return (ms - start) / 86400000;
}
// hash determinístico 2D -> [0,1)
export function hash2(x, y, s = 0) {
  let h = (x * 374761393 + y * 668265263 + s * 2246822519) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
export function mulberry(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
