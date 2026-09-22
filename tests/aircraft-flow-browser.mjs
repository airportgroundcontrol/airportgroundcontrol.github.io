import { chromium } from "playwright";
import { useScriptedTraffic } from "./scripted-browser.mjs";
import assert from "node:assert/strict";
import { baseURL, browserChannel, artifact } from "./browser-support.mjs";

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
  await useScriptedTraffic(page.context());
  await page.goto(baseURL);
  await page.waitForFunction(() => window.groundControl);
  await page.evaluate(() => {
    groundControl.setPaused(true);
    groundControl.sim.nextArrival = groundControl.sim.nextDeparture = Infinity;
  });
  assert.ok(
    await page.evaluate(() => {
      const labels = [],
        badges = [];
      const original = groundControl.map.label.bind(groundControl.map);
      const originalBadge = groundControl.map.badge.bind(groundControl.map);
      groundControl.map.label = (text, x, y, color, size, background) => {
        labels.push({ text, x, size });
        return original(text, x, y, color, size, background);
      };
      groundControl.map.badge = (text, ...args) => {
        badges.push(text);
        return originalBadge(text, ...args);
      };
      groundControl.map.draw();
      groundControl.map.label = original;
      groundControl.map.badge = originalBadge;
      const label = labels.find(({ text }) =>
        text.startsWith("KLM927 / A333 / ETA "),
      );
      const runwayBadge = `RWY ${
        groundControl.sim.runwayFor(groundControl.sim.planes[3]).label
      }`;
      if (
        !label ||
        !/ETA \d+:\d{2}$/.test(label.text) ||
        !badges.includes(runwayBadge)
      )
        return false;
      groundControl.map.ctx.font = `${label.size}px ui-monospace, monospace`;
      const width = groundControl.map.ctx.measureText(label.text).width + 10;
      return (
        label.x - width / 2 >= 5.5 &&
        label.x + width / 2 <= groundControl.map.width - 5.5
      );
    }),
  );
  const before = await page.evaluate(() => ({
    ...groundControl.sim.planes[3],
  }));
  await page.evaluate(() => {
    for (let i = 0; i < 200; i++) groundControl.sim.tick(0.05);
  });
  const eta = await page.evaluate(() =>
    Math.ceil(groundControl.sim.arrivalETA(groundControl.sim.planes[3])),
  );
  assert.ok(eta > 0);
  const after = await page.evaluate(() => ({ ...groundControl.sim.planes[3] }));
  assert.ok(Math.hypot(after.x - before.x, after.y - before.y) > 600);
  const marker = await page.evaluate(() =>
    groundControl.map.aircraftScreen(groundControl.sim.planes[3]),
  );
  assert.equal(marker.offscreen, true);
  await page.mouse.click(marker.x, marker.y);
  assert.equal(await page.locator("#aircraft-menu").isVisible(), true);
  assert.deepEqual(
    await page
      .locator("#exit-select option")
      .evaluateAll((els) => els.map((e) => e.value)),
    ["runway-end-A"],
  );
  await page.keyboard.press("Escape");
  await page.screenshot({ path: artifact("moving-arrivals-desktop.png") });

  // The directional picker uses the same dispatch path as shortcuts/default pushback.
  await page.evaluate(() => groundControl.select(2));
  await page.keyboard.press("r");
  await page
    .getByLabel("Pushback direction", { exact: true })
    .selectOption("nose-east");
  await page.screenshot({ path: artifact("pushback-direction-desktop.png") });
  await page.locator("#aircraft-menu").focus();
  await page.keyboard.press("Enter");
  assert.equal(await page.locator("#aircraft-menu").isVisible(), false);
  assert.equal(
    await page.evaluate(() => groundControl.sim.planes[1].pushbackOption),
    "nose-east",
  );

  await page.evaluate(() => {
    const { sim, map } = groundControl,
      p = sim.planes[3];
    while (sim.arrivalETA(p) > 20) sim.tick(0.05);
    map.camera = { x: p.x, y: p.y, zoom: 0.5 };
    map.draw();
    groundControl.session.save();
  });
  const snapshot = await page.evaluate(() =>
    JSON.stringify(groundControl.sim.planes),
  );
  await page.reload();
  await page.waitForFunction(() => window.groundControl);
  assert.equal(
    await page.evaluate(() => JSON.stringify(groundControl.sim.planes)),
    snapshot,
  );
  await page.screenshot({ path: artifact("moving-final-approach.png") });
  await page.evaluate(() => {
    for (let i = 0; i < 260; i++) groundControl.sim.tick(0.05);
  });
  await page.waitForFunction(
    () => groundControl.sim.planes[3].state === "goaround",
  );
  assert.equal(
    await page.evaluate(() => groundControl.sim.planes[3].state),
    "goaround",
  );
  assert.equal(await page.evaluate(() => groundControl.sim.score), -25);
  await page.evaluate(() => groundControl.session.save());
  await page.reload();
  await page.waitForFunction(
    () => window.groundControl?.sim.planes[3].state === "goaround",
  );
  assert.equal(await page.evaluate(() => groundControl.sim.score), -25);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction(() => groundControl.map.width === innerWidth);
  await page.evaluate(() => {
    const { sim, map } = groundControl;
    sim.spawnArrival("NEW101", "AT72");
    map.fit();
  });
  const mobileLabelCheck = await page.evaluate(() => {
    const labels = [];
    const original = groundControl.map.label.bind(groundControl.map);
    const arrival = groundControl.sim.planes.at(-1);
    groundControl.map.camera = {
      x: arrival.x - 100000,
      y: arrival.y,
      zoom: 0.5,
    };
    groundControl.map.label = (text, x, y, color, size, background) => {
      labels.push({ text, x, size });
      return original(text, x, y, color, size, background);
    };
    groundControl.map.draw();
    groundControl.map.label = original;
    const etaLabels = labels.filter(({ text }) => /ETA \d+:\d{2}$/.test(text));
    const measured = etaLabels.map((label) => {
        groundControl.map.ctx.font = `${label.size}px ui-monospace, monospace`;
        const width = groundControl.map.ctx.measureText(label.text).width + 10;
        return { ...label, width };
      }),
      contained =
        measured.length > 0 &&
        measured.every(
          (label) =>
            label.x - label.width / 2 >= 5.5 &&
            label.x + label.width / 2 <= groundControl.map.width - 5.5,
        );
    groundControl.map.fit();
    return {
      contained,
      measured,
      mapWidth: groundControl.map.width,
    };
  });
  assert.ok(mobileLabelCheck.contained, JSON.stringify(mobileLabelCheck));
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await page.screenshot({ path: artifact("moving-arrivals-mobile.png") });
  await page.evaluate(() =>
    groundControl.select(groundControl.sim.planes.at(-1).id),
  );
  await page.locator("#exit-select").selectOption("midfield");
  await page.locator("#aircraft-menu").focus();
  await page.keyboard.press("l");
  assert.equal(await page.locator("#aircraft-menu").isVisible(), false);
  assert.equal(
    await page.evaluate(() => groundControl.sim.planes.at(-1).exitLabel),
    "midfield",
  );

  const rollingContext = await browser.newContext();
  await useScriptedTraffic(rollingContext);
  const rollingPage = await rollingContext.newPage();
  await rollingPage.goto(baseURL);
  await rollingPage.waitForFunction(() => window.groundControl);
  await rollingPage.evaluate(() => {
    const { sim, session } = groundControl;
    groundControl.setPaused(true);
    sim.nextArrival = sim.nextDeparture = Infinity;
    session.dispatch(4, "land");
    session.dispatch(1, "pushback");
    while (sim.planes[0].state !== "ready") sim.tick(0.05);
    session.dispatch(1, "taxi");
    while (sim.planes[0].state !== "holding") sim.tick(0.05);
  });
  await rollingPage.waitForFunction(() =>
    document
      .getElementById("runway-status")
      .textContent.includes("KLM927 next"),
  );
  await rollingPage.evaluate(() => groundControl.select(1));
  assert.equal(
    await rollingPage
      .getByRole("menuitem", { name: /Rolling departure/ })
      .count(),
    1,
  );
  await rollingPage.keyboard.press("o");
  assert.deepEqual(
    await rollingPage.evaluate(() => ({
      state: groundControl.sim.planes[0].state,
      rolling: groundControl.sim.planes[0].rollingDeparture,
      menu: document.getElementById("aircraft-menu").hidden,
    })),
    { state: "lineup", rolling: true, menu: true },
  );
  await rollingPage.evaluate(() => groundControl.session.save());
  await rollingPage.reload();
  await rollingPage.waitForFunction(
    () => window.groundControl?.sim.planes[0].rollingDeparture,
  );
  assert.equal(
    await rollingPage.evaluate(() => {
      const { sim } = groundControl,
        departure = sim.planes[0];
      let stoppedOnRunway = false;
      while (departure.state !== "takeoff" && departure.state !== "done") {
        sim.tick(0.05);
        if (departure.state === "linedup") stoppedOnRunway = true;
      }
      return stoppedOnRunway;
    }),
    false,
  );
  await rollingContext.close();
  assert.deepEqual(errors, []);
  console.log(
    "PASS: moving approaches, anticipated runway slots, rolling-departure shortcut/reload, live ETA, directional pushback, exit choice and automatic go-around penalties.",
  );
} finally {
  await browser.close();
}
