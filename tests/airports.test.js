import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createAirportPackage } from "../src/airports/package.js";
import { airportCatalog, defaultAirport } from "../src/airports/catalog.js";
import { GroundSim } from "../src/sim.js";
import { GameSession } from "../src/session/game-session.js";
import {
  GameStorage,
  airportRevision,
  configurationRevision,
  captureSimulation,
} from "../src/persistence.js";
import { syntheticInput } from "./fixtures/synthetic-airport.js";
const input = () => structuredClone(syntheticInput);
const until = (sim, id, state) => {
  for (
    let i = 0;
    i < 15000 && sim.planes.find((p) => p.id === id)?.state !== state;
    i++
  )
    sim.tick(0.1);
  assert.equal(sim.planes.find((p) => p.id === id)?.state, state);
};
const store = () => {
  const entries = new Map();
  return {
    entries,
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => entries.set(key, value),
  };
};

test("the same engine completes departure and arrival at a differently shaped, named airport", () => {
  const airport = createAirportPackage(input());
  const sim = new GroundSim(airport);
  sim.nextArrival = sim.nextDeparture = Infinity;
  assert.equal(sim.planes[0].stand, "A1");
  assert.equal(sim.planes[0].type, "E190");
  sim.planes = sim.planes.filter((p) => p.direction === "departure");
  for (const [action, state] of [
    ["pushback", "ready"],
    ["taxi", "holding"],
    ["lineup", "linedup"],
    ["takeoff", "done"],
  ]) {
    assert.ok(sim.command(1, action).ok, action);
    until(sim, 1, state);
  }
  assert.equal(sim.score, 25);
  assert.equal(sim.runwayOwner, null);
  sim.nextId = 2;
  sim.spawnArrival("TST202");
  assert.ok(sim.command(2, "land").ok);
  assert.equal(sim.runwayOwner, null);
  assert.equal(sim.clearedArrivalForRunway(sim.planes.at(-1)).id, 2);
  until(sim, 2, "inbound");
  assert.equal(sim.planes.find((p) => p.id === 2).node, "vacated");
  assert.ok(sim.command(2, "taxi", { stand: "B2" }).ok);
  until(sim, 2, "parked");
  assert.equal(sim.score, 50);
  assert.equal(sim.planes.find((p) => p.id === 2).node, "stand-b");
  assert.equal(sim.runwayFor(sim.planes.find((p) => p.id === 2)).label, "17");
  until(sim, 2, "gate");
});

test("traffic uses configured arrival intervals and never materializes new gate departures", () => {
  const airport = createAirportPackage(input()),
    sim = new GroundSim(airport);
  assert.equal(sim.nextArrival, 75);
  assert.equal(sim.nextDeparture, Infinity);
  sim.planes = [];
  sim.nextDeparture = 0;
  for (let i = 0; i < 901; i++) sim.tick(0.1);
  assert.ok(sim.planes.some((p) => p.call.startsWith("ARR")));
  assert.ok(!sim.planes.some((p) => p.call.startsWith("DEP")));
});

test("London City provides real connected geometry, nose-out stands and both runway flows", () => {
  const airport = defaultAirport;
  assert.equal(airport.id, "EGLC");
  assert.equal(airport.iata, "LCY");
  assert.equal(airport.name, "London City Airport");
  assert.deepEqual(airport.views, ["2d", "3d"]);
  assert.deepEqual(airport.towerView, {
    featureId: "867688184",
    structureHeight: 50,
    viewpointHeight: 50,
    heightSource: {
      name: "NATS London City Airport tower factsheet",
      url: "https://www.nats.aero/wp-content/uploads/2024/08/TowersFactsheets2023.pdf",
    },
  });
  assert.equal(airport.cameraViews.length, 4);
  assert.ok(
    airport.environment.features.filter((feature) => feature.type === "water")
      .length >= 5,
  );
  assert.ok(
    airport.environment.features.filter((feature) => feature.type === "grass")
      .length >= 50,
  );
  assert.equal(airport.environment.featureStyles["38836969"].levels, 7);
  assert.equal(airport.operations.runways.length, 1);
  assert.equal(airport.stands.length, 15);
  assert.ok(airport.nodes.length > 400);
  assert.deepEqual(
    airport.runwayPresets.map((preset) => preset.id),
    ["west-flow", "east-flow"],
  );

  const sim = new GroundSim(airport, { seed: 1 }),
    departure = sim.planes.find((plane) => plane.direction === "departure");
  assert.deepEqual(
    sim
      .pushbackOptions(departure)
      .map((option) => [option.id, option.mode, option.default]),
    [["self", "self", true]],
  );
  for (const preset of airport.runwayPresets) {
    assert.ok(
      sim.configureRunways(preset.runwayUses, { presetId: preset.id }).ok,
    );
    for (const type of new Set(airport.fleet.arrivalTypes)) {
      sim.planes = [];
      sim.spawnArrival("LCY100", type);
      assert.equal(sim.planes[0].type, type);
      assert.ok(sim.landingOptions(sim.planes[0]).length, type);
    }
  }
});

