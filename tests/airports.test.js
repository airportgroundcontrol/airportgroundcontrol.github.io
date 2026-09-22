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

test("Frankfurt provides real multi-runway geometry and complete routes for its fleet", () => {
  const airport = airportCatalog.find((candidate) => candidate.id === "EDDF");
  assert.ok(airport);
  assert.equal(airport.iata, "FRA");
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

test("the immediately previous production save revision reloads without spawning a departure", () => {
  assert.ok(
    defaultAirport.scenario.compatibleConfigurationRevisions.includes(
      "a87c13b0",
    ),
  );
  const memory = store(),
    storage = new GameStorage(defaultAirport, () => memory),
    original = new GroundSim(defaultAirport),
    before = original.planes.length;
  assert.ok(storage.save(original, { paused: true }));
  const raw = JSON.parse(memory.getItem(storage.key));
  raw.configurationRevision = "a87c13b0";
  raw.simulation.nextArrival = null;
  raw.simulation.nextDeparture = 0;
  memory.setItem(storage.key, JSON.stringify(raw));

  const restored = new GroundSim(defaultAirport),
    result = storage.load(restored);
  assert.equal(result.status, "restored");
  restored.tick(0.05);
  assert.equal(restored.planes.length, before);
  assert.equal(restored.nextDeparture, 0);
});

test("legacy saves are preserved but never migrated", () => {
  const raw = fs.readFileSync(
    new URL("./fixtures/v1/taxi.json", import.meta.url),
    "utf8",
  );
  const memory = store();
  memory.setItem("ground-control:save:EGPH", raw);
  const session = new GameSession(defaultAirport, { storage: () => memory });
  assert.equal(session.restored.status, "invalid");
  assert.equal(session.activate(), false);
  assert.equal(memory.getItem(session.storage.key), raw);
  session.restart();
  const upgraded = JSON.parse(memory.getItem(session.storage.key));
  assert.equal(
    upgraded.configurationRevision,
    configurationRevision(defaultAirport),
  );
  assert.equal(upgraded.version, 2);
  assert.equal(upgraded.revision, airportRevision(defaultAirport));
  const modified = structuredClone(defaultAirport);
  modified.scenario.traffic.arrivalInterval++;
  memory.setItem(session.storage.key, raw);
  assert.equal(
    new GameStorage(modified, () => memory).load(new GroundSim(modified))
      .status,
    "invalid",
  );
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

test("shared runtime and importer have no Edinburgh-specific operating constants", () => {
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
      /Edinburgh|EGPH|\bD1\b|["'](?:06|24)["']/,
      file,
    );
  }
});
