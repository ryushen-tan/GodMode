require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const { app, BrowserWindow, screen, ipcMain } = require('electron');
const { execSync, exec, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { runAgent } = require('./services/backboard');


let mainWindow;
let godotProcess = null;
let trackingInterval = null;
let fileWatcher = null;
let restartTimeout = null;

const GAME_PROJECT_PATH = path.join(__dirname, '..', 'example_game', 'godot-FirstPersonStarter-main');

// Common Godot 4 install locations on macOS
const GODOT_SEARCH_PATHS = [
  '/Applications/Godot.app/Contents/MacOS/Godot',
  '/Applications/Godot_4.app/Contents/MacOS/Godot',
  '/Applications/Godot_mono.app/Contents/MacOS/Godot',
];

function findGodotBinary() {
  for (const p of GODOT_SEARCH_PATHS) {
    if (fs.existsSync(p)) return p;
  }
  // Fall back to PATH
  try {
    const result = execSync('which godot 2>/dev/null || which godot4 2>/dev/null').toString().trim();
    if (result) return result;
  } catch {}
  return null;
}

const SWIFT_SRC = '/tmp/godmode_bounds.swift';
const SWIFT_BIN = '/tmp/godmode_bounds';
const SWIFT_CODE = `
import CoreGraphics
let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly], kCGNullWindowID) as? [[String: Any]] ?? []
for w in list {
  guard let owner = w["kCGWindowOwnerName"] as? String,
        owner.lowercased().contains("godot"),
        let layer = w["kCGWindowLayer"] as? Int, layer == 0,
        let bounds = w["kCGWindowBounds"] as? [String: CGFloat]
  else { continue }
  let x = Int(bounds["X"] ?? 0)
  let y = Int(bounds["Y"] ?? 0)
  let width = Int(bounds["Width"] ?? 0)
  let height = Int(bounds["Height"] ?? 0)
  if width > 100 && height > 100 {
    print("\\(x),\\(y),\\(width),\\(height)")
    exit(0)
  }
}
print("none")
`;

let swiftHelperReady = false;

// Compile async on first run; reuse binary on subsequent runs
function buildSwiftHelper(onReady) {
  if (fs.existsSync(SWIFT_BIN)) {
    swiftHelperReady = true;
    onReady();
    return;
  }
  fs.writeFileSync(SWIFT_SRC, SWIFT_CODE);
  exec(`swiftc ${SWIFT_SRC} -o ${SWIFT_BIN} 2>/dev/null`, (err) => {
    if (!err) {
      swiftHelperReady = true;
      console.log('[GodMode] Swift helper compiled.');
    } else {
      console.error('[GodMode] Swift compile failed:', err.message);
    }
    onReady();
  });
}

// Use compiled CoreGraphics binary — no special permissions required on macOS
function getGodotWindowBounds() {
  if (!swiftHelperReady) return null;
  try {
    const result = execSync(SWIFT_BIN, { timeout: 500 }).toString().trim();
    if (result === 'none' || !result) return null;
    const [x, y, w, h] = result.split(',').map(Number);
    if ([x, y, w, h].some(isNaN)) return null;
    return { x, y, width: w, height: h };
  } catch {
    return null;
  }
}

function startTracking() {
  trackingInterval = setInterval(() => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const bounds = getGodotWindowBounds();
    if (bounds) {
      mainWindow.setBounds(bounds, false);
      if (!mainWindow.isVisible()) mainWindow.showInactive();
      mainWindow.webContents.send('godot-status', 'running');
    } else {
      // No Godot detected — keep overlay fullscreen + visible so the
      // sketch panel/Generate 3D pipeline is still usable on its own.
      if (!mainWindow.isVisible()) mainWindow.showInactive();
      mainWindow.webContents.send('godot-status', 'waiting');
    }
  }, 250);
}

function findRunningGodotInfo() {
  try {
    const result = execSync('ps aux | grep -i "Godot.app" | grep -v grep | head -1').toString().trim();
    if (!result) return null;
    
    // Extract PID (first column after username)
    const parts = result.split(/\s+/);
    const pid = parseInt(parts[1]);
    
    // Extract the full path to the Godot binary
    const pathMatch = result.match(/(\S+Godot\.app\/Contents\/MacOS\/Godot)/);
    const binaryPath = pathMatch ? pathMatch[1] : null;
    
    return { pid, binaryPath };
  } catch {
    return null;
  }
}

function restartGodot() {
  // If we launched Godot ourselves
  if (godotProcess) {
    console.log('[GodMode] Restarting Godot (managed process)...');
    godotProcess.kill();
    godotProcess = null;
    setTimeout(launchGodot, 500);
    return;
  }

  // If Godot is running externally (user launched it manually)
  const info = findRunningGodotInfo();
  if (info && info.pid && info.binaryPath) {
    console.log(`[GodMode] Restarting external Godot (PID: ${info.pid})...`);
    try {
      // Kill the external Godot process
      execSync(`kill ${info.pid}`);
      // Wait and relaunch with the same binary
      setTimeout(() => {
        console.log(`[GodMode] Relaunching Godot from: ${info.binaryPath}`);
        exec(`"${info.binaryPath}" --path "${GAME_PROJECT_PATH}" &`);
      }, 500);
    } catch (err) {
      console.error('[GodMode] Failed to restart external Godot:', err.message);
    }
  } else {
    console.log('[GodMode] No running Godot found to restart.');
    // Try to launch if binary exists
    launchGodot();
  }
}

