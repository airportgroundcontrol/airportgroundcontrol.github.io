import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const baseURL = process.env.BASE_URL || "http://127.0.0.1:4173";
const browserChannel = process.env.BROWSER_CHANNEL || "chrome";
const output = path.resolve("media/how-to-play.png");
const captures = path.resolve("test-results/how-to-play");

fs.mkdirSync(path.dirname(output), { recursive: true });
fs.mkdirSync(captures, { recursive: true });

const browser = await chromium.launch({
  channel: browserChannel,
  headless: true,
});

try {
  const context = await browser.newContext({
    viewport: { width: 1100, height: 720 },
    colorScheme: "dark",
  });
  const page = await context.newPage();
  await page.goto(baseURL + "?airport=EDDF");
  await page.waitForFunction(
    () => window.groundControl?.sim.data.id === "EDDF",
  );
  await page.evaluate(() => {
    groundControl.setPaused(true);
    groundControl.sim.reset(0x20260922);
    groundControl.sim.nextArrival = Infinity;
    groundControl.sim.nextDeparture = Infinity;
    groundControl.map.fit();
    for (const selector of [
      ".topbar",
      ".map-heading",
      ".map-controls",
      ".map-footer",
      ".compass",
    ])
      document.querySelector(selector).style.visibility = "hidden";
  });

  const settle = async () => {
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
  };
  const capture = async (name) => {
    await page.evaluate(() => {
      groundControl.sim.score = 0;
      groundControl.sim.incidents = 0;
      groundControl.sim.conflictPairs.clear();
      document.getElementById("score").textContent = "0";
      document.getElementById("incidents").textContent = "0";
      document.getElementById("toast").hidden = true;
    });
    await settle();
    const file = path.join(captures, name + ".png");
    await page.screenshot({
      path: file,
      animations: "disabled",
      clip: { x: 0, y: 68, width: 1100, height: 652 },
    });
    return file;
  };
  const firstPlane = (predicate) => page.evaluate(predicate);

  const gateId = await firstPlane(() => {
    const gates = groundControl.sim.planes.filter(
      (plane) => plane.state === "gate",
    );
    return (
      gates.find(
        (plane) => groundControl.sim.pushbackOptions(plane).length > 1,
      ) || gates[0]
    )?.id;
  });
  if (!gateId) throw new Error("The guide needs an aircraft at a stand.");

  await page.evaluate((id) => {
    const plane = groundControl.sim.planes.find(
      (candidate) => candidate.id === id,
    );
    groundControl.map.camera = { x: plane.x, y: plane.y, zoom: 0.16 };
    groundControl.select(id);
  }, gateId);
  const selectAircraft = await capture("01-select-aircraft");

  await page.evaluate((id) => {
    const sim = groundControl.sim;
    const plane = sim.planes.find((candidate) => candidate.id === id);
    if (plane.state === "gate") sim.command(id, "pushback");
    for (let i = 0; i < 4000 && plane.state !== "ready"; i++) sim.tick(0.1);
    groundControl.map.camera = { x: plane.x, y: plane.y, zoom: 0.24 };
    groundControl.select(id);
    groundControl.preview();
  }, gateId);
  const taxi = await capture("02-plan-taxi");

  await page.keyboard.press("Escape");
  await page.evaluate((id) => {
    const sim = groundControl.sim;
    sim.planes = sim.planes.filter((plane) => plane.direction !== "arrival");
    const plane = sim.planes.find((candidate) => candidate.id === id);
    let result = sim.command(id, "taxi");
    if (!result.ok) throw new Error(result.message);
    for (let i = 0; i < 12000 && plane.state !== "holding"; i++) sim.tick(0.1);
    if (plane.state !== "holding")
      throw new Error("Departure did not reach the runway.");
    result = sim.command(id, "lineup");
    if (!result.ok) throw new Error(result.message);
    for (let i = 0; i < 4000 && plane.state !== "linedup"; i++) sim.tick(0.1);
    if (plane.state !== "linedup")
      throw new Error("Departure did not line up.");
    groundControl.map.camera = { x: plane.x, y: plane.y, zoom: 0.42 };
    groundControl.select(id);
  }, gateId);
  const takeoff = await capture("03-clear-for-takeoff");

  await page.keyboard.press("Escape");
  const arrivalId = await firstPlane(() => {
    groundControl.sim.spawnArrival("DLH404", "A320");
    return groundControl.sim.planes.at(-1)?.id;
  });
  if (!arrivalId) throw new Error("The guide needs an approaching aircraft.");
  await page.evaluate((id) => {
    const sim = groundControl.sim;
    const plane = sim.planes.find((candidate) => candidate.id === id);
    for (let i = 0; i < 10000 && sim.arrivalETA(plane) > 70; i++) sim.tick(0.1);
    const threshold = sim.runwayFor(plane).start;
    groundControl.map.camera = {
      x: (plane.x + threshold.x) / 2,
      y: (plane.y + threshold.y) / 2,
      zoom: 0.16,
    };
    groundControl.select(id);
  }, arrivalId);
  const landing = await capture("04-coordinate-landing");
  await page.keyboard.press("Escape");

  await page.evaluate((id) => {
    const sim = groundControl.sim;
    const plane = sim.planes.find((candidate) => candidate.id === id);
    sim.planes = sim.planes.filter(
      (candidate) => candidate.id === id || candidate.direction !== "arrival",
    );
    const runway = sim.arrivalRunwayOptions(plane)[0];
    const exit = sim.landingOptions(
      { ...plane, runwayKey: runway.key },
      runway,
    )[0];
    if (!exit) throw new Error("Arrival has no suitable runway exit.");
    const result = sim.command(id, "land", {
      runwayKey: runway.key,
      exitId: exit.id,
    });
    if (!result.ok) throw new Error(result.message);
    for (let i = 0; i < 16000 && plane.state !== "inbound"; i++) sim.tick(0.1);
    if (plane.state !== "inbound")
      throw new Error("Arrival did not vacate the runway.");
    groundControl.map.camera = { x: plane.x, y: plane.y, zoom: 0.3 };
    groundControl.select(id);
    groundControl.preview();
  }, arrivalId);
  const taxiToStand = await capture("05-taxi-to-stand");

  await page.keyboard.press("Escape");
  await page.evaluate((id) => {
    const sim = groundControl.sim;
    const arrival = sim.planes.find((candidate) => candidate.id === id);
    const stand = sim.freeStands(arrival)[0];
    if (stand) sim.command(id, "taxi", { stand: stand.id });

    const gates = sim.planes
      .filter((plane) => plane.state === "gate")
      .slice(0, 4);
    for (const plane of gates) sim.command(plane.id, "pushback");
    for (
      let i = 0;
      i < 5000 &&
      gates.some(
        (plane) => plane.state === "pushback" || plane.state === "disconnect",
      );
      i++
    )
      sim.tick(0.1);
    for (const plane of gates.slice(0, 3))
      if (plane.state === "ready") sim.command(plane.id, "taxi");
    sim.spawnArrival("SWR831", "A320");
    sim.spawnArrival("BAW612", "A21N");
    for (let i = 0; i < 180; i++) sim.tick(0.1);

    const selected = sim.planes.find(
      (plane) => ["taxi", "taxiin"].includes(plane.state) && plane.route.length,
    );
    if (!selected) throw new Error("Traffic overview has no routed aircraft.");
    groundControl.map.camera = {
      x: selected.x,
      y: selected.y,
      zoom: 0.12,
    };
    groundControl.select(selected.id);
  }, arrivalId);
  await page.keyboard.press("Escape");
  const traffic = await capture("06-traffic-overview");

  const panels = [
    {
      title: "SELECT & PUSH BACK",
      image: selectAircraft,
      position: "center center",
    },
    {
      title: "PLAN TAXI",
      image: taxi,
      position: "center center",
    },
    {
      title: "CLEAR FOR TAKEOFF",
      image: takeoff,
      position: "center center",
    },
    {
      title: "COORDINATE LANDING",
      image: landing,
      position: "center center",
    },
    {
      title: "TAXI TO STAND",
      image: taxiToStand,
      position: "center center",
    },
    {
      title: "KEEP TRAFFIC MOVING",
      image: traffic,
      position: "center center",
    },
  ];

  const dataImage = (file) =>
    `data:image/png;base64,${fs.readFileSync(file).toString("base64")}`;
  const cards = panels
    .map(
      ({ title, image, position }) => `
        <article class="card">
          <div class="shot">
            <img src="${dataImage(image)}" style="object-position:${position}" />
          </div>
          <div class="caption">
            <h2>${title}</h2>
          </div>
        </article>`,
    )
    .join("");

  const artwork = await browser.newPage({
    viewport: { width: 1920, height: 1800 },
    deviceScaleFactor: 1,
  });
  await artwork.setContent(`<!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <style>
          * { box-sizing: border-box; }
          html, body { width: 1920px; height: 1800px; margin: 0; overflow: hidden; }
          body {
            background: #111315;
            color: #f4f5f6;
            font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
            padding: 32px 40px 36px;
          }
          header {
            height: 80px;
            display: flex;
            align-items: flex-start;
            justify-content: space-between;
          }
          h1 { margin: 0; font-size: 44px; line-height: .95; letter-spacing: 0; font-weight: 800; }
          header p { margin: 6px 0 0; color: #aeb4ba; font-size: 17px; letter-spacing: 0; }
          .brand { color: #f1d47a; font-size: 16px; font-weight: 800; letter-spacing: 0; padding-top: 7px; }
          main {
            height: 1652px;
            display: grid;
            grid-template-columns: repeat(2, 1fr);
            grid-template-rows: repeat(3, 1fr);
            gap: 18px;
          }
          .card {
            min-width: 0;
            overflow: hidden;
            background: #1b1e21;
            border: 1px solid #343a40;
            border-radius: 6px;
            position: relative;
          }
          .shot { position: absolute; inset: 0; overflow: hidden; background: #0d0f11; }
          img { width: 100%; height: 100%; display: block; object-fit: cover; }
          .caption {
            position: absolute;
            inset: auto 0 0;
            min-height: 60px;
            padding: 19px 20px 17px;
            background: rgba(24, 27, 30, .96);
            border-top: 1px solid #3b4147;
          }
          h2 { margin: 0; color: #f4f5f6; font-size: 22px; line-height: 1; letter-spacing: 0; }
        </style>
      </head>
      <body>
        <header>
          <div><h1>HOW TO PLAY</h1><p>Control every movement from stand to runway and back.</p></div>
          <div class="brand">AIRPORT GROUND CONTROL</div>
        </header>
        <main>${cards}</main>
      </body>
    </html>`);
  await artwork.screenshot({ path: output, animations: "disabled" });
  console.log(`Created ${output}`);
} finally {
  await browser.close();
}
