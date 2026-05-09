require("dotenv").config();
const { app, BrowserWindow, screen, ipcMain } = require('electron');
const path = require('path');

let mainWindow;

const { indexSprites } = require("./main/assetSearch/indexSprites");
const { searchAsset } = require("./main/assetSearch/searchAsset");

function createWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;

  mainWindow = new BrowserWindow({
    width: width,
    height: height,
    x: 0,
    y: 0,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  mainWindow.loadFile('renderer/index.html');

  // Default: transparent areas pass clicks through to apps beneath
  mainWindow.setIgnoreMouseEvents(true, { forward: true });

  // Renderer toggles this when mouse enters/leaves interactive elements
  ipcMain.on('set-ignore-mouse-events', (event, ignore, options) => {
    mainWindow.setIgnoreMouseEvents(ignore, options || {});
  });

  ipcMain.handle("assets:indexSprites", async (_event, args) => {
    const spritesRoot = args?.spritesRoot;
    const dbPath = args?.dbPath;
    const embeddingModel =
      args?.embeddingModel || process.env.COHERE_EMBED_MODEL || "embed-v4.0";
    return await indexSprites({ spritesRoot, dbPath, embeddingModel });
  });

  ipcMain.handle("assets:search", async (_event, args) => {
    const imageBase64 = args?.imageBase64;
    const dbPath = args?.dbPath;
    const embeddingModel =
      args?.embeddingModel || process.env.COHERE_EMBED_MODEL || "embed-v4.0";
    if (!imageBase64) throw new Error("assets:search: imageBase64 is required");
    const buf = Buffer.from(imageBase64, "base64");
    return await searchAsset({ imageBuffer: buf, dbPath, embeddingModel });
  });

  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.key === 'Escape') {
      mainWindow.webContents.send('close-panel');
    }
  });

  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});
