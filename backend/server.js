// Loud crash handlers so we never silently exit at startup again.
process.on('uncaughtException', (err) => {
  console.error('[backend] UNCAUGHT EXCEPTION:', err && err.stack ? err.stack : err);
  process.exit(1);
});
process.on('unhandledRejection', (err) => {
  console.error('[backend] UNHANDLED REJECTION:', err && err.stack ? err.stack : err);
  process.exit(1);
});

console.log('[backend] starting…');

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
console.log('[backend] env loaded');

const tick = (label) => console.log(`[backend] ✓ ${label}`);

const crypto = require('crypto');
const express = require('express'); tick('express');
const cors = require('cors'); tick('cors');
const multer = require('multer'); tick('multer');
const axios = require('axios'); tick('axios');
const FormDataNode = require('form-data'); tick('form-data');
const {
  BedrockRuntimeClient,
  InvokeModelCommand,
} = require('@aws-sdk/client-bedrock-runtime'); tick('bedrock-runtime');
const {
  BedrockClient,
  ListFoundationModelsCommand,
  ListInferenceProfilesCommand,
} = require('@aws-sdk/client-bedrock'); tick('bedrock-control');
const fs = require('fs');
const sharp = require('sharp');
const { renderGlbToPng } = require('./render_glb_preview');
const { uploadGenerated3DAsset } = require('./cloudinary_upload');
const { sendSmsViaPingram } = require('./pingram_sms');
const { NodeIO } = require('@gltf-transform/core'); tick('gltf-transform/core');
const { ALL_EXTENSIONS } = require('@gltf-transform/extensions'); tick('gltf-transform/extensions');
const { bounds } = require('@gltf-transform/functions'); tick('gltf-transform/functions');
// Optional: only used by the 3D mesh-merge / scale post-process. If the
// dep isn't installed locally we still want the rest of the backend to
// boot — particularly the 2D pipeline.
let draco3d = null;
try {
  draco3d = require('draco3dgltf');
} catch (err) {
  console.warn('[backend] draco3dgltf not installed — 3D merge/scale disabled. Run `npm install` in backend/.');
}

const PORT = Number(process.env.BACKEND_PORT || 3001);
const REGION = process.env.AWS_REGION || 'us-east-1';
const MODEL_ID = process.env.BEDROCK_IMAGE_MODEL_ID || 'amazon.nova-canvas-v1:0';
const VISION_MODEL_ID = process.env.BEDROCK_VISION_MODEL_ID || 'us.anthropic.claude-3-5-haiku-20241022-v1:0';
const MESHY_API_KEY = process.env.MESHY_API_KEY || '';
const MESHY_BASE = 'https://api.meshy.ai/openapi/v1';
const STABILITY_API_KEY = process.env.STABILITY_API_KEY || '';
const STABILITY_FAST_3D_URL = 'https://api.stability.ai/v2beta/3d/stable-fast-3d';
const TRIPOSR_URL = (process.env.TRIPOSR_URL || '').replace(/\/+$/, '');
const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN || '';
// camenduru/tripo-sr stable revision hash — the well-known hosted TripoSR.
const REPLICATE_TRIPOSR_VERSION = 'e0d3fe8abce3ba86497ea3530d9eae59af7b2231b6c82bedfc32b0732d35ec3a';

// CyStack Security Integration
const { initializeCyStack } = require('./security/cystack-integration');
const cystack = initializeCyStack();

// Composio Reddit Integration
const { getComposioService } = require('./services/composio-reddit');
const composio = getComposioService();
const { getCultsService } = require('./services/composio-cults');
const cults = getCultsService();

tick(`config (port=${PORT}, region=${REGION})`);
const bedrock = new BedrockRuntimeClient({ region: REGION }); tick('bedrock client');
const bedrockControl = new BedrockClient({ region: REGION }); tick('bedrock control client');

const app = express();
app.use(cors());
app.use(express.json({ limit: '20mb' }));
tick('express app');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
});

// In-memory stores. Fine for hackathon; restart wipes everything.
const images = new Map(); // id -> { buffer, mime }
const jobs = new Map();   // jobId -> { polls, pollsUntilDone, imageUrl }

const baseUrl = () => `http://localhost:${PORT}`;
const publicImageUrl = (id) => `${baseUrl()}/images/${id}`;

function storeImage(buffer, mime) {
  const id = crypto.randomBytes(8).toString('hex');
  images.set(id, { buffer, mime });
  return id;
}

function imageIdFromUrl(url) {
  const m = String(url || '').match(/\/images\/([0-9a-f]+)/i);
  return m ? m[1] : null;
}


// --- Routes ---

app.get('/health', (_req, res) => {
  res.json({ ok: true, region: REGION, model: MODEL_ID });
});

// SMS test endpoint
app.post('/api/sms/test', async (req, res) => {
  const { message } = req.body || {};
  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: 'message string required' });
  }
  try {
    const out = await sendSmsViaPingram({ message });
    res.json({ ok: true, result: out || null });
  } catch (e) {
    res.status(502).json({ ok: false, error: e.message || String(e) });
  }
});

