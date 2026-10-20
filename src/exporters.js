import { Zip, ZipDeflate, strToU8 } from './vendor/fflate.js';

function triNormal(pos, a, b, c, out) {
  const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
  const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
  let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const l = Math.hypot(nx, ny, nz) || 1;
  out[0] = nx / l; out[1] = ny / l; out[2] = nz / l;
}

export function toSTLBinary(pos, idx, name = 'Lumi') {
  const nt = idx.length / 3;
  const buf = new ArrayBuffer(84 + nt * 50);
  const dv = new DataView(buf);
  const header = strToU8(`Lumi lithophane - ${name}`.slice(0, 79));
  new Uint8Array(buf, 0, 80).set(header);
  dv.setUint32(80, nt, true);
  const n = [0, 0, 0];
  let o = 84;
  for (let t = 0; t < nt; t++) {
    const a = idx[t * 3] * 3, b = idx[t * 3 + 1] * 3, c = idx[t * 3 + 2] * 3;
    triNormal(pos, a, b, c, n);
    dv.setFloat32(o, n[0], true); dv.setFloat32(o + 4, n[1], true); dv.setFloat32(o + 8, n[2], true);
    o += 12;
    for (const v of [a, b, c]) {
      dv.setFloat32(o, pos[v], true); dv.setFloat32(o + 4, pos[v + 1], true); dv.setFloat32(o + 8, pos[v + 2], true);
      o += 12;
    }
    o += 2;
  }
  return new Uint8Array(buf);
}

function joinChunks(chunks) {
  let len = 0;
  for (const c of chunks) len += c.length;
  const out = new Uint8Array(len);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

const f = (x) => (Math.round(x * 10000) / 10000).toString();

export function toSTLAscii(pos, idx, name = 'Lumi') {
  const enc = new TextEncoder();
  const chunks = [enc.encode(`solid ${name}\n`)];
  const n = [0, 0, 0];
  let s = '';
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    triNormal(pos, a, b, c, n);
    s += ` facet normal ${n[0].toExponential(5)} ${n[1].toExponential(5)} ${n[2].toExponential(5)}\n  outer loop\n`;
    for (const v of [a, b, c]) s += `   vertex ${f(pos[v])} ${f(pos[v + 1])} ${f(pos[v + 2])}\n`;
    s += '  endloop\n endfacet\n';
    if (s.length > 1 << 20) { chunks.push(enc.encode(s)); s = ''; }
  }
  s += `endsolid ${name}\n`;
  chunks.push(enc.encode(s));
  return joinChunks(chunks);
}

export function toOBJ(pos, idx, name = 'Lumi') {
  const enc = new TextEncoder();
  const chunks = [enc.encode(`# Lumi lithophane\no ${name}\n`)];
  let s = '';
  for (let i = 0; i < pos.length; i += 3) {
    s += `v ${f(pos[i])} ${f(pos[i + 1])} ${f(pos[i + 2])}\n`;
    if (s.length > 1 << 20) { chunks.push(enc.encode(s)); s = ''; }
  }
  for (let t = 0; t < idx.length; t += 3) {
    s += `f ${idx[t] + 1} ${idx[t + 1] + 1} ${idx[t + 2] + 1}\n`;
    if (s.length > 1 << 20) { chunks.push(enc.encode(s)); s = ''; }
  }
  chunks.push(enc.encode(s));
  return joinChunks(chunks);
}

export function toPLY(pos, idx) {
  const nv = pos.length / 3, nt = idx.length / 3;
  const header = strToU8(
    `ply\nformat binary_little_endian 1.0\ncomment Lumi lithophane\nelement vertex ${nv}\nproperty float x\nproperty float y\nproperty float z\nelement face ${nt}\nproperty list uchar int vertex_indices\nend_header\n`
  );
  const buf = new Uint8Array(header.length + nv * 12 + nt * 13);
  buf.set(header);
  const dv = new DataView(buf.buffer);
  let o = header.length;
  for (let i = 0; i < pos.length; i++) { dv.setFloat32(o, pos[i], true); o += 4; }
  for (let t = 0; t < idx.length; t += 3) {
    dv.setUint8(o, 3); o++;
    dv.setInt32(o, idx[t], true); dv.setInt32(o + 4, idx[t + 1], true); dv.setInt32(o + 8, idx[t + 2], true);
    o += 12;
  }
  return buf;
}

// thumb: optional PNG bytes, stored as the package thumbnail (shown by Windows Explorer and slicers)
export function to3MF(pos, idx, name = 'Lumi', thumb = null) {
  const out = [];
  let err = null;
  const zip = new Zip((e, chunk) => { if (e) err = e; else out.push(chunk); });
  const add = (path, text) => {
    const file = new ZipDeflate(path, { level: 6 });
    zip.add(file);
    file.push(typeof text === 'string' ? strToU8(text) : text, true);
  };
  add('[Content_Types].xml',
    '<?xml version="1.0" encoding="UTF-8"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>' +
    (thumb ? '<Default Extension="png" ContentType="image/png"/>' : '') + '</Types>');
  add('_rels/.rels',
    '<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>' +
    (thumb ? '<Relationship Target="/Metadata/thumbnail.png" Id="rel1" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/thumbnail"/>' : '') +
    '</Relationships>');
  if (thumb) add('Metadata/thumbnail.png', thumb);

  const model = new ZipDeflate('3D/3dmodel.model', { level: 6 });
  zip.add(model);
  const esc = (t) => t.replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
  let s = '<?xml version="1.0" encoding="UTF-8"?>\n<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">\n' +
    `<metadata name="Title">${esc(name)}</metadata>\n<metadata name="Application">Lumi</metadata>\n` +
    `<resources>\n<object id="1" name="${esc(name)}" type="model">\n<mesh>\n<vertices>\n`;
  for (let i = 0; i < pos.length; i += 3) {
    s += `<vertex x="${f(pos[i])}" y="${f(pos[i + 1])}" z="${f(pos[i + 2])}"/>\n`;
    if (s.length > 1 << 20) { model.push(strToU8(s)); s = ''; }
  }
  s += '</vertices>\n<triangles>\n';
  for (let t = 0; t < idx.length; t += 3) {
    s += `<triangle v1="${idx[t]}" v2="${idx[t + 1]}" v3="${idx[t + 2]}"/>\n`;
    if (s.length > 1 << 20) { model.push(strToU8(s)); s = ''; }
  }
  s += '</triangles>\n</mesh>\n</object>\n</resources>\n<build>\n<item objectid="1"/>\n</build>\n</model>\n';
  model.push(strToU8(s), true);
  zip.end();
  if (err) throw err;
  return joinChunks(out);
}

export const FORMATS = {
  stl: { label: 'STL (binary)', ext: 'stl', fn: toSTLBinary },
  '3mf': { label: '3MF', ext: '3mf', fn: to3MF },
  obj: { label: 'OBJ', ext: 'obj', fn: toOBJ },
  ply: { label: 'PLY (binary)', ext: 'ply', fn: toPLY },
  'stl-ascii': { label: 'STL (ASCII)', ext: 'stl', fn: toSTLAscii },
};
