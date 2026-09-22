import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";
import { baseURL, browserChannel, artifact } from "./browser-support.mjs";

// Replace only the catalog in a test bundle; exercise the real UI/engine/renderer.
const result = await build({
  entryPoints: ["src/app.js"],
  bundle: true,
  write: false,
  format: "iife",
  plugins: [
    {
      name: "test-airports",
      setup(build) {
        build.onResolve({ filter: /\/airports\/catalog\.js$/ }, () => ({
          path: path.resolve("tests/fixtures/synthetic-catalog.js"),
        }));
      },
    },
  ],
});
const javascript = result.outputFiles[0].text;
const browser = await chromium.launch({
  channel: browserChannel,
  headless: true,
});
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 960 },
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    window.canvasLabels = new Set();
    const draw = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function (text, ...args) {
      window.canvasLabels.add(String(text));
      return draw.call(this, text, ...args);
    };
  });
  await page.route("**/app.js", (route) =>
    route.fulfill({ contentType: "text/javascript", body: javascript }),
  );
  await page.goto(baseURL);
  await page.waitForFunction(() => window.groundControl);
  await page.evaluate(() => groundControl.setPaused(true));
  assert.equal(await page.title(), "Ground Control | North Field");
  assert.equal(await page.locator(".runway-symbol").textContent(), "17");
  assert.equal(await page.locator("#clock").textContent(), "10:00:00");
  assert.ok(!/Edinburgh|EGPH|D1/.test(await page.locator("body").innerText()));
  assert.ok(
    await page.evaluate(
      () =>
        canvasLabels.has("17") &&
        canvasLabels.has("35") &&
        canvasLabels.has("H9") &&
        !canvasLabels.has("24"),
    ),
  );
  await page.evaluate(() => groundControl.select(1));
  await page.keyboard.press("p");
  assert.ok(await page.locator("#aircraft-menu").isHidden());
  assert.equal(
    await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem("ground-control:save:TEST")).simulation
          .planes[0].state,
    ),
    "pushback",
  );
  await page.evaluate(() => {
    groundControl.sim.score = 777;
    groundControl.setPaused(true);
  });
  for (const viewport of [
    { width: 1440, height: 960 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await page.getByRole("button", { name: "Fit airport" }).click();
    const camera = await page.evaluate(() => {
      const { map, sim } = groundControl;
      map.draw();
      const pixels = map.ctx.getImageData(
        0,
        0,
        map.canvas.width,
        map.canvas.height,
      ).data;
      const colors = new Set();
      for (let i = 0; i < pixels.length; i += 400)
        colors.add(`${pixels[i]},${pixels[i + 1]},${pixels[i + 2]}`);
      return {
        points: sim.planes.map((p) => map.aircraftScreen(p)),
        width: map.width,
        height: map.height,
        colors: colors.size,
      };
    });
    assert.ok(camera.colors > 10);
    for (const p of camera.points)
      assert.ok(
        p.x > 0 && p.x < camera.width && p.y > 0 && p.y < camera.height,
      );
    await page.screenshot({
      path: artifact("synthetic-airport-" + viewport.width + ".png"),
    });
  }
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.locator("#airport-button").click();
  await page.getByRole("button", { name: /South Field/ }).click();
  await page.waitForURL("**?airport=TEST2");
  await page.waitForFunction(
    () => window.groundControl?.session.airport.id === "TEST2",
  );
  await page.evaluate(() => groundControl.setPaused(true));
  assert.equal(await page.evaluate(() => groundControl.sim.score), 0);
  await page.locator("#airport-button").click();
  await page.getByRole("button", { name: /North Field/ }).click();
  await page.waitForURL("**?airport=TEST");
  await page.waitForFunction(
    () => window.groundControl?.session.airport.id === "TEST",
  );
  assert.equal(await page.evaluate(() => groundControl.sim.score), 777);
  assert.equal(
    await page.evaluate(() => groundControl.sim.planes[0].state),
    "pushback",
  );

  const html = fs
    .readFileSync("web/index.html", "utf8")
    .replace(
      '<link rel="stylesheet" href="style.css">',
      () => `<style>${fs.readFileSync("web/style.css", "utf8")}</style>`,
    )
    .replace(
      '<script type="module" src="app.js"></script>',
      () =>
        `<script>${javascript.replaceAll("</script", "<\\/script")}</script>`,
    );
  const filename = artifact("synthetic-offline.html");
  fs.writeFileSync(filename, html);
  const offline = await browser.newPage();
  await offline.context().setOffline(true);
  await offline.goto(pathToFileURL(filename).href);
  await offline.waitForFunction(() => window.groundControl);
  assert.equal(await offline.evaluate(() => groundControl.sim.data.id), "TEST");
  assert.deepEqual(errors, []);
  console.log(
    "PASS: shared UI/renderer on synthetic airport, dynamic runway/stand labels, session commands, desktop/mobile framing, per-airport save switching and offline catalog.",
  );
} finally {
  await browser.close();
}
