import test from "node:test";
import assert from "node:assert/strict";
import {
  aircraftCatalog,
  aircraftType,
  queueSeparation,
} from "../src/aircraft/catalog.js";
import { aircraftPixels } from "../src/aircraft/render.js";
import { advanceSpeed, movementTarget } from "../src/aircraft/movement.js";
import { standFit } from "../src/aircraft/compatibility.js";
import { GroundSim } from "../src/sim.js";
import { defaultAirport } from "./fixtures/standard-airport.js";
import { createAirportPackage } from "../src/airports/package.js";
import { syntheticInput } from "./fixtures/synthetic-airport.js";
import {
  GameStorage,
  captureSimulation,
  restoreSimulation,
} from "../src/persistence.js";
import { GameSession } from "../src/session/game-session.js";
import { acquireWriter } from "../src/session/writer-lease.js";

const memory = () => {
  const entries = new Map();
  return {
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => entries.set(key, value),
  };
};
const setup = () => {
  const sim = new GroundSim(defaultAirport);
  sim.nextArrival = sim.nextDeparture = Infinity;
  return sim;
};
const until = (sim, plane, state) => {
  for (let i = 0; i < 20000 && plane.state !== state; i++) sim.tick(0.05);
  assert.equal(plane.state, state);
};

test("eleven immutable aircraft types have physical dimensions, distinct families and independent wake", () => {
  assert.equal(Object.keys(aircraftCatalog).length, 11);
  assert.equal(aircraftType("AT72").shape, "turboprop");
  assert.equal(aircraftType("AT72").wake, "M");
  assert.equal(aircraftType("A333").wake, "H");
  assert.equal(aircraftType("B748").shape, "largeWidebody");
  assert.equal(aircraftType("DH8D").shape, "turboprop");
  assert.ok(aircraftType("B748").wingspan > aircraftType("B77W").wingspan);
  assert.ok(aircraftType("A333").wingspan > aircraftType("A320").wingspan);
  assert.throws(() => {
    aircraftType("A320").performance.taxi = 100;
  });
  assert.throws(() => aircraftType("UNKNOWN"));
  assert.ok(
    aircraftPixels("A333", 0.2).length > aircraftPixels("AT72", 0.2).length,
  );
  assert.equal(aircraftPixels("A333", 1).length, aircraftType("A333").length);
});

test("widebody stand eligibility and adjacent reservations are enforced by commands", () => {
  const s = setup(),
    p = s.planes.find((p) => p.type === "A333");
  assert.ok(standFit(s.data, "14", p.type));
  assert.equal(standFit(s.data, "1", p.type), null);
  assert.ok(s.command(p.id, "land").ok);
  until(s, p, "inbound");
  assert.match(s.command(p.id, "taxi", { stand: "14" }).message, /Too small/);
  assert.ok(s.command(p.id, "taxi", { stand: "1" }).ok);
  const before = s.planes.length;
  s.spawnDeparture("2", "TEST222", "AT72");
  assert.equal(s.planes.length, before);
  until(s, p, "parked");
  assert.equal(p.stand, "1");
  assert.equal(s.runwayOwner, null);
  p.parkedAt = s.time - p.turnaroundDuration;
  until(s, p, "gate");
  for (const [command, state] of [
    ["pushback", "ready"],
    ["taxi", "holding"],
    ["lineup", "linedup"],
    ["takeoff", "done"],
  ]) {
    assert.ok(s.command(p.id, command).ok, command);
    until(s, p, state);
  }
  assert.equal(s.lastDeparture.type, "A333");
});

test("restricted taxi edges cannot be bypassed through waypoints and unknown stand limits reject", () => {
  const input = structuredClone(syntheticInput);
  input.fleet.routeRules = [{ refs: ["Q"], allowedTypes: ["E190"] }];
  const data = createAirportPackage(input),
    sim = new GroundSim(data);
  assert.equal(sim.path("apron", "hold", false, "A333").length, 0);
  const p = { ...sim.planes[0], type: "A333", node: "apron", route: [] };
  assert.equal(sim.plan(p, "hold", ["mid"]).length, 0);
  assert.equal(
    standFit({ fleet: { standGroups: [] } }, "unknown", "A320"),
    "Stand limits unknown",
  );
});

test("invalid fleet definitions and initial incompatible aircraft are rejected", () => {
  for (const mutate of [
    (p) => {
      p.fleet.arrivalTypes = ["NOPE"];
    },
    (p) => {
      p.fleet.standGroups[0].maxLength = -1;
    },
    (p) => {
      p.fleet.exclusionGroups = [["A1", "missing"]];
    },
    (p) => {
      p.fleet.initialTypes.TST101 = "A333";
      p.fleet.standGroups[0].maxWingspan = 36;
    },
  ]) {
    const input = structuredClone(syntheticInput);
    mutate(input);
    assert.throws(() => createAirportPackage(input));
  }
});

