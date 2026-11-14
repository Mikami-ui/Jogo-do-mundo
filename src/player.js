// Personagem original (traje wingsuit azul/laranja com botas-jato), física de voo e câmera.
import * as THREE from 'three';
import { clamp, lerp, speedOfSound } from './geo.js';

const SUIT = 0x1c3f9e, SUIT2 = 0x14245a, ACC = 0xff6a1a, SKIN = 0xeeeeee;

function cap(r, len, color, rough = 0.6) {
  const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 4, 10), new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0.1 }));
  return m;
}
function limb(r, len, color) {
  // membro com pivô no topo, apontando para -Y
  const g = new THREE.Group();
  const m = cap(r, len, color); m.position.y = -len / 2 - r * 0.3; g.add(m);
  return g;
}

export class Avatar {
  constructor() {
    this.root = new THREE.Group();
    this.body = new THREE.Group(); this.root.add(this.body); // pivô de rotação (centro do corpo)
    const B = new THREE.Group(); B.position.y = -1.0; this.body.add(B); // pés em y=0 no espaço do corpo
    const torso = cap(0.19, 0.42, SUIT, 0.45); torso.position.y = 1.28; torso.scale.set(1.08, 1, 0.8); B.add(torso);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.5, 0.33), new THREE.MeshStandardMaterial({ color: ACC, emissive: ACC, emissiveIntensity: 0.35 }));
    stripe.position.set(0, 1.3, 0); B.add(stripe);
    const pelvis = cap(0.17, 0.12, SUIT2); pelvis.position.y = 0.98; pelvis.scale.set(1.05, 1, 0.8); B.add(pelvis);
    const pack = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.3, 0.07), new THREE.MeshStandardMaterial({ color: 0x2a3a66, roughness: 0.45, metalness: 0.3 }));
    pack.position.set(0, 1.32, 0.16); B.add(pack);
    const packLight = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.03, 0.075), new THREE.MeshStandardMaterial({ color: ACC, emissive: ACC, emissiveIntensity: 0.8 }));
    packLight.position.set(0, 1.42, 0.165); B.add(packLight);
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.135, 20, 14), new THREE.MeshStandardMaterial({ color: SKIN, roughness: 0.25, metalness: 0.2 }));
    helmet.position.y = 1.72; helmet.scale.set(1, 1.1, 1.05); B.add(helmet);
    const crest = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.05, 0.27), new THREE.MeshStandardMaterial({ color: ACC, emissive: ACC, emissiveIntensity: 0.3 }));
    crest.position.set(0, 1.86, 0.01); B.add(crest);
    const visor = new THREE.Mesh(new THREE.SphereGeometry(0.128, 20, 12, Math.PI * 1.15, Math.PI * 0.7, Math.PI * 0.3, Math.PI * 0.35),
      new THREE.MeshStandardMaterial({ color: 0x0b0d14, roughness: 0.05, metalness: 0.9, emissive: 0xff7a30, emissiveIntensity: 0.08 }));
    visor.position.copy(helmet.position); visor.scale.set(1.06, 1.12, 1.1); B.add(visor);
    const mk = (side) => {
      const sh = new THREE.Group(); sh.position.set(0.25 * side, 1.5, 0); B.add(sh);
      const upper = limb(0.06, 0.26, SUIT); sh.add(upper);
      const el = new THREE.Group(); el.position.y = -0.33; upper.add(el);
      const fore = limb(0.05, 0.24, SUIT); el.add(fore);
      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.055, 10, 8), new THREE.MeshStandardMaterial({ color: 0x1a1a1a })); hand.position.y = -0.33; fore.add(hand);
      const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.058, 0.058, 0.05, 10), new THREE.MeshStandardMaterial({ color: ACC, emissive: ACC, emissiveIntensity: 0.5 })); cuff.position.y = -0.27; fore.add(cuff);
      const hip = new THREE.Group(); hip.position.set(0.1 * side, 0.94, 0); B.add(hip);
      const thigh = limb(0.08, 0.34, SUIT2); hip.add(thigh);
      const kn = new THREE.Group(); kn.position.y = -0.44; thigh.add(kn);
      const shin = limb(0.065, 0.32, SUIT); kn.add(shin);
      const boot = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.09, 0.2), new THREE.MeshStandardMaterial({ color: 0x3a4255, metalness: 0.5, roughness: 0.35 }));
      boot.position.set(0, -0.44, -0.04); shin.add(boot);
      const flame = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.7, 10, 1, true), new THREE.MeshBasicMaterial({ color: 0xffa040, transparent: true, opacity: 0.0, blending: THREE.AdditiveBlending, depthWrite: false }));
      flame.position.set(0, -0.82, 0); flame.rotation.x = Math.PI; shin.add(flame);
      return { sh, upper, el, hand, hip, thigh, kn, flame };
    };
    this.L = mk(-1); this.R = mk(1);
    // membranas do wingsuit (atualizadas por quadro)
    this.wingGeo = new THREE.BufferGeometry();
    this.wingPos = new Float32Array(3 * 3 * 3);
    this.wingGeo.setAttribute('position', new THREE.BufferAttribute(this.wingPos, 3));
    this.wing = new THREE.Mesh(this.wingGeo, new THREE.MeshStandardMaterial({ color: SUIT, side: THREE.DoubleSide, roughness: 0.55, transparent: true, opacity: 0.94 }));
    this.wing.frustumCulled = false;
    B.add(this.wing);
    this.B = B;
    // materiais agrupados por papel, para personalizar as cores
    this.parts = { suit: [], suit2: [], acc: [], helmet: [] };
    this.root.traverse((o) => {
      if (!o.isMesh || !o.material.color) return;
      const hex = o.material.color.getHex();
      if (hex === SUIT) this.parts.suit.push(o.material); else if (hex === SUIT2) this.parts.suit2.push(o.material);
      else if (hex === ACC) this.parts.acc.push(o.material); else if (hex === SKIN) this.parts.helmet.push(o.material);
    });
    this.t = 0; this.fly = 1; this.walkPhase = 0;
    this.tmp = new THREE.Vector3(); this.inv = new THREE.Matrix4();
    this.handL = new THREE.Vector3(); this.handR = new THREE.Vector3();
  }
  setColors(suit, acc, helmet) {
    const c = new THREE.Color(suit);
    for (const m of this.parts.suit) m.color.copy(c);
    for (const m of this.parts.suit2) m.color.copy(c).multiplyScalar(0.5);
    for (const m of this.parts.acc) { m.color.set(acc); if (m.emissive) m.emissive.set(acc); }
    for (const m of this.parts.helmet) m.color.set(helmet);
  }
  // pose: fly (0..1), spread (abertura do wingsuit), walk speed, boost
  animate(dt, s) {
    this.t += dt;
    const k = 1 - Math.exp(-dt * 6);
    this.fly = lerp(this.fly, s.fly, k);
    const f = this.fly;
    this.body.rotation.x = -Math.PI / 2 * f * (s.upright ? 0.55 : 1);
    this.walkPhase += dt * s.walk * 1.6;
    const sw = Math.sin(this.walkPhase) * Math.min(s.walk / 5, 1) * (1 - f);
    const flut = Math.sin(this.t * 21) * 0.025 * s.flutter;
    for (const [side, P] of [[-1, this.L], [1, this.R]]) {
      // braços: em voo abertos (asa), andando balançam
      const spread = s.spread;
      P.sh.rotation.z = side * lerp(0.12, lerp(0.35, 1.25, spread), f) + flut * side;
      P.sh.rotation.x = lerp(sw * side * 0.9, lerp(-0.1, 0.25, spread), f);
      P.el.rotation.x = lerp(-0.25 - Math.max(0, sw * side) * 0.5, -0.05, f);
      P.hip.rotation.z = side * lerp(0.03, 0.05 + spread * 0.17, f);
      P.hip.rotation.x = lerp(-sw * side * 0.8, s.upright ? 0.25 : 0.06, f);
      P.kn.rotation.x = lerp(Math.max(0, sw * side) * 1.1, s.upright ? 0.5 : 0.1 + flut, f);
      P.flame.material.opacity = s.boost * (0.6 + Math.random() * 0.4);
      P.flame.scale.set(1, 0.6 + s.boost * (1.2 + Math.random() * 0.8), 1);
    }
    // membranas: ombro-pulso-quadril e entre as pernas
    this.B.updateMatrixWorld(true);
    this.inv.copy(this.B.matrixWorld).invert();
    const lp = (o, v) => o.getWorldPosition(v).applyMatrix4(this.inv);
    const sL = lp(this.L.sh, new THREE.Vector3()), sR = lp(this.R.sh, new THREE.Vector3());
    const hL = lp(this.L.hand, new THREE.Vector3()), hR = lp(this.R.hand, new THREE.Vector3());
    const pL = lp(this.L.hip, new THREE.Vector3()), pR = lp(this.R.hip, new THREE.Vector3());
    const aL = lp(this.L.kn, new THREE.Vector3()), aR = lp(this.R.kn, new THREE.Vector3());
    const w = this.wingPos; let i = 0;
    const put = (...vs) => { for (const v of vs) { w[i++] = v.x; w[i++] = v.y; w[i++] = v.z; } };
    put(sL, hL, pL); put(sR, pR, hR);
    const mid = pL.clone().add(pR).multiplyScalar(0.5);
    const ankL = aL.clone().lerp(pL, -0.9), ankR = aR.clone().lerp(pR, -0.9);
    put(mid, ankL, ankR);
    this.wingGeo.attributes.position.needsUpdate = true;
    this.wingGeo.computeVertexNormals();
    this.wing.visible = f > 0.3;
    this.wing.material.opacity = 0.94 * clamp((f - 0.3) / 0.4, 0, 1);
    this.L.hand.getWorldPosition(this.handL); this.R.hand.getWorldPosition(this.handR);
  }
}

