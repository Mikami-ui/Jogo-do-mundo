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
    this.root.traverse((o) => { if (o.isMesh) { o.castShadow = false; } });
    this.t = 0; this.fly = 1; this.walkPhase = 0;
    this.tmp = new THREE.Vector3(); this.inv = new THREE.Matrix4();
    this.handL = new THREE.Vector3(); this.handR = new THREE.Vector3();
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
export class Player {
  constructor() {
    this.x = 0; this.y = 2000; this.z = 0;
    this.yaw = 0; this.pitch = 0; this.roll = 0; this.speed = 80;
    this.mode = 'fly'; // fly | glide | walk
    this.vy = 0; this.agl = 1000; this.ground = 0; this.onWater = false;
    this.events = [];
    this.boostAmt = 0; this.machPrev = 0;
  }
  forward(out) {
    const cp = Math.cos(this.pitch);
    return out.set(Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp);
  }
  get mach() { return this.speed / speedOfSound(this.y); }
  update(dt, inp, terrain) {
    const g = terrain.heightAt(this.x, this.z);
    this.ground = g.h; this.onWater = !!g.water;
    const rho = Math.exp(-Math.max(this.y, 0) / 8500);
    const sx = inp.steerX, sy = inp.steerY;
    this.boostAmt = lerp(this.boostAmt, inp.boost ? 1 : 0, 1 - Math.exp(-dt * 6));
    if (inp.takeoff()) {
      if (this.mode === 'fly') { if (this.agl > 3) { this.mode = 'glide'; this.speed = Math.max(this.speed, 25); this.events.push('release'); } }
      else { this.mode = 'fly'; if (this.agl < 3) { this.y += 1.5; this.pitch = 0.45; this.speed = Math.max(this.speed, 18); } this.events.push('takeoff'); }
    }
    if (this.mode === 'fly') {
      const turn = lerp(1.7, 0.75, clamp(this.speed / 2500, 0, 1));
      this.yaw += sx * turn * dt;
      this.pitch = clamp(this.pitch + sy * 1.35 * dt, -1.45, 1.45);
      if (inp.boost) {
        this.speed += (26 + this.speed * 0.55) * dt;
        const vmax = Math.min(1700 * Math.exp(Math.max(this.y, 0) / 12000), 120000);
        if (this.speed > vmax) this.speed = lerp(this.speed, vmax, 1 - Math.exp(-dt * 2));
      } else {
        this.speed -= 9.81 * Math.sin(this.pitch) * dt * (this.speed > 2 ? 1 : 0);
        const drag = rho * (0.0012 * Math.min(this.speed, 120) ** 2 + 0.3 * Math.max(this.speed - 120, 0));
        this.speed -= drag * dt;
      }
      if (inp.brake) this.speed -= (this.speed * 2.4 + 18) * dt;
      if (this.speed < 0.5 && !inp.boost) this.speed = Math.max(this.speed, 0);
      this.speed = Math.max(this.speed, 0);
      // voo pairado: sem gravidade (super-herói)
      const f = this.forward(new THREE.Vector3());
      this.x += f.x * this.speed * dt; this.y += f.y * this.speed * dt; this.z += f.z * this.speed * dt;
      this.roll = lerp(this.roll, -sx * 1.05 * clamp(this.speed / 30, 0.3, 1), 1 - Math.exp(-dt * 5));
    } else if (this.mode === 'glide') {
      this.yaw += sx * 1.1 * dt;
      const target = -0.4 + sy * 0.32;
      this.pitch = lerp(this.pitch, target, 1 - Math.exp(-dt * 2.2));
      this.speed += (-9.81 * Math.sin(this.pitch) - 0.00145 * rho * this.speed * this.speed - (rho < 0.3 ? 0 : 0)) * dt;
      if (rho < 0.2) this.speed += 9.81 * dt * 0.5; // ar rarefeito: queda livre
      this.speed = Math.max(this.speed, 5);
      const f = this.forward(new THREE.Vector3());
      this.x += f.x * this.speed * dt; this.y += f.y * this.speed * dt; this.z += f.z * this.speed * dt;
      this.roll = lerp(this.roll, -sx * 0.7, 1 - Math.exp(-dt * 4));
      if (inp.boost) { this.mode = 'fly'; this.events.push('takeoff'); }
    } else {
      // caminhando / correndo
      this.yaw += sx * 2.2 * dt;
      const run = inp.boost ? 22 : 7.5;
      const target = Math.max(sy, 0) * run + (inp.fwd ? run : 0);
      this.speed = lerp(this.speed, target, 1 - Math.exp(-dt * 4));
      this.pitch = lerp(this.pitch, 0, 1 - Math.exp(-dt * 8));
      this.roll = lerp(this.roll, 0, 1 - Math.exp(-dt * 8));
      this.x += Math.sin(this.yaw) * this.speed * dt; this.z -= Math.cos(this.yaw) * this.speed * dt;
      if (inp.jump()) { if (this.agl < 0.3) { this.vy = 8; this.events.push('jump'); } }
      this.vy -= 9.81 * dt;
      this.y += this.vy * dt;
    }
    // contato com o chão
    const g2 = terrain.heightAt(this.x, this.z);
    const floor = (g2.ok ? g2.h : this.ground) + 1.0;
    if (this.y < floor) {
      if (this.mode === 'walk') { this.y = floor; this.vy = 0; }
      else {
        const f = this.forward(new THREE.Vector3());
        const vz = f.y * this.speed;
        if (vz < -18 || (this.mode === 'glide' && this.speed > 35)) {
          this.events.push(g2.water ? 'splash' : 'impact');
          this.speed *= this.mode === 'glide' ? 0.15 : 0.55;
          this.pitch = this.mode === 'fly' ? 0.2 : 0;
          if (this.mode === 'glide') this.mode = 'walk';
        }
        this.y = floor;
        if (this.mode === 'fly') {
          this.pitch = Math.max(this.pitch, 0.02);
          if (this.speed < 10 && !inp.boost) { this.mode = 'walk'; this.events.push('land'); }
        } else if (this.mode === 'glide') { this.mode = 'walk'; this.events.push('land'); }
      }
    }
    this.agl = this.y - floor;
    if (this.mode === 'walk' && this.agl > 25) { this.mode = 'glide'; this.speed = Math.max(this.speed, 20); this.pitch = -0.3; }
    // Mach 1: estrondo sônico
    const m = this.mach;
    if (this.machPrev < 1 && m >= 1 && rho > 0.05) this.events.push('boom');
    this.machPrev = m;
  }
}

