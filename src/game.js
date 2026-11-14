// Desafios: percurso de anéis, corridas entre cidades, destino marcado, recordes e descobertas.
import * as THREE from 'three';
import { RE, DEG } from './geo.js';

const load = (k, d) => { try { return { ...d, ...JSON.parse(localStorage.getItem(k) || '{}') }; } catch (e) { return { ...d }; } };
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* ok */ } };
export const fmtTime = (s) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;

export class Game {
  constructor(scene, frame, terrain, player, camera, ui) {
    this.scene = scene; this.frame = frame; this.terrain = terrain; this.player = player; this.camera = camera; this.ui = ui;
    this.stats = load('jdm-stats', { maxSpeed: 0, maxAlt: 0, km: 0, bestRings: 0, bestRace: 0, ringsDone: 0, racesDone: 0 });
    this.found = load('jdm-found', {});
    this.mode = null; this.t = 0; this.rings = []; this.ringI = 0; this.dest = null; this.saveT = 0;
    this.ringGeo = new THREE.TorusGeometry(26, 1.5, 8, 40);
    this.matNext = new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 1.1, 0.2), transparent: true, opacity: 0.95, depthWrite: false });
    this.matLater = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 1.6, 1.6), transparent: true, opacity: 0.35, depthWrite: false });
    this.group = new THREE.Group(); scene.add(this.group);
    // feixe de luz do destino
    this.beam = new THREE.Mesh(new THREE.CylinderGeometry(22, 22, 1, 20, 1, true), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.5, 0.9, 0.2), transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, fog: false }));
    this.beam.visible = false; this.beam.frustumCulled = false; this.beam.renderOrder = 10; scene.add(this.beam);
    this.v = new THREE.Vector3(); this.prev = { x: 0, y: 0, z: 0 };
  }
  stop(silent) {
    this.mode = null; this.dest = null; this.beam.visible = false;
    for (const r of this.rings) this.group.remove(r.mesh);
    this.rings = [];
    this.ui.goal(''); this.ui.pointer(null);
    if (!silent) this.ui.toast('Desafio encerrado');
  }
  // rebase da origem: desloca o que está guardado em coordenadas locais
  shift(ox, oz) { for (const r of this.rings) { r.x -= ox; r.z -= oz; } this.prev.x -= ox; this.prev.z -= oz; }
  startRings() {
    this.stop(true);
    const p = this.player;
    let x = p.x, z = p.z, hd = p.yaw, y = p.y;
    const fast = p.speed > 250;
    for (let i = 0; i < 12; i++) {
      hd += (Math.random() - 0.5) * (i === 0 ? 0.2 : 0.9);
      const step = (i === 0 ? 350 : 450 + Math.random() * 350) * (fast ? 2.2 : 1);
      x += Math.sin(hd) * step; z -= Math.cos(hd) * step;
      const g = this.terrain.heightAt(x, z);
      const want = (g.ok ? g.h : y - 150) + 70 + Math.random() * 130;
      y = Math.max(want, y - 180); y = Math.min(y, want + 250);
      const mesh = new THREE.Mesh(this.ringGeo, this.matLater);
      mesh.frustumCulled = false; mesh.renderOrder = 9;
      mesh.rotation.set(0, -hd, 0);
      this.group.add(mesh);
      this.rings.push({ x, y, z, hd, mesh });
    }
    this.mode = 'rings'; this.ringI = 0; this.t = 0;
    this.prev = { x: p.x, y: p.y, z: p.z };
    this.ui.toast('Passe pelos 12 anéis!');
  }
  startRace(city) {
    this.stop(true);
    const p = this.frame.toLocal(...this.ll(city));
    const d = Math.hypot(p.x - this.player.x, p.z - this.player.z);
    this.dest = { name: city.name, mx: city.mx, my: city.my, d0: d, race: true };
    this.mode = 'race'; this.t = 0;
    this.ui.toast('Corrida até ' + city.name);
  }
  setDest(name, mx, my) {
    this.stop(true);
    this.dest = { name, mx, my, race: false }; this.mode = 'dest';
    this.ui.toast('Destino: ' + name);
  }
  ll(o) { return [(2 * Math.atan(Math.exp(o.my / 6378137)) - Math.PI / 2) / DEG, o.mx / 6378137 / DEG]; }
  update(dt, C, landmarks, playing) {
    const p = this.player, S = this.stats;
    if (!playing) return;
    // recordes
    S.km += (p.speed * dt) / 1000;
    if (p.speed > S.maxSpeed + 1) { if (p.speed * 3.6 > Math.max(S.maxSpeed * 3.6 * 1.15, 1000)) this.ui.toast(`Novo recorde: ${Math.round(p.speed * 3.6).toLocaleString('pt-BR')} km/h`); S.maxSpeed = p.speed; }
    if (p.y > S.maxAlt) S.maxAlt = p.y;
    this.saveT += dt; if (this.saveT > 5) { this.saveT = 0; save('jdm-stats', S); }
    // descobertas
    for (const L of landmarks.items) {
      if (L.dist < 900 && L.h != null && Math.abs(p.y - L.h) < 1500 && !this.found[L.id]) {
        this.found[L.id] = Date.now(); save('jdm-found', this.found);
        this.ui.toast(`Descoberta: ${L.name} (${Object.keys(this.found).length}/${landmarks.items.length})`);
        this.ui.sound?.('boom');
      }
    }
    if (!this.mode) return;
    this.t += dt;
    if (this.mode === 'rings') {
      const R = this.rings;
      for (let i = 0; i < R.length; i++) {
        const r = R[i];
        r.mesh.visible = i >= this.ringI;
        r.mesh.material = i === this.ringI ? this.matNext : this.matLater;
        r.mesh.position.set(r.x - C.x, r.y, r.z - C.z);
        if (i === this.ringI) r.mesh.rotation.z += dt * 0.8;
      }
      const r = R[this.ringI];
      // menor distância do trecho percorrido neste quadro até o centro do anel
      const ax = this.prev.x, ay = this.prev.y, az = this.prev.z, bx = p.x - ax, by = p.y - ay, bz = p.z - az;
      const l2 = bx * bx + by * by + bz * bz;
      const tt = l2 > 0 ? Math.min(Math.max(((r.x - ax) * bx + (r.y - ay) * by + (r.z - az) * bz) / l2, 0), 1) : 0;
      const dd = Math.hypot(ax + bx * tt - r.x, ay + by * tt - r.y, az + bz * tt - r.z);
      if (dd < 30) {
        this.ringI++; this.ui.sound?.('whoosh');
        if (this.ringI >= R.length) {
          const best = !S.bestRings || this.t < S.bestRings;
          if (best) S.bestRings = this.t; S.ringsDone++; save('jdm-stats', S);
          this.ui.toast(`Percurso completo em ${fmtTime(this.t)}${best ? ' — novo recorde!' : ''}`);
          this.ui.sound?.('boom');
          this.stop(true);
          return;
        }
      }
      const n = R[this.ringI];
      this.ui.goal(`ANÉIS ${this.ringI}/${R.length} · ${fmtTime(this.t)}`);
      this.ui.pointer(this.project(n.x - C.x, n.y, n.z - C.z), Math.hypot(n.x - p.x, n.y - p.y, n.z - p.z));
    } else if (this.dest) {
      const D = this.dest, f = this.frame;
      const x = f.mercToLocalX(D.mx), z = f.mercToLocalZ(D.my);
      const d = Math.hypot(x - p.x, z - p.z);
      const g = this.terrain.heightAt(x, z);
      const gy = (g.ok ? g.h : 0) - (d * d) / (2 * RE);
      this.beam.visible = d < 400000;
      const hgt = 6000 + d * 0.05;
      this.beam.position.set(x - C.x, gy + hgt / 2, z - C.z);
      this.beam.scale.set(1 + d / 2500, hgt, 1 + d / 2500);
      const km = d / 1000;
      this.ui.goal(`${D.race ? 'CORRIDA' : 'DESTINO'} → ${D.name.toUpperCase()} · ${km >= 100 ? Math.round(km) : km.toFixed(1)} km${D.race ? ' · ' + fmtTime(this.t) : ''}`);
      this.ui.pointer(this.project(x - C.x, gy + 300 + d * 0.02, z - C.z), d);
      if (d < (D.race ? 1500 : 800)) {
        if (D.race) {
          const avg = (D.d0 / Math.max(this.t, 0.1)) * 3.6;
          const best = avg > S.bestRace; if (best) S.bestRace = avg; S.racesDone++; save('jdm-stats', S);
          this.ui.toast(`${D.name}: ${fmtTime(this.t)} · média ${Math.round(avg).toLocaleString('pt-BR')} km/h${best ? ' — recorde!' : ''}`);
        } else this.ui.toast('Você chegou: ' + D.name);
        this.ui.sound?.('boom');
        this.stop(true);
      }
    }
    this.prev.x = p.x; this.prev.y = p.y; this.prev.z = p.z;
  }
  // posição na tela (ou direção, se fora dela)
  project(x, y, z) {
    const v = this.v.set(x, y, z).applyMatrix4(this.camera.matrixWorldInverse);
    const behind = v.z > 0;
    v.applyMatrix4(this.camera.projectionMatrix);
    let sx = v.x, sy = v.y;
    if (behind) { sx = -sx; sy = -sy; }
    const on = !behind && Math.abs(sx) < 0.92 && Math.abs(sy) < 0.86;
    return { x: sx, y: sy, on };
  }
}
