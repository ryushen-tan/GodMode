require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const { app, BrowserWindow, screen, ipcMain } = require('electron');
const { execSync, exec, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { runAgent } = require('./services/backboard');

const IS_WIN = process.platform === 'win32';

let mainWindow;
let godotProcess = null;
let trackingInterval = null;
let fileWatcher = null;
let restartTimeout = null;

const GAME_PROJECT_PATH = path.join(__dirname, '..', 'example_game', 'godot-FirstPersonStarter-main');

// Common Godot 4 install locations per platform
const GODOT_SEARCH_PATHS = IS_WIN ? [
  'C:\\Program Files\\Godot\\Godot.exe',
  'C:\\Program Files\\Godot Engine\\Godot.exe',
  'C:\\Program Files (x86)\\Godot\\Godot.exe',
  'C:\\Program Files (x86)\\Godot Engine\\Godot.exe',
] : [
  '/Applications/Godot.app/Contents/MacOS/Godot',
  '/Applications/Godot_4.app/Contents/MacOS/Godot',
  '/Applications/Godot_mono.app/Contents/MacOS/Godot',
];

function findGodotBinary() {
  for (const p of GODOT_SEARCH_PATHS) {
    if (fs.existsSync(p)) return p;
  }
  try {
    const cmd = IS_WIN
      ? 'where godot 2>nul'
      : 'which godot 2>/dev/null || which godot4 2>/dev/null';
    const result = execSync(cmd).toString().trim().split(/\r?\n/)[0].trim();
    if (result) return result;
  } catch {}
  return null;
}

// ── Window-bounds helper ──────────────────────────────────────────────────────
// macOS: compile a Swift binary once (CoreGraphics, no special permissions needed)
// Windows: compile a C# exe once (.NET Framework csc.exe, always available on Win 10/11)

const HELPER_BIN = path.join(os.tmpdir(), IS_WIN ? 'godmode_bounds.exe' : 'godmode_bounds');
let helperReady = false;

// macOS: CoreGraphics window enumeration
const SWIFT_SRC = path.join(os.tmpdir(), 'godmode_bounds.swift');
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

// Windows: Win32 EnumWindows + GetWindowRect via .NET Framework P/Invoke
const WIN_CS_SRC = path.join(os.tmpdir(), 'godmode_bounds.cs');
const WIN_CS_CODE = `
using System;
using System.Runtime.InteropServices;
using System.Text;
class Program {
  delegate bool EnumWindowsProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumWindowsProc p, IntPtr l);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll", CharSet=CharSet.Auto)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
  struct RECT { public int Left, Top, Right, Bottom; }
  static void Main() {
    EnumWindows(delegate(IntPtr h, IntPtr l) {
      if (!IsWindowVisible(h) || IsIconic(h)) return true;
      var sb = new StringBuilder(256);
      GetWindowText(h, sb, 256);
      if (sb.ToString().ToLower().Contains("godot")) {
        RECT r; GetWindowRect(h, out r);
        int w = r.Right - r.Left, ht = r.Bottom - r.Top;
        if (w > 100 && ht > 100) {
          Console.WriteLine(r.Left + "," + r.Top + "," + w + "," + ht);
          Environment.Exit(0);
        }
      }
      return true;
    }, IntPtr.Zero);
    Console.WriteLine("none");
  }
}
`;

function findCscExe() {
  const sysRoot = process.env.SystemRoot || 'C:\\Windows';
  const candidates = [
    path.join(sysRoot, 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe'),
    path.join(sysRoot, 'Microsoft.NET', 'Framework', 'v4.0.30319', 'csc.exe'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

// Compile async on first run; reuse binary on subsequent runs
function buildHelper(onReady) {
  if (fs.existsSync(HELPER_BIN)) {
    helperReady = true;
    onReady();
    return;
  }

  if (IS_WIN) {
    const csc = findCscExe();
    if (!csc) {
      console.warn('[GodMode] .NET Framework csc.exe not found — window tracking disabled.');
      onReady();
      return;
    }
    fs.writeFileSync(WIN_CS_SRC, WIN_CS_CODE);
    exec(`"${csc}" /nologo /out:"${HELPER_BIN}" "${WIN_CS_SRC}"`, (err) => {
      if (!err) {
        helperReady = true;
        console.log('[GodMode] C# window helper compiled.');
      } else {
        console.error('[GodMode] C# compile failed:', err.message);
      }
      onReady();
    });
  } else {
    fs.writeFileSync(SWIFT_SRC, SWIFT_CODE);
    exec(`swiftc "${SWIFT_SRC}" -o "${HELPER_BIN}" 2>/dev/null`, (err) => {
      if (!err) {
        helperReady = true;
        console.log('[GodMode] Swift helper compiled.');
      } else {
        console.error('[GodMode] Swift compile failed:', err.message);
      }
      onReady();
    });
  }
}

// Use compiled bounds binary — no special permissions required on either platform
function getGodotWindowBounds() {
  if (!helperReady) return null;
  try {
    const result = execSync(`"${HELPER_BIN}"`, { timeout: 500 }).toString().trim();
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
    if (IS_WIN) {
      const result = execSync('tasklist /FI "IMAGENAME eq Godot*" /NH /FO CSV 2>nul').toString().trim();
      if (!result || result.toLowerCase().includes('no tasks')) return null;
      for (const line of result.split(/\r?\n/)) {
        const parts = line.split(',').map(s => s.replace(/"/g, '').trim());
        if (parts[0] && parts[0].toLowerCase().startsWith('godot')) {
          const pid = parseInt(parts[1]);
          if (!isNaN(pid)) return { pid, binaryPath: findGodotBinary() };
        }
      }
      return null;
    }
    const result = execSync('ps aux | grep -i "Godot.app" | grep -v grep | head -1').toString().trim();
    if (!result) return null;
    const parts = result.split(/\s+/);
    const pid = parseInt(parts[1]);
    const pathMatch = result.match(/(\S+Godot\.app\/Contents\/MacOS\/Godot)/);
    const binaryPath = pathMatch ? pathMatch[1] : null;
    return { pid, binaryPath };
  } catch {
    return null;
  }
}

function restartGodot(delayMs = 500) {
  // If we launched Godot ourselves
  if (godotProcess) {
    console.log('[GodMode] Restarting Godot (managed process)...');
    godotProcess.kill();
    godotProcess = null;
    setTimeout(launchGodot, delayMs);
    return;
  }

  // If Godot is running externally (user launched it manually)
  const info = findRunningGodotInfo();
  if (info && info.pid) {
    console.log(`[GodMode] Restarting external Godot (PID: ${info.pid})...`);
    try {
      execSync(IS_WIN ? `taskkill /PID ${info.pid} /F` : `kill ${info.pid}`);
      setTimeout(() => {
        if (info.binaryPath) {
          console.log(`[GodMode] Relaunching Godot from: ${info.binaryPath}`);
          if (IS_WIN) {
            spawn(info.binaryPath, ['--path', GAME_PROJECT_PATH], { detached: true, stdio: 'ignore' }).unref();
          } else {
            exec(`"${info.binaryPath}" --path "${GAME_PROJECT_PATH}" &`);
          }
        } else {
          launchGodot();
        }
      }, delayMs);
    } catch (err) {
      console.error('[GodMode] Failed to restart external Godot:', err.message);
    }
  } else {
    console.log('[GodMode] No running Godot found to restart.');
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

  // Capture Godot game window screenshot
  ipcMain.handle('capture-game-window', async () => {
    try {
      const { desktopCapturer } = require('electron');

      // Get all windows
      const sources = await desktopCapturer.getSources({
        types: ['window'],
        thumbnailSize: { width: 1920, height: 1080 }
      });

      // Find Godot window
      const godotWindow = sources.find(source =>
        source.name.toLowerCase().includes('godot') ||
        source.name.toLowerCase().includes('game')
      );

      if (!godotWindow) {
        console.error('[Screenshot] Godot window not found');
        return null;
      }

      // Return thumbnail as data URL
      return godotWindow.thumbnail.toDataURL();
    } catch (err) {
      console.error('[Screenshot] Error:', err);
      return null;
    }
  });

  // Open URL in external browser
  ipcMain.on('open-external', (_event, url) => {
    const { shell } = require('electron');
    shell.openExternal(url);
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
    buildHelper(() => {
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
