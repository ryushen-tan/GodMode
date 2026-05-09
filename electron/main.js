const { app, BrowserWindow, screen, ipcMain } = require('electron');
const { execSync, exec, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

let mainWindow;
let godotProcess = null;
let trackingInterval = null;

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
      if (!mainWindow.isVisible()) mainWindow.show();
      mainWindow.webContents.send('godot-status', 'running');
    } else {
      mainWindow.webContents.send('godot-status', 'waiting');
    }
  }, 250);
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

function createWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;

  mainWindow = new BrowserWindow({
    width,
    height,
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

  // Transparent areas forward clicks through to the game below
  mainWindow.setIgnoreMouseEvents(true, { forward: true });

  ipcMain.on('set-ignore-mouse-events', (event, ignore, options) => {
    mainWindow.setIgnoreMouseEvents(ignore, options || {});
  });

  ipcMain.on('launch-godot', () => launchGodot());

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
      // Wait 2s for Godot to open its window before we start tracking
      setTimeout(startTracking, 2000);
    });
  });
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (trackingInterval) clearInterval(trackingInterval);
  if (godotProcess) godotProcess.kill();
  if (process.platform !== 'darwin') app.quit();
});
