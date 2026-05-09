import { exportCanvasToFile } from "../canvas/canvasExportService";
import type { CanvasExportOptions } from "../canvas/types";
import { uploadImage } from "../upload/imageUploadService";
import type { ThreeDProvider } from "./threeDProvider";
import type {
  ThreeDGenerationJob,
  ThreeDGenerationMode,
  ThreeDGenerationResult,
  ThreeDModelFormat,
} from "./types";

export type StartCanvasTo3DParams = {
  canvas: HTMLCanvasElement;
  uploadEndpoint: string;
  provider: ThreeDProvider;
  filename?: string;
  prompt?: string;
  mode?: ThreeDGenerationMode;
  exportOptions?: CanvasExportOptions;
};

export async function startCanvasTo3DGeneration(
  params: StartCanvasTo3DParams,
): Promise<ThreeDGenerationJob> {
  const { canvas, uploadEndpoint, provider, filename, prompt, mode, exportOptions } = params;

  const file = await exportCanvasToFile(canvas, filename, exportOptions);
  const uploaded = await uploadImage(file, uploadEndpoint);

  const started = await provider.startGeneration({
    imageUrl: uploaded.imageUrl,
    prompt,
    mode,
  });

  return {
    jobId: started.jobId,
    status: started.status,
  };
}

export type PollThreeDParams = {
  provider: ThreeDProvider;
  jobId: string;
  intervalMs?: number;
  timeoutMs?: number;
  onProgress?: (job: ThreeDGenerationJob) => void;
};

const DEFAULT_INTERVAL_MS = 3000;
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

const inferFormat = (modelUrl: string): ThreeDModelFormat => {
  const lower = modelUrl.toLowerCase();
  if (lower.includes(".usdz")) return "usdz";
  if (lower.includes(".obj")) return "obj";
  return "glb";
};

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export async function pollThreeDGeneration(
  params: PollThreeDParams,
): Promise<ThreeDGenerationResult> {
  const {
    provider,
    jobId,
    intervalMs = DEFAULT_INTERVAL_MS,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    onProgress,
  } = params;

  if (!jobId) {
    throw new Error("pollThreeDGeneration: jobId is required");
  }

  const start = Date.now();

  while (true) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(
        `pollThreeDGeneration: timed out after ${timeoutMs}ms waiting for job ${jobId}`,
      );
    }

    const job = await provider.getGenerationStatus(jobId);
    onProgress?.(job);

    if (job.status === "completed") {
      if (!job.modelUrl) {
        throw new Error(
          `pollThreeDGeneration: job ${jobId} completed but modelUrl is missing`,
        );
      }
      return {
        jobId: job.jobId,
        modelUrl: job.modelUrl,
        format: inferFormat(job.modelUrl),
      };
    }

    if (job.status === "failed") {
      throw new Error(
        `pollThreeDGeneration: job ${jobId} failed${job.error ? `: ${job.error}` : ""}`,
      );
    }

    await sleep(intervalMs);
  }
}
