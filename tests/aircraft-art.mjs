import assert from "node:assert/strict";
import { build } from "esbuild";
import { artifact } from "./browser-support.mjs";

export async function verifyAircraftArt(browser) {
  const bundle = await build({
    entryPoints: ["src/aircraft/render.js"],
    bundle: true,
    write: false,
    format: "iife",
    globalName: "aircraftArt",
  });
  const context = await browser.newContext({
    viewport: { width: 1200, height: 820 },
    deviceScaleFactor: 2,
  });
  try {
    const page = await context.newPage();
    await page.setContent(`<style>
      body { margin: 0; background: #182522; color: #e5eae7; font: 14px system-ui; }
      h1 { font-size: 22px; margin: 24px 32px 8px; }
      p { margin: 0 32px 20px; color: #a6b7af; }
      main { display: grid; grid-template-columns: repeat(4, 1fr); }
      figure { margin: 0; text-align: center; border-top: 1px solid #34423d; }
      canvas { display: block; margin: auto; width: 220px; height: 220px; }
      figcaption { padding: 6px 0 14px; color: #c4d0c9; }
    </style><h1>Ground Control / Original Aircraft Artwork</h1>
    <p>Overview, taxi view and close-up. Actual map colors and relative dimensions.</p><main></main>`);
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    const samples = await page.evaluate(() => {
      const results = [];
      for (const [row, zoom] of [0.4, 1, 2.5].entries()) {
        for (const type of [
          "AT72",
          "DH8D",
          "E190",
          "A223",
          "A320",
          "A21N",
          "B738",
          "A333",
          "A359",
          "B77W",
          "B748",
        ]) {
          const figure = document.createElement("figure"),
            canvas = document.createElement("canvas"),
            caption = document.createElement("figcaption");
          canvas.width = 440;
          canvas.height = 440;
          const c = canvas.getContext("2d"),
            color = ["#f4d672", "#c2c4ff", "#f4d672"][row];
          c.scale(2, 2);
          c.translate(110, 110);
          c.rotate(-Math.PI / 2);
          const before = c.getTransform().toString();
          aircraftArt.drawAircraft(c, type, zoom, color);
          const restored = c.getTransform().toString() === before;
          const pixels = c.getImageData(0, 0, 440, 440).data;
          let count = 0,
            minX = 440,
            minY = 440,
            maxX = 0,
            maxY = 0;
          const alpha = [];
          for (let y = 0; y < 440; y++) {
            for (let x = 0; x < 440; x++) {
              const a = pixels[(y * 440 + x) * 4 + 3];
              if (a > 32) {
                count++;
                minX = Math.min(minX, x);
                maxX = Math.max(maxX, x);
                minY = Math.min(minY, y);
                maxY = Math.max(maxY, y);
                alpha.push(y * 440 + x);
              }
            }
          }
          results.push({
            type,
            zoom,
            count,
            minX,
            maxX,
            minY,
            maxY,
            restored,
            size: aircraftArt.aircraftPixels(type, zoom),
            mask: alpha.join(","),
          });
          caption.textContent = `${type} / ${zoom}x`;
          figure.append(canvas, caption);
          document.querySelector("main").append(figure);
        }
      }
      return results;
    });
    for (const sample of samples) {
      assert.ok(sample.count > 35, `${sample.type}: empty silhouette`);
      assert.ok(sample.restored, "Renderer must preserve the map transform");
      assert.ok(sample.minX > 0 && sample.maxX < 439);
      assert.ok(sample.minY > 0 && sample.maxY < 439);
      assert.ok(
        Math.abs((sample.maxY - sample.minY + 1) / 2 - sample.size.length) < 3,
      );
      assert.ok(
        Math.abs((sample.maxX - sample.minX + 1) / 2 - sample.size.wingspan) <
          3,
      );
    }
    assert.equal(
      new Set(samples.filter((s) => s.zoom === 2.5).map((s) => s.mask)).size,
      11,
    );
    await page.screenshot({ path: artifact("aircraft-original-artwork.png") });
  } finally {
    await context.close();
  }
}
