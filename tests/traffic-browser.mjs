import { baseURL, browserChannel, artifact } from "./browser-support.mjs";
import { chromium } from "playwright";
import { useScriptedTraffic } from "./scripted-browser.mjs";
import assert from "node:assert/strict";
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
  await useScriptedTraffic(page.context());
  await page.goto(baseURL);
  await page.waitForFunction(() => window.groundControl);
  await page.evaluate(() => {
    groundControl.setPaused(true);
    groundControl.sim.nextArrival = groundControl.sim.nextDeparture = Infinity;
  });
  const select = async (call) => {
    const point = await page.evaluate((call) => {
      const plane = groundControl.sim.planes.find((item) => item.call === call);
      return groundControl.map.aircraftScreen(plane);
    }, call);
    await page.mouse.click(point.x, point.y);
  };
  const action = (label) =>
    page.getByRole("menuitem", { name: label, exact: false }).click();
  const advance = async (id, condition) => {
    const result = await page.evaluate(
      ({ id, condition }) => {
        const s = groundControl.sim,
          p = s.planes.find((p) => p.id === id);
        const done = () =>
          condition === "holdReached" ? p.holdReached : p.state === condition;
        for (let i = 0; i < 10000 && !done(); i++) s.tick(0.1);
        return !!done();
      },
      { id, condition },
    );
    assert.ok(result);
  };

  assert.equal(await page.locator("#traffic-panel").count(), 0);
  await page.screenshot({ path: artifact("map-requests-desktop.png") });

  await select("BAW1439");
  await page.keyboard.press("p");
  await advance(1, "ready");
  await page.keyboard.press("b");
  await page.getByRole("button", { name: "Back to actions" }).focus();
  await page.keyboard.press("Enter");
  assert.equal(await page.locator("#instruction-select").count(), 0);
  await page.keyboard.press("b");
  await page
    .getByLabel("Taxi to holding point", { exact: true })
    .selectOption({ label: "A15" });
  assert.equal(
    await page.evaluate(() => groundControl.map.focusHold.ref),
    "A15",
  );
  await page.screenshot({ path: artifact("holding-point-picker.png") });
  await action("Clear taxi");
  assert.equal(await page.locator("#aircraft-menu").isVisible(), false);
  await advance(1, "atpoint");
  await select("BAW1439");
  await page.keyboard.press("t");
  await page.keyboard.press("Enter");
  await page.keyboard.press("s");
  const holdOption = await page
    .getByLabel("Hold short of", { exact: true })
    .locator("option:not(:disabled)")
    .first()
    .getAttribute("value");
  await page
    .getByLabel("Hold short of", { exact: true })
    .selectOption(holdOption);
  await action("Issue instruction");
  assert.equal(await page.locator("#aircraft-menu").isVisible(), false);
  await advance(1, "holdReached");
  await select("BAW1439");
  assert.equal(
    await page.getByRole("menuitem", { name: "Continue taxi" }).count(),
    1,
  );
  await page.screenshot({ path: artifact("onward-clearance.png") });
  await page.keyboard.press("c");
  assert.equal(
    await page.evaluate(() => groundControl.sim.planes[0].held),
    false,
  );
  assert.equal(await page.locator("#aircraft-menu").isVisible(), false);

  await page.evaluate(() => {
    const s = groundControl.sim;
    s.reset();
    s.nextArrival = s.nextDeparture = Infinity;
    for (const id of [2, 1]) {
      s.command(id, "pushback");
      for (
        let i = 0;
        i < 2000 && s.planes.find((p) => p.id === id).state !== "ready";
        i++
      )
        s.tick(0.1);
    }
    s.command(2, "taxi");
    for (let i = 0; i < 250; i++) s.tick(0.1);
    s.command(1, "taxi");
  });
  await select("BAW1439");
  await page.keyboard.press("y");
  assert.ok(
    await page
      .getByLabel("Follow aircraft", { exact: true })
      .locator("option")
      .count(),
  );
  await page.getByLabel("Follow aircraft", { exact: true }).selectOption("2");
  await action("Issue instruction");
  assert.equal(
    await page.evaluate(() => groundControl.sim.planes[0].trafficOrder.kind),
    "follow",
  );
  assert.equal(await page.locator("#aircraft-menu").isVisible(), false);
  await select("BAW1439");
  await page.keyboard.press("x");
  assert.equal(
    await page.evaluate(() => groundControl.sim.planes[0].trafficOrder),
    null,
  );
  await select("BAW1439");
  await page.keyboard.press("w");
  await page
    .getByLabel("Give way to aircraft", { exact: true })
    .selectOption("2");
  await page.locator("#aircraft-menu").focus();
  await page.keyboard.press("Enter");
  assert.equal(
    await page.evaluate(() => groundControl.sim.planes[0].trafficOrder.kind),
    "giveway",
  );
  assert.equal(await page.locator("#aircraft-menu").isVisible(), false);
  await select("BAW1439");
  await page.keyboard.press("y");
  await page.evaluate(() => {
    groundControl.sim.planes.find((p) => p.id === 2).state = "done";
  });
  await page.waitForFunction(
    () => document.querySelector('[data-action="confirm"]')?.disabled,
  );
  await page.keyboard.press("Escape");
  await page.evaluate(() => {
    groundControl.sim.planes.find((p) => p.id === 2).state = "taxi";
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await select("BAW1439");
  await page.keyboard.press("s");
  await page.screenshot({ path: artifact("holding-picker-mobile.png") });
  const box = await page.locator("#aircraft-menu").boundingBox();
  assert.ok(
    box.x >= 0 &&
      box.x + box.width <= 390 &&
      box.y >= 104 &&
      box.y + box.height <= 844,
  );
  await page.keyboard.press("Escape");
  await page.screenshot({ path: artifact("map-requests-mobile.png") });
  assert.deepEqual(errors, []);
  console.log(
    "PASS: panel-free map control, holding-point and hold-short pickers, onward clearance, follow/give-way commands, keyboard and mouse actions and compact mobile menus.",
  );
} finally {
  await browser.close();
}
