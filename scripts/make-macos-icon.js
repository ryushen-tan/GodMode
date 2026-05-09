#!/usr/bin/env node
// Generate a macOS-style version of godmodlogo.png:
//   - 1024x1024 canvas (Apple's app icon recommended size)
//   - logo padded to ~78% (matches Apple's icon grid)
//   - rounded-square mask (radius ~22.5% of canvas — Apple's squircle)
// Output: electron/icon.png (overwritten).

const path = require('path');
const fs = require('fs');
const sharp = require(path.join(__dirname, '..', 'electron', 'node_modules', 'sharp'));

const SIZE = 1024;
const ICON_SIZE = Math.round(SIZE * 0.78);   // 798 — logo content area
const RADIUS = Math.round(SIZE * 0.225);     // 230 — Apple-ish corner radius
const PAD = Math.round((SIZE - ICON_SIZE) / 2); // 113

const SRC = path.join(__dirname, '..', 'godmodlogo.png');
const OUT = path.join(__dirname, '..', 'electron', 'icon.png');

async function main() {
  if (!fs.existsSync(SRC)) {
    console.error(`source not found: ${SRC}`);
    process.exit(1);
  }

  // Resize the source logo to the inner content size
  const innerBuf = await sharp(SRC).resize(ICON_SIZE, ICON_SIZE, { fit: 'contain' }).toBuffer();

  // Build a rounded-square mask SVG
  const mask = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}">
       <rect x="0" y="0" width="${SIZE}" height="${SIZE}" rx="${RADIUS}" ry="${RADIUS}" fill="#ffffff"/>
     </svg>`
  );

  // Composite: dark background -> logo -> apply rounded mask via destination-in.
  const composed = await sharp({
    create: {
      width: SIZE,
      height: SIZE,
      channels: 4,
      background: { r: 18, g: 18, b: 24, alpha: 1 }, // matches the panel bg
    },
  })
    .composite([
      { input: innerBuf, top: PAD, left: PAD },
      { input: mask, blend: 'dest-in' },
    ])
    .png()
    .toBuffer();

  fs.writeFileSync(OUT, composed);
  console.log(`wrote ${OUT} (${composed.length} bytes, ${SIZE}x${SIZE}, radius ${RADIUS})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
