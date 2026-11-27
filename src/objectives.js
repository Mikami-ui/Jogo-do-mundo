// Sistema reutilizável de objetivos. Qualquer elemento do cenário que tenha um colisor com etiqueta
// (casa, tronco de árvore, poste, banco, placa, pedra, muro) pode virar objetivo — um único código
// para todos, sem script por objeto. As folhas das árvores não têm colisor nem etiqueta, logo nunca
// recebem objetivo. Um objeto vira objetivo de forma determinística (hash do id), então os mesmos
// objetivos aparecem sempre nos mesmos lugares, e os concluídos ficam salvos no aparelho.
import * as THREE from 'three';
import { RE } from './geo.js';

export const OBJECTIVE_TYPES = {
  house: { nome: 'casa', acao: 'Entregar encomenda', feito: 'Encomenda entregue', p: 0.06 },
  tree: { nome: 'árvore', acao: 'Examinar o tronco', feito: 'Árvore catalogada', p: 0.012 },
  post: { nome: 'poste', acao: 'Consertar a luz do poste', feito: 'Poste consertado', p: 0.16 },
  bench: { nome: 'banco', acao: 'Descansar no banco', feito: 'Descanso feito', p: 0.6 },
  sign: { nome: 'placa', acao: 'Conferir a placa', feito: 'Placa conferida', p: 0.45 },
  rock: { nome: 'pedra', acao: 'Coletar amostra da pedra', feito: 'Amostra coletada', p: 0.3 },
  wall: { nome: 'muro', acao: 'Pintar o muro', feito: 'Muro pintado', p: 0.1 },
};
const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return ((h >>> 0) % 100000) / 100000; };
const REACH = 3.0, SCAN = 130, CAP = 96;

export class Objectives {
  constructor(scene, frame, physics, ui) {
    this.frame = frame; this.physics = physics; this.ui = ui; this.list = []; this.target = null; this.blocked = false; this.t = 0; this.scanT = 0;
    this.done = new Set(); this.counts = {};
    try { const d = JSON.parse(localStorage.getItem('jdm-obj') || '{}'); for (const id of d.ids || []) this.done.add(id); this.counts = d.counts || {}; } catch (e) { /* sem armazenamento */ }
    // indicador: losango flutuante (laranja = pendente, verde = concluído), um draw call para todos
    this.mesh = new THREE.InstancedMesh(new THREE.OctahedronGeometry(0.28, 0), new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false }), CAP);
    this.mesh.count = 0; this.mesh.frustumCulled = false; this.mesh.renderOrder = 11; scene.add(this.mesh);
    this.ring = new THREE.InstancedMesh(new THREE.TorusGeometry(0.5, 0.035, 6, 24).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8, depthWrite: false, fog: false }), CAP);
    this.ring.count = 0; this.ring.frustumCulled = false; this.ring.renderOrder = 11; scene.add(this.ring);
    this.m = new THREE.Matrix4(); this.q = new THREE.Quaternion(); this.v = new THREE.Vector3(); this.s = new THREE.Vector3(); this.up = new THREE.Vector3(0, 1, 0);
    this.cPend = new THREE.Color(3.0, 1.1, 0.2); this.cDone = new THREE.Color(0.25, 1.6, 0.5); this.cNear = new THREE.Color(3.2, 2.6, 0.6);
  }
  get total() { return this.done.size; }
  save() { try { localStorage.setItem('jdm-obj', JSON.stringify({ ids: [...this.done].slice(-4000), counts: this.counts })); } catch (e) { /* ok */ } }
  reset() { this.done.clear(); this.counts = {}; this.save(); this.scanT = 0; }
  // procura objetos etiquetados em volta e decide quais são objetivos
  scan(px, pz) {
    const f = this.frame, out = [];
    this.physics.tagged(px, pz, SCAN, (it, g) => {
      const def = OBJECTIVE_TYPES[it.tag]; if (!def || !it.id) return;
      const done = this.done.has(it.id);
      if (!done && hash(it.id) >= def.p) return;
      const x = f.mercToLocalX(g.amx + it.ax / g.k), z = f.mercToLocalZ(g.amy - it.az / g.k);
      out.push({ id: it.id, tag: it.tag, def, x, y: it.ay, z, done, d: Math.hypot(x - px, z - pz) });
    });
    out.sort((a, b) => a.d - b.d);
    this.list = out.slice(0, CAP);
  }
  update(dt, C, p, active) {
    this.t += dt; this.scanT -= dt;
    if (this.scanT <= 0) { this.scanT = 0.45; this.scan(p.x, p.z); }
    let n = 0, best = null, bd = Infinity, pend = 0;
    for (const o of this.list) {
      const dx = o.x - p.x, dz = o.z - p.z, d = Math.hypot(dx, dz);
      if (!o.done) { pend++; if (d < REACH && Math.abs(o.y - p.y) < 2.6 && d < bd) { bd = d; best = o; } }
      const cx = o.x - C.x, cz = o.z - C.z, dc = Math.hypot(cx, cz), y = o.y + 1.15 + (o.done ? 0 : Math.sin(this.t * 2.4 + o.x) * 0.12) - (dc * dc) / (2 * RE);
      const sc = (o.done ? 0.55 : 1) * (1 + Math.min(dc / 60, 1.6)); // um pouco maior de longe para continuar visível
      this.q.setFromAxisAngle(this.up, this.t * 1.6 + o.x);
      this.mesh.setMatrixAt(n, this.m.compose(this.v.set(cx, y, cz), this.q, this.s.set(sc, sc * 1.35, sc)));
      this.mesh.setColorAt(n, o.done ? this.cDone : o === this.target ? this.cNear : this.cPend);
      const rs = o.done ? 0.001 : 1 + Math.sin(this.t * 3) * 0.08;
      this.ring.setMatrixAt(n, this.m.compose(this.v.set(cx, o.y - 0.85 - (dc * dc) / (2 * RE), cz), this.q.identity(), this.s.set(rs, 1, rs)));
      this.ring.setColorAt(n, this.cPend);
      n++;
    }
    this.mesh.count = this.ring.count = n;
    this.mesh.instanceMatrix.needsUpdate = this.ring.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    if (this.ring.instanceColor) this.ring.instanceColor.needsUpdate = true;
    this.pending = pend;
    // só interage a pé (ou pairando baixo) e com linha de visão livre: não vale através de parede
    this.target = null; this.blocked = false;
    if (active && best && (p.mode === 'walk' || p.mode === 'swim' || (p.mode === 'fly' && p.hover))) {
      this.blocked = this.physics.blocked(p.x, p.y + 0.3, p.z, best.x, best.y, best.z, best.id);
      if (!this.blocked) this.target = best;
      this.ui.prompt(this.blocked ? 'Sem acesso: há um obstáculo no caminho' : best.def.acao, !this.blocked);
    } else this.ui.prompt(null);
  }
  // conclui o objetivo ao alcance; devolve true se concluiu
  interact() {
    const o = this.target; if (!o || o.done) return false;
    o.done = true; this.done.add(o.id); this.counts[o.tag] = (this.counts[o.tag] || 0) + 1; this.save(); this.target = null;
    this.ui.completed(o);
    return true;
  }
}
