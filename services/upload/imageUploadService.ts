import type { UploadedImage, UploadImageOptions } from "./types";

export async function uploadImage(
  file: File,
  endpoint: string,
  options: UploadImageOptions = {},
): Promise<UploadedImage> {
  if (!file) {
    throw new Error("uploadImage: file is required");
  }
  if (!endpoint) {
    throw new Error("uploadImage: endpoint is required");
  }

  const fieldName = options.fieldName ?? "image";
  const formData = new FormData();
  formData.append(fieldName, file, file.name);

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      body: formData,
      headers: options.headers,
      signal: options.signal,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`uploadImage: network error calling ${endpoint}: ${message}`);
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `uploadImage: ${endpoint} returned ${response.status} ${response.statusText}${text ? ` — ${text}` : ""}`,
    );
  }

  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new Error(`uploadImage: response from ${endpoint} was not valid JSON`);
  }

  if (
    !data ||
    typeof data !== "object" ||
    typeof (data as { imageUrl?: unknown }).imageUrl !== "string"
  ) {
    throw new Error(`uploadImage: response from ${endpoint} missing string "imageUrl"`);
  }

  const result = data as { imageUrl: string; id?: unknown };
  return {
    imageUrl: result.imageUrl,
    id: typeof result.id === "string" ? result.id : undefined,
  };
}

// Example:
//   const uploaded = await uploadImage(file, "http://localhost:3001/api/upload-image");
