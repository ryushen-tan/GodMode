import type {
  StartThreeDGenerationRequest,
  StartThreeDGenerationResponse,
  ThreeDGenerationJob,
} from "./types";

export interface ThreeDProvider {
  startGeneration(request: StartThreeDGenerationRequest): Promise<StartThreeDGenerationResponse>;
  getGenerationStatus(jobId: string): Promise<ThreeDGenerationJob>;
}
