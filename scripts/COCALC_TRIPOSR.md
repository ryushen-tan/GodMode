# Run TripoSR on CoCalc

CoCalc-specific guide. The same scripts work on AWS, Lambda Labs, and any
Ubuntu GPU box — CoCalc just doesn't expose arbitrary ports publicly, so
the bootstrap also opens a Cloudflare quick-tunnel for you.

## 1. Provision a GPU compute server

In CoCalc:

1. Sign in / sign up at https://cocalc.com
2. Create a project (or reuse one)
3. **Compute Servers → Create Compute Server**
4. **Type**: pick a GPU machine — `T4 1x` is plenty for TripoSR (~$0.40/hr) and noticeably cheaper than AWS g5
5. **Image**: pick **"PyTorch GPU"** — comes with CUDA + PyTorch pre-installed
6. **Storage**: 50 GB is fine
7. **Spend rate**: set a cap (~$5/day) so a forgotten server can't run away
8. Start the server. Wait until status is **Running**

## 2. Open a terminal on it

In CoCalc, with the compute server selected, click **Terminal**. This drops you onto a bash shell inside the GPU box, with sudo, internet, and Python pre-set.

## 3. Upload + run the bootstrap

From your laptop, copy the two scripts to the project. Easiest way: in CoCalc's project file browser, drag-drop `scripts/aws-triposr-setup.sh` and `scripts/triposr_server.py` into the project root.

Then in the compute-server terminal:

```bash
cd ~
cp /home/user/aws-triposr-setup.sh ~/  # path may vary; copy from project
cp /home/user/triposr_server.py ~/
chmod +x ~/aws-triposr-setup.sh
./aws-triposr-setup.sh
```

(The `/home/user/` prefix is CoCalc's standard project mount; check the actual path in your terminal with `pwd`.)

The script:

1. Installs PyTorch + dependencies (skipped if already present)
2. Clones the TripoSR repo
3. Starts the Flask server on `:8000`
4. Installs `cloudflared` and opens a public tunnel
5. Prints a `https://*.trycloudflare.com` URL when ready

Expected tail of output:

```
============================================================
  TripoSR tunnel ready ✅

  Public URL:  https://random-words.trycloudflare.com

  Set this in your local .env:
    TRIPOSR_URL=https://random-words.trycloudflare.com
============================================================

  Health check:
{"device":"cuda","ok":true}
```

## 4. Wire it into the local backend

On your laptop, in `.env`:

```
TRIPOSR_URL=https://random-words.trycloudflare.com
```

Mirror to `electron/.env`. Restart the backend:

```
cd /Users/petarisakovic/Desktop/GodMode/backend && npm start
```

In Electron, the **3D provider** dropdown's **TripoSR (AWS EC2, ~5s)** option (works for any tunnel-exposed Flask server, despite the AWS label) will hit your CoCalc box and return GLB.

## 5. Cost discipline

- **Stop the compute server** in CoCalc when you're done (idle bills the GPU). The tunnel + Flask state goes away with it; just re-run the script next time you start.
- The tunnel URL changes every restart — update `.env` after each restart.

## 6. If the tunnel disconnects

Cloudflare quick-tunnels are stable but can drop. To restart on the box:

```bash
pkill -f cloudflared
nohup cloudflared tunnel --no-autoupdate --url http://localhost:8000 > /tmp/cloudflared.log 2>&1 &
sleep 5
grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' /tmp/cloudflared.log | head -1
```

Update `.env` with the new URL, restart the local backend.
