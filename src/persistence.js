import { statusNames } from "./sim.js";
import { GroundSim } from "./sim.js";
import { validSeed } from "./session/random.js";
import { distanceToSegment, insideBuilding } from "./aircraft/movement.js";
import {
  aircraftCatalog,
  aircraftCatalogVersion,
  aircraftType,
} from "./aircraft/catalog.js";
import {
  standFit,
  edgeAllows,
  excludedStands,
} from "./aircraft/compatibility.js";

export const saveVersion = 2;
const version = saveVersion;
const counters = ["time", "score", "completed", "incidents", "nextId"];
const timers = ["nextArrival", "nextDeparture", "nextCleanup"];
const moving = [
  "pushback",
  "taxi",
  "taxiin",
  "lineup",
  "landing",
  "takeoff",
  "crossing",
];
const runwayStates = ["lineup", "linedup", "landing", "takeoff", "crossing"];
const object = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const finite = (value) => typeof value === "number" && Number.isFinite(value);
const positiveId = (value) => Number.isSafeInteger(value) && value > 0;
const text = (value, max = 500) =>
  typeof value === "string" && value.length <= max && !/[<>]/.test(value);
const optional = (value, check) =>
  value === undefined || value === null || check(value);
const point = (value, sim) =>
  object(value) &&
  finite(value.x) &&
  finite(value.y) &&
  Math.abs(value.x) < 1_000_000 &&
  Math.abs(value.y) < 1_000_000 &&
  optional(value.id, (id) => {
    const node = sim.nodes.get(id);
    return (
      node &&
      Math.abs(node.x - value.x) < 0.001 &&
      Math.abs(node.y - value.y) < 0.001
    );
  });

export function airportRevision(data) {
  // Hash only simulation-relevant geometry; changes to map decoration need not invalidate a game.
  const source = JSON.stringify([
    data.id,
    data.nodes,
    data.edges,
    data.stands,
    data.runwayStart,
    data.runwayEnd,
    data.departureHold,
    data.departureEntry,
    data.arrivalExit,
  ]);
  let hash = 2166136261;
  for (let i = 0; i < source.length; i++)
    hash = Math.imul(hash ^ source.charCodeAt(i), 16777619);
  return (hash >>> 0).toString(16);
}

export function configurationRevision(data) {
  // Canonical keys make whitespace/property-order-only config edits harmless.
  const canonical = (value) =>
    Array.isArray(value)
      ? value.map(canonical)
      : object(value)
        ? Object.fromEntries(
            Object.keys(value)
              .sort()
              .map((key) => [key, canonical(value[key])]),
          )
        : value;
  const {
    weather,
    clockStartSeconds,
    compatibleAirportRevisions,
    compatibleConfigurationRevisions,
    ...scenario
  } = data.scenario;
  const source = JSON.stringify(
    canonical({
      operations: {
        version: data.operations.version,
        runways: data.operations.runways,
        holdingPoints: data.operations.holdingPoints,
        curveCorridor: data.operations.curveCorridor,
        pushbacks: data.operations.pushbacks,
        runwayCrossings: data.operations.runwayCrossings,
      },
      scenario,
      fleet: data.fleet,
      aircraftCatalogVersion,
      behavior: "ground-v7-runway-configuration",
    }),
  );
  let hash = 2166136261;
  for (let i = 0; i < source.length; i++)
    hash = Math.imul(hash ^ source.charCodeAt(i), 16777619);
  return (hash >>> 0).toString(16);
}

export function captureSimulation(sim) {
  const state = Object.fromEntries(counters.map((key) => [key, sim[key]]));
  for (const key of timers)
    state[key] = sim[key] === Infinity ? null : sim[key];
  return {
    ...state,
    runwayOwner: sim.runwayOwner,
    runwayOwners: Object.fromEntries(sim.runwayOwners),
    randomSeed: sim.randomSeed,
    randomState: sim.randomState,
    lastDeparture: sim.lastDeparture,
    lastDepartures: Object.fromEntries(sim.lastDepartures),
    runwayUses: sim.runwayUses(),
    runwayPresetId: sim.runwayPresetId,
    runwayTransition: sim.runwayTransition,
    planes: sim.planes,
    conflictPairs: [...sim.conflictPairs],
  };
}