function launchGodot() {
  const bin = findGodotBinary();
  if (!bin) {
    console.log('[GodMode] Godot binary not found. Start Godot manually and the overlay will attach.');
    mainWindow.webContents.send('godot-status', 'no-binary');
    return;
  }

  console.log(`[GodMode] Launching Godot: ${bin}`);
  godotProcess = spawn(bin, ['--path', GAME_PROJECT_PATH], { detached: false });

  godotProcess.on('error', (err) => {
    console.error('[GodMode] Failed to launch Godot:', err.message);
    mainWindow.webContents.send('godot-status', 'error');
  });

  godotProcess.on('exit', () => {
    console.log('[GodMode] Godot process exited.');
    mainWindow.webContents.send('godot-status', 'exited');
  });
}

function startFileWatcher() {
  if (fileWatcher) return;

  const WATCHED_EXTS = new Set(['.gd', '.tscn', '.tres', '.godot']);

  fileWatcher = fs.watch(GAME_PROJECT_PATH, { recursive: true }, (event, filename) => {
    if (!filename) return;
    const ext = path.extname(filename);
    if (!WATCHED_EXTS.has(ext)) return;
    if (path.basename(filename).startsWith('.')) return;

    console.log(`[GodMode] File changed: ${filename}`);

    if (restartTimeout) clearTimeout(restartTimeout);
    restartTimeout = setTimeout(() => restartGodot(), 300);
  });

  console.log('[GodMode] File watcher started. Game will auto-restart on file changes.');
}

const { indexSprites } = require("./main/assetSearch/indexSprites");
const { searchAsset } = require("./main/assetSearch/searchAsset");

function createWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;

  mainWindow = new BrowserWindow({
    width,
    height,
    show: true,
    x: 0,
    y: 0,
    transparent: true,
    hasShadow: false,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  mainWindow.loadFile('renderer/index.html');

  // Transparent areas forward clicks through to the game below
  mainWindow.setIgnoreMouseEvents(true, { forward: true });

  ipcMain.on('set-ignore-mouse-events', (event, ignore, options) => {
    mainWindow.setIgnoreMouseEvents(ignore, options || {});
  });

  ipcMain.handle("assets:indexSprites", async (_event, args) => {
    const spritesRoot = args?.spritesRoot;
    const dbPath = args?.dbPath;
    const embeddingModel =
      args?.embeddingModel || process.env.COHERE_EMBED_MODEL || "embed-v4.0";
    if (typeof indexSprites === 'function') {
      return await indexSprites({ spritesRoot, dbPath, embeddingModel });
    } else {
      console.error('[GodMode] indexSprites function is not defined.');
      return null;
    }
  });

  ipcMain.handle("assets:search", async (_event, args) => {
    const imageBase64 = args?.imageBase64;
    const dbPath = args?.dbPath;
    const embeddingModel =
      args?.embeddingModel || process.env.COHERE_EMBED_MODEL || "embed-v4.0";
    if (!imageBase64) throw new Error("assets:search: imageBase64 is required");
    const buf = Buffer.from(imageBase64, "base64");
    if (typeof searchAsset === 'function') {
      return await searchAsset({ imageBuffer: buf, dbPath, embeddingModel });
    } else {
      console.error('[GodMode] searchAsset function is not defined.');
      return null;
    }
  });

  ipcMain.on('launch-godot', () => launchGodot());

  ipcMain.handle('send-prompt', async (_event, { prompt }) => {
    const key = process.env.BACKBOARD_API_KEY || '';
    if (!key) throw new Error('No Backboard API key found in .env file.');

    const steps = [];
    try {
      const result = await runAgent(prompt, key, null, (step) => {
        steps.push(step);
        if (!mainWindow.isDestroyed()) {
          mainWindow.webContents.send('agent-step', step);
        }
      });

      return { ...result, steps };
    } catch (error) {
      console.error('[GodMode] Agent error:', error);
      throw error;
    }
  });

  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.key === 'Escape') {
      mainWindow.webContents.send('close-panel');
    }
  });

  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  // Give the window a moment to load, then start everything
  mainWindow.webContents.once('did-finish-load', () => {
    buildSwiftHelper(() => {
      launchGodot();
      startFileWatcher();
      // Wait 2s for Godot to open its window before we start tracking
      setTimeout(startTracking, 2000);
    });
  });
}

app.whenReady().then(() => {
  // Override the default Electron dock icon (macOS) with our logo.
  if (process.platform === 'darwin' && app.dock && app.dock.setIcon) {
    try {
      app.dock.setIcon(path.join(__dirname, 'icon.png'));
    } catch (err) {
      console.warn('[GodMode] failed to set dock icon:', err.message);
    }
  }
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (trackingInterval) clearInterval(trackingInterval);
  if (fileWatcher) fileWatcher.close();
  if (godotProcess) godotProcess.kill();
  if (process.platform !== 'darwin') app.quit();
});
