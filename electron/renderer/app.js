import {
  exportCanvasToFile,
  uploadImage,
  generate2D,
  BackendThreeDProvider,
  pollThreeDGeneration,
} from './services.bundle.js';

const BACKEND_URL = 'http://localhost:3001';

const addButton       = document.getElementById('add-button');
const panel           = document.getElementById('panel');
const statusDot       = document.getElementById('status-dot');
const promptInput     = document.getElementById('prompt-input');
const submitBtn       = document.getElementById('submit-prompt-btn');
const submitLabel     = document.getElementById('submit-label');
const agentLog        = document.getElementById('agent-log');
const agentSteps      = document.getElementById('agent-steps');
const agentResult     = document.getElementById('agent-result');
const closePanelBtn = document.getElementById('close-panel-btn');
const canvas = document.getElementById('sketch-canvas');
const ctx = canvas.getContext('2d');

const penTool = document.getElementById('pen-tool');
const eraserTool = document.getElementById('eraser-tool');
const colorPicker = document.getElementById('color-picker');
const brushSize = document.getElementById('brush-size');
const brushSizeValue = document.getElementById('brush-size-value');
const clearCanvas = document.getElementById('clear-canvas');
const uploadBtn = document.getElementById('upload-btn');
const fileInput = document.getElementById('file-input');
const fileName = document.getElementById('file-name');
const matchResult = document.getElementById('match-result');

async function searchFromBase64DataUrl(dataUrl) {
  const base64 = String(dataUrl).split(',')[1] || '';
  if (!base64) return;
  if (matchResult) matchResult.textContent = 'Searching...';
  const res = await window.electronAPI.searchAsset({ imageBase64: base64 });
  if (!matchResult) return;
  if (res && res.match && res.match.path) {
    matchResult.textContent = `Match (${res.method}): ${res.match.path}`;
    // Note: auto-select intentionally removed — the search may match a
    // similar-shaped sprite even when the user's photo is visually
    // different (e.g. their green bottle vs the cream Khronos WaterBottle).
    // Force user to consciously pick the base sprite they want to merge into.
  } else {
    matchResult.textContent = 'No match found.';
  }
}

let isDrawing = false;
let currentTool = 'pen';
let currentColor = '#000000';
let currentBrushSize = 8;
let lastX = 0;
let lastY = 0;

ctx.lineCap = 'round';
ctx.lineJoin = 'round';

function setPassthrough(enable) {
  if (window.electronAPI && window.electronAPI.setIgnoreMouseEvents) {
    window.electronAPI.setIgnoreMouseEvents(enable, { forward: true });
  }
}

// Block clicks when hovering over button, panel, or floating log, pass through otherwise
[addButton, panel, agentLog].forEach((el) => {
  el.addEventListener('mouseenter', () => setPassthrough(false));
  el.addEventListener('mouseleave', () => setPassthrough(true));
});

function togglePanel() {
  panel.classList.toggle('visible');
}

addButton.addEventListener('click', togglePanel);
closePanelBtn.addEventListener('click', togglePanel);

if (window.electronAPI) {
  window.electronAPI.onClosePanel(() => {
    if (panel.classList.contains('visible')) togglePanel();
  });

  window.electronAPI.onGodotStatus((status) => {
    statusDot.className = `status-dot ${status}`;
  });

  window.electronAPI.onAgentStep((step) => {
    agentLog.style.display = 'block';
    const el = document.createElement('div');
    el.className = 'step-item';
    
    if (step.type === 'tool_call') {
      const argsStr = Object.entries(step.args || {})
        .map(([k, v]) => `${k}=${JSON.stringify(String(v).slice(0, 60))}`)
        .join(', ');
      el.innerHTML = `<span class="step-tool">${step.tool}</span>(${argsStr})`;
    } else if (step.type === 'tool_result') {
      const preview = String(step.output || '').slice(0, 100).replace(/\n/g, ' ');
      el.innerHTML = `<span class="step-result">→ ${preview}${step.output?.length > 100 ? '…' : ''}</span>`;
    } else if (step.type === 'thinking') {
      el.className = 'step-item thinking';
      el.innerHTML = `<span class="step-thinking">💭 ${step.text}</span>`;
    } else if (step.type === 'error') {
      el.className = 'step-item error';
      el.innerHTML = `<span class="step-error">⚠️ ${step.text}</span>`;
    }
    
    agentSteps.appendChild(el);
    agentLog.scrollTop = agentLog.scrollHeight;
  });

}

submitBtn.addEventListener('click', async () => {
  const prompt = promptInput.value.trim();
  if (!prompt) return;

  // Reset UI
  agentLog.style.display = 'none';
  agentSteps.innerHTML = '';
  agentResult.style.display = 'none';
  agentResult.className = 'agent-result';

  submitBtn.disabled = true;
  submitLabel.textContent = 'Running…';

  try {
    const result = await window.electronAPI.sendPrompt(prompt);

    agentResult.style.display = 'block';
    let html = `<strong>Done:</strong> ${result.content}`;
    if (result.filesChanged && result.filesChanged.length > 0) {
      html += `<div class="files-changed">Files modified:<br>${result.filesChanged.map(f => `• ${f}`).join('<br>')}</div>`;
    }
    agentResult.innerHTML = html;
  } catch (err) {
    agentResult.style.display = 'block';
    agentResult.className = 'agent-result error';
    agentResult.textContent = `Error: ${err.message}`;
  } finally {
    agentLog.style.display = 'none';
    submitBtn.disabled = false;
    submitLabel.textContent = 'Run Agent';
  }
});

