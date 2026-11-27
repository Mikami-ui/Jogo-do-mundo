// Minimapa e mapa-múndi (mapa deslizante simples em canvas 2D).
import { DEG, clamp } from './geo.js';

const TOPO = (z, x, y) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/${z}/${y}/${x}`;
const tiles = new Map();
function tile(z, x, y, onload) {
  const n = 2 ** z; x = ((x % n) + n) % n;
  if (y < 0 || y >= n) return null;
  const k = z + '/' + x + '/' + y;
  let t = tiles.get(k);
  if (!t) {
    t = new Image(); t.ok = false; t.onload = () => { t.ok = true; onload?.(); }; t.src = TOPO(z, x, y);
    tiles.set(k, t);
    if (tiles.size > 260) tiles.delete(tiles.keys().next().value);
  }
  return t;
}
const nx = (lon) => (lon + 180) / 360;
const ny = (lat) => { const s = Math.sin(clamp(lat, -85, 85) * DEG); return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI); };
const lonOf = (x) => x * 360 - 180;
const latOf = (y) => Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) / DEG;

export function drawMap(ctx, w, h, lat, lon, zoom, redraw) {
  const z = clamp(Math.floor(zoom), 1, 17), sc = 2 ** (zoom - z), world = 256 * 2 ** z;
  const cx = nx(lon) * world, cy = ny(lat) * world;
  ctx.fillStyle = '#10141b'; ctx.fillRect(0, 0, w, h);
  const x0 = Math.floor((cx - w / 2 / sc) / 256), x1 = Math.floor((cx + w / 2 / sc) / 256);
  const y0 = Math.floor((cy - h / 2 / sc) / 256), y1 = Math.floor((cy + h / 2 / sc) / 256);
  for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) {
    const t = tile(z, tx, ty, redraw);
    if (t && t.ok) ctx.drawImage(t, Math.round((tx * 256 - cx) * sc + w / 2), Math.round((ty * 256 - cy) * sc + h / 2), Math.ceil(256 * sc), Math.ceil(256 * sc));
  }
  return { toXY: (la, lo) => { let dx = nx(lo) * world - cx; if (dx > world / 2) dx -= world; if (dx < -world / 2) dx += world; return [dx * sc + w / 2, (ny(la) * world - cy) * sc + h / 2]; },
    toLL: (x, y) => [latOf((cy + (y - h / 2) / sc) / world), lonOf((((cx + (x - w / 2) / sc) / world) % 1 + 1) % 1)] };
}
function arrow(ctx, x, y, hd, s, color) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(hd);
  ctx.beginPath(); ctx.moveTo(0, -s); ctx.lineTo(s * 0.7, s * 0.8); ctx.lineTo(0, s * 0.4); ctx.lineTo(-s * 0.7, s * 0.8); ctx.closePath();
  ctx.fillStyle = color; ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.fill(); ctx.stroke(); ctx.restore();
}
function dot(ctx, x, y, r, fill, stroke = '#fff') { ctx.beginPath(); ctx.arc(x, y, r, 0, 6.283); ctx.fillStyle = fill; ctx.fill(); ctx.strokeStyle = stroke; ctx.lineWidth = 1.5; ctx.stroke(); }

export class MiniMap {
  constructor(canvas) { this.c = canvas; this.ctx = canvas.getContext('2d'); this.t = 0; }
  draw(dt, lat, lon, hd, agl, dest) {
    this.t -= dt; if (this.t > 0) return; this.t = 0.25;
    const dpr = Math.min(window.devicePixelRatio || 1, 2), s = this.c.clientWidth;
    if (!s) return;
    if (this.c.width !== s * dpr) { this.c.width = this.c.height = s * dpr; }
    const ctx = this.ctx; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const zoom = clamp(15.3 - Math.log2(Math.max(agl, 200) / 200), 2.2, 15.3);
    const m = drawMap(ctx, s, s, lat, lon, zoom, () => { this.t = 0; });
    if (dest) { const [x, y] = m.toXY(dest[0], dest[1]); const a = Math.atan2(y - s / 2, x - s / 2), r = Math.min(Math.hypot(x - s / 2, y - s / 2), s / 2 - 7); dot(ctx, s / 2 + Math.cos(a) * r, s / 2 + Math.sin(a) * r, 4.5, '#ff6a1a'); }
    arrow(ctx, s / 2, s / 2, hd, 8, '#ff6a1a');
  }
}

export class WorldMap {
  constructor(canvas, onPick) {
    this.c = canvas; this.ctx = canvas.getContext('2d'); this.lat = 0; this.lon = 0; this.zoom = 3; this.pin = null; this.onPick = onPick; this.marks = () => [];
    const pts = new Map(); let moved = 0, pinch = 0;
    const pos = (e) => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    canvas.addEventListener('pointerdown', (e) => { canvas.setPointerCapture(e.pointerId); pts.set(e.pointerId, pos(e)); moved = 0; if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch = Math.hypot(a[0] - b[0], a[1] - b[1]); } });
    canvas.addEventListener('pointermove', (e) => {
      if (!pts.has(e.pointerId)) return;
      const p = pos(e), o = pts.get(e.pointerId); pts.set(e.pointerId, p);
      if (pts.size === 1) { const dx = p[0] - o[0], dy = p[1] - o[1]; moved += Math.abs(dx) + Math.abs(dy); const world = 256 * 2 ** this.zoom; this.lon = lonOf((((nx(this.lon) - dx / world) % 1) + 1) % 1); this.lat = latOf(clamp(ny(this.lat) - dy / world, 0.02, 0.98)); }
      else if (pts.size === 2) { const [a, b] = [...pts.values()]; const d = Math.hypot(a[0] - b[0], a[1] - b[1]); if (pinch) this.zoom = clamp(this.zoom + Math.log2(d / pinch), 1.2, 16.5); pinch = d; moved = 99; }
      this.draw();
    });
    const up = (e) => {
      if (pts.size === 1 && moved < 8 && this.m) { const p = pos(e); const [la, lo] = this.m.toLL(p[0], p[1]); this.pin = [la, lo]; this.onPick?.(la, lo); this.draw(); }
      pts.delete(e.pointerId); pinch = 0;
    };
    canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', (e) => { pts.delete(e.pointerId); });
    canvas.addEventListener('wheel', (e) => { e.preventDefault(); this.zoom = clamp(this.zoom - e.deltaY * 0.003, 1.2, 16.5); this.draw(); }, { passive: false });
  }
  zoomBy(d) { this.zoom = clamp(this.zoom + d, 1.2, 16.5); this.draw(); }
  center(lat, lon, zoom) { this.lat = lat; this.lon = lon; if (zoom) this.zoom = zoom; this.draw(); }
  draw() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2), w = this.c.clientWidth, h = this.c.clientHeight;
    if (!w || !h) return;
    if (this.c.width !== Math.round(w * dpr) || this.c.height !== Math.round(h * dpr)) { this.c.width = Math.round(w * dpr); this.c.height = Math.round(h * dpr); }
    const ctx = this.ctx; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.m = drawMap(ctx, w, h, this.lat, this.lon, this.zoom, () => { clearTimeout(this.rt); this.rt = setTimeout(() => this.draw(), 60); });
    for (const k of this.marks()) {
      const [x, y] = this.m.toXY(k.lat, k.lon);
      if (x < -20 || y < -20 || x > w + 20 || y > h + 20) continue;
      if (k.type === 'me') arrow(ctx, x, y, k.hd, 10, '#ff6a1a');
      else if (k.type === 'fav') { ctx.font = '16px sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = '#ffd21a'; ctx.strokeStyle = '#000'; ctx.lineWidth = 3; ctx.strokeText('★', x, y + 6); ctx.fillText('★', x, y + 6); }
      else if (k.type === 'lm') dot(ctx, x, y, 4.5, k.found ? '#ffd21a' : '#8a93a3');
      else if (k.type === 'dest') dot(ctx, x, y, 6, '#ff6a1a');
    }
    if (this.pin) { const [x, y] = this.m.toXY(this.pin[0], this.pin[1]); ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - 7, y - 16); ctx.arc(x, y - 18, 7.3, Math.PI, 0); ctx.lineTo(x, y); ctx.fillStyle = '#e8413a'; ctx.fill(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke(); }
  }
}
