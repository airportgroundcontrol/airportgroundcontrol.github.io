import test from "node:test";
import assert from "node:assert/strict";
import { GroundSim } from "../src/sim.js";
import { GameSession } from "../src/session/game-session.js";
import { nextRandomState, validSeed } from "../src/session/random.js";
import { defaultAirport } from "../src/airports/catalog.js";
import { createAirportPackage } from "../src/airports/package.js";
import { aircraftType } from "../src/aircraft/catalog.js";
import { captureSimulation, restoreSimulation } from "../src/persistence.js";
import { syntheticInput } from "./fixtures/synthetic-airport.js";

const snapshot = (sim) => JSON.parse(JSON.stringify(captureSimulation(sim)));
const advance = (sim, seconds) => {
  for (let i = 0; i < Math.round(seconds / 0.05); i++) sim.tick(0.05);
};
const within = (value, base, spread) =>
  assert.ok(
    value >= base * (1 - spread) - 1e-8 && value <= base * (1 + spread) + 1e-8,
    `${value} outside ${base} +/- ${spread}`,
  );

test("seed generator has a stable sequence and rejects invalid engine seeds", () => {
  let state = 1;
  assert.deepEqual(
    Array.from({ length: 5 }, () => (state = nextRandomState(state))),
    [270369, 67634689, 2647435461, 307599695, 2398689233],
  );
  for (const seed of [0, -1, 1.5, NaN, Infinity, 0x100000000, "42", null]) {
    assert.equal(validSeed(seed), false);
    assert.throws(() => new GroundSim(defaultAirport, { seed }), /seed/);
  }
  assert.ok(validSeed(0xffffffff));
});

test("new-game seeds vary counts, callsigns, weighted types, compatible stands and ETAs", () => {
  const sim = new GroundSim(defaultAirport);
  const counts = new Set(),
    types = new Set(),
    stands = new Set(),
    rosters = new Set();
  let seed = 0xabcdef01;
  for (let run = 0; run < 80; run++) {
    sim.reset((seed = nextRandomState(seed)));
    const departures = sim.planes.filter((p) => p.direction === "departure");
    const arrivals = sim.planes.filter((p) => p.direction === "arrival");
    assert.ok(departures.length >= 2 && departures.length <= 4);
    assert.ok(arrivals.length >= 1 && arrivals.length <= 2);
    assert.equal(
      new Set(sim.planes.map((p) => p.call)).size,
      sim.planes.length,
    );
    for (const p of departures) {
      assert.ok(sim.scenario.departureStands.includes(p.stand));
      assert.ok(sim.supportsType(p.type, sim.stands.get(p.stand)));
      assert.equal(sim.standReason(p, p.stand, { route: false }), null);
      stands.add(p.stand);
    }
    for (const p of sim.planes) types.add(p.type);
    within(sim.arrivalETA(arrivals[0]), 360, 0.15);
    if (arrivals[1])
      assert.ok(
        sim.arrivalETA(arrivals[1]) - sim.arrivalETA(arrivals[0]) >= 120 - 1e-8,
      );
    within(sim.nextArrival, 210, 0.25);
    assert.equal(sim.nextDeparture, Infinity);
    counts.add(`${departures.length}:${arrivals.length}`);
    rosters.add(
      JSON.stringify(sim.planes.map((p) => [p.call, p.type, p.stand])),
    );
  }
  assert.equal(counts.size, 6);
  assert.deepEqual(
    types,
    new Set([
      ...defaultAirport.fleet.departureTypes,
      ...defaultAirport.fleet.arrivalTypes,
    ]),
  );
  assert.ok(stands.size > 10);
  assert.equal(rosters.size, 80);
});

test("fleet list repetitions retain their type weighting", () => {
  const sim = new GroundSim(defaultAirport, { seed: 123456789 });
  const counts = {};
  for (let i = 0; i < 6000; i++) {
    const type = sim.pick(defaultAirport.fleet.arrivalTypes);
    counts[type] = (counts[type] || 0) + 1;
  }
  const pool = defaultAirport.fleet.arrivalTypes;
  for (const type of new Set(pool)) {
    const expected =
      (6000 * pool.filter((candidate) => candidate === type).length) /
      pool.length;
    assert.ok(
      counts[type] > expected * 0.8 && counts[type] < expected * 1.2,
      `${type}: ${counts[type]} outside weighted range around ${expected}`,
    );
  }
});

test("same seed reproduces initial and future traffic; save restores the exact PRNG position", () => {
  const a = new GroundSim(defaultAirport, { seed: 91827364 });
  const b = new GroundSim(defaultAirport, { seed: 91827364 });
  assert.deepEqual(snapshot(a), snapshot(b));
  advance(a, 320);
  advance(b, 320);
  assert.deepEqual(snapshot(a), snapshot(b));
  const saved = snapshot(a);
  b.reset(56789);
  assert.ok(restoreSimulation(b, saved));
  advance(a, 1200);
  advance(b, 1200);
  assert.deepEqual(snapshot(a), snapshot(b));
  assert.ok(a.nextId > saved.nextId);
  assert.ok(a.planes.filter((p) => p.direction === "departure").length <= 6);
  assert.ok(a.planes.filter((p) => p.state !== "done").length <= 24);
});