test("tug disconnection holds a departure and persists mid-sequence", () => {
  const s = setup(),
    p = s.planes[0];
  s.command(p.id, "pushback");
  until(s, p, "disconnect");
  assert.match(s.command(p.id, "taxi").message, /tug/);
  const restored = setup();
  assert.ok(restoreSimulation(restored, structuredClone(captureSimulation(s))));
  until(restored, restored.planes[0], "ready");
  assert.ok(restored.command(p.id, "taxi").ok);
});

test("acceleration, braking lookahead and queue spacing depend on type", () => {
  const p = {
    type: "A320",
    speed: 0,
    state: "taxi",
    targetSpeed: 8,
    x: 0,
    y: 0,
    route: [{ x: 100, y: 0 }],
  };
  assert.ok(advanceSpeed(p, 8, 1) < 1);
  assert.ok(advanceSpeed({ ...p, type: "A333" }, 8, 1) < advanceSpeed(p, 8, 1));
  assert.ok(movementTarget(p, 5) < movementTarget(p, 100));
  assert.ok(queueSeparation({ type: "A333" }, p) > queueSeparation(p, p));
});

test("holding stops the nose before the runway holding node", () => {
  const s = setup(),
    p = s.planes[0];
  s.command(p.id, "pushback");
  until(s, p, "ready");
  s.command(p.id, "taxi");
  until(s, p, "holding");
  const node = s.nodes.get(s.data.departureHold);
  assert.ok(
    Math.hypot(p.x - node.x, p.y - node.y) > aircraftType(p.type).length / 2,
  );
  assert.equal(p.speed, 0);
});

test("configured wake delay prevents departure and survives save/reload", () => {
  const s = setup(),
    p = s.planes[0];
  s.command(p.id, "pushback");
  until(s, p, "ready");
  s.command(p.id, "taxi");
  until(s, p, "holding");
  s.command(p.id, "lineup");
  until(s, p, "linedup");
  s.lastDeparture = { type: "A333", time: s.time };
  assert.match(s.command(p.id, "takeoff").message, /Wake separation/);
  const restored = setup();
  assert.ok(restoreSimulation(restored, structuredClone(captureSimulation(s))));
  assert.equal(restored.wakeWait(restored.planes[0]), 90);
  for (let i = 0; i < 901; i++) restored.tick(0.1);
  assert.ok(restored.command(p.id, "takeoff").ok);
});

test("automatic saves overwrite the same local state and remain decodable", () => {
  const m = memory(),
    store = new GameStorage(defaultAirport, () => m),
    sim = setup();
  assert.ok(store.save(sim, {}));
  sim.score = 22;
  assert.ok(store.save(sim, {}));
  const latest = m.getItem(store.key);
  assert.equal(store.decode(latest).candidate.score, 22);
});

test("failed automatic write leaves the current save intact", () => {
  const m = memory(),
    store = new GameStorage(defaultAirport, () => m),
    sim = setup();
  store.save(sim, {});
  const before = m.getItem(store.key);
  const set = m.setItem;
  m.setItem = (key, value) => {
    throw new Error("quota");
  };
  sim.score = 12;
  assert.equal(store.save(sim, {}), false);
  assert.equal(m.getItem(store.key), before);
});

test("fixed-step simulation is equivalent at 1x and 4x", () => {
  const states = [];
  for (const speed of [1, 4]) {
    const session = new GameSession(defaultAirport, {
      seed: 42,
      storage: () => memory(),
    });
    session.speed = speed;
    session.dispatch(1, "pushback");
    for (let i = 0; i < 160 / speed; i++) session.advance(0.1);
    states.push(captureSimulation(session.sim));
  }
  assert.deepEqual(states[0], states[1]);
});

test("writer lock rejects a second writer and releases after closure", async () => {
  let held = false;
  const locks = {
    async request(key, options, fn) {
      if (held) return fn(null);
      held = true;
      try {
        await fn({});
      } finally {
        held = false;
      }
    },
  };
  const first = await acquireWriter("TEST", locks);
  assert.equal(first.status, "owned");
  assert.equal((await acquireWriter("TEST", locks)).status, "busy");
  first.release();
  await new Promise((r) => setTimeout(r, 0));
  const third = await acquireWriter("TEST", locks);
  assert.equal(third.status, "owned");
  third.release();
  assert.equal((await acquireWriter("TEST", null)).status, "unsupported");
});
