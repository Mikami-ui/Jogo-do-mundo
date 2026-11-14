// Jogo do Mundo — simulador de voo pela Terra.
import * as THREE from 'three';
import { Frame, DEG, RE, clamp, lerp, smooth, sunPosition, sunDirLocal, speedOfSound, dayOfYear } from './geo.js';
import { sunTransmitJS, skyRadianceJS } from './atmosphere.js';
import { Terrain, IMAGERY } from './terrain.js';
import { Globe, Sky } from './globe.js';
import { Clouds, Precip } from './clouds.js';
import { Avatar, Player, CameraRig, BOOSTS } from './player.js';
import { Hero } from './hero.js';
import { Effects } from './effects.js';
import { Post } from './post.js';
import { Buildings } from './buildings.js';
import { World } from './world.js';
import { Landmarks } from './landmarks.js';
import { Game, fmtTime as fmtDur } from './game.js';
import { MiniMap, WorldMap } from './map.js';
import { lonToMx, latToMy } from './geo.js';
import { WMO, WEATHER_PRESETS, fetchWeather, reverseGeocode, searchPlaces, Sound } from './services.js';

const $ = (id) => document.getElementById(id);

// ---------------- lugares ----------------
const PLACES = [
  { n: 'Chamonix-Mont-Blanc', s: 'Alpes franceses, aos pés do Mont Blanc', lat: 45.905, lon: 6.86, alt: 1900, hd: 205, tag: 'ALPES' },
  { n: 'Rio de Janeiro', s: 'Cristo Redentor, Pão de Açúcar e as praias', lat: -22.93, lon: -43.235, alt: 650, hd: 110, tag: 'BRASIL' },
  { n: 'Grand Canyon', s: 'Arizona, EUA — 1.800 m de cânion', lat: 36.07, lon: -112.16, alt: 2500, hd: 30, tag: 'EUA' },
  { n: 'Monte Everest', s: 'Himalaia, o teto do mundo (8.849 m)', lat: 27.93, lon: 86.88, alt: 8000, hd: 20, tag: 'NEPAL' },
  { n: 'Fiorde de Geiranger', s: 'Noruega — paredões e cachoeiras', lat: 62.11, lon: 7.08, alt: 900, hd: 120, tag: 'NORUEGA' },
  { n: 'Yosemite', s: 'El Capitan e Half Dome', lat: 37.72, lon: -119.66, alt: 1900, hd: 75, tag: 'EUA' },
  { n: 'Monte Fuji', s: 'Japão — o vulcão sagrado', lat: 35.29, lon: 138.68, alt: 3600, hd: 45, tag: 'JAPÃO' },
  { n: 'Torres del Paine', s: 'Patagônia chilena', lat: -51.0, lon: -73.0, alt: 1700, hd: 10, tag: 'CHILE' },
  { n: 'Machu Picchu', s: 'Andes peruanos', lat: -13.17, lon: -72.535, alt: 2700, hd: 300, tag: 'PERU' },
  { n: 'Dolomitas', s: 'Tre Cime di Lavaredo, Itália', lat: 46.6, lon: 12.27, alt: 2600, hd: 60, tag: 'ITÁLIA' },
  { n: 'Nova York', s: 'Manhattan e o Central Park', lat: 40.70, lon: -74.02, alt: 450, hd: 25, tag: 'EUA' },
  { n: 'Lençóis Maranhenses', s: 'Dunas e lagoas no Maranhão', lat: -2.53, lon: -43.12, alt: 400, hd: 90, tag: 'BRASIL' },
  { n: 'Islândia — Landmannalaugar', s: 'Montanhas coloridas e vulcões', lat: 63.99, lon: -19.06, alt: 1300, hd: 160, tag: 'ISLÂNDIA' },
  { n: 'Dubai', s: 'Burj Khalifa e o deserto', lat: 25.18, lon: 55.24, alt: 700, hd: 60, tag: 'EAU' },
  { n: 'Kilimanjaro', s: 'O teto da África', lat: -3.13, lon: 37.30, alt: 6200, hd: 0, tag: 'TANZÂNIA' },
  { n: 'Paris', s: 'Torre Eiffel, o Sena e os bulevares', lat: 48.845, lon: 2.277, alt: 420, hd: 50, tag: 'FRANÇA' },
  { n: 'Londres', s: 'Big Ben, London Eye e o Tâmisa', lat: 51.492, lon: -0.135, alt: 380, hd: 40, tag: 'REINO UNIDO' },
  { n: 'Pirâmides de Gizé', s: 'Quéops, Quéfren e Miquerinos', lat: 29.962, lon: 31.118, alt: 420, hd: 40, tag: 'EGITO' },
  { n: 'Tóquio', s: 'A maior metrópole do mundo', lat: 35.69, lon: 139.79, alt: 600, hd: 45, tag: 'JAPÃO' },
  { n: 'Órbita da Terra', s: 'Comece a 400 km de altitude', lat: -12, lon: -48, alt: 400000, hd: 90, spd: 7600, tag: 'ESPAÇO' },
];

// ---------------- ajustes ----------------
const DEFAULTS = { now: true, hour: 12, ts: '1', season: 'auto', weather: 'live', quality: matchMedia('(pointer: coarse)').matches ? 'media' : 'alta', img: 'esri', suit: '#1c3f9e', acc: '#ff6a1a', helmet: '#eeeeee', trail: '#ffffff', boost: 1, bld: true, lbl: true, snd: true, inv: false, blur: true, sens: 1 };
let S = { ...DEFAULTS };
try { S = { ...DEFAULTS, ...JSON.parse(localStorage.getItem('jdm-settings') || '{}') }; } catch (e) { /* sem storage */ }
const saveS = () => { try { localStorage.setItem('jdm-settings', JSON.stringify(S)); } catch (e) { /* ok */ } };

// ---------------- renderer ----------------
const canvas = $('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, logarithmicDepthBuffer: true, powerPreference: 'high-performance' });
renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
renderer.toneMapping = THREE.NoToneMapping;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(65, 1, 0.3, 4e7);
const post = new Post(renderer);
let pixelRatio = 1;
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  const maxPR = { baixa: 0.75, media: 1.25, alta: 2 }[S.quality];
  pixelRatio = Math.min(window.devicePixelRatio || 1, maxPR);
  renderer.setPixelRatio(pixelRatio);
  renderer.setSize(w, h, false);
  post.setSize(w, h, pixelRatio);
  camera.aspect = w / h; camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);

// ---------------- uniforms globais ----------------
const G = {
  uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunI: { value: 20 }, uHaze: { value: 1 }, uAmbient: { value: new THREE.Vector3(0.2, 0.25, 0.35) },
  uOvercast: { value: 0 }, uCamAlt: { value: 1000 }, uCamLL: { value: new THREE.Vector2() }, uMaxDist: { value: 3e5 },
  uSnowLine: { value: 3000 }, uAutumn: { value: 0 }, uWinter: { value: 0 }, uMoon: { value: new THREE.Vector3() }, uTime: { value: 0 },
};

const frame = new Frame(45.9, 6.86);
const terrain = new Terrain(renderer, scene, frame, G);
const globe = new Globe(scene, G);
const sky = new Sky(scene, G);
const clouds = new Clouds(scene, G, frame);
const precip = new Precip(scene);
const effects = new Effects(scene);
const buildings = new Buildings(scene, frame, terrain);
const world = new World(scene, frame, terrain, G, camera);
const avatar = new Hero(new Avatar()); scene.add(avatar.root);
const player = new Player();
const rig = new CameraRig(camera);
const sound = new Sound();

