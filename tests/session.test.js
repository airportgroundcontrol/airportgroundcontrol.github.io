import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { GameSession } from "../src/session/game-session.js";
const data = JSON.parse(
  fs.readFileSync(
    new URL("../data/airports/egph/geometry.json", import.meta.url),
  ),
);
const memory = () => {
  const entries = new Map();
  return {
    entries,
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => entries.set(key, value),
  };
};

test("session saves successful commands after view cleanup and exposes radio events", () => {
  const store = memory();
  let planning = true;
  const session = new GameSession(data, {
    storage: () => store,
    readView: () => ({ planning }),
    onCommand: (result) => {
      if (result.ok) planning = false;
    },
  });
  session.activate();
  const outcome = session.dispatch(1, "pushback");
  assert.ok(outcome.ok);
  assert.equal(outcome.events.length, 1);
  const saved = JSON.parse(store.getItem(session.storage.key));
  assert.equal(saved.simulation.planes[0].state, "pushback");
  assert.equal(saved.ui.planning, false);
  const before = store.getItem(session.storage.key);
  assert.equal(session.dispatch(1, "land").ok, false);
  assert.equal(store.getItem(session.storage.key), before);
});

test("session owns restoration, pacing, autosave, restart and idempotent disposal", () => {
  const store = memory();
  const session = new GameSession(data, {
    storage: () => store,
    readView: () => ({ paused: session.paused, speed: session.speed }),
  });
  session.activate();
  session.speed = 8;
  session.advance(0.1);
  assert.ok(Math.abs(session.sim.time - 0.8) < 1e-9);
  session.paused = true;
  session.advance(0.1);
  assert.ok(Math.abs(session.sim.time - 0.8) < 1e-9);
  session.autosave(100);
  session.autosave(1100);
  const resumed = new GameSession(data, { storage: () => store });
  assert.equal(resumed.restored.status, "restored");
  assert.equal(resumed.paused, true);
  assert.equal(resumed.speed, 8);
  assert.equal(resumed.sim.time, session.sim.time);
  session.restart();
  assert.equal(session.sim.time, 0);
  session.dispose();
  const before = store.getItem(session.storage.key);
  session.dispose();
  session.advance(0.1);
  session.autosave(9999);
  assert.equal(session.dispatch(1, "pushback").ok, false);
  assert.equal(session.sim.time, 0);
  assert.equal(store.getItem(session.storage.key), before);
});

test("session can keep playing when browser storage is unavailable", () => {
  let warnings = 0;
  const session = new GameSession(data, {
    storage: () => {
      throw new Error("blocked");
    },
    onSaveError: () => warnings++,
  });
  assert.equal(session.restored.status, "unavailable");
  session.activate();
  assert.ok(session.dispatch(1, "pushback").ok);
  session.advance(0.1);
  assert.ok(session.sim.time > 0);
  assert.ok(warnings > 0);
});

test("view callback failure cannot skip persistence of an accepted clearance", () => {
  const store = memory();
  const session = new GameSession(data, {
    storage: () => store,
    onCommand: () => {
      throw new Error("view error");
    },
  });
  session.activate();
  assert.throws(() => session.dispatch(1, "pushback"), /view error/);
  assert.equal(
    JSON.parse(store.getItem(session.storage.key)).simulation.planes[0].state,
    "pushback",
  );
});
