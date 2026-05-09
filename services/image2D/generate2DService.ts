import type { Generate2DRequest, Generate2DResult } from "./types";

export type Generate2DOptions = {
  signal?: AbortSignal;
  headers?: Record<string, string>;
};

export async function generate2D(
  request: Generate2DRequest,
  endpoint: string,
  options: Generate2DOptions = {},
): Promise<Generate2DResult> {
  if (!endpoint) throw new Error("generate2D: endpoint is required");
  if (!request?.imageUrl) throw new Error("generate2D: imageUrl is required");

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...options.headers },
      body: JSON.stringify(request),
      signal: options.signal,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`generate2D: network error calling ${endpoint}: ${msg}`);
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `generate2D: ${endpoint} returned ${response.status}${text ? ` — ${text}` : ""}`,
    );
  }

  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new Error(`generate2D: response from ${endpoint} was not valid JSON`);
  }

  if (
    !data ||
    typeof data !== "object" ||
    typeof (data as { imageUrl?: unknown }).imageUrl !== "string"
  ) {
    throw new Error(`generate2D: response from ${endpoint} missing string "imageUrl"`);
  }

  const r = data as {
    imageUrl: string;
    id?: unknown;
    autoDescription?: unknown;
    finalPrompt?: unknown;
    usedFallback?: unknown;
  };
  return {
    imageUrl: r.imageUrl,
    id: typeof r.id === "string" ? r.id : undefined,
    autoDescription:
      typeof r.autoDescription === "string" ? r.autoDescription : undefined,
    finalPrompt: typeof r.finalPrompt === "string" ? r.finalPrompt : undefined,
    usedFallback:
      typeof r.usedFallback === "string" ? r.usedFallback : undefined,
  };
}

// Example:
//   const enhanced = await generate2D(
//     { imageUrl: uploaded.imageUrl, prompt: "polished illustration" },
//     "http://localhost:3001/api/generate-2d",
//   );
