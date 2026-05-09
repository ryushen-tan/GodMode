export type ThreeDGenerationStatus =
  | "idle"
  | "uploading"
  | "queued"
  | "processing"
  | "completed"
  | "failed";

export type ThreeDGenerationMode = "object" | "character" | "scene" | "logo" | "relief";

export type ThreeDModelFormat = "glb" | "obj" | "usdz";

export type ThreeDGenerationJob = {
  jobId: string;
  status: ThreeDGenerationStatus;
  progress?: number;
  modelUrl?: string;
  previewImageUrl?: string;
  cloudinaryPreviewUrl?: string;
  cloudinaryGlbUrl?: string;
  error?: string;
};

export type StartThreeDGenerationRequest = {
  imageUrl: string;
  prompt?: string;
  mode?: ThreeDGenerationMode;
};

export type StartThreeDGenerationResponse = {
  jobId: string;
  status: ThreeDGenerationStatus;
};

export type ThreeDGenerationResult = {
  jobId: string;
  modelUrl: string;
  previewImageUrl?: string;
  cloudinaryPreviewUrl?: string;
  cloudinaryGlbUrl?: string;
  format: ThreeDModelFormat;
};
