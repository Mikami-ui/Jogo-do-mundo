// Atmosfera: espalhamento Rayleigh + Mie simplificado (céu do chão ao espaço) e perspectiva aérea.
// Mesmo modelo em GLSL (GPU) e JS (CPU, para luzes e neblina dos objetos).
import { RE } from './geo.js';

export const BR = [5.8e-6, 13.5e-6, 33.1e-6];
export const HR = 8000, HM = 1200, BM0 = 2.1e-5, ATM_TOP = 80000, SUN_I = 20;

export const ATMO_GLSL = /* glsl */`
#define ATM_R 6371000.0
#define ATM_TOP 80000.0
#define HR 8000.0
#define HM 1200.0
#define SUNK 2.2
const vec3 BR = vec3(5.8e-6, 13.5e-6, 33.1e-6);
uniform vec3 uSunDir;
uniform float uSunI;
uniform float uHaze;      // multiplicador de aerossóis (neblina/chuva)
uniform vec3 uAmbient;    // radiância média do céu (luz ambiente)
uniform float uOvercast;  // 0..1 céu encoberto (abaixo das nuvens)
uniform float uCamAlt;
float phaseR(float mu){ return 0.0596831*(1.0+mu*mu); }
float phaseM(float mu){ const float g=0.76; float g2=g*g; return 0.0795775*(1.0-g2)/pow(max(1.0+g2-2.0*g*mu,1e-4),1.5); }
float chap(float c, float mu){ return c / max(c*mu + 1.0, 0.04); }
vec3 sunTransmit(float h, float mu){
  h = max(h, 0.0);
  float cR = sqrt((ATM_R+h)/HR), cM = sqrt((ATM_R+h)/HM);
  float odR = HR*exp(-h/HR)*chap(cR, mu);
  float odM = HM*exp(-h/HM)*chap(cM, mu);
  float dip = -sqrt(2.0*h/ATM_R);
  float sh = smoothstep(dip - 0.012, dip + 0.004, mu);
  return exp(-(BR*odR + 2.1e-5*uHaze*1.1*odM)) * sh;
}
// integral de densidade exponencial em segmento reto de altura h1 a h2 com comprimento L
float odSeg(float h1, float h2, float L, float H){
  float dh = h2 - h1;
  float e1 = exp(-max(h1,-500.0)/H), e2 = exp(-max(h2,-500.0)/H);
  if (abs(dh) < 1.0) return L*0.5*(e1+e2);
  return L*H*(e1-e2)/dh;
}
// perspectiva aérea entre câmera (altura hc) e ponto (altura hp) a distância L. T = transmitância
vec3 aerial(float hc, float hp, float L, float muView, float muSun, out vec3 T){
  float hm = 0.5*(hc+hp) + L*L/(8.0*ATM_R);
  float bm = 2.1e-5*uHaze;
  float oR = odSeg(hc, hm, L*0.5, HR) + odSeg(hm, hp, L*0.5, HR);
  float oM = odSeg(hc, hm, L*0.5, HM) + odSeg(hm, hp, L*0.5, HM);
  vec3 ext = BR*oR + bm*1.1*oM;
  T = exp(-ext);
  vec3 ts = sunTransmit(min(hp, hc) + 0.3*abs(hp-hc), muSun) * (1.0 - 0.8*uOvercast);
  vec3 scat = (BR*oR*phaseR(muView) + bm*oM*phaseM(muView)) / max(ext, vec3(1e-9));
  return (1.0 - T) * (uSunI*0.5*ts*scat + uAmbient*0.9);
}
vec3 skyRadiance(vec3 rd, float camH, out float hitPlanet){
  hitPlanet = 0.0;
  float r0 = ATM_R + camH;
  float b = r0*rd.y;
  float cA = (camH - ATM_TOP)*(2.0*ATM_R + camH + ATM_TOP);
  float dA = b*b - cA;
  if (dA < 0.0) return vec3(0.0);
  float sA = sqrt(dA);
  float t0 = max(-b - sA, 0.0), t1 = -b + sA;
  if (t1 <= 0.0) return vec3(0.0);
  float cP = camH*(2.0*ATM_R + camH);
  float dP = b*b - cP;
  if (dP > 0.0 && b < 0.0) { float tp = -b - sqrt(dP); if (tp > 0.0) { t1 = min(t1, tp); hitPlanet = 1.0; } }
  float L = t1 - t0;
  float pw = mix(2.2, 1.0, smoothstep(4000.0, 40000.0, camH));
  vec3 ro = vec3(0.0, r0, 0.0);
  vec3 sumR = vec3(0.0), sumM = vec3(0.0);
  float oR = 0.0, oM = 0.0;
  float bm = 2.1e-5*uHaze;
  const int N = 14;
  float prev = 0.0;
  for (int i = 0; i < N; i++){
    float a = pow(float(i+1)/float(N), pw);
    float ds = (a - prev)*L;
    float t = t0 + (prev + a)*0.5*L;
    prev = a;
    vec3 p = ro + rd*t;
    float rr = length(p);
    float h = rr - ATM_R;
    float dr = exp(-h/HR)*ds, dm = exp(-h/HM)*ds;
    oR += dr*0.5; oM += dm*0.5;
    float mu = dot(p, uSunDir)/rr;
    vec3 T = exp(-(BR*oR + bm*1.1*oM)) * sunTransmit(h, mu);
    sumR += dr*T; sumM += dm*T;
    oR += dr*0.5; oM += dm*0.5;
  }
  float mu = dot(rd, uSunDir);
  vec3 col = uSunI*(sumR*BR*phaseR(mu) + sumM*bm*phaseM(mu));
  vec3 Tv = exp(-(BR*oR + bm*1.1*oM));
  // espalhamento múltiplo (aproximação barata)
  col += uAmbient*(1.0 - Tv)*0.35;
  if (hitPlanet < 0.5) {
    float sd = smoothstep(0.99996, 0.999985, mu);
    col += uSunI*90.0*sd*Tv;
    col += uSunI*0.04*pow(max(mu,0.0), 600.0)*Tv;
  }
  return col;
}
`;

