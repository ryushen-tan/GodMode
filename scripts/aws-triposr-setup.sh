#!/bin/bash
# Bootstrap any Ubuntu GPU box for TripoSR + a Cloudflare quick-tunnel
# that exposes the Flask server to the public internet without any
# config. Tested on AWS EC2 g5.xlarge (Deep Learning Base AMI) and
# generic Ubuntu compute servers (CoCalc, Lambda Labs, etc).
#
# Run this on the GPU box (NOT locally). The end of the script prints
# a public https://*.trycloudflare.com URL — paste that into your
# local .env as TRIPOSR_URL.
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
HEALTHY=false
for i in $(seq 1 60); do
  if curl -sf http://localhost:8000/health > /dev/null 2>&1; then
    HEALTHY=true
    break
  fi
  sleep 2
done

if [ "$HEALTHY" != "true" ]; then
  echo "[setup] server didn't come up. Last 20 lines of log:"
  tail -20 /tmp/triposr.log
  exit 1
fi

echo "[setup] flask server ready ✅"
curl -s http://localhost:8000/health
echo

# ---- Cloudflare quick-tunnel for public access ----
# Skips installation if cloudflared already exists. No login or account
# required — `cloudflared tunnel --url ...` issues a one-time URL.
if ! command -v cloudflared > /dev/null; then
  echo "[setup] installing cloudflared…"
  curl -sSL -o /tmp/cloudflared.deb \
    https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
  sudo dpkg -i /tmp/cloudflared.deb
fi

echo "[setup] starting Cloudflare tunnel for http://localhost:8000…"
pkill -f "cloudflared.*localhost:8000" 2>/dev/null || true
nohup cloudflared tunnel --no-autoupdate --url http://localhost:8000 \
  > /tmp/cloudflared.log 2>&1 &

# Tail the log until cloudflared prints its public URL
echo "[setup] waiting for tunnel URL…"
for i in $(seq 1 30); do
  URL=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' /tmp/cloudflared.log | head -1)
  if [ -n "$URL" ]; then
    echo
    echo "============================================================"
    echo "  TripoSR tunnel ready ✅"
    echo
    echo "  Public URL:  $URL"
    echo
    echo "  Set this in your local .env:"
    echo "    TRIPOSR_URL=$URL"
    echo "============================================================"
    echo
    echo "  Health check:"
    curl -sS "$URL/health"
    echo
    exit 0
  fi
  sleep 1
done

echo "[setup] timed out waiting for tunnel. Last 20 log lines:"
tail -20 /tmp/cloudflared.log
exit 1
