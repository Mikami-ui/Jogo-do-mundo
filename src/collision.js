// Colisão unificada. Camadas e máscaras (quem colide com quem):
//
//   camada            bit   colide com (máscara)
//   PLAYER             1    GROUND | STATIC  (e sente INTERACT, sem ser bloqueado)
//   GROUND             2    PLAYER           terreno, ruas e calçadas: só dão a altura do piso
//   STATIC             4    PLAYER           paredes, troncos, pedras, muros, postes, bancos, placas
//   INTERACT           8    PLAYER (sensor)  volumes de objetivo: detectam, nunca bloqueiam
//
// Formas: círculo (tronco, poste, pedra, placa), caixa orientada (muro, banco) e prisma poligonal
// (planta da casa — a única forma côncava, usada só onde é necessária).
// O jogador é um cilindro; a resolução empurra o cilindro para fora e remove só a componente da
// velocidade que entra no obstáculo, então ele desliza em paredes e quinas em vez de prender.

export const LAYER = { PLAYER: 1, GROUND: 2, STATIC: 4, INTERACT: 8 };
export const MASK = { PLAYER: LAYER.GROUND | LAYER.STATIC | LAYER.INTERACT, GROUND: LAYER.PLAYER, STATIC: LAYER.PLAYER, INTERACT: LAYER.PLAYER };
const CELL = 12;

