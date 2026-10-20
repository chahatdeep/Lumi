// Generates build/icon.png (512x512): a warm glowing tile with a happy little light face.
const fs = require('fs');
const zlib = require('zlib');
const path = require('path');

const S = 512, SS = 3; // supersampling
const img = new Float32Array(S * S * 4);

function sdRoundRect(x, y, cx, cy, hw, hh, r) {
  const qx = Math.abs(x - cx) - (hw - r), qy = Math.abs(y - cy) - (hh - r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}
const mix = (a, b, t) => a + (b - a) * t;
const sm = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

function shade(x, y) {
  // background tile
  const d = sdRoundRect(x, y, 256, 256, 232, 232, 110);
  if (d > 0) return [0, 0, 0, 0];
  // warm diagonal gradient
  const t = (x + y) / 1024;
  let r = mix(255, 255, t), g = mix(176, 104, t), b = mix(72, 92, t);
  // inner glow centred on the face
  const dc = Math.hypot(x - 256, y - 246);
  const glow = Math.exp(-((dc / 190) ** 2));
  r = mix(r, 255, glow * 0.85); g = mix(g, 244, glow * 0.85); b = mix(b, 214, glow * 0.85);
  // face disc
  const face = 132;
  if (dc < face) {
    const k = sm(face, face - 3, dc);
    const fr = 255, fg = 252, fb = 240;
    r = mix(r, fr, k); g = mix(g, fg, k); b = mix(b, fb, k);
  }
  // eyes
  const ink = [92, 52, 72];
  for (const ex of [208, 304]) {
    const de = Math.hypot((x - ex) / 1, (y - 228) / 1.25);
    if (de < 17) { const k = sm(17, 15, de); r = mix(r, ink[0], k); g = mix(g, ink[1], k); b = mix(b, ink[2], k); }
    // eye sparkle
    const ds = Math.hypot(x - ex + 5, y - 221);
    if (ds < 5) { const k = sm(5, 3.5, ds); r = mix(r, 255, k); g = mix(g, 255, k); b = mix(b, 255, k); }
  }
  // smile: arc
  const sx = x - 256, sy = y - 262;
  const rad = Math.hypot(sx, sy), ang = Math.atan2(sy, sx);
  if (ang > 0.35 && ang < Math.PI - 0.35) {
    const dd = Math.abs(rad - 44);
    if (dd < 8) { const k = sm(8, 6, dd); r = mix(r, ink[0], k); g = mix(g, ink[1], k); b = mix(b, ink[2], k); }
  }
  // cheeks
  for (const cx of [180, 332]) {
    const dk = Math.hypot((x - cx) / 1.5, y - 278);
    if (dk < 15) { const k = sm(15, 8, dk) * 0.55; r = mix(r, 255, k); g = mix(g, 128, k); b = mix(b, 128, k); }
  }
  // edge antialias
  const a = sm(0, -1.5, d);
  return [r, g, b, a];
}

for (let y = 0; y < S; y++) {
  for (let x = 0; x < S; x++) {
    let acc = [0, 0, 0, 0];
    for (let j = 0; j < SS; j++) for (let i = 0; i < SS; i++) {
      const c = shade(x + (i + 0.5) / SS, y + (j + 0.5) / SS);
      acc[0] += c[0] * c[3]; acc[1] += c[1] * c[3]; acc[2] += c[2] * c[3]; acc[3] += c[3];
    }
    const o = (y * S + x) * 4, n = SS * SS;
    const a = acc[3] / n;
    img[o] = a ? acc[0] / acc[3] : 0; img[o + 1] = a ? acc[1] / acc[3] : 0; img[o + 2] = a ? acc[2] / acc[3] : 0; img[o + 3] = a * 255;
  }
}

// PNG encode
const raw = Buffer.alloc(S * (S * 4 + 1));
for (let y = 0; y < S; y++) {
  raw[y * (S * 4 + 1)] = 0;
  for (let x = 0; x < S * 4; x++) raw[y * (S * 4 + 1) + 1 + x] = Math.max(0, Math.min(255, Math.round(img[y * S * 4 + x])));
}
const crcTable = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
const crc = (buf) => { let c = -1; for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, c]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(S, 0); ihdr.writeUInt32BE(S, 4); ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
fs.writeFileSync(path.join(__dirname, 'icon.png'), png);
console.log('icon.png written', png.length, 'bytes');