// ---------------- câmera ----------------
export class CameraRig {
  constructor(camera) {
    this.camera = camera; this.mode = 0; // 0 perseguição, 1 perto, 2 primeira pessoa, 3 cinematográfica
    this.off = new THREE.Vector3(0, 3, 9); this.shake = 0; this.t = 0; this.fov = 65;
    this.f = new THREE.Vector3(); this.tmp = new THREE.Vector3(); this.look = new THREE.Vector3();
    this.orbit = 0;
  }
  next() { this.mode = (this.mode + 1) % 4; return ['Perseguição', 'Perto', 'Primeira pessoa', 'Cinematográfica'][this.mode]; }
  update(dt, p, terrain, look) {
    this.t += dt;
    const f = p.forward(this.f);
    const v = p.speed;
    const sp = clamp(Math.log(1 + v / 60) / Math.log(1 + 3000 / 60), 0, 1);
    let want;
    if (p.mode === 'walk') {
      want = this.tmp.set(-Math.sin(p.yaw) * 5.5, 2.2, Math.cos(p.yaw) * 5.5);
    } else if (this.mode === 0 || this.mode === 1) {
      const d = this.mode === 0 ? 7 + sp * 3 : 3.8 + sp * 1.5;
      want = this.tmp.copy(f).multiplyScalar(-d);
      want.y += this.mode === 0 ? 1.7 : 0.8;
    } else if (this.mode === 2) {
      want = this.tmp.copy(f).multiplyScalar(0.6); want.y += 0.25;
    } else {
      this.orbit += dt * 0.25;
      want = this.tmp.set(Math.sin(p.yaw + 1.9 + Math.sin(this.orbit) * 0.6) * 12, 2.5 + Math.sin(this.orbit * 0.7) * 2, -Math.cos(p.yaw + 1.9 + Math.sin(this.orbit) * 0.6) * 12);
    }
    // giro livre da câmera (arrastar)
    if (look && (look.x || look.y)) {
      const a = look.x, b = look.y;
      const r = want.length();
      const yaw0 = Math.atan2(want.x, want.z) + a, pit0 = clamp(Math.asin(clamp(want.y / r, -1, 1)) + b, -1.2, 1.4);
      want.set(Math.sin(yaw0) * Math.cos(pit0) * r, Math.sin(pit0) * r, Math.cos(yaw0) * Math.cos(pit0) * r);
    }
    const k = 1 - Math.exp(-dt * (this.mode === 2 ? 30 : 7));
    this.off.lerp(want, k);
    // tremor em alta velocidade / perto do Mach 1 / impactos
    const m = p.mach;
    const trans = Math.exp(-((m - 1) ** 2) / 0.01) * 0.25;
    const sh = this.shake + (v > 200 ? Math.min((v - 200) / 3000, 0.12) : 0) * Math.exp(-p.y / 15000) + trans;
    this.shake = Math.max(0, this.shake - dt * 1.5);
    const C = { x: p.x + this.off.x, y: p.y + this.off.y, z: p.z + this.off.z };
    const g = terrain.heightAt(C.x, C.z);
    if (g.ok && C.y < g.h + 1.2) C.y = g.h + 1.2;
    const jx = (Math.random() - 0.5) * sh, jy = (Math.random() - 0.5) * sh;
    this.camera.position.set(jx, C.y + jy, 0);
    if (this.mode === 2 && p.mode !== 'walk') this.look.set(p.x - C.x + f.x * 50, p.y + f.y * 50, p.z - C.z + f.z * 50);
    else this.look.set(p.x - C.x + f.x * 6, p.y + f.y * 6 + (p.mode === 'walk' ? 1 : 0.4), p.z - C.z + f.z * 6);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(this.look);
    if (p.mode !== 'walk') this.camera.rotateZ(p.roll * (this.mode === 2 ? 0.9 : 0.28));
    const fovT = 62 + sp * 34 + p.boostAmt * 6;
    this.fov = lerp(this.fov, fovT, 1 - Math.exp(-dt * 3));
    this.camera.fov = this.fov; this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
    return C;
  }
}
