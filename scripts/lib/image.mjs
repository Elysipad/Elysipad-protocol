// Pixel utilities: decode PNG/JPEG, inspect, crop, premultiplied area resize, encode PNG.
import fs from 'node:fs';
import { PNG } from 'pngjs';
import jpeg from 'jpeg-js';

export function readImage(file) {
  const buf = fs.readFileSync(file);
  if (buf[0] === 0x89 && buf[1] === 0x50) {
    const png = PNG.sync.read(buf);
    const colorType = buf.readUInt8(25);
    return { width: png.width, height: png.height, data: png.data, kind: 'png', colorType, bitDepth: buf.readUInt8(24) };
  }
  const j = jpeg.decode(buf, { useTArray: true, formatAsRGBA: true });
  return { width: j.width, height: j.height, data: j.data, kind: 'jpeg' };
}

export function pixelHex(img, x, y) {
  const i = (y * img.width + x) * 4;
  return '#' + [0, 1, 2].map((k) => img.data[i + k].toString(16).padStart(2, '0')).join('');
}

// Alpha histogram and the share of fully transparent pixels whose RGB is pure black.
export function alphaReport(img) {
  const hist = new Uint32Array(256);
  let zero = 0, zeroBlack = 0;
  for (let i = 0; i < img.data.length; i += 4) {
    const a = img.data[i + 3];
    hist[a]++;
    if (a === 0) { zero++; if (img.data[i] + img.data[i + 1] + img.data[i + 2] === 0) zeroBlack++; }
  }
  return { hist, zero, zeroBlack, pureBlackTransparent: zero > 0 && zeroBlack === zero };
}

export function bbox(img, alphaMin = 8) {
  let x0 = img.width, y0 = img.height, x1 = -1, y1 = -1;
  for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) {
    if (img.data[(y * img.width + x) * 4 + 3] > alphaMin) {
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
  }
  return { x0, y0, x1, y1 };
}

export function cropSquare(img, box, pad = 0.08) {
  const cx = (box.x0 + box.x1 + 1) / 2, cy = (box.y0 + box.y1 + 1) / 2;
  const side = Math.min(img.width, img.height, Math.ceil(Math.max(box.x1 - box.x0 + 1, box.y1 - box.y0 + 1) * (1 + pad * 2)));
  const sx = Math.max(0, Math.min(img.width - side, Math.round(cx - side / 2)));
  const sy = Math.max(0, Math.min(img.height - side, Math.round(cy - side / 2)));
  const out = new Uint8ClampedArray(side * side * 4);
  for (let y = 0; y < side; y++) {
    const s = ((sy + y) * img.width + sx) * 4;
    out.set(img.data.subarray(s, s + side * 4), y * side * 4);
  }
  return { width: side, height: side, data: out };
}

function axisWeights(srcN, dstN) {
  const scale = srcN / dstN;
  const rows = [];
  for (let d = 0; d < dstN; d++) {
    const a = d * scale, b = (d + 1) * scale;
    const i0 = Math.floor(a), i1 = Math.min(srcN - 1, Math.ceil(b) - 1);
    const w = [];
    for (let i = i0; i <= i1; i++) w.push([i, Math.max(0, Math.min(b, i + 1) - Math.max(a, i)) / scale]);
    rows.push(w);
  }
  return rows;
}

// Area-average resize. premultiplied=true averages colour weighted by alpha (required when
// transparent pixels carry black RGB, which would otherwise darken every soft edge).
export function resize(img, dw, dh, premultiplied) {
  const { width: sw, height: sh, data } = img;
  const src = new Float32Array(sw * sh * 4);
  for (let i = 0; i < sw * sh; i++) {
    const a = data[i * 4 + 3] / 255;
    const m = premultiplied ? a : 1;
    src[i * 4] = data[i * 4] * m; src[i * 4 + 1] = data[i * 4 + 1] * m; src[i * 4 + 2] = data[i * 4 + 2] * m; src[i * 4 + 3] = a;
  }
  const wx = axisWeights(sw, dw), wy = axisWeights(sh, dh);
  const tmp = new Float32Array(dw * sh * 4);
  for (let y = 0; y < sh; y++) for (let x = 0; x < dw; x++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (const [i, w] of wx[x]) { const o = (y * sw + i) * 4; r += src[o] * w; g += src[o + 1] * w; b += src[o + 2] * w; a += src[o + 3] * w; }
    const o = (y * dw + x) * 4; tmp[o] = r; tmp[o + 1] = g; tmp[o + 2] = b; tmp[o + 3] = a;
  }
  const out = new Uint8ClampedArray(dw * dh * 4);
  for (let y = 0; y < dh; y++) for (let x = 0; x < dw; x++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (const [j, w] of wy[y]) { const o = (j * dw + x) * 4; r += tmp[o] * w; g += tmp[o + 1] * w; b += tmp[o + 2] * w; a += tmp[o + 3] * w; }
    const o = (y * dw + x) * 4;
    const k = premultiplied ? (a > 1e-6 ? 1 / a : 0) : 1;
    out[o] = r * k; out[o + 1] = g * k; out[o + 2] = b * k; out[o + 3] = a * 255;
  }
  return { width: dw, height: dh, data: out };
}

export function encodePng(img) {
  const png = new PNG({ width: img.width, height: img.height });
  png.data = Buffer.from(img.data.buffer, img.data.byteOffset, img.data.length);
  return PNG.sync.write(png);
}

export function hexToRgb(h) { return [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)); }
