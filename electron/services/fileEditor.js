const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const GAME_ROOT = path.join(__dirname, '..', '..', 'example_game', 'godot-FirstPersonStarter-main');

function resolveGamePath(relativePath) {
  const resolved = path.resolve(GAME_ROOT, relativePath);
  // Prevent path traversal outside the game root
  if (!resolved.startsWith(GAME_ROOT)) {
    throw new Error(`Access denied: ${relativePath}`);
  }
  return resolved;
}

function listFiles() {
  const results = [];
  function walk(dir, base = '') {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const rel = base ? `${base}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(path.join(dir, entry.name), rel);
      } else if (entry.name.endsWith('.gd') || entry.name.endsWith('.tscn') || entry.name === 'project.godot') {
        results.push(rel);
      }
    }
  }
  walk(GAME_ROOT);
  return results.join('\n');
}

function readFile(relativePath) {
  const fullPath = resolveGamePath(relativePath);
  if (!fs.existsSync(fullPath)) {
    return `ERROR: File not found: ${relativePath}`;
  }
  return fs.readFileSync(fullPath, 'utf8');
}

function writeFile(relativePath, content) {
  const fullPath = resolveGamePath(relativePath);
  // Backup original
  if (fs.existsSync(fullPath)) {
    fs.writeFileSync(fullPath + '.bak', fs.readFileSync(fullPath));
  }
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content, 'utf8');
  return `Written: ${relativePath}`;
}

function grepFiles(pattern) {
  try {
    const result = execSync(
      `grep -rn ${JSON.stringify(pattern)} ${JSON.stringify(GAME_ROOT)} --include="*.gd" --include="*.tscn" 2>/dev/null`,
      { timeout: 5000 }
    ).toString().trim();
    // Strip the absolute game root prefix from paths for readability
    return result.replace(new RegExp(GAME_ROOT.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '/', 'g'), '');
  } catch (e) {
    if (e.status === 1) return 'No matches found.';
    return `ERROR: ${e.message}`;
  }
}

function checkGodotErrors() {
  // Find Godot binary to run error check
  const godotPaths = [
    '/Applications/Godot.app/Contents/MacOS/Godot',
    '/Applications/Godot_4.app/Contents/MacOS/Godot',
  ];
  
  let godotBin = null;
  for (const p of godotPaths) {
    if (fs.existsSync(p)) {
      godotBin = p;
      break;
    }
  }
  
  // Also check running Godot process
  if (!godotBin) {
    try {
      const psResult = execSync('ps aux | grep -i "Godot.app" | grep -v grep | head -1').toString().trim();
      const pathMatch = psResult.match(/(\S+Godot\.app\/Contents\/MacOS\/Godot)/);
      if (pathMatch) godotBin = pathMatch[1];
    } catch {}
  }
  
  if (!godotBin) {
    return { success: true, warning: 'Godot binary not found - skipping error check' };
  }
  
  // Run Godot headless to check for parse errors
  try {
    const result = execSync(
      `"${godotBin}" --headless --path "${GAME_ROOT}" --check-only 2>&1`,
      { timeout: 10000, encoding: 'utf8' }
    );
    
    // Check if there are actual ERROR lines (not just version info)
    const errors = result.split('\n')
      .filter(line => line.includes('ERROR:') || line.includes('Parse Error'))
      .filter(line => !line.includes('Godot Engine')) // Ignore version line
      .join('\n')
      .trim();
    
    if (errors) {
      return { success: false, error: errors };
    }
    
    return { success: true };
  } catch (e) {
    const output = e.stdout || e.stderr || e.message || '';
    
    // Extract only real ERROR lines, ignore version banner
    const errors = output.split('\n')
      .filter(line => line.includes('ERROR:') || line.includes('Parse Error'))
      .filter(line => !line.includes('Godot Engine')) // Ignore version line
      .filter(line => !line.includes('https://godotengine.org')) // Ignore URL
      .join('\n')
      .trim();
    
    // If no real errors found, consider it success
    if (!errors) {
      return { success: true };
    }
    
    return { success: false, error: errors };
  }
}

module.exports = { listFiles, readFile, writeFile, grepFiles, checkGodotErrors, GAME_ROOT };
