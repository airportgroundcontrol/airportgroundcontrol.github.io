import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createHash } from "node:crypto";
import { GroundSim } from "../src/sim.js";
import { GameStorage, captureSimulation } from "../src/persistence.js";
import { defaultAirport as data } from "../src/airports/catalog.js";
const directory = new URL("./fixtures/v1/", import.meta.url);
const manifest = JSON.parse(
  fs.readFileSync(new URL("manifest.json", directory)),
);
const hash = (value) => createHash("sha256").update(value).digest("hex");

for (const fixture of manifest.fixtures)
  test(`archived v1: ${fixture.name} is rejected intact without legacy migration`, () => {
    const raw = fs.readFileSync(
      new URL(fixture.name + ".json", directory),
      "utf8",
    );
    assert.equal(hash(raw), fixture.sha256, "Fixture bytes changed");
    const sim = new GroundSim(data);
    const before = JSON.stringify(captureSimulation(sim));
    const entries = new Map([["ground-control:save:EGPH", raw]]);
    const storage = new GameStorage(data, () => ({
      getItem: (key) => entries.get(key),
      setItem: (key, value) => entries.set(key, value),
    }));
    const result = storage.load(sim);
    assert.equal(result.status, "invalid");
    assert.equal(JSON.stringify(captureSimulation(sim)), before);
    assert.equal(storage.save(sim, {}), false);
    assert.equal(entries.get(storage.key), raw);
  });
