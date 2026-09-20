import { createAirportPackage } from "../../src/airports/package.js";
import { syntheticInput } from "./synthetic-airport.js";
const second = structuredClone(syntheticInput);
second.geometry.id = "TEST2";
second.geometry.iata = "TS2";
second.geometry.name = "South Field";
second.operations.groundName = "South Field Ground";
export const airportCatalog = [
  createAirportPackage(structuredClone(syntheticInput)),
  createAirportPackage(second),
];
export const defaultAirport = airportCatalog[0];
