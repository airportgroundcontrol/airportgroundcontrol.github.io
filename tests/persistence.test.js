import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { GroundSim } from "../src/sim.js";
import {
  GameStorage,
  captureSimulation,
  restoreSimulation,
  restoreView,
  airportRevision,
} from "../src/persistence.js";
import { defaultAirport as data } from "../src/airports/catalog.js";
const clone = (value) => JSON.parse(JSON.stringify(value));
const memory = () => {
  const entries = new Map();
  return {
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => entries.set(key, value),
  };
};
const setup = () => {
  const s = new GroundSim(data);
  s.nextArrival = s.nextDeparture = Infinity;
  return s;
};
const advance = (s, id, state) => {
  for (
    let i = 0;
    i < 8000 && s.planes.find((p) => p.id === id).state !== state;
    i++
  )
    s.tick(0.1);
  assert.equal(s.planes.find((p) => p.id === id).state, state);
};

test("save restores an active runway, mid-motion aircraft, counters, schedules, logs and conflict Set", () => {
  const s = setup();
  s.command(1, "pushback");
  s.command(4, "land");
  for (let i = 0; i < 50; i++) s.tick(0.1);
  s.score = 125;
  s.completed = 2;
  s.incidents = 1;
  s.conflictPairs.add("1:2");
  const storage = memory(),
    saves = new GameStorage(data, () => storage);
  assert.ok(
    saves.save(s, {
      selected: 4,
      speed: 8,
      paused: true,
      camera: { x: 30, y: 40, zoom: 0.5 },
    }),
  );
  const restored = new GroundSim(data),
    result = saves.load(restored);
  assert.equal(result.status, "restored");
  assert.equal(result.ui.selected, 4);
  assert.equal(result.ui.speed, 8);
  assert.equal(result.ui.paused, true);
  assert.ok(restored.conflictPairs instanceof Set);
  assert.equal(restored.runwayOwner, 4);
  assert.equal(restored.nextArrival, Infinity);
  assert.deepEqual(captureSimulation(restored), captureSimulation(s));
  for (let i = 0; i < 100; i++) {
    restored.tick(0.1);
    s.tick(0.1);
  }
  assert.deepEqual(captureSimulation(restored), captureSimulation(s));
});

test("holding and conditional traffic clearances survive serialization and still execute", () => {
  const s = setup();
  for (const id of [2, 1]) {
    s.command(id, "pushback");
    advance(s, id, "ready");
  }
  s.command(2, "taxi");
  for (let i = 0; i < 250; i++) s.tick(0.1);
  s.command(1, "taxi");
  assert.ok(s.command(1, "follow", { targetId: 2 }).ok);
  assert.ok(
    s.command(1, "holdshort", { holdPoint: s.holdOptions(s.planes[0])[0].id })
      .ok,
  );
  const restored = new GroundSim(data);
  assert.ok(restoreSimulation(restored, clone(captureSimulation(s))));
  assert.equal(restored.planes[0].trafficOrder.targetId, 2);
  assert.deepEqual(restored.planes[0].holdLimit, s.planes[0].holdLimit);
  for (let i = 0; i < 500; i++) {
    restored.tick(0.1);
    s.tick(0.1);
  }
  assert.deepEqual(captureSimulation(restored), captureSimulation(s));
});

test("invalid saves never partially mutate the live simulation", () => {
  for (const damage of [
    (state) => {
      state.planes[0].route = [{ x: 0, y: 0, id: "missing-node" }];
    },
    (state) => {
      state.planes[0].state = "unrecognized";
    },
    (state) => {
      state.planes[0].x = null;
    },
    (state) => {
      state.planes[0].call = 'BAD" onclick="alert(1)';
    },
    (state) => {
      state.planes[1].id = 1;
    },
    (state) => {
      state.runwayOwner = 999;
    },
    (state) => {
      state.nextId = 1;
    },
    (state) => {
      state.time = -1;
    },
    (state) => {
      state.logs[0].text = "<img onerror=alert(1)>";
    },
  ]) {
    const s = setup(),
      before = clone(captureSimulation(s)),
      bad = clone(before);
    damage(bad);
    assert.equal(restoreSimulation(s, bad), false);
    assert.deepEqual(clone(captureSimulation(s)), before);
  }
});