// ---------------- física ----------------
// Níveis de boost: velocidade de cruzeiro (analógico) e velocidade máxima com o TURBO (m/s)
export const BOOSTS = [
  { name: 'Passeio', cruise: 12, top: 70, run: 9 },
  { name: 'Rápido', cruise: 30, top: 250, run: 12 },
  { name: 'Supersônico', cruise: 60, top: 680, run: 16 },
  { name: 'Hipersônico', cruise: 110, top: 2040, run: 20 },
  { name: 'Orbital', cruise: 160, top: 7800, run: 24 },
  { name: 'Máximo', cruise: 200, top: Infinity, run: 28 },
];
const angDiff = (a, b) => { let d = (a - b) % (2 * Math.PI); if (d > Math.PI) d -= 2 * Math.PI; if (d < -Math.PI) d += 2 * Math.PI; return d; };

export class Player {
  constructor() {
    this.x = 0; this.y = 2000; this.z = 0;
    this.vx = 0; this.vy = 0; this.vz = 0;
    this.yaw = 0; this.pitch = 0; this.roll = 0; this.speed = 0;
    this.mode = 'fly'; // walk | swim | fly | glide
    this.boost = 1; this.agl = 1000; this.ground = 0; this.onWater = false; this.waterLevel = 0;
    this.onGround = false; this.hover = true; this.landing = false; this.landT = 0; this.t = 0;
    this.events = []; this.boostAmt = 0; this.machPrev = 0;
    this.dir = new THREE.Vector3(0, 0, -1); this.L = new THREE.Vector3(); this.tmp = new THREE.Vector3();
  }
  forward(out) {
    if (this.speed > 2) return out.set(this.vx, this.vy, this.vz).multiplyScalar(1 / this.speed);
    const cp = Math.cos(this.pitch);
    return out.set(Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp);
  }
  get mach() { return this.speed / speedOfSound(this.y); }
  get hspeed() { return Math.hypot(this.vx, this.vz); }
  // coloca o jogador voando numa direção (teletransporte)
  launch(yaw, pitch, speed) {
    this.mode = 'fly'; this.landing = false; this.yaw = yaw; this.pitch = pitch;
    this.dir.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
    this.speed = speed; this.vx = this.dir.x * speed; this.vy = this.dir.y * speed; this.vz = this.dir.z * speed;
    this.hover = speed < 14; this.machPrev = this.mach;
  }
  // terreno, água e construções num ponto
  probe(terrain, world, x, z) {
    const g = terrain.heightAt(x, z);
    const lake = world.waterAt(x, z);
    const b = world.buildingAt(x, z);
    let sea = !!g.water;
    if (sea) { const c = terrain.colorAt(x, z); if (c && c[0] > c[2] * 1.12 && c[0] + c[1] + c[2] > 300) sea = false; } // areia clara na foto: é praia
    else if (g.ok && g.h < 14 && !lake) { // costa: o relevo às vezes marca o mar 1–4 m acima de zero; a foto azul-escura decide
      const c = terrain.colorAt(x, z);
      if (c) { const l = (v) => (v / 255) ** 2.2, r = l(c[0]), gg = l(c[1]), bb = l(c[2]); if (bb > r * 2.2 && bb > gg * 0.85 && 0.21 * r + 0.72 * gg + 0.07 * bb < 0.22) sea = true; }
    }
    return { ground: g.h, ok: g.ok, water: sea || !!lake, level: lake ? (lake.ocean ? Math.max(g.h, 0) : Math.max(lake.level ?? -1e9, g.h + 0.45)) : g.water ? 0 : g.h, roof: b ? b.top : null };
  }
  // move com colisão nas paredes; devolve true se bateu
  move(dt, terrain, world) {
    const nx = this.x + this.vx * dt, nz = this.z + this.vz * dt;
    const feet = this.y - 1;
    const blocked = (x, z) => { const b = world.buildingAt(x, z); return b && feet < b.top - 0.6; };
    // já está dentro de uma construção (ela carregou depois): sobe para o telhado em vez de ficar preso
    const inside = world.buildingAt(this.x, this.z);
    if (inside && feet < inside.top - 0.6) { this.y = inside.top + 1.05; this.vy = 0; this.x = nx; this.z = nz; return false; }
    if (!blocked(nx, nz)) { this.x = nx; this.z = nz; return false; }
    if (!blocked(nx, this.z)) { this.x = nx; this.vz *= 0.2; }
    else if (!blocked(this.x, nz)) { this.z = nz; this.vx *= 0.2; }
    else { this.vx *= 0.1; this.vz *= 0.1; }
    return true;
  }
  toggleFly() {
    if (this.mode === 'fly') { this.landing = !this.landing; if (this.landing) this.events.push('landing'); }
    else {
      if (this.mode === 'swim') this.events.push('splash');
      const wasGround = this.mode !== 'glide';
      this.mode = 'fly'; this.landing = false; this.hover = this.speed < 14;
      if (wasGround) { this.y += 0.6; this.vy = 6; this.vx *= 0.5; this.vz *= 0.5; }
      this.events.push('takeoff');
    }
  }
  update(dt, inp, terrain, world, cam) {
    this.t += dt;
    const here = this.probe(terrain, world, this.x, this.z);
    this.ground = here.ground; this.onWater = here.water; this.waterLevel = here.level;
    const alt = Math.max(this.y, 0), rho = Math.exp(-alt / 8500);
    const B = BOOSTS[this.boost];
    const turbo = !!inp.turbo;
    this.boostAmt = lerp(this.boostAmt, turbo && this.mode !== 'swim' ? 1 : 0, 1 - Math.exp(-dt * 6));
    this.landT = Math.max(0, this.landT - dt);
    const cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw), cpt = Math.cos(cam.pitch);
    const L = this.L.set(sy * cpt, Math.sin(cam.pitch), -cy * cpt);
    const m = Math.min(Math.hypot(inp.mx, inp.my), 1);
    if (inp.fly()) this.toggleFly();
    if (inp.glide() && this.mode === 'fly' && this.agl > 4) { this.mode = 'glide'; this.landing = false; this.speed = Math.max(this.speed, 22); this.pitch = Math.min(this.pitch, -0.2); this.yaw = Math.atan2(this.dir.x, -this.dir.z); this.events.push('release'); }