penTool.addEventListener('click', () => {
  currentTool = 'pen';
  penTool.classList.add('active');
  eraserTool.classList.remove('active');
});

eraserTool.addEventListener('click', () => {
  currentTool = 'eraser';
  eraserTool.classList.add('active');
  penTool.classList.remove('active');
});

colorPicker.addEventListener('input', (e) => {
  currentColor = e.target.value;
});

brushSize.addEventListener('input', (e) => {
  currentBrushSize = e.target.value;
  brushSizeValue.textContent = currentBrushSize;
});

clearCanvas.addEventListener('click', () => {
  if (!confirm('Clear your drawings?')) return;
  ctx.globalCompositeOperation = 'source-over';
  if (baseImageData) {
    // Restore the uploaded photo as it was, removing only the strokes.
    ctx.putImageData(baseImageData, 0, 0);
  } else {
    // No upload — wipe to solid white.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    fileName.textContent = '';
  }
});

uploadBtn.addEventListener('click', () => {
  // Reset value so picking the SAME file again still fires the change event.
  fileInput.value = '';
  fileInput.click();
});

// Paste image from clipboard (Cmd/Ctrl+V)
document.addEventListener('paste', async (e) => {
  try {
    const items = e.clipboardData?.items;
    if (!items) return;
    const imageItem = Array.from(items).find((it) => it.type && it.type.startsWith('image/'));
    if (!imageItem) return;

    const file = imageItem.getAsFile();
    if (!file) return;

    if (matchResult) matchResult.textContent = 'Pasted image. Searching...';

    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const dataUrl = evt.target.result;

        // Draw to canvas for visibility
        const img = new Image();
        img.onload = () => {
          const scale = Math.min(canvas.width / img.width, canvas.height / img.height);
          const x = (canvas.width - img.width * scale) / 2;
          const y = (canvas.height - img.height * scale) / 2;
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(img, x, y, img.width * scale, img.height * scale);
        };
        img.src = dataUrl;

        await searchFromBase64DataUrl(dataUrl);
      } catch (err) {
        if (matchResult) matchResult.textContent = `Paste search error: ${err.message || String(err)}`;
      }
    };
    reader.readAsDataURL(file);
  } catch (err) {
    if (matchResult) matchResult.textContent = `Paste error: ${err.message || String(err)}`;
  }
});

// Most recent base image drawn to the canvas (used to compute inpaint mask).
let baseImageData = null;

fileInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (file) {
    fileName.textContent = file.name;

    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(canvas.width / img.width, canvas.height / img.height);
        const x = (canvas.width - img.width * scale) / 2;
        const y = (canvas.height - img.height * scale) / 2;

        // Reset compositing in case the eraser was last used
        ctx.globalCompositeOperation = 'source-over';
        // Solid white background so areas outside the image aren't transparent
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, x, y, img.width * scale, img.height * scale);
        // Snapshot the canvas exactly as the upload landed; this is what
        // we feed to inpaint as the unmodified base image.
        baseImageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      };
      img.src = event.target.result;
    };
    reader.readAsDataURL(file);

    // Also try matching this upload against the local DB.
    const base64Reader = new FileReader();
    base64Reader.onload = async (evt) => {
      try {
        await searchFromBase64DataUrl(evt.target.result);
      } catch (err) {
        if (matchResult) matchResult.textContent = `Search error: ${err.message || String(err)}`;
      }
    };
    base64Reader.readAsDataURL(file);
  }
});

function getCanvasCoords(e) {
  const rect = canvas.getBoundingClientRect();
  // Map display-space mouse coords to canvas-buffer coords.
  // Necessary because CSS scales the canvas (width:100%) while the
  // internal buffer is fixed at canvas.width x canvas.height.
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  return {
    x: (e.clientX - rect.left) * scaleX,
    y: (e.clientY - rect.top) * scaleY,
  };
}

function startDrawing(e) {
  isDrawing = true;
  const p = getCanvasCoords(e);
  lastX = p.x;
  lastY = p.y;
}

function draw(e) {
  if (!isDrawing) return;
  const { x, y } = getCanvasCoords(e);
  
  ctx.beginPath();
  ctx.moveTo(lastX, lastY);
  ctx.lineTo(x, y);
  
  if (currentTool === 'pen') {
    ctx.strokeStyle = currentColor;
    ctx.lineWidth = currentBrushSize;
    ctx.globalCompositeOperation = 'source-over';
  } else if (currentTool === 'eraser') {
    ctx.strokeStyle = 'white';
    ctx.lineWidth = currentBrushSize * 3;
    ctx.globalCompositeOperation = 'destination-out';
  }
  
  ctx.stroke();
  
  lastX = x;
  lastY = y;
}

