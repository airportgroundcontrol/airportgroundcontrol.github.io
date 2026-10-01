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
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(baseURL + "/3d.html?airport=EDDF");
  await page.waitForFunction(
    () =>
      window.groundControl?.sim.data.id === "EDDF" &&
      groundControl.viewMode === "3d" &&
      groundControl.towerView?.renderer.info.render.calls > 0 &&
      groundControl.towerView.aircraft.size ===
        groundControl.sim.planes.filter((plane) => plane.state !== "done")
          .length,
    null,
    { timeout: 30_000 },
  );
  await page.evaluate(() => groundControl.setPaused(true));

  assert.deepEqual(errors, []);
  assert.equal(await page.locator("body").getAttribute("class"), "view-3d");
  assert.equal(await page.locator("#tower-panel [data-action]").count(), 0);
  assert.equal(await page.locator("#tower-panel select").count(), 0);
  assert.equal(await page.locator("#aircraft-panel").count(), 0);
  assert.equal(await page.locator("#view-toggle").count(), 0);
  assert.equal(await page.locator("#aircraft-menu").isHidden(), true);
  assert.ok((await page.locator(".flight-group").count()) > 0);
  assert.equal(
    await page.locator(".flight-card").count(),
    await page.evaluate(
      () =>
        groundControl.sim.planes.filter((plane) => plane.state !== "done")
          .length,
    ),
  );

  const scene = await page.evaluate(() => {
    const { towerView: view, sim } = groundControl;
    view.render();
    const gl = view.renderer.getContext();
    const size = Math.min(256, gl.drawingBufferWidth, gl.drawingBufferHeight);
    const pixels = new Uint8Array(size * size * 4);
    gl.readPixels(
      Math.floor((gl.drawingBufferWidth - size) / 2),
      Math.floor((gl.drawingBufferHeight - size) / 2),
      size,
      size,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      pixels,
    );
    const colors = new Set();
    for (let index = 0; index < pixels.length; index += 64)
      colors.add(`${pixels[index]},${pixels[index + 1]},${pixels[index + 2]}`);
    return {
      colors: colors.size,
      calls: view.renderer.info.render.calls,
      triangles: view.renderer.info.render.triangles,
      aircraft: view.aircraft.size,
      simulationAircraft: sim.planes.filter((item) => item.state !== "done")
        .length,
      visualParts: [...view.aircraft.values()][0].userData.visualParts,
      tower: view.tower,
      overflow: document.documentElement.scrollWidth > innerWidth,
    };
  });
  assert.ok(scene.colors > 12);
  assert.ok(scene.calls > 8);
  assert.ok(scene.triangles > 1_000);
  assert.equal(scene.aircraft, scene.simulationAircraft);
  assert.ok(scene.aircraft > 0);
  assert.deepEqual(scene.visualParts, [
    "fuselage",
    "swept-wings",
    "windows",
    scene.visualParts[3],
    "landing-gear",
  ]);
  assert.ok(["jet-engine", "propeller"].includes(scene.visualParts[3]));
  assert.equal(scene.tower.featureId, "129836215");
  assert.equal(scene.tower.height, 65);
  assert.equal(scene.tower.viewpointHeight, 62);
  assert.equal(scene.overflow, false);

  const layout = await page.evaluate(() => {
    groundControl.map.draw();
    const map = groundControl.map;
    const pixels = map.ctx.getImageData(
      0,
      0,
      map.canvas.width,
      map.canvas.height,
    ).data;
    const colors = new Set();
    for (let index = 0; index < pixels.length; index += 128)
      colors.add(`${pixels[index]},${pixels[index + 1]},${pixels[index + 2]}`);
    const header = document.querySelector(".topbar").getBoundingClientRect();
    const tower = document
      .getElementById("tower-panel")
      .getBoundingClientRect();
    const controlMap = map.canvas.getBoundingClientRect();
    return {
      colors: colors.size,
      header: header.height,
      tower: tower.height,
      map: controlMap.height,
      mapWidth: controlMap.width,
      mapBottom: controlMap.bottom,
      dockBottom: document.getElementById("flight-dock").getBoundingClientRect()
        .bottom,
    };
  });
  assert.ok(layout.colors > 25);
  assert.ok(Math.abs(Math.round(layout.header + layout.tower) - 960) <= 2);
  assert.ok(layout.map >= 230);
  assert.ok(layout.mapWidth >= 330);
  assert.ok(layout.mapBottom <= 960 && layout.dockBottom <= 960);

  const miniMap = page.locator("#mini-map");
  const miniMapBefore = await miniMap.boundingBox();
  const miniMapHandle = await page.locator("#mini-map-handle").boundingBox();
  await page.mouse.move(
    miniMapHandle.x + miniMapHandle.width / 2,
    miniMapHandle.y + miniMapHandle.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(miniMapHandle.x + 90, miniMapHandle.y - 145, {
    steps: 4,
  });
  await page.mouse.up();
  const miniMapMoved = await miniMap.boundingBox();
  assert.ok(miniMapMoved.x > miniMapBefore.x + 50);
  assert.ok(miniMapMoved.y < miniMapBefore.y - 110);
  await page.mouse.move(
    miniMapMoved.x + miniMapMoved.width - 2,
    miniMapMoved.y + miniMapMoved.height - 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    miniMapMoved.x + miniMapMoved.width + 48,
    miniMapMoved.y + miniMapMoved.height + 28,
    { steps: 4 },
  );
  await page.mouse.up();
  await page.waitForTimeout(100);
  const miniMapResized = await miniMap.boundingBox();
  assert.ok(miniMapResized.width > miniMapMoved.width + 25);
  assert.ok(miniMapResized.height > miniMapMoved.height + 15);

  const flightDock = page.locator("#flight-dock");
  const flightDockBefore = await flightDock.boundingBox();
  const flightDockHandle = await page
    .locator("#flight-dock-handle")
    .boundingBox();
  await page.mouse.move(
    flightDockHandle.x + flightDockHandle.width / 2,
    flightDockHandle.y + flightDockHandle.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(flightDockHandle.x - 80, flightDockHandle.y - 65, {
    steps: 4,
  });
  await page.mouse.up();
  const flightDockMoved = await flightDock.boundingBox();
  assert.ok(
    flightDockMoved.x < flightDockBefore.x - 50,
    JSON.stringify({ flightDockBefore, flightDockMoved, flightDockHandle }),
  );
  assert.ok(
    flightDockMoved.y < flightDockBefore.y - 35,
    JSON.stringify({ flightDockBefore, flightDockMoved, flightDockHandle }),
  );

  const towerTools = page.locator(".tower-tools");
  const towerToolsBefore = await towerTools.boundingBox();
  const towerToolsHandle = await page
    .locator("#tower-tools-handle")
    .boundingBox();
  await page.mouse.move(
    towerToolsHandle.x + towerToolsHandle.width / 2,
    towerToolsHandle.y + towerToolsHandle.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(towerToolsHandle.x - 100, towerToolsHandle.y + 65, {
    steps: 4,
  });
  await page.mouse.up();
  const towerToolsMoved = await towerTools.boundingBox();
  assert.ok(towerToolsMoved.x < towerToolsBefore.x - 70);
  assert.ok(towerToolsMoved.y > towerToolsBefore.y + 40);

  const viewpoint = await page.evaluate(() => {
    groundControl.map.draw();
    const view = groundControl.towerView.getViewpoint();
    const point = groundControl.map.screen(view);
    const pixels = groundControl.map.ctx.getImageData(
      Math.max(0, Math.floor(point.x - 10)),
      Math.max(0, Math.floor(point.y - 10)),
      20,
      20,
    ).data;
    let bluePixels = 0;
    for (let index = 0; index < pixels.length; index += 4)
      if (pixels[index + 2] > pixels[index] + 20) bluePixels++;
    return {
      bluePixels,
      tower: groundControl.towerView.tower,
      view,
    };
  });
  assert.equal(viewpoint.view.x, viewpoint.tower.x);
  assert.equal(viewpoint.view.y, viewpoint.tower.y);
  assert.ok(viewpoint.view.horizontalFov > 0.5);
  assert.ok(viewpoint.bluePixels > 10);

  await page.locator("#tower-cameras").click();
  assert.equal(
    await page.locator('#camera-menu input[type="checkbox"]').count(),
    6,
  );
  await page
    .getByRole("checkbox", { name: "Terminal 1 Apron" })
    .setChecked(true);
  await page
    .getByRole("checkbox", { name: "Terminal 2 Apron" })
    .setChecked(true);
  await page.waitForFunction(
    () =>
      groundControl.towerView.feeds.size === 2 &&
      [...groundControl.towerView.feeds.values()].every(
        (feed) => feed.renderer.info.render.calls > 0,
      ),
  );
  assert.equal(await page.locator(".camera-window").count(), 2);
  assert.equal(
    await page.evaluate(
      () =>
        groundControl.map.cameraViewpoints().filter((camera) => camera.active)
          .length,
    ),
    2,
  );
  await page.locator("#tower-cameras").click();

  const firstWindow = page.locator('[data-camera="t1-apron"]');
  const feedControlsBefore = await page.evaluate(() => ({
    tower: groundControl.towerView.captureViewState().tower,
    feed: {
      ...groundControl.towerView.cameraStates.get("t1-apron"),
    },
  }));
  const firstCanvas = await firstWindow.locator("canvas").boundingBox();
  const feedCenter = {
    x: firstCanvas.x + firstCanvas.width / 2,
    y: firstCanvas.y + firstCanvas.height / 2,
  };
  await page.mouse.move(feedCenter.x, feedCenter.y);
  await page.mouse.down();
  await page.mouse.move(feedCenter.x + 55, feedCenter.y + 25, { steps: 4 });
  await page.mouse.up();
  await page.mouse.wheel(0, -240);
  const feedControlsAfter = await page.evaluate(() => ({
    tower: groundControl.towerView.captureViewState().tower,
    feed: {
      ...groundControl.towerView.cameraStates.get("t1-apron"),
    },
  }));
  assert.ok(feedControlsAfter.feed.yaw > feedControlsBefore.feed.yaw);
  assert.ok(feedControlsAfter.feed.pitch > feedControlsBefore.feed.pitch);
  assert.ok(feedControlsAfter.feed.fov < feedControlsBefore.feed.fov);
  assert.deepEqual(feedControlsAfter.tower, feedControlsBefore.tower);

  const firstBefore = await firstWindow.boundingBox();
  const firstHeader = await firstWindow.locator("header").boundingBox();
  await page.mouse.move(firstHeader.x + 50, firstHeader.y + 15);
  await page.mouse.down();
  await page.mouse.move(firstHeader.x - 30, firstHeader.y + 35);
  await page.mouse.up();
  const firstAfter = await firstWindow.boundingBox();
  assert.ok(
    firstAfter.x < firstBefore.x - 60,
    JSON.stringify({ firstBefore, firstAfter }),
  );
  assert.ok(firstAfter.y > firstBefore.y + 10);
  await firstWindow.evaluate((element) => {
    element.style.width = "310px";
    element.style.height = "190px";
  });
  await page.waitForFunction(
    () =>
      groundControl.towerView.feeds.get("t1-apron").renderer.domElement
        .clientWidth >= 308,
  );
  await page.getByRole("button", { name: "Close Terminal 1 Apron" }).click();
  assert.equal(await page.locator(".camera-window").count(), 1);

  await page.locator("#tower-cameras").click();
  await page
    .getByRole("checkbox", { name: "Runway 18 North" })
    .setChecked(true);
  await page.waitForFunction(() =>
    groundControl.towerView.feeds.has("runway-north"),
  );
  assert.equal(await page.locator(".camera-window").count(), 2);
  await page.locator("#tower-cameras").click();
  assert.equal(await page.locator("#view-resizer").count(), 0);

  const towerBox = await page.locator("#tower-scene").boundingBox();
  const cameraBefore = await page.evaluate(() => ({
    yaw: groundControl.towerView.yaw,
    pitch: groundControl.towerView.pitch,
    fov: groundControl.towerView.camera.fov,
  }));
  const center = {
    x: towerBox.x + towerBox.width / 2,
    y: towerBox.y + towerBox.height / 2,
  };
  await page.mouse.move(center.x, center.y);
  await page.mouse.down();
  await page.mouse.move(center.x + 80, center.y + 45, { steps: 4 });
  await page.mouse.up();
  await page.mouse.wheel(0, -300);
  const cameraAfter = await page.evaluate(() => ({
    yaw: groundControl.towerView.yaw,
    pitch: groundControl.towerView.pitch,
    fov: groundControl.towerView.camera.fov,
  }));
  assert.ok(cameraAfter.yaw > cameraBefore.yaw);
  assert.ok(cameraAfter.pitch > cameraBefore.pitch);
  assert.ok(cameraAfter.fov < cameraBefore.fov);

  const focusedAircraft = await page.evaluate(() => {
    const plane = groundControl.sim.planes.find((candidate) =>
      ["gate", "parked"].includes(candidate.state),
    );
    return {
      id: plane.id,
      expectedYaw: Math.atan2(
        plane.x - groundControl.towerView.tower.x,
        plane.y - groundControl.towerView.tower.y,
      ),
    };
  });
  await page.locator(`[data-flight-id="${focusedAircraft.id}"]`).dblclick();
  await page.waitForFunction(
    (expected) => Math.abs(groundControl.towerView.yaw - expected) < 0.001,
    focusedAircraft.expectedYaw,
  );
  await page.keyboard.press("Escape");
  assert.equal(await page.locator("#aircraft-menu").isHidden(), true);

  const aircraft = await page.evaluate(() => {
    const plane = groundControl.sim.planes.find((candidate) =>
      ["gate", "parked"].includes(candidate.state),
    );
    return {
      id: plane.id,
      state: plane.state,
    };
  });
  await page.locator(`[data-flight-id="${aircraft.id}"]`).click();
  await page.waitForFunction(
    () => !document.getElementById("aircraft-menu").hidden,
  );
  const menuBox = await page.locator("#aircraft-menu").boundingBox();
  const towerPanel = await page.locator("#tower-panel").boundingBox();
  const dockBox = await page.locator("#flight-dock").boundingBox();
  assert.ok(
    menuBox.y >= towerPanel.y && menuBox.y + menuBox.height <= dockBox.y,
  );
  if (aircraft.state === "gate") {
    assert.equal(
      await page.getByRole("menuitem", { name: "Approve pushback" }).count(),
      1,
    );
  }
  await page.keyboard.press("Escape");
  assert.equal(await page.locator("#aircraft-menu").isHidden(), true);

  const map2DView = { x: 830, y: -460, zoom: 0.42 };
  await page.screenshot({ path: artifact("tower-desktop.png") });
  await page.evaluate(() => groundControl.setViewMode("2d"));
  assert.equal(await page.locator("body").getAttribute("class"), "");
  assert.equal(await page.locator("#tower-panel").isHidden(), true);
  assert.equal(await page.evaluate(() => groundControl.viewMode), "2d");
  const fullMap = await page.locator("#map").boundingBox();
  assert.ok(fullMap.height > 800);
  assert.ok(fullMap.width > 1400);
  await page.evaluate((camera) => {
    groundControl.map.camera = camera;
    groundControl.map.draw();
  }, map2DView);
  await page.evaluate(() => groundControl.setViewMode("3d"));
  assert.equal(await page.evaluate(() => groundControl.viewMode), "3d");
  assert.ok(
    await page.evaluate(() => {
      const view = groundControl.towerView.getViewpoint(),
        point = groundControl.map.screen(view);
      return (
        groundControl.map.camera.zoom > 0 &&
        point.x >= 0 &&
        point.x <= groundControl.map.width &&
        point.y >= 0 &&
        point.y <= groundControl.map.height
      );
    }),
  );

  await page.locator("#airport-button").click();
  assert.match(
    await page
      .locator(".airport-choice", { hasText: "London City Airport" })
      .innerText(),
    /2D \+ 3D tower view/,
  );
  assert.match(
    await page
      .locator(".airport-choice", { hasText: "Frankfurt Airport" })
      .innerText(),
    /2D \+ 3D tower view/,
  );
  assert.match(
    await page
      .locator(".airport-choice", { hasText: "Orlando International Airport" })
      .innerText(),
    /2D \+ 3D tower view/,
  );
  await page.keyboard.press("Escape");

  const savedViews = await page.evaluate(() => {
    groundControl.sim.score = 3210;
    groundControl.session.save();
    const bounds = (selector) => {
      const box = document.querySelector(selector).getBoundingClientRect();
      return {
        x: Math.round(box.x),
        y: Math.round(box.y),
        width: Math.round(box.width),
        height: Math.round(box.height),
      };
    };
    return {
      tower: groundControl.towerView.captureViewState(),
      overlays: {
        map: bounds("#mini-map"),
        dock: bounds("#flight-dock"),
        tools: bounds(".tower-tools"),
        camera: bounds('[data-camera="t2-apron"]'),
      },
    };
  });
  await page.reload();
  await page.waitForFunction(
    () =>
      window.groundControl?.sim.score === 3210 &&
      groundControl.viewMode === "3d" &&
      groundControl.towerView?.feeds.size === 2,
  );
  assert.deepEqual(
    await page.evaluate(() => groundControl.towerView.captureViewState()),
    savedViews.tower,
  );
  assert.deepEqual(
    await page.evaluate(() => {
      const bounds = (selector) => {
        const box = document.querySelector(selector).getBoundingClientRect();
        return {
          x: Math.round(box.x),
          y: Math.round(box.y),
          width: Math.round(box.width),
          height: Math.round(box.height),
        };
      };
      return {
        map: bounds("#mini-map"),
        dock: bounds("#flight-dock"),
        tools: bounds(".tower-tools"),
        camera: bounds('[data-camera="t2-apron"]'),
      };
    }),
    savedViews.overlays,
  );
  await page.evaluate(() => groundControl.setViewMode("2d"));
  assert.deepEqual(
    await page.evaluate(() => groundControl.map.camera),
    map2DView,
  );
  await page.evaluate(() => groundControl.setViewMode("3d"));
  assert.ok((await page.evaluate(() => groundControl.map.camera.zoom)) > 0);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(100);
  const mobile = await page.evaluate(() => {
    const header = document.querySelector(".topbar").getBoundingClientRect();
    const tower = document
      .getElementById("tower-panel")
      .getBoundingClientRect();
    const map = document.getElementById("map").getBoundingClientRect();
    const dock = document.getElementById("flight-dock").getBoundingClientRect();
    return {
      overflow: document.documentElement.scrollWidth > innerWidth,
      width: groundControl.towerView.canvas.clientWidth,
      total: Math.round(header.height + tower.height),
      towerHeight: tower.height,
      mapWidth: map.width,
      mapHeight: map.height,
      dock,
      tools: document
        .querySelector(".tower-tools")
        .getBoundingClientRect()
        .toJSON(),
      cameraWindows: [...document.querySelectorAll(".camera-window")].map(
        (element) => element.getBoundingClientRect().toJSON(),
      ),
    };
  });
  assert.equal(mobile.overflow, false);
  assert.equal(mobile.width, 390);
  assert.ok(Math.abs(mobile.total - 844) <= 2);
  assert.ok(mobile.mapWidth >= 218 && mobile.mapWidth <= 374);
  assert.ok(mobile.mapHeight >= 153 && mobile.mapHeight <= 776);
  assert.ok(mobile.dock.left >= 0 && mobile.dock.right <= 390);
  assert.ok(mobile.dock.bottom <= 844);
  assert.ok(mobile.tools.left >= 0 && mobile.tools.right <= 390);
  assert.ok(mobile.tools.top >= 0 && mobile.tools.bottom <= 844);
  assert.ok(
    mobile.cameraWindows.every(
      (window) => window.left >= 0 && window.right <= 390,
    ),
  );
  await page.screenshot({ path: artifact("tower-mobile.png") });
  await context.close();

  const defaultContext = await browser.newContext({
    viewport: { width: 1280, height: 800 },
  });
  await defaultContext.addInitScript(() =>
    localStorage.setItem("ground-control:view:EGLC", "3d"),
  );
  const defaultView = await defaultContext.newPage();
  await defaultView.goto(baseURL + "/?airport=EGLC");
  await defaultView.waitForFunction(() => window.groundControl);
  assert.equal(await defaultView.evaluate(() => groundControl.viewMode), "2d");
  assert.equal(await defaultView.locator("#tower-panel").isHidden(), true);
  assert.equal(await defaultView.locator("#view-toggle").count(), 0);
  assert.ok((await defaultView.locator("#map").boundingBox()).height > 700);
  await defaultContext.close();

  const london = await browser.newPage({
    viewport: { width: 1280, height: 800 },
  });
  await london.goto(baseURL + "/?airport=EGLC&view=3d");
  await london.waitForFunction(
    () =>
      window.groundControl?.sim.data.id === "EGLC" &&
      groundControl.viewMode === "3d" &&
      groundControl.towerView?.renderer.info.render.calls > 0,
  );
  await london.evaluate(() => groundControl.setPaused(true));
  assert.equal(await london.evaluate(() => groundControl.viewMode), "3d");
  assert.equal(await london.locator("#view-toggle").count(), 0);
  const londonScene = await london.evaluate(() => {
    const { towerView: view, sim } = groundControl;
    view.render();
    const gl = view.renderer.getContext();
    const size = Math.min(128, gl.drawingBufferWidth, gl.drawingBufferHeight);
    const pixels = new Uint8Array(size * size * 4);
    gl.readPixels(
      Math.floor((gl.drawingBufferWidth - size) / 2),
      Math.floor((gl.drawingBufferHeight - size) / 2),
      size,
      size,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      pixels,
    );
    const colors = new Set();
    for (let index = 0; index < pixels.length; index += 64)
      colors.add(`${pixels[index]},${pixels[index + 1]},${pixels[index + 2]}`);
    return {
      colors: colors.size,
      triangles: view.renderer.info.render.triangles,
      aircraft: view.aircraft.size,
      activeAircraft: sim.planes.filter((plane) => plane.state !== "done")
        .length,
      cameras: sim.data.cameraViews.length,
      tower: view.tower,
      cameraHeight: view.camera.position.y,
    };
  });
  assert.ok(londonScene.colors > 8, JSON.stringify(londonScene));
  assert.ok(londonScene.triangles > 100, JSON.stringify(londonScene));
  assert.equal(londonScene.aircraft, londonScene.activeAircraft);
  assert.equal(londonScene.cameras, 4);
  assert.equal(londonScene.tower.featureId, "867688184");
  assert.equal(londonScene.tower.height, 50);
  assert.equal(londonScene.cameraHeight, 50);
  await london.screenshot({ path: artifact("london-city-tower.png") });
  await london.evaluate(() => groundControl.setViewMode("2d"));
  await london.screenshot({ path: artifact("london-city-map.png") });
  await london.close();

  const aircraftModels = await browser.newPage({
    viewport: { width: 1600, height: 1000 },
  });
  await aircraftModels.goto(baseURL + "/?airport=EDDF&view=3d");
  await aircraftModels.waitForFunction(
    () => groundControl.towerView?.renderer.info.render.calls > 0,
  );
  const modelScene = await aircraftModels.evaluate(() => {
    groundControl.setPaused(true);
    const types = [
      "AT72",
      "DH8D",
      "E190",
      "A223",
      "A320",
      "B738",
      "A21N",
      "A333",
      "A359",
      "B77W",
      "B748",
    ];
    const view = groundControl.towerView;
    groundControl.sim.planes = types.map((type, index) => {
      const row = index < 7 ? 0 : 1;
      const column = row === 0 ? index - 3 : index - 8.5;
      return {
        id: 900 + index,
        call: type,
        type,
        state: "gate",
        direction: "departure",
        x: view.tower.x + column * (row ? 88 : 55),
        y: view.tower.y + 165 + row * 125,
        angle: -Math.PI / 2,
        airborne: false,
        route: [],
        speed: 0,
      };
    });
    view.yaw = 0;
    view.pitch = -0.32;
    view.camera.fov = 54;
    view.camera.updateProjectionMatrix();
    view.updateCamera();
    view.render();
    return {
      models: Object.fromEntries(
        [...view.aircraft.values()].map((model) => [
          model.userData.modelProfile.type,
          model.userData.modelProfile,
        ]),
      ),
      triangles: view.renderer.info.render.triangles,
    };
  });
  assert.equal(Object.keys(modelScene.models).length, 11);
  assert.equal(modelScene.models.AT72.propellerBlades, 6);
  assert.equal(modelScene.models.DH8D.tail, "t");
  assert.equal(modelScene.models.A320.wingtip, "sharklet");
  assert.equal(modelScene.models.A320.fidelity, "cc-by-gltf-v1");
  assert.equal(
    modelScene.models.A320.attribution,
    "amvlab aircraft-models / CC BY 4.0",
  );
  assert.deepEqual(modelScene.models.A320.dimensions, {
    length: 37.57,
    wingspan: 35.8,
    height: 11.76,
  });
  assert.equal(modelScene.models.A320.wheelbase, 12.64);
  assert.equal(modelScene.models.A320.mainGearTrack, 7.59);
  assert.equal(modelScene.models.B738.wingtip, "blended");
  assert.equal(modelScene.models.B77W.mainGearAxles, 3);
  assert.equal(modelScene.models.B748.engineCount, 4);
  assert.equal(modelScene.models.B748.upperDeck, true);
  assert.equal(modelScene.models.A359.wingtip, "curved");
  assert.ok(modelScene.triangles > 5_000, JSON.stringify(modelScene));
  await aircraftModels
    .locator("#tower-panel")
    .screenshot({ path: artifact("aircraft-model-lineup.png") });
  await aircraftModels.close();

  const orlando = await browser.newPage({
    viewport: { width: 1280, height: 800 },
  });
  await orlando.goto(baseURL + "/?airport=KMCO&view=3d");
  await orlando.waitForFunction(
    () =>
      window.groundControl?.sim.data.id === "KMCO" &&
      groundControl.viewMode === "3d" &&
      groundControl.towerView?.renderer.info.render.calls > 0,
    null,
    { timeout: 30_000 },
  );
  await orlando.evaluate(() => groundControl.setPaused(true));
  const stagedArrivalId = await orlando.evaluate(() => {
    const { sim } = groundControl;
    sim.planes = [];
    sim.nextArrival = sim.nextDeparture = Infinity;
    sim.configureRunways([
      {
        runwayId: "18R-36L",
        endId: "18R",
        arrivals: true,
        departures: false,
      },
    ]);
    sim.spawnArrival("MCO411", "A320");
    const plane = sim.planes[0],
      exit = sim.landingOptions(plane)[0],
      node = sim.nodes.get(exit.path.at(-1));
    Object.assign(plane, {
      state: "inbound",
      airborne: false,
      node: node.id,
      x: node.x,
      y: node.y,
      speed: 0,
      route: [],
      stand: null,
    });
    groundControl.select(plane.id);
    return plane.id;
  });
  assert.ok(
    (await orlando.locator("#stand-select option:not([disabled])").count()) > 1,
  );
  await orlando.getByRole("menuitem", { name: "Plan taxi route" }).click();
  assert.match(
    await orlando.locator(".route-summary").innerText(),
    /Hold short .* then Stand/,
  );
  const stagedClearance = orlando.getByRole("menuitem", {
    name: "Issue taxi clearance",
  });
  assert.equal(await stagedClearance.isEnabled(), true);
  await stagedClearance.click();
  const stagedState = await orlando.evaluate((id) => {
    const plane = groundControl.sim.planes.find((item) => item.id === id);
    return {
      state: plane.state,
      taxiTarget: plane.taxiTarget,
      assignedStand: Boolean(plane.stand),
      hold: plane.holdLabel,
    };
  }, stagedArrivalId);
  assert.deepEqual(
    {
      state: stagedState.state,
      taxiTarget: stagedState.taxiTarget,
      assignedStand: stagedState.assignedStand,
    },
    {
      state: "taxiin",
      taxiTarget: "hold",
      assignedStand: true,
    },
  );
  assert.match(stagedState.hold, /18L-36R/);
  const orlandoScene = await orlando.evaluate(() => {
    const view = groundControl.towerView;
    view.render();
    const gl = view.renderer.getContext();
    const size = Math.min(128, gl.drawingBufferWidth, gl.drawingBufferHeight);
    const pixels = new Uint8Array(size * size * 4);
    gl.readPixels(
      Math.floor((gl.drawingBufferWidth - size) / 2),
      Math.floor((gl.drawingBufferHeight - size) / 2),
      size,
      size,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      pixels,
    );
    const colors = new Set();
    for (let index = 0; index < pixels.length; index += 64)
      colors.add(`${pixels[index]},${pixels[index + 1]},${pixels[index + 2]}`);
    return {
      colors: colors.size,
      triangles: view.renderer.info.render.triangles,
      tower: view.tower,
      cameraHeight: view.camera.position.y,
    };
  });
  assert.ok(orlandoScene.colors > 8, JSON.stringify(orlandoScene));
  assert.ok(orlandoScene.triangles > 100, JSON.stringify(orlandoScene));
  assert.equal(orlandoScene.tower.featureId, "417344833");
  assert.equal(orlandoScene.tower.height, 105.2);
  assert.equal(orlandoScene.cameraHeight, 100);
  await orlando.screenshot({ path: artifact("orlando-tower.png") });
  await orlando.close();

  const offlineContext = await browser.newContext({
    offline: true,
    viewport: { width: 1280, height: 800 },
  });
  const offline = await offlineContext.newPage();
  const networkRequests = [];
  offline.on("request", (request) => {
    if (/^https?:/.test(request.url())) networkRequests.push(request.url());
  });
  await offline.goto(
    pathToFileURL(path.resolve("Ground Control 3D.html")).href,
  );
  await offline.waitForFunction(
    () =>
      window.groundControl?.sim.data.id === "EDDF" &&
      groundControl.viewMode === "3d" &&
      groundControl.towerView,
  );
  assert.deepEqual(networkRequests, []);
  await offlineContext.close();

  console.log(
    "Shared game session, original 2D controls, tower visualization, view support and offline play verified.",
  );
} finally {
  await browser.close();
}
