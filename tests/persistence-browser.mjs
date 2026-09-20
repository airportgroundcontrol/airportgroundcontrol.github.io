import { baseURL, browserChannel, artifact } from "./browser-support.mjs";
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import path from "node:path";
const browser = await chromium.launch({
  channel: browserChannel,
  headless: true,
});
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 960 },
  });
  const page = await context.newPage(),
    errors = [],
    key = "ground-control:save:EGPH";
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(baseURL);
  await page.waitForFunction(() => window.groundControl);
  await page.evaluate(() => {
    const s = groundControl.sim;
    groundControl.setPaused(true);
    s.nextArrival = s.nextDeparture = Infinity;
    s.command(1, "pushback");
    for (let i = 0; i < 500 && s.planes[0].state !== "ready"; i++) s.tick(0.1);
    s.command(1, "taxi");
    s.command(1, "holdshort", { holdPoint: s.holdOptions(s.planes[0])[0].id });
    s.command(4, "land");
    for (let i = 0; i < 30; i++) s.tick(0.1);
    s.score = 250;
    s.completed = 3;
    s.incidents = 2;
    s.conflictPairs.add("1:2");
  });
  await page.getByRole("button", { name: "Select BAW1439" }).click();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "8x", exact: true }).click();
  await page.getByRole("button", { name: "Departures", exact: true }).click();
  await page.getByRole("button", { name: "Toggle map labels" }).click();
  await page.getByRole("button", { name: "Toggle flight panel" }).click();
  await page.evaluate(() => {
    groundControl.map.camera = { x: 125, y: -240, zoom: 0.6 };
  });
  const snapshot = () =>
    page.evaluate(() => {
      const s = groundControl.sim;
      return {
        time: s.time,
        score: s.score,
        completed: s.completed,
        incidents: s.incidents,
        runway: s.runwayOwner,
        planes: s.planes,
        logs: s.logs,
        conflicts: [...s.conflictPairs],
        nextId: s.nextId,
        nextArrival: s.nextArrival,
        nextDeparture: s.nextDeparture,
        nextCleanup: s.nextCleanup,
        camera: groundControl.map.camera,
      };
    });
  const before = await snapshot();
  await page.reload();
  await page.waitForFunction(() => window.groundControl);
  assert.deepEqual(await snapshot(), before);
  assert.equal(
    await page.locator("#simulation-status").textContent(),
    "PAUSED",
  );
  assert.equal(
    await page.locator('[data-speed="8"]').getAttribute("class"),
    "active",
  );
  assert.equal(
    await page.locator('[data-filter="departure"]').getAttribute("class"),
    "active",
  );
  assert.equal(await page.locator("#traffic-panel").isVisible(), false);
  assert.equal(
    await page.locator("#labels").getAttribute("aria-pressed"),
    "false",
  );
  assert.equal(await page.locator("#aircraft-menu").isVisible(), false);

  // Periodic autosaves happen without any user events.
  await page.evaluate(() => {
    groundControl.sim.score = 345;
  });
  await page.waitForFunction(
    (key) => JSON.parse(localStorage.getItem(key)).simulation.score === 345,
    key,
  );
  await page.close();
  const reopened = await context.newPage();
  await reopened.goto(baseURL);
  await reopened.waitForFunction(() => window.groundControl);
  assert.equal(await reopened.evaluate(() => groundControl.sim.score), 345);
  assert.equal(
    await reopened.evaluate(() => groundControl.sim.time),
    before.time,
  );

  // A draft taxi route survives reload, including its pending waypoints.
  await reopened.evaluate(() => {
    groundControl.sim.command(1, "hold");
    groundControl.select(1);
    groundControl.preview();
  });
  await reopened.locator("#map").focus();
  await reopened.keyboard.press("t");
  const draft = await reopened.evaluate(() => groundControl.map.preview);
  await reopened.reload();
  await reopened.waitForFunction(() => window.groundControl);
  assert.deepEqual(
    await reopened.evaluate(() => groundControl.map.preview),
    draft,
  );
  assert.equal(await reopened.locator("#route-banner").isVisible(), true);

  // Dialog pause is temporary and must not replace the user's running preference.
  await reopened.keyboard.press("Escape");
  await reopened.evaluate(() => groundControl.setPaused(false));
  await reopened
    .getByRole("button", { name: "Keyboard shortcuts", exact: true })
    .click();
  assert.equal(
    await reopened.locator("#simulation-status").textContent(),
    "PAUSED",
  );
  await reopened.reload();
  await reopened.waitForFunction(() => window.groundControl);
  assert.equal(
    await reopened.locator("#simulation-status").textContent(),
    "RUNNING",
  );
  await reopened.evaluate(() => groundControl.setPaused(true));

  await reopened
    .getByRole("button", { name: "Restart simulation", exact: true })
    .click();
  await reopened.getByRole("button", { name: "Restart", exact: true }).click();
  await reopened.evaluate(() => groundControl.setPaused(true));
  await reopened.reload();
  await reopened.waitForFunction(() => window.groundControl);
  assert.equal(await reopened.evaluate(() => groundControl.sim.score), 0);
  assert.equal(
    await reopened.evaluate(() => groundControl.sim.planes.length),
    4,
  );
  assert.ok((await reopened.evaluate(() => groundControl.sim.time)) < 1);

  const brokenContext = await browser.newContext();
  await brokenContext.addInitScript((key) => {
    if (!sessionStorage.getItem("injected")) {
      localStorage.setItem(key, "{invalid");
      sessionStorage.setItem("injected", "yes");
    }
  }, key);
  const broken = await brokenContext.newPage();
  await broken.goto(baseURL);
  await broken.waitForFunction(() => window.groundControl);
  assert.equal(
    await broken.evaluate(
      (key) => localStorage.getItem(key + ":recovery"),
      key,
    ),
    "{invalid",
  );
  assert.ok(
    (await broken.locator("#toast").textContent()).includes(
      "Previous save preserved",
    ),
  );

  await broken.evaluate(() => {
    groundControl.session.dispatch(1, "pushback");
    groundControl.session.save();
  });
  assert.equal(
    await broken.evaluate((key) => localStorage.getItem(key), key),
    "{invalid",
  );
  await broken
    .getByRole("button", { name: "Restart simulation", exact: true })
    .click();
  await broken.locator("#confirm-restart").click();
  assert.equal(
    await broken.evaluate(
      (key) => JSON.parse(localStorage.getItem(key)).version,
      key,
    ),
    1,
  );

  const blockedContext = await browser.newContext();
  await blockedContext.addInitScript(() => {
    Storage.prototype.setItem = () => {
      throw new Error("QuotaExceededError");
    };
  });
  const blocked = await blockedContext.newPage();
  await blocked.goto(baseURL);
  await blocked.waitForFunction(() => window.groundControl);
  assert.ok(
    (await blocked.locator("#toast").textContent()).includes(
      "Saving unavailable",
    ),
  );
  await blocked.getByRole("button", { name: "Select BAW1439" }).click();
  await blocked.keyboard.press("p");
  assert.equal(
    await blocked.evaluate(() => groundControl.sim.planes[0].state),
    "pushback",
  );

  const offlineContext = await browser.newContext({ offline: true });
  const offline = await offlineContext.newPage();
  await offline.goto(pathToFileURL(path.resolve("Ground Control.html")).href);
  await offline.waitForFunction(() => window.groundControl);
  await offline.evaluate(() => {
    groundControl.sim.score = 777;
    groundControl.setPaused(true);
  });
  await offline.reload();
  await offline.waitForFunction(() => window.groundControl);
  assert.equal(await offline.evaluate(() => groundControl.sim.score), 777);
  assert.deepEqual(errors, []);
  console.log(
    "PASS: reload and tab-close restoration, full flight/runway state, periodic autosave, view preferences, draft route, temporary dialog pause, restart, corrupt/blocked storage, offline HTML persistence.",
  );
} finally {
  await browser.close();
}
