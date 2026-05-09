# Run TripoSR on AWS EC2 (g5.xlarge)

A short, copy-pasteable guide. Total time: ~30 minutes including AWS console clicking.

## 1. Launch the instance

In the AWS Console → EC2 → Launch Instances:

- **Name**: `godmode-triposr`
- **AMI**: search for **"Deep Learning Base OSS Nvidia Driver GPU AMI (Ubuntu 22.04)"** — select the latest
- **Instance type**: `g5.xlarge` (1 × NVIDIA A10G, 24 GB VRAM, ~$1.00/hr)
- **Key pair**: create or pick an existing one (you'll need the `.pem` file)
- **Network settings → Edit**:
  - Allow SSH from My IP
  - Add a custom TCP rule: **port 8000**, source 0.0.0.0/0 (or restrict to your IP for safety)
- **Storage**: 50 GB gp3 is plenty
- Launch.

Wait until "Status check" is `2/2 passed`. Note the **Public IPv4 DNS** (e.g. `ec2-54-241-12-34.us-west-1.compute.amazonaws.com`).

## 2. Upload + run the bootstrap

From your laptop, in the project root:

```bash
chmod 400 ~/Downloads/<your-key>.pem
scp -i ~/Downloads/<your-key>.pem \
  scripts/aws-triposr-setup.sh \
  scripts/triposr_server.py \
  ubuntu@<EC2-PUBLIC-DNS>:~/

ssh -i ~/Downloads/<your-key>.pem ubuntu@<EC2-PUBLIC-DNS>
```

Now on the EC2 box:

```bash
chmod +x aws-triposr-setup.sh
./aws-triposr-setup.sh
```

Expected output ends with:

```
[setup] ready ✅
{"device":"cuda","ok":true}
```

First run downloads the TripoSR weights (~1 GB) and PyTorch, ~5–10 min. Subsequent reboots are ~30 sec.

## 3. Point the local backend at it

In your local `.env`:

```
TRIPOSR_URL=http://<EC2-PUBLIC-DNS>:8000
```

(also mirror to `electron/.env`).

Restart the backend:

```
cd /Users/petarisakovic/Desktop/GodMode/backend && npm start
```

In Electron, the **3D provider** dropdown now has a working **TripoSR (AWS EC2, ~5s)** option.

## 4. Cost discipline

`g5.xlarge` bills `$1.006/hr`. Stop the instance when you're done:

- AWS Console → EC2 → select instance → **Instance state → Stop instance** (preserves disk so next start is fast)
- Or **Terminate** to delete completely

A stopped instance still bills for the EBS volume (~$4/month for 50 GB).

## 5. Health check & debugging

From your laptop:

```bash
curl http://<EC2-PUBLIC-DNS>:8000/health
# -> {"device":"cuda","ok":true}
```

On the EC2 box, server logs:

```bash
tail -f /tmp/triposr.log
```

If it crashed, restart:

```bash
pkill -f triposr_server.py
nohup python3 ~/triposr_server.py > /tmp/triposr.log 2>&1 &
```

## Notes

- The server loads the model into GPU memory once and keeps it warm. First request after instance start takes ~5–10s extra (model load); subsequent requests are 3–5s.
- TripoSR generally produces cleaner, more coherent output than Stable Fast 3D for complex/colorful subjects, at similar speed once warm.
- Output is a triangle-mesh GLB with vertex colors (no PBR textures). For pure geometric shapes that's fine; for richly textured subjects, Meshy is still the quality leader.