const sunLight = new THREE.DirectionalLight(0xffffff, 3); scene.add(sunLight); scene.add(sunLight.target);
const hemi = new THREE.HemisphereLight(0x8899bb, 0x443322, 1); scene.add(hemi);
scene.fog = new THREE.FogExp2(0x9fb3c8, 0.00002);

function applyQuality() {
  terrain.setQuality(S.quality);
  world.radius = 1; world.bDist = { baixa: 450, media: 750, alta: 1400 }[S.quality];
  post.mat.uniforms.uSamples.value = S.quality === 'baixa' ? 1 : S.quality === 'media' ? 6 : 10;
  resize();
}
terrain.imgSrc = S.img;
applyQuality();
buildings.on = false; world.on = S.bld; world.labelsOn = S.lbl;
sound.setOn(S.snd);

// ---------------- estado ----------------
let playing = false, menuOpen = false, photoReq = false;
let simUtc = Date.now(), hourOffsetMs = 0;
let weather = { ...WEATHER_PRESETS.clear, live: false };
let liveWeather = null, wxPos = null, wxT = -1e9;
let place = { name: '', sub: '' }, geoPos = null, geoT = -1e9, geoBusy = false;
let atmoT = 0, lightningT = 5, flash = 0, exposure = 1;
let spawnGuard = 0, spawnMin = 250;
const env = { light: 1, humidity: 0.5, snowy: false, pr: 1 };
const amb = [0.2, 0.25, 0.35], sunT = [1, 1, 1];

// ---------------- entrada ----------------
// Analógico (ou WASD) = direção do movimento, relativa à câmera. Outro lado da tela (ou mouse/setas) = visão.
const keys = new Set(), pressed = new Set();
const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
const take = (...names) => { let r = false; for (const n of names) if (pressed.delete(n)) r = true; return r; };
const inp = {
  mx: 0, my: 0, up: 0, turbo: false, brake: false, stickX: 0, stickY: 0, tTurbo: false, tBrake: false,
  fly() { return take('KeyF', 'fly'); },
  glide() { return take('KeyX', 'glide'); },
  jump() { return take('Space', 'jump'); },
};
function setBoost(i, quiet) {
  player.boost = clamp(i, 0, BOOSTS.length - 1); S.boost = player.boost; saveS();
  $('t-level').textContent = 'BOOST ' + (player.boost + 1);
  if (!quiet) toast(`Boost ${player.boost + 1}: ${BOOSTS[player.boost].name}`);
}
window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  if (!keys.has(e.code)) pressed.add(e.code);
  keys.add(e.code);
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
  if (e.code === 'KeyM' || e.code === 'Escape') { if (playing) toggleMenu(); }
  if (!playing) return;
  if (/^Digit[1-6]$/.test(e.code)) setBoost(+e.code.slice(5) - 1);
  if (e.code === 'KeyC') toast(rig.next());
  if (e.code === 'KeyG') avatar.wave();
  if (e.code === 'KeyP') photoReq = true;
  if (e.code === 'KeyR' && !menuOpen) game.startRings();
  if (e.code === 'KeyT') { hourOffsetMs += 3600000; toast('+1 hora'); }
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
window.addEventListener('blur', () => keys.clear());
canvas.addEventListener('click', () => { if (playing && !isTouch && !menuOpen) canvas.requestPointerLock?.(); });
const lookSign = () => (S.inv ? -1 : 1);
document.addEventListener('mousemove', (e) => {
  if (document.pointerLockElement !== canvas) return;
  rig.turn(e.movementX * 0.0026 * S.sens, e.movementY * 0.0026 * S.sens * lookSign());
});
// toque: analógico na metade esquerda; arrastar em qualquer ponto da direita (inclusive sobre os botões) gira a visão
const stick = $('stick'), knob = $('stick-knob');
let stickId = null, stickO = null;
const looks = new Map();
const lookMove = (e) => {
  for (const t of e.changedTouches) {
    const p = looks.get(t.identifier); if (!p) continue;
    rig.turn((t.clientX - p.x) * 0.0058 * S.sens, (t.clientY - p.y) * 0.0048 * S.sens * lookSign());
    p.x = t.clientX; p.y = t.clientY;
  }
};
const lookEnd = (e) => { for (const t of e.changedTouches) looks.delete(t.identifier); };
canvas.addEventListener('touchstart', (e) => {
  e.preventDefault(); sound.init();
  for (const t of e.changedTouches) {
    if (t.clientX < window.innerWidth * 0.45 && stickId === null) {
      stickId = t.identifier; stickO = { x: t.clientX, y: t.clientY };
      stick.style.left = t.clientX + 'px'; stick.style.top = t.clientY + 'px'; stick.classList.add('on');
    } else looks.set(t.identifier, { x: t.clientX, y: t.clientY });
  }
}, { passive: false });
canvas.addEventListener('touchmove', (e) => {
  e.preventDefault();
  for (const t of e.changedTouches) {
    if (t.identifier !== stickId) continue;
    let dx = t.clientX - stickO.x, dy = t.clientY - stickO.y;
    const r = Math.hypot(dx, dy), R = 58;
    if (r > R) { dx *= R / r; dy *= R / r; }
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
    const mag = Math.min(r / R, 1), dead = 0.12, g = mag < dead ? 0 : (mag - dead) / (1 - dead) / Math.max(mag, 1e-3);
    inp.stickX = (dx / R) * g; inp.stickY = (-dy / R) * g;
  }
  lookMove(e);
}, { passive: false });
const endTouch = (e) => {
  for (const t of e.changedTouches) if (t.identifier === stickId) { stickId = null; inp.stickX = inp.stickY = 0; knob.style.transform = ''; stick.classList.remove('on'); }
  lookEnd(e);
};
canvas.addEventListener('touchend', endTouch); canvas.addEventListener('touchcancel', endTouch);
const btn = (id, down, up) => {
  const b = $(id);
  const d = (e) => { e.preventDefault(); b.classList.add('down'); sound.init(); down(); if (e.changedTouches) for (const t of e.changedTouches) looks.set(t.identifier, { x: t.clientX, y: t.clientY }); };
  const u = (e) => { e.preventDefault(); b.classList.remove('down'); up?.(); if (e.changedTouches) lookEnd(e); };
  b.addEventListener('touchstart', d, { passive: false }); b.addEventListener('touchmove', (e) => { e.preventDefault(); lookMove(e); }, { passive: false });
  b.addEventListener('touchend', u); b.addEventListener('touchcancel', u);
  b.addEventListener('mousedown', d); b.addEventListener('mouseup', u); b.addEventListener('mouseleave', (e) => { if (b.classList.contains('down')) u(e); });
};
btn('t-boost', () => (inp.tTurbo = true), () => (inp.tTurbo = false));
btn('t-a', () => { if (player.mode === 'fly') inp.tBrake = true; else pressed.add('jump'); }, () => (inp.tBrake = false));
btn('t-fly', () => pressed.add('fly'));
btn('t-x', () => { if (player.mode === 'fly') pressed.add('glide'); else avatar.wave(); });
btn('t-level', () => setBoost((player.boost + 1) % BOOSTS.length));

