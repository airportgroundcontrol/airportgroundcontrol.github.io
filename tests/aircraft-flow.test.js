import test from "node:test";
import assert from "node:assert/strict";
import { GroundSim, distance, flightStatus } from "../src/sim.js";
import { defaultAirport } from "./fixtures/standard-airport.js";
import { createAirportPackage } from "../src/airports/package.js";
import { syntheticInput } from "./fixtures/synthetic-airport.js";
import { curvedRoute, distanceToSegment } from "../src/aircraft/movement.js";
import { captureSimulation, restoreSimulation } from "../src/persistence.js";

const setup = (data = defaultAirport) => {
  const sim = new GroundSim(data);
  sim.nextArrival = sim.nextDeparture = Infinity;
  return sim;
};
const advance = (sim, seconds) => {
  for (let i = 0; i < seconds * 20; i++) sim.tick(0.05);
};
const until = (sim, p, state) => {
  for (let i = 0; i < 30000 && p.state !== state; i++) sim.tick(0.05);
  assert.equal(p.state, state);
};
const roundtrip = (sim) => {
  const restored = setup(sim.data);
  assert.ok(
    restoreSimulation(restored, structuredClone(captureSimulation(sim))),
  );
  assert.deepEqual(captureSimulation(restored), captureSimulation(sim));
  return restored;
};

test("uncleared arrivals move continuously, count down, go around once and leave without movement credit", () => {
  const sim = setup(),
    p = sim.planes[3],
    start = { ...p };
  assert.equal(Math.round(sim.arrivalETA(p)), 360);
  advance(sim, 10);
  assert.ok(distance(start, p) > 600);
  assert.ok(Math.abs(sim.arrivalETA(p) - 350) < 0.01);
  roundtrip(sim);
  until(sim, p, "goaround");
  assert.equal(sim.score, -25);
  assert.equal(sim.incidents, 1);
  assert.equal(sim.runwayOwner, null);
  roundtrip(sim);
  const missed = { ...p };
  advance(sim, 2);
  assert.ok(distance(missed, p) > 100);
  until(sim, p, "done");
  assert.equal(sim.score, -25);
  assert.equal(sim.completed, 0);
});

test("successive approaches are spaced by ETA even with different aircraft speeds", () => {
  const sim = setup();
  sim.spawnArrival("ATR100", "AT72");
  assert.ok(
    sim.arrivalETA(sim.planes.at(-1)) - sim.arrivalETA(sim.planes[3]) >= 119.99,
  );
});

test("unavailable stands or an occupied runway never freeze an approaching aircraft", () => {
  const sim = setup(),
    p = sim.planes[3];
  sim.spawnDeparture("1", "FULL100", "A333");
  sim.spawnDeparture("15", "FULL200", "A333");
  assert.match(
    sim.command(p.id, "land").message,
    /No available compatible stand/,
  );
  until(sim, p, "goaround");
  assert.equal(sim.score, -25);
  const other = setup(),
    incoming = other.planes[3];
  other.runwayOwner = 1;
  assert.match(
    other.command(incoming.id, "land").message,
    /not projected clear/,
  );
  until(other, incoming, "goaround");
  assert.equal(other.runwayOwner, 1);
  assert.equal(other.command(incoming.id, "land").ok, false);
});

test("airport validation rejects disconnected exits and unauthorized self-maneuver types", () => {
  const first = structuredClone(syntheticInput);
  first.operations.runways[0].configurations[0].arrivalExits = [
    { id: "bad", node: "exit", path: ["exit", "stand-a"], speed: 7 },
  ];
  assert.throws(() => createAirportPackage(first), /arrival exit/);
  const second = structuredClone(syntheticInput);
  second.operations.pushbacks = {
    A1: [
      {
        id: "self",
        label: "Depart",
        mode: "self",
        types: ["NOPE"],
        path: ["stand-a", "apron"],
      },
    ],
  };
  assert.throws(() => createAirportPackage(second), /pushback aircraft/);
  second.operations.pushbacks.A1[0].types = ["E190"];
  assert.throws(() => createAirportPackage(second), /leave forwards/);
});