function validPlane(p, sim) {
  if (
    !object(p) ||
    !positiveId(p.id) ||
    !text(p.call, 32) ||
    !/^[A-Z0-9-]+$/.test(p.call) ||
    !text(p.type, 32) ||
    !Object.hasOwn(aircraftCatalog, p.type) ||
    !Object.hasOwn(statusNames, p.state)
  )
    return false;
  if (
    !["arrival", "departure"].includes(p.direction) ||
    !["x", "y", "angle", "speed", "wait"].every((key) => finite(p[key]))
  )
    return false;
  if (p.stand && standFit(sim.data, p.stand, p.type)) return false;
  if (
    !optional(p.runwayKey, (key) =>
      sim.data.runwayConfigurations.some((runway) => runway.key === key),
    )
  )
    return false;
  if (
    !optional(p.crossingId, (id) =>
      (sim.data.operations.runwayCrossings || []).some(
        (crossing) => crossing.id === id,
      ),
    )
  )
    return false;
  if (!optional(p.departureStand, (id) => sim.stands.has(id))) return false;
  if (!optional(p.tugRemaining, (n) => finite(n) && n >= 0 && n <= 60))
    return false;
  if (p.state === "disconnect" && !(p.tugRemaining > 0)) return false;
  if (!optional(p.airborne, (value) => typeof value === "boolean"))
    return false;
  if (["approach", "goaround"].includes(p.state) && p.airborne !== true)
    return false;
  if (
    p.airborne &&
    !["approach", "landing", "goaround", "done"].includes(p.state)
  )
    return false;
  if (
    p.airborne &&
    p.state !== "done" &&
    p.speed !== aircraftType(p.type).performance.landing
  )
    return false;
  if (p.state === "goaround" && (!p.route?.length || p.route.length !== 1))
    return false;
  if (!optional(p.exitSpeed, (n) => finite(n) && n > 0 && n <= 15))
    return false;
  if (!optional(p.exitLabel, (n) => text(n, 64))) return false;
  if (!optional(p.pushbackMode, (n) => ["tug", "self"].includes(n)))
    return false;
  if (!optional(p.pushbackOption, (n) => text(n, 64))) return false;
  if (
    !optional(
      p.pushbackPath,
      (route) =>
        Array.isArray(route) &&
        route.length <= 500 &&
        route.every((n) => point(n, sim) && n.id),
    )
  )
    return false;
  if (
    p.speed < 0 ||
    p.wait < 0 ||
    typeof p.held !== "boolean" ||
    typeof p.blocked !== "boolean" ||
    !optional(p.rollingDeparture, (value) => typeof value === "boolean") ||
    (p.rollingDeparture && !["lineup", "takeoff"].includes(p.state))
  )
    return false;
  if (
    !optional(p.node, (id) => sim.nodes.has(id)) ||
    !optional(p.stand, (id) => sim.stands.has(id))
  )
    return false;
  if (
    !Array.isArray(p.route) ||
    p.route.length > 20000 ||
    !p.route.every((n) => point(n, sim))
  )
    return false;
  if (moving.includes(p.state) && (!p.route.length || !finite(p.targetSpeed)))
    return false;
  if (["pushback", "taxi", "taxiin", "lineup", "crossing"].includes(p.state)) {
    const allowedRunway =
      p.state === "lineup"
        ? sim.runwayFor(p).runwayId
        : p.state === "crossing"
          ? (sim.data.operations.runwayCrossings || []).find(
              (crossing) => crossing.id === p.crossingId,
            )?.runwayId
          : null;
    for (let i = 0; i < p.route.length; i++) {
      const n = p.route[i],
        previous = i ? p.route[i - 1].id || p.route[i - 1].edgeTo : p.node;
      if (!n.id) {
        if (n.edgeFrom && n.edgeTo) {
          const a = sim.nodes.get(n.edgeFrom),
            b = sim.nodes.get(n.edgeTo);
          const edge =
            sim.graph.getLink(n.edgeFrom, n.edgeTo) ||
            sim.graph.getLink(n.edgeTo, n.edgeFrom);
          if (
            !a ||
            !b ||
            !edge ||
            !edgeAllows(sim.data, edge.data, p.type) ||
            (previous && previous !== a.id && previous !== b.id) ||
            distanceToSegment(n, a, b) >
              (sim.data.operations.curveCorridor || 3) + 0.01 ||
            insideBuilding(n, sim.data.features) ||
            sim.runwaysAt(n).some((runway) => runway.id !== allowedRunway)
          )
            return false;
          continue;
        }
        const end = sim.nodes.get(p.destination);
        if (
          i !== p.route.length - 1 ||
          !end ||
          Math.hypot(n.x - end.x, n.y - end.y) >
            aircraftType(p.type).length / 2 + 3.1
        )
          return false;
      } else if (previous && previous !== n.id) {
        const edge =
          sim.graph.getLink(previous, n.id) ||
          sim.graph.getLink(n.id, previous);
        if (!edge || !edgeAllows(sim.data, edge.data, p.type)) return false;
      }
      if (sim.runwaysAt(n).some((runway) => runway.id !== allowedRunway))
        return false;
    }
  }
  if (
    ["landing", "takeoff"].includes(p.state) &&
    p.route.some((point) =>
      sim
        .runwaysAt(point)
        .some((runway) => runway.id !== sim.runwayFor(p).runwayId),
    )
  )
    return false;
  if (
    (p.state === "parked" && !finite(p.parkedAt)) ||
    (p.state === "done" && !finite(p.completedAt))
  )
    return false;
  if (["gate", "parked"].includes(p.state) && !sim.stands.has(p.stand))
    return false;
  if (
    p.state === "taxiin" &&
    p.taxiTarget !== "hold" &&
    !sim.stands.has(p.stand)
  )
    return false;
  if (p.state === "landing" && !sim.nodes.has(p.landingExit)) return false;
  if (!optional(p.turnaroundDuration, (n) => finite(n) && n > 0)) return false;
  if (p.state === "parked" && !finite(p.turnaroundDuration)) return false;
  if (p.state === "landing") {
    const runway = sim.runwayFor(p);
    const exits = runway.configuration.arrivalExits || [
      { id: "standard", node: runway.arrivalExit, speed: 7 },
    ];
    if (
      !exits.some(
        (e) =>
          e.id === p.exitLabel &&
          e.node === p.landingExit &&
          e.speed === p.exitSpeed,
      )
    )
      return false;
  }
  for (const key of ["targetSpeed", "travelled", "parkedAt", "completedAt"])
    if (!optional(p[key], (n) => finite(n) && n >= 0)) return false;
  for (const key of ["vacating", "holdReached"])
    if (!optional(p[key], (n) => typeof n === "boolean")) return false;
  for (const key of ["destination", "landingExit"])
    if (!optional(p[key], (id) => sim.nodes.has(id))) return false;
  for (const key of ["clearance", "holdLabel", "trafficWaiting", "taxiTarget"])
    if (!optional(p[key], (n) => text(n))) return false;
  if (p.holdLimit != null) {
    const h = p.holdLimit;
    if (
      !object(h) ||
      !text(h.id) ||
      !text(h.label) ||
      !finite(h.distance) ||
      !finite(h.stopAt) ||
      !point(h.node, sim) ||
      !sim.nodes.has(h.node.id)
    )
      return false;
  }
  if (p.holdReached && (!p.held || !p.holdLimit)) return false;
  if (p.trafficOrder != null) {
    const t = p.trafficOrder;
    if (
      !object(t) ||
      !["follow", "giveway"].includes(t.kind) ||
      !positiveId(t.targetId) ||
      t.targetId === p.id ||
      !point(t.point, sim) ||
      !finite(t.stopAt) ||
      !finite(t.releaseAt) ||
      typeof t.merged !== "boolean"
    )
      return false;
  }
  return true;
}

