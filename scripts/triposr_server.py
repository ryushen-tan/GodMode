#!/usr/bin/env python3
"""TripoSR HTTP server.

Run on a GPU instance after the bootstrap script. Listens on :8000.

POST /generate
  - multipart/form-data with `image` field, OR
  - JSON { "image_b64": "..." }
  - returns model/gltf-binary

GET /health
  - { ok: true, device: "cuda" | "cpu" }
"""
import base64
import io
import os
import sys
import time

import rembg
import torch
from flask import Flask, jsonify, request, send_file
from PIL import Image

# Repo cloned to ~/TripoSR by the bootstrap script
sys.path.insert(0, os.path.expanduser("~/TripoSR"))
from tsr.system import TSR  # noqa: E402

app = Flask(__name__)
device = "cuda" if torch.cuda.is_available() else "cpu"

print(f"[triposr] loading model on {device}…")
t0 = time.time()
model = TSR.from_pretrained(
    "stabilityai/TripoSR",
    config_name="config.yaml",
    weight_name="model.ckpt",
)
model.renderer.set_chunk_size(8192)
model.to(device)
print(f"[triposr] loaded in {time.time() - t0:.1f}s")

rembg_session = rembg.new_session()


def preprocess(img: Image.Image) -> Image.Image:
    img = rembg.remove(img, session=rembg_session).convert("RGBA")
    bg = Image.new("RGBA", img.size, (255, 255, 255, 255))
    bg.paste(img, mask=img.split()[3])
    img = bg.convert("RGB")
    if img.size[0] != img.size[1]:
        m = max(img.size)
        sq = Image.new("RGB", (m, m), (255, 255, 255))
        sq.paste(img, ((m - img.size[0]) // 2, (m - img.size[1]) // 2))
        img = sq
    return img.resize((512, 512), Image.LANCZOS)


@app.get("/health")
def health():
    return jsonify({"ok": True, "device": device})


@app.post("/generate")
def generate():
    img = None
    if "image" in request.files:
        img = Image.open(request.files["image"]).convert("RGB")
    elif request.is_json:
        body = request.get_json(silent=True) or {}
        if body.get("image_b64"):
            img = Image.open(io.BytesIO(base64.b64decode(body["image_b64"]))).convert("RGB")

    if img is None:
        return jsonify({"error": "image required (multipart 'image' or JSON 'image_b64')"}), 400

    started = time.time()
    img = preprocess(img)
    with torch.no_grad():
        scene_codes = model([img], device=device)
    meshes = model.extract_mesh(scene_codes, resolution=256)
    if not meshes:
        return jsonify({"error": "no mesh extracted"}), 500

    buf = io.BytesIO()
    meshes[0].export(buf, file_type="glb")
    buf.seek(0)
    elapsed_ms = int((time.time() - started) * 1000)
    print(f"[triposr] generated GLB in {elapsed_ms}ms")

    resp = send_file(buf, mimetype="model/gltf-binary", as_attachment=False, download_name="model.glb")
    resp.headers["X-TripoSR-Elapsed-Ms"] = str(elapsed_ms)
    return resp


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8000, threaded=False)
