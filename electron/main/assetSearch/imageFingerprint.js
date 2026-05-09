const crypto = require("crypto");

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

// Very small, fast perceptual hash (aHash) for near-duplicate matching.
// Good enough for "whole sprite match" and easy to implement.
function ahashFromRgba({ rgba, width, height }) {
  // downsample assumed already to 8x8; rgba length = 8*8*4
  const n = width * height;
  const grays = new Array(n);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const r = rgba[i * 4 + 0];
    const g = rgba[i * 4 + 1];
    const b = rgba[i * 4 + 2];
    const gray = (r * 0.299 + g * 0.587 + b * 0.114) | 0;
    grays[i] = gray;
    sum += gray;
  }
  const avg = sum / n;
  let bits = "";
  for (let i = 0; i < n; i++) bits += grays[i] >= avg ? "1" : "0";

  // bits -> 16 hex chars (64 bits)
  let hex = "";
  for (let i = 0; i < 64; i += 4) {
    hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
  }
  return hex;
}

function hammingDistanceHex(a, b) {
  if (a.length !== b.length) throw new Error("hammingDistanceHex: length mismatch");
  let dist = 0;
  for (let i = 0; i < a.length; i++) {
    const x = parseInt(a[i], 16) ^ parseInt(b[i], 16);
    dist += [0, 1, 1, 2, 1, 2, 2, 3, 1, 2, 2, 3, 2, 3, 3, 4][x];
  }
  return dist;
}

module.exports = { sha256, ahashFromRgba, hammingDistanceHex };
