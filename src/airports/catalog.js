import geometry from "../../data/airports/egph/geometry.json" with { type: "json" };
import operations from "../../data/airports/egph/operations.json" with { type: "json" };
import scenario from "../../data/airports/egph/scenario.json" with { type: "json" };
import compatibility from "../../data/airports/egph/compatibility.json" with { type: "json" };
import { createAirportPackage } from "./package.js";

export const airportCatalog = [
  createAirportPackage({ geometry, operations, scenario, compatibility }),
];
export const defaultAirport = airportCatalog[0];
