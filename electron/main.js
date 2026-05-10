require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { app, BrowserWindow, screen, ipcMain, desktopCapturer, shell, globalShortcut, systemPreferences } = require('electron');
const { execSync, exec, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { runAgent } = require('./services/backboard');


let mainWindow;
let godotProcess = null;
let trackingInterval = null;
let fileWatcher = null;
let restartTimeout = null;
let relaunchTimeout = null;
let restartInProgress = false;

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
var found = false
for w in list {
  guard let owner = w["kCGWindowOwnerName"] as? String,
        owner.lowercased().contains("godot"),
        let layer = w["kCGWindowLayer"] as? Int, layer == 0,
        let bounds = w["kCGWindowBounds"] as? [String: CGFloat],
        let id = w["kCGWindowNumber"] as? Int
  else { continue }
  let x = Int(bounds["X"] ?? 0)
  let y = Int(bounds["Y"] ?? 0)
  let width = Int(bounds["Width"] ?? 0)
  let height = Int(bounds["Height"] ?? 0)
  if width > 100 && height > 100 {
    let title = (w["kCGWindowName"] as? String ?? "").replacingOccurrences(of: "\\t", with: " ")
    let safeOwner = owner.replacingOccurrences(of: "\\t", with: " ")
    print("\\(id)\\t\\(x)\\t\\(y)\\t\\(width)\\t\\(height)\\t\\(safeOwner)\\t\\(title)")
    found = true
  }
}
if !found { print("none") }
`;

let swiftHelperReady = false;

// Compile async on first run; reuse binary on subsequent runs
function buildSwiftHelper(onReady) {
  const currentSource = fs.existsSync(SWIFT_SRC) ? fs.readFileSync(SWIFT_SRC, 'utf8') : '';
  if (fs.existsSync(SWIFT_BIN) && currentSource === SWIFT_CODE) {
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
function getGodotWindows() {
  if (!swiftHelperReady) return null;
  try {
    const result = execSync(SWIFT_BIN, { timeout: 500 }).toString().trim();
    if (result === 'none' || !result) return null;
    const windows = result
      .split('\n')
      .map((line) => {
        const [id, x, y, width, height, owner = '', title = ''] = line.split('\t');
        const parsed = {
          id: Number(id),
          x: Number(x),
          y: Number(y),
          width: Number(width),
          height: Number(height),
          owner,
          title
        };
        return [parsed.id, parsed.x, parsed.y, parsed.width, parsed.height].some(Number.isNaN) ? null : parsed;
      })
      .filter(Boolean);
    return windows.length ? windows : null;
  } catch {
    return null;
  }
}

function selectGodotGameWindow(windows) {
  if (!windows || windows.length === 0) return null;
  return windows.find((windowInfo) => {
    const label = `${windowInfo.owner} ${windowInfo.title}`.toLowerCase();
    return !label.includes('editor') && !label.includes('project manager');
  }) || windows[0];
}

function getGodotWindowBounds() {
  const windowInfo = selectGodotGameWindow(getGodotWindows());
  if (!windowInfo) return null;
  const { x, y, width, height } = windowInfo;
  return { x, y, width, height };
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
    const result = execSync('ps aux | grep -i "Godot.app" | grep -v grep').toString().trim();
    if (!result) return null;
    const line = result
      .split('\n')
      .find((item) => item.includes(`--path ${GAME_PROJECT_PATH}`)
        && !item.includes('--headless')
        && !item.includes('--import')
        && !item.includes('--check-only'));
    if (!line) return null;
    
    // Extract PID (first column after username)
    const parts = line.split(/\s+/);
    const pid = parseInt(parts[1]);
    
    // Extract the full path to the Godot binary
    const pathMatch = line.match(/(\S+Godot\.app\/Contents\/MacOS\/Godot)/);
    const binaryPath = pathMatch ? pathMatch[1] : null;
    
    return { pid, binaryPath };
  } catch {
    return null;
  }
}

function restartGodot(delayMs = 500) {
  if (restartInProgress) return;
  if (restartTimeout) {
    clearTimeout(restartTimeout);
    restartTimeout = null;
  }
  if (relaunchTimeout) {
    clearTimeout(relaunchTimeout);
    relaunchTimeout = null;
  }
  restartInProgress = true;

  const finishRestart = () => {
    relaunchTimeout = setTimeout(() => {
      restartInProgress = false;
      relaunchTimeout = null;
    }, delayMs + 2500);
  };

  // If we launched Godot ourselves
  if (godotProcess) {
    console.log('[GodMode] Restarting Godot (managed process)...');
    godotProcess.kill();
    godotProcess = null;
    relaunchTimeout = setTimeout(() => {
      launchGodot();
      finishRestart();
    }, delayMs);
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
      relaunchTimeout = setTimeout(() => {
        console.log(`[GodMode] Relaunching Godot from: ${info.binaryPath}`);
        exec(`"${info.binaryPath}" --path "${GAME_PROJECT_PATH}" &`);
        finishRestart();
      }, delayMs);
    } catch (err) {
      console.error('[GodMode] Failed to restart external Godot:', err.message);
      restartInProgress = false;
    }
  } else {
    console.log('[GodMode] No running Godot found to restart.');
    // Try to launch if binary exists
    launchGodot();
    finishRestart();
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

  const WATCHED_EXTS = new Set(['.gd', '.tscn', '.tres', '.godot', '.glb', '.import']);

  fileWatcher = fs.watch(GAME_PROJECT_PATH, { recursive: true }, (event, filename) => {
    if (!filename) return;
    if (restartInProgress) return;
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

async function captureGodotWindowScreenshot() {
  try {
    const windowInfo = selectGodotGameWindow(getGodotWindows());
    const sources = await desktopCapturer.getSources({
      types: ['window'],
      thumbnailSize: { width: 1920, height: 1080 }
    });

    const godotWindow = windowInfo
      ? sources.find((source) => source.id.startsWith(`window:${windowInfo.id}:`))
      : null;

    if (!godotWindow) {
      console.error('[Screenshot] Godot window not found');
      return null;
    }

    return godotWindow.thumbnail.toDataURL();
  } catch (err) {
    console.error('[Screenshot] Error:', err);
    return null;
  }
}

let pickerWindow = null;
let pickerInFlight = false;

async function startRegionScreenshot() {
  if (pickerInFlight || pickerWindow) return;
  pickerInFlight = true;

  try {
    if (process.platform === 'darwin') {
      const status = systemPreferences.getMediaAccessStatus('screen');
      if (status !== 'granted') {
        console.warn('[Screenshot] Screen Recording permission status:', status);
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('screenshot-error',
            'Grant Screen Recording permission to GodMode in System Settings → Privacy & Security → Screen Recording, then quit and relaunch the app.');
        }
        try {
          shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture');
        } catch {}
        return;
      }
    }

    const wasVisible = mainWindow && mainWindow.isVisible();
    if (wasVisible) mainWindow.hide();
    await new Promise((r) => setTimeout(r, 180));

    const display = screen.getPrimaryDisplay();
    const sf = display.scaleFactor || 1;
    const physW = Math.max(1, Math.round(display.size.width * sf));
    const physH = Math.max(1, Math.round(display.size.height * sf));

    let sources;
    try {
      sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: physW, height: physH },
      });
    } catch (err) {
      console.error('[Screenshot] desktopCapturer failed:', err);
      if (wasVisible) mainWindow.showInactive();
      return;
    }

    const source = sources && sources[0];
    if (!source || source.thumbnail.isEmpty()) {
      console.error('[Screenshot] No screen source returned');
      if (wasVisible) mainWindow.showInactive();
      return;
    }

    const tmpPath = path.join(os.tmpdir(),
      `godmode-shot-${Date.now()}-${crypto.randomBytes(3).toString('hex')}.png`);
    fs.writeFileSync(tmpPath, source.thumbnail.toPNG());

    pickerWindow = new BrowserWindow({
      x: display.bounds.x,
      y: display.bounds.y,
      width: display.bounds.width,
      height: display.bounds.height,
      show: false,
      frame: false,
      transparent: false,
      backgroundColor: '#000000',
      hasShadow: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      webPreferences: {
        preload: path.join(__dirname, 'region-picker-preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    pickerWindow.setAlwaysOnTop(true, 'screen-saver');
    pickerWindow.once('ready-to-show', () => {
      if (pickerWindow && !pickerWindow.isDestroyed()) {
        pickerWindow.showInactive();
        pickerWindow.focus();
      }
    });

    let settled = false;
    const cleanup = (dataUrl) => {
      if (settled) return;
      settled = true;
      ipcMain.removeListener('region-picker:confirm', onConfirm);
      ipcMain.removeListener('region-picker:cancel', onCancel);
      try { fs.unlinkSync(tmpPath); } catch {}
      if (pickerWindow && !pickerWindow.isDestroyed()) pickerWindow.close();
      pickerWindow = null;
      if (wasVisible && mainWindow && !mainWindow.isDestroyed()) mainWindow.showInactive();
      if (dataUrl && mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('screenshot-captured', dataUrl);
      }
    };
    const onConfirm = (_e, dataUrl) => cleanup(dataUrl);
    const onCancel  = () => cleanup(null);
    ipcMain.on('region-picker:confirm', onConfirm);
    ipcMain.on('region-picker:cancel', onCancel);
    pickerWindow.on('closed', () => { if (!settled) cleanup(null); });

    await pickerWindow.loadFile('renderer/region-picker.html', {
      query: { src: `file://${tmpPath}` },
    });
  } finally {
    pickerInFlight = false;
  }
}

