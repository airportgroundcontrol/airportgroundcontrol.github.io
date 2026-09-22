import test from "node:test";
import assert from "node:assert/strict";
import { createAirportPackage } from "../src/airports/package.js";
import { GroundSim } from "../src/sim.js";
import { captureSimulation, restoreSimulation } from "../src/persistence.js";
import { syntheticInput } from "./fixtures/synthetic-airport.js";

const edge = (a, b, ref = "Q") => ({ a, b, ref, type: "taxiway" });

function multiRunwayInput({ crossing = false } = {}) {
  const input = structuredClone(syntheticInput);
  input.geometry.nodes.push(
    { id: "entry-east", x: 3600, y: -4850, hold: false, ref: "" },
    { id: "hold-east", x: 3450, y: -4850, hold: true, ref: "E1" },
    { id: "exit-east", x: 3600, y: -3500, hold: false, ref: "" },
    { id: "vacated-east", x: 3450, y: -3500, hold: false, ref: "" },
  );
  input.geometry.edges.push(
    edge("apron", "hold-east", "E"),
    edge("hold-east", "entry-east", "E"),
    edge("exit-east", "vacated-east", "E"),
    edge("vacated-east", "north", "E"),
  );
  input.operations.runways.push({
    id: "east",
    label: "18 / 36",
    protectedHalfWidth: 35,
    releaseDistance: 90,
    ends: [
      { id: "southbound", label: "18", position: { x: 3600, y: -5000 } },
      { id: "northbound", label: "36", position: { x: 3600, y: -3000 } },
    ],
    configurations: [
      {
        endId: "southbound",
        departureHold: "hold-east",
        departureEntry: "entry-east",
        arrivalExit: "exit-east",
        vacatePath: ["exit-east", "vacated-east"],
      },
    ],
  });
  input.operations.holdingPoints.push("hold-east");
  input.scenario.runwayUses = [
    {
      runwayId: "north-south",
      endId: "southbound",
      arrivals: false,
      departures: true,
    },
    {
      runwayId: "east",
      endId: "southbound",
      arrivals: true,
      departures: false,
    },
  ];
  input.scenario.traffic.approachSeconds = 600;
  input.scenario.traffic.decisionSeconds = 8;
  if (crossing) {
    const mid = input.geometry.nodes.find((node) => node.id === "mid");
    mid.hold = true;
    mid.ref = "X-E";
    input.geometry.nodes.push(
      { id: "cross-west", x: 2800, y: -4000, hold: true, ref: "X-W" },
      { id: "cross-center", x: 3000, y: -4000, hold: false, ref: "" },
    );
    input.geometry.edges.push(
      edge("cross-west", "cross-center", "X"),
      edge("cross-center", "mid", "X"),
    );
    input.operations.holdingPoints.push("cross-west", "mid");
    input.operations.runwayCrossings = [
      {
        id: "cross-17-35-x",
        label: "Taxiway X",
        runwayId: "north-south",
        path: ["cross-west", "cross-center", "mid"],
      },
    ];
  }
  return input;
}

function advance(sim, plane, state, limit = 300) {
  for (let i = 0; i < limit / 0.25 && plane.state !== state; i++)
    sim.tick(0.25);
  assert.equal(plane.state, state);
}

test("FRA-shaped runway roles assign arrivals and departures independently", () => {
  const data = createAirportPackage(multiRunwayInput());
  const sim = new GroundSim(data, { seed: 7 });
  const departure = sim.planes.find((plane) => plane.direction === "departure");
  const arrival = sim.planes.find((plane) => plane.direction === "arrival");

  assert.equal(sim.runwayFor(departure).runwayId, "north-south");
  assert.equal(sim.runwayFor(arrival).runwayId, "east");
  assert.equal(sim.command(departure.id, "pushback").ok, true);
  advance(sim, departure, "ready");
  assert.equal(sim.command(departure.id, "taxi").ok, true);
  advance(sim, departure, "holding");
  assert.equal(sim.command(departure.id, "lineup").ok, true);
  advance(sim, departure, "linedup");

  assert.equal(sim.ownerForPhysical("north-south"), departure.id);
  assert.equal(sim.command(arrival.id, "land").ok, true);
  assert.equal(sim.ownerForPhysical("east"), null);

  const resumed = new GroundSim(data, { seed: 11 });
  assert.equal(restoreSimulation(resumed, captureSimulation(sim)), true);
  assert.equal(resumed.ownerForPhysical("north-south"), departure.id);
  assert.equal(resumed.ownerForPhysical("east"), null);
  assert.equal(resumed.clearedArrivalForRunway(arrival).id, arrival.id);
});