function updateInput(dt) {
  const k = (c) => keys.has(c);
  inp.mx = clamp((k('KeyD') ? 1 : 0) - (k('KeyA') ? 1 : 0) + inp.stickX, -1, 1);
  inp.my = clamp((k('KeyW') ? 1 : 0) - (k('KeyS') ? 1 : 0) + inp.stickY, -1, 1);
  const ax = (k('ArrowRight') ? 1 : 0) - (k('ArrowLeft') ? 1 : 0), ay = (k('ArrowUp') ? 1 : 0) - (k('ArrowDown') ? 1 : 0);
  if (ax || ay) rig.turn(ax * 1.9 * dt, -ay * 1.3 * dt * lookSign());
  inp.turbo = k('ShiftLeft') || k('ShiftRight') || inp.tTurbo;
  inp.brake = k('KeyB') || inp.tBrake;
  inp.up = player.mode === 'fly' ? (k('Space') || k('KeyE') ? 1 : 0) - (k('KeyQ') || k('ControlLeft') ? 1 : 0) : 0;
  if (player.mode === 'fly') pressed.delete('Space');
}

// ---------------- UI ----------------
let toastT = 0;
function toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.add('show'); toastT = 2.2; }
function setHint(msg) { const h = $('hint'); if (h.textContent !== msg) h.textContent = msg; h.classList.toggle('show', !!msg); }
function renderPlaces(el, onPick) {
  el.innerHTML = '';
  for (const p of PLACES) {
    const b = document.createElement('button'); b.className = 'place';
    b.innerHTML = `<span class="tag">${p.tag}</span><b>${p.n}</b><small>${p.s}</small>`;
    b.onclick = () => onPick(p);
    el.appendChild(b);
  }
}
async function doSearch(q, out) {
  if (!q.trim()) return;
  out.innerHTML = '<button disabled>Buscando…</button>';
  try {
    const r = await searchPlaces(q);
    out.innerHTML = '';
    if (!r.length) out.innerHTML = '<button disabled>Nada encontrado.</button>';
    for (const p of r) {
      const b = document.createElement('button'); b.textContent = p.name;
      b.onclick = () => go({ n: p.name.split(',')[0], lat: p.lat, lon: p.lon, alt: null, hd: 0 });
      out.appendChild(b);
    }
  } catch (e) { out.innerHTML = '<button disabled>Não foi possível buscar agora.</button>'; }
}
renderPlaces($('places'), (p) => go(p));
renderPlaces($('menu-places'), (p) => go(p));
$('start-go').onclick = () => doSearch($('start-q').value, $('start-results'));
$('start-q').onkeydown = (e) => { if (e.key === 'Enter') doSearch(e.target.value, $('start-results')); };
$('menu-go').onclick = () => doSearch($('menu-q').value, $('menu-results'));
$('menu-q').onkeydown = (e) => { if (e.key === 'Enter') doSearch(e.target.value, $('menu-results')); };
$('start-geo').onclick = () => {
  navigator.geolocation?.getCurrentPosition((p) => go({ n: 'Minha localização', lat: p.coords.latitude, lon: p.coords.longitude, alt: null, hd: 0 }),
    () => { $('start-geo').textContent = 'Localização indisponível'; });
};
$('btn-menu').onclick = () => toggleMenu();
$('menu-close').onclick = () => toggleMenu(false);
$('btn-cam').onclick = () => toast(rig.next());
$('menu').addEventListener('click', (e) => { if (e.target.id === 'menu') toggleMenu(false); });
document.querySelectorAll('.tabs button').forEach((b) => b.onclick = () => {
  document.querySelectorAll('.tabs button').forEach((x) => x.classList.toggle('on', x === b));
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('hidden', t.id !== 'tab-' + b.dataset.tab));
});
function toggleMenu(v = !menuOpen) {
  menuOpen = v; $('menu').classList.toggle('hidden', !v);
  if (v) document.exitPointerLock?.();
}
// controles segmentados
function seg(id, key, onChange) {
  const el = $(id);
  el.innerHTML = '';
  for (const o of el.dataset.opts.split(',')) {
    const [v, label] = o.split(':');
    const b = document.createElement('button'); b.textContent = label; b.dataset.v = v;
    b.classList.toggle('on', String(S[key]) === v);
    b.onclick = () => { S[key] = v; saveS(); el.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b)); onChange?.(v); };
    el.appendChild(b);
  }
}
seg('set-ts', 'ts');
seg('set-season', 'season');
seg('set-weather', 'weather', () => applyWeather());
seg('set-quality', 'quality', () => { applyQuality(); });
seg('set-img', 'img', (v) => { terrain.setImagery(v); globe.loadTextures(v); updateCredits(); });
const chk = (id, key, fn) => { const el = $(id); el.checked = !!S[key]; el.onchange = () => { S[key] = el.checked; saveS(); fn?.(el.checked); }; };
chk('set-now', 'now', (v) => { hourOffsetMs = 0; if (!v) setHour(S.hour); });
chk('set-bld', 'bld', (v) => { world.on = v; if (!v) { buildings.on = false; buildings.clear(); } });
chk('set-lbl', 'lbl', (v) => { world.labelsOn = v; });
chk('set-snd', 'snd', (v) => sound.setOn(v));
chk('set-inv', 'inv'); chk('set-blur', 'blur');
$('set-sens').value = S.sens; $('set-sens').oninput = (e) => { S.sens = +e.target.value; saveS(); };
$('set-hour').value = S.hour;
$('set-hour').oninput = (e) => { S.hour = +e.target.value; S.now = false; $('set-now').checked = false; saveS(); setHour(S.hour); };
function updateCredits() { $('cred-img').textContent = IMAGERY[S.img].credit; $('cred-img2').textContent = IMAGERY[S.img].credit; }
updateCredits();

// hora local ajustada: define o instante UTC em que, no fuso do lugar, são `h` horas
function utcOffsetSec() {
  if (liveWeather && liveWeather.utcOffset != null) return liveWeather.utcOffset;
  const ll = frame.toLatLon(player.x, player.z);
  return Math.round(ll.lon / 15) * 3600;
}
function setHour(h) {
  const off = utcOffsetSec() * 1000;
  const localNow = Date.now() + off;
  const dayStart = Math.floor(localNow / 86400000) * 86400000;
  simUtc = dayStart + h * 3600000 - off;
  hourOffsetMs = 0;
}
function fmtTime(ms) { const d = new Date(ms + utcOffsetSec() * 1000); return String(d.getUTCHours()).padStart(2, '0') + ':' + String(d.getUTCMinutes()).padStart(2, '0'); }

