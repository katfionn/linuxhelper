#!/usr/bin/env node
/**
 * 生成应用图标 build/icon.png（1024×1024，无第三方依赖）。
 * 纯 Node 光栅化：圆角底板 + 渐变光晕 + 终端提示符 ">_"。
 * 用法：npm run icon
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SIZE = 1024;
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'build', 'icon.png');

const rgba = Buffer.alloc(SIZE * SIZE * 4); // 透明起始

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (edge, d) => clamp01(0.5 - d / edge); // d>0 在形状外
const mix = (a, b, t) => a + (b - a) * t;

function blend(x, y, r, g, b, a) {
  if (a <= 0) return;
  const i = (y * SIZE + x) * 4;
  const dstA = rgba[i + 3] / 255;
  const outA = a + dstA * (1 - a);
  if (outA <= 0) return;
  rgba[i] = Math.round((r * a + rgba[i] * dstA * (1 - a)) / outA);
  rgba[i + 1] = Math.round((g * a + rgba[i + 1] * dstA * (1 - a)) / outA);
  rgba[i + 2] = Math.round((b * a + rgba[i + 2] * dstA * (1 - a)) / outA);
  rgba[i + 3] = Math.round(outA * 255);
}

function hex(c) {
  return [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
}

/** 圆角矩形的有符号距离（内部为负） */
function sdRoundRect(x, y, cx, cy, hw, hh, r) {
  const qx = Math.abs(x - cx) - (hw - r);
  const qy = Math.abs(y - cy) - (hh - r);
  const ax = Math.max(qx, 0);
  const ay = Math.max(qy, 0);
  return Math.hypot(ax, ay) + Math.min(Math.max(qx, qy), 0) - r;
}

/** 线段（圆头）有符号距离 */
function sdSegment(x, y, ax, ay, bx, by, r) {
  const pax = x - ax;
  const pay = y - ay;
  const bax = bx - ax;
  const bay = by - ay;
  const t = clamp01((pax * bax + pay * bay) / (bax * bax + bay * bay));
  return Math.hypot(pax - bax * t, pay - bay * t) - r;
}

const BG_TOP = hex('#101f2b');
const BG_BOTTOM = hex('#070c12');
const ACCENT = hex('#5eead4');
const ACCENT2 = hex('#a78bfa');

const CENTER = SIZE / 2;
const PAD = 54;
const HW = SIZE / 2 - PAD;

for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    // 底板
    const dPlate = sdRoundRect(x, y, CENTER, CENTER, HW, HW, 210);
    const plateA = smooth(1.6, dPlate);
    if (plateA <= 0) continue;

    const t = y / SIZE;
    let r = mix(BG_TOP[0], BG_BOTTOM[0], t);
    let g = mix(BG_TOP[1], BG_BOTTOM[1], t);
    let b = mix(BG_TOP[2], BG_BOTTOM[2], t);

    // 左右上角的柔光
    const glow1 = Math.exp(-(((x - 300) ** 2 + (y - 250) ** 2) / (2 * 260 ** 2)));
    const glow2 = Math.exp(-(((x - 780) ** 2 + (y - 830) ** 2) / (2 * 300 ** 2)));
    r = mix(r, ACCENT[0], glow1 * 0.16);
    g = mix(g, ACCENT[1], glow1 * 0.16);
    b = mix(b, ACCENT[2], glow1 * 0.16);
    r = mix(r, ACCENT2[0], glow2 * 0.2);
    g = mix(g, ACCENT2[1], glow2 * 0.2);
    b = mix(b, ACCENT2[2], glow2 * 0.2);

    // 边框高光
    const border = smooth(2.2, Math.abs(dPlate + 1.4) - 1.4);
    r = mix(r, 255, border * 0.1);
    g = mix(g, 255, border * 0.12);
    b = mix(b, 255, border * 0.14);

    blend(x, y, r, g, b, plateA);

    // 提示符 ">"
    const dChevron =
      Math.min(
        sdSegment(x, y, 330, 336, 520, 512, 34),
        sdSegment(x, y, 520, 512, 330, 688, 34)
      ) - 2;
    const chevA = smooth(1.6, dChevron);
    if (chevA > 0) blend(x, y, 245, 250, 255, chevA);

    // 下划线 "_"
    const dBar = sdSegment(x, y, 566, 676, 716, 676, 34) - 2;
    const barA = smooth(1.6, dBar);
    if (barA > 0) blend(x, y, ACCENT[0], ACCENT[1], ACCENT[2], barA);

    // 右上角小圆点
    const dDot = Math.hypot(x - 716, y - 330) - 26;
    const dotA = smooth(1.6, dDot);
    if (dotA > 0) blend(x, y, ACCENT2[0], ACCENT2[1], ACCENT2[2], dotA);
  }
}

/* --------------------------------- PNG --------------------------------- */
const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // RGBA
ihdr[10] = 0;
ihdr[11] = 0;
ihdr[12] = 0;

const raw = Buffer.alloc((SIZE * 4 + 1) * SIZE);
for (let y = 0; y < SIZE; y++) {
  raw[y * (SIZE * 4 + 1)] = 0; // filter none
  rgba.copy(raw, y * (SIZE * 4 + 1) + 1, y * SIZE * 4, (y + 1) * SIZE * 4);
}

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0))
]);

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, png);
console.log(`icon written: ${OUT} (${(png.length / 1024).toFixed(1)} KB)`);