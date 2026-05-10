// cohere-ai's top-level require hangs under Electron 28's main process,
// so we lazy-load it only when an embed call actually happens.
let _CohereClient = null;
function getCohereClient(token) {
  if (!_CohereClient) {
    _CohereClient = require("cohere-ai").CohereClient;
  }
  return new _CohereClient({ token });
}

function getRequiredEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

function bufferToDataUrlPng(buffer) {
  // Cohere accepts data URLs for images; PNG works well for sprites/thumbnails.
  return `data:image/png;base64,${buffer.toString("base64")}`;
}

async function embedImageViaCohere({ imageBuffer, model = "embed-v4.0" }) {
  const apiKey = getRequiredEnv("COHERE_API_KEY");
  const cohere = getCohereClient(apiKey);

  const imageBase64 = bufferToDataUrlPng(imageBuffer);
  const resp = await cohere.v2.embed({
    model,
    inputType: "image",
    embeddingTypes: ["float"],
    images: [imageBase64],
  });

  // Cohere response: { embeddings: { float: number[][], int8?: ... } }
  const vectors = resp?.embeddings?.float;
  const vector = Array.isArray(vectors) ? vectors[0] : null;
  if (!Array.isArray(vector) || typeof vector[0] !== "number") {
    throw new Error("Cohere embed: unexpected response shape");
  }
  return vector;
}

module.exports = { embedImageViaCohere };
