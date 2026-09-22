import geometry from "../../data/airports/egph/geometry.json" with { type: "json" };
import operations from "../../data/airports/egph/operations.json" with { type: "json" };
import scenario from "../../data/airports/egph/scenario.json" with { type: "json" };
import fleet from "../../data/airports/egph/fleet.json" with { type: "json" };
import { createAirportPackage } from "../../src/airports/package.js";

// Scripted traffic belongs only in regression fixtures, not in the live catalog.
const scripted = structuredClone(scenario);
delete scripted.initialTraffic;
scripted.traffic.intervalJitter = 0;
scripted.traffic.approachJitter = 0;
scripted.turnaroundJitter = 0;
scripted.initialDepartures = [
  { stand: "3", call: "BAW1439" },
  { stand: "8", call: "EZY326" },
  { stand: "20", call: "RYR6624" },
];
scripted.initialArrivals = ["KLM927"];
export const defaultAirport = createAirportPackage({
  geometry,
  operations,
  scenario: scripted,
  fleet: {
    ...structuredClone(fleet),
    initialTypes: {
      BAW1439: "E190",
      EZY326: "A320",
      RYR6624: "B738",
      KLM927: "A333",
    },
  },
});
export const airportCatalog = [defaultAirport];
