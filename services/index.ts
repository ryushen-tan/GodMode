export { exportCanvasToBlob, exportCanvasToFile } from "./canvas/canvasExportService";
export type { CanvasExportOptions, CanvasExportMimeType } from "./canvas/types";

export { uploadImage } from "./upload/imageUploadService";
export type { UploadedImage, UploadImageOptions } from "./upload/types";

export type { ThreeDProvider } from "./threeD/threeDProvider";
export {
  BackendThreeDProvider,
  type BackendThreeDProviderOptions,
} from "./threeD/providers/backendThreeDProvider";
export {
  MockThreeDProvider,
  type MockThreeDProviderOptions,
} from "./threeD/providers/mockThreeDProvider";

export {
  startCanvasTo3DGeneration,
  pollThreeDGeneration,
  type StartCanvasTo3DParams,
  type PollThreeDParams,
} from "./threeD/threeDGenerationService";

export type {
  ThreeDGenerationStatus,
  ThreeDGenerationMode,
  ThreeDModelFormat,
  ThreeDGenerationJob,
  StartThreeDGenerationRequest,
  StartThreeDGenerationResponse,
  ThreeDGenerationResult,
} from "./threeD/types";

/*
 * Example usage (from a React component, given a canvas ref):
 *
 *   import {
 *     BackendThreeDProvider,
 *     startCanvasTo3DGeneration,
 *     pollThreeDGeneration,
 *   } from "@/services";
 *
 *   const provider = new BackendThreeDProvider({
 *     baseUrl: "http://localhost:3001",
 *   });
 *
 *   const job = await startCanvasTo3DGeneration({
 *     canvas: canvasRef.current!,
 *     uploadEndpoint: "http://localhost:3001/api/upload-image",
 *     provider,
 *     prompt: "Convert this canvas drawing into a clean 3D object",
 *     mode: "object",
 *   });
 *
 *   const result = await pollThreeDGeneration({
 *     provider,
 *     jobId: job.jobId,
 *     onProgress: (j) => console.log("3D progress:", j.progress),
 *   });
 *
 *   console.log("Model ready:", result.modelUrl);
 *
 * For local dev without a backend, swap in MockThreeDProvider:
 *
 *   const provider = new MockThreeDProvider({ pollsUntilComplete: 3 });
 */
