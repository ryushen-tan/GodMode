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