test("automatic traffic adds only arrivals and respects capacity and bounded intervals", () => {
  const sim = new GroundSim(defaultAirport, { seed: 987654321 });
  for (let i = 0; i < 30; i++) {
    const count = sim.planes.length;
    const oldArrival = (sim.nextArrival = sim.time);
    const oldDeparture = (sim.nextDeparture = sim.time);
    sim.tick(0.05);
    within(sim.nextArrival - oldArrival, 210, 0.25);
    assert.equal(sim.nextDeparture, oldDeparture);
    assert.ok(sim.planes.length >= count);
    assert.ok(sim.planes.filter((p) => p.state === "approach").length <= 2);
  }
  const full = structuredClone(defaultAirport);
  full.scenario.traffic.maxActive = sim.planes.length;
  sim.scenario = full.scenario;
  const count = sim.planes.length;
  sim.nextArrival = sim.time;
  sim.tick(0.05);
  assert.equal(sim.planes.length, count);
});

test("random departure generation is limited to a new game's opening roster", () => {
  const sim = new GroundSim(defaultAirport, { seed: 987654321 });
  const initialDepartures = sim.planes
    .filter((p) => p.direction === "departure")
    .map((p) => p.id);
  sim.nextArrival = Infinity;
  sim.nextDeparture = 0;
  advance(sim, 1200);
  assert.deepEqual(
    sim.planes.filter((p) => p.direction === "departure").map((p) => p.id),
    initialDepartures,
  );

  // The helper still fills only compatible free stands for the opening roster.
  sim.planes = [];
  for (let i = 0; i < 40; i++) sim.spawnRandomDeparture();
  const occupied = sim.planes.length;
  sim.spawnRandomDeparture();
  assert.equal(sim.planes.length, occupied);
  assert.ok(occupied > 10);
  for (const p of sim.planes)
    assert.equal(sim.standReason(p, p.stand, { route: false }), null);
});

test("turnaround timing is sampled once and survives a mid-turnaround save", () => {
  const input = structuredClone(syntheticInput);
  input.scenario.turnaroundJitter = 0.25;
  const airport = createAirportPackage(input);
  const sim = new GroundSim(airport, { seed: 7654321 });
  sim.planes = [sim.planes[0]];
  sim.nextArrival = sim.nextDeparture = Infinity;
  const p = sim.planes[0];
  p.state = "taxiin";
  p.direction = "arrival";
  sim.arrive(p);
  within(
    p.turnaroundDuration,
    airport.scenario.turnaroundSeconds *
      aircraftType(p.type).performance.turnaround,
    0.25,
  );
  const randomState = sim.randomState;
  advance(sim, 1);
  assert.equal(sim.randomState, randomState);
  const resumed = new GroundSim(airport);
  assert.ok(restoreSimulation(resumed, snapshot(sim)));
  advance(sim, p.turnaroundDuration + 1);
  advance(resumed, p.turnaroundDuration + 1);
  assert.equal(p.state, "gate");
  assert.deepEqual(snapshot(sim), snapshot(resumed));
});

test("session restart uses fresh entropy, reload and read-only snapshots never reshuffle traffic", () => {
  const entries = new Map();
  const memory = {
    getItem: (k) => entries.get(k) ?? null,
    setItem: (k, v) => entries.set(k, v),
  };
  const seeds = [1234567, 9876543];
  const session = new GameSession(defaultAirport, {
    storage: () => memory,
    seedSource: () => seeds.shift(),
    readView: () => ({ paused: true, speed: 4 }),
  });
  session.activate();
  advance(session.sim, 300);
  const before = snapshot(session.sim);
  session.save();
  assert.deepEqual(snapshot(session.sim), before);
  const loaded = new GameSession(defaultAirport, {
    storage: () => memory,
    seed: 42,
  });
  assert.equal(loaded.restored.status, "restored");
  assert.deepEqual(snapshot(loaded.sim), before);
  session.restart();
  assert.equal(session.sim.randomSeed, 9876543);
  assert.notDeepEqual(snapshot(session.sim).planes, before.planes);
  assert.equal(session.sim.time, 0);
});

test("invalid random state is rejected without mutating a live simulation", () => {
  const sim = new GroundSim(defaultAirport);
  const before = snapshot(sim);
  for (const field of ["randomSeed", "randomState"]) {
    for (const value of [undefined, 0, -1, 0x100000000, 2.5, "123"]) {
      const invalid = structuredClone(before);
      invalid[field] = value;
      assert.equal(restoreSimulation(sim, invalid), false);
      assert.deepEqual(snapshot(sim), before);
    }
  }
});

test("airport validation rejects unsafe random ranges and mixed startup definitions", () => {
  for (const mutate of [
    (p) => (p.scenario.traffic.intervalJitter = -0.1),
    (p) => (p.scenario.traffic.approachJitter = 0.8),
    (p) => (p.scenario.turnaroundJitter = "0.2"),
    (p) => {
      p.scenario.traffic.approachSeconds = 10;
      p.scenario.traffic.approachJitter = 0.5;
    },
    (p) =>
      (p.scenario.initialTraffic = { departures: [1, 2], arrivals: [0, 1] }),
    (p) => {
      p.scenario.initialDepartures = [];
      p.scenario.initialArrivals = [];
      p.scenario.initialTraffic = { departures: [2, 1], arrivals: [0, 1] };
    },
    (p) => {
      p.scenario.initialDepartures = [];
      p.scenario.initialArrivals = [];
      p.scenario.initialTraffic = { departures: [0, 1000], arrivals: [0, 1] };
    },
  ]) {
    const input = structuredClone(syntheticInput);
    mutate(input);
    assert.throws(() => createAirportPackage(input), /Invalid airport package/);
  }
});