    if (this.mode === 'walk' || this.mode === 'swim') {
      const swim = this.mode === 'swim';
      // direção do analógico relativa à câmera
      let tx = 0, tz = 0;
      if (m > 0.06) {
        const a = cam.yaw + Math.atan2(inp.mx, inp.my);
        const sp = swim ? (turbo ? 4.6 : 1.9) * m : turbo ? B.run * Math.max(m, 0.6) : m < 0.45 ? (m / 0.45) * 1.7 : lerp(1.7, 6.4, (m - 0.45) / 0.55);
        tx = Math.sin(a) * sp; tz = -Math.cos(a) * sp;
        this.yaw += angDiff(a, this.yaw) * (1 - Math.exp(-dt * (swim ? 5 : 12)));
      }
      const acc = 1 - Math.exp(-dt * (swim ? 3 : this.onGround ? 11 : 2.2));
      this.vx += (tx - this.vx) * acc; this.vz += (tz - this.vz) * acc;
      if (this.move(dt, terrain, world) && this.hspeed > 8) this.events.push('bonk');
      const e = this.probe(terrain, world, this.x, this.z);
      const feet = this.y - 1;
      let floor = e.ground + 1;
      if (e.roof != null && feet >= e.roof - 0.6) floor = Math.max(floor, e.roof + 1);
      if (swim) {
        if (!e.water) { this.mode = 'walk'; this.y = Math.max(this.y, floor); this.vy = 0; this.onGround = true; this.events.push('land'); }
        else {
          this.y = lerp(this.y, e.level + 0.02 + Math.sin(this.t * 2.2) * 0.035, 1 - Math.exp(-dt * 6)); this.vy = 0;
          if (inp.jump()) this.toggleFly();
        }
        this.onGround = false;
      } else {
        const was = this.onGround;
        if (inp.jump() && this.onGround) { this.vy = turbo ? 9.5 : 6.6; this.onGround = false; this.events.push('jump'); }
        this.vy -= 19 * dt;
        this.y += this.vy * dt;
        if (this.y <= floor || (was && this.vy <= 0 && this.y - floor < 0.75)) {
          if (this.vy < -11) { this.landT = 0.32; this.events.push(this.vy < -30 ? 'impact' : 'land'); }
          this.y = floor; this.vy = 0; this.onGround = true;
        } else this.onGround = false;
        if (e.water && this.y <= e.level + 1.15) { this.mode = 'swim'; this.onGround = false; if (this.vy < -4 || this.hspeed > 5) this.events.push('splash'); this.vy = 0; }
        // caiu de muito alto: abre o wingsuit
        else if (!this.onGround && this.y - floor > 45 && this.vy < -24) { this.mode = 'glide'; this.speed = Math.hypot(this.vx, this.vy, this.vz); this.pitch = -0.6; this.events.push('release'); }
      }
      this.pitch = 0; this.roll = lerp(this.roll, 0, 1 - Math.exp(-dt * 8));
      this.speed = Math.hypot(this.vx, this.vy, this.vz); this.hover = false; this.landing = false;
      this.agl = this.y - floor;
    } else if (this.mode === 'fly') {
      const fwd = Math.max(inp.my, 0), back = Math.max(-inp.my, 0);
      const vmaxAir = Math.min(1700 * Math.exp(alt / 12000), 120000);
      const sT = this.landing ? 0 : turbo ? Math.min(B.top, vmaxAir) : fwd * B.cruise;
      let s = this.speed;
      const flight = !this.landing && (s > 14 || sT > 14);
      const d = this.dir;
      if (flight) {
        // voo rápido: voa para onde a câmera aponta; o analógico vira (X) e acelera/freia (Y)
        cam.yaw += inp.mx * lerp(1.5, 0.55, clamp(s / 1500, 0, 1)) * dt;
        if (s < 1.5) d.copy(L);
        // só muda de rumo quando o jogador pilota (analógico ou turbo); sem comando, segue reto e a visão fica livre
        const steer = fwd > 0.05 || turbo || Math.abs(inp.mx) > 0.05;
        const ang = d.angleTo(L), w = lerp(3.2, 1.3, clamp(s / 1200, 0, 1)) * dt;
        if (steer && ang > 1e-4) { this.tmp.copy(L).sub(d).multiplyScalar(Math.min(1, w / ang)); d.add(this.tmp).normalize(); }
        if (inp.brake || back > 0.15) s -= (s * 2.3 + 14) * dt * Math.max(back, inp.brake ? 1 : 0);
        else if (sT > s) s = Math.min(sT, s + (turbo ? (B.top === Infinity ? 26 + s * 0.55 : Math.max((sT - s) * 0.85, 12)) : (sT - s) * 1.3 + 5) * dt);
        else s = Math.max(sT, s - (Math.sqrt(rho) * 0.4 * (s - sT) + 2.5 * Math.sqrt(rho)) * dt);
        s = Math.max(s, 0);
        this.vx = d.x * s; this.vy = d.y * s; this.vz = d.z * s;
        const yawT = Math.atan2(d.x, -d.z);
        const dy = angDiff(yawT, this.yaw);
        this.roll = lerp(this.roll, clamp(-dy / Math.max(dt, 1e-3) * 0.55 - inp.mx * 0.5, -1.1, 1.1) * clamp(s / 30, 0.3, 1), 1 - Math.exp(-dt * 4));
        this.yaw = yawT; this.pitch = Math.asin(clamp(d.y, -1, 1));
      } else {
        // pairando: move-se em qualquer direção relativa à câmera (para a frente segue o olhar)
        let wx = 0, wy = 0, wz = 0;
        if (this.landing) { wy = -clamp(this.agl * 1.3 + 3, 3, 90); }
        else {
          const hv = 11;
          wx = (L.x * inp.my + cy * inp.mx) * hv; wz = (L.z * inp.my + sy * inp.mx) * hv; wy = (L.y * inp.my + (inp.up || 0)) * hv;
          if (inp.brake) { wx = wz = wy = 0; }
        }
        const k = 1 - Math.exp(-dt * 4);
        this.vx += (wx - this.vx) * k; this.vy += (wy - this.vy) * (this.landing ? 1 - Math.exp(-dt * 8) : k); this.vz += (wz - this.vz) * k;
        s = Math.hypot(this.vx, this.vy, this.vz);
        if (s > 0.5) d.set(this.vx, this.vy, this.vz).multiplyScalar(1 / s);
        if (m > 0.1 || s > 2) this.yaw += angDiff(cam.yaw, this.yaw) * (1 - Math.exp(-dt * 6));
        this.pitch = lerp(this.pitch, 0, 1 - Math.exp(-dt * 6)); this.roll = lerp(this.roll, -inp.mx * 0.22, 1 - Math.exp(-dt * 5));
      }
      this.speed = s; this.hover = !flight; this.onGround = false;
      const py = this.y;
      // parede: em voo rápido quica para cima; pairando só desliza (dá para subir rente à parede)
      if (this.move(dt, terrain, world) && flight) { if (s > 20) this.events.push('impact'); s *= 0.25; this.speed = s; d.y = Math.abs(d.y) + 0.3; d.normalize(); this.vx = d.x * s; this.vz = d.z * s; this.vy = d.y * s; }
      this.y += this.vy * dt;
      const e = this.probe(terrain, world, this.x, this.z);
      let floor = e.ground + 1;
      if (e.roof != null && py - 1 >= e.roof - 0.6) floor = Math.max(floor, e.roof + 1);
      if (e.water && this.y < e.level + 1.0 && floor <= e.level + 1.1) {
        if (s < 18 || this.landing) { this.mode = 'swim'; this.landing = false; this.events.push('splash'); this.vy = 0; }
        else { if (this.vy < -15) this.events.push('splash'); this.y = e.level + 1.0; d.y = Math.max(d.y, 0.03); d.normalize(); }
      } else if (this.y < floor) {
        if (this.vy < -20 && !this.landing) { this.events.push('impact'); s *= 0.5; this.speed = s; }
        this.y = floor;
        if (this.landing || (s < 16 && !turbo)) { this.mode = 'walk'; this.landing = false; this.onGround = true; this.landT = 0.3; this.vy = 0; this.events.push('land'); }
        else { d.y = Math.max(d.y, 0.03); d.normalize(); }
      }
      this.agl = this.y - floor;
    } else {
      // planando de wingsuit: vira com o analógico (X); para a frente mergulha, para trás freia o mergulho
      cam.yaw += inp.mx * 1.0 * dt;
      this.yaw += angDiff(cam.yaw, this.yaw) * (1 - Math.exp(-dt * 3));
      this.pitch = lerp(this.pitch, -0.4 - inp.my * 0.32, 1 - Math.exp(-dt * 2.2));
      let s = this.speed;
      s += (-9.81 * Math.sin(this.pitch) - 0.00145 * rho * s * s) * dt;
      if (rho < 0.2) s += 9.81 * dt * 0.5;
      s = Math.max(s, 5); this.speed = s;
      const d = this.dir.set(Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch));
      this.vx = d.x * s; this.vy = d.y * s; this.vz = d.z * s;
      this.roll = lerp(this.roll, -inp.mx * 0.7, 1 - Math.exp(-dt * 4));
      const py = this.y;
      const hit = this.move(dt, terrain, world);
      this.y += this.vy * dt;
      const e = this.probe(terrain, world, this.x, this.z);
      let floor = e.ground + 1;
      if (e.roof != null && py - 1 >= e.roof - 0.6) floor = Math.max(floor, e.roof + 1);
      if (turbo || inp.jump()) { this.mode = 'fly'; this.hover = false; this.events.push('takeoff'); }
      else if (e.water && this.y < e.level + 1.0 && floor <= e.level + 1.1) { this.mode = 'swim'; this.events.push('splash'); this.vx *= 0.2; this.vz *= 0.2; this.vy = 0; }
      else if (this.y < floor || hit) {
        if (s > 32 || hit) this.events.push('impact');
        this.y = Math.max(this.y, floor); this.mode = 'walk'; this.onGround = !hit; this.landT = 0.35; this.vx *= 0.15; this.vz *= 0.15; this.vy = 0; this.events.push('land');
      }
      this.hover = false; this.onGround = false; this.agl = this.y - floor;
    }
    // Mach 1: estrondo sônico
    const mc = this.mach;
    if (this.machPrev < 1 && mc >= 1 && rho > 0.05) this.events.push('boom');
    this.machPrev = mc;
  }
}

