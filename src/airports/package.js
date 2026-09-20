import { GroundSim } from "../sim.js";
import { routeConflict } from "../traffic.js";

const requireValue = (ok, message) => {
  if (!ok) throw new Error("Invalid airport package: " + message);
};
const finite = (n) => typeof n === "number" && Number.isFinite(n);
const token = (value) =>
  typeof value === "string" && /^[A-Za-z0-9._:-]+$/.test(value);
const text = (value) =>
  typeof value === "string" && value.length <= 500 && !/[<>]/.test(value);
const point = (value) => value && finite(value.x) && finite(value.y);
function unique(values, label) {
  requireValue(
    Array.isArray(values) && values.every(token),
    label + " must contain valid IDs",
  );
  requireValue(new Set(values).size === values.length, "duplicate " + label);
}
function freeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
}

// The legacy geometry file remains byte-for-byte intact. Operational fields in
// the resolved view come only from the selected package/scenario, not that file.
export function createAirportPackage({
  geometry,
  operations,
  scenario,
  compatibility = null,
}) {
  requireValue(
    geometry && operations && scenario,
    "geometry, operations and scenario required",
  );
  requireValue(
    token(geometry.id) &&
      token(geometry.iata) &&
      text(geometry.name) &&
      text(geometry.country),
    "airport identity",
  );
  requireValue(
    geometry.source &&
      text(geometry.source.name) &&
      text(geometry.source.license) &&
      /^https:\/\//.test(geometry.source.url),
    "source attribution",
  );
  for (const key of ["nodes", "edges", "stands", "features"])
    requireValue(Array.isArray(geometry[key]), key + " array required");
  unique(
    geometry.nodes.map((n) => n.id),
    "nodes",
  );
  unique(
    geometry.stands.map((s) => s.id),
    "stands",
  );
  requireValue(
    geometry.nodes.length > 1 && geometry.stands.length > 0,
    "empty ground network",
  );
  const nodes = new Map(geometry.nodes.map((n) => [n.id, n]));
  const stands = new Map(geometry.stands.map((s) => [s.id, s]));
  for (const n of nodes.values())
    requireValue(
      point(n) && typeof n.hold === "boolean" && text(n.ref),
      "node " + n.id,
    );
  const adjacency = new Map([...nodes.keys()].map((id) => [id, new Set()]));
  for (const e of geometry.edges) {
    requireValue(
      nodes.has(e.a) &&
        nodes.has(e.b) &&
        e.a !== e.b &&
        text(e.ref) &&
        token(e.type),
      "edge references",
    );
    requireValue(!adjacency.get(e.a).has(e.b), "duplicate edge");
    adjacency.get(e.a).add(e.b);
    adjacency.get(e.b).add(e.a);
  }
  const connectedPath = (ids) =>
    Array.isArray(ids) &&
    ids.length >= 2 &&
    ids.every((id) => nodes.has(id)) &&
    ids.slice(1).every((id, i) => adjacency.get(ids[i]).has(id));
  for (const s of stands.values())
    requireValue(
      connectedPath(s.path) &&
        s.path[0] === s.exit &&
        s.path.at(-1) === s.node &&
        finite(s.heading),
      "pushback path for " + s.id,
    );
  for (const f of geometry.features)
    requireValue(
      token(f.id) &&
        text(f.type) &&
        text(f.ref) &&
        Array.isArray(f.points) &&
        f.points.every(
          (p) => Array.isArray(p) && p.length === 2 && p.every(finite),
        ),
      "map feature",
    );
  const visited = new Set(),
    pending = [geometry.nodes[0].id];
  while (pending.length) {
    const id = pending.pop();
    if (visited.has(id)) continue;
    visited.add(id);
    pending.push(...[...adjacency.get(id)].filter((id) => !visited.has(id)));
  }
  requireValue(visited.size === nodes.size, "disconnected ground network");
  requireValue(
    operations.version === 1 &&
      text(operations.groundName) &&
      text(operations.frequency),
    "operations metadata",
  );
  requireValue(
    Array.isArray(operations.runways) && operations.runways.length === 1,
    "this engine supports one physical runway",
  );
  const runway = operations.runways[0];
  requireValue(token(runway.id) && text(runway.label), "runway identity");
  requireValue(
    Array.isArray(runway.ends) && runway.ends.length === 2,
    "two runway ends required",
  );
  unique(
    runway.ends.map((e) => e.id),
    "runway ends",
  );
  for (const end of runway.ends)
    requireValue(point(end.position) && token(end.label), "runway threshold");
  requireValue(
    finite(runway.protectedHalfWidth) &&
      runway.protectedHalfWidth > 0 &&
      finite(runway.releaseDistance) &&
      runway.releaseDistance > runway.protectedHalfWidth,
    "runway protection distances",
  );
  requireValue(Array.isArray(runway.configurations), "runway configurations");
  unique(
    runway.configurations.map((c) => c.endId),
    "runway configurations",
  );
  const active = runway.ends.find((e) => e.id === scenario.activeRunwayEnd);
  const opposite = runway.ends.find((e) => e.id !== scenario.activeRunwayEnd);
  const configuration = runway.configurations.find(
    (c) => c.endId === scenario.activeRunwayEnd,
  );
  requireValue(
    active && opposite && configuration,
    "active runway end is not configured",
  );
  requireValue(
    Math.hypot(
      active.position.x - opposite.position.x,
      active.position.y - opposite.position.y,
    ) > 100,
    "runway length",
  );
  unique(operations.holdingPoints, "holding points");
  for (const id of operations.holdingPoints)
    requireValue(
      nodes.get(id)?.hold && nodes.get(id).ref,
      "holding point " + id,
    );
  for (const c of runway.configurations) {
    requireValue(
      runway.ends.some((e) => e.id === c.endId) &&
        operations.holdingPoints.includes(c.departureHold) &&
        nodes.has(c.departureEntry) &&
        nodes.has(c.arrivalExit),
      "runway connections",
    );
    requireValue(
      connectedPath(c.vacatePath) && c.vacatePath[0] === c.arrivalExit,
      "arrival vacate path",
    );
  }
  const bounds = operations.map?.bounds;
  requireValue(
    bounds &&
      Object.values(bounds).every(finite) &&
      bounds.maxX > bounds.minX &&
      bounds.maxY > bounds.minY,
    "map bounds",
  );
  requireValue(
    Array.isArray(operations.map.labels) &&
      operations.map.labels.every(
        (l) => point(l) && text(l.text) && finite(l.minZoom),
      ),
    "map labels",
  );
  unique(operations.map.mediumZoomStands, "map stand labels");
  requireValue(
    operations.map.mediumZoomStands.every((id) => stands.has(id)),
    "map stand reference",
  );
  requireValue(
    token(scenario.id) &&
      Number.isSafeInteger(scenario.version) &&
      scenario.version > 0,
    "scenario identity",
  );
  unique(scenario.departureStands, "departure stands");
  requireValue(
    scenario.departureStands.length &&
      scenario.departureStands.every((id) => stands.has(id)),
    "departure stand eligibility",
  );
  requireValue(
    Array.isArray(scenario.initialDepartures) &&
      Array.isArray(scenario.initialArrivals),
    "initial traffic",
  );
  unique(
    scenario.initialDepartures.map((p) => p.stand),
    "initial stands",
  );
  const calls = [
    ...scenario.initialDepartures.map((p) => p.call),
    ...scenario.initialArrivals,
  ];
  unique(calls, "initial callsigns");
  requireValue(
    calls.every((c) => /^[A-Z0-9-]+$/.test(c)) &&
      scenario.initialDepartures.every((p) => stands.has(p.stand)),
    "initial flights",
  );
  const traffic = scenario.traffic;
  requireValue(
    traffic && scenario.scoring && scenario.weather,
    "scenario settings",
  );
  for (const key of [
    "arrivalInterval",
    "departureInterval",
    "arrivalSpacing",
    "queueSpacing",
    "maxApproaches",
    "maxDepartures",
    "maxActive",
  ])
    requireValue(finite(traffic[key]) && traffic[key] > 0, key);
  requireValue(
    Number.isSafeInteger(traffic.maxActive) &&
      traffic.maxActive <= 100 &&
      calls.length <= traffic.maxActive,
    "traffic capacity",
  );
  for (const key of ["departurePrefixes", "arrivalPrefixes", "departureTypes"])
    requireValue(
      Array.isArray(traffic[key]) &&
        traffic[key].length &&
        traffic[key].every(
          (v) => typeof v === "string" && /^[A-Z0-9-]+$/.test(v),
        ),
      key,
    );
  requireValue(token(traffic.arrivalType), "arrival type");
  for (const key of ["turnaroundSeconds", "goAroundSeconds", "cleanupSeconds"])
    requireValue(finite(scenario[key]) && scenario[key] > 0, key);
  for (const key of ["movement", "goAround", "conflict"])
    requireValue(
      finite(scenario.scoring[key]) && scenario.scoring[key] >= 0,
      "scoring",
    );
  requireValue(
    finite(scenario.clockStartSeconds) &&
      text(scenario.weather.conditions) &&
      text(scenario.weather.wind),
    "scenario display",
  );

  const data = {
    ...geometry,
    operations,
    scenario,
    compatibility,
    activeRunway: runway,
    configuration,
    runway: active.label,
    oppositeRunway: opposite.label,
    runwayStart: active.position,
    runwayEnd: opposite.position,
    departureHold: configuration.departureHold,
    departureEntry: configuration.departureEntry,
    arrivalExit: configuration.arrivalExit,
    departureHoldLabel: nodes.get(configuration.departureHold).ref,
  };
  const sim = new GroundSim(data);
  for (const edge of geometry.edges) {
    const a = nodes.get(edge.a),
      b = nodes.get(edge.b);
    if (
      sim.runwayDistance(a) >= runway.protectedHalfWidth &&
      sim.runwayDistance(b) >= runway.protectedHalfWidth
    ) {
      requireValue(
        !routeConflict(
          { ...a, route: [b] },
          { ...data.runwayStart, route: [data.runwayEnd] },
        ),
        "unprotected runway crossing; explicit crossing support required",
      );
    }
  }
  requireValue(
    sim.runwayDistance(nodes.get(data.departureEntry)) <
      runway.protectedHalfWidth &&
      sim.runwayDistance(nodes.get(data.arrivalExit)) <
        runway.protectedHalfWidth,
    "entry/exit is not on runway",
  );
  requireValue(
    operations.holdingPoints.every(
      (id) => sim.runwayDistance(nodes.get(id)) >= runway.protectedHalfWidth,
    ),
    "holding point is inside protected runway",
  );
  requireValue(
    sim.path(data.departureHold, data.departureEntry, true).length >= 2,
    "unreachable runway entry",
  );
  const vacated = configuration.vacatePath.at(-1);
  requireValue(
    sim.runwayDistance(nodes.get(vacated)) > runway.releaseDistance,
    "arrival does not clear runway",
  );
  for (const s of stands.values()) {
    requireValue(
      sim.path(s.exit, data.departureHold).length >= 2,
      "stand cannot reach departure hold: " + s.id,
    );
    requireValue(
      sim.path(vacated, s.node).length >= 2,
      "arrival cannot reach stand: " + s.id,
    );
    requireValue(
      s.path.every(
        (id) => sim.runwayDistance(nodes.get(id)) >= runway.protectedHalfWidth,
      ),
      "pushback crosses protected runway: " + s.id,
    );
  }
  return freeze(data);
}