test("Frankfurt provides real multi-runway geometry and complete routes for its fleet", () => {
  const airport = airportCatalog.find((candidate) => candidate.id === "EDDF");
  assert.ok(airport);
  assert.equal(airport.iata, "FRA");
  assert.deepEqual(airport.views, ["2d", "3d"]);
  assert.deepEqual(airport.towerView, {
    featureId: "129836215",
    structureHeight: 65,
    viewpointHeight: 62,
    heightSource: {
      name: "DFS Frankfurt Tower profile",
      url: "https://karriere.dfs.de/en/air-traffic-controller/a-day-in-the-work-life",
    },
  });
  assert.deepEqual(defaultAirport.views, ["2d", "3d"]);
  assert.equal(airport.cameraViews.length, 6);
  assert.ok(
    airport.environment.features.filter((feature) => feature.type === "water")
      .length >= 50,
  );
  assert.ok(
    airport.environment.features.filter((feature) => feature.type === "wood")
      .length >= 150,
  );
  assert.equal(defaultAirport.cameraViews.length, 4);
  assert.equal(airport.operations.runways.length, 4);
  assert.deepEqual(
    airport.activeRunways.map((runway) => [
      runway.key,
      runway.arrivals,
      runway.departures,
    ]),
    [
      ["07C-25C:25C", false, true],
      ["07L-25R:25R", true, false],
      ["07R-25L:25L", true, false],
      ["18-36:18", false, true],
    ],
  );
  assert.deepEqual(
    airport.runwayPresets.map((preset) => preset.id),
    ["west-flow", "east-flow", "west-reduced", "east-reduced"],
  );
  assert.equal(airport.stands.length, 53);
  assert.deepEqual(
    ["A1", "B46", "C15B", "F231", "V178", "W755A"].filter(
      (id) => !airport.stands.some((stand) => stand.id === id),
    ),
    [],
  );
  assert.ok(airport.nodes.length > 7000);

  const sim = new GroundSim(airport, { seed: 1 });
  sim.planes = [];
  let sequence = 0;
  for (const type of new Set([
    ...airport.fleet.arrivalTypes,
    ...airport.fleet.departureTypes,
  ])) {
    assert.ok(sim.supportedStands(type).length, type + " stand support");
    sim.spawnArrival(`TST${++sequence}`, type);
    const arrival = sim.planes.at(-1);
    assert.equal(arrival.type, type);
    assert.ok(sim.landingOptions(arrival).length, type + " landing exit");
    sim.planes = [];
  }
  for (const preset of airport.runwayPresets) {
    assert.ok(
      sim.configureRunways(preset.runwayUses, { presetId: preset.id }).ok,
    );
    for (const type of new Set(airport.fleet.arrivalTypes)) {
      sim.planes = [];
      sim.spawnArrival(`CFG${++sequence}`, type);
      assert.ok(sim.planes.length, `${preset.id} ${type} arrival runway`);
      assert.ok(
        sim.landingOptions(sim.planes[0]).length,
        `${preset.id} ${type} landing exit`,
      );
    }
  }
});

