// Helper script to ensure all GLB files in sprites/ have .import files
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SPRITES_DIR = path.join(__dirname, '..', 'example_game', 'godot-FirstPersonStarter-main', 'sprites');

function createImportFile(glbPath) {
  const glbName = path.basename(glbPath);
  const importPath = `${glbPath}.import`;
  
  if (fs.existsSync(importPath)) {
    console.log(`✓ ${glbName} already has .import`);
    return false;
  }
  
  const hash = crypto.randomBytes(16).toString('hex');
  const uid = glbName.replace(/\.glb$/i, '').replace(/[^a-zA-Z0-9]/g, '_');
  
  const importContent = `[remap]

importer="scene"
importer_version=1
type="PackedScene"
uid="uid://${uid}_uid"
path="res://.godot/imported/${glbName}-${hash}.scn"

[deps]

source_file="res://sprites/${glbName}"
dest_files=["res://.godot/imported/${glbName}-${hash}.scn"]

[params]

nodes/root_type=""
nodes/root_name=""
nodes/apply_root_scale=true
nodes/root_scale=1.0
meshes/ensure_tangents=true
meshes/generate_lods=true
meshes/create_shadow_meshes=true
meshes/light_baking=1
meshes/lightmap_texel_size=0.2
meshes/force_disable_compression=false
skins/use_named_skins=true
animation/import=true
animation/fps=30
animation/trimming=false
animation/remove_immutable_tracks=true
import_script/path=""
_subresources={}
gltf/naming_version=1
gltf/embedded_image_handling=1
`;
  
  fs.writeFileSync(importPath, importContent);
  console.log(`✓ Created ${glbName}.import`);
  return true;
}

function ensureAllImports() {
  if (!fs.existsSync(SPRITES_DIR)) {
    console.error(`Sprites directory not found: ${SPRITES_DIR}`);
    process.exit(1);
  }
  
  const files = fs.readdirSync(SPRITES_DIR);
  const glbFiles = files.filter(f => f.toLowerCase().endsWith('.glb'));
  
  console.log(`\nScanning ${SPRITES_DIR}...`);
  console.log(`Found ${glbFiles.length} GLB files\n`);
  
  let created = 0;
  for (const glbFile of glbFiles) {
    const glbPath = path.join(SPRITES_DIR, glbFile);
    if (createImportFile(glbPath)) {
      created++;
    }
  }
  
  console.log(`\nDone! Created ${created} new .import files`);
}

// Run if called directly
if (require.main === module) {
  ensureAllImports();
}

module.exports = { createImportFile, ensureAllImports };