function stopDrawing() {
  isDrawing = false;
  ctx.globalCompositeOperation = 'source-over';
}

canvas.addEventListener('mousedown', startDrawing);
canvas.addEventListener('mousemove', draw);
canvas.addEventListener('mouseup', stopDrawing);
canvas.addEventListener('mouseleave', stopDrawing);

document.addEventListener('click', (e) => {
  if (panel.classList.contains('visible') &&
      !panel.contains(e.target) &&
      !addButton.contains(e.target)) {
    togglePanel();
  }
});

// ---- Generate pipeline (split into 2D and 3D stages) ----
const generate2dBtn = document.getElementById('generate-2d-btn');
const generate3dBtn = document.getElementById('generate-3d-btn');
const resultBox = document.getElementById('generate-result');
const resultPreview = document.getElementById('result-preview');
const resultProgressFill = document.getElementById('result-progress-fill');
const resultStatus = document.getElementById('result-status');
const resultLog = document.getElementById('result-log');
const resultModel = document.getElementById('result-model');
const spriteSelect = document.getElementById('sprite-select');
const providerSelect = document.getElementById('provider-select');
const captureViewer = document.getElementById('capture-viewer');

// Render a base sprite GLB to a PNG Blob using the hidden model-viewer.
// Resolves once the model is loaded and at least one frame has been drawn.
async function captureSpriteAsBlob(spriteName) {
  if (!spriteName || !captureViewer) return null;
  const url = `${BACKEND_URL}/sprites/${encodeURIComponent(spriteName)}`;
  await new Promise((resolve, reject) => {
    let done = false;
    const onLoad = () => {
      if (done) return;
      done = true;
      captureViewer.removeEventListener('load', onLoad);
      captureViewer.removeEventListener('error', onError);
      // Give the renderer a moment to draw the first frame before screenshot.
      setTimeout(resolve, 200);
    };
    const onError = (err) => {
      if (done) return;
      done = true;
      captureViewer.removeEventListener('load', onLoad);
      captureViewer.removeEventListener('error', onError);
      reject(err);
    };
    captureViewer.addEventListener('load', onLoad);
    captureViewer.addEventListener('error', onError);
    captureViewer.src = url;
  });
  return await captureViewer.toBlob({ mimeType: 'image/png', idealAspect: true });
}

// When the user picks a sprite, render it onto the main canvas as the
// working image so Generate 2D / 3D operate on a faithful view of the
// chosen GLB instead of an unrelated photo.
spriteSelect.addEventListener('change', async () => {
  const spriteName = spriteSelect.value;
  if (!spriteName) return;
  try {
    if (matchResult) matchResult.textContent = `Loading render of ${spriteName}…`;
    const blob = await captureSpriteAsBlob(spriteName);
    if (!blob) return;
    const dataUrl = await new Promise((res) => {
      const reader = new FileReader();
      reader.onload = () => res(reader.result);
      reader.readAsDataURL(blob);
    });
    const img = await new Promise((resolve, reject) => {
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = reject;
      im.src = dataUrl;
    });
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const scale = Math.min(canvas.width / img.width, canvas.height / img.height);
    const x = (canvas.width - img.width * scale) / 2;
    const y = (canvas.height - img.height * scale) / 2;
    ctx.drawImage(img, x, y, img.width * scale, img.height * scale);
    baseImageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    fileName.textContent = `(render of ${spriteName})`;
    if (matchResult) matchResult.textContent = `Loaded render of ${spriteName}. Draw on top, then Generate.`;
  } catch (err) {
    console.error('captureSpriteAsBlob failed:', err);
    if (matchResult) matchResult.textContent = `Failed to render ${spriteName}: ${err.message || err}`;
  }
});

// Stored after Generate 2D succeeds, consumed by Generate 3D.
// finalDisplayUrl is what the user sees; imageUrlFor3D is a backend-served
// URL of that same composite (so Meshy can fetch via data URL on backend).
let lastTwoDResult = null;

// Smooth fake progress while waiting on a non-streaming op (Bedrock 2D).
// Asymptotically approaches `cap` so the bar always feels alive, never
// pretends to finish. Caller flips to 100% on real completion.
let progressTimer = null;
function startSyntheticProgress(cap = 90) {
  stopSyntheticProgress();
  let pct = 0;
  resultProgressFill.style.width = '0%';
  progressTimer = setInterval(() => {
    pct += (cap - pct) * 0.06;
    resultProgressFill.style.width = pct.toFixed(1) + '%';
  }, 120);
}
function stopSyntheticProgress() {
  if (progressTimer) {
    clearInterval(progressTimer);
    progressTimer = null;
  }
}

