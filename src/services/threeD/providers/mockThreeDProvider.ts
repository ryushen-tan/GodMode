import type { ThreeDProvider } from "../threeDProvider";
import type {
  StartThreeDGenerationRequest,
  StartThreeDGenerationResponse,
  ThreeDGenerationJob,
} from "../types";

export type MockThreeDProviderOptions = {
  pollsUntilComplete?: number;
  fakeModelUrl?: string;
  failOnStart?: boolean;
};

type MockJobState = {
  jobId: string;
  pollCount: number;
};

export class MockThreeDProvider implements ThreeDProvider {
  private readonly pollsUntilComplete: number;
  private readonly fakeModelUrl: string;
  private readonly failOnStart: boolean;
  private readonly jobs = new Map<string, MockJobState>();

  constructor(options: MockThreeDProviderOptions = {}) {
    this.pollsUntilComplete = options.pollsUntilComplete ?? 3;
    this.fakeModelUrl =
      options.fakeModelUrl ?? "https://example.invalid/mock/model.glb";
    this.failOnStart = options.failOnStart ?? false;
  }

  async startGeneration(
    _request: StartThreeDGenerationRequest,
  ): Promise<StartThreeDGenerationResponse> {
    if (this.failOnStart) {
      throw new Error("MockThreeDProvider: simulated start failure");
    }
    const jobId = `mock-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.jobs.set(jobId, { jobId, pollCount: 0 });
    return { jobId, status: "queued" };
  }

  async getGenerationStatus(jobId: string): Promise<ThreeDGenerationJob> {
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
        modelUrl: this.fakeModelUrl,
      };
    }

    return {
      jobId,
      status: "processing",
      progress,
    };
  }
}
