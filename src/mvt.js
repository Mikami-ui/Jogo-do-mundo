// Decodificador mínimo de Mapbox Vector Tiles (protobuf) — só o necessário para o jogo.
class Reader {
  constructor(buf, pos = 0, end = buf.length) { this.b = buf; this.p = pos; this.end = end; }
  varint() {
    let r = 0, s = 0, b;
    do { b = this.b[this.p++]; if (s < 28) r |= (b & 0x7f) << s; else r += (b & 0x7f) * 2 ** s; s += 7; } while (b & 0x80);
    return r >>> 0 === r || s <= 35 ? (s <= 28 ? r >>> 0 : r) : r;
  }
  skip(type) {
    if (type === 0) { while (this.b[this.p++] & 0x80); }
    else if (type === 1) this.p += 8;
    else if (type === 2) { const l = this.varint(); this.p += l; }
    else if (type === 5) this.p += 4;
    else throw new Error('pbf');
  }
  sub() { const l = this.varint(); const r = new Reader(this.b, this.p, this.p + l); this.p += l; return r; }
}
const td = new TextDecoder();
const zz = (n) => (n >>> 1) ^ -(n & 1);

function readValue(r) {
  let v = null;
  const dv = new DataView(r.b.buffer, r.b.byteOffset);
  while (r.p < r.end) {
    const t = r.varint(), f = t >> 3, w = t & 7;
    if (f === 1) { const s = r.sub(); v = td.decode(r.b.subarray(s.p, s.end)); }
    else if (f === 2) { v = dv.getFloat32(r.p, true); r.p += 4; }
    else if (f === 3) { v = dv.getFloat64(r.p, true); r.p += 8; }
    else if (f === 4 || f === 5) v = r.varint();
    else if (f === 6) v = zz(r.varint());
    else if (f === 7) v = !!r.varint();
    else r.skip(w);
  }
  return v;
}
function readFeature(r, keys, values) {
  const f = { type: 0, props: {}, geom: null };
  let tags = null, g = null;
  while (r.p < r.end) {
    const t = r.varint(), fld = t >> 3, w = t & 7;
    if (fld === 2) tags = r.sub();
    else if (fld === 3) f.type = r.varint();
    else if (fld === 4) g = r.sub();
    else r.skip(w);
  }
  if (tags) while (tags.p < tags.end) { const k = keys[tags.varint()], v = values[tags.varint()]; f.props[k] = v; }
  const rings = [];
  if (g) {
    let x = 0, y = 0, ring = null;
    while (g.p < g.end) {
      const c = g.varint(), cmd = c & 7, n = c >> 3;
      if (cmd === 1) for (let i = 0; i < n; i++) { x += zz(g.varint()); y += zz(g.varint()); ring = [[x, y]]; rings.push(ring); }
      else if (cmd === 2) for (let i = 0; i < n; i++) { x += zz(g.varint()); y += zz(g.varint()); ring.push([x, y]); }
    }
  }
  f.geom = rings;
  return f;
}
function readLayer(r, want) {
  const L = { name: '', extent: 4096, features: [] };
  const keys = [], values = [], feats = [];
  while (r.p < r.end) {
    const t = r.varint(), f = t >> 3, w = t & 7;
    if (f === 1) { const s = r.sub(); L.name = td.decode(r.b.subarray(s.p, s.end)); if (!want.has(L.name)) return null; }
    else if (f === 2) feats.push(r.sub());
    else if (f === 3) { const s = r.sub(); keys.push(td.decode(r.b.subarray(s.p, s.end))); }
    else if (f === 4) values.push(readValue(r.sub()));
    else if (f === 5) L.extent = r.varint();
    else r.skip(w);
  }
  for (const fr of feats) L.features.push(readFeature(fr, keys, values));
  return L;
}
export function decodeMVT(buf, wantLayers) {
  const r = new Reader(buf), want = new Set(wantLayers), out = {};
  while (r.p < r.end) {
    const t = r.varint(), f = t >> 3, w = t & 7;
    if (f === 3) { const L = readLayer(r.sub(), want); if (L) out[L.name] = L; }
    else r.skip(w);
  }
  return out;
}
export function ringArea(ring) {
  let a = 0;
  for (let i = 0, n = ring.length, j = n - 1; i < n; j = i++) a += (ring[j][0] - ring[i][0]) * (ring[j][1] + ring[i][1]);
  return a / 2;
}
// agrupa anéis em polígonos [{outer, holes}]
export function toPolygons(rings) {
  const polys = []; let cur = null, sign = 0;
  for (const r of rings) {
    if (r.length < 3) continue;
    const a = ringArea(r);
    if (a === 0) continue;
    if (!sign) sign = Math.sign(a);
    if (Math.sign(a) === sign) { cur = { outer: r, holes: [], area: Math.abs(a) }; polys.push(cur); }
    else if (cur) cur.holes.push(r);
  }
  return polys;
}
