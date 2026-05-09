#!/bin/bash
# Bootstrap a fresh g5.xlarge running Ubuntu 22.04 Deep Learning AMI for TripoSR.
# Run this on the EC2 box (NOT locally). It installs deps, clones TripoSR,
# downloads the model, and starts the Flask server on :8000.
set -e

cd ~

echo "[setup] system packages…"
sudo apt-get update -y
sudo apt-get install -y python3-pip git build-essential libgl1 libglib2.0-0

echo "[setup] python packages…"
python3 -m pip install --upgrade pip
python3 -m pip install \
  torch torchvision --index-url https://download.pytorch.org/whl/cu121
python3 -m pip install \
  trimesh omegaconf einops rembg flask Pillow \
  huggingface_hub onnxruntime-gpu transformers

# torchmcubes is optional but speeds up mesh extraction substantially.
# Try a couple of install routes.
python3 -m pip install \
  https://github.com/camenduru/wheels/releases/download/colab/torchmcubes-0.1.0-cp310-cp310-linux_x86_64.whl \
  || python3 -m pip install torchmcubes \
  || echo "[setup] torchmcubes optional — continuing without"

echo "[setup] cloning TripoSR repo…"
if [ -d TripoSR ]; then
  (cd TripoSR && git pull)
else
  git clone https://github.com/VAST-AI-Research/TripoSR.git
fi

echo "[setup] copying server file from this repo…"
# This script is shipped alongside triposr_server.py — copy it to ~ so it's
# at the path the server expects relative to the cloned TripoSR.
cp -f "$(dirname "$0")/triposr_server.py" ~/triposr_server.py

echo "[setup] starting server on :8000 (logs: tail -f /tmp/triposr.log)…"
pkill -f triposr_server.py 2>/dev/null || true
nohup python3 ~/triposr_server.py > /tmp/triposr.log 2>&1 &
sleep 2

# Wait until /health returns 200 (model load can take 30-60s on cold start)
echo "[setup] waiting for /health…"
for i in $(seq 1 60); do
  if curl -sf http://localhost:8000/health > /dev/null 2>&1; then
    echo "[setup] ready ✅"
    curl -s http://localhost:8000/health
    echo
    exit 0
  fi
  sleep 2
done

echo "[setup] timed out waiting for server. Last 20 log lines:"
tail -20 /tmp/triposr.log
exit 1
