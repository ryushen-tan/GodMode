const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const { v2: cloudinary } = require("cloudinary");

function getEnv(name) {
  const v = process.env[name];
  return v && String(v).trim() ? String(v).trim() : "";
}

function assertCloudinaryConfigured() {
  const apiKey = getEnv("CLOUDINARY_API_KEY");
  const apiSecret = getEnv("CLOUDINARY_API_SECRET");
  const cloudName = getEnv("CLOUDINARY_CLOUD_NAME");
  if (!apiKey || !apiSecret || !cloudName) {
    throw new Error("Cloudinary creds missing (CLOUDINARY_API_KEY/SECRET/CLOUD_NAME) in repo root .env");
  }
  cloudinary.config({ cloud_name: cloudName, api_key: apiKey, api_secret: apiSecret, secure: true });
}

async function uploadBuffer({ buffer, publicId, resourceType, format, tags }) {
  assertCloudinaryConfigured();
  const b64 = buffer.toString("base64");
  const dataUri = `data:application/octet-stream;base64,${b64}`;
  const res = await cloudinary.uploader.upload(dataUri, {
    public_id: publicId,
    resource_type: resourceType, // "image" | "raw"
    format,
    tags,
    overwrite: true,
  });
  return res;
}

async function uploadGenerated3DAsset({ id, glbBuffer, previewPngBuffer }) {
  const baseId = `generated/${id}`;
  const [img, glb] = await Promise.all([
    uploadBuffer({
      buffer: previewPngBuffer,
      publicId: `${baseId}_preview`,
      resourceType: "image",
      format: "png",
      tags: ["generated", "preview"],
    }),
    uploadBuffer({
      buffer: glbBuffer,
      publicId: `${baseId}.glb`,
      resourceType: "raw",
      format: "glb",
      tags: ["generated", "glb"],
    }),
  ]);

  return {
    cloudinaryPreviewUrl: img.secure_url,
    cloudinaryGlbUrl: glb.secure_url,
  };
}

module.exports = { uploadGenerated3DAsset };