// Populate the base-model dropdown from backend's /api/sprites.
// Re-fetched on initial load AND whenever the panel is shown, so if the
// backend wasn't running at startup the list still appears once it's up.
async function populateSprites() {
  try {
    const res = await fetch(`${BACKEND_URL}/api/sprites`);
    if (!res.ok) return;
    const { sprites } = await res.json();
    const current = spriteSelect.value;
    // Replace options, preserving the "(none)" placeholder + current selection.
    spriteSelect.innerHTML = '<option value="">(none — generate from scratch)</option>';
    for (const name of sprites || []) {
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name.replace(/\.glb$/i, '');
      spriteSelect.appendChild(opt);
    }
    if (current && Array.from(spriteSelect.options).some((o) => o.value === current)) {
      spriteSelect.value = current;
    }
  } catch (err) {
    console.warn('populateSprites failed:', err);
  }
}
populateSprites();
// Re-populate when the user opens the panel — covers the case where they
// started electron before the backend.
addButton.addEventListener('click', () => {
  if (panel.classList.contains('visible')) populateSprites();
});
spriteSelect.addEventListener('focus', populateSprites);

function logLine(text) {
  const line = document.createElement('div');
  line.textContent = text;
  resultLog.appendChild(line);
  resultLog.scrollTop = resultLog.scrollHeight;
}

// Render an ImageData onto an offscreen canvas and return it as a PNG File.
async function imageDataToFile(imageData, filename) {
  const tmp = document.createElement('canvas');
  tmp.width = imageData.width;
  tmp.height = imageData.height;
  tmp.getContext('2d').putImageData(imageData, 0, 0);
  return new Promise((resolve) => {
    tmp.toBlob((blob) => {
      resolve(new File([blob], filename, { type: 'image/png' }));
    }, 'image/png');
  });
}

// Build an inpaint mask from base vs current pixels.
// White (255) = "regenerate this pixel", black (0) = "preserve exactly".
// dilatePx grows the mask outward so doodle edges blend smoothly.
function computeInpaintMask(baseData, currentData, threshold = 25, dilatePx = 4) {
  const w = baseData.width;
  const h = baseData.height;
  const out = new Uint8ClampedArray(w * h * 4);
  // First pass: raw diff
  const raw = new Uint8Array(w * h);
  for (let i = 0, p = 0; i < baseData.data.length; i += 4, p++) {
    const dr = Math.abs(baseData.data[i]     - currentData.data[i]);
    const dg = Math.abs(baseData.data[i + 1] - currentData.data[i + 1]);
    const db = Math.abs(baseData.data[i + 2] - currentData.data[i + 2]);
    raw[p] = ((dr + dg + db) / 3) > threshold ? 1 : 0;
  }
  // Second pass: dilate (square kernel)
  const dilated = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let on = 0;
      for (let dy = -dilatePx; dy <= dilatePx && !on; dy++) {
        for (let dx = -dilatePx; dx <= dilatePx && !on; dx++) {
          const ny = y + dy, nx = x + dx;
          if (ny >= 0 && ny < h && nx >= 0 && nx < w && raw[ny * w + nx]) on = 1;
        }
      }
      dilated[y * w + x] = on;
    }
  }
  // Pack into RGBA (white where 1, black where 0, alpha 255)
  for (let p = 0, i = 0; p < dilated.length; p++, i += 4) {
    const v = dilated[p] * 255;
    out[i] = v; out[i + 1] = v; out[i + 2] = v; out[i + 3] = 255;
  }
  return new ImageData(out, w, h);
}

function maskHasContent(maskImageData) {
  const d = maskImageData.data;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i] > 0) return true;
  }
  return false;
}

// Pre-process an image for Stable Fast 3D:
//  1. Ensure >= minSize on each axis (Stability rejects smaller).
//  2. Apply a subtle blur to suppress pixel-level noise that the model
//     would otherwise turn into bumpy geometry/textures on the output mesh.
async function ensureImageMinSize(imageUrl, minSize = 640, blurPx = 1.5) {
  const img = await new Promise((resolve, reject) => {
    const im = new Image();
    im.crossOrigin = 'anonymous';
    im.onload = () => resolve(im);
    im.onerror = reject;
    im.src = imageUrl;
  });

  // Compute target dims (only upscale if needed)
  let w = img.width;
  let h = img.height;
  if (w < minSize || h < minSize) {
    const scale = Math.max(minSize / w, minSize / h);
    w = Math.ceil(w * scale);
    h = Math.ceil(h * scale);
  }

  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const cx = c.getContext('2d');
  cx.imageSmoothingEnabled = true;
  cx.imageSmoothingQuality = 'high';
  // Slight blur smooths out single-pixel noise from the AI inpaint that
  // Stable Fast 3D would otherwise reproduce as bumpy 3D surface detail.
  cx.filter = `blur(${blurPx}px)`;
  cx.drawImage(img, 0, 0, w, h);

  const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
  const file = new File([blob], 'prepped.png', { type: 'image/png' });
  const uploaded = await uploadImage(file, `${BACKEND_URL}/api/upload-image`);
  return uploaded.imageUrl;
}

