import { MockThreeDProvider, pollThreeDGeneration } from "./index";

async function main() {
  const provider = new MockThreeDProvider({ pollsUntilComplete: 3 });

  const job = await provider.startGeneration({
    imageUrl: "fake://img.png",
    mode: "object",
  });
  console.log("started:", job);

  const result = await pollThreeDGeneration({
    provider,
    jobId: job.jobId,
    intervalMs: 200,
    onProgress: (j) => console.log("poll:", j.status, j.progress),
  });

  console.log("done:", result);
}

main().catch((err) => {
  console.error("FAIL:", err);
  process.exit(1);
});