test("controllers select a routed departure runway and a parallel arrival runway per aircraft", () => {
  const input = multiRunwayInput();
  input.scenario.runwayUses = input.scenario.runwayUses.map((use) => ({
    ...use,
    arrivals: true,
    departures: true,
  }));
  const data = createAirportPackage(input);

  const departureSim = new GroundSim(data, { seed: 23 });
  const departure = departureSim.planes.find(
    (plane) => plane.direction === "departure",
  );
  assert.equal(departureSim.command(departure.id, "pushback").ok, true);
  advance(departureSim, departure, "ready");
  const departureOptions = departureSim.departureRunwayOptions(departure);
  assert.equal(departureOptions.length, 2);
  const departureRunway = departureOptions.find(
    (runway) => runway.key !== departure.runwayKey,
  );
  assert.equal(
    departureSim.command(departure.id, "taxi", {
      runwayKey: departureRunway.key,
    }).ok,
    true,
  );
  assert.equal(departure.runwayKey, departureRunway.key);
  assert.equal(departure.destination, departureRunway.departureHold);

  const arrivalSim = new GroundSim(data, { seed: 29 });
  const arrival = arrivalSim.planes.find(
    (plane) => plane.direction === "arrival",
  );
  const arrivalOptions = arrivalSim.arrivalRunwayOptions(arrival);
  assert.equal(arrivalOptions.length, 2);
  const arrivalRunway = arrivalOptions.find(
    (runway) => runway.key !== arrival.runwayKey,
  );
  const exit = arrivalSim.landingOptions(arrival, arrivalRunway)[0];
  assert.ok(exit);
  assert.equal(
    arrivalSim.command(arrival.id, "land", {
      runwayKey: arrivalRunway.key,
      exitId: exit.id,
    }).ok,
    true,
  );
  assert.equal(arrival.runwayKey, arrivalRunway.key);
  assert.equal(arrival.route[0].x, arrivalRunway.start.x);
  assert.equal(arrival.route[0].y, arrivalRunway.start.y);
});

test("same-format single-runway saves gain a deterministic runway assignment", () => {
  const data = createAirportPackage(structuredClone(syntheticInput));
  const source = new GroundSim(data, { seed: 5 });
  const state = captureSimulation(source);
  delete state.runwayOwners;
  delete state.lastDepartures;
  for (const plane of state.planes) delete plane.runwayKey;

  const resumed = new GroundSim(data, { seed: 6 });
  assert.equal(restoreSimulation(resumed, state), true);
  assert.ok(
    resumed.planes.every(
      (plane) => plane.runwayKey === data.activeRunways[0].key,
    ),
  );
});

test("declared runway crossings reserve and release the physical runway", () => {
  const data = createAirportPackage(multiRunwayInput({ crossing: true }));
  const sim = new GroundSim(data, { seed: 9 });
  const plane = sim.planes.find(
    (candidate) => candidate.direction === "departure",
  );
  const start = sim.nodes.get("cross-west");
  Object.assign(plane, {
    state: "atpoint",
    node: start.id,
    x: start.x,
    y: start.y,
    route: [],
    speed: 0,
  });

  assert.equal(
    sim.command(plane.id, "cross", { crossingId: "cross-17-35-x" }).ok,
    true,
  );
  assert.equal(sim.ownerForPhysical("north-south"), plane.id);
  advance(sim, plane, "atpoint");
  assert.equal(plane.node, "mid");
  assert.equal(sim.ownerForPhysical("north-south"), null);
});

test("runway changes preserve committed traffic, reroute uncommitted departures and survive reload", () => {
  const data = createAirportPackage(multiRunwayInput());
  const sim = new GroundSim(data, { seed: 17 });
  const departure = sim.planes.find((plane) => plane.direction === "departure");
  const arrival = sim.planes.find((plane) => plane.direction === "arrival");
  const oldArrivalRunway = arrival.runwayKey;

  const result = sim.configureRunways([
    {
      runwayId: "north-south",
      endId: "southbound",
      arrivals: true,
      departures: false,
    },
    {
      runwayId: "east",
      endId: "southbound",
      arrivals: false,
      departures: true,
    },
  ]);
  assert.equal(result.ok, true);
  assert.equal(arrival.runwayKey, oldArrivalRunway);
  assert.equal(departure.runwayKey, "east:southbound");
  assert.ok(sim.runwayTransition);

  sim.spawnArrival("TST900", "E190");
  assert.equal(sim.planes.at(-1).runwayKey, "north-south:southbound");

  const resumed = new GroundSim(data, { seed: 3 });
  assert.equal(restoreSimulation(resumed, captureSimulation(sim)), true);
  assert.deepEqual(resumed.runwayUses(), sim.runwayUses());
  assert.deepEqual(resumed.runwayTransition, sim.runwayTransition);

  sim.goAround(arrival);
  sim.tick(0.1);
  assert.equal(sim.runwayTransition, null);
});

test("runway capability rules reject impossible roles", () => {
  const input = multiRunwayInput();
  input.operations.runways[1].configurations[0].roles = ["arrival"];
  const sim = new GroundSim(createAirportPackage(input), { seed: 19 });
  const result = sim.configureRunways([
    {
      runwayId: "north-south",
      endId: "southbound",
      arrivals: true,
      departures: false,
    },
    {
      runwayId: "east",
      endId: "southbound",
      arrivals: false,
      departures: true,
    },
  ]);
  assert.equal(result.ok, false);
  assert.match(result.message, /not available/i);
});