// Smallest axis-aligned bounding box around mask pixels (white = on).
function computeMaskBbox(maskData) {
  const w = maskData.width;
  const h = maskData.height;
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (maskData.data[(y * w + x) * 4] > 128) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

function padBbox(bbox, canvasW, canvasH, pad) {
  const x = Math.max(0, bbox.x - pad);
  const y = Math.max(0, bbox.y - pad);
  const w = Math.min(canvasW - x, bbox.w + pad * 2);
  const h = Math.min(canvasH - y, bbox.h + pad * 2);
  return { x, y, w, h };
}

// Build a small canvas containing JUST the doodle on white background,
// at the bbox dimensions. This is the "sketch" we send to control-sketch.
function extractDoodleAsSketch(currentData, maskData, bbox) {
  const out = document.createElement('canvas');
  out.width = bbox.w;
  out.height = bbox.h;
  const octx = out.getContext('2d');
  octx.fillStyle = '#ffffff';
  octx.fillRect(0, 0, bbox.w, bbox.h);
  const sketch = octx.createImageData(bbox.w, bbox.h);
  const cw = currentData.width;
  for (let yy = 0; yy < bbox.h; yy++) {
    for (let xx = 0; xx < bbox.w; xx++) {
      const srcIdx = ((bbox.y + yy) * cw + (bbox.x + xx)) * 4;
      const dstIdx = (yy * bbox.w + xx) * 4;
      const m = maskData.data[srcIdx];
      if (m > 128) {
        sketch.data[dstIdx]     = currentData.data[srcIdx];
        sketch.data[dstIdx + 1] = currentData.data[srcIdx + 1];
        sketch.data[dstIdx + 2] = currentData.data[srcIdx + 2];
      } else {
        sketch.data[dstIdx]     = 255;
        sketch.data[dstIdx + 1] = 255;
        sketch.data[dstIdx + 2] = 255;
      }
      sketch.data[dstIdx + 3] = 255;
    }
  }
  octx.putImageData(sketch, 0, 0);
  return out;
}

// Stability requires images >= 64px in each dim AND >= 4096 total pixels.
// Pad/upscale a small canvas to a safe minimum size.
function ensureMinImageSize(canvasEl, minDim = 256) {
  if (canvasEl.width >= minDim && canvasEl.height >= minDim) return canvasEl;
  const ratio = canvasEl.width / canvasEl.height;
  const newW = Math.max(minDim, Math.round(minDim * Math.max(1, ratio)));
  const newH = Math.max(minDim, Math.round(minDim / Math.max(1, ratio)));
  const out = document.createElement('canvas');
  out.width = newW;
  out.height = newH;
  const octx = out.getContext('2d');
  octx.imageSmoothingEnabled = false;
  octx.fillStyle = '#ffffff';
  octx.fillRect(0, 0, newW, newH);
  // Center the small canvas inside the larger white one
  const ox = Math.floor((newW - canvasEl.width) / 2);
  const oy = Math.floor((newH - canvasEl.height) / 2);
  octx.drawImage(canvasEl, ox, oy);
  return out;
}

async function canvasToPngFile(canvasEl, filename) {
  return new Promise((resolve) => {
    canvasEl.toBlob((blob) => {
      resolve(new File([blob], filename, { type: 'image/png' }));
    }, 'image/png');
  });
}

// Composite the rendered crop onto the base photo with FEATHERED alpha so
// the crop blends instead of looking pasted as a rectangle.
//   - Center of the bbox: full opacity (rendered content wins)
//   - Near the bbox edges: alpha fades to 0 (photo wins)
// `feather` = pixels of edge fade. Larger = softer blend.
async function compositeBaseWithRenderedCrop(baseData, modelOutputUrl, bbox, feather = 24) {
  const modelImg = await new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = modelOutputUrl;
  });
  const w = baseData.width;
  const h = baseData.height;

  // Render the model output onto a full-canvas overlay positioned at bbox.
  const overlay = document.createElement('canvas');
  overlay.width = w;
  overlay.height = h;
  const ovctx = overlay.getContext('2d');
  ovctx.drawImage(modelImg, bbox.x, bbox.y, bbox.w, bbox.h);
  const overlayData = ovctx.getImageData(0, 0, w, h);

  // Build a feathered alpha map: 1.0 inside the bbox (away from edges),
  // 0..1 within `feather` pixels of any bbox edge, 0 outside the bbox.
  const out = new Uint8ClampedArray(w * h * 4);
  const x0 = bbox.x, y0 = bbox.y, x1 = bbox.x + bbox.w - 1, y1 = bbox.y + bbox.h - 1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      let alpha = 0;
      if (x >= x0 && x <= x1 && y >= y0 && y <= y1) {
        const dEdge = Math.min(x - x0, x1 - x, y - y0, y1 - y);
        alpha = Math.min(1, dEdge / feather);
      }
      const inv = 1 - alpha;
      out[i]     = Math.round(baseData.data[i]     * inv + overlayData.data[i]     * alpha);
      out[i + 1] = Math.round(baseData.data[i + 1] * inv + overlayData.data[i + 1] * alpha);
      out[i + 2] = Math.round(baseData.data[i + 2] * inv + overlayData.data[i + 2] * alpha);
      out[i + 3] = 255;
    }
  }

  const final = document.createElement('canvas');
  final.width = w;
  final.height = h;
  final.getContext('2d').putImageData(new ImageData(out, w, h), 0, 0);
  return new Promise((resolve) => {
    final.toBlob((blob) => resolve(URL.createObjectURL(blob)), 'image/png');
  });
}

