// Compile-time boundary vocabulary. JSON must still pass runtime validation.
declare const identity: unique symbol;
type Id<T, Name extends string> = T & { readonly [identity]: Name };
export type AircraftId = Id<number, "AircraftId">;
export type NodeId = Id<string, "NodeId">;
export type StandId = Id<string, "StandId">;
export type AirportId = Id<string, "AirportId">;
export type RunwayId = Id<string, "RunwayId">;
export type RunwayEndId = Id<string, "RunwayEndId">;
export type HoldOptionId = Id<string, "HoldOptionId">;
export type AircraftTypeId = "AT72" | "E190" | "A320" | "B738" | "A333";
export interface AircraftOperations {
  version: 1;
  basis: "game-assumptions";
  arrivalTypes: AircraftTypeId[];
  departureTypes: AircraftTypeId[];
  initialTypes: Record<string, AircraftTypeId>;
  standGroups: { stands: StandId[]; maxLength: number; maxWingspan: number }[];
  exclusionGroups: StandId[][];
  defaultRouteTypes: AircraftTypeId[];
  routeRules: { refs: string[]; allowedTypes: AircraftTypeId[] }[];
  departureWakeSeconds?: Partial<
    Record<"M" | "H", Partial<Record<"M" | "H", number>>>
  >;
}

export interface Point {
  x: number;
  y: number;
}
export interface RoutePoint extends Point {
  edgeFrom?: NodeId;
  edgeTo?: NodeId;
  id?: NodeId;
  hold?: boolean;
  ref?: string;
}
export interface AirportNode extends RoutePoint {
  id: NodeId;
  hold: boolean;
  ref: string;
}
export interface AirportGeometry {
  id: AirportId;
  iata: string;
  name: string;
  country: string;
  center: [number, number];
  source: { name: string; url: string; downloaded: string; license: string };
  features: {
    id: string;
    type: string;
    ref: string;
    name: string;
    width: number;
    closed: boolean;
    points: [number, number][];
  }[];
  nodes: AirportNode[];
  edges: { a: NodeId; b: NodeId; ref: string; type: string }[];
  stands: {
    id: StandId;
    node: NodeId;
    exit: NodeId;
    path: NodeId[];
    heading: number;
  }[];
}
export interface RunwayConfiguration {
  endId: RunwayEndId;
  roles?: ("arrival" | "departure")[];
  departureHold?: NodeId;
  departureEntry?: NodeId;
  arrivalExit?: NodeId;
  vacatePath?: NodeId[];
  arrivalExits?: { id: string; node: NodeId; path: NodeId[]; speed: number }[];
}
export interface PhysicalRunway {
  id: RunwayId;
  label: string;
  protectedHalfWidth: number;
  releaseDistance: number;
  ends: { id: RunwayEndId; label: string; position: Point }[];
  configurations: RunwayConfiguration[];
}
export interface AirportOperations {
  version: 1;
  groundName: string;
  frequency: string;
  runways: PhysicalRunway[];
  runwayCrossings?: {
    id: string;
    label: string;
    runwayId: RunwayId;
    path: NodeId[];
  }[];
  holdingPoints: NodeId[];
  curveCorridor?: number;
  pushbacks?: Record<
    string,
    {
      id: string;
      label: string;
      mode: "tug" | "self";
      types?: AircraftTypeId[];
      path: NodeId[];
    }[]
  >;
  map: {
    bounds: { minX: number; maxX: number; minY: number; maxY: number };
    labels: (Point & { text: string; minZoom: number; color?: string })[];
    mediumZoomStands: StandId[];
  };
}
export interface AirportDefinition extends AirportGeometry {
  operations: AirportOperations;
  scenario: ScenarioDefinition;
  activeRunway: PhysicalRunway;
  configuration: RunwayConfiguration;
  fleet: AircraftOperations | null;
  activeRunways: ActiveRunway[];
  runwayConfigurations: RunwayConfigurationView[];
  runwayPresets: RunwayPreset[];
  runway: string;
  oppositeRunway: string;
  departureHoldLabel: string;
  runwayStart: Point;
  runwayEnd: Point;
  departureEntry: NodeId;
  departureHold: NodeId;
  arrivalExit: NodeId;
}

export interface ActiveRunway {
  key: string;
  runwayId: RunwayId;
  endId: RunwayEndId;
  label: string;
  oppositeLabel: string;
  arrivals: boolean;
  departures: boolean;
  weight: number;
  physical: PhysicalRunway;
  configuration: RunwayConfiguration;
  start: Point;
  end: Point;
  departureHold?: NodeId;
  departureEntry?: NodeId;
  departureHoldLabel?: string;
  arrivalExit?: NodeId;
}

export interface RunwayConfigurationView
  extends Omit<ActiveRunway, "arrivals" | "departures" | "weight"> {
  capabilities: ("arrival" | "departure")[];
}

export interface RunwayUse {
  runwayId: RunwayId;
  endId: RunwayEndId;
  arrivals: boolean;
  departures: boolean;
  weight?: number;
}

export interface RunwayPreset {
  id: string;
  label: string;
  runwayUses: RunwayUse[];
}

export interface ScenarioDefinition {
  id: string;
  version: number;
  compatibleConfigurationRevisions?: string[];
  compatibleAirportRevisions?: string[];
  runwayUses: RunwayUse[];
  runwayPresets?: RunwayPreset[];
  initialDepartures: { stand: StandId; call: string }[];
  initialArrivals: string[];
  initialTraffic?: { departures: [number, number]; arrivals: [number, number] };
  departureStands: StandId[];
  traffic: {
    arrivalInterval: number;
    departureInterval: number;
    maxApproaches: number;
    maxDepartures: number;
    maxActive: number;
    approachSeconds?: number;
    intervalJitter?: number;
    approachJitter?: number;
    approachSeparationSeconds?: number;
    decisionSeconds?: number;
    departurePrefixes: string[];
    arrivalPrefixes: string[];
  };
  turnaroundSeconds: number;
  turnaroundJitter?: number;
  cleanupSeconds: number;
  scoring: { movement: number; goAround: number; conflict: number };
  clockStartSeconds: number;
  weather: { conditions: string; wind: string };
}

