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

const PORT = Number(process.env.BACKEND_PORT || 3001);
const REGION = process.env.AWS_REGION || 'us-east-1';
const MODEL_ID = process.env.BEDROCK_IMAGE_MODEL_ID || 'amazon.nova-canvas-v1:0';
const VISION_MODEL_ID = process.env.BEDROCK_VISION_MODEL_ID || 'us.anthropic.claude-3-5-haiku-20241022-v1:0';

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
    let { b64, json } = await invokeAndExtract(effectiveModelId, body);
    let usedFallback = null;

    // If Stability's safety filter blocked the image, fall back to
    // control-structure on the full canvas (no mask, more permissive).
    if (!b64 && useInpaint) {
      const reasons = (json && json.finish_reasons) || [];
      const filtered = reasons.some((r) => /filter/i.test(String(r)));
      if (filtered) {
        console.warn('[generate-2d] inpaint filtered, falling back to control-structure');
        usedFallback = 'us.stability.stable-image-control-structure-v1:0';
        const fallbackBody = {
          prompt: text,
          image: inputB64,
          control_strength: 0.85,
          output_format: 'png',
          seed: Math.floor(Math.random() * 1_000_000),
        };
        const r2 = await invokeAndExtract(usedFallback, fallbackBody);
        b64 = r2.b64;
        json = r2.json;
      }
    }

    if (!b64) {
      const reasons = (json && json.finish_reasons) || [];
      const filtered = reasons.some((r) => /filter/i.test(String(r)));
      return res.status(502).json({
        error: filtered
          ? "AWS Bedrock's safety filter rejected the image. Try a screenshot without faces, text, or branded UI — or draw on a blank canvas."
          : 'bedrock returned no image',
        detail: json,
      });
    }
    const buf = Buffer.from(b64, 'base64');
    const newId = storeImage(buf, 'image/png');
    res.json({ imageUrl: publicImageUrl(newId), id: newId, usedFallback });
  } catch (err) {
    console.error('[generate-2d] bedrock error:', err);
    res.status(500).json({ error: err.message || String(err), name: err.name });
  }
});

// Mock 3D endpoints (real AWS image-to-3D doesn't exist; swap later)
app.post('/api/3d/start', (req, res) => {
  const { imageUrl } = req.body || {};
  if (!imageUrl) return res.status(400).json({ error: 'imageUrl required' });
  const jobId = `job-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
  jobs.set(jobId, { jobId, polls: 0, pollsUntilDone: 4, imageUrl });
  res.json({ jobId, status: 'queued' });
});

app.get('/api/3d/status/:jobId', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'unknown job' });
  job.polls += 1;
  if (job.polls >= job.pollsUntilDone) {
    return res.json({
      jobId: job.jobId,
      status: 'completed',
      progress: 100,
      modelUrl: 'https://example.invalid/mock/model.glb',
    });
  }
  res.json({
    jobId: job.jobId,
    status: 'processing',
    progress: Math.round((job.polls / job.pollsUntilDone) * 100),
  });
});

app.listen(PORT, () => {
  console.log(`[backend] listening on ${baseUrl()}`);
  console.log(`[backend] region=${REGION} model=${MODEL_ID}`);
  if (!process.env.AWS_ACCESS_KEY_ID) {
    console.warn('[backend] WARNING: AWS_ACCESS_KEY_ID missing from .env');
  }
});