test("landing clearance preserves approach speed and touchdown position; go-around can revoke it", () => {
  const sim = setup(),
    p = sim.planes[3],
    pos = { ...p };
  assert.ok(sim.command(p.id, "land").ok);
  assert.equal(distance(pos, p), 0);
  assert.equal(p.speed, pos.speed);
  assert.equal(flightStatus(p), "Cleared to land");
  roundtrip(sim);
  advance(sim, sim.arrivalETA(p) - 1);
  assert.equal(p.airborne, true);
  advance(sim, 1.1);
  assert.equal(p.airborne, false);
  assert.equal(sim.runwayOwner, p.id);
  assert.ok(distance(p, sim.data.runwayStart) < 20);
  const other = setup(),
    a = other.planes[3];
  other.command(a.id, "land");
  assert.ok(other.command(a.id, "goaround").ok);
  assert.equal(other.runwayOwner, null);
  assert.equal(a.state, "goaround");
});

test("anticipated landing clearance uses a departing aircraft's projected runway release", () => {
  const sim = setup(),
    departure = sim.planes[0],
    arrival = sim.planes[3];
  assert.ok(sim.command(departure.id, "pushback").ok);
  until(sim, departure, "ready");
  assert.ok(sim.command(departure.id, "taxi").ok);
  until(sim, departure, "holding");
  assert.ok(sim.command(departure.id, "lineup").ok);
  until(sim, departure, "linedup");
  assert.ok(sim.command(departure.id, "takeoff").ok);
  assert.equal(sim.runwayOwner, departure.id);

  assert.ok(sim.command(arrival.id, "land").ok);
  assert.equal(arrival.state, "landing");
  assert.equal(sim.runwayOwner, departure.id);
  until(sim, departure, "done");
  assert.equal(sim.runwayOwner, null);
  assert.equal(arrival.state, "landing");
  assert.equal(arrival.airborne, true);
});

test("a departure can line up and take off inside a cleared arrival's projected gap", () => {
  const sim = setup(),
    departure = sim.planes[0],
    arrival = sim.planes[3];
  assert.ok(sim.command(arrival.id, "land").ok);
  assert.equal(sim.runwayOwner, null);
  assert.ok(sim.command(departure.id, "pushback").ok);
  until(sim, departure, "ready");
  assert.ok(sim.command(departure.id, "taxi").ok);
  until(sim, departure, "holding");
  assert.ok(sim.command(departure.id, "lineup").ok);
  until(sim, departure, "linedup");
  assert.ok(sim.command(departure.id, "takeoff").ok);
  assert.equal(departure.state, "takeoff");
});

test("rolling departure enters and accelerates without stopping, and survives reload", () => {
  const sim = setup(),
    departure = sim.planes[0],
    arrival = sim.planes[3];
  assert.ok(sim.command(arrival.id, "land").ok);
  assert.ok(sim.command(departure.id, "pushback").ok);
  until(sim, departure, "ready");
  assert.ok(sim.command(departure.id, "taxi").ok);
  until(sim, departure, "holding");
  assert.ok(sim.command(departure.id, "rolling").ok);
  assert.equal(departure.state, "lineup");
  assert.equal(departure.rollingDeparture, true);

  const restored = roundtrip(sim),
    rolling = restored.planes.find((plane) => plane.id === departure.id);
  let linedUp = false;
  for (let i = 0; i < 30000 && rolling.state !== "done"; i++) {
    restored.tick(0.05);
    if (rolling.state === "linedup") linedUp = true;
  }
  assert.equal(rolling.state, "done");
  assert.equal(linedUp, false);
});

test("rolling departure is rejected when a cleared arrival is too close", () => {
  const sim = setup(),
    departure = sim.planes[0],
    arrival = sim.planes[3];
  assert.ok(sim.command(departure.id, "pushback").ok);
  until(sim, departure, "ready");
  assert.ok(sim.command(departure.id, "taxi").ok);
  until(sim, departure, "holding");
  assert.ok(sim.command(arrival.id, "land").ok);
  while (sim.arrivalETA(arrival) > 35) sim.tick(0.1);
  assert.match(
    sim.command(departure.id, "rolling").message,
    /too close for departure/,
  );
  assert.equal(departure.state, "holding");
});

test("an arrival that loses anticipated separation goes around with a controller penalty", () => {
  const sim = setup(),
    departure = sim.planes[0],
    arrival = sim.planes[3];
  assert.ok(sim.command(arrival.id, "land").ok);
  assert.ok(sim.command(departure.id, "pushback").ok);
  until(sim, departure, "ready");
  assert.ok(sim.command(departure.id, "taxi").ok);
  until(sim, departure, "holding");
  assert.ok(sim.command(departure.id, "lineup").ok);
  until(sim, departure, "linedup");
  until(sim, arrival, "goaround");
  assert.equal(sim.score, -45);
  assert.equal(sim.incidents, 1);
});

