const path = require("path");
const fs = require("fs");
const puppeteer = require("puppeteer");
const express = require("express");

async function withTempModelServer(modelPath, fn) {
  const app = express();
  app.get("/model.glb", (_req, res) => {
    res.setHeader("Content-Type", "model/gltf-binary");
    res.setHeader("Access-Control-Allow-Origin", "*");
    fs.createReadStream(modelPath).pipe(res);
  });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const port = server.address().port;
  try {
    return await fn(`http://127.0.0.1:${port}/model.glb`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function htmlForRenderer() {
  // (Backend is dev/local; for prod you’d bundle these assets.)
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <style>
    html, body { margin:0; padding:0; background: transparent; }
    canvas { display:block; }
  </style>
</head>
<body>
  <canvas id="c"></canvas>
  <script type="importmap">
    {
      "imports": {
        "three": "https://unpkg.com/three@0.168.0/build/three.module.js",
        "three/addons/": "https://unpkg.com/three@0.168.0/examples/jsm/"
      }
    }
  </script>
  <script type="module">
    import * as THREE from "three";
    import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
    import { OrbitControls } from "three/addons/controls/OrbitControls.js";
    import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

    const params = new URLSearchParams(location.search);
    const url = params.get("url");
    const size = Number(params.get("size") || 512);

    const canvas = document.getElementById("c");
    canvas.width = size;
    canvas.height = size;

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setSize(size, size, false);
    renderer.setPixelRatio(1);
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(35, 1, 0.01, 1000);
    camera.position.set(2, 1.5, 2);

    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const key = new THREE.DirectionalLight(0xffffff, 1.2);
    key.position.set(5, 8, 5);
    scene.add(key);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.enablePan = false;
    controls.enableZoom = false;

    const loader = new GLTFLoader();
    try {
      const gltf = await loader.loadAsync(url);
      const root = gltf.scene || gltf.scenes[0];
      scene.add(root);

      // Center + fit camera
      const box = new THREE.Box3().setFromObject(root);
      const sizeV = new THREE.Vector3();
      const center = new THREE.Vector3();
      box.getSize(sizeV);
      box.getCenter(center);
      root.position.sub(center);
      const maxDim = Math.max(sizeV.x, sizeV.y, sizeV.z) || 1;
      const dist = maxDim * 2.2;
      camera.position.set(dist, dist * 0.8, dist);
      camera.lookAt(0, 0, 0);
      controls.target.set(0, 0, 0);
      controls.update();

      // Render a few frames to settle materials
      for (let i = 0; i < 5; i++) {
        controls.update();
        renderer.render(scene, camera);
        await new Promise(r => setTimeout(r, 30));
      }

      // Expose PNG data URL
      const png = renderer.domElement.toDataURL("image/png");
      window.__RENDER_DONE__ = png;
    } catch (e) {
      window.__RENDER_ERROR__ = (e && e.message) ? e.message : String(e);
    }
  </script>
</body>
</html>`;
}

async function renderGlbToPng({ glbPathOrUrl, size = 512 }) {
  const launchArgs = [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--enable-webgl",
    "--ignore-gpu-blocklist",
    "--use-gl=angle",
    "--use-angle=metal",
    "--disable-web-security",
    "--allow-running-insecure-content",
    "--disable-features=BlockInsecurePrivateNetworkRequests,PrivateNetworkAccessRespectPreflightResults",
  ];
  const browser = await puppeteer.launch({ headless: "new", args: launchArgs });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: size, height: size, deviceScaleFactor: 1 });
    page.on("console", (msg) => {
      // helpful for debugging headless rendering failures
      // eslint-disable-next-line no-console
      console.log("[render]", msg.text());
    });
    page.on("pageerror", (err) => {
      console.error("[render][pageerror]", err && err.stack ? err.stack : err);
    });
    page.on("requestfailed", (req) => {
      console.error("[render][requestfailed]", req.url(), req.failure());
    });

    let modelUrl = glbPathOrUrl;
    const isHttp = /^https?:\/\//i.test(modelUrl);
    const isFile = /^file:\/\//i.test(modelUrl);
    const isLocalPath = !isHttp && !isFile;

    const html = htmlForRenderer();
    const dataUrl = "data:text/html;charset=utf-8," + encodeURIComponent(html);

    const run = async (finalModelUrl) => {
      await page.goto(`${dataUrl}?url=${encodeURIComponent(finalModelUrl)}&size=${size}`, {
        waitUntil: "domcontentloaded",
        timeout: 120000,
      });

      const probe = await page.evaluate(async (u) => {
        try {
          const r = await fetch(u);
          return { ok: r.ok, status: r.status, statusText: r.statusText };
        } catch (e) {
          return { ok: false, error: e && e.message ? e.message : String(e) };
        }
      }, finalModelUrl);
      if (!probe.ok) {
        throw new Error(
          `renderGlbToPng: fetch probe failed for ${finalModelUrl}: ${JSON.stringify(probe)}`,
        );
      }

      const pngDataUrl = await page
        .waitForFunction("window.__RENDER_DONE__ || window.__RENDER_ERROR__", { timeout: 120000 })
        .then(() =>
          page.evaluate(() => ({
            done: window.__RENDER_DONE__ || null,
            err: window.__RENDER_ERROR__ || null,
          })),
        );
      if (pngDataUrl.err) throw new Error(String(pngDataUrl.err));
      const done = pngDataUrl.done;
      const base64 = String(done).split(",")[1];
      if (!base64) throw new Error("renderGlbToPng: failed to produce PNG data");
      return Buffer.from(base64, "base64");
    };

    if (isLocalPath) {
      const resolved = path.resolve(modelUrl);
      return await withTempModelServer(resolved, run);
    }
    return await run(modelUrl);
  } finally {
    await browser.close();
  }
}

module.exports = { renderGlbToPng };
