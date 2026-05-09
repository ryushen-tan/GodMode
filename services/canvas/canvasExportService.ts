import type { CanvasExportOptions, CanvasExportMimeType } from "./types";

const DEFAULT_MIME: CanvasExportMimeType = "image/png";

const extensionFor = (mime: CanvasExportMimeType): string => {
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

export async function exportCanvasToBlob(
  canvas: HTMLCanvasElement | null,
  options: CanvasExportOptions = {},
): Promise<Blob> {
  if (!canvas) {
    throw new Error("exportCanvasToBlob: canvas is null or undefined");
  }
  if (typeof canvas.toBlob !== "function") {
    throw new Error("exportCanvasToBlob: canvas.toBlob is not supported in this environment");
  }

  const mimeType = options.mimeType ?? DEFAULT_MIME;
  const quality = options.quality;

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error(`exportCanvasToBlob: browser returned null blob for ${mimeType}`));
          return;
        }
        resolve(blob);
      },
      mimeType,
      quality,
    );
  });
}

export async function exportCanvasToFile(
  canvas: HTMLCanvasElement | null,
  filename?: string,
  options: CanvasExportOptions = {},
): Promise<File> {
  const blob = await exportCanvasToBlob(canvas, options);
  const mimeType = options.mimeType ?? DEFAULT_MIME;
  const safeName = filename ?? `canvas-${Date.now()}.${extensionFor(mimeType)}`;
  return new File([blob], safeName, { type: mimeType });
}

// Example:
//   const file = await exportCanvasToFile(canvasRef.current, "drawing.png");