test("Orlando provides real four-runway geometry and complete north and south flows", () => {
  const airport = airportCatalog.find((candidate) => candidate.id === "KMCO");
  assert.ok(airport);
  assert.equal(airport.iata, "MCO");
  assert.deepEqual(airport.views, ["2d", "3d"]);
  assert.deepEqual(airport.towerView, {
    featureId: "417344833",
    structureHeight: 105.2,
    viewpointHeight: 100,
    heightSource: {
      name: "Greater Orlando Aviation Authority airport history",
      url: "https://web.goaa.aero/airport-business/mcohistory/",
    },
  });
  assert.equal(airport.cameraViews.length, 6);
  assert.ok(
    airport.environment.features.filter((feature) => feature.type === "water")
      .length >= 200,
  );
  assert.ok(
    airport.environment.features.filter((feature) => feature.type === "grass")
      .length >= 100,
  );
  assert.equal(airport.operations.runways.length, 4);
  assert.equal(airport.runwayConfigurations.length, 8);
  assert.equal(airport.operations.runwayCrossings.length, 7);
  assert.equal(airport.stands.length, 50);
  assert.ok(airport.nodes.length > 5000);
  assert.ok(
    airport.features.some(
      (feature) =>
        feature.id === "417344833" && feature.name === "Control Tower",
    ),
  );
  assert.deepEqual(
    airport.runwayPresets.map((preset) => preset.id),
    ["south-flow", "north-flow"],
  );

  const sim = new GroundSim(airport, { seed: 1 });
  sim.planes = [];
  let sequence = 0;
  for (const preset of airport.runwayPresets) {
    assert.equal(preset.runwayUses.length, 4);
    assert.ok(
      sim.configureRunways(preset.runwayUses, { presetId: preset.id }).ok,
    );
    for (const type of new Set(airport.fleet.arrivalTypes)) {
      assert.ok(sim.supportedStands(type).length, `${preset.id} ${type} stand`);
      sim.planes = [];
      sim.spawnArrival(`MCO${++sequence}`, type);
      assert.equal(sim.planes[0].type, type);
      const landingOptions = sim.landingOptions(sim.planes[0]);
      assert.ok(landingOptions.length, `${preset.id} ${type} landing exit`);
      for (const exit of landingOptions) {
        const node = exit.path.at(-1),
          plane = { ...sim.planes[0], node, route: [] },
          stand = airport.stands.find(
            (candidate) =>
              !sim.standReason(plane, candidate.id, {
                occupancy: false,
                controlled: true,
              }),
          );
        assert.ok(stand, `${preset.id} ${type} ${exit.id} stand`);
        assert.ok(
          sim.taxiPlan(plane, stand.node).points.length >= 2,
          `${preset.id} ${type} ${exit.id} staged taxi route`,
        );
      }
    }
  }
});

test("Orlando outer runways connect to the terminal through controlled crossings", () => {
  const airport = airportCatalog.find((candidate) => candidate.id === "KMCO"),
    sim = new GroundSim(airport, { seed: 41 });
  sim.planes = [];
  assert.ok(
    sim.configureRunways([
      {
        runwayId: "18R-36L",
        endId: "18R",
        arrivals: true,
        departures: true,
      },
    ]).ok,
  );

  sim.spawnDeparture("1", "MCO101", "A320");
  const departure = sim.planes[0];
  assert.equal(departure.runwayKey, "18R-36L:18R");
  assert.ok(sim.command(departure.id, "pushback").ok);
  until(sim, departure.id, "ready");
  assert.ok(
    sim.command(departure.id, "taxi", {
      holdingPoint: "12574635363",
    }).ok,
  );
  until(sim, departure.id, "atpoint");
  assert.ok(
    sim.command(departure.id, "cross", {
      crossingId: "18L-36R-B1",
    }).ok,
  );
  until(sim, departure.id, "atpoint");
  assert.ok(sim.command(departure.id, "taxi").ok);
  until(sim, departure.id, "holding");
  assert.equal(departure.node, "12574635361");

  sim.planes = [];
  sim.spawnArrival("MCO202", "A320");
  const arrival = sim.planes[0];
  assert.equal(arrival.runwayKey, "18R-36L:18R");
  assert.ok(sim.command(arrival.id, "land").ok);
  until(sim, arrival.id, "inbound");
  assert.equal(sim.freeStands(arrival).length, 0);
  const stand = sim.freeStands(arrival, { controlled: true })[0];
  assert.ok(stand);
  assert.ok(sim.command(arrival.id, "taxi", { stand: stand.id }).ok);
  assert.equal(arrival.stand, stand.id);
  assert.equal(arrival.taxiTarget, "hold");
  until(sim, arrival.id, "atpoint");
  const crossing = sim.crossingOptions(arrival)[0];
  assert.ok(crossing);
  assert.ok(sim.command(arrival.id, "cross", { crossingId: crossing.id }).ok);
  until(sim, arrival.id, "atpoint");
  assert.ok(sim.command(arrival.id, "taxi", { stand: stand.id }).ok);
  until(sim, arrival.id, "parked");
  assert.equal(arrival.stand, stand.id);
});