// ---------------- clima ----------------
let wxHour = -1, wxFresh = true;
function applyWeather() {
  const tNow = simUtc + hourOffsetMs;
  const realtime = Math.abs(tNow - Date.now()) < 1800000;
  wxHour = Math.floor(tNow / 3600000);
  const prev = weather.desc;
  if (S.weather === 'live') weather = liveWeather ? { ...liveWeather, ...(realtime ? {} : liveWeather.at(tNow)), live: true, forecast: !realtime } : { ...WEATHER_PRESETS.clear, live: false };
  else weather = { ...WEATHER_PRESETS[S.weather], live: false, utcOffset: liveWeather?.utcOffset };
  const w = WMO[weather.code] || WMO[0];
  weather.desc = w[0]; weather.precip = w[1]; weather.intensity = w[2];
  weather.thunder = weather.code >= 95;
  const cov = weather.cover / 100;
  // base das nuvens pelo ponto de orvalho (aprox.)
  const lcl = clamp(25 * (100 - weather.rh), 250, 2600);
  weather.base = Math.max(player.ground, 0) + lcl + 200;
  weather.cov = cov;
  clouds.set(cov, weather.base, clamp((cov - 0.6) * 2, 0, 1) + (weather.intensity > 0 ? 0.3 : 0));
  globe.cloudMat.uniforms.uCover.value = cov;
  if (playing && prev && prev !== weather.desc) toast('Clima: ' + weather.desc);
}
async function refreshWeather(lat, lon) {
  wxT = performance.now(); wxPos = { lat, lon };
  const first = !liveWeather || wxFresh;
  try { liveWeather = await fetchWeather(lat, lon); } catch (e) { liveWeather = liveWeather || null; }
  if (first && !S.now) setHour(S.hour); // agora que o fuso real do lugar é conhecido
  wxFresh = false;
  applyWeather();
}
async function refreshPlace(lat, lon, alt) {
  if (geoBusy) return;
  geoBusy = true; geoT = performance.now(); geoPos = { lat, lon };
  try {
    const zoom = alt > 150000 ? 3 : alt > 25000 ? 5 : alt > 6000 ? 8 : player.agl > 2500 ? 10 : 14;
    const r = await reverseGeocode(lat, lon, zoom);
    place = r || { name: alt > 150000 ? 'Órbita terrestre' : 'Oceano', sub: '' };
  } catch (e) { /* mantém */ }
  geoBusy = false;
}

// ---------------- desafios, mapa, fotos, favoritos e personagem ----------------
const landmarks = new Landmarks(scene, frame, terrain, world);
const wpEl = $('wp'), goalEl = $('goal');
const game = new Game(scene, frame, terrain, player, camera, {
  toast, sound: (k) => sound[k]?.(),
  goal: (t) => { if (goalEl.textContent !== t) goalEl.textContent = t; goalEl.classList.toggle('show', !!t); },
  pointer: (p, dist) => {
    if (!p) { wpEl.style.display = 'none'; return; }
    let x = p.x, y = p.y;
    if (!p.on) { const m = Math.max(Math.abs(x) / 0.86, Math.abs(y) / 0.74, 1e-6); x /= m; y /= m; }
    wpEl.style.display = 'block'; wpEl.classList.toggle('on', p.on);
    wpEl.style.transform = `translate(${((x * 0.5 + 0.5) * innerWidth).toFixed(1)}px, ${((-y * 0.5 + 0.5) * innerHeight).toFixed(1)}px) translate(-50%, -50%)`;
    wpEl.firstChild.style.transform = p.on ? '' : `rotate(${Math.atan2(x, y)}rad)`;
    wpEl.lastChild.textContent = dist >= 1000 ? (dist / 1000).toFixed(dist >= 100000 ? 0 : 1) + ' km' : Math.round(dist) + ' m';
  },
});
const mini = new MiniMap($('minimap'));
const here = () => frame.toLatLon(player.x, player.z);
let favs = [];
try { favs = JSON.parse(localStorage.getItem('jdm-favs') || '[]'); } catch (e) { /* ok */ }
const saveFavs = () => { try { localStorage.setItem('jdm-favs', JSON.stringify(favs)); } catch (e) { /* ok */ } };
function renderFavs() {
  const el = $('fav-list'); el.innerHTML = '';
  if (!favs.length) el.innerHTML = '<button disabled>Nenhum favorito ainda.</button>';
  favs.forEach((f, i) => {
    const row = document.createElement('div'); row.className = 'fav-row';
    const b = document.createElement('button'); b.textContent = `★ ${f.n} · ${Math.abs(f.lat).toFixed(2)}°${f.lat >= 0 ? 'N' : 'S'} ${Math.abs(f.lon).toFixed(2)}°${f.lon >= 0 ? 'L' : 'O'}`; b.onclick = () => go(f);
    const d = document.createElement('button'); d.className = 'del'; d.textContent = '✕'; d.title = 'Remover'; d.onclick = () => { favs.splice(i, 1); saveFavs(); renderFavs(); };
    row.append(b, d); el.appendChild(row);
  });
}
$('fav-add').onclick = () => {
  if (!playing) return;
  const ll = here();
  favs.unshift({ n: place.name || 'Lugar salvo', s: place.sub || '', lat: +ll.lat.toFixed(5), lon: +ll.lon.toFixed(5), alt: Math.round(player.y), hd: Math.round(player.yaw / DEG) });
  favs = favs.slice(0, 30); saveFavs(); renderFavs(); toast('Lugar salvo nos favoritos');
};
// mapa-múndi
let pick = null;
const wmap = new WorldMap($('wmap'), (la, lo) => {
  pick = { lat: la, lon: lo, name: `${Math.abs(la).toFixed(2)}°${la >= 0 ? 'N' : 'S'}, ${Math.abs(lo).toFixed(2)}°${lo >= 0 ? 'L' : 'O'}` };
  $('wmap-act').classList.remove('hidden');
  $('wmap-info').textContent = 'Ponto escolhido: ' + pick.name;
  const p = pick;
  reverseGeocode(la, lo, 10).then((r) => { if (r && pick === p) { p.name = r.name; $('wmap-info').textContent = `Ponto escolhido: ${r.name}${r.sub ? ' · ' + r.sub : ''}`; } }).catch(() => {});
});
wmap.marks = () => {
  const ll = here(), out = [];
  for (const L of landmarks.items) out.push({ type: 'lm', lat: L.lat, lon: L.lon, found: !!game.found[L.id] });
  for (const f of favs) out.push({ type: 'fav', lat: f.lat, lon: f.lon });
  if (game.dest) { const d = game.ll(game.dest); out.push({ type: 'dest', lat: d[0], lon: d[1] }); }
  if (playing) out.push({ type: 'me', lat: ll.lat, lon: ll.lon, hd: player.yaw });
  return out;
};
$('wmap-in').onclick = () => wmap.zoomBy(1); $('wmap-out').onclick = () => wmap.zoomBy(-1);
$('wmap-me').onclick = () => { const ll = here(); wmap.center(ll.lat, ll.lon); };
$('wmap-go').onclick = () => { if (pick) go({ n: pick.name, lat: pick.lat, lon: pick.lon, alt: null, hd: Math.round(player.yaw / DEG) }); };
$('wmap-dest').onclick = () => { if (pick) { game.setDest(pick.name, lonToMx(pick.lon), latToMy(pick.lat)); toggleMenu(false); } };
function openTab(name) { toggleMenu(true); document.querySelector(`.tabs button[data-tab="${name}"]`)?.click(); }
$('minimap').onclick = () => { if (playing) openTab('mapa'); };
// desafios
function renderChallenges() {
  $('ch-stop').classList.toggle('hidden', !game.mode);
  const ll = here(), el = $('ch-races'); el.innerHTML = '';
  const cs = world.cities().map((c) => { const p = frame.toLocal(...game.ll(c)); return { c, d: Math.hypot(p.x - player.x, p.z - player.z) }; }).filter((o) => o.d > 6000 && o.d < 500000).sort((a, b) => a.d - b.d).slice(0, 6);
  if (!cs.length) el.innerHTML = '<button disabled>Nenhuma cidade carregada por perto ainda — voe um pouco e volte aqui.</button>';
  for (const o of cs) { const b = document.createElement('button'); b.textContent = `Corrida até ${o.c.name} · ${Math.round(o.d / 1000)} km`; b.onclick = () => { game.startRace(o.c); toggleMenu(false); }; el.appendChild(b); }
  const st = game.stats, n = (v) => Math.round(v).toLocaleString('pt-BR');
  $('ch-stats').innerHTML = [
    [n(st.maxSpeed * 3.6) + ' km/h', 'Velocidade máxima'], [st.maxAlt > 10000 ? n(st.maxAlt / 1000) + ' km' : n(st.maxAlt) + ' m', 'Altitude máxima'],
    [n(st.km) + ' km', 'Distância voada'], [st.bestRings ? fmtDur(st.bestRings) : '—', `Melhor percurso de anéis (${st.ringsDone} feitos)`],
    [st.bestRace ? n(st.bestRace) + ' km/h' : '—', `Melhor média em corrida (${st.racesDone} feitas)`],
  ].map(([v, l]) => `<div><b>${v}</b><small>${l}</small></div>`).join('');
  const fe = $('ch-found'); fe.innerHTML = '';
  $('ch-found-n').textContent = `(${Object.keys(game.found).length}/${landmarks.items.length})`;
  for (const L of landmarks.items) { const b = document.createElement('button'); b.textContent = (game.found[L.id] ? '✓ ' : '') + L.name; b.className = game.found[L.id] ? 'ok' : ''; b.title = 'Ir até lá'; b.onclick = () => go({ n: L.name, lat: L.lat - 0.007, lon: L.lon, alt: null, hd: 0 }); fe.appendChild(b); }
}
$('ch-rings').onclick = () => { if (playing) { game.startRings(); toggleMenu(false); } };
$('ch-stop').onclick = () => { game.stop(); renderChallenges(); };
document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => {
  if (b.dataset.tab === 'mapa') requestAnimationFrame(() => { const ll = here(); wmap.center(ll.lat, ll.lon, wmap.zoom < 4 ? 8 : wmap.zoom); });
  if (b.dataset.tab === 'desafios') renderChallenges();
  if (b.dataset.tab === 'lugares') renderFavs();
}));
renderFavs();
// personagem
function applyLook() { avatar.setColors(S.suit, S.acc, S.helmet); effects.tint.set(S.trail); document.documentElement.style.setProperty('--acc', S.acc === '#ffffff' ? '#ff6a1a' : S.acc); }
document.querySelectorAll('.sw').forEach((el) => {
  const key = el.dataset.key;
  for (const c of el.dataset.opts.split(',')) {
    const b = document.createElement('button'); b.style.background = c; b.classList.toggle('on', S[key] === c); b.setAttribute('aria-label', c);
    b.onclick = () => { S[key] = c; saveS(); el.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b)); applyLook(); };
    el.appendChild(b);
  }
});
applyLook();
// fotos
$('btn-photo').onclick = () => { if (playing) photoReq = true; };
function takePhoto() {
  const c2 = document.createElement('canvas'); c2.width = canvas.width; c2.height = canvas.height;
  const x = c2.getContext('2d'); x.drawImage(canvas, 0, 0);
  const s = c2.height / 720, ll = here();
  const g = x.createLinearGradient(0, c2.height - 120 * s, 0, c2.height); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,.6)');
  x.fillStyle = g; x.fillRect(0, c2.height - 120 * s, c2.width, 120 * s);
  x.fillStyle = '#fff'; x.textBaseline = 'alphabetic';
  x.font = `700 ${26 * s}px 'Barlow Condensed', sans-serif`; x.fillText((place.name || 'Terra').toUpperCase(), 22 * s, c2.height - 42 * s);
  x.font = `400 ${13 * s}px Inter, sans-serif`; x.globalAlpha = 0.85;
  x.fillText(`${Math.abs(ll.lat).toFixed(3)}° ${ll.lat >= 0 ? 'N' : 'S'}  ${Math.abs(ll.lon).toFixed(3)}° ${ll.lon >= 0 ? 'L' : 'O'}  ·  ${Math.round(player.y).toLocaleString('pt-BR')} m  ·  ${Math.round(player.speed * 3.6).toLocaleString('pt-BR')} km/h  ·  ${fmtTime2()}  ·  ${weather.desc || ''} ${Math.round(weather.temp)} °C`, 22 * s, c2.height - 20 * s);
  x.textAlign = 'right'; x.font = `700 ${14 * s}px 'Barlow Condensed', sans-serif`; x.fillText('JOGO DO MUNDO', c2.width - 22 * s, c2.height - 20 * s);
  c2.toBlob((b) => {
    if (!b) return;
    const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = `jogo-do-mundo-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.jpg`;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 8000);
  }, 'image/jpeg', 0.92);
  const fl = $('flash'); fl.style.transition = 'none'; fl.style.opacity = 0.8; requestAnimationFrame(() => { fl.style.transition = ''; fl.style.opacity = 0; });
  toast('Foto salva'); game.stats.photos = (game.stats.photos || 0) + 1;
}
const fmtTime2 = () => fmtTime(simUtc + hourOffsetMs);

