import { baseURL, browserChannel, artifact } from "./browser-support.mjs";
import { chromium } from "playwright";
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
  await page.goto(baseURL);
  await page.waitForFunction(() => window.groundControl);
  await page.evaluate(() => {
    groundControl.setPaused(true);
    groundControl.sim.nextArrival = groundControl.sim.nextDeparture = Infinity;
  });
  const select = (call) =>
    page.getByRole("button", { name: "Select " + call }).click();
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

  await page.waitForFunction(
    () => document.querySelectorAll(".request-group").length === 2,
  );
  assert.equal(
    await page
      .getByRole("region", { name: "Request pushback", exact: true })
      .locator(".strip")
      .count(),
    3,
  );
  assert.equal(await page.locator(".strip-status").count(), 0);
  assert.equal(await page.locator(".strip.request").count(), 4);
  assert.equal(
    await page.locator(".strip").first().innerText(),
    "BAW1439\nA320 / S3",
  );
  assert.equal(
    await page
      .locator(".strip.request")
      .first()
      .evaluate((el) => getComputedStyle(el, "::after").animationName),
    "request-pulse",
  );
  await page.emulateMedia({ reducedMotion: "reduce" });
  assert.equal(
    await page
      .locator(".strip.request")
      .first()
      .evaluate((el) => getComputedStyle(el, "::after").animationName),
    "none",
  );
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.screenshot({ path: artifact("grouped-requests-desktop.png") });

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
  await page.waitForFunction(() =>
    [...document.querySelectorAll(".flight-group h3")].some((el) =>
      el.textContent.includes("Request onward taxi"),
    ),
  );
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
  await page.waitForFunction(
    () =>
      !document
        .querySelector('.strip[data-flight="1"]')
        .classList.contains("request"),
  );
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
  await page.getByRole("button", { name: "Arrivals", exact: true }).click();
  assert.equal(await page.locator(".strip.departure").count(), 0);
  await page.getByRole("button", { name: "All flights", exact: true }).click();

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
  await page.screenshot({ path: artifact("grouped-requests-mobile.png") });
  assert.deepEqual(errors, []);
  console.log(
    "PASS: grouped requests, reduced motion, holding-point and hold-short pickers, onward clearance, follow/give-way commands, keyboard and mouse actions, filters, compact mobile menus.",
  );
} finally {
  await browser.close();
}
