// Decodificador de PNG próprio (8 bits por canal, sem entrelaçamento), só para os mapas de altura.
// Os mapas de altura guardam a altitude nas cores (vermelho × 256 + verde + azul ÷ 256 − 32768). Se o aparelho
// mexer nas cores ao abrir a imagem (gestão de cor, formato reduzido da GPU), um desvio de 1 no vermelho vira
// 256 m de erro — ruas e objetos subindo para o céu ou afundando. Lendo os bytes direto do arquivo, o valor é exato
// em qualquer aparelho.
const inflate = async (bytes) => {
  const ds = new DecompressionStream('deflate'); // os dados do PNG são zlib, que é o formato 'deflate' do navegador
  const out = await new Response(new Blob([bytes]).stream().pipeThrough(ds)).arrayBuffer();
  return new Uint8Array(out);
};
export const canDecodePNG = typeof DecompressionStream !== 'undefined';
// devolve { w, h, rgb } com 3 bytes por pixel
export async function decodePNG(buf) {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  for (let i = 0; i < 8; i++) if (b[i] !== sig[i]) throw new Error('não é PNG');
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let p = 8, w = 0, h = 0, depth = 0, type = 0, inter = 0, pal = null; const idat = [];
  while (p + 8 <= b.length) {
    const len = dv.getUint32(p), t = String.fromCharCode(b[p + 4], b[p + 5], b[p + 6], b[p + 7]), d = b.subarray(p + 8, p + 8 + len);
    if (t === 'IHDR') { w = dv.getUint32(p + 8); h = dv.getUint32(p + 12); depth = b[p + 16]; type = b[p + 17]; inter = b[p + 20]; }
    else if (t === 'PLTE') pal = d;
    else if (t === 'IDAT') idat.push(d);
    else if (t === 'IEND') break;
    p += 12 + len;
  }
  const ch = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[type];
  if (depth !== 8 || inter !== 0 || !ch || (type === 3 && !pal)) throw new Error('formato de PNG não suportado');
  let n = 0; for (const d of idat) n += d.length;
  const z = new Uint8Array(n); n = 0; for (const d of idat) { z.set(d, n); n += d.length; }
  const raw = await inflate(z);
  const stride = w * ch, px = new Uint8Array(stride * h);
  for (let y = 0, r = 0; y < h; y++) {
    const f = raw[r++], cur = y * stride, prev = cur - stride;
    for (let x = 0; x < stride; x++, r++) {
      const a = x >= ch ? px[cur + x - ch] : 0, up = y > 0 ? px[prev + x] : 0, c = x >= ch && y > 0 ? px[prev + x - ch] : 0;
      let v = raw[r];
      if (f === 1) v += a; else if (f === 2) v += up; else if (f === 3) v += (a + up) >> 1;
      else if (f === 4) { const q = a + up - c, pa = Math.abs(q - a), pb = Math.abs(q - up), pc = Math.abs(q - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? up : c; }
      px[cur + x] = v & 255;
    }
  }
  const rgb = new Uint8Array(w * h * 3);
  for (let i = 0; i < w * h; i++) {
    if (type === 2 || type === 6) { rgb[i * 3] = px[i * ch]; rgb[i * 3 + 1] = px[i * ch + 1]; rgb[i * 3 + 2] = px[i * ch + 2]; }
    else if (type === 3) { const k = px[i] * 3; rgb[i * 3] = pal[k]; rgb[i * 3 + 1] = pal[k + 1]; rgb[i * 3 + 2] = pal[k + 2]; }
    else { rgb[i * 3] = rgb[i * 3 + 1] = rgb[i * 3 + 2] = px[i * ch]; }
  }
  return { w, h, rgb };
}