export class Physics {
  constructor(frame) { this.frame = frame; this.groups = new Set(); this.res = { x: 0, z: 0, hit: false, floor: -Infinity, nx: 0, nz: 0 }; }
  // grupo de colisores em metros, relativos ao canto (amx, amy) em Mercator de um tile; k = escala usada ao criar
  addGroup(amx, amy, k, size, items) {
    const g = { amx, amy, k, size, items, grid: new Map() };
    items.forEach((it, i) => {
      if (it.t === 'c') { it.x0 = it.x - it.r; it.x1 = it.x + it.r; it.z0 = it.z - it.r; it.z1 = it.z + it.r; }
      else if (it.t === 'b') { const e = Math.abs(it.hx * it.c) + Math.abs(it.hz * it.s), f = Math.abs(it.hx * it.s) + Math.abs(it.hz * it.c); it.x0 = it.x - e; it.x1 = it.x + e; it.z0 = it.z - f; it.z1 = it.z + f; }
      it.layer = it.layer ?? LAYER.STATIC;
      for (let cz = Math.floor(it.z0 / CELL); cz <= Math.floor(it.z1 / CELL); cz++) for (let cx = Math.floor(it.x0 / CELL); cx <= Math.floor(it.x1 / CELL); cx++) {
        const key = cx * 4096 + cz; let a = g.grid.get(key); if (!a) g.grid.set(key, (a = [])); a.push(i);
      }
    });
    this.groups.add(g); return g;
  }
  removeGroup(g) { if (g) this.groups.delete(g); }
  clear() { this.groups.clear(); }
  // chama cb(item, lx, lz, grupo) para cada colisor cuja caixa toca o círculo (x, z, r) em coordenadas do mundo
  each(x, z, r, cb) {
    const f = this.frame, mx = f.localToMx(x), my = f.localToMy(z);
    for (const g of this.groups) {
      const lx = (mx - g.amx) * g.k, lz = (g.amy - my) * g.k;
      if (lx < -r - 40 || lz < -r - 40 || lx > g.size + r + 40 || lz > g.size + r + 40) continue;
      const seen = this._seen || (this._seen = new Set()); seen.clear();
      for (let cz = Math.floor((lz - r) / CELL); cz <= Math.floor((lz + r) / CELL); cz++) for (let cx = Math.floor((lx - r) / CELL); cx <= Math.floor((lx + r) / CELL); cx++) {
        const a = g.grid.get(cx * 4096 + cz); if (!a) continue;
        for (const i of a) {
          if (seen.has(i)) continue; seen.add(i);
          const it = g.items[i];
          if (lx + r < it.x0 || lx - r > it.x1 || lz + r < it.z0 || lz - r > it.z1) continue;
          cb(it, lx, lz, g);
        }
      }
    }
  }
  // penetração do círculo (lx, lz, r) no colisor: devolve [px, pz] para sair, ou null
  static push(it, lx, lz, r, out) {
    if (it.t === 'c') {
      const dx = lx - it.x, dz = lz - it.z, d = Math.hypot(dx, dz), m = r + it.r;
      if (d >= m) return null;
      if (d < 1e-4) { out[0] = m; out[1] = 0; } else { out[0] = (dx / d) * (m - d); out[1] = (dz / d) * (m - d); }
      return out;
    }
    if (it.t === 'b') {
      const dx = lx - it.x, dz = lz - it.z, bx = dx * it.c + dz * it.s, bz = -dx * it.s + dz * it.c; // para o espaço da caixa
      const qx = Math.max(-it.hx, Math.min(it.hx, bx)), qz = Math.max(-it.hz, Math.min(it.hz, bz));
      let px, pz;
      if (qx === bx && qz === bz) { // centro dentro: sai pela face mais próxima
        const ex = it.hx - Math.abs(bx), ez = it.hz - Math.abs(bz);
        if (ex < ez) { px = Math.sign(bx || 1) * (ex + r); pz = 0; } else { px = 0; pz = Math.sign(bz || 1) * (ez + r); }
      } else { const ox = bx - qx, oz = bz - qz, d = Math.hypot(ox, oz); if (d >= r) return null; px = (ox / d) * (r - d); pz = (oz / d) * (r - d); }
      out[0] = px * it.c - pz * it.s; out[1] = px * it.s + pz * it.c;
      return out;
    }
    // prisma poligonal: ponto mais próximo nas arestas
    const R = it.ring; let best = Infinity, bx = 0, bz = 0, inside = false;
    for (let i = 0, j = R.length - 1; i < R.length; j = i++) {
      const a = R[j], b = R[i];
      if ((a[1] > lz) !== (b[1] > lz) && lx < ((b[0] - a[0]) * (lz - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
      const ex = b[0] - a[0], ez = b[1] - a[1], l2 = ex * ex + ez * ez;
      const t = l2 > 0 ? Math.max(0, Math.min(1, ((lx - a[0]) * ex + (lz - a[1]) * ez) / l2)) : 0;
      const cx = a[0] + ex * t, cz = a[1] + ez * t, d = (lx - cx) * (lx - cx) + (lz - cz) * (lz - cz);
      if (d < best) { best = d; bx = cx; bz = cz; }
    }
    const d = Math.sqrt(best);
    if (inside) { if (d < 1e-4) { out[0] = r; out[1] = 0; } else { out[0] = ((bx - lx) / d) * (d + r); out[1] = ((bz - lz) / d) * (d + r); } return out; }
    if (d >= r) return null;
    if (d < 1e-4) { out[0] = r; out[1] = 0; } else { out[0] = ((lx - bx) / d) * (r - d); out[1] = ((lz - bz) / d) * (r - d); }
    return out;
  }
  static contains(it, lx, lz) {
    if (it.t === 'c') return Math.hypot(lx - it.x, lz - it.z) < it.r;
    if (it.t === 'b') { const dx = lx - it.x, dz = lz - it.z; return Math.abs(dx * it.c + dz * it.s) < it.hx && Math.abs(-dx * it.s + dz * it.c) < it.hz; }
    let c = false; const R = it.ring;
    for (let i = 0, j = R.length - 1; i < R.length; j = i++) { const a = R[i], b = R[j]; if ((a[1] > lz) !== (b[1] > lz) && lx < ((b[0] - a[0]) * (lz - a[1])) / (b[1] - a[1]) + a[0]) c = !c; }
    return c;
  }
  // Move o cilindro do jogador para fora dos obstáculos. feet/head = alturas dos pés e da cabeça;
  // step = degrau que ele sobe sozinho. Devolve posição corrigida, se bateu, a normal e o piso
  // mais alto (topo de telhado, pedra, banco, muro) que está sob os pés.
  resolve(x, z, r, feet, head, step) {
    const res = this.res; res.x = x; res.z = z; res.hit = false; res.floor = -Infinity; res.nx = 0; res.nz = 0;
    const tmp = [0, 0], f = this.frame;
    for (let iter = 0; iter < 3; iter++) {
      let moved = false;
      this.each(res.x, res.z, r, (it, lx, lz, g) => {
        if (!(it.layer & LAYER.STATIC)) return;
        if (it.y0 >= head) return;                         // acima da cabeça (ex.: copa da árvore): não bloqueia
        if (it.y1 <= feet + step) {                         // baixo o bastante para pisar em cima
          if (it.walk !== false && Physics.contains(it, lx, lz) && it.y1 > res.floor) res.floor = it.y1;
          return;
        }
        const p = Physics.push(it, lx, lz, r, tmp); if (!p) return;
        res.x += (p[0] / g.k) * f.k; res.z += (p[1] / g.k) * f.k; // metros do grupo → metros atuais
        const l = Math.hypot(p[0], p[1]) || 1; res.nx = p[0] / l; res.nz = p[1] / l; res.hit = true; moved = true;
      });
      if (!moved) break;
    }
    return res;
  }
  // existe obstáculo sólido entre dois pontos? (linha de visão para interagir). ignore = id do próprio alvo
  blocked(x0, y0, z0, x1, y1, z1, ignore) {
    const n = Math.max(2, Math.ceil(Math.hypot(x1 - x0, z1 - z0) / 0.25));
    let hit = false;
    for (let i = 1; i < n && !hit; i++) {
      const t = i / n, x = x0 + (x1 - x0) * t, z = z0 + (z1 - z0) * t, y = y0 + (y1 - y0) * t;
      this.each(x, z, 0.05, (it, lx, lz) => { if (hit || !(it.layer & LAYER.STATIC) || it.id === ignore) return; if (y > it.y0 && y < it.y1 && Physics.contains(it, lx, lz)) hit = true; });
    }
    return hit;
  }
  // o ponto está dentro de algum obstáculo sólido? (usado para a câmera não entrar em paredes)
  solidAt(x, y, z) {
    let hit = false;
    this.each(x, z, 0.05, (it, lx, lz) => { if (!hit && (it.layer & LAYER.STATIC) && y > it.y0 && y < it.y1 && Physics.contains(it, lx, lz)) hit = true; });
    return hit;
  }
  // colisores com etiqueta (casa, árvore, poste…) num raio: usados pelo sistema de objetivos
  tagged(x, z, r, cb) { this.each(x, z, r, (it, lx, lz, g) => { if (it.tag) cb(it, g); }); }
}