test("malformed airport packages fail before a session can start", () => {
  const damage = [
    (p) => p.geometry.nodes.push({ ...p.geometry.nodes[0] }),
    (p) =>
      p.geometry.edges.push({
        a: "missing",
        b: "hold",
        type: "taxiway",
        ref: "Q",
      }),
    (p) =>
      p.geometry.nodes.push({
        id: "isolated",
        x: 0,
        y: 0,
        ref: "",
        hold: false,
      }),
    (p) => (p.geometry.stands[0].path = ["stand-a", "exit"]),
    (p) =>
      (p.operations.runways[0].configurations[0].vacatePath = [
        "exit",
        "north",
      ]),
    (p) => (p.operations.runways[0].releaseDistance = 200),
    (p) => (p.scenario.runwayUses[0].endId = "missing"),
    (p) => p.scenario.departureStands.push("missing"),
    (p) => p.scenario.initialDepartures.push({ stand: "A1", call: "DUP1" }),
    (p) => (p.scenario.traffic.arrivalInterval = 0),
    (p) => (p.operations.map.bounds.maxX = p.operations.map.bounds.minX),
    (p) => (p.geometry.nodes.find((n) => n.id === "apron").x = 3000),
    (p) =>
      (p.towerView = {
        featureId: "missing",
        structureHeight: 50,
        viewpointHeight: 50,
        heightSource: { name: "Test", url: "https://example.com" },
      }),
    (p) =>
      (p.cameraViews = [
        {
          id: "bad-camera",
          label: "Bad camera",
          shortLabel: "BAD",
          position: { x: 1e9, y: 0, height: 10 },
          target: { x: 0, y: 0, height: 0 },
          fov: 45,
        },
      ]),
  ];
  for (const mutate of damage) {
    const p = input();
    mutate(p);
    assert.throws(() => createAirportPackage(p), /Invalid airport package/);
  }
});

test("package inputs are immutable, raw operational fields cannot override curated configuration", () => {
  const p = input();
  p.geometry.departureHold = "missing";
  p.geometry.runway = "99";
  const airport = createAirportPackage(p);
  assert.equal(airport.departureHold, "hold");
  assert.equal(airport.runway, "17");
  assert.throws(() => {
    airport.scenario.traffic.maxActive = 99;
  }, TypeError);
});

test("session saves are separate by airport and restore their own runway clearances", () => {
  const memory = store(),
    airport = createAirportPackage(input());
  const a = new GameSession(airport, { storage: () => memory });
  a.activate();
  assert.ok(a.dispatch(2, "land").ok);
  a.sim.score = 300;
  a.dispose();
  const b = new GameSession(defaultAirport, { storage: () => memory });
  b.activate();
  b.sim.score = 99;
  b.dispose();
  const resumed = new GameSession(airport, { storage: () => memory });
  assert.equal(resumed.restored.status, "restored");
  assert.equal(resumed.sim.score, 300);
  assert.equal(resumed.sim.runwayOwner, null);
  assert.equal(
    resumed.sim.clearedArrivalForRunway(resumed.sim.planes[1]).id,
    2,
  );
  assert.equal(
    new GameSession(defaultAirport, { storage: () => memory }).sim.score,
    99,
  );
});

