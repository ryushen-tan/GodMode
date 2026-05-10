const path = require("path");
const sqlite3 = require("sqlite3");

function openDb({ dbPath }) {
  const finalPath = dbPath || path.join(process.cwd(), "asset_index.sqlite");
  const db = new sqlite3.Database(finalPath);
  return { db, dbPath: finalPath };
}

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

function get(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
  });
}

function all(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)));
  });
}

async function initSchema(db) {
  await run(
    db,
    `CREATE TABLE IF NOT EXISTS assets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      path TEXT NOT NULL UNIQUE,
      sha256 TEXT NOT NULL,
      embedding_sha256 TEXT,
      ahash TEXT,
      bytes INTEGER,
      width INTEGER,
      height INTEGER,
      mtime_ms INTEGER,
      indexed_at_ms INTEGER NOT NULL
    );`,
  );
  // Migration for existing DBs created before embedding_sha256 existed.
  try {
    await run(db, `ALTER TABLE assets ADD COLUMN embedding_sha256 TEXT;`);
  } catch (err) {
    // Duplicate column error is expected on upgraded DBs.
    const msg = String(err && err.message ? err.message : err);
    if (!/duplicate column name|already exists/i.test(msg)) throw err;
  }
  await run(db, `CREATE INDEX IF NOT EXISTS idx_assets_sha256 ON assets(sha256);`);
  await run(db, `CREATE INDEX IF NOT EXISTS idx_assets_embedding_sha256 ON assets(embedding_sha256);`);
  await run(db, `CREATE INDEX IF NOT EXISTS idx_assets_ahash ON assets(ahash);`);
  // embeddings table via sqlite-vec will be initialized by the indexer.
}

module.exports = { openDb, initSchema, run, get, all };
