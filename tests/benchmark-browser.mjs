import fs from "node:fs";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { build } from "esbuild";
import { chromium } from "playwright";
import { baseURL, browserChannel, artifact } from "./browser-support.mjs";

const bundle = await build({
  stdin: {
    contents:
      "export { GameStorage, captureSimulation } from './src/persistence.js';",
    resolveDir: process.cwd(),
  },
  bundle: true,
  write: false,
  format: "iife",
  globalName: "Baseline",
});
const browser = await chromium.launch({
  channel: browserChannel,
  headless: true,
});
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 960 },
    deviceScaleFactor: 1,
  });
  await page.goto(baseURL);
  await page.waitForFunction(() => window.groundControl);
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const measurements = await page.evaluate(() => {
    groundControl.setPaused(true);
    const { sim, map } = groundControl;
    sim.reset();
    sim.nextArrival = sim.nextDeparture = Infinity;
    sim.planes = sim.planes.filter((p) => p.direction === "departure");
    for (const stand of sim.freeStands()) {
      if (sim.planes.length >= 24) break;
      sim.spawnDeparture(stand.id);
    }
    for (const p of sim.planes) sim.command(p.id, "pushback");
    const initial = JSON.parse(JSON.stringify(sim.planes));
    const measure = (callback, warmup = 20, samples = 100) => {
      for (let i = 0; i < warmup; i++) callback();
      const times = [];
      for (let i = 0; i < samples; i++) {
        const start = performance.now();
        callback();
        times.push(performance.now() - start);
      }
      times.sort((a, b) => a - b);
      return {
        medianMs: times[Math.floor(times.length / 2)],
        p95Ms: times[Math.floor(times.length * 0.95)],
      };
    };
    return [24, 60, 120].map((count) => {
      sim.planes = Array.from({ length: count }, (_, i) => ({
        ...structuredClone(initial[i % initial.length]),
        id: i + 1,
        call: "TEST" + (i + 1),
      }));
      sim.nextId = count + 1;
      const storage = new Baseline.GameStorage(sim.data);
      storage.key = "ground-control:benchmark";
      const tick = measure(() => sim.tick(0.1));
      const canvasDraw = measure(() => map.draw());
      const save = measure(() => storage.save(sim, {}));
      const bytes = new TextEncoder().encode(
        localStorage.getItem(storage.key),
      ).byteLength;
      localStorage.removeItem(storage.key);
      return {
        aircraft: count,
        workload:
          count === 24
            ? "24 distinct Edinburgh stands, concurrent pushback"
            : "Synthetic overlapping copies; stress test, not gameplay capacity",
        tick,
        canvasDraw,
        save,
        saveBytes: bytes,
      };
    });
  });
  const report = {
    capturedAt: new Date().toISOString(),
    sourceCommit: execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim(),
    platform: `${os.platform()} ${os.release()} ${os.arch()}`,
    cpu: os.cpus()[0].model,
    node: process.version,
    browser: await browser.version(),
    viewport: "1440x960 DPR 1, headless",
    method:
      "20 warmups + 100 samples. Tick = 0.1 simulation seconds. Canvas draw measures synchronous submission, not GPU completion or full UI frame time. Save includes capture, JSON and localStorage. Timing is diagnostic, not a test threshold.",
    measurements,
  };
  fs.writeFileSync(
    artifact("benchmark.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}