// ---------------- teletransporte ----------------
async function go(p) {
  sound.init();
  $('start').classList.add('hidden'); $('hud').classList.remove('hidden');
  $('touch').classList.toggle('hidden', !isTouch);
  toggleMenu(false);
  if (isTouch) { try { await document.documentElement.requestFullscreen?.(); await screen.orientation?.lock?.('landscape'); } catch (e) { /* opcional */ } }
  frame.set(p.lat, p.lon);
  terrain.reset(); buildings.clear(); world.clear(); effects.clear(); clouds.cellKey = ''; game.stop(true);
  player.x = 0; player.z = 0;
  player.y = p.alt ?? 1500;
  spawnGuard = p.alt == null ? 8 : 5; spawnMin = p.alt == null ? 250 : 60;
  rig.yaw = (p.hd || 0) * DEG; rig.pitch = p.alt > 100000 ? -0.28 : -0.12;
  player.launch(rig.yaw, p.alt > 100000 ? 0 : -0.05, p.spd ?? 45);
  setBoost(S.boost ?? 1, true);
  place = { name: p.n, sub: p.s || '' };
  playing = true;
  if (!S.now) setHour(S.hour);
  wxFresh = true; refreshWeather(p.lat, p.lon);
  geoT = performance.now() + 4000; geoPos = { lat: p.lat, lon: p.lon };
  toast(p.n);
}