// CyStack telemetry endpoint
app.get('/api/cystack/telemetry', (_req, res) => {
  try {
    const telemetry = cystack.telemetry.getTelemetry(100);
    res.json({
      organizationId: cystack.config.organizationId,
      sessionId: cystack.telemetry.sessionId,
      telemetryEnabled: cystack.config.telemetryEnabled,
      totalEvents: telemetry.length,
      events: telemetry,
    });
  } catch (err) {
    console.error('[cystack/telemetry] error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// Composio Reddit Integration Endpoints
// ============================================================================

// Check Reddit connection status
app.get('/api/reddit/status', async (_req, res) => {
  try {
    await composio.initialize();
    const status = await composio.checkConnection();
    res.json(status);
  } catch (err) {
    console.error('[reddit/status] error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Get Reddit OAuth connection URL
app.get('/api/reddit/connect', async (_req, res) => {
  try {
    await composio.initialize();
    const { url, connectionId } = await composio.getConnectionUrl();
    res.json({ url, connectionId });
  } catch (err) {
    console.error('[reddit/connect] error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Post screenshot to Reddit
app.post('/api/reddit/post', upload.single('screenshot'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No screenshot provided' });
    }

    const title = req.body.title || 'Check out my game! Made with GodMode 🎮';
    const subreddit = req.body.subreddit || 'SOONHackathon';
    const imageBuffer = req.file.buffer;

    await composio.initialize();
    const result = await composio.postToReddit(title, subreddit, imageBuffer);

    res.json(result);
  } catch (err) {
    console.error('[reddit/post] error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Available base GLBs from example_game/sprites/. The renderer's dropdown
// is populated from this list so the user can pick which model to merge
// the AI 2D output into.
const SPRITES_DIR = path.join(
  __dirname,
  '..',
  'example_game',
  'godot-FirstPersonStarter-main',
  'sprites',
);

function saveSpriteGlb(filename, glbBuf) {
  const spritePath = path.join(SPRITES_DIR, filename);
  fs.writeFileSync(spritePath, glbBuf);
  const { createImportFile } = require('./ensure-imports');
  createImportFile(spritePath);
  return spritePath;
}

app.get('/api/sprites', (_req, res) => {
  try {
    const files = fs
      .readdirSync(SPRITES_DIR)
      .filter((f) => f.toLowerCase().endsWith('.glb'))
      .sort();
    res.json({ sprites: files });
  } catch (err) {
    res.status(500).json({ error: err.message, sprites: [] });
  }
});

// Ensure all GLB files have .import files (auto-fix missing imports)
app.post('/api/sprites/ensure-imports', (_req, res) => {
  try {
    const { ensureAllImports } = require('./ensure-imports');
    const files = fs.readdirSync(SPRITES_DIR).filter(f => f.toLowerCase().endsWith('.glb'));
    let created = 0;
    
    for (const glbFile of files) {
      const glbPath = path.join(SPRITES_DIR, glbFile);
      const importPath = `${glbPath}.import`;
      
      if (!fs.existsSync(importPath)) {
        const hash = crypto.randomBytes(16).toString('hex');
        const uid = glbFile.replace(/\.glb$/i, '').replace(/[^a-zA-Z0-9]/g, '_');
        const importContent = `[remap]

importer="scene"
importer_version=1
type="PackedScene"
uid="uid://${uid}_uid"
path="res://.godot/imported/${glbFile}-${hash}.scn"

[deps]

source_file="res://sprites/${glbFile}"
dest_files=["res://.godot/imported/${glbFile}-${hash}.scn"]

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
        console.log(`[ensure-imports] Created ${glbFile}.import`);
        created++;
      }
    }
    
    res.json({ total: files.length, created, message: `Created ${created} missing .import files` });
  } catch (err) {
    console.error('[ensure-imports] error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Diagnostic: open a sprite with gltf-transform and report what was loaded.
// Lets us verify the base GLB is actually being parsed correctly before we
// try to merge anything into it.
app.get('/api/sprites/:name/inspect', async (req, res) => {
  const name = req.params.name;
  const full = path.join(SPRITES_DIR, name);
  if (!fs.existsSync(full)) return res.status(404).json({ error: 'not found' });
  try {
    const io = new NodeIO()
      .registerExtensions(ALL_EXTENSIONS)
      .registerDependencies({
        'draco3d.decoder': await draco3d.createDecoderModule(),
        'draco3d.encoder': await draco3d.createEncoderModule(),
      });
    const doc = await io.read(full);
    const root = doc.getRoot();
    const scenes = root.listScenes();
    const meshes = root.listMeshes();
    const materials = root.listMaterials();
    const textures = root.listTextures();
    const totalVertices = meshes.reduce((sum, m) => {
      return sum + m.listPrimitives().reduce((s, p) => {
        const pos = p.getAttribute('POSITION');
        return s + (pos ? pos.getCount() : 0);
      }, 0);
    }, 0);
    res.json({
      name,
      fileSize: fs.statSync(full).size,
      scenes: scenes.length,
      meshes: meshes.length,
      materials: materials.length,
      textures: textures.length,
      totalVertices,
      bounds: doc.getRoot().listScenes()[0]
        ? bounds(doc.getRoot().listScenes()[0])
        : null,
      extensions: root.listExtensionsUsed().map((e) => e.extensionName),
    });
  } catch (err) {
    res.status(500).json({ error: err.message, stack: err.stack });
  }
});

// Serve the original sprite GLBs (so the renderer can preview them)
app.get('/sprites/:name', (req, res) => {
  const name = req.params.name;
  if (!name.toLowerCase().endsWith('.glb')) return res.status(400).end();
  const full = path.join(SPRITES_DIR, name);
  if (!full.startsWith(SPRITES_DIR)) return res.status(400).end();
  if (!fs.existsSync(full)) return res.status(404).end();
  res.setHeader('Content-Type', 'model/gltf-binary');
  fs.createReadStream(full).pipe(res);
});

// Diagnostic: list image-output foundation models and inference profiles
app.get('/api/bedrock-models', async (_req, res) => {
  try {
    const fm = await bedrockControl.send(new ListFoundationModelsCommand({
      byOutputModality: 'IMAGE',
    }));
    let profiles = [];
    try {
      const ip = await bedrockControl.send(new ListInferenceProfilesCommand({}));
      profiles = (ip.inferenceProfileSummaries || []).map(p => ({
        id: p.inferenceProfileId,
        name: p.inferenceProfileName,
        status: p.status,
      }));
    } catch (e) { /* not all accounts/regions support this */ }

    const models = (fm.modelSummaries || []).map(m => ({
      id: m.modelId,
      name: m.modelName,
      provider: m.providerName,
      lifecycle: m.modelLifecycle && m.modelLifecycle.status,
      inputs: m.inputModalities,
      outputs: m.outputModalities,
      onDemand: (m.inferenceTypesSupported || []).includes('ON_DEMAND'),
    }));
    res.json({ region: REGION, models, profiles });
  } catch (err) {
    res.status(500).json({ error: err.message, name: err.name });
  }
});

app.get('/images/:id', (req, res) => {
  const img = images.get(req.params.id);
  if (!img) return res.status(404).json({ error: 'not found' });
  res.setHeader('Content-Type', img.mime);
  res.setHeader('Cache-Control', 'no-store');
  res.end(img.buffer);
});

app.post('/api/upload-image', upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'image field required' });
  const id = storeImage(req.file.buffer, req.file.mimetype || 'image/png');
  res.json({ imageUrl: publicImageUrl(id), id });
});

// Bedrock Stability: sketch -> polished image (control models) OR
// base + mask + prompt -> inpainted image (inpaint model, when maskUrl is provided).
app.post('/api/generate-2d', async (req, res) => {
  const { imageUrl, maskUrl, prompt } = req.body || {};
  if (!imageUrl) return res.status(400).json({ error: 'imageUrl required' });

  const id = imageIdFromUrl(imageUrl);
  if (!id) return res.status(400).json({ error: 'unsupported imageUrl (must be from /images/)' });

  const stored = images.get(id);
  if (!stored) return res.status(404).json({ error: 'image not found' });

  // Optional mask for inpainting mode
  let maskStored = null;
  if (maskUrl) {
    const maskId = imageIdFromUrl(maskUrl);
    if (maskId) maskStored = images.get(maskId) || null;
  }

  // Image-to-image preserving structure: Control Structure (or Control Sketch)
  // uses the input image's edges/composition as a tight constraint, so the
  // base photo stays recognizable while user-added strokes get rendered cleanly.
  const userPrompt = (prompt && prompt.trim()) || '';
  const text = userPrompt
    ? `${userPrompt}, photorealistic, high quality, preserve original details`
    : 'photorealistic, high quality, preserve original details, refined edges';

  const inputB64 = stored.buffer.toString('base64');

  // Build request body based on model family. Bedrock model APIs differ.
  // Inference profile IDs like `us.stability.*` route to a stability model.
  const INPAINT_MODEL_ID = 'us.stability.stable-image-inpaint-v1:0';
  const useInpaint = !!maskStored;
  const effectiveModelId = useInpaint ? INPAINT_MODEL_ID : MODEL_ID;
  const stripped = effectiveModelId.replace(/^us\.|^eu\.|^apac\./, '');
  const isStabilityInpaint = stripped.includes('stable-image-inpaint');
  const isStabilityControl =
    stripped.includes('stable-image-control-sketch') ||
    stripped.includes('stable-image-control-structure');
  const isStability = stripped.startsWith('stability.');
  const isAmazon = stripped.startsWith('amazon.');

  let body;
  if (isStabilityInpaint) {
    // Stability Inpaint: regenerates ONLY the white/non-zero areas of the mask,
    // leaving the rest of the input image pixel-perfect identical.
    body = {
      prompt: text,
      image: inputB64,
      mask: maskStored.buffer.toString('base64'),
      output_format: 'png',
      seed: Math.floor(Math.random() * 1_000_000),
    };
  } else if (isStabilityControl) {
    // Stability Control Sketch / Structure: input image is a tight guide;
    // higher control_strength = output stays closer to the input's edges
    // and composition. 0.85 keeps the base photo recognizable while still
    // letting the model clean up rough strokes drawn on top.
    body = {
      prompt: text,
      image: inputB64,
      control_strength: 0.85,
      output_format: 'png',
      seed: Math.floor(Math.random() * 1_000_000),
    };
  } else if (isStability) {
    // Stable Image Core / Ultra / SD3.5 (text+optional image-to-image)
    body = {
      prompt: text,
      mode: 'image-to-image',
      image: inputB64,
      strength: 0.6,
      output_format: 'png',
      seed: Math.floor(Math.random() * 1_000_000),
    };
  } else if (isAmazon) {
    // Nova Canvas / Titan Image Generator
    body = {
      taskType: 'TEXT_IMAGE',
      textToImageParams: {
        text,
        conditionImage: inputB64,
        controlMode: 'CANNY_EDGE',
        controlStrength: 0.7,
      },
      imageGenerationConfig: {
        numberOfImages: 1,
        height: 512,
        width: 512,
        cfgScale: 7.0,
        seed: Math.floor(Math.random() * 1_000_000),
      },
    };
  } else {
    return res.status(400).json({
      error: `Unsupported model ID "${MODEL_ID}". Expected amazon.* or stability.*`,
    });
  }

  async function invokeAndExtract(modelIdToUse, bodyToUse) {
    const cmd = new InvokeModelCommand({
      modelId: modelIdToUse,
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify(bodyToUse),
    });
    const resp = await bedrock.send(cmd);
    const json = JSON.parse(new TextDecoder().decode(resp.body));
    const b64 =
      (json.images && json.images[0]) ||
      json.image ||
      (json.artifacts && json.artifacts[0] && json.artifacts[0].base64);
    return { b64, json };
  }

  try {
    const { b64, json } = await invokeAndExtract(effectiveModelId, body);

    if (!b64) {
      const reasons = (json && json.finish_reasons) || [];
      const filtered = reasons.some((r) => /filter/i.test(String(r)));
      return res.status(502).json({
        error: filtered ? 'safety filter rejected input' : 'bedrock returned no image',
        filtered,
        finishReasons: reasons,
        detail: json,
      });
    }
    const buf = Buffer.from(b64, 'base64');
    const newId = storeImage(buf, 'image/png');
    res.json({ imageUrl: publicImageUrl(newId), id: newId });
  } catch (err) {
    console.error('[generate-2d] bedrock error:', err);
    res.status(500).json({ error: err.message || String(err), name: err.name });
  }
});

// Real 3D generation via Meshy (image-to-3D)
// Job state: jobId -> { meshyTaskId, lastStatus, lastProgress, lastModelUrl, lastError }

function meshyHeaders() {
  return {
    'Authorization': `Bearer ${MESHY_API_KEY}`,
    'Content-Type': 'application/json',
  };
}

// Ask Claude on Bedrock to describe the image as a prompt for Meshy.
// Meshy uses this prompt to guide colors / materials / style — without it
// the model regresses toward training-set averages (e.g., green bottles
// come out cream).
async function describeImageForMeshy(imageBuffer, mime, userPrompt) {
  const body = {
    anthropic_version: 'bedrock-2023-05-31',
    max_tokens: 120,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: mime || 'image/png',
              data: imageBuffer.toString('base64'),
            },
          },
          {
            type: 'text',
            text:
              'Describe this object as a detailed prompt for a 3D asset generator. ' +
              'Include the specific colors, material/finish (glossy, matte, metallic, painted, etc.), ' +
              'shape proportions, and any decorative features visible. ' +
              'One concise sentence, ~20 words. No leading text, just the description.' +
              (userPrompt ? ` The user mentioned: "${userPrompt}". Incorporate that.` : ''),
          },
        ],
      },
    ],
  };
  const cmd = new InvokeModelCommand({
    modelId: VISION_MODEL_ID,
    contentType: 'application/json',
    accept: 'application/json',
    body: JSON.stringify(body),
  });
  const resp = await bedrock.send(cmd);
  const json = JSON.parse(new TextDecoder().decode(resp.body));
  const text = json && json.content && json.content[0] && json.content[0].text;
  return (text || '').trim();
}

// Strip the background to transparent via Stability Remove Background.
// Meshy gets a cleaner subject and produces a tighter, less wasteful mesh.
async function removeBackgroundViaBedrock(imageBuffer) {
  const cmd = new InvokeModelCommand({
    modelId: 'us.stability.stable-image-remove-background-v1:0',
    contentType: 'application/json',
    accept: 'application/json',
    body: JSON.stringify({
      image: imageBuffer.toString('base64'),
      output_format: 'png',
    }),
  });
  const resp = await bedrock.send(cmd);
  const json = JSON.parse(new TextDecoder().decode(resp.body));
  const b64 = (json.images && json.images[0]) || json.image;
  if (!b64) throw new Error('Bedrock remove-bg returned no image');
  return Buffer.from(b64, 'base64');
}

// Merge an addition GLB into a base GLB.
// If featureBbox is provided (the 2D bounding box of the user's drawing in
// canvas coords), the addition is placed at the corresponding 3D location
// on the front face of the base — so a crown drawn on the side of a bottle
// in 2D appears on the side of the 3D bottle. Otherwise falls back to "on
// top of base, centered."
async function mergeGlbs(baseGlbPath, additionGlbBuffer, featureBbox) {
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  if (draco3d) {
    io.registerDependencies({
      'draco3d.decoder': await draco3d.createDecoderModule(),
      'draco3d.encoder': await draco3d.createEncoderModule(),
    });
  }
  const baseDoc = await io.read(baseGlbPath);
  const additionDoc = await io.readBinary(additionGlbBuffer);

  const baseBounds = bounds(baseDoc.getRoot().listScenes()[0]);
  const addBounds = bounds(additionDoc.getRoot().listScenes()[0]);

  const baseSize = [
    baseBounds.max[0] - baseBounds.min[0],
    baseBounds.max[1] - baseBounds.min[1],
    baseBounds.max[2] - baseBounds.min[2],
  ];
  const addSize = [
    addBounds.max[0] - addBounds.min[0],
    addBounds.max[1] - addBounds.min[1],
    addBounds.max[2] - addBounds.min[2],
  ];
  const addCenter = [
    (addBounds.min[0] + addBounds.max[0]) / 2,
    (addBounds.min[1] + addBounds.max[1]) / 2,
    (addBounds.min[2] + addBounds.max[2]) / 2,
  ];
  const baseMax = Math.max(...baseSize);
  const addMax = Math.max(...addSize) || 1;

  let targetScale;
  let target3D;

  if (featureBbox && featureBbox.canvasW && featureBbox.canvasH) {
    // Map the 2D bbox into 3D assuming the photo was a front-view of the
    // base mesh. Image Y is top-down, world Y is bottom-up, so invert.
    const bxNorm = (featureBbox.x + featureBbox.w / 2) / featureBbox.canvasW; // 0..1, left->right
    const byNorm = (featureBbox.y + featureBbox.h / 2) / featureBbox.canvasH; // 0..1, top->bottom
    const wNorm = featureBbox.w / featureBbox.canvasW;
    const hNorm = featureBbox.h / featureBbox.canvasH;
    const bboxRel = Math.max(wNorm, hNorm);
    targetScale = (baseMax * bboxRel) / addMax;

    target3D = {
      x: baseBounds.min[0] + bxNorm * baseSize[0],
      y: baseBounds.max[1] - byNorm * baseSize[1],
      // Place slightly in front of the base so the addition isn't buried.
      z: baseBounds.max[2] + baseSize[2] * 0.05,
    };
    console.log(
      `[merge] bbox-positioned: target3D=(${target3D.x.toFixed(3)}, ${target3D.y.toFixed(3)}, ${target3D.z.toFixed(3)}) scale=${targetScale.toFixed(3)}`,
    );
  } else {
    // Fallback: top-of-base, centered.
    targetScale = (baseMax * 0.25) / addMax;
    target3D = {
      x: (baseBounds.min[0] + baseBounds.max[0]) / 2,
      y: baseBounds.max[1] + baseMax * 0.02 + (addBounds.max[1] - addBounds.min[1]) * targetScale * 0.5,
      z: (baseBounds.min[2] + baseBounds.max[2]) / 2,
    };
    console.log('[merge] no bbox — placing addition on top of base');
  }

  // Translation so the addition's center lands at target3D after scaling.
  const tx = target3D.x - addCenter[0] * targetScale;
  const ty = target3D.y - addCenter[1] * targetScale;
  const tz = target3D.z - addCenter[2] * targetScale;

  const wrapper = additionDoc.createNode('addition-anchor')
    .setTranslation([tx, ty, tz])
    .setScale([targetScale, targetScale, targetScale]);

  for (const scene of additionDoc.getRoot().listScenes()) {
    for (const node of scene.listChildren()) {
      scene.removeChild(node);
      wrapper.addChild(node);
    }
    scene.addChild(wrapper);
  }

  baseDoc.merge(additionDoc);

  // Move all of additionDoc's scenes' children into baseDoc's main scene.
  const baseScene = baseDoc.getRoot().listScenes()[0];
  const allScenes = baseDoc.getRoot().listScenes();
  for (let i = 1; i < allScenes.length; i++) {
    for (const child of allScenes[i].listChildren()) {
      allScenes[i].removeChild(child);
      baseScene.addChild(child);
    }
    allScenes[i].dispose();
  }

  return Buffer.from(await io.writeBinary(baseDoc));
}

// Scale a Meshy-generated GLB so its largest dimension matches the base
// sprite's largest dimension. Returns the rescaled GLB as a Buffer.
async function scaleGlbToMatchBase(meshyGlbBuffer, baseGlbPath) {
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  if (draco3d) {
    io.registerDependencies({
      'draco3d.decoder': await draco3d.createDecoderModule(),
      'draco3d.encoder': await draco3d.createEncoderModule(),
    });
  }

  const baseDoc = await io.read(baseGlbPath);
  const meshyDoc = await io.readBinary(meshyGlbBuffer);

  const baseScene = baseDoc.getRoot().listScenes()[0];
  const meshyScene = meshyDoc.getRoot().listScenes()[0];
  if (!baseScene || !meshyScene) throw new Error('missing scene in base or meshy GLB');

  const bb = bounds(baseScene);
  const mb = bounds(meshyScene);
  const baseMax = Math.max(bb.max[0] - bb.min[0], bb.max[1] - bb.min[1], bb.max[2] - bb.min[2]);
  const meshyMax = Math.max(mb.max[0] - mb.min[0], mb.max[1] - mb.min[1], mb.max[2] - mb.min[2]);
  if (!isFinite(baseMax) || !isFinite(meshyMax) || meshyMax === 0) {
    throw new Error(`bad bounds: base=${baseMax}, meshy=${meshyMax}`);
  }
  const scale = baseMax / meshyMax;
  console.log(`[scale] base=${baseMax.toFixed(3)}, meshy=${meshyMax.toFixed(3)}, factor=${scale.toFixed(3)}`);

  // Wrap all root nodes in one uniformly-scaled wrapper.
  const wrapper = meshyDoc.createNode('scale-to-base').setScale([scale, scale, scale]);
  for (const node of meshyScene.listChildren()) {
    meshyScene.removeChild(node);
    wrapper.addChild(node);
  }
  meshyScene.addChild(wrapper);

  return Buffer.from(await io.writeBinary(meshyDoc));
}

function meshyToJobStatus(meshyStatus) {
  switch (meshyStatus) {
    case 'PENDING':     return 'queued';
    case 'IN_PROGRESS': return 'processing';
    case 'SUCCEEDED':   return 'completed';
    case 'FAILED':
    case 'CANCELED':    return 'failed';
    case 'EXPIRED':     return 'failed';
    default:            return 'processing';
  }
}

app.post('/api/3d/start', async (req, res) => {
  const { imageUrl, prompt, baseSprite, scaleOnly } = req.body || {};
  if (!imageUrl) return res.status(400).json({ error: 'imageUrl required' });
  if (!MESHY_API_KEY) {
    return res.status(500).json({ error: 'MESHY_API_KEY missing in .env' });
  }

  // Resolve our /images/<id> URL to a data URL — Meshy needs to be able
  // to fetch the image, and our backend isn't publicly reachable.
  const id = imageIdFromUrl(imageUrl);
  if (!id) return res.status(400).json({ error: 'unsupported imageUrl (must be from /images/)' });
  const stored = images.get(id);
  if (!stored) return res.status(404).json({ error: 'image not found' });

  // Best-effort: strip the background so Meshy focuses on the subject.
  // If it fails (filter, missing model access, etc.), fall back to original.
  let imgBuffer = stored.buffer;
  let imgMime = stored.mime;
  try {
    console.log('[3d/start] removing background…');
    imgBuffer = await removeBackgroundViaBedrock(stored.buffer);
    imgMime = 'image/png';
    console.log(`[3d/start] background removed (${imgBuffer.length} bytes)`);
  } catch (err) {
    console.warn('[3d/start] remove-bg failed, sending original:', err.message);
  }
  const dataUrl = `data:${imgMime};base64,${imgBuffer.toString('base64')}`;

  // Describe the image so Meshy gets a prompt that captures color/material
  // detail. Falls back to the user's prompt or empty.
  let meshyPrompt = (prompt && prompt.trim()) || '';
  try {
    const desc = await describeImageForMeshy(imgBuffer, imgMime, prompt);
    if (desc) {
      meshyPrompt = desc;
      console.log(`[3d/start] auto prompt: "${desc}"`);
    }
  } catch (err) {
    console.warn('[3d/start] image describe failed:', err.message);
  }

  try {
    const meshyResp = await fetch(`${MESHY_BASE}/image-to-3d`, {
      method: 'POST',
      headers: meshyHeaders(),
      body: JSON.stringify({
        image_url: dataUrl,
        ai_model: 'meshy-6',
        topology: 'triangle',
        // Lower polycount = faster remesh + faster texture bake.
        // Doesn't change color/material quality, only mesh density.
        target_polycount: 10000,
        should_remesh: true,
        should_texture: true,
        // Critical for color/style fidelity — without a prompt, Meshy
        // averages toward training-set defaults.
        prompt: meshyPrompt || undefined,
      }),
    });
    if (!meshyResp.ok) {
      const text = await meshyResp.text().catch(() => '');
      return res.status(502).json({ error: `meshy POST failed (${meshyResp.status})`, detail: text });
    }
    const json = await meshyResp.json();
    const meshyTaskId = json.result;
    if (!meshyTaskId) {
      return res.status(502).json({ error: 'meshy did not return a task id', detail: json });
    }

    const jobId = `job-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
    jobs.set(jobId, {
      jobId,
      meshyTaskId,
      lastStatus: 'queued',
      lastProgress: 0,
      lastModelUrl: null,
      lastError: null,
      prompt: prompt || null,
      autoPrompt: meshyPrompt || null,
      baseSprite: baseSprite || null,
      scaleOnly: !!scaleOnly,
    });
    console.log(`[3d/start] jobId=${jobId} meshyTask=${meshyTaskId}`);
    res.json({ jobId, status: 'queued', autoPrompt: meshyPrompt || null });
  } catch (err) {
    console.error('[3d/start] error:', err);
    res.status(500).json({ error: err.message || String(err) });
  }
});

// Persist merged/scaled GLBs in memory; serve via /merged/<id>.glb.
const mergedGlbs = new Map(); // id -> Buffer
const mergedPreviews = new Map(); // id -> PNG Buffer

async function generatePlaceholderPreviewPng(glbBuffer) {
  // Server-side GLB rendering is non-trivial (needs WebGL/headless GPU).
  // For now, generate a deterministic placeholder preview so the UI has
  // something to show and Cloudinary uploads can proceed.
  const size = 512;
  const hash = crypto.createHash('sha256').update(glbBuffer).digest('hex');
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">` +
    `<rect width="100%" height="100%" fill="#0b1020"/>` +
    `<text x="50%" y="45%" dominant-baseline="middle" text-anchor="middle" fill="#ffffff" font-family="Arial" font-size="28">GLB Preview</text>` +
    `<text x="50%" y="55%" dominant-baseline="middle" text-anchor="middle" fill="#9aa4b2" font-family="Menlo,monospace" font-size="16">${hash.slice(0, 16)}</text>` +
    `</svg>`;
  return await sharp(Buffer.from(svg)).png().toBuffer();
}

async function generateRealPreviewPngForId(outId, glbBuffer) {
  // Render from the in-memory /merged/<id>.glb URL so the loader can fetch it.
  // Ensure the GLB is available first.
  mergedGlbs.set(outId, glbBuffer);
  const url = `${baseUrl()}/merged/${outId}.glb`;
  return await renderGlbToPng({ glbPathOrUrl: url, size: 512 });
}

async function attachCloudinaryLinks(outId, glbBuf) {
  const preview = mergedPreviews.get(outId);
  if (!preview) return null;
  try {
    return await uploadGenerated3DAsset({
      id: outId,
      glbBuffer: glbBuf,
      previewPngBuffer: preview,
    });
  } catch (e) {
    console.warn(`[cloudinary] upload failed for ${outId}:`, e.message);
    return null;
  }
}

function format3dReadySms({ cloudinaryGlbUrl, cloudinaryPreviewUrl }) {
  return [
    "Your 3D model is ready.",
    "",
    "GLB (Cloudinary CDN):",
    cloudinaryGlbUrl,
    "",
    "Preview image (Cloudinary CDN):",
    cloudinaryPreviewUrl,
  ].join("\n");
}

async function maybeSendSmsWithCloudinaryLinks(cloud) {
  if (!cloud?.cloudinaryGlbUrl || !cloud?.cloudinaryPreviewUrl) return;
  const msg = format3dReadySms(cloud);
  try {
    await sendSmsViaPingram({ message: msg });
  } catch (e) {
    console.warn("[pingram] SMS send failed:", e && e.message ? e.message : e);
  }
}

const publicPreviewUrl = (id) => `${baseUrl()}/previews/${id}.png`;

async function uploadBufferToCatbox(buffer, filename, mimeType) {
  const form = new FormData();
  form.append('reqtype', 'fileupload');
  form.append('fileToUpload', new Blob([buffer], { type: mimeType }), filename);

  const response = await fetch('https://catbox.moe/user/api.php', {
    method: 'POST',
    body: form
  });
  const url = (await response.text()).trim();
  if (!response.ok || !/^https?:\/\/\S+$/i.test(url)) {
    throw new Error(`Public model upload failed (${response.status}): ${url.slice(0, 200)}`);
  }
  return url;
}

async function resolvePublicFileUrl(fileUrl, fallbackName, mimeType) {
  if (!fileUrl) {
    throw new Error('fileUrl is required');
  }

  const parsed = new URL(fileUrl, baseUrl());
  const isLocal = ['localhost', '127.0.0.1', '0.0.0.0'].includes(parsed.hostname);
  if (!isLocal) {
    return parsed.toString();
  }

  const mergedMatch = parsed.pathname.match(/^\/merged\/([^/]+)\.glb$/i);
  if (mergedMatch) {
    const id = mergedMatch[1];
    const buffer = mergedGlbs.get(id);
    if (!buffer) throw new Error(`Generated model not found in memory: ${id}`);
    return await uploadBufferToCatbox(buffer, `${id}.glb`, 'model/gltf-binary');
  }

  const spriteMatch = parsed.pathname.match(/^\/sprites\/([^/]+\.glb)$/i);
  if (spriteMatch) {
    const spriteName = decodeURIComponent(spriteMatch[1]);
    const spritePath = path.join(SPRITES_DIR, spriteName);
    if (!spritePath.startsWith(SPRITES_DIR) || !fs.existsSync(spritePath)) {
      throw new Error(`Sprite model not found: ${spriteName}`);
    }
    return await uploadBufferToCatbox(fs.readFileSync(spritePath), spriteName, 'model/gltf-binary');
  }

  const previewMatch = parsed.pathname.match(/^\/previews\/([^/]+)\.png$/i);
  if (previewMatch) {
    const id = previewMatch[1];
    const buffer = mergedPreviews.get(id);
    if (!buffer) throw new Error(`Generated preview not found in memory: ${id}`);
    return await uploadBufferToCatbox(buffer, `${id}.png`, 'image/png');
  }

  const response = await fetch(parsed.toString());
  if (!response.ok) {
    throw new Error(`Failed to fetch local file (${response.status})`);
  }
  return await uploadBufferToCatbox(Buffer.from(await response.arrayBuffer()), fallbackName, mimeType);
}

async function createCultsPlaceholderImage(name) {
  const safeName = String(name || 'GodMode model').replace(/[<>&"]/g, '').slice(0, 80);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="768">` +
    `<rect width="100%" height="100%" fill="#17122b"/>` +
    `<text x="50%" y="45%" text-anchor="middle" fill="#ffffff" font-family="Arial" font-size="56">GodMode 3D Model</text>` +
    `<text x="50%" y="55%" text-anchor="middle" fill="#c4b5fd" font-family="Arial" font-size="30">${safeName}</text>` +
    `</svg>`;
  const buffer = await sharp(Buffer.from(svg)).png().toBuffer();
  return await uploadBufferToCatbox(buffer, 'godmode-cults-preview.png', 'image/png');
}

app.post('/api/cults/share', async (req, res) => {
  try {
    const { modelUrl, fileUrl, previewImageUrl, imageUrl, name } = req.body || {};
    const rawModelName = name || 'GodMode generated model.glb';
    const uploadName = /\.glb$/i.test(rawModelName) ? rawModelName : `${rawModelName}.glb`;
    const publicFileUrl = fileUrl || await resolvePublicFileUrl(modelUrl, uploadName, 'model/gltf-binary');
    const publicImageUrl = imageUrl
      || (previewImageUrl ? await resolvePublicFileUrl(previewImageUrl, `${rawModelName}.png`, 'image/png') : await createCultsPlaceholderImage(rawModelName));
    const origin = process.env.CULTS_SHARE_ORIGIN || new URL(publicFileUrl).hostname;
    const share = await cults.createShareUrl(publicFileUrl, origin);
    const creation = await cults.createCreation({
      name: rawModelName.replace(/\.glb$/i, '').replace(/[-_]+/g, ' ').slice(0, 80),
      description: 'AI-generated 3D model created with GodMode.',
      details: `Shared from GodMode.\n\nModel file: ${publicFileUrl}`,
      fileUrl: publicFileUrl,
      imageUrl: publicImageUrl
    });
    res.json({ ok: true, ...share, ...creation });
  } catch (err) {
    console.error('[cults/share] error:', err);
    res.status(500).json({ ok: false, error: err.message || String(err) });
  }
});

// Stable Fast 3D: single synchronous call, ~3-5 second turnaround.
// Returns the GLB URL directly (no polling, no jobId machinery).
app.post('/api/3d/stable-fast', async (req, res) => {
  const { imageUrl, baseSprite, prompt } = req.body || {};
  if (!imageUrl) return res.status(400).json({ error: 'imageUrl required' });
  if (!STABILITY_API_KEY) {
    return res.status(500).json({ error: 'STABILITY_API_KEY missing in .env' });
  }

  const id = imageIdFromUrl(imageUrl);
  if (!id) return res.status(400).json({ error: 'unsupported imageUrl (must be from /images/)' });
  const stored = images.get(id);
  if (!stored) return res.status(404).json({ error: 'image not found' });

  const startedAt = Date.now();
  try {
    const form = new FormDataNode();
    form.append('image', stored.buffer, { filename: 'input.png', contentType: stored.mime || 'image/png' });
    // Quality knobs — Stability defaults are conservative.
    form.append('texture_resolution', '2048');     // 2x sharper UVs
    form.append('vertex_count', '20000');          // way more geometry detail
    form.append('remesh', 'triangle');             // clean topology
    form.append('foreground_ratio', '0.85');       // valid range is 0-1

    let glbBuf;
    let lastError;
    const maxRetries = 2;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        if (attempt > 1) {
          // Exponential backoff: 3s, then 6s
          const delayMs = 3000 * attempt;
          console.log(`[stable-fast] retry attempt ${attempt}/${maxRetries} after ${delayMs}ms delay`);
          await new Promise(resolve => setTimeout(resolve, delayMs));
        }
        
        console.log(`[stable-fast] attempt ${attempt}: POST ${STABILITY_FAST_3D_URL}`);
        
        const stRes = await axios.post(STABILITY_FAST_3D_URL, form, {
          headers: {
            Authorization: `Bearer ${STABILITY_API_KEY}`,
            Accept: 'model/gltf-binary',
            ...form.getHeaders()
          },
          responseType: 'arraybuffer',
          timeout: 60000, // 60s timeout (Stability can be slow)
          maxContentLength: Infinity,
          maxBodyLength: Infinity,
          // Disable HTTP keep-alive to avoid socket reuse issues
          httpAgent: new (require('http').Agent)({ keepAlive: false }),
          httpsAgent: new (require('https').Agent)({ keepAlive: false })
        });
        glbBuf = Buffer.from(stRes.data);
        break; // Success - exit retry loop
      } catch (err) {
        lastError = err;
        const isSSLError = err.message && (err.message.includes('SSL') || err.message.includes('ECONNRESET'));
        
        // Only retry on SSL/connection errors
        if (attempt < maxRetries && isSSLError) {
          console.log(`[stable-fast] SSL error on attempt ${attempt}, retrying...`);
          continue;
        }
        
        // Final failure or non-retryable error
        const status = err.response?.status || 502;
        let detail = err.message;
        if (err.response?.data) {
          detail = Buffer.isBuffer(err.response.data) ? err.response.data.toString() : err.response.data;
        }
        return res.status(status).json({ 
          error: `Stability ${status}`,
          detail,
          attempts: attempt
        });
      }
    }
    
    if (!glbBuf) {
      return res.status(502).json({ 
        error: 'Stability API failed after retries',
        detail: lastError?.message || 'Unknown error'
      });
    }

    // Optional: rescale to base sprite dimensions
    if (baseSprite) {
      const basePath = path.join(SPRITES_DIR, baseSprite);
      if (fs.existsSync(basePath)) {
        try {
          glbBuf = await scaleGlbToMatchBase(glbBuf, basePath);
        } catch (err) {
          console.warn('[stable-fast] scale failed:', err.message);
        }
      }
    }

    let namePrefix = 'sf3d';
    if (prompt && typeof prompt === 'string') {
      const sanitized = prompt.replace(/[^a-zA-Z0-9]/g, ' ').trim().split(/\s+/).slice(0, 4).map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join('');
      if (sanitized) namePrefix = sanitized;
    }
    const outId = `${namePrefix}-${crypto.randomBytes(2).toString('hex')}`;
    const filename = `${outId}.glb`;
    
    // CyStack: Scan file and send telemetry
    await cystack.scanner.scanFile(glbBuf, {
      source: 'stable-fast',
      filename,
    });
    
    mergedGlbs.set(outId, glbBuf);
    try {
      mergedPreviews.set(outId, await generateRealPreviewPngForId(outId, glbBuf));
    } catch (e) {
      console.warn('[stable-fast] real preview failed, falling back:', e.message);
      try { mergedPreviews.set(outId, await generatePlaceholderPreviewPng(glbBuf)); } catch {}
    }
    const cloud = await attachCloudinaryLinks(outId, glbBuf);
    await maybeSendSmsWithCloudinaryLinks(cloud);

    // Save to sprites folder
    const spritePath = saveSpriteGlb(filename, glbBuf);
    
    // CyStack: Log import event
    await cystack.scanner.logImport(filename, glbBuf, 'stable-fast');
    
    console.log(`[stable-fast] Saved: ${spritePath}`);

    const elapsedMs = Date.now() - startedAt;
    console.log(`[stable-fast] ${elapsedMs}ms, ${glbBuf.length} bytes`);
    res.json({
      modelUrl: `${baseUrl()}/merged/${outId}.glb`,
      previewImageUrl: publicPreviewUrl(outId),
      ...(cloud ? cloud : {}),
      elapsedMs,
      format: 'glb',
      cystack: { telemetrySent: true },
    });
  } catch (err) {
    console.error('[stable-fast] error:', err);
    res.status(500).json({ error: err.message || String(err) });
  }
});

// TripoSR running on a user-provided AWS EC2 GPU instance (Flask server
// from scripts/triposr_server.py). Sync POST, returns GLB in 3-8s after
// the model is warm.
app.post('/api/3d/triposr', async (req, res) => {
  const { imageUrl, baseSprite, prompt } = req.body || {};
  if (!imageUrl) return res.status(400).json({ error: 'imageUrl required' });
  if (!TRIPOSR_URL) return res.status(500).json({ error: 'TRIPOSR_URL missing in .env' });

  const id = imageIdFromUrl(imageUrl);
  if (!id) return res.status(400).json({ error: 'unsupported imageUrl (must be from /images/)' });
  const stored = images.get(id);
  if (!stored) return res.status(404).json({ error: 'image not found' });

  const startedAt = Date.now();
  try {
    const form = new FormData();
    form.append('image', new Blob([stored.buffer], { type: stored.mime || 'image/png' }), 'input.png');

    const tsRes = await fetch(`${TRIPOSR_URL}/generate`, {
      method: 'POST',
      body: form,
    });
    if (!tsRes.ok) {
      const text = await tsRes.text().catch(() => '');
      return res.status(502).json({ error: `TripoSR ${tsRes.status}`, detail: text });
    }
    let glbBuf = Buffer.from(await tsRes.arrayBuffer());

    if (baseSprite) {
      const basePath = path.join(SPRITES_DIR, baseSprite);
      if (fs.existsSync(basePath)) {
        try {
          glbBuf = await scaleGlbToMatchBase(glbBuf, basePath);
        } catch (err) {
          console.warn('[triposr] scale failed:', err.message);
        }
      }
    }

    let namePrefix = 'triposr';
    if (prompt && typeof prompt === 'string') {
      const sanitized = prompt.replace(/[^a-zA-Z0-9]/g, ' ').trim().split(/\s+/).slice(0, 4).map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join('');
      if (sanitized) namePrefix = sanitized;
    }
    const outId = `${namePrefix}-${crypto.randomBytes(2).toString('hex')}`;
    const filename = `${outId}.glb`;
    
    // CyStack: Scan file and send telemetry
    await cystack.scanner.scanFile(glbBuf, {
      source: 'triposr',
      filename,
    });
    
    mergedGlbs.set(outId, glbBuf);
    try {
      mergedPreviews.set(outId, await generateRealPreviewPngForId(outId, glbBuf));
    } catch (e) {
      console.warn('[triposr] real preview failed, falling back:', e.message);
      try { mergedPreviews.set(outId, await generatePlaceholderPreviewPng(glbBuf)); } catch {}
    }
    const cloud = await attachCloudinaryLinks(outId, glbBuf);
    await maybeSendSmsWithCloudinaryLinks(cloud);

    // Save to sprites folder
    const spritePath = saveSpriteGlb(filename, glbBuf);
    
    // CyStack: Log import event
    await cystack.scanner.logImport(filename, glbBuf, 'triposr');
    
    console.log(`[triposr] Saved: ${spritePath}`);

    const elapsedMs = Date.now() - startedAt;
    const remoteMs = tsRes.headers.get('x-triposr-elapsed-ms');
    console.log(`[triposr] total ${elapsedMs}ms (model ${remoteMs || '?'}ms), ${glbBuf.length} bytes`);
    res.json({
      modelUrl: `${baseUrl()}/merged/${outId}.glb`,
      previewImageUrl: publicPreviewUrl(outId),
      ...(cloud ? cloud : {}),
      elapsedMs,
      format: 'glb',
      cystack: { telemetrySent: true },
    });
  } catch (err) {
    console.error('[triposr] error:', err);
    res.status(500).json({ error: err.message || String(err) });
  }
});

// Replicate-hosted TripoSR (camenduru/tripo-sr). Polls until done; usually
// 5–10s warm, longer on cold start.
app.post('/api/3d/replicate-triposr', async (req, res) => {
  const { imageUrl, baseSprite } = req.body || {};
  if (!imageUrl) return res.status(400).json({ error: 'imageUrl required' });
  if (!REPLICATE_API_TOKEN) {
    return res.status(500).json({ error: 'REPLICATE_API_TOKEN missing in .env' });
  }

  const id = imageIdFromUrl(imageUrl);
  if (!id) return res.status(400).json({ error: 'unsupported imageUrl' });
  const stored = images.get(id);
  if (!stored) return res.status(404).json({ error: 'image not found' });

  const dataUrl = `data:${stored.mime || 'image/png'};base64,${stored.buffer.toString('base64')}`;
  const startedAt = Date.now();

  try {
    // Kick off prediction
    const startRes = await fetch('https://api.replicate.com/v1/predictions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${REPLICATE_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        version: REPLICATE_TRIPOSR_VERSION,
        input: { image: dataUrl, do_remove_background: true, foreground_ratio: 0.85 },
      }),
    });
    if (!startRes.ok) {
      const text = await startRes.text().catch(() => '');
      return res.status(502).json({ error: `Replicate start ${startRes.status}`, detail: text });
    }
    const startJson = await startRes.json();
    const getUrl = startJson.urls && startJson.urls.get;
    if (!getUrl) return res.status(502).json({ error: 'Replicate returned no poll URL', detail: startJson });

    // Poll until done (max 5 min)
    const deadline = Date.now() + 5 * 60 * 1000;
    let prediction = startJson;
    while (Date.now() < deadline && !['succeeded', 'failed', 'canceled'].includes(prediction.status)) {
      await new Promise((r) => setTimeout(r, 1500));
      const poll = await fetch(getUrl, { headers: { Authorization: `Bearer ${REPLICATE_API_TOKEN}` } });
      prediction = await poll.json();
    }
    if (prediction.status !== 'succeeded') {
      return res.status(502).json({ error: `Replicate ${prediction.status}`, detail: prediction.error || prediction });
    }

    // Output may be a URL string or array of URLs (depends on model). TripoSR
    // returns an array where one entry is the .glb file.
    const outputs = Array.isArray(prediction.output) ? prediction.output : [prediction.output];
    const glbUrl = outputs.find((u) => typeof u === 'string' && /\.glb($|\?)/i.test(u))
      || outputs.find((u) => typeof u === 'string');
    if (!glbUrl) return res.status(502).json({ error: 'Replicate output had no GLB', detail: prediction.output });

    const dl = await fetch(glbUrl);
    if (!dl.ok) return res.status(502).json({ error: `Replicate GLB fetch ${dl.status}` });
    let glbBuf = Buffer.from(await dl.arrayBuffer());

    if (baseSprite) {
      const basePath = path.join(SPRITES_DIR, baseSprite);
      if (fs.existsSync(basePath)) {
        try {
          glbBuf = await scaleGlbToMatchBase(glbBuf, basePath);
        } catch (err) {
          console.warn('[replicate-triposr] scale failed:', err.message);
        }
      }
    }

    const outId = `rep-tsr-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
    mergedGlbs.set(outId, glbBuf);
    try {
      mergedPreviews.set(outId, await generateRealPreviewPngForId(outId, glbBuf));
    } catch (e) {
      console.warn('[replicate-triposr] real preview failed, falling back:', e.message);
      try { mergedPreviews.set(outId, await generatePlaceholderPreviewPng(glbBuf)); } catch {}
    }
    const cloud = await attachCloudinaryLinks(outId, glbBuf);
    await maybeSendSmsWithCloudinaryLinks(cloud);
    
    // Save to sprites folder  
    const spritePath = saveSpriteGlb(`${outId}.glb`, glbBuf);
    
    const elapsedMs = Date.now() - startedAt;
    console.log(`[replicate-triposr] ${elapsedMs}ms (Replicate ${prediction.metrics && prediction.metrics.predict_time}s), saved to ${spritePath}`);
    res.json({
      modelUrl: `${baseUrl()}/merged/${outId}.glb`,
      previewImageUrl: publicPreviewUrl(outId),
      ...(cloud ? cloud : {}),
      elapsedMs,
      format: 'glb',
    });
  } catch (err) {
    console.error('[replicate-triposr] error:', err);
    res.status(500).json({ error: err.message || String(err) });
  }
});

app.get('/merged/:id', (req, res) => {
  // The URL ends in `.glb` for nicer download UX; strip it for the lookup.
  const id = String(req.params.id).replace(/\.glb$/i, '');
  const buf = mergedGlbs.get(id);
  if (!buf) return res.status(404).end();
  res.setHeader('Content-Type', 'model/gltf-binary');
  // Inline so <model-viewer> can render it; the renderer's anchor uses the
  // `download` attribute when the user wants to save.
  res.setHeader('Cache-Control', 'no-store');
  res.end(buf);
});

app.get('/previews/:id', (req, res) => {
  const id = String(req.params.id).replace(/\.png$/i, '');
  const buf = mergedPreviews.get(id);
  if (!buf) return res.status(404).end();
  res.setHeader('Content-Type', 'image/png');
  res.setHeader('Cache-Control', 'no-store');
  res.end(buf);
});

app.get('/api/3d/status/:jobId', async (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'unknown job' });

  try {
    const meshyResp = await fetch(`${MESHY_BASE}/image-to-3d/${job.meshyTaskId}`, {
      method: 'GET',
      headers: meshyHeaders(),
    });
    if (!meshyResp.ok) {
      const text = await meshyResp.text().catch(() => '');
      return res.status(502).json({ error: `meshy status failed (${meshyResp.status})`, detail: text });
    }
    const json = await meshyResp.json();
    const status = meshyToJobStatus(json.status);
    const progress = typeof json.progress === 'number' ? json.progress : job.lastProgress;
    let modelUrl =
      (json.model_urls && (json.model_urls.glb || json.model_urls.fbx)) || null;
    const taskError = json.task_error && json.task_error.message;

    // First time we see SUCCEEDED, optionally rescale to base sprite size.
    if (status === 'completed' && modelUrl && !job.lastModelUrl) {
      if (job.baseSprite) {
        try {
          const basePath = path.join(SPRITES_DIR, job.baseSprite);
          if (!fs.existsSync(basePath)) throw new Error(`base sprite not found: ${job.baseSprite}`);
          console.log(`[3d/status] downloading meshy output…`);
          const meshyDl = await fetch(modelUrl);
          if (!meshyDl.ok) throw new Error(`meshy GLB fetch failed (${meshyDl.status})`);
          const meshyGlb = Buffer.from(await meshyDl.arrayBuffer());

          if (job.scaleOnly) {
            // Path A: scale Meshy output to match base sprite's dimensions
            console.log(`[3d/status] scaling Meshy output to match ${job.baseSprite}…`);
            const scaled = await scaleGlbToMatchBase(meshyGlb, basePath);
            const scaledId = `scaled-${job.jobId}`;
            mergedGlbs.set(scaledId, scaled);
            try {
              mergedPreviews.set(scaledId, await generateRealPreviewPngForId(scaledId, scaled));
            } catch (e) {
              console.warn('[3d/status] real preview failed, falling back:', e.message);
              try { mergedPreviews.set(scaledId, await generatePlaceholderPreviewPng(scaled)); } catch {}
            }
            const cloud = await attachCloudinaryLinks(scaledId, scaled);
            await maybeSendSmsWithCloudinaryLinks(cloud);
            modelUrl = `${baseUrl()}/merged/${scaledId}.glb`;
            job.cloudinary = cloud;
            console.log(`[3d/status] scaled GLB → ${modelUrl} (${scaled.length} bytes)`);
          } else {
            // Path B: full mesh-merge (kept for future use)
            console.log(`[3d/status] merging ${job.baseSprite} + meshy output…`);
            const merged = await mergeGlbs(basePath, meshyGlb, job.featureBbox);
            const mergedId = `merged-${job.jobId}`;
            mergedGlbs.set(mergedId, merged);
            try {
              mergedPreviews.set(mergedId, await generateRealPreviewPngForId(mergedId, merged));
            } catch (e) {
              console.warn('[3d/status] real preview failed, falling back:', e.message);
              try { mergedPreviews.set(mergedId, await generatePlaceholderPreviewPng(merged)); } catch {}
            }
            const cloud = await attachCloudinaryLinks(mergedId, merged);
            await maybeSendSmsWithCloudinaryLinks(cloud);
            modelUrl = `${baseUrl()}/merged/${mergedId}.glb`;
            job.cloudinary = cloud;
            console.log(`[3d/status] merged GLB → ${modelUrl} (${merged.length} bytes)`);
          }
        } catch (err) {
          console.error('[3d/status] post-process failed, falling back to raw Meshy URL:', err.message);
        }
      }
      job.lastModelUrl = modelUrl;
    }

    job.lastStatus = status;
    job.lastProgress = progress;
    if (taskError) job.lastError = taskError;

    res.json({
      jobId: job.jobId,
      status,
      progress,
      ...(job.lastModelUrl ? { modelUrl: job.lastModelUrl } : {}),
      ...(job.lastModelUrl
        ? { previewImageUrl: publicPreviewUrl(String(job.lastModelUrl).split('/').pop().replace(/\.glb$/i, '')) }
        : {}),
      ...(job.cloudinary ? job.cloudinary : {}),
      ...(taskError ? { error: taskError } : {}),
    });
  } catch (err) {
    console.error('[3d/status] error:', err);
    res.status(500).json({ error: err.message || String(err) });
  }
});

tick('routes registered');

const server = app.listen(PORT, () => {
  console.log(`[backend] listening on ${baseUrl()}`);
  console.log(`[backend] region=${REGION} model=${MODEL_ID}`);
  if (!process.env.AWS_ACCESS_KEY_ID) {
    console.warn('[backend] WARNING: AWS_ACCESS_KEY_ID missing from .env');
  }
});
server.on('error', (err) => {
  console.error('[backend] LISTEN FAILED:', err.message);
  if (err.code === 'EADDRINUSE') {
    console.error(`[backend] Port ${PORT} is already in use. Free it: lsof -ti:${PORT} | xargs kill -9`);
  }
  process.exit(1);
});