// Composite the model's polished output onto the base image, only inside the
// mask region. Used when no bbox/crop is in play (kept for compatibility).
async function compositeBaseAndModelOutput(baseData, maskData, modelOutputUrl) {
  const modelImg = await new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = modelOutputUrl;
  });

  const w = baseData.width;
  const h = baseData.height;

  // Draw model output scaled to base dimensions, then read its pixels
  const tmp = document.createElement('canvas');
  tmp.width = w;
  tmp.height = h;
  const tctx = tmp.getContext('2d');
  tctx.drawImage(modelImg, 0, 0, w, h);
  const modelData = tctx.getImageData(0, 0, w, h);

  // Per-pixel pick: mask=white -> model, mask=black -> base
  const out = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < baseData.data.length; i += 4) {
    const m = maskData.data[i]; // 0..255
    if (m > 128) {
      out[i]     = modelData.data[i];
      out[i + 1] = modelData.data[i + 1];
      out[i + 2] = modelData.data[i + 2];
    } else {
      out[i]     = baseData.data[i];
      out[i + 1] = baseData.data[i + 1];
      out[i + 2] = baseData.data[i + 2];
    }
    out[i + 3] = 255;
  }

  const final = document.createElement('canvas');
  final.width = w;
  final.height = h;
  final.getContext('2d').putImageData(new ImageData(out, w, h), 0, 0);
  return new Promise((resolve) => {
    final.toBlob((blob) => resolve(URL.createObjectURL(blob)), 'image/png');
  });
}

