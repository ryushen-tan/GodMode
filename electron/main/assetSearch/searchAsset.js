const sharp = require("sharp");
const sqliteVec = require("sqlite-vec");
const { openDb, initSchema, all, get } = require("./db");
const { sha256, ahashFromRgba, hammingDistanceHex } = require("./imageFingerprint");
const { embedImageViaCohere } = require("./cohereEmbed");

function cosineSimilarityFromDistance(distance) {
  // sqlite-vec vec0 defaults to cosine distance for FLOAT vectors: distance = 1 - cosineSim
  if (typeof distance !== "number") return null;
  const cos = 1 - distance;
  if (!Number.isFinite(cos)) return null;
  return cos;
}

async function computeAhash(buffer) {
  const tiny = await sharp(buffer, { failOn: "none" })
    .resize(8, 8, { fit: "fill" })
    .raw()
    .ensureAlpha()
    .toBuffer({ resolveWithObject: true });
  return ahashFromRgba({ rgba: tiny.data, width: 8, height: 8 });
}

async function searchAsset({
  imageBuffer,
  dbPath,
  embeddingModel,
  topK = 5,
  thumbSize = 256,
  minCosineSimilarity = 0.85,
}) {
  if (!imageBuffer) throw new Error("searchAsset: imageBuffer is required");

  const { db, dbPath: finalDbPath } = openDb({ dbPath });
  await initSchema(db);

  const s256 = sha256(imageBuffer);
  const exact = await get(db, `SELECT * FROM assets WHERE sha256=?`, [s256]);
  if (exact) {
    db.close();
    return { match: exact, method: "sha256", dbPath: finalDbPath, alternatives: [] };
  }

  const qhash = await computeAhash(imageBuffer);
  const candidates = await all(db, `SELECT * FROM assets WHERE ahash IS NOT NULL`, []);
  const ranked = candidates
    .map((c) => ({ c, d: hammingDistanceHex(qhash, c.ahash) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, Math.max(topK, 10));

  if (ranked.length && ranked[0].d <= 5) {
    db.close();
    return {
      match: ranked[0].c,
      method: "ahash",
      dbPath: finalDbPath,
      alternatives: ranked.slice(1, topK).map((r) => r.c),
    };
  }

  // Vector fallback
  sqliteVec.load(db);
  const thumbBuf = await sharp(imageBuffer, { failOn: "none" })
    .resize(thumbSize, thumbSize, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();

  const vector = await embedImageViaCohere({ imageBuffer: thumbBuf, model: embeddingModel || "embed-v4.0" });
  const vec = new Float32Array(vector);

  const rows = await all(
    db,
    `SELECT a.*, e.distance
     FROM asset_embeddings e
     JOIN assets a ON a.id = e.asset_id
     WHERE e.embedding MATCH ? AND k = ?
     ORDER BY e.distance ASC;`,
    [vec, topK],
  );

  const withScores = (rows || []).map((r) => ({
    ...r,
    cosineSim: cosineSimilarityFromDistance(r.distance),
  }));

  const best = withScores[0] || null;
  const bestCos = typeof best?.cosineSim === "number" ? best.cosineSim : null;
  const passes = !!(best && bestCos != null && bestCos >= minCosineSimilarity);

  db.close();
  return {
    match: passes ? best : null,
    method: "vector",
    dbPath: finalDbPath,
    alternatives: withScores.slice(1),
    score: bestCos,
    threshold: minCosineSimilarity,
  };
}

module.exports = { searchAsset };
