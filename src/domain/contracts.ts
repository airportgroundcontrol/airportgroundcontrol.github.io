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

export interface Point {
  x: number;
  y: number;
}
export interface RoutePoint extends Point {
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
  departureHold: NodeId;
  departureEntry: NodeId;
  arrivalExit: NodeId;
  vacatePath: NodeId[];
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
  holdingPoints: NodeId[];
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
  compatibility: {
    legacyV1: { revision: string; configurationRevision: string };
  } | null;
  runway: string;
  oppositeRunway: string;
  departureHoldLabel: string;
  runwayStart: Point;
  runwayEnd: Point;
  departureEntry: NodeId;
  departureHold: NodeId;
  arrivalExit: NodeId;
}

export interface ScenarioDefinition {
  id: string;
  version: number;
  activeRunwayEnd: RunwayEndId;
  initialDepartures: { stand: StandId; call: string }[];
  initialArrivals: string[];
  departureStands: StandId[];
  traffic: {
    arrivalInterval: number;
    departureInterval: number;
    maxApproaches: number;
    maxDepartures: number;
    maxActive: number;
    arrivalSpacing: number;
    queueSpacing: number;
    departurePrefixes: string[];
    arrivalPrefixes: string[];
    departureTypes: string[];
    arrivalType: string;
  };
  turnaroundSeconds: number;
  goAroundSeconds: number;
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
  type: string;
  direction: "arrival" | "departure";
  node: NodeId | null;
  stand: StandId | null;
  angle: number;
  route: RoutePoint[];
  speed: number;
  wait: number;
  held: boolean;
  blocked: boolean;
  targetSpeed?: number;
  travelled?: number;
  parkedAt?: number;
  completedAt?: number;
  vacating?: boolean;
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
    | { state: "landing"; landingExit: NodeId; targetSpeed: number }
    | { state: "pushback" | "taxi" | "lineup" | "takeoff"; targetSpeed: number }
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
          | "inbound"
          | "atpoint";
      }
  );

// Existing radio-log events, not a new runtime event bus.
export interface SimulationEvent {
  time: number;
  text: string;
  type: "info" | "system" | "warning" | "success";
}
export interface SimulationState {
  time: number;
  score: number;
  completed: number;
  incidents: number;
  nextId: number;
  nextArrival: number;
  nextDeparture: number;
  nextCleanup: number;
  runwayOwner: AircraftId | null;
  planes: AircraftState[];
  logs: SimulationEvent[];
  conflictPairs: Set<string>;
}
export type SavedSimulationV1 = Omit<
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
        | "pushback"
        | "hold"
        | "continue"
        | "canceltraffic"
        | "lineup"
        | "takeoff"
        | "land"
        | "goaround";
      payload?: never;
    }
  | {
      action: "taxi";
      payload?: {
        stand?: StandId;
        waypoints?: NodeId[];
        holdingPoint?: NodeId;
      };
    }
  | { action: "holdshort"; payload: { holdPoint: HoldOptionId } }
  | { action: "follow" | "giveway"; payload: { targetId: AircraftId } }
);
export type CommandResult = { ok: true } | { ok: false; message: string };
export type SessionCommandResult = CommandResult & {
  events: SimulationEvent[];
};
export interface UiState {
  selected: AircraftId | null;
  speed: 1 | 4 | 8;
  paused: boolean;
  filter: "all" | "arrival" | "departure";
  panelVisible: boolean;
  labels: boolean;
  radioOpen: boolean | null;
  camera: (Point & { zoom: number }) | null;
  planning: boolean;
  waypoints: NodeId[];
  destination: StandId | "";
}
export interface SaveEnvelope {
  version: 1;
  airport: AirportId;
  revision: string;
  // Absent only in archived v1 saves admitted by a pinned compatibility entry.
  configurationRevision?: string;
  scenario?: { id: string; version: number };
  operationsVersion?: number;
  savedAt: number;
  simulation: SavedSimulationV1;
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
