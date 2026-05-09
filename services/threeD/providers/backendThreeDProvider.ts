import type { ThreeDProvider } from "../threeDProvider";
import type {
  StartThreeDGenerationRequest,
  StartThreeDGenerationResponse,
  ThreeDGenerationJob,
  ThreeDGenerationStatus,
} from "../types";

export type BackendThreeDProviderOptions = {
  baseUrl: string;
  headers?: Record<string, string>;
  fetchImpl?: typeof fetch;
};

const VALID_STATUSES: ReadonlySet<ThreeDGenerationStatus> = new Set([
  "idle",
  "uploading",
  "queued",
  "processing",
  "completed",
  "failed",
]);

const isStatus = (v: unknown): v is ThreeDGenerationStatus =>
  typeof v === "string" && VALID_STATUSES.has(v as ThreeDGenerationStatus);

export class BackendThreeDProvider implements ThreeDProvider {
  private readonly baseUrl: string;
  private readonly headers: Record<string, string>;
  private readonly fetchImpl: typeof fetch;

  constructor(options: BackendThreeDProviderOptions) {
    if (!options.baseUrl) {
      throw new Error("BackendThreeDProvider: baseUrl is required");
    }
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.headers = options.headers ?? {};
    // Bind fetch to globalThis so calling it via `this.fetchImpl(...)` doesn't
    // rebind `this` to the provider instance (browsers reject that with
    // "Illegal invocation").
    this.fetchImpl = options.fetchImpl ?? fetch.bind(globalThis);
  }

  async startGeneration(
    request: StartThreeDGenerationRequest,
  ): Promise<StartThreeDGenerationResponse> {
    const url = `${this.baseUrl}/api/3d/start`;
    const response = await this.fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...this.headers },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(
        `BackendThreeDProvider.startGeneration: ${url} returned ${response.status}${text ? ` — ${text}` : ""}`,
      );
    }

    const data = (await response.json()) as Partial<StartThreeDGenerationResponse>;
    if (typeof data.jobId !== "string" || !isStatus(data.status)) {
      throw new Error(
        `BackendThreeDProvider.startGeneration: invalid response shape from ${url}`,
      );
    }
    return { jobId: data.jobId, status: data.status };
  }

  async getGenerationStatus(jobId: string): Promise<ThreeDGenerationJob> {
    if (!jobId) {
      throw new Error("BackendThreeDProvider.getGenerationStatus: jobId is required");
    }
    const url = `${this.baseUrl}/api/3d/status/${encodeURIComponent(jobId)}`;
    const response = await this.fetchImpl(url, {
      method: "GET",
      headers: this.headers,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(
        `BackendThreeDProvider.getGenerationStatus: ${url} returned ${response.status}${text ? ` — ${text}` : ""}`,
      );
    }

    const data = (await response.json()) as Partial<ThreeDGenerationJob>;
    if (typeof data.jobId !== "string" || !isStatus(data.status)) {
      throw new Error(
        `BackendThreeDProvider.getGenerationStatus: invalid response shape from ${url}`,
      );
    }

    return {
      jobId: data.jobId,
      status: data.status,
      progress: typeof data.progress === "number" ? data.progress : undefined,
      modelUrl: typeof data.modelUrl === "string" ? data.modelUrl : undefined,
      previewImageUrl:
        typeof data.previewImageUrl === "string" ? data.previewImageUrl : undefined,
      cloudinaryPreviewUrl:
        typeof (data as { cloudinaryPreviewUrl?: unknown }).cloudinaryPreviewUrl ===
        "string"
          ? (data as { cloudinaryPreviewUrl: string }).cloudinaryPreviewUrl
          : undefined,
      cloudinaryGlbUrl:
        typeof (data as { cloudinaryGlbUrl?: unknown }).cloudinaryGlbUrl === "string"
          ? (data as { cloudinaryGlbUrl: string }).cloudinaryGlbUrl
          : undefined,
      error: typeof data.error === "string" ? data.error : undefined,
    };
  }
}