test("operations/scenario changes are incompatible without discarding the original save", () => {
  const memory = store(),
    airport = createAirportPackage(input());
  const original = new GameSession(airport, { storage: () => memory });
  original.activate();
  const raw = memory.getItem(original.storage.key);
  const changed = input();
  changed.scenario.traffic.arrivalInterval++;
  const newer = new GameSession(createAirportPackage(changed), {
    storage: () => memory,
  });
  assert.equal(newer.restored.status, "invalid");
  assert.equal(newer.activate(), false);
  assert.equal(memory.getItem(original.storage.key), raw);
  assert.ok(newer.restart());
  assert.notEqual(memory.getItem(original.storage.key), raw);
});

test("a declared compatible configuration revision preserves a format-2 game", () => {
  const memory = store(),
    oldAirport = createAirportPackage(input()),
    oldStorage = new GameStorage(oldAirport, () => memory),
    oldSim = new GroundSim(oldAirport);
  oldSim.time = 432;
  oldSim.score = 77;
  assert.ok(oldStorage.save(oldSim, { paused: true }));

  const changed = input();
  changed.scenario.traffic.approachSeconds = 360;
  changed.scenario.turnaroundSeconds = 2700;
  changed.scenario.compatibleConfigurationRevisions = [
    oldStorage.configurationRevision,
  ];
  const newAirport = createAirportPackage(changed),
    restored = new GroundSim(newAirport),
    result = new GameStorage(newAirport, () => memory).load(restored);
  assert.equal(result.status, "restored");
  assert.equal(restored.time, 432);
  assert.equal(restored.score, 77);
});

test("an audited airport revision preserves a format-2 game after additive runway data", () => {
  const frankfurt = airportCatalog.find((airport) => airport.id === "EDDF"),
    memory = store(),
    storage = new GameStorage(frankfurt, () => memory),
    original = new GroundSim(frankfurt, { seed: 31 });
  original.time = 765;
  original.score = 123;
  assert.ok(storage.save(original, { paused: true }));

  const raw = JSON.parse(memory.getItem(storage.key));
  raw.revision = "fc070b4c";
  raw.configurationRevision = "c5656fd2";
  delete raw.simulation.runwayUses;
  delete raw.simulation.runwayPresetId;
  delete raw.simulation.runwayTransition;
  memory.setItem(storage.key, JSON.stringify(raw));

  const restored = new GroundSim(frankfurt),
    result = storage.load(restored);
  assert.equal(result.status, "restored");
  assert.equal(restored.time, 765);
  assert.equal(restored.score, 123);
  assert.deepEqual(restored.runwayUses(), frankfurt.scenario.runwayUses);
});

test("map and weather-only edits do not invalidate operational saves", () => {
  const changed = structuredClone(defaultAirport);
  changed.operations.map.labels[0].text = "Updated label";
  changed.scenario.weather.wind = "Calm";
  assert.equal(
    configurationRevision(changed),
    configurationRevision(defaultAirport),
  );
});

test("unsupported runway crossings cannot enter a playable airport package", () => {
  const p = input();
  p.geometry.nodes.push({
    id: "west",
    x: 2700,
    y: -4850,
    ref: "",
    hold: false,
  });
  p.geometry.edges.push({ a: "apron", b: "west", type: "taxiway", ref: "BAD" });
  assert.throws(() => createAirportPackage(p), /unprotected runway crossing/);
});

test("shared runtime and importer contain no bundled-airport operating constants", () => {
  for (const file of [
    "src/sim.js",
    "src/app.js",
    "src/map.js",
    "src/ui/airport.js",
    "src/session/game-session.js",
    "scripts/import-airport.mjs",
    "web/index.html",
  ]) {
    const source = fs.readFileSync(
      new URL("../" + file, import.meta.url),
      "utf8",
    );
    assert.doesNotMatch(
      source,
      /Frankfurt|London City|EDDF|EGLC|\bM34\b|["'](?:09|27)["']/,
      file,
    );
  }
});
