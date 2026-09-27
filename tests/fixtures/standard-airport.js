import geometry from "../../data/airports/eglc/geometry.json" with { type: "json" };
import operations from "../../data/airports/eglc/operations.json" with { type: "json" };
import scenario from "../../data/airports/eglc/scenario.json" with { type: "json" };
import fleet from "../../data/airports/eglc/fleet.json" with { type: "json" };
import { createAirportPackage } from "../../src/airports/package.js";

// Scripted traffic belongs only in regression fixtures, not in the live catalog.
const scripted = structuredClone(scenario);
const fixtureOperations = structuredClone(operations);
delete fixtureOperations.pushbacks;
delete scripted.initialTraffic;
scripted.traffic.intervalJitter = 0;
scripted.traffic.approachJitter = 0;
scripted.traffic.approachSeconds = 360;
scripted.turnaroundJitter = 0;
scripted.initialDepartures = [
  { stand: "3", call: "BAW1439" },
  { stand: "8", call: "EZY326" },
  { stand: "21", call: "CFE6624" },
];
scripted.initialArrivals = ["KLM927"];
export const defaultAirport = createAirportPackage({
  geometry,
  operations: fixtureOperations,
  scenario: scripted,
  fleet: {
    ...structuredClone(fleet),
    departureWakeSeconds: { H: { M: 90 }, M: { M: 0 } },
    initialTypes: {
      BAW1439: "E190",
      EZY326: "A223",
      CFE6624: "DH8D",
      KLM927: "E190",
    },
  },
});
export const airportCatalog = [defaultAirport];
