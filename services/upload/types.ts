export type UploadedImage = {
  imageUrl: string;
  id?: string;
};

export type UploadImageOptions = {
  fieldName?: string;
  headers?: Record<string, string>;
  signal?: AbortSignal;
};
