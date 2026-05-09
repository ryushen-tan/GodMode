export type CanvasExportMimeType = "image/png" | "image/jpeg" | "image/webp";

export type CanvasExportOptions = {
  mimeType?: CanvasExportMimeType;
  quality?: number;
};