test("heavy aircraft rejects the short exit; each type decelerates before its selected exit", () => {
  for (const type of ["AT72", "E190", "A320", "B738", "A333"]) {
    const sim = setup();
    sim.planes = [];
    sim.spawnArrival("TEST100", type);
    const p = sim.planes[0];
    if (type === "A333") {
      assert.equal(sim.command(p.id, "land", { exitId: "midfield" }).ok, false);
      assert.equal(sim.runwayOwner, null);
    }
    assert.ok(sim.command(p.id, "land").ok, type);
    for (let i = 0; i < 15000 && !p.vacating; i++) sim.tick(0.05);
    assert.equal(p.vacating, true, type);
    assert.ok(p.speed <= p.exitSpeed + 0.5, `${type}: ${p.speed}`);
    roundtrip(sim);
    until(sim, p, "inbound");
    assert.equal(sim.runwayOwner, null);
  }
});

test("curves retain graph nodes and stay within the configured centerline corridor", () => {
  const points = [
    { id: "a", x: 0, y: 0 },
    { id: "b", x: 80, y: 0 },
    { id: "c", x: 80, y: 80 },
  ];
  const route = curvedRoute(points, 3);
  assert.deepEqual(
    route.filter((p) => p.id),
    points,
  );
  assert.ok(route.some((p) => p.edgeFrom === "a" && Math.abs(p.y) > 0.1));
  for (const p of route.filter((p) => p.edgeFrom)) {
    assert.ok(
      distanceToSegment(
        p,
        points.find((n) => n.id === p.edgeFrom),
        points.find((n) => n.id === p.edgeTo),
      ) <= 3,
    );
  }
  assert.deepEqual(
    curvedRoute(points, 3, () => false),
    points,
  );
});

test("curved-route saves resume mid-turn and reject tampered curve points", () => {
  const sim = setup(),
    p = sim.planes[1];
  assert.ok(sim.command(p.id, "pushback", { pushbackOption: "nose-east" }).ok);
  advance(sim, 35);
  const restored = roundtrip(sim);
  advance(sim, 3);
  advance(restored, 3);
  assert.deepEqual(captureSimulation(restored), captureSimulation(sim));
  const broken = structuredClone(captureSimulation(sim));
  const sample = broken.planes[1].route.find((n) => n.edgeFrom);
  sample.x += 100;
  assert.equal(restoreSimulation(setup(), broken), false);
  until(sim, p, "disconnect");
  assert.equal(p.node, "5715751981");
  roundtrip(sim);
  until(sim, p, "ready");
  assert.equal(p.pushbackPath, null);
});

test("manual Hold brakes without teleporting and rejects rerouting until stationary", () => {
  const sim = setup(),
    p = sim.planes[0];
  sim.command(p.id, "pushback");
  until(sim, p, "ready");
  sim.command(p.id, "taxi");
  advance(sim, 10);
  const speed = p.speed,
    before = { ...p };
  sim.command(p.id, "hold");
  assert.equal(sim.command(p.id, "taxi").ok, false);
  advance(sim, 0.05);
  assert.ok(p.speed < speed && p.speed > 0);
  advance(sim, 10);
  assert.equal(p.speed, 0);
  assert.ok(distance(before, p) > 0);
  roundtrip(sim);
  assert.ok(sim.command(p.id, "taxi").ok);
  roundtrip(sim);
});

test("self-maneuvering requires a configured stand/type option and skips tug disconnection", () => {
  const input = structuredClone(syntheticInput);
  input.operations.pushbacks = {
    A1: [
      {
        id: "self",
        label: "Forward departure",
        mode: "self",
        types: ["E190"],
        path: ["stand-a", "apron"],
      },
    ],
  };
  input.geometry.stands[0].heading = Math.PI / 2;
  const sim = setup(createAirportPackage(input)),
    p = sim.planes[0];
  assert.ok(sim.command(p.id, "pushback", { pushbackOption: "self" }).ok);
  until(sim, p, "ready");
  assert.equal(p.tugRemaining, 0);
  assert.equal(
    setup().command(1, "pushback", { pushbackOption: "self" }).ok,
    false,
  );
});

test("pushback reservations reject an intersecting second maneuver", () => {
  const sim = setup();
  sim.planes = sim.planes.filter((p) => p.id === 1);
  sim.spawnDeparture("1", "TEST200", "E190");
  const other = sim.planes.at(-1);
  assert.ok(sim.command(1, "pushback", { pushbackOption: "nose-north" }).ok);
  assert.equal(
    sim.command(other.id, "pushback", { pushbackOption: "nose-south" }).ok,
    false,
  );
});
