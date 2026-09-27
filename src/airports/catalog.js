import londonGeometry from "../../data/airports/eglc/geometry.json" with { type: "json" };
import londonOperations from "../../data/airports/eglc/operations.json" with { type: "json" };
import londonScenario from "../../data/airports/eglc/scenario.json" with { type: "json" };
import londonFleet from "../../data/airports/eglc/fleet.json" with { type: "json" };
import londonViews from "../../data/airports/eglc/views.json" with { type: "json" };
import londonEnvironment from "../../data/airports/eglc/environment.json" with { type: "json" };
import fraGeometry from "../../data/airports/eddf/geometry.json" with { type: "json" };
import fraOperations from "../../data/airports/eddf/operations.json" with { type: "json" };
import fraScenario from "../../data/airports/eddf/scenario.json" with { type: "json" };
import fraFleet from "../../data/airports/eddf/fleet.json" with { type: "json" };
import fraViews from "../../data/airports/eddf/views.json" with { type: "json" };
import fraEnvironment from "../../data/airports/eddf/environment.json" with { type: "json" };
import orlandoGeometry from "../../data/airports/kmco/geometry.json" with { type: "json" };
import orlandoOperations from "../../data/airports/kmco/operations.json" with { type: "json" };
import orlandoScenario from "../../data/airports/kmco/scenario.json" with { type: "json" };
import orlandoFleet from "../../data/airports/kmco/fleet.json" with { type: "json" };
import orlandoViews from "../../data/airports/kmco/views.json" with { type: "json" };
import orlandoEnvironment from "../../data/airports/kmco/environment.json" with { type: "json" };
import { createAirportPackage } from "./package.js";

export const airportCatalog = [
  createAirportPackage({
    geometry: londonGeometry,
    operations: londonOperations,
    scenario: londonScenario,
    fleet: londonFleet,
    views: ["2d", "3d"],
    towerView: londonViews.tower,
    cameraViews: londonViews.cameras,
    environment: londonEnvironment,
  }),
  createAirportPackage({
    geometry: fraGeometry,
    operations: fraOperations,
    scenario: fraScenario,
    fleet: fraFleet,
    views: ["2d", "3d"],
    towerView: fraViews.tower,
    cameraViews: fraViews.cameras,
    environment: fraEnvironment,
  }),
  createAirportPackage({
    geometry: orlandoGeometry,
    operations: orlandoOperations,
    scenario: orlandoScenario,
    fleet: orlandoFleet,
    views: ["2d", "3d"],
    towerView: orlandoViews.tower,
    cameraViews: orlandoViews.cameras,
    environment: orlandoEnvironment,
  }),
];
export const defaultAirport = airportCatalog[0];
