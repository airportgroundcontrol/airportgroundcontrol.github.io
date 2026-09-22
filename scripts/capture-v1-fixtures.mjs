// Explicit baseline capture only. Never regenerate fixtures as part of build or test.
import assert from "node:assert/strict";
import fs from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { GroundSim } from "../src/sim.js";
import { GameStorage, captureSimulation } from "../src/persistence.js";

throw new Error(
  "V1 capture is retired. Archived bytes are rejection fixtures; this engine writes format 2 only.",
);

if (!process.argv.includes("--capture"))
  throw new Error("Pass --capture to intentionally replace the baseline.");
const directory = new URL("../tests/fixtures/v1/", import.meta.url);
if (fs.existsSync(directory))
  throw new Error(
    "Archive already exists. Review baseline changes before replacing it.",
  );
import { defaultAirport as data } from "../src/airports/catalog.js";
const baselineCommit = execFileSync("git", ["rev-parse", "HEAD"], {
  encoding: "utf8",
}).trim();
const hash = (value) => createHash("sha256").update(value).digest("hex");
const setup = () => {
  const sim = new GroundSim(data);
  sim.nextArrival = sim.nextDeparture = Infinity;
  return sim;
};
const advance = (sim, id, predicate) => {
  for (
    let tick = 0;
    tick < 8000 && !predicate(sim.planes.find((p) => p.id === id));
    tick++
  )
    sim.tick(0.1);
  assert.ok(
    predicate(sim.planes.find((p) => p.id === id)),
    "Unreached capture state",
  );
};
const command = (sim, id, action, payload) =>
  assert.ok(sim.command(id, action, payload).ok, action);
const manifest = {
  baselineCommit,
  stepSeconds: 0.1,
  continuationTicks: 100,
  fixtures: [],
};
fs.mkdirSync(directory, { recursive: true });
function capture(name, sim, ui = {}) {
  let raw;
  const storage = new GameStorage(data, () => ({
    setItem: (_, value) => {
      raw = value;
    },
  }));
  assert.ok(storage.save(sim, ui));
  const saved = JSON.parse(raw);
  saved.savedAt = 1790000000000;
  const bytes = JSON.stringify(saved, null, 2) + "\n";
  const continuation = new GroundSim(data);
  assert.equal(
    new GameStorage(data, () => ({ getItem: () => bytes })).load(continuation)
      .status,
    "restored",
  );
  for (let tick = 0; tick < manifest.continuationTicks; tick++)
    continuation.tick(manifest.stepSeconds);
  manifest.fixtures.push({
    name,
    sha256: hash(bytes),
    continuedSha256: hash(JSON.stringify(captureSimulation(continuation))),
  });
  fs.writeFileSync(new URL(name + ".json", directory), bytes);
}
const sim = setup();
capture("gate-and-approach", sim);
for (const [action, moving, stopped] of [
  ["pushback", "pushback", "ready"],
  ["taxi", "taxi", "holding"],
  ["lineup", "lineup", "linedup"],
  ["takeoff", "takeoff", "done"],
]) {
  command(sim, 1, action);
  for (let i = 0; i < 20; i++) sim.tick(0.1);
  capture(moving, sim);
  advance(sim, 1, (p) => p.state === stopped);
  capture(stopped, sim);
}
command(sim, 4, "land");
capture("landing", sim);
advance(sim, 4, (p) => p.vacating === true);
capture("vacating", sim);
advance(sim, 4, (p) => p.state === "inbound");
capture("inbound", sim);
command(sim, 4, "taxi", { stand: "14" });
capture("taxiin", sim);
advance(sim, 4, (p) => p.state === "parked");
capture("parked", sim);
const held = setup();
command(held, 1, "pushback");
advance(held, 1, (p) => p.state === "ready");
capture("route-draft", held, {
  selected: 1,
  speed: 8,
  paused: true,
  planning: true,
  waypoints: [data.departureHold],
  destination: "14",
  camera: { x: 30, y: 40, zoom: 0.5 },
});
command(held, 1, "taxi");
for (let i = 0; i < 20; i++) held.tick(0.1);
command(held, 1, "hold");
capture("manual-hold-mid-edge", held);
command(held, 1, "hold");
command(held, 1, "holdshort", {
  holdPoint: held.holdOptions(held.planes[0])[0].id,
});
capture("hold-short-issued", held);
advance(held, 1, (p) => p.holdReached);
capture("hold-short-reached", held);
const point = setup();
command(point, 1, "pushback");
advance(point, 1, (p) => p.state === "ready");
command(point, 1, "taxi", {
  holdingPoint: point.holdingPoints().find((n) => n.ref === "A15").id,
});
advance(point, 1, (p) => p.state === "atpoint");
capture("atpoint", point);
for (const kind of ["follow", "giveway"]) {
  const traffic = setup();
  const plane = (id, x, y, end) => ({
    id,
    call: "TEST" + id,
    type: "A320",
    state: "taxi",
    direction: "departure",
    x,
    y,
    angle: Math.atan2(end.y - y, end.x - x),
    node: null,
    stand: null,
    route: [end],
    targetSpeed: 8,
    speed: 0,
    wait: 0,
    travelled: 0,
    held: false,
    blocked: false,
  });
  traffic.planes = [
    plane(101, 0, 1500, { x: 1200, y: 1500 }),
    kind === "follow"
      ? plane(102, 200, 1500, { x: 1200, y: 1500 })
      : plane(102, 300, 1200, { x: 300, y: 2400 }),
  ];
  traffic.nextId = 103;
  traffic.planes[1].held = true;
  command(traffic, 101, kind, { targetId: 102 });
  capture(kind + "-issued", traffic);
  advance(traffic, 101, (p) => p.trafficWaiting && p.speed < 0.05);
  capture(kind + "-waiting", traffic);
}
fs.writeFileSync(
  new URL("manifest.json", directory),
  JSON.stringify(manifest, null, 2) + "\n",
);
console.log(
  `Captured ${manifest.fixtures.length} synthetic v1 saves from ${baselineCommit}.`,
);