// ---------- Versão CPU ----------
const exp = Math.exp;
function chap(c, mu) { return c / Math.max(c * mu + 1, 0.04); }
export function sunTransmitJS(h, mu, haze, out = [0, 0, 0]) {
  h = Math.max(h, 0);
  const cR = Math.sqrt((RE + h) / HR), cM = Math.sqrt((RE + h) / HM);
  const odR = HR * exp(-h / HR) * chap(cR, mu);
  const odM = HM * exp(-h / HM) * chap(cM, mu);
  const dip = -Math.sqrt((2 * h) / RE);
  const t = Math.min(Math.max((mu - (dip - 0.012)) / 0.016, 0), 1);
  const sh = t * t * (3 - 2 * t);
  for (let i = 0; i < 3; i++) out[i] = exp(-(BR[i] * odR + BM0 * haze * 1.1 * odM)) * sh;
  return out;
}
// radiância do céu numa direção (JS, menos passos)
export function skyRadianceJS(rd, camH, sun, haze) {
  const r0 = RE + camH;
  const b = r0 * rd[1];
  const cA = (camH - ATM_TOP) * (2 * RE + camH + ATM_TOP);
  const dA = b * b - cA;
  if (dA < 0) return [0, 0, 0];
  const sA = Math.sqrt(dA);
  const t0 = Math.max(-b - sA, 0); let t1 = -b + sA;
  if (t1 <= 0) return [0, 0, 0];
  const cP = camH * (2 * RE + camH);
  const dP = b * b - cP;
  if (dP > 0 && b < 0) { const tp = -b - Math.sqrt(dP); if (tp > 0) t1 = Math.min(t1, tp); }
  const L = t1 - t0, N = 10;
  const pw = camH < 4000 ? 2.2 : camH > 40000 ? 1 : 2.2 - 1.2 * ((camH - 4000) / 36000);
  const sumR = [0, 0, 0], sumM = [0, 0, 0], T = [0, 0, 0];
  let oR = 0, oM = 0, prev = 0;
  const bm = BM0 * haze;
  for (let i = 0; i < N; i++) {
    const a = Math.pow((i + 1) / N, pw);
    const ds = (a - prev) * L, t = t0 + (prev + a) * 0.5 * L; prev = a;
    const px = rd[0] * t, py = r0 + rd[1] * t, pz = rd[2] * t;
    const rr = Math.hypot(px, py, pz), h = rr - RE;
    const dr = exp(-h / HR) * ds, dm = exp(-h / HM) * ds;
    oR += dr * 0.5; oM += dm * 0.5;
    const mu = (px * sun[0] + py * sun[1] + pz * sun[2]) / rr;
    sunTransmitJS(h, mu, haze, T);
    for (let c = 0; c < 3; c++) { const v = exp(-(BR[c] * oR + bm * 1.1 * oM)) * T[c]; sumR[c] += dr * v; sumM[c] += dm * v; }
    oR += dr * 0.5; oM += dm * 0.5;
  }
  const mu = rd[0] * sun[0] + rd[1] * sun[1] + rd[2] * sun[2];
  const pR = 0.0596831 * (1 + mu * mu);
  const g = 0.76, pM = (0.0795775 * (1 - g * g)) / Math.pow(Math.max(1 + g * g - 2 * g * mu, 1e-4), 1.5);
  return [0, 1, 2].map((c) => SUN_I * (sumR[c] * BR[c] * pR + sumM[c] * bm * pM));
}
