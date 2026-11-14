// Serviços externos: clima ao vivo (Open-Meteo) e nomes de lugares (Nominatim / OpenStreetMap).
export const WMO = {
  0: ['Céu limpo', 'none', 0], 1: ['Predominantemente limpo', 'none', 0], 2: ['Parcialmente nublado', 'none', 0], 3: ['Nublado', 'none', 0],
  45: ['Neblina', 'fog', 0], 48: ['Neblina com geada', 'fog', 0],
  51: ['Garoa fraca', 'rain', 0.2], 53: ['Garoa', 'rain', 0.3], 55: ['Garoa forte', 'rain', 0.45], 56: ['Garoa congelante', 'rain', 0.3], 57: ['Garoa congelante forte', 'rain', 0.5],
  61: ['Chuva fraca', 'rain', 0.4], 63: ['Chuva', 'rain', 0.65], 65: ['Chuva forte', 'rain', 1], 66: ['Chuva congelante', 'rain', 0.5], 67: ['Chuva congelante forte', 'rain', 0.9],
  71: ['Neve fraca', 'snow', 0.4], 73: ['Neve', 'snow', 0.7], 75: ['Neve forte', 'snow', 1], 77: ['Grãos de neve', 'snow', 0.4],
  80: ['Pancadas de chuva', 'rain', 0.5], 81: ['Pancadas de chuva', 'rain', 0.75], 82: ['Pancadas de chuva fortes', 'rain', 1],
  85: ['Pancadas de neve', 'snow', 0.6], 86: ['Pancadas de neve fortes', 'snow', 1],
  95: ['Trovoada', 'rain', 0.9], 96: ['Trovoada com granizo', 'rain', 1], 99: ['Trovoada com granizo', 'rain', 1],
};
export const WEATHER_PRESETS = {
  clear: { code: 0, cover: 4, temp: 18, rh: 45, vis: 60000, wind: 8, windDir: 270, snow: 0 },
  cloudy: { code: 3, cover: 88, temp: 12, rh: 70, vis: 30000, wind: 15, windDir: 250, snow: 0 },
  rain: { code: 63, cover: 98, temp: 9, rh: 92, vis: 8000, wind: 25, windDir: 230, snow: 0 },
  snow: { code: 73, cover: 98, temp: -4, rh: 90, vis: 4000, wind: 15, windDir: 320, snow: 0.4 },
  storm: { code: 95, cover: 100, temp: 16, rh: 95, vis: 5000, wind: 45, windDir: 200, snow: 0 },
  fog: { code: 45, cover: 70, temp: 6, rh: 99, vis: 600, wind: 3, windDir: 0, snow: 0 },
};

export async function fetchWeather(lat, lon) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(3)}&longitude=${lon.toFixed(3)}` +
    `&current=temperature_2m,relative_humidity_2m,weather_code,cloud_cover,wind_speed_10m,wind_direction_10m` +
    `&hourly=visibility,snow_depth&forecast_days=1&timezone=auto`;
  const r = await fetch(url);
  if (!r.ok) throw new Error('clima ' + r.status);
  const d = await r.json();
  const c = d.current || {};
  let vis = 30000, snow = 0;
  try {
    const hour = (c.time || '').slice(0, 13);
    const i = Math.max(0, d.hourly.time.findIndex((t) => t.slice(0, 13) === hour));
    vis = d.hourly.visibility?.[i] ?? vis; snow = d.hourly.snow_depth?.[i] ?? 0;
  } catch (e) { /* opcional */ }
  return { code: c.weather_code ?? 0, cover: c.cloud_cover ?? 30, temp: c.temperature_2m ?? 15, rh: c.relative_humidity_2m ?? 60,
    wind: c.wind_speed_10m ?? 5, windDir: c.wind_direction_10m ?? 0, vis, snow, utcOffset: d.utc_offset_seconds ?? null, tz: d.timezone_abbreviation || '' };
}

let lastNom = 0;
async function nominatim(url) {
  const wait = Math.max(0, lastNom + 1100 - Date.now());
  if (wait) await new Promise((r) => setTimeout(r, wait));
  lastNom = Date.now();
  const r = await fetch(url, { headers: { 'Accept-Language': 'pt-BR,pt,en' } });
  if (!r.ok) throw new Error('nominatim ' + r.status);
  return r.json();
}
export async function reverseGeocode(lat, lon, zoom = 10) {
  const d = await nominatim(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}&zoom=${zoom}&accept-language=pt-BR`);
  if (d.error) return null;
  const a = d.address || {};
  const name = a.city || a.town || a.village || a.hamlet || a.municipality || a.suburb || a.county || a.state_district || a.state || a.country || (d.name ?? '');
  const parts = [a.county !== name ? a.county : null, a.state !== name ? a.state : null, a.country !== name ? a.country : null].filter(Boolean);
  return { name, sub: parts.join(' · ') };
}
export async function searchPlaces(q) {
  const d = await nominatim(`https://nominatim.openstreetmap.org/search?format=jsonv2&q=${encodeURIComponent(q)}&limit=7&accept-language=pt-BR`);
  return d.map((r) => ({ name: r.display_name, lat: +r.lat, lon: +r.lon, type: r.type }));
}

