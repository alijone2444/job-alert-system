/**
 * Generate the Android launcher icons.
 *
 * WHY hand-rolled instead of a generator package: the icon is concentric
 * circles and a dot. Pulling in sharp/canvas (native builds, ~40MB) to draw
 * three circles is not a trade worth making, and this way the icon is
 * reproducible from source with `node scripts/generate-icons.mjs` — no binary
 * assets checked in that nobody can regenerate.
 *
 * PNGs are written with Node's built-in zlib. Android 8+ uses the adaptive
 * vector icon (mipmap-anydpi-v26); these rasters cover Android 7 (minSdk 24).
 *
 *   node scripts/generate-icons.mjs
 */

import { deflateSync } from 'zlib';
import { writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const here = dirname(fileURLToPath(import.meta.url));
const resDir = resolve(here, '../android/app/src/main/res');

/* --------------------------------- design --------------------------------- */
// A target: "jobs aimed at you". Same mark as the "For you" tab icon, so the
// launcher and the app agree about what this thing is.

const BRAND = [37, 99, 235]; // colors.primary — #2563EB
const WHITE = [255, 255, 255];

const DENSITIES = [
  { dir: 'mipmap-mdpi', size: 48 },
  { dir: 'mipmap-hdpi', size: 72 },
  { dir: 'mipmap-xhdpi', size: 96 },
  { dir: 'mipmap-xxhdpi', size: 144 },
  { dir: 'mipmap-xxxhdpi', size: 192 },
];

/** Supersampling factor — cheap anti-aliasing. */
const SS = 4;

/**
 * Draw the icon into an RGBA buffer.
 * @param {number} size final pixel size
 * @param {'square'|'circle'} shape outer mask
 */
function render(size, shape) {
  const s = size * SS;
  const acc = new Float64Array(size * size * 4);

  const cx = s / 2;
  const cy = s / 2;
  const radius = s / 2;
  const corner = s * 0.22; // rounded-square radius

  // Ring geometry, as fractions of the icon size.
  const ringOuter = s * 0.34;
  const ringOuterInner = s * 0.27;
  const ringMid = s * 0.2;
  const ringMidInner = s * 0.13;
  const dot = s * 0.065;

  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.hypot(dx, dy);

      let inside;
      if (shape === 'circle') {
        inside = dist <= radius;
      } else {
        // Rounded square: inside if within the inset rect, or within a corner arc.
        const ax = Math.abs(dx);
        const ay = Math.abs(dy);
        const limit = s / 2;
        const flat = limit - corner;
        inside =
          ax <= limit &&
          ay <= limit &&
          (ax <= flat || ay <= flat || Math.hypot(ax - flat, ay - flat) <= corner);
      }

      if (!inside) continue;

      let color = BRAND;
      const inOuterRing = dist <= ringOuter && dist >= ringOuterInner;
      const inMidRing = dist <= ringMid && dist >= ringMidInner;
      const inDot = dist <= dot;
      if (inOuterRing || inMidRing || inDot) color = WHITE;

      const px = Math.floor(x / SS);
      const py = Math.floor(y / SS);
      const at = (py * size + px) * 4;
      acc[at] += color[0];
      acc[at + 1] += color[1];
      acc[at + 2] += color[2];
      acc[at + 3] += 255;
    }
  }

  const samples = SS * SS;
  const out = Buffer.alloc(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    const alpha = acc[i * 4 + 3] / samples;
    // Un-premultiply so partially covered edge pixels keep their colour.
    const weight = acc[i * 4 + 3] || 1;
    out[i * 4] = Math.round((acc[i * 4] / weight) * 255);
    out[i * 4 + 1] = Math.round((acc[i * 4 + 1] / weight) * 255);
    out[i * 4 + 2] = Math.round((acc[i * 4 + 2] / weight) * 255);
    out[i * 4 + 3] = Math.round(alpha);
  }
  return out;
}

/* ----------------------------- PNG encoding ------------------------------- */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function encodePng(rgba, size) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  // 10,11,12 = compression, filter, interlace — all 0

  // One filter byte (0 = none) per scanline.
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* --------------------------------- write ---------------------------------- */

for (const { dir, size } of DENSITIES) {
  const target = resolve(resDir, dir);
  mkdirSync(target, { recursive: true });

  writeFileSync(resolve(target, 'ic_launcher.png'), encodePng(render(size, 'square'), size));
  writeFileSync(resolve(target, 'ic_launcher_round.png'), encodePng(render(size, 'circle'), size));
  console.log(`  ${dir.padEnd(16)} ${size}x${size}`);
}

/* ------------------------- adaptive icon (API 26+) ------------------------ */
// The foreground must sit inside the central 72dp of a 108dp canvas — outside
// that, the launcher's mask can crop it.

const foreground = `<?xml version="1.0" encoding="utf-8"?>
<!-- Generated by scripts/generate-icons.mjs — edit the script, not this file. -->
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="108dp"
    android:height="108dp"
    android:viewportWidth="108"
    android:viewportHeight="108">
    <!-- outer ring -->
    <path
        android:fillColor="#FFFFFF"
        android:pathData="M54,54m-36.7,0a36.7,36.7 0,1 1,73.4 0a36.7,36.7 0,1 1,-73.4 0zM54,54m-29.2,0a29.2,29.2 0,1 0,58.4 0a29.2,29.2 0,1 0,-58.4 0z" />
    <!-- inner ring -->
    <path
        android:fillColor="#FFFFFF"
        android:pathData="M54,54m-21.6,0a21.6,21.6 0,1 1,43.2 0a21.6,21.6 0,1 1,-43.2 0zM54,54m-14,0a14,14 0,1 0,28 0a14,14 0,1 0,-28 0z" />
    <!-- centre -->
    <path
        android:fillColor="#FFFFFF"
        android:pathData="M54,54m-7,0a7,7 0,1 1,14 0a7,7 0,1 1,-14 0z" />
</vector>
`;

const launcherXml = `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/ic_launcher_background" />
    <foreground android:drawable="@drawable/ic_launcher_foreground" />
    <monochrome android:drawable="@drawable/ic_launcher_foreground" />
</adaptive-icon>
`;

const colorsXml = `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <!-- theme/index.ts colors.primary -->
    <color name="ic_launcher_background">#2563EB</color>
</resources>
`;

mkdirSync(resolve(resDir, 'drawable'), { recursive: true });
mkdirSync(resolve(resDir, 'mipmap-anydpi-v26'), { recursive: true });
mkdirSync(resolve(resDir, 'values'), { recursive: true });

writeFileSync(resolve(resDir, 'drawable/ic_launcher_foreground.xml'), foreground);
writeFileSync(resolve(resDir, 'mipmap-anydpi-v26/ic_launcher.xml'), launcherXml);
writeFileSync(resolve(resDir, 'mipmap-anydpi-v26/ic_launcher_round.xml'), launcherXml);
writeFileSync(resolve(resDir, 'values/ic_launcher_background.xml'), colorsXml);

console.log('  adaptive icon (API 26+) + monochrome (themed icons)');
console.log('Done.');
