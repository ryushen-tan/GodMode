const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const sharp = require("sharp");
const sqliteVec = require("sqlite-vec");

const { openDb, initSchema, run } = require("./db");
const { sha256, ahashFromRgba } = require("./imageFingerprint");
const { embedImageViaCohere } = require("./cohereEmbed");

async function listImagesRecursive(folder) {
  const out = [];
  async function walk(dir) {
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    for (const ent of entries) {
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) await walk(p);
      else if (ent.isFile()) {
        const ext = path.extname(ent.name).toLowerCase();
        if (ext === ".png" || ext === ".jpg" || ext === ".jpeg" || ext === ".webp") out.push(p);
      }
    }
  }
  await walk(folder);
  return out;
}

async function ensureVecTables(db, dims) {
  sqliteVec.load(db);
  await run(db, `CREATE VIRTUAL TABLE IF NOT EXISTS asset_embeddings USING vec0(embedding FLOAT[${dims}], asset_id INTEGER);`);
}

async function indexSprites({ spritesRoot, dbPath, embeddingModel, thumbSize = 256 }) {
  if (!spritesRoot) throw new Error("indexSprites: spritesRoot is required");

  const { db, dbPath: finalDbPath } = openDb({ dbPath });
  await initSchema(db);

  const files = await listImagesRecursive(spritesRoot);
  const now = Date.now();

  let vecInitialized = false;
  for (const filePath of files) {
    const stat = await fsp.stat(filePath);
    const buf = await fsp.readFile(filePath);
    const hash = sha256(buf);

    const img = sharp(buf, { failOn: "none" });
    const meta = await img.metadata();

    const tiny = await img
      .clone()
      .resize(8, 8, { fit: "fill" })
      .raw()
      .ensureAlpha()
      .toBuffer({ resolveWithObject: true });

    const ahash = ahashFromRgba({ rgba: tiny.data, width: 8, height: 8 });

    const inserted = await run(
      db,
      `INSERT INTO assets(path, sha256, ahash, bytes, width, height, mtime_ms, indexed_at_ms)
       VALUES(?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(path) DO UPDATE SET
         sha256=excluded.sha256,
         ahash=excluded.ahash,
         bytes=excluded.bytes,
         width=excluded.width,
         height=excluded.height,
         mtime_ms=excluded.mtime_ms,
         indexed_at_ms=excluded.indexed_at_ms;`,
      [filePath, hash, ahash, stat.size, meta.width || null, meta.height || null, stat.mtimeMs, now],
    );

    // sqlite3 doesn't easily expose last_insert_rowid() on upsert; re-select by path.
    const row = await new Promise((resolve, reject) => {
      db.get(`SELECT id FROM assets WHERE path=?`, [filePath], (err, r) => (err ? reject(err) : resolve(r)));
    });
    const assetId = row.id;

    // Embed thumbnail and store vector
    const thumbBuf = await img
      .clone()
      .resize(thumbSize, thumbSize, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer();

    const vector = await embedImageViaCohere({ imageBuffer: thumbBuf, model: embeddingModel || "embed-v4.0" });
    if (!vecInitialized) {
      await ensureVecTables(db, vector.length);
      vecInitialized = true;
    }

    // Replace any existing embedding for this asset_id
    await run(db, `DELETE FROM asset_embeddings WHERE asset_id=?`, [assetId]);
    await run(db, `INSERT INTO asset_embeddings(asset_id, embedding) VALUES(?, ?)`, [
      assetId,
      new Float32Array(vector),
    ]);
  }

  await new Promise((resolve) => db.close(resolve));
  return { indexed: files.length, dbPath: finalDbPath };
}

module.exports = { indexSprites };