// ---------------- estação / neve ----------------
function seasonDate() {
  const t = simUtc + hourOffsetMs;
  if (S.season === 'auto') return t;
  const ll = frame.toLatLon(player.x, player.z);
  const south = ll.lat < 0;
  const m = { spring: 3, summer: 6, autumn: 9, winter: 0 }[S.season];
  const month = south ? (m + 6) % 12 : m;
  const d = new Date(t);
  return Date.UTC(d.getUTCFullYear(), month, 18) + (t % 86400000);
}
function seasonName(lat, doy) {
  const nh = ['inverno', 'primavera', 'verão', 'outono'];
  let i = doy < 79 ? 0 : doy < 172 ? 1 : doy < 266 ? 2 : doy < 355 ? 3 : 0;
  if (lat < 0) i = (i + 2) % 4;
  return nh[i];
}
function seasonal(lat, doy) {
  const a = Math.abs(lat) * DEG;
  const summer = 5300 * Math.pow(Math.cos(a), 1.5);
  const amp = 2700 * Math.sin(a);
  const peak = lat >= 0 ? 25 : 207;
  const s = 0.5 + 0.5 * Math.cos((2 * Math.PI * (doy - peak)) / 365);
  let line = summer - amp * s - 200;
  const cyc = (d, p, w) => { let x = Math.abs(d - p); x = Math.min(x, 365 - x); return Math.exp(-((x / w) ** 2)); };
  const latF = smooth(22, 40, Math.abs(lat)) * (1 - smooth(65, 72, Math.abs(lat)));
  const autumn = cyc(doy, lat >= 0 ? 292 : 110, 24) * latF;
  const winter = cyc(doy, lat >= 0 ? 20 : 200, 45) * latF;
  return { line, autumn, winter };
}

