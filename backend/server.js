const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const {
  BedrockRuntimeClient,
  InvokeModelCommand,
} = require('@aws-sdk/client-bedrock-runtime');
const {
  BedrockClient,
  ListFoundationModelsCommand,
  ListInferenceProfilesCommand,
} = require('@aws-sdk/client-bedrock');
const fs = require('fs');
const { NodeIO } = require('@gltf-transform/core');
const { ALL_EXTENSIONS } = require('@gltf-transform/extensions');
const { bounds } = require('@gltf-transform/functions');
const draco3d = require('draco3dgltf');

const PORT = Number(process.env.BACKEND_PORT || 3001);
const REGION = process.env.AWS_REGION || 'us-east-1';
const MODEL_ID = process.env.BEDROCK_IMAGE_MODEL_ID || 'amazon.nova-canvas-v1:0';
const VISION_MODEL_ID = process.env.BEDROCK_VISION_MODEL_ID || 'us.anthropic.claude-3-5-haiku-20241022-v1:0';
const MESHY_API_KEY = process.env.MESHY_API_KEY || '';
const MESHY_BASE = 'https://api.meshy.ai/openapi/v1';

const bedrock = new BedrockRuntimeClient({ region: REGION });
const bedrockControl = new BedrockClient({ region: REGION });

const app = express();
app.use(cors());
app.use(express.json({ limit: '20mb' }));

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
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({
      'draco3d.decoder': await draco3d.createDecoderModule(),
      'draco3d.encoder': await draco3d.createEncoderModule(),
    });
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
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({
      'draco3d.decoder': await draco3d.createDecoderModule(),
      'draco3d.encoder': await draco3d.createEncoderModule(),
    });

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

  try {
    const meshyResp = await fetch(`${MESHY_BASE}/image-to-3d`, {
      method: 'POST',
      headers: meshyHeaders(),
      body: JSON.stringify({
        image_url: dataUrl,
        ai_model: 'meshy-6',
        topology: 'triangle',
        // Lower polycount = faster remesh + faster texture bake. 10k is
        // plenty for a preview; you can always re-run at higher quality
        // for the final export.
        target_polycount: 10000,
        should_remesh: true,
        should_texture: true,
        // Cheaper texture pass; cuts ~30-40% off total time.
        texture_richness: 'low',
        // Skip PBR map generation (the big time sink) — diffuse only.
        enable_pbr: false,
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
      baseSprite: baseSprite || null,
      scaleOnly: !!scaleOnly,
    });
    console.log(`[3d/start] jobId=${jobId} meshyTask=${meshyTaskId}`);
    res.json({ jobId, status: 'queued' });
  } catch (err) {
    console.error('[3d/start] error:', err);
    res.status(500).json({ error: err.message || String(err) });
  }
});

// Persist merged GLBs in memory; serve via /merged/<id>.glb.
const mergedGlbs = new Map(); // id -> Buffer

app.get('/merged/:id', (req, res) => {
  const buf = mergedGlbs.get(req.params.id);
  if (!buf) return res.status(404).end();
  res.setHeader('Content-Type', 'model/gltf-binary');
  res.setHeader('Content-Disposition', `attachment; filename="${req.params.id}.glb"`);
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
            modelUrl = `${baseUrl()}/merged/${scaledId}.glb`;
            console.log(`[3d/status] scaled GLB → ${modelUrl} (${scaled.length} bytes)`);
          } else {
            // Path B: full mesh-merge (kept for future use)
            console.log(`[3d/status] merging ${job.baseSprite} + meshy output…`);
            const merged = await mergeGlbs(basePath, meshyGlb, job.featureBbox);
            const mergedId = `merged-${job.jobId}`;
            mergedGlbs.set(mergedId, merged);
            modelUrl = `${baseUrl()}/merged/${mergedId}.glb`;
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
      ...(taskError ? { error: taskError } : {}),
    });
  } catch (err) {
    console.error('[3d/status] error:', err);
    res.status(500).json({ error: err.message || String(err) });
  }
});

app.listen(PORT, () => {
  console.log(`[backend] listening on ${baseUrl()}`);
  console.log(`[backend] region=${REGION} model=${MODEL_ID}`);
  if (!process.env.AWS_ACCESS_KEY_ID) {
    console.warn('[backend] WARNING: AWS_ACCESS_KEY_ID missing from .env');
  }
});
