import { statusNames } from "./sim.js";

const version = 1;
const counters = ["time", "score", "completed", "incidents", "nextId"];
const timers = ["nextArrival", "nextDeparture", "nextCleanup"];
const moving = ["pushback", "taxi", "taxiin", "lineup", "landing", "takeoff"];
const runwayStates = ["lineup", "linedup", "landing", "takeoff"];
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

export function captureSimulation(sim) {
  const state = Object.fromEntries(counters.map((key) => [key, sim[key]]));
  for (const key of timers)
    state[key] = sim[key] === Infinity ? null : sim[key];
  return {
    ...state,
    runwayOwner: sim.runwayOwner,
    planes: sim.planes,
    logs: sim.logs,
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
    !Object.hasOwn(statusNames, p.state)
  )
    return false;
  if (
    !["arrival", "departure"].includes(p.direction) ||
    !["x", "y", "angle", "speed", "wait"].every((key) => finite(p[key]))
  )
    return false;
  if (
    p.speed < 0 ||
    p.wait < 0 ||
    typeof p.held !== "boolean" ||
    typeof p.blocked !== "boolean"
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
  if (
    state.runwayOwner !== null &&
    !state.planes.some(
      (p) => p.id === state.runwayOwner && runwayStates.includes(p.state),
    )
  )
    return false;
  if (
    state.planes.some(
      (p) => runwayStates.includes(p.state) && p.id !== state.runwayOwner,
    )
  )
    return false;
  if (
    !Array.isArray(state.logs) ||
    state.logs.length > 40 ||
    !state.logs.every(
      (l) =>
        object(l) &&
        finite(l.time) &&
        text(l.text, 5000) &&
        ["info", "system", "warning", "success"].includes(l.type),
    )
  )
    return false;
  if (
    !Array.isArray(state.conflictPairs) ||
    state.conflictPairs.length > 10000 ||
    !state.conflictPairs.every(
      (p) => typeof p === "string" && /^\d+:\d+$/.test(p),
    )
  )
    return false;

  // Validate everything before touching the live simulation; restore values, never the graph or methods.
  const copy = JSON.parse(JSON.stringify(state));
  for (const key of counters) sim[key] = copy[key];
  for (const key of timers)
    sim[key] = copy[key] === null ? Infinity : copy[key];
  sim.runwayOwner = copy.runwayOwner;
  sim.planes = copy.planes;
  sim.logs = copy.logs;
  sim.conflictPairs = new Set(copy.conflictPairs);
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
    speed: [1, 4, 8].includes(ui.speed) ? ui.speed : 4,
    paused: ui.paused === true,
    filter: ["all", "arrival", "departure"].includes(ui.filter)
      ? ui.filter
      : "all",
    panelVisible: ui.panelVisible !== false,
    labels: ui.labels !== false,
    radioOpen: typeof ui.radioOpen === "boolean" ? ui.radioOpen : null,
    camera,
    planning: ui.planning === true,
    waypoints: Array.isArray(ui.waypoints)
      ? ui.waypoints.filter((id) => sim.nodes.has(id)).slice(0, 500)
      : [],
    destination: sim.stands.has(ui.destination) ? ui.destination : "",
  };
}

export class GameStorage {
  constructor(data, storage = () => globalThis.localStorage) {
    this.storage = storage;
    this.airport = data.id;
    this.revision = airportRevision(data);
    this.key = "ground-control:save:" + data.id;
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
      if (raw.length > 2_000_000) throw new Error("Save too large");
      const saved = JSON.parse(raw);
      if (
        saved.version !== version ||
        saved.airport !== this.airport ||
        saved.revision !== this.revision ||
        !restoreSimulation(sim, saved.simulation)
      )
        throw new Error("Incompatible save");
      return { status: "restored", ui: restoreView(saved.ui, sim) };
    } catch {
      // Keep the original for recovery before replacing an invalid or unsupported save.
      try {
        this.storage().setItem(this.key + ":recovery", raw);
      } catch {
        this.protectOriginal = true;
      }
      return { status: "invalid" };
    }
  }
  save(sim, ui) {
    if (this.protectOriginal) return false;
    try {
      this.storage().setItem(
        this.key,
        JSON.stringify({
          version,
          airport: this.airport,
          revision: this.revision,
          savedAt: Date.now(),
          simulation: captureSimulation(sim),
          ui,
        }),
      );
      return true;
    } catch {
      return false;
    }
  }
}