// ---------------- laço principal ----------------
const clock = new THREE.Clock();
const tmpV = new THREE.Vector3(), fwdV = new THREE.Vector3();
let hudT = 0, fps = 60;
function loop() {
  requestAnimationFrame(loop);
  const dt = Math.min(clock.getDelta(), 0.1);
  fps = lerp(fps, 1 / Math.max(dt, 1e-3), 0.05);
  G.uTime.value += dt;
  simUtc += dt * 1000 * (+S.ts) ;
  if (S.now && S.ts === '1') simUtc = Date.now();
  updateInput(dt);

  if (playing && !menuOpen) { const n = dt > 0.04 ? 2 : 1; for (let i = 0; i < n; i++) player.update(dt / n, inp, terrain, world, rig); } // subpassos mantêm a física estável em aparelhos lentos
  // garante que o jogador não comece dentro de uma montanha
  if (spawnGuard > 0) {
    spawnGuard -= dt;
    const g = terrain.heightAt(player.x, player.z);
    if (g.ok && g.z >= 12) { if (player.mode === 'fly' && !player.landing && player.y < g.h + spawnMin) player.y = g.h + spawnMin; spawnGuard = 0; }
  }
  for (const ev of player.events) {
    if (ev === 'boom') { sound.boom(); effects.boom(player, player.forward(fwdV)); rig.shake = 0.6; toast('Barreira do som!'); }
    else if (ev === 'impact') { sound.impact(); effects.burst(player, env.snowy ? 'snow' : 'dust', 160, 1.2); rig.shake = 0.9; }
    else if (ev === 'splash') { sound.impact(); effects.burst(player, 'water', 200, 1.3); rig.shake = 0.6; }
    else if (ev === 'release') { sound.whoosh(); toast('Planando'); }
    else if (ev === 'takeoff') { sound.whoosh(); toast('Voando'); }
    else if (ev === 'landing') toast('Pousando…');
    else if (ev === 'bonk') { sound.burst(0.25, 500, 0.5); rig.shake = 0.25; }
    else if (ev === 'jump') sound.burst(0.18, 1200, 0.12);
    else if (ev === 'land') { sound.burst(0.2, 400, 0.3); if (player.mode === 'walk') effects.burst(player, env.snowy ? 'snow' : 'dust', 14, 0.25); }
  }
  player.events.length = 0;

  // rebase da origem para manter precisão
  if (Math.hypot(player.x, player.z) > 20000) {
    const ll = frame.toLatLon(player.x, player.z);
    const ox = player.x, oz = player.z;
    frame.set(ll.lat, ll.lon);
    player.x = 0; player.z = 0;
    for (const tr of [effects.trailL, effects.trailR]) for (const p of tr.pts) { p.x -= ox; p.z -= oz; }
    for (let i = 0; i < effects.NP; i++) { effects.pw[i * 3] -= ox; effects.pw[i * 3 + 2] -= oz; }
    effects.ringPos.x -= ox; effects.ringPos.z -= oz; game.shift(ox, oz);
  }

  const C = rig.update(dt, player, terrain);
  const camAlt = C.y;
  const ll = frame.toLatLon(C.x, C.z);
  const pll = frame.toLatLon(player.x, player.z);

  // sol, estação
  const sd = seasonDate();
  const sun = sunPosition(sd, ll.lat, ll.lon);
  sunDirLocal(sun.el, sun.az, G.uSunDir.value);
  const doy = dayOfYear(sd);
  const ss = seasonal(pll.lat, doy);
  let line = ss.line;
  if (weather.snow > 0.03) line = Math.min(line, player.ground - 300);
  if (weather.precip === 'snow' || weather.temp < -2) line = Math.min(line, Math.max(player.ground, 0) - 200);
  G.uSnowLine.value = lerp(G.uSnowLine.value, line, 0.05);
  G.uAutumn.value = ss.autumn; G.uWinter.value = ss.winter * (weather.snow > 0.03 ? 0.3 : 1);
  env.snowy = player.ground > G.uSnowLine.value - 100;

  // clima
  if (playing && (performance.now() - wxT > 300000 || (wxPos && Math.hypot(pll.lat - wxPos.lat, (pll.lon - wxPos.lon) * Math.cos(pll.lat * DEG)) > 0.6))) refreshWeather(pll.lat, pll.lon);
  if (playing && performance.now() - geoT > 12000 && (!geoPos || Math.hypot(pll.lat - geoPos.lat, (pll.lon - geoPos.lon) * Math.cos(pll.lat * DEG)) > 0.03)) refreshPlace(pll.lat, pll.lon, camAlt);
  if (Math.floor((simUtc + hourOffsetMs) / 3600000) !== wxHour) applyWeather();
  const below = 1 - smooth(weather.base + 300, weather.base + 1800, camAlt);
  // temperatura no ar: cai ~6,5 °C por km acima da estação
  env.tempAir = Math.max(weather.temp - 6.5 * (player.y - (liveWeather?.elevation ?? Math.max(player.ground, 0))) / 1000, -56.5);
  const precipOn = weather.precip === 'rain' || weather.precip === 'snow';
  const hazeW = weather.precip === 'fog' ? clamp(18000 / Math.max(weather.vis, 300), 4, 40) : weather.precip === 'snow' ? 6 : weather.precip === 'rain' ? 3.5 : 1 + weather.cov * 0.6;
  G.uHaze.value = lerp(1, hazeW, below) * (weather.vis < 10000 && weather.precip !== 'fog' ? 1.5 : 1);
  G.uOvercast.value = clamp((weather.cov - 0.35) / 0.6, 0, 1) * below * (precipOn ? 1 : 0.85);
  env.humidity = weather.rh / 100;

  // atmosfera no CPU (luz ambiente, cor do sol)
  atmoT -= dt;
  const sunArr = [G.uSunDir.value.x, G.uSunDir.value.y, G.uSunDir.value.z];
  if (atmoT <= 0) {
    atmoT = 0.2;
    const h = Math.min(camAlt, 60000);
    const dirs = [[0, 1, 0], [0.8, 0.6, 0], [-0.8, 0.6, 0], [0, 0.6, 0.8], [0, 0.6, -0.8]];
    const acc = [0, 0, 0];
    for (const d of dirs) { const c = skyRadianceJS(d, Math.max(h, 0), sunArr, G.uHaze.value); for (let i = 0; i < 3; i++) acc[i] += c[i] / dirs.length; }
    const oc = G.uOvercast.value;
    for (let i = 0; i < 3; i++) { const v = lerp(amb[i], acc[i] * (1 - oc * 0.35) + oc * 0.12 * Math.max(sun.el + 0.1, 0), 0.5); amb[i] = Number.isFinite(v) ? v : 0.1; }
    G.uAmbient.value.set(amb[0], amb[1], amb[2]);
    sunTransmitJS(Math.max(player.y, 0), G.uSunDir.value.y, G.uHaze.value, sunT);
  }
  const night = smooth(0.05, -0.15, G.uSunDir.value.y);
  G.uMoon.value.set(0.010, 0.014, 0.028).multiplyScalar(night);
  G.uCamAlt.value = camAlt;
  G.uCamLL.value.set(ll.lat * DEG, ll.lon * DEG);
  const horizon = (h) => Math.sqrt(2 * RE * Math.max(h, 1) + h * h);
  const beta = 13.5e-6 * Math.exp(-camAlt / 8000) + 2.1e-5 * G.uHaze.value * 1.1 * Math.exp(-Math.max(camAlt, 0) / 1200);
  G.uMaxDist.value = Math.min(horizon(camAlt) + horizon(5000), Math.max(8 / beta, 30000));
  const oc = G.uOvercast.value * (1 - smooth(weather.base, weather.base + 600, player.y));
  env.light = clamp(2.2 * sunT[1] * (0.3 + 0.8 * Math.max(G.uSunDir.value.y, 0)) * smooth(-0.1, 0.05, G.uSunDir.value.y) * (1 - oc * 0.75) + amb[1] * 1.3 + G.uMoon.value.y, 0.005, 3);

  // luzes para objetos padrão do three
  const sunCol = new THREE.Color(sunT[0], sunT[1], sunT[2]).multiplyScalar(1 - oc * 0.78);
  sunLight.color.copy(sunCol); sunLight.intensity = Math.PI * 2.2;
  sunLight.position.copy(G.uSunDir.value).multiplyScalar(100); sunLight.target.position.set(0, 0, 0);
  hemi.color.setRGB(amb[0] * 1.2 + G.uMoon.value.x, amb[1] * 1.2 + G.uMoon.value.y, amb[2] * 1.2 + G.uMoon.value.z); hemi.groundColor.setRGB(amb[0] * 0.5, amb[1] * 0.45, amb[2] * 0.4); hemi.intensity = Math.PI;
  {
    const hc = skyRadianceJS([0.97 * Math.cos(player.yaw - Math.PI / 2), 0.05, 0.97 * Math.sin(player.yaw - Math.PI / 2)], Math.max(Math.min(camAlt, 20000), 0), sunArr, G.uHaze.value);
    scene.fog.color.setRGB(hc[0] * 0.6 + amb[0] * 0.4, hc[1] * 0.6 + amb[1] * 0.4, hc[2] * 0.6 + amb[2] * 0.4);
    scene.fog.density = beta * 0.8;
  }

  // objetos do mundo
  terrain.update(camera, C, camAlt, G.uMaxDist.value);
  globe.update(ll.lat, ll.lon, camAlt);
  sky.update(camera);
  clouds.update(dt, C);
  buildings.snowRoof = world.snowRoof = env.snowy;
  // casas, água e nomes: OpenFreeMap; se indisponível, prédios pelo Overpass
  if (world.failed && S.bld) buildings.on = true;
  if (playing) { world.update(C, camAlt, camAlt - Math.max(player.ground, 0)); buildings.update(C, camAlt - Math.max(player.ground, 0)); }
  world.night.value = night;
  world.wMat.uniforms.uFrozen.value = lerp(world.wMat.uniforms.uFrozen.value, weather.temp < -6 && weather.snow > 0.05 ? 1 : 0, 0.02);
  const pAmt = precipOn && camAlt < weather.base + 400 ? weather.intensity : 0;
  const wd = (weather.windDir + 180) * DEG, ws = weather.wind / 3.6;
  player.forward(fwdV);
  precip.update(dt, C, camAlt, weather.precip === 'rain' && env.tempAir < 0.5 ? 'snow' : weather.precip, pAmt, tmpV.set(Math.sin(wd) * ws * 0.5, 0, -Math.cos(wd) * ws * 0.5), fwdV.clone().multiplyScalar(Math.min(player.speed, 80)), env.light);
  sound.update(player.speed, Math.exp(-Math.max(player.y, 0) / 8500), player.boostAmt, pAmt);

  // raios
  flash = Math.max(0, flash - dt * 4);
  if (weather.thunder && camAlt < weather.base + 3000) {
    lightningT -= dt;
    if (lightningT <= 0) { lightningT = 4 + Math.random() * 10; flash = 1.2; sound.thunder(); }
  }
  sky.mat.uniforms.uFlash.value = flash * 0.15;
  sky.mat.uniforms.uOverCol.value.set(amb[0] * 1.3 + 0.002, amb[1] * 1.3 + 0.002, amb[2] * 1.3 + 0.003);

  // avatar
  avatar.root.position.set(player.x - C.x, player.y, player.z - C.z);
  const flying = (player.mode === 'fly' && !player.hover) || player.mode === 'glide';
  avatar.root.rotation.set(flying ? player.pitch : 0, -player.yaw, player.mode === 'fly' || player.mode === 'glide' ? player.roll : 0, 'YXZ');
  avatar.animate(dt, {
    mode: player.mode, speed: flying ? player.speed : player.hspeed, vy: player.vy, air: player.mode === 'walk' && !player.onGround,
    turbo: player.mode === 'fly' && !player.hover ? player.boostAmt : 0, hover: player.hover, landing: clamp(player.landT / 0.3, 0, 1),
  });
  avatar.root.visible = rig.mode !== 2;
  if (player.mode === 'swim' && player.hspeed > 0.7 && Math.random() < 0.6) {
    const a = Math.random() * 6.28;
    effects.emit(player.x + Math.cos(a) * 0.6, player.waterLevel + 0.15, player.z + Math.sin(a) * 0.6, Math.cos(a) * 1.5 - player.vx * 0.3, 1.5 + Math.random() * 2, Math.sin(a) * 1.5 - player.vz * 0.3, 0.6 + Math.random() * 0.5, 0.8 + Math.random(), 'water');
  }
  env.pr = pixelRatio;
  effects.update(dt, player, C, camera, avatar, env);
  landmarks.update(C);
  game.update(dt, C, landmarks, playing && !menuOpen);
  if (playing) mini.draw(dt, pll.lat, pll.lon, player.yaw, Math.max(player.agl, 0), game.dest ? game.ll(game.dest) : null);

  // pós
  const sp = player.speed;
  const nearF = clamp(3000 / (Math.max(player.agl, 0) + 3000) + 0.12 * Math.exp(-player.y / 30000), 0, 1);
  const blurT = S.blur && (player.mode === 'fly' || player.mode === 'glide') ? (clamp((sp - 120) / 1400, 0, 1) * 0.11 + player.boostAmt * 0.02) * nearF : 0;
  post.mat.uniforms.uBlur.value = lerp(post.mat.uniforms.uBlur.value, blurT, 1 - Math.exp(-dt * 3));
  const lumAmb = amb[0] * 0.3 + amb[1] * 0.6 + amb[2] * 0.1;
  const lumSun = (sunT[0] * 0.3 + sunT[1] * 0.6 + sunT[2] * 0.1) * Math.max(G.uSunDir.value.y, 0) * (1 - oc * 0.7);
  const lumTs = sunT[0] * 0.3 + sunT[1] * 0.6 + sunT[2] * 0.1;
  let key = 2.2 * lumTs * (0.3 + 0.8 * Math.max(G.uSunDir.value.y, 0)) * smooth(-0.1, 0.05, G.uSunDir.value.y) * (1 - oc * 0.78) + lumAmb + G.uMoon.value.y;
  const spaceF = smooth(15000, 60000, camAlt);
  const dip = -Math.sqrt(2 * Math.max(camAlt, 0) / RE);
  key = lerp(key, G.uSunDir.value.y > dip ? 3.2 : 0.03, spaceF);
  const expT = clamp(0.44 * Math.pow(2.4 / (key + 0.004), 0.65), 0.25, 8);
  exposure = lerp(exposure, expT, 1 - Math.exp(-dt * 1.5));
  post.mat.uniforms.uExposure.value = exposure;
  post.mat.uniforms.uTime.value = G.uTime.value;
  post.mat.uniforms.uFlash.value = flash * 0.08;
  post.mat.uniforms.uVig.value = 0.3;

  post.render(scene, camera);
  if (photoReq) { photoReq = false; takePhoto(); }

  // HUD
  hudT -= dt; toastT -= dt;
  if (toastT <= 0) $('toast').classList.remove('show');
  if (playing && hudT <= 0) { hudT = 0.1; updateHUD(ll, pll, camAlt, doy); }
}

