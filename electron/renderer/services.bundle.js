// services/canvas/canvasExportService.ts
var DEFAULT_MIME = "image/png";
var extensionFor = (mime) => {
  switch (mime) {
    case "image/jpeg":
      return "jpg";
    case "image/webp":
      return "webp";
    case "image/png":
    default:
      return "png";
  }
};
async function exportCanvasToBlob(canvas, options = {}) {
  if (!canvas) {
    throw new Error("exportCanvasToBlob: canvas is null or undefined");
  }
  if (typeof canvas.toBlob !== "function") {
    throw new Error("exportCanvasToBlob: canvas.toBlob is not supported in this environment");
  }
  const mimeType = options.mimeType ?? DEFAULT_MIME;
  const quality = options.quality;
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error(`exportCanvasToBlob: browser returned null blob for ${mimeType}`));
          return;
        }
        resolve(blob);
      },
      mimeType,
      quality
    );
  });
}
async function exportCanvasToFile(canvas, filename, options = {}) {
  const blob = await exportCanvasToBlob(canvas, options);
  const mimeType = options.mimeType ?? DEFAULT_MIME;
  const safeName = filename ?? `canvas-${Date.now()}.${extensionFor(mimeType)}`;
  return new File([blob], safeName, { type: mimeType });
}

// services/upload/imageUploadService.ts
async function uploadImage(file, endpoint, options = {}) {
  if (!file) {
    throw new Error("uploadImage: file is required");
  }
  if (!endpoint) {
    throw new Error("uploadImage: endpoint is required");
  }
  const fieldName = options.fieldName ?? "image";
  const formData = new FormData();
  formData.append(fieldName, file, file.name);
  let response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      body: formData,
      headers: options.headers,
      signal: options.signal
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`uploadImage: network error calling ${endpoint}: ${message}`);
  }
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `uploadImage: ${endpoint} returned ${response.status} ${response.statusText}${text ? ` \u2014 ${text}` : ""}`
    );
  }
  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error(`uploadImage: response from ${endpoint} was not valid JSON`);
  }
  if (!data || typeof data !== "object" || typeof data.imageUrl !== "string") {
    throw new Error(`uploadImage: response from ${endpoint} missing string "imageUrl"`);
  }
  const result = data;
  return {
    imageUrl: result.imageUrl,
    id: typeof result.id === "string" ? result.id : void 0
  };
}

// services/image2D/generate2DService.ts
async function generate2D(request, endpoint, options = {}) {
  if (!endpoint) throw new Error("generate2D: endpoint is required");
  if (!request?.imageUrl) throw new Error("generate2D: imageUrl is required");
  let response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...options.headers },
      body: JSON.stringify(request),
      signal: options.signal
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`generate2D: network error calling ${endpoint}: ${msg}`);
  }
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `generate2D: ${endpoint} returned ${response.status}${text ? ` \u2014 ${text}` : ""}`
    );
  }
  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error(`generate2D: response from ${endpoint} was not valid JSON`);
  }
  if (!data || typeof data !== "object" || typeof data.imageUrl !== "string") {
    throw new Error(`generate2D: response from ${endpoint} missing string "imageUrl"`);
  }
  const r = data;
  return {
    imageUrl: r.imageUrl,
    id: typeof r.id === "string" ? r.id : void 0,
    autoDescription: typeof r.autoDescription === "string" ? r.autoDescription : void 0,
    finalPrompt: typeof r.finalPrompt === "string" ? r.finalPrompt : void 0
  };
}

// services/threeD/providers/backendThreeDProvider.ts
var VALID_STATUSES = /* @__PURE__ */ new Set([
  "idle",
  "uploading",
  "queued",
  "processing",
  "completed",
  "failed"
]);
var isStatus = (v) => typeof v === "string" && VALID_STATUSES.has(v);
var BackendThreeDProvider = class {
  baseUrl;
  headers;
  fetchImpl;
  constructor(options) {
    if (!options.baseUrl) {
      throw new Error("BackendThreeDProvider: baseUrl is required");
    }
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.headers = options.headers ?? {};
    this.fetchImpl = options.fetchImpl ?? fetch;
  }
  async startGeneration(request) {
    const url = `${this.baseUrl}/api/3d/start`;
    const response = await this.fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...this.headers },
      body: JSON.stringify(request)
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(
        `BackendThreeDProvider.startGeneration: ${url} returned ${response.status}${text ? ` \u2014 ${text}` : ""}`
      );
    }
    const data = await response.json();
    if (typeof data.jobId !== "string" || !isStatus(data.status)) {
      throw new Error(
        `BackendThreeDProvider.startGeneration: invalid response shape from ${url}`
      );
    }
    return { jobId: data.jobId, status: data.status };
  }
  async getGenerationStatus(jobId) {
    if (!jobId) {
      throw new Error("BackendThreeDProvider.getGenerationStatus: jobId is required");
    }
    const url = `${this.baseUrl}/api/3d/status/${encodeURIComponent(jobId)}`;
    const response = await this.fetchImpl(url, {
      method: "GET",
      headers: this.headers
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(
        `BackendThreeDProvider.getGenerationStatus: ${url} returned ${response.status}${text ? ` \u2014 ${text}` : ""}`
      );
    }
    const data = await response.json();
    if (typeof data.jobId !== "string" || !isStatus(data.status)) {
      throw new Error(
        `BackendThreeDProvider.getGenerationStatus: invalid response shape from ${url}`
      );
    }
    return {
      jobId: data.jobId,
      status: data.status,
      progress: typeof data.progress === "number" ? data.progress : void 0,
      modelUrl: typeof data.modelUrl === "string" ? data.modelUrl : void 0,
      error: typeof data.error === "string" ? data.error : void 0
    };
  }
};

