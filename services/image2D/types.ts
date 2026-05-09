export type Generate2DRequest = {
  imageUrl: string;
  /** Optional mask: inpaint mode regenerates only mask pixels, leaves rest exact. */
  maskUrl?: string;
  prompt?: string;
};

export type Generate2DResult = {
  imageUrl: string;
  id?: string;
  autoDescription?: string;
  finalPrompt?: string;
  /** Set by backend if it had to retry with a different model (e.g. when inpaint was filtered). */
  usedFallback?: string;
};