// ---- Generate 2D: canvas → AWS Bedrock 2D → composite preview ----
generate2dBtn.addEventListener('click', async () => {
  generate2dBtn.disabled = true;
  generate3dBtn.disabled = true;
  resultBox.style.display = 'block';
  resultLog.innerHTML = '';
  resultModel.innerHTML = '';
  resultStatus.textContent = 'exporting…';
  lastTwoDResult = null;
  startSyntheticProgress(90);

  const prompt = document.getElementById('prompt-input').value.trim() || undefined;

  try {
    let finalDisplayUrl;

    if (baseImageData) {
      const currentData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const maskData = computeInpaintMask(baseImageData, currentData);

      if (!maskHasContent(maskData)) {
        logLine('no strokes detected on top of the uploaded image. Draw something first.');
        resultStatus.textContent = 'idle';
        return;
      }
      const rawBbox = computeMaskBbox(maskData);
      const bbox = padBbox(rawBbox, canvas.width, canvas.height, 24);

      // Attempt 1: real Stability Inpaint with surrounding photo context.
      let inpaintResult = null;
      try {
        const baseFile = await imageDataToFile(baseImageData, 'base.png');
        const maskFile = await imageDataToFile(maskData, 'mask.png');
        logLine(`base ${baseFile.size}b, mask ${maskFile.size}b`);
        resultPreview.src = URL.createObjectURL(baseFile);

        resultStatus.textContent = 'uploading…';
        const baseUp = await uploadImage(baseFile, `${BACKEND_URL}/api/upload-image`);
        const maskUp = await uploadImage(maskFile, `${BACKEND_URL}/api/upload-image`);

        resultStatus.textContent = 'inpainting (AWS Bedrock)…';
        logLine(`calling Stability Inpaint with prompt: "${prompt || '(none)'}"`);
        inpaintResult = await generate2D(
          { imageUrl: baseUp.imageUrl, maskUrl: maskUp.imageUrl, prompt },
          `${BACKEND_URL}/api/generate-2d`,
        );
        logLine(`inpaint ready → ${inpaintResult.imageUrl}`);
      } catch (err) {
        const msg = err.message || String(err);
        const inpaintFiltered = /safety filter|filter/i.test(msg);
        if (!inpaintFiltered) throw err;
        logLine('⚠ Stability filter blocked the photo — switching to crop+sketch fallback');
      }

      if (inpaintResult) {
        resultStatus.textContent = 'compositing…';
        finalDisplayUrl = await compositeBaseAndModelOutput(
          baseImageData,
          maskData,
          inpaintResult.imageUrl,
        );
      } else {
        // Attempt 2: crop the doodle onto white, control-sketch, paste back.
        logLine(`drawing bbox: ${bbox.w}×${bbox.h} at (${bbox.x}, ${bbox.y})`);
        const rawSketch = extractDoodleAsSketch(currentData, maskData, bbox);
        const sketchCanvas = ensureMinImageSize(rawSketch, 256);
        const sketchFile = await canvasToPngFile(sketchCanvas, 'sketch-crop.png');
        logLine(`cropped sketch ${sketchFile.size}b (${sketchCanvas.width}×${sketchCanvas.height})`);

        resultStatus.textContent = 'uploading sketch crop…';
        const uploaded = await uploadImage(sketchFile, `${BACKEND_URL}/api/upload-image`);

        resultStatus.textContent = 'rendering doodle (AWS Bedrock)…';
        logLine(`calling Stability Control Sketch with prompt: "${prompt || '(none)'}"`);
        const enhanced = await generate2D(
          { imageUrl: uploaded.imageUrl, prompt },
          `${BACKEND_URL}/api/generate-2d`,
        );
        logLine(`rendered → ${enhanced.imageUrl}`);

        resultStatus.textContent = 'compositing…';
        finalDisplayUrl = await compositeBaseWithRenderedCrop(
          baseImageData,
          enhanced.imageUrl,
          bbox,
        );
      }
    } else {
      // No base image — full-canvas sketch flow
      const file = await exportCanvasToFile(canvas, 'sketch.png');
      logLine(`exported ${file.name} (${file.size} bytes)`);
      resultPreview.src = URL.createObjectURL(file);

      resultStatus.textContent = 'uploading…';
      const uploaded = await uploadImage(file, `${BACKEND_URL}/api/upload-image`);
      logLine(`uploaded → ${uploaded.imageUrl}`);

      resultStatus.textContent = 'generating 2D (AWS Bedrock)…';
      logLine('calling AWS Bedrock (Stability Control Sketch)…');
      const enhanced = await generate2D(
        { imageUrl: uploaded.imageUrl, prompt },
        `${BACKEND_URL}/api/generate-2d`,
      );
      logLine(`2D ready → ${enhanced.imageUrl}`);
      finalDisplayUrl = enhanced.imageUrl;
    }

    resultPreview.src = finalDisplayUrl;
    stopSyntheticProgress();
    resultProgressFill.style.width = '100%';
    resultStatus.textContent = '2D ready — review then click Generate 3D';
    logLine('✓ 2D ready — review the preview, tweak the prompt, or click Generate 3D when satisfied');

    // Persist for the 3D step. If it's a blob: URL, also upload to backend
    // now so Meshy can fetch it later.
    let imageUrlFor3D = finalDisplayUrl;
    if (imageUrlFor3D.startsWith('blob:')) {
      const compositeBlob = await fetch(imageUrlFor3D).then((r) => r.blob());
      const compositeFile = new File([compositeBlob], 'composite.png', { type: 'image/png' });
      const upComposite = await uploadImage(compositeFile, `${BACKEND_URL}/api/upload-image`);
      imageUrlFor3D = upComposite.imageUrl;
    }

    // ALSO build a "feature-only" crop image AND record the 2D bbox.
    // When merging, the crop is sent to Meshy (so it generates only the
    // addition) and the bbox is sent to the backend so the addition can
    // be placed in 3D where the user drew it.
    let featureCropUrlFor3D = null;
    let featureBbox = null;
    if (baseImageData) {
      try {
        const currentData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const maskData = computeInpaintMask(baseImageData, currentData);
        if (maskHasContent(maskData)) {
          const bbox = padBbox(computeMaskBbox(maskData), canvas.width, canvas.height, 24);
          featureBbox = {
            x: bbox.x,
            y: bbox.y,
            w: bbox.w,
            h: bbox.h,
            canvasW: canvas.width,
            canvasH: canvas.height,
          };
          const inpaintImg = await new Promise((resolve, reject) => {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = () => resolve(img);
            img.onerror = reject;
            img.src = finalDisplayUrl;
          });
          const cropC = document.createElement('canvas');
          cropC.width = bbox.w;
          cropC.height = bbox.h;
          const cctx = cropC.getContext('2d');
          cctx.fillStyle = '#ffffff';
          cctx.fillRect(0, 0, bbox.w, bbox.h);
          cctx.drawImage(inpaintImg, bbox.x, bbox.y, bbox.w, bbox.h, 0, 0, bbox.w, bbox.h);
          const safeCrop = ensureMinImageSize(cropC, 256);
          const cropFile = await canvasToPngFile(safeCrop, 'feature-crop.png');
          const upCrop = await uploadImage(cropFile, `${BACKEND_URL}/api/upload-image`);
          featureCropUrlFor3D = upCrop.imageUrl;
        }
      } catch (err) {
        console.warn('feature crop build failed:', err);
      }
    }

    lastTwoDResult = {
      finalDisplayUrl,
      imageUrlFor3D,
      featureCropUrlFor3D,
      featureBbox,
      prompt: prompt || '',
    };
    generate3dBtn.disabled = false;
  } catch (err) {
    stopSyntheticProgress();
    resultStatus.textContent = 'failed';
    logLine(`❌ ${err.message || err}`);
    console.error(err);
  } finally {
    stopSyntheticProgress();
    generate2dBtn.disabled = false;
  }
});