// services/threeD/providers/mockThreeDProvider.ts
var MockThreeDProvider = class {
  pollsUntilComplete;
  fakeModelUrl;
  failOnStart;
  jobs = /* @__PURE__ */ new Map();
  constructor(options = {}) {
    this.pollsUntilComplete = options.pollsUntilComplete ?? 3;
    this.fakeModelUrl = options.fakeModelUrl ?? "https://example.invalid/mock/model.glb";
    this.failOnStart = options.failOnStart ?? false;
  }
  async startGeneration(_request) {
    if (this.failOnStart) {
      throw new Error("MockThreeDProvider: simulated start failure");
    }
    const jobId = `mock-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.jobs.set(jobId, { jobId, pollCount: 0 });
    return { jobId, status: "queued" };
  }
  async getGenerationStatus(jobId) {
    const state = this.jobs.get(jobId);
    if (!state) {
      return { jobId, status: "failed", error: "unknown jobId" };
    }
    state.pollCount += 1;
    const ratio = Math.min(state.pollCount / this.pollsUntilComplete, 1);
    const progress = Math.round(ratio * 100);
    if (state.pollCount >= this.pollsUntilComplete) {
      return {
        jobId,
        status: "completed",
        progress: 100,
        modelUrl: this.fakeModelUrl
      };
    }
    return {
      jobId,
      status: "processing",
      progress
    };
  }
};

// services/threeD/threeDGenerationService.ts
async function startCanvasTo3DGeneration(params) {
  const { canvas, uploadEndpoint, provider, filename, prompt, mode, exportOptions } = params;
  const file = await exportCanvasToFile(canvas, filename, exportOptions);
  const uploaded = await uploadImage(file, uploadEndpoint);
  const started = await provider.startGeneration({
    imageUrl: uploaded.imageUrl,
    prompt,
    mode
  });
  return {
    jobId: started.jobId,
    status: started.status
  };
}
var DEFAULT_INTERVAL_MS = 3e3;
var DEFAULT_TIMEOUT_MS = 5 * 60 * 1e3;
var inferFormat = (modelUrl) => {
  const lower = modelUrl.toLowerCase();
  if (lower.includes(".usdz")) return "usdz";
  if (lower.includes(".obj")) return "obj";
  return "glb";
};
var sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function pollThreeDGeneration(params) {
  const {
    provider,
    jobId,
    intervalMs = DEFAULT_INTERVAL_MS,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    onProgress
  } = params;
  if (!jobId) {
    throw new Error("pollThreeDGeneration: jobId is required");
  }
  const start = Date.now();
  while (true) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(
        `pollThreeDGeneration: timed out after ${timeoutMs}ms waiting for job ${jobId}`
      );
    }
    const job = await provider.getGenerationStatus(jobId);
    onProgress?.(job);
    if (job.status === "completed") {
      if (!job.modelUrl) {
        throw new Error(
          `pollThreeDGeneration: job ${jobId} completed but modelUrl is missing`
        );
      }
      return {
        jobId: job.jobId,
        modelUrl: job.modelUrl,
        format: inferFormat(job.modelUrl)
      };
    }
    if (job.status === "failed") {
      throw new Error(
        `pollThreeDGeneration: job ${jobId} failed${job.error ? `: ${job.error}` : ""}`
      );
    }
    await sleep(intervalMs);
  }
}
export {
  BackendThreeDProvider,
  MockThreeDProvider,
  exportCanvasToBlob,
  exportCanvasToFile,
  generate2D,
  pollThreeDGeneration,
  startCanvasTo3DGeneration,
  uploadImage
};