export interface HoldLimit {
  id: HoldOptionId;
  label: string;
  distance: number;
  node: AirportNode;
  stopAt: number;
}
export interface TrafficOrder {
  kind: "follow" | "giveway";
  targetId: AircraftId;
  point: Point;
  stopAt: number;
  releaseAt: number;
  merged: boolean;
}
export interface AircraftBase extends Point {
  id: AircraftId;
  call: string;
  type: AircraftTypeId;
  direction: "arrival" | "departure";
  node: NodeId | null;
  stand: StandId | null;
  angle: number;
  route: RoutePoint[];
  speed: number;
  wait: number;
  held: boolean;
  blocked: boolean;
  runwayKey?: string;
  crossingId?: string;
  targetSpeed?: number;
  travelled?: number;
  parkedAt?: number;
  turnaroundDuration?: number;
  completedAt?: number;
  departureStand?: StandId | null;
  tugRemaining?: number;
  vacating?: boolean;
  airborne?: boolean;
  rollingDeparture?: boolean;
  exitSpeed?: number;
  exitLabel?: string;
  pushbackMode?: "tug" | "self";
  pushbackOption?: string;
  pushbackPath?: RoutePoint[] | null;
  destination?: NodeId;
  landingExit?: NodeId;
  clearance?: string;
  holdLabel?: string | null;
  holdReached?: boolean;
  holdLimit?: HoldLimit | null;
  taxiTarget?: "hold" | "stand" | "runway";
  trafficWaiting?: string | null;
  trafficOrder?: TrafficOrder | null;
}
export type AircraftState = AircraftBase &
  (
    | { state: "gate"; stand: StandId }
    | { state: "parked"; stand: StandId; parkedAt: number }
    | { state: "done"; completedAt: number }
    | { state: "disconnect"; tugRemaining: number }
    | { state: "landing"; landingExit: NodeId; targetSpeed: number }
    | {
        state: "pushback" | "taxi" | "lineup" | "takeoff" | "crossing";
        targetSpeed: number;
      }
    | { state: "taxiin"; targetSpeed: number; taxiTarget: "hold" }
    | {
        state: "taxiin";
        targetSpeed: number;
        taxiTarget?: "stand" | "runway";
        stand: StandId;
      }
    | {
        state:
          | "ready"
          | "holding"
          | "linedup"
          | "approach"
          | "goaround"
          | "inbound"
          | "atpoint";
      }
  );

export interface SimulationState {
  randomSeed: number;
  randomState: number;
  time: number;
  score: number;
  completed: number;
  incidents: number;
  nextId: number;
  nextArrival: number;
  nextDeparture: number;
  nextCleanup: number;
  runwayOwner: AircraftId | null;
  runwayOwners?: Record<string, AircraftId>;
  lastDeparture: { type: AircraftTypeId; time: number } | null;
  lastDepartures?: Record<string, { type: AircraftTypeId; time: number }>;
  runwayUses?: RunwayUse[];
  runwayPresetId?: string | null;
  runwayTransition?: { roles: string[]; startedAt: number } | null;
  planes: AircraftState[];
  conflictPairs: Set<string>;
}
export type SavedSimulationV2 = Omit<
  SimulationState,
  "nextArrival" | "nextDeparture" | "nextCleanup" | "conflictPairs"
> & {
  nextArrival: number | null;
  nextDeparture: number | null;
  nextCleanup: number | null;
  conflictPairs: string[];
};
export type Command = { aircraftId: AircraftId } & (
  | {
      action:
        | "hold"
        | "continue"
        | "canceltraffic"
        | "lineup"
        | "takeoff"
        | "rolling"
        | "goaround";
      payload?: never;
    }
  | { action: "cross"; payload: { crossingId: string } }
  | { action: "pushback"; payload?: { pushbackOption?: string } }
  | { action: "land"; payload?: { exitId?: string; runwayKey?: string } }
  | {
      action: "taxi";
      payload?: {
        stand?: StandId;
        waypoints?: NodeId[];
        holdingPoint?: NodeId;
        runwayKey?: string;
      };
    }
  | { action: "holdshort"; payload: { holdPoint: HoldOptionId } }
  | { action: "follow" | "giveway"; payload: { targetId: AircraftId } }
);
export type CommandResult = { ok: true } | { ok: false; message: string };
export type SessionCommandResult = CommandResult;
export interface UiState {
  selected: AircraftId | null;
  speed: 1 | 4;
  paused: boolean;
  labels: boolean;
  camera: (Point & { zoom: number }) | null;
  planning: boolean;
  waypoints: NodeId[];
  destination: StandId | "";
  runwayChoice: string;
}
export interface SaveEnvelope {
  version: 2;
  airport: AirportId;
  revision: string;
  configurationRevision: string;
  scenario: { id: string; version: number };
  operationsVersion: number;
  savedAt: number;
  simulation: SavedSimulationV2;
  ui: Partial<UiState>;
}

// Geometry only needs this narrow view; it also supports synthetic test routes.
export interface TrafficRoute extends Point {
  route: readonly Point[];
  state?: string;
  travelled?: number;
}
export interface RouteSegment {
  start: Point;
  end: Point;
  size: number;
  travelled: number;
}
export interface RouteConflict {
  point: Point;
  distanceA: number;
  distanceB: number;
  alignment: number;
  heading: Point;
}
