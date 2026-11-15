// Personagem: humanoide articulado (modelo glTF com esqueleto) com animações capturadas de movimento real
// (parado, andando, correndo) misturadas a poses procedurais (voar, turbo, pairar, planar, nadar, pular, cair, pousar, acenar).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clamp, lerp } from './geo.js';

const MODEL_URLS = ['assets/hero.glb', 'https://cdn.jsdelivr.net/gh/mrdoob/three.js@r170/examples/models/gltf/Xbot.glb'];
// membros controlados: nome do osso e o osso seguinte (define a direção do membro)
const LIMBS = { SP: 'Spine1', HD: 'Head', LA: 'LeftArm', LF: 'LeftForeArm', RA: 'RightArm', RF: 'RightForeArm', LU: 'LeftUpLeg', LL: 'LeftLeg', RU: 'RightUpLeg', RL: 'RightLeg' };
const ORDER = ['SP', 'HD', 'LA', 'LF', 'RA', 'RF', 'LU', 'LL', 'RU', 'RL'];
const NEXT = { SP: 'Spine2', HD: 'HeadTop_End', LA: 'LeftForeArm', LF: 'LeftHand', RA: 'RightForeArm', RF: 'RightHand', LU: 'LeftLeg', LL: 'LeftFoot', RU: 'RightLeg', RL: 'RightFoot' };
// direções no espaço do corpo em pé: X = esquerda do personagem, Y = cabeça, Z = frente
const mirror = (p) => { const o = { ...p }; for (const k of ['A', 'F', 'U', 'L']) if (p['L' + k] && !p['R' + k]) o['R' + k] = [-p['L' + k][0], p['L' + k][1], p['L' + k][2]]; return o; };
const POSES = {
  cruise: mirror({ SP: [0, 1, -0.06], HD: [0, 0.7, -0.71], LA: [0.4, -0.9, -0.12], LF: [0.3, -0.95, -0.06], LU: [0.09, -1, -0.02], LL: [0.09, -1, -0.06] }),
  turbo: mirror({ SP: [0, 1, -0.05], HD: [0, 0.62, -0.78], LA: [0.13, 1, 0.1], LF: [0.05, 1, 0.08], LU: [0.07, -1, -0.02], LL: [0.07, -1, -0.04] }),
  glide: mirror({ SP: [0, 1, -0.1], HD: [0, 0.68, -0.73], LA: [0.86, -0.5, -0.05], LF: [0.9, -0.42, -0.02], LU: [0.33, -0.94, -0.03], LL: [0.3, -0.95, -0.08] }),
  hover: { SP: [0, 1, 0.04], HD: [0, 1, 0.1], LA: [0.4, -0.9, 0.12], LF: [0.3, -0.86, 0.42], RA: [-0.4, -0.9, 0.12], RF: [-0.3, -0.86, 0.42], LU: [0.1, -0.95, 0.3], LL: [0.07, -0.86, -0.5], RU: [-0.12, -0.99, 0.04], RL: [-0.1, -0.98, -0.16] },
  fall: mirror({ SP: [0, 1, 0.12], HD: [0, 0.95, 0.3], LA: [0.72, 0.6, 0.34], LF: [0.45, 0.85, 0.28], LU: [0.26, -0.9, 0.34], LL: [0.2, -0.7, -0.68] }),
  jump: { SP: [0, 1, 0.1], HD: [0, 1, 0.05], LA: [0.5, -0.5, 0.7], LF: [0.3, 0.1, 0.95], RA: [-0.55, -0.75, -0.35], RF: [-0.4, -0.8, 0.45], LU: [0.1, -0.7, 0.7], LL: [0.08, -0.8, -0.6], RU: [-0.1, -0.98, -0.12], RL: [-0.1, -0.85, -0.52] },
  land: mirror({ SP: [0, 0.9, 0.42], HD: [0, 1, -0.1], LA: [0.6, -0.7, 0.4], LF: [0.5, -0.6, 0.62], LU: [0.16, -0.62, 0.77], LL: [0.1, -0.72, -0.69] }),
  wave: { RA: [-0.62, 0.74, 0.25], RF: [-0.3, 0.95, 0.1] },
};
const V = (a) => new THREE.Vector3(a[0], a[1], a[2]).normalize();