// ---------------- som procedural ----------------
export class Sound {
  constructor() { this.on = true; this.ctx = null; }
  init() {
    if (this.ctx) { this.ctx.resume?.(); return; }
    try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return; }
    const ctx = this.ctx;
    const len = ctx.sampleRate * 2, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
    let b = 0; for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; b = 0.97 * b + 0.03 * w; d[i] = w * 0.5 + b * 3; }
    this.noise = buf;
    this.master = ctx.createGain(); this.master.gain.value = this.on ? 0.8 : 0; this.master.connect(ctx.destination);
    const loop = (type, freq, q) => {
      const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true; s.playbackRate.value = 0.7 + Math.random() * 0.6;
      const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
      const g = ctx.createGain(); g.gain.value = 0;
      s.connect(f); f.connect(g); g.connect(this.master); s.start();
      return { f, g };
    };
    this.wind = loop('bandpass', 400, 0.6);
    this.hiss = loop('highpass', 2500, 0.5);
    this.rumble = loop('lowpass', 160, 1.2);
    this.rain = loop('highpass', 1200, 0.3);
  }
  setOn(v) { this.on = v; if (this.master) this.master.gain.value = v ? 0.8 : 0; }
  update(speed, rho, boost, precip) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const w = Math.min(speed / 140, 1.6) ** 1.2 * Math.min(rho * 1.2, 1);
    this.wind.g.gain.setTargetAtTime(w * 0.35, t, 0.1);
    this.wind.f.frequency.setTargetAtTime(220 + Math.min(speed, 700) * 2.2, t, 0.1);
    this.hiss.g.gain.setTargetAtTime(Math.max(0, Math.min((speed - 150) / 900, 1)) * 0.12 * Math.min(rho * 1.5, 1), t, 0.15);
    this.rumble.g.gain.setTargetAtTime(boost * 0.55, t, 0.08);
    this.rain.g.gain.setTargetAtTime(precip * 0.12, t, 0.5);
  }
  burst(dur, freq, gain, delay = 0, thump = 0) {
    if (!this.ctx || !this.on) return;
    const ctx = this.ctx, t = ctx.currentTime + delay;
    const s = ctx.createBufferSource(); s.buffer = this.noise;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = freq;
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + 0.02); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(f); f.connect(g); g.connect(this.master); s.start(t); s.stop(t + dur + 0.1);
    if (thump) {
      const o = ctx.createOscillator(); o.frequency.setValueAtTime(70, t); o.frequency.exponentialRampToValueAtTime(30, t + 0.6);
      const og = ctx.createGain(); og.gain.setValueAtTime(thump, t); og.gain.exponentialRampToValueAtTime(0.001, t + 0.8);
      o.connect(og); og.connect(this.master); o.start(t); o.stop(t + 0.9);
    }
  }
  boom() { this.burst(1.6, 500, 1.2, 0, 0.9); this.burst(0.9, 2000, 0.4, 0.05); }
  impact() { this.burst(0.7, 700, 0.9, 0, 0.7); }
  thunder() { this.burst(4 + Math.random() * 2, 260, 0.9, 1 + Math.random() * 3, 0.4); }
  whoosh() { this.burst(0.6, 1500, 0.3); }
}