export function restoreSimulation(sim, state) {
  if (!object(state) || !counters.every((key) => finite(state[key])))
    return false;
  state = JSON.parse(JSON.stringify(state));
  state.runwayUses ||= sim.scenario.runwayUses;
  let activeRunways;
  try {
    activeRunways = sim.resolveRunwayUses(state.runwayUses);
  } catch {
    return false;
  }
  sim.activeRunways = activeRunways;
  sim.supportedStandCache.clear();
  for (const plane of state.planes || [])
    plane.runwayKey ||= sim.activeRunways.find((runway) =>
      plane.direction === "arrival" ? runway.arrivals : runway.departures,
    )?.key;
  state.runwayOwners ||=
    state.runwayOwner == null
      ? {}
      : { [sim.activeRunways[0].runwayId]: state.runwayOwner };
  state.lastDepartures ||=
    state.lastDeparture == null
      ? {}
      : { [sim.activeRunways[0].runwayId]: state.lastDeparture };
  state.runwayPresetId ??= null;
  if (
    !optional(state.runwayPresetId, (id) =>
      sim.data.runwayPresets.some((preset) => preset.id === id),
    )
  )
    return false;
  if (state.runwayTransition != null) {
    const transition = state.runwayTransition;
    const keys = new Set(
      sim.data.runwayConfigurations.flatMap((runway) =>
        ["arrival", "departure"].map((role) => `${runway.key}:${role}`),
      ),
    );
    if (
      !object(transition) ||
      !Array.isArray(transition.roles) ||
      !transition.roles.length ||
      transition.roles.length > 8 ||
      !transition.roles.every((role) => keys.has(role)) ||
      !finite(transition.startedAt) ||
      transition.startedAt < 0 ||
      transition.startedAt > state.time
    )
      return false;
  }
  if (!validSeed(state.randomSeed) || !validSeed(state.randomState))
    return false;
  if (
    state.lastDeparture !== null &&
    (!object(state.lastDeparture) ||
      !Object.hasOwn(aircraftCatalog, state.lastDeparture.type) ||
      !finite(state.lastDeparture.time) ||
      state.lastDeparture.time < 0 ||
      state.lastDeparture.time > state.time)
  )
    return false;
  const runwayIds = new Set(
    sim.data.operations.runways.map((runway) => runway.id),
  );
  if (
    !object(state.lastDepartures) ||
    Object.entries(state.lastDepartures).some(
      ([runwayId, departure]) =>
        !runwayIds.has(runwayId) ||
        !object(departure) ||
        !Object.hasOwn(aircraftCatalog, departure.type) ||
        !finite(departure.time) ||
        departure.time < 0 ||
        departure.time > state.time,
    )
  )
    return false;
  if (
    state.time < 0 ||
    !positiveId(state.nextId) ||
    !["completed", "incidents"].every(
      (key) => Number.isSafeInteger(state[key]) && state[key] >= 0,
    )
  )
    return false;
  if (
    !timers.every(
      (key) => state[key] === null || (finite(state[key]) && state[key] >= 0),
    )
  )
    return false;
  if (
    !Array.isArray(state.planes) ||
    state.planes.length > 100 ||
    !state.planes.every((p) => validPlane(p, sim))
  )
    return false;
  if (
    new Set(state.planes.map((p) => p.id)).size !== state.planes.length ||
    state.planes.some((p) => p.id >= state.nextId)
  )
    return false;
  for (const p of state.planes.filter((p) => p.state !== "done")) {
    for (const id of [p.stand, p.departureStand].filter(Boolean)) {
      const excluded = excludedStands(sim.data, id);
      if (
        state.planes.some(
          (q) =>
            q.id !== p.id &&
            q.state !== "done" &&
            (excluded.has(q.stand) || excluded.has(q.departureStand)),
        )
      )
        return false;
    }
  }
  if (
    state.runwayOwner !== null &&
    !state.planes.some(
      (p) => p.id === state.runwayOwner && runwayStates.includes(p.state),
    )
  )
    return false;
  if (
    !object(state.runwayOwners) ||
    Object.entries(state.runwayOwners).some(
      ([runwayId, owner]) =>
        !runwayIds.has(runwayId) ||
        !state.planes.some(
          (p) => p.id === owner && runwayStates.includes(p.state),
        ),
    )
  )
    return false;
  if (
    state.planes.some((p) => {
      if (!runwayStates.includes(p.state)) return false;
      const runwayId =
        p.state === "crossing"
          ? (sim.data.operations.runwayCrossings || []).find(
              (crossing) => crossing.id === p.crossingId,
            )?.runwayId
          : sim.runwayFor(p).runwayId;
      const owner = state.runwayOwners[runwayId];
      if (p.state === "landing" && p.airborne) return false;
      if (p.state === "lineup" && p.rollingDeparture)
        return (
          owner !== undefined &&
          owner !== p.id &&
          !state.planes.some(
            (plane) => plane.id === owner && runwayStates.includes(plane.state),
          )
        );
      return owner !== p.id;
    })
  )
    return false;
  for (const runwayId of runwayIds) {
    const traffic = state.planes.filter(
      (p) =>
        p.state !== "done" &&
        p.state !== "crossing" &&
        sim.runwayFor(p).runwayId === runwayId,
    );
    if (
      traffic.filter((p) => p.state === "landing" && p.airborne).length > 1 ||
      traffic.filter((p) => p.state === "lineup" && p.rollingDeparture).length >
        1
    )
      return false;
  }
  if (
    !Array.isArray(state.conflictPairs) ||
    state.conflictPairs.length > 10000 ||
    !state.conflictPairs.every(
      (p) => typeof p === "string" && /^\d+:\d+$/.test(p),
    )
  )
    return false;

  // Validate everything before touching the live simulation; restore values, never the graph or methods.
  const copy = state;
  for (const key of counters) sim[key] = copy[key];
  for (const key of timers)
    sim[key] = copy[key] === null ? Infinity : copy[key];
  sim.runwayOwners = new Map(
    Object.entries(copy.runwayOwners).map(([key, value]) => [key, value]),
  );
  sim.randomSeed = copy.randomSeed;
  sim.randomState = copy.randomState;
  sim.lastDepartures = new Map(Object.entries(copy.lastDepartures));
  sim.activeRunways = activeRunways;
  sim.runwayPresetId = copy.runwayPresetId;
  sim.runwayTransition = copy.runwayTransition;
  sim.planes = copy.planes;
  sim.conflictPairs = new Set(copy.conflictPairs);
  sim.updateRunwayTransition();
  return true;
}

