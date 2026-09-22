import type {
  AircraftId,
  NodeId,
  RunwayId,
  RunwayEndId,
  Command,
  AircraftBase,
  AircraftState,
  TrafficOrder,
  SavedSimulationV2,
  SimulationState,
} from "../../src/domain/contracts";
import {
  distanceAhead,
  routeConflict,
  targetCleared,
} from "../../src/traffic.js";

declare const aircraft: AircraftId;
declare const node: NodeId;
declare const runway: RunwayId;
declare const base: AircraftBase;
declare const live: SimulationState;

const taxi: Command = {
  aircraftId: aircraft,
  action: "taxi",
  payload: { waypoints: [node] },
};
const follow: Command = {
  aircraftId: aircraft,
  action: "follow",
  payload: { targetId: aircraft },
};
const landing: AircraftState = {
  ...base,
  state: "landing",
  landingExit: node,
  targetSpeed: 65,
};
distanceAhead(landing, { x: 0, y: 0 });
routeConflict(landing, landing);
targetCleared({ point: landing, releaseAt: 60 }, landing);

const wrongTarget: Command = {
  aircraftId: aircraft,
  action: "follow",
  // @ts-expect-error A node is not an aircraft identifier.
  payload: { targetId: node },
};
// @ts-expect-error Conditional instructions require a target.
const missingTarget: Command = { aircraftId: aircraft, action: "giveway" };
// @ts-expect-error Landing requires a network exit.
const missingExit: AircraftState = {
  ...base,
  state: "landing",
  targetSpeed: 65,
};
// @ts-expect-error A physical runway and its operational end are different resources.
const end: RunwayEndId = runway;
// @ts-expect-error A traffic order requires its target.
const order: TrafficOrder = {
  kind: "follow",
  point: { x: 0, y: 0 },
  stopAt: 1,
  releaseAt: 2,
  merged: false,
};
// @ts-expect-error Live Sets cannot be written directly as a version-2 snapshot.
const saved: SavedSimulationV2 = live;
// @ts-expect-error Geometry needs an actual route, not only a position.
distanceAhead({ x: 0, y: 0 }, { x: 1, y: 1 });
void [taxi, follow, wrongTarget, missingTarget, missingExit, end, order, saved];