// ---------------- câmera ----------------
// Órbita livre em torno do personagem: o jogador gira a visão; voando, o personagem segue para onde a câmera aponta.
export class CameraRig {
  constructor(camera) {
    this.camera = camera; this.mode = 0; // 0 normal, 1 perto, 2 primeira pessoa
    this.yaw = 0; this.pitch = -0.12; this.dist = 8; this.shake = 0; this.fov = 65;
    this.L = new THREE.Vector3(); this.look = new THREE.Vector3();
  }
  next() { this.mode = (this.mode + 1) % 3; return ['Câmera normal', 'Câmera próxima', 'Primeira pessoa'][this.mode]; }
  turn(dx, dy) { this.yaw += dx; this.pitch = clamp(this.pitch - dy, -1.45, 1.45); }
  update(dt, p, terrain) {
    const v = p.speed;
    const sp = clamp(Math.log(1 + v / 60) / Math.log(1 + 3000 / 60), 0, 1);
    const ground = p.mode === 'walk' || p.mode === 'swim';
    const cp = Math.cos(this.pitch);
    const L = this.L.set(Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp);
    const fp = this.mode === 2;
    const want = fp ? 0 : ground ? (this.mode === 1 ? 2.6 : 4.4) : this.mode === 1 ? 4 + sp * 1.5 : 6.5 + sp * 3.5;
    this.dist = lerp(this.dist, want, 1 - Math.exp(-dt * 5));
    const up = fp ? (ground ? 0.72 : 0.2) : ground ? 0.95 : p.hover ? 1.0 : 1.25;
    const C = { x: p.x - L.x * this.dist + (fp ? L.x * 0.25 : 0), y: p.y + up - L.y * this.dist, z: p.z - L.z * this.dist + (fp ? L.z * 0.25 : 0) };
    const g = terrain.heightAt(C.x, C.z);
    if (g.ok && C.y < g.h + 0.5) C.y = g.h + 0.5;
    // tremor em alta velocidade / perto do Mach 1 / impactos
    const m = p.mach;
    const trans = Math.exp(-((m - 1) ** 2) / 0.01) * 0.25;
    const sh = this.shake + (v > 200 ? Math.min((v - 200) / 3000, 0.12) : 0) * Math.exp(-p.y / 15000) + trans;
    this.shake = Math.max(0, this.shake - dt * 1.5);
    this.camera.position.set((Math.random() - 0.5) * sh, C.y + (Math.random() - 0.5) * sh, 0);
    this.look.set(L.x, C.y + L.y, L.z);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(this.look);
    if (!ground) this.camera.rotateZ(p.roll * (fp ? 0.8 : 0.22));
    const fovT = 62 + sp * 34 + p.boostAmt * 6;
    this.fov = lerp(this.fov, fovT, 1 - Math.exp(-dt * 3));
    this.camera.fov = this.fov; this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
    return C;
  }
}
