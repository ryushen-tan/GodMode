import http from "node:http";
import { AddressInfo } from "node:net";

import {
  uploadImage,
  BackendThreeDProvider,
  pollThreeDGeneration,
} from "./index";

type Job = {
  jobId: string;
  imageUrl: string;
  pollCount: number;
  pollsUntilDone: number;
};

const POLLS_UNTIL_DONE = 3;

function startServer(): Promise<{ url: string; close: () => Promise<void>; uploadCount: () => number; jobs: Map<string, Job> }> {
  const jobs = new Map<string, Job>();
  let uploadCount = 0;

  const server = http.createServer((req, res) => {
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };

    const url = new URL(req.url ?? "/", "http://localhost");

    if (req.method === "POST" && url.pathname === "/api/upload-image") {
      // Drain body, return fake URL
      const chunks: Buffer[] = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        const total = Buffer.concat(chunks).length;
        if (total === 0) {
          send(400, { error: "empty body" });
          return;
        }
        uploadCount++;
        send(200, { imageUrl: `https://fake.cdn/img-${uploadCount}.png`, id: `img-${uploadCount}` });
      });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/3d/start") {
      const chunks: Buffer[] = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        const body = JSON.parse(Buffer.concat(chunks).toString() || "{}");
        if (typeof body.imageUrl !== "string") {
          send(400, { error: "imageUrl required" });
          return;
        }
        const jobId = `job-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        jobs.set(jobId, { jobId, imageUrl: body.imageUrl, pollCount: 0, pollsUntilDone: POLLS_UNTIL_DONE });
        send(200, { jobId, status: "queued" });
      });
      return;
    }

    const statusMatch = url.pathname.match(/^\/api\/3d\/status\/(.+)$/);
    if (req.method === "GET" && statusMatch) {
      const jobId = decodeURIComponent(statusMatch[1]);
      const job = jobs.get(jobId);
      if (!job) {
        send(404, { error: "unknown job" });
        return;
      }
      job.pollCount++;
      if (job.pollCount >= job.pollsUntilDone) {
        send(200, {
          jobId,
          status: "completed",
          progress: 100,
          modelUrl: "https://fake.cdn/model.glb",
        });
        return;
      }
      send(200, {
        jobId,
        status: "processing",
        progress: Math.round((job.pollCount / job.pollsUntilDone) * 100),
      });
      return;
    }

    send(404, { error: "not found" });
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as AddressInfo).port;
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise((r) => server.close(() => r())),
        uploadCount: () => uploadCount,
        jobs,
      });
    });
  });
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`ASSERT FAILED: ${msg}`);
}

function makeFakePngFile(): File {
  // Minimal 1x1 PNG bytes (real signature so it's a valid file).
  const png = Buffer.from(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6300010000000500010d0a2db40000000049454e44ae426082",
    "hex",
  );
  return new File([png], "fake.png", { type: "image/png" });
}

async function main() {
  const server = await startServer();
  console.log(`mock server: ${server.url}`);

  try {
    // 1. uploadImage
    console.log("\n[1] uploadImage");
    const uploaded = await uploadImage(makeFakePngFile(), `${server.url}/api/upload-image`);
    console.log("  →", uploaded);
    assert(uploaded.imageUrl.startsWith("https://fake.cdn/"), "imageUrl should be fake CDN");
    assert(uploaded.id === "img-1", "id should be img-1");
    assert(server.uploadCount() === 1, "server should have received 1 upload");

    // 2. BackendThreeDProvider.startGeneration
    console.log("\n[2] BackendThreeDProvider.startGeneration");
    const provider = new BackendThreeDProvider({ baseUrl: server.url });
    const started = await provider.startGeneration({
      imageUrl: uploaded.imageUrl,
      prompt: "test",
      mode: "object",
    });
    console.log("  →", started);
    assert(started.status === "queued", "status should be queued");
    assert(typeof started.jobId === "string" && started.jobId.length > 0, "jobId required");

    // 3. pollThreeDGeneration (real HTTP polling)
    console.log("\n[3] pollThreeDGeneration");
    const progressLog: number[] = [];
    const result = await pollThreeDGeneration({
      provider,
      jobId: started.jobId,
      intervalMs: 50,
      timeoutMs: 5000,
      onProgress: (j) => {
        progressLog.push(j.progress ?? -1);
        console.log("  poll:", j.status, j.progress);
      },
    });
    console.log("  →", result);
    assert(result.modelUrl === "https://fake.cdn/model.glb", "modelUrl should match");
    assert(result.format === "glb", "format should be glb");
    assert(progressLog.includes(100), "should have seen 100% progress");

    // 4. Error path: bad endpoint
    console.log("\n[4] error path: 404 endpoint");
    let caught = false;
    try {
      await uploadImage(makeFakePngFile(), `${server.url}/nope`);
    } catch (err) {
      caught = true;
      console.log("  caught:", (err as Error).message.slice(0, 80));
    }
    assert(caught, "should throw on 404");

    // 5. Error path: provider for unknown job
    console.log("\n[5] error path: unknown jobId returns failed");
    let caught2 = false;
    try {
      await pollThreeDGeneration({
        provider,
        jobId: "does-not-exist",
        intervalMs: 50,
        timeoutMs: 1000,
      });
    } catch (err) {
      caught2 = true;
      console.log("  caught:", (err as Error).message.slice(0, 80));
    }
    assert(caught2, "should reject on backend 404 / failed status");

    console.log("\n✅ all integration checks passed");
  } finally {
    await server.close();
  }
}

main().catch((err) => {
  console.error("\n❌ FAIL:", err);
  process.exit(1);
});
