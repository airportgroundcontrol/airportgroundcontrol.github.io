import test from "node:test";
import assert from "node:assert/strict";
import { GameSession } from "../src/session/game-session.js";
import { captureSimulation } from "../src/persistence.js";
import { createAirportPackage } from "../src/airports/package.js";
import { syntheticInput } from "./fixtures/synthetic-airport.js";

const airport = createAirportPackage(structuredClone(syntheticInput));
const key = "ground-control:save:" + airport.id;
const store = () => {
  const values = new Map([[key, "{incompatible-original"]]);
  return {
    getItem: (k) => values.get(k) ?? null,
    setItem: (k, v) => values.set(k, v),
  };
};

test("an incompatible saved game remains untouched and blocks play until deletion", () => {
  const memory = store();
  const session = new GameSession(airport, {
    storage: () => memory,
    seed: 12345,
  });
  assert.equal(session.restored.status, "invalid");
  assert.ok(session.restored.reason);
  assert.equal(session.awaitingRecovery, true);
  assert.equal(session.paused, true);
  assert.equal(session.activate(), false);
  const before = JSON.stringify(captureSimulation(session.sim));
  session.paused = false;
  session.advance(0.1);
  assert.equal(session.dispatch(1, "pushback").ok, false);
  assert.equal(JSON.stringify(captureSimulation(session.sim)), before);
  assert.equal(memory.getItem(key), "{incompatible-original");
});

test("explicit deletion replaces the incompatible state with an exact new seeded game", () => {
  const memory = store();
  const session = new GameSession(airport, {
    storage: () => memory,
    seed: 12345,
    seedSource: () => 98765,
  });
  session.activate();
  assert.equal(session.restart(), true);
  assert.equal(session.awaitingRecovery, false);
  assert.equal(session.sim.randomSeed, 98765);
  assert.equal(session.dispatch(1, "pushback").ok, true);
  session.advance(0.1);
  session.save();
  const resumed = new GameSession(airport, {
    storage: () => memory,
    seed: 999,
  });
  assert.equal(resumed.restored.status, "restored");
  assert.deepEqual(
    captureSimulation(resumed.sim),
    captureSimulation(session.sim),
  );
});

test("a failed deletion replacement cannot unlock play or mutate the game", () => {
  const memory = store();
  let warnings = 0;
  const session = new GameSession(airport, {
    storage: () => memory,
    seed: 12345,
    seedSource: () => 98765,
    onSaveError: () => warnings++,
  });
  session.activate();
  const before = JSON.stringify(captureSimulation(session.sim));
  const setItem = memory.setItem;
  memory.setItem = () => {
    throw new Error("QuotaExceededError");
  };
  assert.equal(session.restart(), false);
  assert.equal(warnings, 1);
  assert.equal(session.awaitingRecovery, true);
  assert.equal(session.paused, true);
  assert.equal(JSON.stringify(captureSimulation(session.sim)), before);
  assert.equal(memory.getItem(key), "{incompatible-original");
  memory.setItem = setItem;
  assert.equal(session.restart(), true);
});