export class Hero {
  constructor(fallback) {
    this.root = new THREE.Group();
    this.tilt = new THREE.Group(); this.root.add(this.tilt);
    this.fallback = fallback; // boneco simples, mostrado até o modelo carregar (ou se não carregar)
    if (fallback) this.root.add(fallback.root);
    this.ready = false; this.t = 0; this.w = 0; this.prone = 0; this.cur = {}; this.phase = 0; this.waveT = 0;
    this.handL = new THREE.Vector3(); this.handR = new THREE.Vector3();
    this.colors = { suit: '#1c3f9e', acc: '#ff6a1a', wing: '#eeeeee' };
    this.q1 = new THREE.Quaternion(); this.q2 = new THREE.Quaternion(); this.mq = new THREE.Quaternion(); this.v1 = new THREE.Vector3(); this.v2 = new THREE.Vector3();
    this.load();
  }
  async load() {
    const loader = new GLTFLoader();
    let gltf = null;
    for (const u of MODEL_URLS) { try { gltf = await loader.loadAsync(u); break; } catch (e) { gltf = null; } }
    if (!gltf) return;
    const model = gltf.scene;
    model.rotation.y = Math.PI; // o modelo olha para +Z; o jogo usa -Z como frente
    this.model = model; // medido e montado fora da cena (posições locais), só depois entra no personagem
    const bones = {};
    model.traverse((o) => {
      if (o.isBone) bones[o.name.replace(/^mixamorig:?/, '')] = o;
      if (o.isMesh) { o.frustumCulled = false; o.castShadow = true; }
    });
    this.bones = bones;
    // escala para 1,80 m e pés no chão; o centro do corpo (pivô do jogo) fica 1 m acima dos pés
    model.updateMatrixWorld(true);
    const top = bones.HeadTop_End.getWorldPosition(new THREE.Vector3()).y, foot = Math.min(bones.LeftToeBase.getWorldPosition(new THREE.Vector3()).y, bones.RightToeBase.getWorldPosition(new THREE.Vector3()).y);
    const sc = 1.8 / Math.max(top - foot, 1e-3);
    model.scale.setScalar(sc); model.position.y = -1.0 - foot * sc + 0.02;
    model.updateMatrixWorld(true);
    // materiais: superfície = traje, juntas = detalhes
    this.mats = { suit: [], acc: [] };
    model.traverse((o) => {
      if (!o.isMesh) return;
      const m = o.material; const joints = /Joints/i.test(m.name);
      m.roughness = joints ? 0.35 : 0.5; m.metalness = joints ? 0.3 : 0.12;
      (joints ? this.mats.acc : this.mats.suit).push(m);
    });
    // pose de descanso (T) de cada membro: rotação e direção no espaço do pai
    this.rest = {};
    for (const k of ORDER) {
      const b = bones[LIMBS[k]]; const child = bones[NEXT[k]];
      this.rest[k] = { bone: b, q: b.quaternion.clone(), dir: child.position.clone().normalize().applyQuaternion(b.quaternion) };
      this.cur[k] = new THREE.Vector3(0, k === 'SP' || k === 'HD' ? 1 : -1, 0);
    }
    // animações do modelo
    this.mixer = new THREE.AnimationMixer(model);
    this.act = {};
    for (const n of ['idle', 'walk', 'run']) {
      const clip = gltf.animations.find((a) => a.name === n); if (!clip) continue;
      const a = this.mixer.clipAction(clip); a.play(); a.setEffectiveWeight(n === 'idle' ? 1 : 0); this.act[n] = a;
    }
    // acessórios: mochila-jato, chamas nas pernas, membranas do wingsuit
    const attach = (bone, obj) => { bone.add(obj); const s = bone.getWorldScale(new THREE.Vector3()).x || 1; obj.scale.multiplyScalar(1 / s); obj.position.multiplyScalar(1 / s); return obj; };
    this.accMat = new THREE.MeshStandardMaterial({ color: this.colors.acc, emissive: this.colors.acc, emissiveIntensity: 0.9 });
    const pack = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.34, 0.1), new THREE.MeshStandardMaterial({ color: 0x23272f, roughness: 0.4, metalness: 0.5 })); pack.add(body);
    const strip = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.035, 0.11), this.accMat); strip.position.y = 0.1; pack.add(strip);
    for (const sx of [-1, 1]) { const noz = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 0.1, 10), body.material); noz.position.set(sx * 0.075, -0.2, 0); pack.add(noz); }
    pack.position.set(0, 0.06, -0.15);
    attach(bones.Spine2, pack);
    this.flames = [];
    for (const n of ['LeftLeg', 'RightLeg']) {
      // chama na ponta da canela, apontando na direção da perna
      const bone = bones[n], foot = bones[n === 'LeftLeg' ? 'LeftFoot' : 'RightFoot'];
      const ws = bone.getWorldScale(new THREE.Vector3()).x || 1;
      const g = new THREE.ConeGeometry(0.075, 0.8, 10, 1, true); g.translate(0, 0.4, 0);
      const fl = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0xffa040, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
      const dir = foot.position.clone().normalize();
      fl.position.copy(foot.position).addScaledVector(dir, 0.1 / ws);
      fl.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
      fl.scale.setScalar(1 / ws); fl.baseScale = 1 / ws;
      bone.add(fl); this.flames.push(fl);
    }
    this.wingGeo = new THREE.BufferGeometry();
    this.wingPos = new Float32Array(27);
    this.wingGeo.setAttribute('position', new THREE.BufferAttribute(this.wingPos, 3));
    this.wingMat = new THREE.MeshStandardMaterial({ color: this.colors.wing, side: THREE.DoubleSide, roughness: 0.6, transparent: true, opacity: 0 });
    this.wing = new THREE.Mesh(this.wingGeo, this.wingMat); this.wing.frustumCulled = false; this.wing.visible = false;
    this.root.add(this.wing);
    this.inv = new THREE.Matrix4();
    this.tilt.add(model);
    if (this.fallback) this.fallback.root.visible = false;
    this.ready = true;
    this.setColors(this.colors.suit, this.colors.acc, this.colors.wing);
  }
  setColors(suit, acc, wing) {
    this.colors = { suit, acc, wing };
    this.fallback?.setColors(suit, acc, wing);
    if (!this.ready) return;
    for (const m of this.mats.suit) m.color.set(suit);
    for (const m of this.mats.acc) { m.color.set(acc); m.emissive = new THREE.Color(acc); m.emissiveIntensity = 0.25; }
    this.accMat.color.set(acc); this.accMat.emissive.set(acc);
    this.wingMat.color.set(wing);
  }
  wave() { this.waveT = 2.4; }
  // s: { mode, speed (horizontal m/s), vy, air (fora do chão), turbo 0..1, hover, landing 0..1, swimSpeed }
  animate(dt, s) {
    this.t += dt;
    if (!this.ready) { this.fallback?.animate(dt, { fly: s.mode === 'walk' || s.mode === 'swim' ? 0 : s.hover ? 0.5 : 1, upright: s.hover, spread: s.mode === 'glide' ? 1 : 0.5, walk: s.mode === 'walk' ? s.speed : 0, boost: s.turbo, flutter: 0.5 }); if (this.fallback) { this.handL.copy(this.fallback.handL); this.handR.copy(this.fallback.handR); } return; }
    const k = (r) => 1 - Math.exp(-dt * r);
    // ---- escolhe a pose procedural e o peso dela sobre as animações de chão ----
    let pose = null, w = 0, prone = 0;
    if (s.mode === 'fly') {
      w = 1;
      if (s.hover) { pose = POSES.hover; prone = 0.1 + clamp(s.speed / 14, 0, 1) * 0.35; }
      else { pose = s.turbo > 0.5 ? POSES.turbo : POSES.cruise; prone = 1; }
    } else if (s.mode === 'glide') { pose = POSES.glide; w = 1; prone = 1; }
    else if (s.mode === 'swim') { pose = this.swimPose(dt, s); w = 1; prone = 0.9; }
    else if (s.landing > 0.05) { pose = POSES.land; w = s.landing; }
    else if (s.air) { pose = s.vy > 1.5 ? POSES.jump : POSES.fall; w = 1; prone = s.vy < -18 ? 0.55 : 0; }
    this.w = lerp(this.w, w, k(9)); this.prone = lerp(this.prone, prone, k(5));
    this.tilt.rotation.x = -Math.PI / 2 * this.prone;
    // ---- animações de chão: parado / andando / correndo ----
    const sp = s.mode === 'walk' && !s.air ? s.speed : 0;
    const wWalk = clamp(sp / 1.6, 0, 1) * (1 - clamp((sp - 2.2) / 2.2, 0, 1)), wRun = clamp((sp - 2.2) / 2.2, 0, 1);
    const A = this.act;
    if (A.idle) A.idle.setEffectiveWeight(lerp(A.idle.getEffectiveWeight(), 1 - wWalk - wRun, k(10)));
    if (A.walk) { A.walk.setEffectiveWeight(lerp(A.walk.getEffectiveWeight(), wWalk, k(10))); A.walk.timeScale = clamp(sp / 1.45, 0.6, 1.5); }
    if (A.run) { A.run.setEffectiveWeight(lerp(A.run.getEffectiveWeight(), wRun, k(10))); A.run.timeScale = clamp(sp / 5.2, 0.75, 1.9); }
    this.mixer.update(dt);
    // inclinação para a frente ao correr rápido
    if (s.mode === 'walk' && !s.air) this.tilt.rotation.x = -clamp((sp - 6) / 30, 0, 0.32);
    // ---- aplica a pose procedural por cima ----
    this.waveT = Math.max(0, this.waveT - dt);
    const waving = this.waveT > 0 && s.mode === 'walk' && !s.air;
    if (this.w > 0.003 || waving) {
      this.model.updateWorldMatrix(true, false);
      this.model.getWorldQuaternion(this.mq);
      const flut = Math.sin(this.t * 23) * 0.02 * clamp(s.speed / 60, 0, 1);
      for (const key of ORDER) {
        let target = pose && pose[key], wt = this.w;
        if (waving && (key === 'RA' || key === 'RF')) { target = key === 'RA' ? POSES.wave.RA : [-0.3 + Math.sin(this.t * 9) * 0.38, 0.9, 0.12]; wt = Math.max(wt, Math.min(1, this.waveT * 3, (2.4 - this.waveT) * 4)); }
        if (!target || wt < 0.003) continue;
        const c = this.cur[key];
        this.v1.set(target[0], target[1], target[2]).normalize();
        if (key[1] === 'A' || key[1] === 'U') this.v1.z += flut * (key[0] === 'L' ? 1 : -1);
        c.lerp(this.v1, k(pose && pose.fast ? 30 : 9)).normalize();
        const R = this.rest[key];
        R.bone.parent.getWorldQuaternion(this.q1).invert();
        this.v2.copy(c).applyQuaternion(this.mq).applyQuaternion(this.q1);
        this.q2.setFromUnitVectors(R.dir, this.v2).multiply(R.q);
        R.bone.quaternion.slerp(this.q2, wt);
      }
    }
    // chamas do turbo
    for (const f of this.flames) { f.material.opacity = s.turbo * (0.55 + Math.random() * 0.4); f.scale.set(f.baseScale, f.baseScale * (0.5 + s.turbo * (1.1 + Math.random() * 0.8)), f.baseScale); f.visible = s.turbo > 0.02; }
    // membranas do wingsuit: ombro–mão–quadril de cada lado e entre as pernas
    const wOp = lerp(this.wingMat.opacity, s.mode === 'glide' ? 0.92 : s.mode === 'fly' && !s.hover && s.turbo < 0.5 ? 0.55 : 0, k(6));
    this.wingMat.opacity = wOp; this.wing.visible = wOp > 0.02;
    this.root.updateWorldMatrix(true, true);
    const b = this.bones;
    b.LeftHand.getWorldPosition(this.handL); b.RightHand.getWorldPosition(this.handR);
    if (this.wing.visible) {
      this.inv.copy(this.root.matrixWorld).invert();
      const P = (bone, i) => { bone.getWorldPosition(this.v1).applyMatrix4(this.inv); this.wingPos[i * 3] = this.v1.x; this.wingPos[i * 3 + 1] = this.v1.y; this.wingPos[i * 3 + 2] = this.v1.z; };
      P(b.LeftArm, 0); P(b.LeftHand, 1); P(b.LeftUpLeg, 2); P(b.RightArm, 3); P(b.RightUpLeg, 4); P(b.RightHand, 5); P(b.Hips, 6); P(b.LeftFoot, 7); P(b.RightFoot, 8);
      this.wingGeo.attributes.position.needsUpdate = true; this.wingGeo.computeVertexNormals();
    }
  }
  // nado crawl: braços alternados em círculo, pernas batendo
  swimPose(dt, s) {
    this.phase += dt * (2.2 + clamp(s.speed, 0, 5) * 1.5);
    const p = this.phase, idle = s.speed < 0.3;
    const arm = (side, ph) => { const a = idle ? 0.9 + Math.sin(p * 0.8 + ph) * 0.25 : ph; return idle ? [side * 0.75, 0.55 + Math.sin(a) * 0.1, 0.25] : [side * 0.28, Math.cos(a), Math.sin(a) * 0.95]; };
    const leg = (side, ph) => [side * 0.1, -1, Math.sin(ph) * (idle ? 0.12 : 0.3)];
    return { fast: !idle, SP: [0, 1, -0.08], HD: [0, 0.8, -0.6], LA: arm(1, p), LF: arm(1, p - 0.5), RA: arm(-1, p + Math.PI), RF: arm(-1, p + Math.PI - 0.5),
      LU: leg(1, p * 2.6), LL: leg(1, p * 2.6 - 0.7), RU: leg(-1, p * 2.6 + Math.PI), RL: leg(-1, p * 2.6 + Math.PI - 0.7) };
  }
}