test("corrupt or incompatible saves are retained for recovery", () => {
  for (const corrupt of [
    (raw) => "{bad json",
    (raw) => raw.replace('"version":1', '"version":999'),
    (raw) => raw.replace('"airport":"EGPH"', '"airport":"OTHER"'),
  ]) {
    const store = memory(),
      saves = new GameStorage(data, () => store),
      s = setup();
    saves.save(s, {});
    const bad = corrupt(store.getItem(saves.key));
    store.setItem(saves.key, bad);
    assert.equal(saves.load(s).status, "invalid");
    assert.equal(store.getItem(saves.key + ":recovery"), bad);
  }
});

test("save versions are tied to routing geometry, not visual decoration", () => {
  const changed = clone(data);
  changed.nodes[0].x += 1;
  assert.notEqual(airportRevision(changed), airportRevision(data));
  const cosmetic = clone(data);
  cosmetic.name = "New title";
  cosmetic.features = [];
  assert.equal(airportRevision(cosmetic), airportRevision(data));
  const store = memory(),
    original = new GameStorage(data, () => store);
  original.save(setup(), {});
  assert.equal(
    new GameStorage(changed, () => store).load(new GroundSim(changed)).status,
    "invalid",
  );
});

test("missing state-specific references reject a save before it can fail during a tick", () => {
  const s = setup();
  s.command(4, "land");
  const state = clone(captureSimulation(s));
  delete state.planes[3].landingExit;
  assert.equal(restoreSimulation(new GroundSim(data), state), false);
  const gate = clone(captureSimulation(setup()));
  gate.planes[0].stand = null;
  assert.equal(restoreSimulation(new GroundSim(data), gate), false);
});

test("blocked storage and quota errors do not stop the simulation or destroy an old save", () => {
  const blocked = new GameStorage(data, () => {
    throw new Error("SecurityError");
  });
  assert.equal(blocked.load(setup()).status, "unavailable");
  assert.equal(blocked.save(setup(), {}), false);
  const full = {
    getItem: () => "bad save",
    setItem: () => {
      throw new Error("QuotaExceededError");
    },
  };
  const saves = new GameStorage(data, () => full);
  assert.equal(saves.load(setup()).status, "invalid");
  assert.equal(saves.save(setup(), {}), false);
  assert.equal(full.getItem(), "bad save");
});

test("invalid view preferences fall back safely without discarding the game", () => {
  const s = setup();
  const ui = restoreView(
    {
      selected: 999,
      speed: 999,
      filter: "invalid",
      camera: { x: 1e300, y: 0, zoom: 0 },
      waypoints: ["missing"],
      destination: "missing",
    },
    s,
  );
  assert.equal(ui.selected, 1);
  assert.equal(ui.speed, 4);
  assert.equal(ui.filter, "all");
  assert.equal(ui.camera, null);
  assert.deepEqual(ui.waypoints, []);
  assert.equal(ui.destination, "");
});

test("an explicit restart replaces the saved session", () => {
  const s = setup(),
    memoryStore = memory(),
    store = new GameStorage(data, () => memoryStore);
  s.time = 900;
  s.score = 500;
  store.save(s, {});
  s.reset();
  store.save(s, {});
  const restored = setup();
  assert.equal(store.load(restored).status, "restored");
  assert.equal(restored.time, 0);
  assert.equal(restored.score, 0);
  assert.equal(restored.planes.length, 4);
});

test("snapshots restore every stage of a full departure and arrival cycle", () => {
  const s = setup();
  const check = () => {
    const restored = new GroundSim(data);
    assert.ok(restoreSimulation(restored, clone(captureSimulation(s))));
    assert.deepEqual(captureSimulation(restored), captureSimulation(s));
  };
  check();
  s.command(1, "pushback");
  check();
  advance(s, 1, "ready");
  check();
  s.command(1, "taxi");
  check();
  advance(s, 1, "holding");
  check();
  s.command(1, "lineup");
  check();
  advance(s, 1, "linedup");
  check();
  s.command(1, "takeoff");
  check();
  advance(s, 1, "done");
  check();
  s.command(4, "land");
  check();
  advance(s, 4, "inbound");
  check();
  s.command(4, "taxi", { stand: "14" });
  check();
  advance(s, 4, "parked");
  check();
});
