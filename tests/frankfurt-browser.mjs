import { chromium } from "playwright";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { baseURL, browserChannel, artifact } from "./browser-support.mjs";

const browser = await chromium.launch({
  channel: browserChannel,
  headless: true,
});

try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 960 },
  });
  const page = await context.newPage(),
    errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    window.canvasLabels = new Set();
    const fillText = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function (value, ...args) {
      window.canvasLabels.add(String(value));
      return fillText.call(this, value, ...args);
    };
  });
  await page.goto(baseURL + "?airport=EDDF");
  await page.waitForFunction(
    () => window.groundControl?.sim.data.id === "EDDF",
  );
  await page.evaluate(() => groundControl.setPaused(true));

  assert.equal(await page.title(), "Ground Control | Frankfurt Airport");
  assert.equal(await page.locator(".icao").textContent(), "EDDF");
  assert.equal(
    await page.locator(".runway-symbol").textContent(),
    "25C / 25R / 25L / 18",
  );
  assert.deepEqual(
    await page.evaluate(() => ({
      physicalRunways: groundControl.sim.data.operations.runways.length,
      stands: groundControl.sim.data.stands.length,
      active: groundControl.sim.activeRunways.map((runway) => ({
        key: runway.key,
        arrivals: runway.arrivals,
        departures: runway.departures,
      })),
    })),
    {
      physicalRunways: 4,
      stands: 53,
      active: [
        { key: "07C-25C:25C", arrivals: false, departures: true },
        { key: "07L-25R:25R", arrivals: true, departures: false },
        { key: "07R-25L:25L", arrivals: true, departures: false },
        { key: "18-36:18", arrivals: false, departures: true },
      ],
    },
  );
  assert.ok(
    await page.evaluate(() =>
      groundControl.sim.planes.every((aircraft) => {
        const runway = groundControl.sim.activeRunways.find(
          (candidate) => candidate.key === aircraft.runwayKey,
        );
        return (
          runway &&
          (aircraft.direction === "arrival"
            ? runway.arrivals
            : runway.departures)
        );
      }),
    ),
  );

  await page.locator("#runway-badge").click();
  await page.getByRole("button", { name: "East flow", exact: true }).click();
  await page.locator("#apply-runways").click();
  await page.waitForFunction(
    () =>
      groundControl.sim.activeRunways.some(
        (runway) => runway.key === "07L-25R:07L" && runway.arrivals,
      ) &&
      groundControl.sim.activeRunways.some(
        (runway) => runway.key === "07C-25C:07C" && runway.departures,
      ),
  );
  assert.deepEqual(
    await page.evaluate(() => ({
      preset: groundControl.sim.runwayPresetId,
      active: groundControl.sim.activeRunways.map((runway) => runway.label),
    })),
    { preset: "east-flow", active: ["07C", "07L", "07R", "18"] },
  );
  assert.ok(
    await page.evaluate(() =>
      ["07L", "25R", "07C", "25C", "07R", "25L", "18", "36"].every((label) =>
        canvasLabels.has(label),
      ),
    ),
  );
  assert.ok(
    await page.evaluate(() => {
      const arrivals = groundControl.sim.planes.filter(
        (aircraft) => aircraft.direction === "arrival",
      );
      return (
        arrivals.length > 0 &&
        arrivals.every(
          (aircraft) => groundControl.sim.arrivalETA(aircraft) >= 480,
        )
      );
    }),
  );

  const arrivalId = await page.evaluate(() => {
    groundControl.sim.spawnArrival("TST900", "A320");
    return groundControl.sim.planes.at(-1).id;
  });
  await page.evaluate((id) => groundControl.select(id), arrivalId);
  assert.deepEqual(
    await page.locator("#runway-select option").allTextContents(),
    ["Runway 07L", "Runway 07R"],
  );
  await page.locator("#runway-select").selectOption("07R-25L:07R");
  assert.match(
    await page.getByRole("menuitem", { name: /Clear to land/ }).textContent(),
    /07R/,
  );
  await page.keyboard.press("Escape");

  const departureId = await page.evaluate(() => {
    for (const aircraft of groundControl.sim.planes.filter(
      (candidate) => candidate.state === "gate",
    )) {
      if (!groundControl.sim.command(aircraft.id, "pushback").ok) continue;
      for (let i = 0; i < 2400 && aircraft.state !== "ready"; i++)
        groundControl.sim.tick(0.25);
      if (aircraft.state === "ready") return aircraft.id;
    }
    return null;
  });
  assert.ok(departureId);
  await page.evaluate((id) => groundControl.select(id), departureId);
  assert.deepEqual(
    await page.locator("#runway-select option").allTextContents(),
    ["Runway 07C / M34", "Runway 18 / N"],
  );
  await page.locator("#runway-select").selectOption("18-36:18");
  await page.getByRole("menuitem", { name: "Plan taxi route" }).click();
  assert.match(await page.locator("#route-text").textContent(), /18/);
  await page.keyboard.press("Escape");

  for (const viewport of [
    { width: 1440, height: 960 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await page.waitForFunction(() => groundControl.map.width === innerWidth);
    await page.evaluate(() => {
      groundControl.map.fit();
      groundControl.map.draw();
    });
    const metrics = await page.evaluate(() => {
      const { map, sim } = groundControl,
        pixels = map.ctx.getImageData(
          0,
          0,
          map.canvas.width,
          map.canvas.height,
        ).data,
        colors = new Set();
      for (let i = 0; i < pixels.length; i += 128)
        colors.add(`${pixels[i]},${pixels[i + 1]},${pixels[i + 2]}`);
      return {
        colors: colors.size,
        overflow: document.documentElement.scrollWidth > innerWidth,
        aircraft: sim.planes.map((item) => ({
          ...map.aircraftScreen(item),
          airborne: item.airborne,
        })),
        width: map.width,
        height: map.height,
      };
    });
    assert.ok(metrics.colors > 50);
    assert.equal(metrics.overflow, false);
    for (const aircraft of metrics.aircraft.filter((item) => !item.airborne))
      assert.ok(
        aircraft.x > 0 &&
          aircraft.x < metrics.width &&
          aircraft.y > 0 &&
          aircraft.y < metrics.height,
      );
    assert.ok(metrics.aircraft.some((item) => !item.airborne));
    await page.screenshot({
      path: artifact(`frankfurt-${viewport.width}.png`),
    });
  }

  await page.evaluate(() => {
    groundControl.sim.score = 2468;
    groundControl.session.save();
  });
  await page.reload();
  await page.waitForFunction(
    () =>
      window.groundControl?.sim.data.id === "EDDF" &&
      groundControl.sim.score === 2468 &&
      groundControl.sim.runwayPresetId === "east-flow",
  );

  const offlineContext = await browser.newContext({ offline: true });
  const offline = await offlineContext.newPage();
  const requests = [];
  offline.on("request", (request) => {
    if (/^https?:/.test(request.url())) requests.push(request.url());
  });
  const file = pathToFileURL(path.resolve("Ground Control.html"));
  file.searchParams.set("airport", "EDDF");
  await offline.goto(file.href);
  await offline.waitForFunction(
    () => window.groundControl?.sim.data.id === "EDDF",
  );
  assert.equal(
    await offline.locator(".airport-name").textContent(),
    "Frankfurt Airport",
  );
  assert.deepEqual(requests, []);
  assert.deepEqual(errors, []);
  await offlineContext.close();
  await context.close();
  console.log(
    "PASS: production Frankfurt catalog package, four-runway map, live runway planner, responsive framing, configuration persistence and standalone offline selection.",
  );
} finally {
  await browser.close();
}
