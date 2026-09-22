import { chromium } from "playwright";
import { useScriptedTraffic } from "./scripted-browser.mjs";
import assert from "node:assert/strict";
import { baseURL, browserChannel, artifact } from "./browser-support.mjs";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { verifyAircraftArt } from "./aircraft-art.mjs";

const browser = await chromium.launch({
  channel: browserChannel,
  headless: true,
});
try {
  await verifyAircraftArt(browser);
  const context = await browser.newContext({
    viewport: { width: 1440, height: 960 },
  });
  const page = await context.newPage(),
    errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await useScriptedTraffic(page.context());
  await page.goto(baseURL);
  await page.waitForFunction(() => window.groundControl);
  await page.evaluate(() => {
    groundControl.setPaused(true);
    groundControl.sim.nextArrival = groundControl.sim.nextDeparture = Infinity;
  });
  assert.equal(await page.locator("#traffic-panel").count(), 0);
  await page.evaluate(() => groundControl.select(4));
  await page.keyboard.press("l");
  await page.evaluate(() => {
    const s = groundControl.sim,
      p = s.planes.find((p) => p.id === 4);
    for (let i = 0; i < 10000 && p.state !== "inbound"; i++) s.tick(0.1);
    if (p.state !== "inbound") throw new Error("Arrival did not vacate");
  });
  await page.evaluate(() => groundControl.select(4));
  assert.equal(
    await page.locator('#stand-select option[value="14"]').isDisabled(),
    true,
  );
  assert.match(
    await page.locator('#stand-select option[value="14"]').innerText(),
    /Too small/,
  );
  assert.equal(
    await page.locator('#stand-select option[value="1"]').isDisabled(),
    false,
  );
  await page.getByLabel("DESTINATION STAND").selectOption("1");
  await page.locator("#map").focus();
  await page.keyboard.press("t");
  await page.keyboard.press("Enter");
  assert.equal(await page.locator("#aircraft-menu").isVisible(), false);
  await page.screenshot({ path: artifact("aircraft-widebody-stand.png") });

  // The same browser profile must never create a competing save writer.
  const second = await context.newPage();
  await second.goto(baseURL);
  await second
    .getByText("This airport is open in another tab.", { exact: false })
    .waitFor();
  assert.equal(await second.evaluate(() => !!window.groundControl), false);
  await second.close();

  await page.evaluate(() => {
    groundControl.sim.score = 4321;
    groundControl.session.save();
  });
  await page.reload();
  await page.waitForFunction(() => window.groundControl?.sim.score === 4321);

  // Exercise every render asset on a controlled view of the actual map.
  await page.evaluate(() => {
    const { sim, map } = groundControl;
    sim.planes = [];
    for (const [i, type] of [
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
    ].entries()) {
      sim.planes.push({
        id: i + 101,
        call: "TEST" + (i + 1),
        type,
        state: "ready",
        direction: "departure",
        x: (i % 6) * 140 - 350,
        y: Math.floor(i / 6) * 150 - 75,
        angle: -Math.PI / 2,
        route: [],
        stand: null,
        node: null,
        speed: 0,
        wait: 0,
        held: false,
        blocked: false,
      });
    }
    map.camera = { x: 0, y: 0, zoom: 0.8 };
    map.selected = null;
    const labels = [];
    const label = map.label.bind(map);
    map.label = (text, ...args) => {
      labels.push(text);
      return label(text, ...args);
    };
    map.draw();
    map.label = label;
    window.aircraftMapLabels = labels;
  });
  assert.ok(
    await page.evaluate(() =>
      groundControl.sim.planes.every((plane) =>
        window.aircraftMapLabels.includes(`${plane.call} / ${plane.type}`),
      ),
    ),
  );
  const pixelChecks = await page.evaluate(() => {
    const { sim, map } = groundControl,
      canvas = document.getElementById("map"),
      ctx = canvas.getContext("2d");
    const ratio = canvas.width / map.width;
    return sim.planes.map((p) => {
      const point = map.screen(p),
        pixels = ctx.getImageData(
          Math.round((point.x - 35) * ratio),
          Math.round((point.y - 40) * ratio),
          Math.round(70 * ratio),
          Math.round(80 * ratio),
        ).data;
      const colors = new Set();
      for (let i = 0; i < pixels.length; i += 4)
        colors.add(`${pixels[i]},${pixels[i + 1]},${pixels[i + 2]}`);
      return colors.size;
    });
  });
  assert.ok(pixelChecks.every((count) => count > 8));
  await page.screenshot({
    path: artifact("aircraft-eleven-types-desktop.png"),
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction(() => groundControl.map.width === innerWidth);
  const mobilePoint = await page.evaluate(() => {
    const { sim, map } = groundControl;
    sim.planes.forEach((p, i) => {
      p.x = (i % 3) * 160 - 160;
      p.y = Math.floor(i / 3) * 150 - 225;
    });
    map.camera = { x: 0, y: 0, zoom: 0.55 };
    map.draw();
    return map.aircraftScreen(sim.planes[2]);
  });
  await page.screenshot({ path: artifact("aircraft-eleven-types-mobile.png") });
  await page.mouse.click(mobilePoint.x, mobilePoint.y);
  assert.equal(await page.locator("#aircraft-menu").isVisible(), true);
  await page.keyboard.press("Escape");
  await page.evaluate(() => {
    groundControl.map.fit();
    groundControl.map.draw();
  });
  assert.equal(
    await page.getByRole("button", { name: "Delete saved game" }).isVisible(),
    true,
  );
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await page.screenshot({ path: artifact("aircraft-controls-mobile.png") });
  assert.deepEqual(errors, []);
  await context.close();

  const offline = await browser.newContext({ offline: true });
  const tab = await offline.newPage();
  await tab.goto(pathToFileURL(path.resolve("Ground Control.html")).href);
  await tab.waitForFunction(() => window.groundControl);
  assert.ok(
    await tab.evaluate(() =>
      groundControl.sim.planes.every((p) =>
        [
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
        ].includes(p.type),
      ),
    ),
  );
  await offline.close();
  console.log(
    "PASS: mixed-fleet rendering, stand restrictions, automatic reload persistence, single-writer lock, responsive UI and offline aircraft.",
  );
} finally {
  await browser.close();
}
