import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createAirportPackage } from "../src/airports/package.js";
import { defaultAirport } from "../src/airports/catalog.js";
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
  assert.ok(sim.command(2, "land").ok);
  assert.equal(sim.runwayOwner, 2);
  until(sim, 2, "inbound");
  assert.equal(sim.planes[1].node, "vacated");
  assert.ok(sim.command(2, "taxi", { stand: "B2" }).ok);
  until(sim, 2, "parked");
  assert.equal(sim.score, 50);
  assert.equal(sim.planes.find((p) => p.id === 2).node, "stand-b");
  assert.ok(sim.logs.some((l) => l.text.includes("runway 17")));
  assert.ok(!sim.logs.some((l) => /Edinburgh|D1|runway 24/.test(l.text)));
  until(sim, 2, "gate");
});

test("traffic uses configured intervals, prefixes and nonnumeric stand eligibility", () => {
  const airport = createAirportPackage(input()),
    sim = new GroundSim(airport);
  assert.equal(sim.nextArrival, 75);
  assert.equal(sim.nextDeparture, 90);
  sim.planes = [];
  for (let i = 0; i < 901; i++) sim.tick(0.1);
  assert.equal(sim.planes.find((p) => p.direction === "departure").stand, "B2");
  assert.ok(sim.planes.some((p) => p.call.startsWith("ARR")));
  assert.ok(sim.planes.some((p) => p.call.startsWith("DEP")));
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
    (p) => (p.scenario.activeRunwayEnd = "missing"),
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

test("session saves are separate by airport and restore their own runway occupancy", () => {
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
  assert.equal(resumed.sim.runwayOwner, 2);
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
  assert.equal(memory.getItem(original.storage.key + ":recovery"), raw);
  assert.ok(newer.restart());
  assert.notEqual(memory.getItem(original.storage.key), raw);
});

test("legacy saves are accepted only by the pinned compatible airport/scenario", () => {
  const raw = fs.readFileSync(
    new URL("./fixtures/v1/taxi.json", import.meta.url),
    "utf8",
  );
  const memory = store();
  memory.setItem("ground-control:save:EGPH", raw);
  const session = new GameSession(defaultAirport, { storage: () => memory });
  assert.equal(session.restored.status, "restored");
  assert.deepEqual(
    JSON.parse(JSON.stringify(captureSimulation(session.sim))),
    JSON.parse(raw).simulation,
  );
  session.activate();
  const upgraded = JSON.parse(memory.getItem(session.storage.key));
  assert.equal(
    upgraded.configurationRevision,
    configurationRevision(defaultAirport),
  );
  assert.equal(upgraded.version, 1);
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
