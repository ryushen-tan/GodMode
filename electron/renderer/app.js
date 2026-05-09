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
  } else {
    matchResult.textContent = 'No match found.';
  }
}

let isDrawing = false;
let currentTool = 'pen';
let currentColor = '#000000';
let currentBrushSize = 3;
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
  if (confirm('Clear the entire canvas?')) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }
});

uploadBtn.addEventListener('click', () => {
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

// ---- Generate 3D pipeline (canvas → 2D image → mock 3D) ----
const generate3dBtn = document.getElementById('generate-3d-btn');
const resultBox = document.getElementById('generate-result');
const resultPreview = document.getElementById('result-preview');
const resultProgressFill = document.getElementById('result-progress-fill');
const resultStatus = document.getElementById('result-status');
const resultLog = document.getElementById('result-log');
const resultModel = document.getElementById('result-model');

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

generate3dBtn.addEventListener('click', async () => {
  generate3dBtn.disabled = true;
  resultBox.style.display = 'block';
  resultLog.innerHTML = '';
  resultModel.innerHTML = '';
  resultProgressFill.style.width = '0%';
  resultStatus.textContent = 'exporting…';

  const prompt = document.getElementById('prompt-input').value.trim() || undefined;

  try {
    let imageUrlForBackend;
    let maskUrlForBackend;

    if (baseImageData) {
      // Inpaint mode: send the unmodified base image + a mask of just the
      // pixels you drew. Stability Inpaint regenerates only inside the mask
      // and leaves the rest of the photo pixel-perfect.
      const currentData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const maskData = computeInpaintMask(baseImageData, currentData);

      if (!maskHasContent(maskData)) {
        // Nothing was drawn on top of the base — nothing to inpaint
        logLine('no strokes detected on top of the uploaded image. Draw something first.');
        resultStatus.textContent = 'idle';
        return;
      }

      const baseFile = await imageDataToFile(baseImageData, 'base.png');
      const maskFile = await imageDataToFile(maskData, 'mask.png');
      logLine(`base ${baseFile.size}b, mask ${maskFile.size}b`);
      resultPreview.src = URL.createObjectURL(baseFile);

      resultStatus.textContent = 'uploading…';
      const baseUp = await uploadImage(baseFile, `${BACKEND_URL}/api/upload-image`);
      const maskUp = await uploadImage(maskFile, `${BACKEND_URL}/api/upload-image`);
      logLine(`base → ${baseUp.imageUrl}`);
      logLine(`mask → ${maskUp.imageUrl}`);
      imageUrlForBackend = baseUp.imageUrl;
      maskUrlForBackend = maskUp.imageUrl;

      resultStatus.textContent = 'inpainting (AWS Bedrock)…';
      logLine('calling AWS Bedrock (Stability Inpaint, mask-only regeneration)…');
    } else {
      // No base image uploaded — fall back to the regular control-model flow
      const file = await exportCanvasToFile(canvas, 'sketch.png');
      logLine(`exported ${file.name} (${file.size} bytes)`);
      resultPreview.src = URL.createObjectURL(file);

      resultStatus.textContent = 'uploading…';
      const uploaded = await uploadImage(file, `${BACKEND_URL}/api/upload-image`);
      logLine(`uploaded → ${uploaded.imageUrl}`);
      imageUrlForBackend = uploaded.imageUrl;

      resultStatus.textContent = 'generating 2D (AWS Bedrock)…';
      logLine('calling AWS Bedrock (Stability Control, structure-preserving)…');
    }

    const enhanced = await generate2D(
      {
        imageUrl: imageUrlForBackend,
        ...(maskUrlForBackend ? { maskUrl: maskUrlForBackend } : {}),
        prompt,
      },
      `${BACKEND_URL}/api/generate-2d`,
    );
    if (enhanced.usedFallback) {
      logLine(`⚠ inpaint blocked by safety filter — fell back to ${enhanced.usedFallback}`);
    }
    logLine(`2D ready → ${enhanced.imageUrl}`);
    resultPreview.src = enhanced.imageUrl;

    // 4. Start 3D job (currently mocked on the backend)
    resultStatus.textContent = 'starting 3D…';
    const provider = new BackendThreeDProvider({ baseUrl: BACKEND_URL });
    const started = await provider.startGeneration({
      imageUrl: enhanced.imageUrl,
      prompt,
      mode: 'object',
    });
    logLine(`3D job started: ${started.jobId}`);

    // 5. Poll until completed
    const result = await pollThreeDGeneration({
      provider,
      jobId: started.jobId,
      intervalMs: 800,
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
    logLine(`✅ done (${result.format})`);
    resultModel.innerHTML =
      `<div class="result-label">Model URL (mock — wire real 3D later)</div>` +
      `<a href="${result.modelUrl}" target="_blank" rel="noreferrer">${result.modelUrl}</a>`;
  } catch (err) {
    resultStatus.textContent = 'failed';
    logLine(`❌ ${err.message || err}`);
    console.error(err);
  } finally {
    generate3dBtn.disabled = false;
  }
});
