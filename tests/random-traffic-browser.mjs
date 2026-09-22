import { chromium } from "playwright";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { baseURL, browserChannel, artifact } from "./browser-support.mjs";

const browser = await chromium.launch({
  channel: browserChannel,
  headless: true,
});
const errors = [];
const savedSimulation = (page) =>
  page.evaluate(() => {
    groundControl.session.save();
    return JSON.parse(localStorage.getItem(groundControl.session.storage.key))
      .simulation;
  });
const clickAircraft = async (page, id) => {
  const point = await page.evaluate(
    (id) =>
      groundControl.map.aircraftScreen(
        groundControl.sim.planes.find((plane) => plane.id === id),
      ),
    id,
  );
  await page.mouse.click(point.x, point.y);
};
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 960 },
  });
  // Control only new-game entropy, not the production catalog or simulation code.
  await context.addInitScript(() => {
    const original = crypto.getRandomValues.bind(crypto);
    let count = 0;
    crypto.getRandomValues = (array) => {
      if (array instanceof Uint32Array && array.length === 1) {
        array[0] = [123456789, 987654321][count++ % 2];
        return array;
      }
      return original(array);
    };
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(baseURL);
  await page.waitForFunction(() => window.groundControl);
  await page.evaluate(() => groundControl.setPaused(true));
  const initial = await savedSimulation(page);
  assert.equal(initial.randomSeed, 123456789);
  assert.equal("logs" in initial, false);
  assert.ok(initial.planes.length >= 3 && initial.planes.length <= 6);
  assert.equal(await page.locator("#traffic-panel").count(), 0);
  assert.equal(
    new Set(initial.planes.map((p) => p.call)).size,
    initial.planes.length,
  );
  await page.screenshot({ path: artifact("random-traffic-desktop.png") });

  const departure = initial.planes.find((p) => p.state === "gate");
  await clickAircraft(page, departure.id);
  await page.keyboard.press("p");
  assert.equal(await page.locator("#aircraft-menu").isVisible(), false);
  assert.equal(
    await page.evaluate(
      (id) => groundControl.sim.planes.find((p) => p.id === id).state,
      departure.id,
    ),
    "pushback",
  );
  await page.evaluate(() => {
    for (let i = 0; i < 6400; i++) groundControl.sim.tick(0.05);
  });
  const running = await savedSimulation(page);
  assert.notEqual(running.randomState, initial.randomState);
  await page.reload();
  await page.waitForFunction(() => window.groundControl);
  assert.deepEqual(await savedSimulation(page), running);
  assert.equal(await page.evaluate(() => groundControl.session.paused), true);

  await page.locator("#restart").click();
  await page.locator("#confirm-restart").click();
  await page.evaluate(() => groundControl.setPaused(true));
  const restarted = await savedSimulation(page);
  assert.equal(restarted.randomSeed, 987654321);
  assert.notDeepEqual(
    restarted.planes.map((p) => [p.call, p.type, p.stand]),
    initial.planes.map((p) => [p.call, p.type, p.stand]),
  );
  assert.equal(restarted.score, 0);
  assert.ok(restarted.time < 2);
  await page.reload();
  await page.waitForFunction(() => window.groundControl);
  assert.deepEqual(await savedSimulation(page), restarted);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction(() => groundControl.map.width === innerWidth);
  await page.evaluate(() => {
    groundControl.map.fit();
    groundControl.map.draw();
  });
  const metrics = await page.evaluate(() => {
    const canvas = document.querySelector("canvas");
    const pixels = canvas
      .getContext("2d")
      .getImageData(0, 0, canvas.width, canvas.height).data;
    const colors = new Set();
    for (let i = 0; i < pixels.length; i += 64)
      colors.add(`${pixels[i]},${pixels[i + 1]},${pixels[i + 2]}`);
    return {
      colors: colors.size,
      overflow: document.documentElement.scrollWidth > innerWidth,
      canvasWidth: canvas.getBoundingClientRect().width,
      width: innerWidth,
    };
  });
  assert.ok(metrics.colors > 50);
  assert.equal(metrics.overflow, false);
  assert.equal(metrics.canvasWidth, metrics.width);
  await page.screenshot({ path: artifact("random-traffic-mobile.png") });
  const arrival = restarted.planes.find((p) => p.state === "approach");
  await page.evaluate((id) => groundControl.select(id), arrival.id);
  await page.keyboard.press("l");
  assert.equal(await page.locator("#aircraft-menu").isVisible(), false);
  assert.equal(
    await page.evaluate(
      (id) => groundControl.sim.planes.find((p) => p.id === id).state,
      arrival.id,
    ),
    "landing",
  );

  const offlineContext = await browser.newContext({ offline: true });
  const offline = await offlineContext.newPage();
  offline.on("pageerror", (error) => errors.push(error.message));
  const requests = [];
  offline.on("request", (request) => {
    if (/^https?:/.test(request.url())) requests.push(request.url());
  });
  await offline.goto(pathToFileURL(path.resolve("Ground Control.html")).href);
  await offline.waitForFunction(() => window.groundControl);
  await offline.evaluate(() => groundControl.setPaused(true));
  const offlineSaved = await savedSimulation(offline);
  assert.ok(offlineSaved.randomSeed > 0);
  await offline.reload();
  await offline.waitForFunction(() => window.groundControl);
  assert.deepEqual(await savedSimulation(offline), offlineSaved);

  // Reproduce an update meeting an incompatible save on the actual file:// build.
  const original = await offline.evaluate(() =>
    localStorage.getItem(groundControl.session.storage.key),
  );
  const incompatible = JSON.parse(original);
  incompatible.configurationRevision = "pre-randomization";
  delete incompatible.simulation.randomSeed;
  delete incompatible.simulation.randomState;
  const raw = JSON.stringify(incompatible);
  const installIncompatible = async () => {
    await offline.evaluate((raw) => {
      groundControl.session.disposed = true;
      localStorage.setItem(groundControl.session.storage.key, raw);
    }, raw);
    await offline.reload();
    await offline.waitForFunction(() => window.groundControl);
  };
  await installIncompatible();
  assert.equal(await offline.locator("#restart-dialog").isVisible(), true);
  assert.equal(await offline.locator("#cancel-restart").isVisible(), false);
  await offline.keyboard.press("Escape");
  assert.equal(await offline.locator("#restart-dialog").isVisible(), true);
  assert.deepEqual(
    await offline.evaluate(() => {
      groundControl.setPaused(false);
      groundControl.session.advance(0.1);
      return {
        time: groundControl.sim.time,
        paused: groundControl.session.paused,
        accepted: groundControl.session.dispatch(1, "pushback").ok,
      };
    }),
    { time: 0, paused: true, accepted: false },
  );
  await offline.screenshot({
    path: artifact("incompatible-save-reset-desktop.png"),
  });
  await offline.setViewportSize({ width: 390, height: 844 });
  await offline.screenshot({
    path: artifact("incompatible-save-reset-mobile.png"),
  });
  await offline.evaluate(() => {
    window.originalSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = () => {
      throw new Error("QuotaExceededError");
    };
  });
  await offline.locator("#confirm-restart").click();
  assert.equal(await offline.locator("#restart-dialog").isVisible(), true);
  assert.match(
    await offline.locator("#reset-message").textContent(),
    /Could not reset/,
  );
  assert.equal(
    await offline.evaluate(() => groundControl.session.awaitingRecovery),
    true,
  );
  await offline.evaluate(() => {
    Storage.prototype.setItem = window.originalSetItem;
  });
  await offline.locator("#confirm-restart").click();
  assert.equal(await offline.locator("#restart-dialog").isVisible(), false);
  await offline.evaluate(() => {
    groundControl.setPaused(true);
    groundControl.session.dispatch(1, "pushback");
    for (let i = 0; i < 300; i++) groundControl.sim.tick(0.05);
  });
  const recovered = await savedSimulation(offline);
  await offline.reload();
  await offline.waitForFunction(() => window.groundControl);
  assert.deepEqual(await savedSimulation(offline), recovered);
  assert.equal(await offline.locator("#restart-dialog").isVisible(), false);
  assert.deepEqual(requests, []);
  assert.deepEqual(errors, []);
  console.log(
    "PASS: production randomized starts/restarts, dynamic aircraft actions, exact seeded reload, responsive map and standalone offline persistence.",
  );
} finally {
  await browser.close();
}
