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
  const page = await browser.newPage({
    viewport: { width: 1440, height: 960 },
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(() => {
    document.modelContext = {
      registerTool(tool) {
        (window.registeredTools ??= {})[tool.name] = tool;
      },
    };
  });
  await page.goto(baseURL);
  await page.waitForFunction(() => window.groundControl);
  await page.evaluate(() => {
    groundControl.setPaused(true);
    groundControl.sim.nextArrival = Infinity;
    groundControl.sim.nextDeparture = Infinity;
  });
  const state = (id) =>
    page.evaluate(
      (id) => groundControl.sim.planes.find((p) => p.id === id)?.state,
      id,
    );
  const advance = async (id, target) => {
    const actual = await page.evaluate(
      ({ id, target }) => {
        const s = groundControl.sim;
        for (
          let i = 0;
          i < 8000 && s.planes.find((p) => p.id === id).state !== target;
          i++
        )
          s.tick(0.1);
        return s.planes.find((p) => p.id === id).state;
      },
      { id, target },
    );
    assert.equal(actual, target);
  };
  const clickAircraft = async (id, button = "left") => {
    const point = await page.evaluate(
      (id) =>
        groundControl.map.screen(
          groundControl.sim.planes.find((p) => p.id === id),
        ),
      id,
    );
    await page.mouse.click(point.x, point.y, { button });
    await page.waitForFunction(
      (id) =>
        !document.getElementById("aircraft-menu").hidden &&
        document
          .querySelector('#aircraft-menu [role="menu"]')
          ?.getAttribute("aria-label") ===
          "Clearances for " +
            groundControl.sim.planes.find((p) => p.id === id)?.call,
      id,
    );
  };
  const menuAction = (label) => page.getByRole("menuitem", { name: label });
  const settled = () =>
    page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );

  assert.equal(await page.locator("#aircraft-menu").isVisible(), false);
  await clickAircraft(1);
  assert.equal(await menuAction("Approve pushback").count(), 1);
  assert.equal(await menuAction("Cleared for takeoff").count(), 0);
  await page.screenshot({ path: artifact("dark-context-desktop.png") });
  await page.keyboard.press("p");
  assert.equal(await state(1), "pushback");
  assert.equal(await page.locator("#aircraft-menu").isVisible(), false);
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll("#strips .strip")].at(-1)?.dataset
        .flight === "1",
  );
  await page.keyboard.press("h");
  assert.equal(
    await page.evaluate(() => groundControl.sim.planes[0].held),
    true,
  );
  await page.keyboard.press("h");
  assert.equal(
    await page.evaluate(() => groundControl.sim.planes[0].held),
    false,
  );
  await advance(1, "ready");
  await page.keyboard.press("t");
  await page.waitForFunction(() => groundControl.map.preview.length > 10);
  await page.keyboard.press("Escape");
  assert.equal(await page.locator("#aircraft-menu").isVisible(), false);
  assert.equal(await page.evaluate(() => groundControl.map.preview.length), 0);
  await page.keyboard.press("t");
  assert.equal(await page.locator("#aircraft-menu").isVisible(), false);
  assert.equal(await page.locator("#route-banner").isVisible(), true);
  await page.screenshot({ path: artifact("dark-taxi-preview.png") });
  await page.keyboard.press("Enter");
  assert.equal(await state(1), "taxi");
  await advance(1, "holding");
  await page.keyboard.press("u");
  await advance(1, "linedup");
  await page.getByRole("button", { name: "Select KLM927" }).click();
  assert.equal(await menuAction("Clear to land").isDisabled(), true);
  await page.keyboard.press("l");
  assert.equal(await state(4), "approach");
  assert.equal(
    await page.locator("#aircraft-menu").isVisible(),
    true,
    "Rejected commands keep the menu open",
  );
  await page.keyboard.press("g");
  assert.equal(
    await page.evaluate(
      () => groundControl.sim.planes.find((p) => p.id === 4).wait,
    ),
    0,
  );
  await page.getByRole("button", { name: "Select BAW1439" }).click();
  await page.keyboard.press("d");
  await advance(1, "done");
  await page.getByRole("button", { name: "Select KLM927" }).click();
  await page.keyboard.press("l");
  assert.equal(await page.locator("#aircraft-menu").isVisible(), false);
  await advance(4, "inbound");
  await page.getByRole("button", { name: "Select KLM927" }).click();
  await page.getByLabel("DESTINATION STAND").selectOption("5");
  await page.getByLabel("DESTINATION STAND").focus();
  const radioBeforeTyping = await page.evaluate(() =>
    JSON.stringify(groundControl.sim.logs),
  );
  await page.keyboard.press("l");
  assert.equal(
    await state(4),
    "inbound",
    "Shortcuts must not fire while a form field is focused",
  );
  assert.equal(
    await page.evaluate(() => JSON.stringify(groundControl.sim.logs)),
    radioBeforeTyping,
  );
  assert.equal(
    await page.evaluate(() => document.activeElement.id),
    "stand-select",
  );
  await page.locator("#map").focus();
  await page.keyboard.press("t");
  assert.equal(await page.locator("#aircraft-menu").isVisible(), false);
  await page.getByRole("button", { name: "Select KLM927" }).click();
  await menuAction("Issue taxi clearance").click();
  assert.equal(await page.locator("#aircraft-menu").isVisible(), false);
  await advance(4, "parked");
  assert.equal(await page.evaluate(() => groundControl.sim.completed), 2);

  await page.keyboard.press("Escape");
  await page.locator("#map").focus();
  await page.keyboard.press("n");
  assert.equal(await page.locator("#aircraft-menu").isVisible(), true);
  await page.keyboard.press("Escape");
  await page
    .getByRole("button", { name: "Keyboard shortcuts", exact: true })
    .click();
  assert.equal(await page.locator("#shortcuts-dialog").isVisible(), true);
  const beforeHelp = await state(2);
  await page.keyboard.press("p");
  assert.equal(await state(2), beforeHelp);
  await page.getByRole("button", { name: "Close keyboard shortcuts" }).click();
  await settled();
  await page.locator("#map").focus();
  await page.keyboard.press("Space");
  assert.equal(
    await page.locator("#simulation-status").textContent(),
    "RUNNING",
  );
  await page.keyboard.press("Space");
  assert.equal(
    await page.locator("#simulation-status").textContent(),
    "PAUSED",
  );
  const beforeZoom = await page.evaluate(() => groundControl.map.camera.zoom);
  await page.getByRole("button", { name: "Zoom in", exact: true }).click();
  assert.ok(
    (await page.evaluate(() => groundControl.map.camera.zoom)) > beforeZoom,
  );
  await page.getByRole("button", { name: "Toggle flight panel" }).click();
  assert.equal(await page.locator("#traffic-panel").isVisible(), false);
  await page.getByRole("button", { name: "Toggle flight panel" }).click();
  await page.getByRole("button", { name: "EGPH Edinburgh" }).click();
  assert.equal(await page.locator("#airport-dialog").isVisible(), true);
  await page.getByRole("button", { name: "Close airport catalog" }).click();
  assert.deepEqual(await page.evaluate(() => Object.keys(registeredTools)), [
    "read_ground_control",
    "issue_ground_clearance",
  ]);
  assert.equal(
    await page.evaluate(
      () => registeredTools.read_ground_control.execute({}).completed,
    ),
    2,
  );
  assert.equal(
    await page.evaluate(
      () =>
        registeredTools.issue_ground_clearance.execute({
          flightId: 2,
          action: "pushback",
        }).ok,
    ),
    true,
  );
  assert.equal(
    await page.evaluate(() => {
      try {
        registeredTools.issue_ground_clearance.execute({
          flightId: "bad",
          action: "taxi",
        });
        return false;
      } catch {
        return true;
      }
    }),
    true,
  );
  await page
    .getByRole("button", { name: "Restart simulation", exact: true })
    .click();
  await page.getByRole("button", { name: "Restart", exact: true }).click();
  await page.evaluate(() => groundControl.setPaused(true));

  for (const viewport of [
    { width: 1440, height: 960 },
    { width: 1280, height: 800 },
    { width: 768, height: 1024 },
    { width: 390, height: 844 },
    { width: 360, height: 740 },
  ]) {
    await page.setViewportSize(viewport);
    await page.getByRole("button", { name: "Fit airport" }).click();
    await settled();
    await page.screenshot({
      path: artifact("dark-overview-" + viewport.width + ".png"),
    });
    const metrics = await page.evaluate(() => {
      const canvas = document.querySelector("canvas"),
        r = canvas.getBoundingClientRect();
      const data = canvas
        .getContext("2d")
        .getImageData(0, 0, canvas.width, canvas.height).data;
      const colors = new Set();
      for (let i = 0; i < data.length; i += 400)
        colors.add(data[i] + "," + data[i + 1] + "," + data[i + 2]);
      return {
        width: innerWidth,
        height: innerHeight,
        scroll: document.documentElement.scrollWidth,
        canvas: { x: r.x, y: r.y, width: r.width, height: r.height },
        colors: colors.size,
        scheme: getComputedStyle(document.documentElement).colorScheme,
      };
    });
    assert.equal(metrics.scroll, metrics.width);
    assert.deepEqual(metrics.canvas, {
      x: 0,
      y: 0,
      width: metrics.width,
      height: metrics.height,
    });
    assert.equal(metrics.scheme, "dark");
    assert.ok(metrics.colors > 20);
    const panel = await page.locator("#traffic-panel").boundingBox();
    const topbar = await page.locator(".topbar").boundingBox();
    assert.equal(panel.y, topbar.height);
    assert.equal(panel.y + panel.height, viewport.height);
    if (viewport.width <= 600) {
      await page.getByRole("button", { name: "Toggle flight panel" }).click();
      await page.getByRole("button", { name: "Fit airport" }).click();
      await settled();
    }
    await clickAircraft(1, "right");
    await settled();
    const box = await page.locator("#aircraft-menu").boundingBox();
    const header = await page.locator(".topbar").boundingBox();
    assert.ok(box.width <= 240 && box.height < 80, "Pushback menu is compact");
    assert.equal(
      await page
        .locator("#aircraft-menu h2, #aircraft-menu .plane-type")
        .count(),
      0,
    );
    assert.equal(
      await page.locator("#aircraft-menu").innerText(),
      "Approve pushback\nP",
    );
    assert.ok(
      box.x >= 0 &&
        box.y >= header.height &&
        box.x + box.width <= viewport.width &&
        box.y + box.height <= viewport.height,
      JSON.stringify({ viewport, box }),
    );
    await page.screenshot({
      path: artifact("dark-menu-" + viewport.width + ".png"),
    });
    await page.keyboard.press("Escape");
    if (viewport.width <= 600)
      await page.getByRole("button", { name: "Toggle flight panel" }).click();
  }
  await page.evaluate(() => {
    groundControl.sim.time = 1201;
    groundControl.sim.tick(0.25);
  });
  assert.ok(await page.evaluate(() => groundControl.sim.time > 1201));
  assert.equal(await page.locator("#results-dialog").count(), 0);
  const offline = await browser.newPage({
    viewport: { width: 1280, height: 800 },
  });
  await offline.context().setOffline(true);
  await offline.goto(pathToFileURL(path.resolve("Ground Control.html")).href);
  await offline.waitForFunction(() => window.groundControl);
  assert.equal(
    await offline.evaluate(() => groundControl.sim.planes.length),
    4,
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS: aircraft click/right-click menus, all clearance shortcuts, form/modal guards, request sorting, runway protection, full flight cycles, endless play, full-screen dark map, five responsive viewports, offline game.",
  );
} finally {
  await browser.close();
}