export function restoreView(value, sim) {
  const ui = object(value) ? value : {};
  const camera =
    object(ui.camera) &&
    ["x", "y", "zoom"].every((key) => finite(ui.camera[key])) &&
    Math.abs(ui.camera.x) < 100000 &&
    Math.abs(ui.camera.y) < 100000 &&
    ui.camera.zoom >= 0.01 &&
    ui.camera.zoom <= 3
      ? { ...ui.camera }
      : null;
  return {
    selected:
      sim.planes.find((p) => p.id === ui.selected && p.state !== "done")?.id ??
      sim.planes.find((p) => p.state !== "done")?.id ??
      null,
    speed: [1, 4].includes(ui.speed) ? ui.speed : 1,
    paused: ui.paused === true,
    labels: ui.labels !== false,
    camera,
    planning: ui.planning === true,
    waypoints: Array.isArray(ui.waypoints)
      ? ui.waypoints.filter((id) => sim.nodes.has(id)).slice(0, 500)
      : [],
    destination: sim.stands.has(ui.destination) ? ui.destination : "",
    runwayChoice: sim.data.runwayConfigurations.some(
      (runway) => runway.key === ui.runwayChoice,
    )
      ? ui.runwayChoice
      : "",
  };
}

export class GameStorage {
  constructor(data, storage = () => globalThis.localStorage) {
    this.data = data;
    this.storage = storage;
    this.airport = data.id;
    this.revision = airportRevision(data);
    this.configurationRevision = configurationRevision(data);
    this.compatibleAirportRevisions =
      data.scenario.compatibleAirportRevisions || [];
    this.compatibleConfigurationRevisions =
      data.scenario.compatibleConfigurationRevisions || [];
    this.scenario = { id: data.scenario.id, version: data.scenario.version };
    this.operationsVersion = data.operations.version;
    this.key = "ground-control:save:" + data.id;
  }
  decode(raw) {
    if (typeof raw !== "string" || raw.length > 2_000_000)
      throw new Error("Save file too large or unavailable.");
    const saved = JSON.parse(raw);
    if (saved?.version !== version)
      throw new Error(
        "Unsupported save version. Start a new game; old saves are not migrated.",
      );
    if (
      saved.airport !== this.airport ||
      (saved.revision !== this.revision &&
        !this.compatibleAirportRevisions.includes(saved.revision)) ||
      (saved.configurationRevision !== this.configurationRevision &&
        !this.compatibleConfigurationRevisions.includes(
          saved.configurationRevision,
        )) ||
      saved.scenario?.id !== this.scenario.id ||
      saved.scenario?.version !== this.scenario.version ||
      saved.operationsVersion !== this.operationsVersion
    )
      throw new Error("Save belongs to a different airport or configuration.");
    const candidate = new GroundSim(this.data);
    if (!restoreSimulation(candidate, saved.simulation))
      throw new Error("Invalid aircraft or simulation state.");
    return { saved, candidate, ui: restoreView(saved.ui, candidate) };
  }
  encode(sim, ui) {
    return JSON.stringify({
      version,
      airport: this.airport,
      revision: this.revision,
      configurationRevision: this.configurationRevision,
      scenario: this.scenario,
      operationsVersion: this.operationsVersion,
      savedAt: Date.now(),
      simulation: captureSimulation(sim),
      ui,
    });
  }
  reset(sim, ui) {
    const raw = this.encode(sim, ui),
      storage = this.storage();
    // Replace atomically: failed writes leave the current game untouched.
    storage.setItem(this.key, raw);
    this.protectOriginal = false;
    this.lastValidRaw = raw;
  }
  load(sim) {
    let raw;
    try {
      raw = this.storage().getItem(this.key);
    } catch {
      return { status: "unavailable" };
    }
    if (!raw) return { status: "empty" };
    try {
      const { saved } = this.decode(raw);
      restoreSimulation(sim, saved.simulation);
      this.lastValidRaw = raw;
      return { status: "restored", ui: restoreView(saved.ui, sim) };
    } catch (error) {
      this.protectOriginal = true;
      return { status: "invalid", reason: error.message };
    }
  }
  save(sim, ui) {
    if (this.protectOriginal) return false;
    try {
      const raw = this.encode(sim, ui);
      this.storage().setItem(this.key, raw);
      this.lastValidRaw = raw;
      return true;
    } catch {
      return false;
    }
  }
}
