import {
  exportCanvasToFile,
  uploadImage,
  generate2D,
  BackendThreeDProvider,
  pollThreeDGeneration,
} from './services.bundle.js';

const BACKEND_URL = 'http://localhost:3001';

const addButton = document.getElementById('add-button');
const panel = document.getElementById('panel');
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

// Block clicks when hovering over button or panel, pass through otherwise
[addButton, panel].forEach((el) => {
  el.addEventListener('mouseenter', () => setPassthrough(false));
  el.addEventListener('mouseleave', () => setPassthrough(true));
});

function togglePanel() {
  panel.classList.toggle('visible');
}

addButton.addEventListener('click', togglePanel);
closePanelBtn.addEventListener('click', togglePanel);

if (window.electronAPI && window.electronAPI.onClosePanel) {
  window.electronAPI.onClosePanel(() => {
    if (panel.classList.contains('visible')) {
      togglePanel();
    }
  });
}

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
        
        ctx.drawImage(img, x, y, img.width * scale, img.height * scale);
      };
      img.src = event.target.result;
    };
    reader.readAsDataURL(file);
  }
});

function startDrawing(e) {
  isDrawing = true;
  const rect = canvas.getBoundingClientRect();
  lastX = e.clientX - rect.left;
  lastY = e.clientY - rect.top;
}

function draw(e) {
  if (!isDrawing) return;
  
  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  
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

generate3dBtn.addEventListener('click', async () => {
  generate3dBtn.disabled = true;
  resultBox.style.display = 'block';
  resultLog.innerHTML = '';
  resultModel.innerHTML = '';
  resultProgressFill.style.width = '0%';
  resultStatus.textContent = 'exporting…';

  const prompt = document.getElementById('prompt-input').value.trim() || undefined;

  try {
    // 1. Export canvas → PNG file
    const file = await exportCanvasToFile(canvas, 'sketch.png');
    logLine(`exported ${file.name} (${file.size} bytes)`);
    resultPreview.src = URL.createObjectURL(file);

    // 2. Upload to backend
    resultStatus.textContent = 'uploading…';
    const uploaded = await uploadImage(file, `${BACKEND_URL}/api/upload-image`);
    logLine(`uploaded → ${uploaded.imageUrl}`);

    // 3. AWS Bedrock Stability Control Sketch: pure image-to-image
    resultStatus.textContent = 'generating 2D (AWS Bedrock)…';
    logLine('calling AWS Bedrock (Stability Control Sketch, image-to-image)…');
    const enhanced = await generate2D(
      { imageUrl: uploaded.imageUrl, prompt },
      `${BACKEND_URL}/api/generate-2d`,
    );
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