function openSafeExternalUrl(url) {
  try {
    const parsed = new URL(String(url));
    if (!['http:', 'https:'].includes(parsed.protocol)) return;
    shell.openExternal(parsed.toString());
  } catch {
    console.warn('[GodMode] Ignoring invalid external URL');
  }
}

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
      }, captureGodotWindowScreenshot);

      return { ...result, steps };
    } catch (error) {
      console.error('[GodMode] Agent error:', error);
      throw error;
    }
  });

  // Capture Godot game window screenshot
  ipcMain.handle('capture-game-window', captureGodotWindowScreenshot);

  // Open URL in external browser
  ipcMain.on('open-external', (_event, url) => {
    openSafeExternalUrl(url);
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
  try {
    const ok = globalShortcut.register('Control+Shift+A', () => startRegionScreenshot());
    if (!ok) console.warn('[GodMode] failed to register Ctrl+Shift+A');
    else console.log('[GodMode] Ctrl+Shift+A registered for screen-region capture');
  } catch (err) {
    console.warn('[GodMode] globalShortcut register error:', err.message);
  }
  try {
    const ok = globalShortcut.register('Control+Shift+R', () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('toggle-top-buttons');
      }
    });
    if (!ok) console.warn('[GodMode] failed to register Ctrl+Shift+R');
    else console.log('[GodMode] Ctrl+Shift+R registered for top-button toggle');
  } catch (err) {
    console.warn('[GodMode] globalShortcut register error:', err.message);
  }
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

app.on('window-all-closed', () => {
  if (trackingInterval) clearInterval(trackingInterval);
  if (fileWatcher) fileWatcher.close();
  if (godotProcess) godotProcess.kill();
  if (process.platform !== 'darwin') app.quit();
});
