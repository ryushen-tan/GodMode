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

module.exports = { listFiles, readFile, writeFile, grepFiles, GAME_ROOT };
