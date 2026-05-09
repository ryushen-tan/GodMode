const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');

const GAME_ROOT = path.join(__dirname, '..', '..', 'example_game', 'godot-FirstPersonStarter-main');

function findGodotBinary() {
  const godotPaths = [
    '/Applications/Godot.app/Contents/MacOS/Godot',
    '/Applications/Godot_4.app/Contents/MacOS/Godot',
    '/Applications/Godot_mono.app/Contents/MacOS/Godot',
  ];

  for (const p of godotPaths) {
    if (fs.existsSync(p)) return p;
  }

  try {
    const psResult = execSync('ps aux | grep -i "Godot.app" | grep -v grep | head -1').toString().trim();
    const pathMatch = psResult.match(/(\S+Godot\.app\/Contents\/MacOS\/Godot)/);
    if (pathMatch) return pathMatch[1];
  } catch {}

  return null;
}

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

function parseSpritePath(value) {
  const match = String(value || '').match(/res:\/\/sprites\/([^"'\s)]+\.glb)/i);
  if (!match) return null;
  const filename = path.basename(match[1]);
  return {
    filename,
    resPath: `res://sprites/${filename}`,
    fullPath: resolveGamePath(`sprites/${filename}`)
  };
}

function makeSceneId(prefix, input) {
  const hash = crypto.createHash('sha1').update(input).digest('hex').slice(0, 8);
  return `${prefix}_${hash}`;
}

function makeNodeName(filename, sceneContent) {
  const base = path.basename(filename, '.glb')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('') || 'GeneratedModel';

  let name = base;
  let i = 2;
  while (sceneContent.includes(`[node name="${name}"`)) {
    name = `${base}${i++}`;
  }
  return name;
}

function parsePosition(prompt) {
  const match = String(prompt || '').match(/position\s*\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)/i);
  if (!match) return { x: 0, y: 2, z: 0 };
  return { x: Number(match[1]), y: Number(match[2]), z: Number(match[3]) };
}

function importDestinationsExist(importPath) {
  if (!fs.existsSync(importPath)) return false;
  const content = fs.readFileSync(importPath, 'utf8');
  const match = content.match(/^dest_files=\[(.*)\]/m);
  if (!match) return false;
  const destFiles = [...match[1].matchAll(/"res:\/\/([^"]+)"/g)]
    .map((item) => path.join(GAME_ROOT, item[1]));
  return destFiles.length > 0 && destFiles.every((file) => fs.existsSync(file));
}

function runGodotImport() {
  const godotBin = findGodotBinary();
  if (!godotBin) {
    return { success: true, warning: 'Godot binary not found - import will run when Godot opens' };
  }

  try {
    execSync(`"${godotBin}" --headless --path "${GAME_ROOT}" --import 2>&1`, {
      timeout: 90000,
      encoding: 'utf8'
    });
    return { success: true };
  } catch (e) {
    const output = e.stdout || e.stderr || e.message || '';
    const errors = extractGodotErrors(output);
    if (!errors) return { success: true };
    return { success: false, error: errors };
  }
}

function extractGodotErrors(output) {
  return String(output || '')
    .split('\n')
    .filter(line => line.includes('ERROR:') || line.includes('Parse Error'))
    .filter(line => !line.includes('Godot Engine'))
    .filter(line => !line.includes('https://godotengine.org'))
    .join('\n')
    .trim();
}

function ensureSpriteImport(sprite) {
  if (!fs.existsSync(sprite.fullPath)) {
    throw new Error(`Sprite GLB not found: ${sprite.resPath}`);
  }

  const importPath = `${sprite.fullPath}.import`;
  let created = false;

  if (!fs.existsSync(importPath)) {
    const { createImportFile } = require('../../backend/ensure-imports');
    createImportFile(sprite.fullPath);
    created = true;
  }

  if (!importDestinationsExist(importPath)) {
    const imported = runGodotImport();
    if (!imported.success) {
      throw new Error(`Godot failed to import ${sprite.resPath}:\n${imported.error}`);
    }
  }

  return { created, importPath };
}

function getImportUid(importPath, sprite) {
  if (fs.existsSync(importPath)) {
    const content = fs.readFileSync(importPath, 'utf8');
    const match = content.match(/^uid="([^"]+)"/m);
    if (match) return match[1];
  }
  return `uid://${makeSceneId('gm', sprite.filename)}`;
}

function findExtResourceId(sceneContent, resPath) {
  const escapedPath = resPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = sceneContent.match(new RegExp(`\\[ext_resource[^\\]]*path="${escapedPath}"[^\\]]*id="([^"]+)"[^\\]]*\\]`));
  return match ? match[1] : null;
}

function insertExtResource(sceneContent, line) {
  const firstSubResource = sceneContent.search(/\n\[sub_resource /);
  const firstNode = sceneContent.search(/\n\[node /);
  const insertAt = firstSubResource !== -1 ? firstSubResource : firstNode;
  if (insertAt === -1) return `${sceneContent.trimEnd()}\n${line}\n`;
  return `${sceneContent.slice(0, insertAt)}\n${line}${sceneContent.slice(insertAt)}`;
}

function addSpriteToMainScene(prompt) {
  const sprite = parseSpritePath(prompt);
  if (!sprite) {
    throw new Error('No res://sprites/*.glb path found in prompt');
  }

  const importResult = ensureSpriteImport(sprite);
  const scenePath = 'Levels/Main/L_Main.tscn';
  let sceneContent = readFile(scenePath);
  if (sceneContent.startsWith('ERROR:')) {
    throw new Error(sceneContent);
  }

  let resourceId = findExtResourceId(sceneContent, sprite.resPath);
  if (!resourceId) {
    resourceId = makeSceneId('gm', sprite.filename);
    const uid = getImportUid(importResult.importPath, sprite);
    const extLine = `[ext_resource type="PackedScene" uid="${uid}" path="${sprite.resPath}" id="${resourceId}"]`;
    sceneContent = insertExtResource(sceneContent, extLine);
  }

  if (sceneContent.includes(`instance=ExtResource("${resourceId}")`)) {
    return {
      scenePath,
      spritePath: sprite.resPath,
      importCreated: importResult.created,
      changed: importResult.created,
      message: `${sprite.resPath} is already instanced in ${scenePath}`
    };
  }

  const pos = parsePosition(prompt);
  const nodeName = makeNodeName(sprite.filename, sceneContent);
  const uniqueId = Number.parseInt(crypto.randomBytes(4).toString('hex'), 16) % 2000000000;
  const nodeBlock = [
    '',
    `[node name="${nodeName}" parent="." unique_id=${uniqueId} instance=ExtResource("${resourceId}")]`,
    `transform = Transform3D(1, 0, 0, 0, 1, 0, 0, 0, 1, ${pos.x}, ${pos.y}, ${pos.z})`,
    ''
  ].join('\n');

  writeFile(scenePath, `${sceneContent.trimEnd()}${nodeBlock}`);
  return {
    scenePath,
    spritePath: sprite.resPath,
    nodeName,
    importCreated: importResult.created,
    changed: true,
    message: `Added ${sprite.resPath} to ${scenePath} as ${nodeName}`
  };
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
  const importResult = runGodotImport();
  if (!importResult.success) {
    return { success: false, error: importResult.error };
  }

  const godotBin = findGodotBinary();
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
    const errors = extractGodotErrors(result);
    
    if (errors) {
      return { success: false, error: errors };
    }
    
    return { success: true };
  } catch (e) {
    const output = e.stdout || e.stderr || e.message || '';
    
    // Extract only real ERROR lines, ignore version banner
    const errors = extractGodotErrors(output);
    
    // If no real errors found, consider it success
    if (!errors) {
      return { success: true };
    }
    
    return { success: false, error: errors };
  }
}

module.exports = {
  listFiles,
  readFile,
  writeFile,
  grepFiles,
  checkGodotErrors,
  addSpriteToMainScene,
  GAME_ROOT
};
