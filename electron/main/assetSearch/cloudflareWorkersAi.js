function getRequiredEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

function workersAiEndpoint(accountId, model) {
  return `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${encodeURIComponent(model)}`;
}

async function embedImageViaWorkersAi({ imageBuffer, model }) {
  const accountId = getRequiredEnv("CLOUDFLARE_ACCOUNT_ID");
  const token = getRequiredEnv("CLOUDFLARE_API_TOKEN");
  if (!model) throw new Error("embedImageViaWorkersAi: model is required");

  const endpoint = workersAiEndpoint(accountId, model);
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      // Workers AI supports base64-encoded image payloads for many models.
      image: imageBuffer.toString("base64"),
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Workers AI embed failed (${res.status} ${res.statusText})${text ? ` — ${text}` : ""}`,
    );
  }
  const data = await res.json();

  // Normalize common response shapes. You may need to adjust based on the specific model.
  const vector =
    (data && data.result && (data.result.data || data.result.embedding || data.result)) ||
    data.data ||
    data.embedding;

  if (!Array.isArray(vector) || typeof vector[0] !== "number") {
    throw new Error(
      `Workers AI embed: unexpected response shape (set CLOUDFLARE_EMBEDDING_MODEL to an embeddings-capable model).`,
    );
  }
  return vector;
}

module.exports = { embedImageViaWorkersAi };