// ---- Generate 3D: branch on provider ----
generate3dBtn.addEventListener('click', async () => {
  if (!lastTwoDResult) {
    logLine('no 2D image yet — click Generate 2D first');
    return;
  }
  generate3dBtn.disabled = true;
  generate2dBtn.disabled = true;
  resultProgressFill.style.width = '0%';
  resultModel.innerHTML = '';

  const provider = providerSelect.value || 'stable-fast';
  const baseSprite = spriteSelect.value || null;

  try {
    if (provider === 'stable-fast' || provider === 'triposr' || provider === 'replicate-triposr') {
      const isStableFast = provider === 'stable-fast';
      const label =
        provider === 'stable-fast' ? 'Stable Fast 3D'
        : provider === 'replicate-triposr' ? 'TripoSR (Replicate)'
        : 'TripoSR (AWS)';
      const endpoint =
        provider === 'stable-fast' ? '/api/3d/stable-fast'
        : provider === 'replicate-triposr' ? '/api/3d/replicate-triposr'
        : '/api/3d/triposr';

      resultStatus.textContent = 'preparing image…';
      // Stable Fast 3D needs >=640px and benefits from a slight blur to
      // suppress noise -> smoother mesh. TripoSR has no min size, but the
      // blur still helps because it removes single-pixel artifacts that
      // would otherwise become bumps. 640 is a no-op floor at our 1024
      // canvas; blur is the meaningful step.
      const preppedUrl = await ensureImageMinSize(
        lastTwoDResult.imageUrlFor3D,
        640,
        isStableFast ? 1.5 : 0.8,
      );
      logLine(`prepped image for ${label}`);

      resultStatus.textContent = `generating 3D (${label})…`;
      logLine(`calling ${label}…`);
      startSyntheticProgress(95);

      const resp = await fetch(`${BACKEND_URL}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageUrl: preppedUrl,
          prompt: lastTwoDResult.prompt,
          ...(baseSprite ? { baseSprite } : {}),
        }),
      });
      if (!resp.ok) {
        const text = await resp.text().catch(() => '');
        throw new Error(`${label} ${resp.status}: ${text.slice(0, 200)}`);
      }
      const json = await resp.json();
      stopSyntheticProgress();
      resultProgressFill.style.width = '100%';
      resultStatus.textContent = 'completed';
      logLine(`✅ 3D done in ${json.elapsedMs}ms (${json.format})`);

      const viewer = document.getElementById('result-glb-viewer');
      if (viewer) {
        viewer.src = json.modelUrl;
        viewer.style.display = 'block';
      }
      const glbLink = json.cloudinaryGlbUrl || json.modelUrl;
      const previewLink = json.cloudinaryPreviewUrl || json.previewImageUrl;
      resultModel.innerHTML =
        `<div class="result-label">3D Model (${label}, ${json.elapsedMs}ms)</div>` +
        `<a href="${glbLink}" target="_blank" rel="noreferrer" download>Download .glb</a>` +
        (previewLink ? `<div style="margin-top:6px;"><a href="${previewLink}" target="_blank" rel="noreferrer">Preview image</a></div>` : '') +
        (json.cloudinaryGlbUrl ? `<div style="margin-top:6px;"><div class="result-label">Cloudinary</div><a href="${json.cloudinaryGlbUrl}" target="_blank" rel="noreferrer">GLB CDN</a><br/><a href="${json.cloudinaryPreviewUrl}" target="_blank" rel="noreferrer">Preview CDN</a></div>` : '');
    } else {
      // Meshy: queue + poll
      resultStatus.textContent = 'starting 3D (Meshy)…';
      if (baseSprite) {
        logLine(`will scale Meshy output to match ${baseSprite}'s dimensions`);
      }
      const meshyProvider = new BackendThreeDProvider({ baseUrl: BACKEND_URL });
      const started = await meshyProvider.startGeneration({
        imageUrl: lastTwoDResult.imageUrlFor3D,
        prompt: lastTwoDResult.prompt || undefined,
        mode: 'object',
        ...(baseSprite ? { baseSprite, scaleOnly: true } : {}),
      });
      logLine(`Meshy job started: ${started.jobId} (1–3 min)`);

      const result = await pollThreeDGeneration({
        provider: meshyProvider,
        jobId: started.jobId,
        intervalMs: 2500,
        timeoutMs: 5 * 60 * 1000,
        onProgress: (job) => {
          resultStatus.textContent = job.status;
          if (typeof job.progress === 'number') {
            resultProgressFill.style.width = job.progress + '%';
            logLine(`poll: ${job.status} ${job.progress}%`);
          } else {
            logLine(`poll: ${job.status}`);
          }
        },
      });
      resultProgressFill.style.width = '100%';
      resultStatus.textContent = 'completed';
      logLine(`✅ 3D done (${result.format})`);

      const viewer = document.getElementById('result-glb-viewer');
      if (viewer) {
        viewer.src = result.modelUrl;
        viewer.style.display = 'block';
      }
      const glbLink = result.cloudinaryGlbUrl || result.modelUrl;
      const previewLink = result.cloudinaryPreviewUrl || result.previewImageUrl;
      resultModel.innerHTML =
        `<div class="result-label">3D Model (Meshy)</div>` +
        `<a href="${glbLink}" target="_blank" rel="noreferrer" download>Download .glb</a>` +
        (previewLink ? `<div style="margin-top:6px;"><a href="${previewLink}" target="_blank" rel="noreferrer">Preview image</a></div>` : '') +
        (result.cloudinaryGlbUrl ? `<div style="margin-top:6px;"><div class="result-label">Cloudinary</div><a href="${result.cloudinaryGlbUrl}" target="_blank" rel="noreferrer">GLB CDN</a><br/><a href="${result.cloudinaryPreviewUrl}" target="_blank" rel="noreferrer">Preview CDN</a></div>` : '');
    }
  } catch (err) {
    stopSyntheticProgress();
    resultStatus.textContent = 'failed';
    logLine(`❌ ${err.message || err}`);
    console.error(err);
  } finally {
    generate3dBtn.disabled = false;
    generate2dBtn.disabled = false;
  }
});