const NUM = new Intl.NumberFormat('pt-BR');
const CARD = ['N', 'NE', 'L', 'SE', 'S', 'SO', 'O', 'NO'];
function updateHUD(ll, pll, camAlt, doy) {
  const kmh = Math.round(player.speed * 3.6);
  $('spd-num').textContent = kmh;
  const m = player.speed / speedOfSound(player.y);
  const mach = $('spd-mach');
  mach.textContent = m >= 0.3 && player.y < 100000 ? 'MACH ' + m.toFixed(2) : player.y >= 100000 ? 'ÓRBITA' : '';
  mach.classList.toggle('super', m >= 1);
  const alt = player.y;
  $('spd-alt').textContent = 'ALT ' + (alt > 10000 ? NUM.format(Math.round(alt / 100) / 10) + ' km' : NUM.format(Math.round(alt)) + ' m') + ' · ' + NUM.format(Math.round(Math.max(player.agl, 0))) + ' m do solo';
  $('loc-name').textContent = place.name || '—';
  $('loc-sub').textContent = place.sub || '';
  const ns = pll.lat >= 0 ? 'N' : 'S', ew = pll.lon >= 0 ? 'L' : 'O';
  $('loc-coord').textContent = `${Math.abs(pll.lat).toFixed(3)}° ${ns} ${Math.abs(pll.lon).toFixed(3)}° ${ew} · solo ${NUM.format(Math.round(player.ground))} m`;
  const t = fmtTime(simUtc + hourOffsetMs);
  const air = player.y > 90000 ? '' : ` · ${Math.round(env.tempAir)} °C no ar`;
  $('loc-wx').textContent = `${t} · ${seasonName(pll.lat, doy)} · ${weather.desc || ''}${weather.live ? (weather.forecast ? ' (previsão)' : ' (ao vivo)') : ''} · ${Math.round(weather.temp)} °C no solo${air} · vento ${Math.round(weather.wind)} km/h · nuvens ${Math.round(weather.cover)}%`;
  // bússola
  const hd = ((player.yaw / DEG) % 360 + 360) % 360;
  const strip = $('compass-strip');
  if (!strip.dataset.built) {
    let h = '';
    for (let r = 0; r < 3; r++) for (let d = 0; d < 360; d += 15) { const c = d % 45 === 0 ? CARD[d / 45] : d % 45 === 0 ? '' : '·'; h += `<span class="${d % 90 === 0 ? 'c' : ''}">${d % 45 === 0 ? c : String(d)}</span>`; }
    strip.innerHTML = h; strip.dataset.built = 1;
  }
  strip.style.transform = `translateX(${-(360 + hd) / 15 * 30 - 15}px)`;
  // dicas
  let hint = '';
  const touch = isTouch, md = player.mode;
  if (md === 'fly') hint = player.landing ? 'Pousando…' : player.hover ? (touch ? 'Analógico: mover · arraste a direita: olhar · TURBO: voar rápido · POUSAR: descer' : 'WASD: mover · mouse: olhar · Shift: turbo · F: pousar · Espaço/Q: subir/descer') : player.speed > 250 ? (touch ? 'Voa para onde você olha · FREIO: parar · PLANAR: wingsuit' : 'Voa para onde você olha · S: frear · X: planar · 1–6: boost') : '';
  else if (md === 'glide') hint = touch ? 'Planando · analógico: virar e mergulhar · TURBO: voltar a voar' : 'Planando · A/D: virar · W/S: mergulhar/frear · Shift: voltar a voar';
  else if (md === 'swim') hint = touch ? 'Nadando · TURBO: nadar rápido · VOAR: sair da água' : 'Nadando · Shift: nadar rápido · F: voar';
  else hint = player.hspeed < 0.3 ? (touch ? 'Analógico: andar · TURBO: correr · PULAR · VOAR' : 'WASD: andar · Shift: correr · Espaço: pular · F: voar · G: acenar') : '';
  setHint(hint);
  $('t-fly').textContent = md === 'fly' ? (player.landing ? 'CANCELAR' : 'POUSAR') : 'VOAR';
  $('t-a').textContent = md === 'fly' ? 'FREIO' : 'PULAR'; $('t-a').style.visibility = md === 'glide' ? 'hidden' : 'visible';
  $('t-x').textContent = md === 'fly' ? 'PLANAR' : 'ACENAR'; $('t-x').style.visibility = md === 'fly' || md === 'walk' ? 'visible' : 'hidden';
  $('t-boost').textContent = md === 'walk' ? 'CORRER' : 'TURBO';
  $('spd-boost').textContent = `BOOST ${player.boost + 1} · ${BOOSTS[player.boost].name.toUpperCase()}`;
  const L = terrain.loading;
  $('loading').textContent = L > 3 ? `carregando terreno… ${L}` : '';
}

// ---------------- início ----------------
applyWeather();
resize();
G.uSunDir.value.set(0.3, 0.6, -0.5).normalize();
globe.loadTextures(S.img);
$('boot').textContent = 'Escolha um lugar para começar';
loop();
// posição inicial atrás do menu (cenário de fundo)
frame.set(45.905, 6.86); player.y = 2600; rig.yaw = 205 * DEG; player.launch(rig.yaw, 0, 0);
window.__jdm = { player, terrain, frame, go, G, S, setHour, rig, weather: () => weather, applyWeather, renderer, scene, camera, post, sky, globe, buildings, world, game, landmarks, openTab, inp, avatar, setBoost, takePhoto: () => { photoReq = true; } };
