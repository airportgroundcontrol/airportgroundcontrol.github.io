import geometry from "../../data/airports/egph/geometry.json" with { type: "json" };
import operations from "../../data/airports/egph/operations.json" with { type: "json" };
import scenario from "../../data/airports/egph/scenario.json" with { type: "json" };
import fleet from "../../data/airports/egph/fleet.json" with { type: "json" };
import fraGeometry from "../../data/airports/eddf/geometry.json" with { type: "json" };
import fraOperations from "../../data/airports/eddf/operations.json" with { type: "json" };
import fraScenario from "../../data/airports/eddf/scenario.json" with { type: "json" };
import fraFleet from "../../data/airports/eddf/fleet.json" with { type: "json" };
import { createAirportPackage } from "./package.js";

export const airportCatalog = [
  createAirportPackage({ geometry, operations, scenario, fleet }),
  createAirportPackage({
    geometry: fraGeometry,
    operations: fraOperations,
    scenario: fraScenario,
    fleet: fraFleet,
  }),
];
export const defaultAirport = airportCatalog[0];
