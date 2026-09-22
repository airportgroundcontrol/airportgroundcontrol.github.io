import { GroundSim } from "../sim.js";
import { validateFleet } from "../aircraft/compatibility.js";
import { aircraftCatalog } from "../aircraft/catalog.js";

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
  fleet = null,
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
  if (operations.curveCorridor !== undefined)
    requireValue(
      finite(operations.curveCorridor) &&
        operations.curveCorridor > 0 &&
        operations.curveCorridor <= 5,
      "curve corridor",
    );
  for (const [id, options] of Object.entries(operations.pushbacks || {})) {
    requireValue(stands.has(id) && Array.isArray(options), "pushback stand");
    unique(
      options.map((o) => o.id),
      "pushback choices",
    );
    for (const option of options) {
      requireValue(
        option.id !== "standard" &&
          text(option.label) &&
          ["tug", "self"].includes(option.mode) &&
          connectedPath(option.path) &&
          option.path[0] === stands.get(id).node &&
          (option.mode !== "self" ||
            (Array.isArray(option.types) && option.types.length > 0)),
        "pushback option",
      );
      if (option.types)
        requireValue(
          Array.isArray(option.types) &&
            option.types.every((type) => Object.hasOwn(aircraftCatalog, type)),
          "pushback aircraft types",
        );
      if (option.mode === "self") {
        const a = nodes.get(option.path[0]),
          b = nodes.get(option.path[1]);
        requireValue(
          Math.cos(Math.atan2(b.y - a.y, b.x - a.x) - stands.get(id).heading) >
            0.5,
          "self-maneuver must leave forwards",
        );
      }
    }
  }
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
    Array.isArray(operations.runways) && operations.runways.length > 0,
    "at least one physical runway required",
  );
  unique(
    operations.runways.map((r) => r.id),
    "runways",
  );
  unique(operations.holdingPoints, "holding points");
  const runwayConfigurations = [];
  for (const runway of operations.runways) {
    requireValue(token(runway.id) && text(runway.label), "runway identity");
    requireValue(
      Array.isArray(runway.ends) && runway.ends.length === 2,
      "two runway ends required",
    );
    unique(
      runway.ends.map((e) => e.id),
      "runway ends for " + runway.id,
    );
    for (const end of runway.ends)
      requireValue(point(end.position) && token(end.label), "runway threshold");
    requireValue(
      Math.hypot(
        runway.ends[0].position.x - runway.ends[1].position.x,
        runway.ends[0].position.y - runway.ends[1].position.y,
      ) > 100,
      "runway length",
    );
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
      "runway configurations for " + runway.id,
    );
    for (const c of runway.configurations) {
      requireValue(
        runway.ends.some((e) => e.id === c.endId),
        "runway configuration end",
      );
      if (c.departureHold !== undefined || c.departureEntry !== undefined)
        requireValue(
          operations.holdingPoints.includes(c.departureHold) &&
            nodes.has(c.departureEntry),
          "departure runway connections",
        );
      if (c.arrivalExit !== undefined || c.vacatePath !== undefined)
        requireValue(
          nodes.has(c.arrivalExit) &&
            connectedPath(c.vacatePath) &&
            c.vacatePath[0] === c.arrivalExit,
          "arrival vacate path",
        );
      if (c.arrivalExits) {
        requireValue(
          Array.isArray(c.arrivalExits) && c.arrivalExits.length > 0,
          "arrival exits",
        );
        unique(
          c.arrivalExits.map((e) => e.id),
          "arrival exit IDs for " + runway.id + ":" + c.endId,
        );
        for (const exit of c.arrivalExits)
          requireValue(
            connectedPath(exit.path) &&
              exit.path[0] === exit.node &&
              finite(exit.speed) &&
              exit.speed > 0 &&
              exit.speed <= 15,
            "arrival exit option",
          );
      }
      const roles =
        c.roles ||
        [
          c.arrivalExit !== undefined ? "arrival" : null,
          c.departureHold !== undefined ? "departure" : null,
        ].filter(Boolean);
      requireValue(
        Array.isArray(roles) &&
          roles.length > 0 &&
          roles.every((role) => ["arrival", "departure"].includes(role)) &&
          new Set(roles).size === roles.length,
        "runway roles",
      );
      if (roles.includes("arrival"))
        requireValue(
          nodes.has(c.arrivalExit) && connectedPath(c.vacatePath),
          "arrival-capable runway end is missing an exit",
        );
      if (roles.includes("departure"))
        requireValue(
          operations.holdingPoints.includes(c.departureHold) &&
            nodes.has(c.departureEntry),
          "departure-capable runway end is missing an entry",
        );
      const active = runway.ends.find((end) => end.id === c.endId),
        opposite = runway.ends.find((end) => end.id !== c.endId);
      runwayConfigurations.push({
        key: runway.id + ":" + active.id,
        runwayId: runway.id,
        endId: active.id,
        label: active.label,
        oppositeLabel: opposite.label,
        capabilities: roles,
        physical: runway,
        configuration: c,
        start: active.position,
        end: opposite.position,
        departureHold: c.departureHold,
        departureEntry: c.departureEntry,
        departureHoldLabel: c.departureHold
          ? nodes.get(c.departureHold).ref
          : undefined,
        arrivalExit: c.arrivalExit,
      });
    }
  }
  for (const id of operations.holdingPoints)
    requireValue(
      nodes.get(id)?.hold && nodes.get(id).ref,
      "holding point " + id,
    );
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
  requireValue(
    Array.isArray(scenario.runwayUses) && scenario.runwayUses.length > 0,
    "active runway uses",
  );
  unique(
    scenario.runwayUses.map((use) => use.runwayId + ":" + use.endId),
    "active runway uses",
  );
  const resolveRunwayUses = (uses, label = "active runway uses") => {
    requireValue(Array.isArray(uses) && uses.length > 0, label);
    unique(
      uses.map((use) => use.runwayId + ":" + use.endId),
      label,
    );
    requireValue(
      new Set(uses.map((use) => use.runwayId)).size === uses.length,
      "opposite runway ends cannot be active together",
    );
    const resolved = uses.map((use) => {
      const base = runwayConfigurations.find(
        (runway) =>
          runway.runwayId === use.runwayId && runway.endId === use.endId,
      );
      requireValue(
        base &&
          typeof use.arrivals === "boolean" &&
          typeof use.departures === "boolean" &&
          (use.arrivals || use.departures) &&
          (!use.arrivals || base.capabilities.includes("arrival")) &&
          (!use.departures || base.capabilities.includes("departure")) &&
          (use.weight === undefined || (finite(use.weight) && use.weight > 0)),
        label,
      );
      return {
        ...base,
        arrivals: use.arrivals,
        departures: use.departures,
        weight: use.weight || 1,
      };
    });
    requireValue(
      resolved.some((runway) => runway.arrivals) &&
        resolved.some((runway) => runway.departures),
      label + " need arrival and departure capacity",
    );
    return resolved;
  };
  const activeRunways = resolveRunwayUses(scenario.runwayUses);
  const runwayPresets = scenario.runwayPresets || [
    { id: "default", label: "Default", runwayUses: scenario.runwayUses },
  ];
  requireValue(runwayPresets.length > 0, "runway presets");
  unique(
    runwayPresets.map((preset) => preset.id),
    "runway presets",
  );
  for (const preset of runwayPresets) {
    requireValue(token(preset.id) && text(preset.label), "runway preset");
    resolveRunwayUses(preset.runwayUses, "runway preset " + preset.id);
  }
  if (scenario.compatibleConfigurationRevisions !== undefined) {
    unique(
      scenario.compatibleConfigurationRevisions,
      "compatible configuration revisions",
    );
    requireValue(
      scenario.compatibleConfigurationRevisions.every((revision) =>
        /^[0-9a-f]{8}$/.test(revision),
      ),
      "compatible configuration revisions",
    );
  }
  if (scenario.compatibleAirportRevisions !== undefined) {
    unique(scenario.compatibleAirportRevisions, "compatible airport revisions");
    requireValue(
      scenario.compatibleAirportRevisions.every((revision) =>
        /^[0-9a-f]{8}$/.test(revision),
      ),
      "compatible airport revisions",
    );
  }
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
  for (const spread of [
    traffic?.intervalJitter,
    traffic?.approachJitter,
    scenario.turnaroundJitter,
  ])
    if (spread !== undefined)
      requireValue(
        finite(spread) && spread >= 0 && spread <= 0.5,
        "random timing range",
      );
  for (const key of [
    "approachSeconds",
    "approachSeparationSeconds",
    "decisionSeconds",
  ])
    if (traffic?.[key] !== undefined)
      requireValue(finite(traffic[key]) && traffic[key] > 0, key);
  requireValue(
    (traffic?.decisionSeconds || 8) <
      (traffic?.approachSeconds || 90) * (1 - (traffic?.approachJitter || 0)),
    "arrival decision timing",
  );
  requireValue(
    traffic && scenario.scoring && scenario.weather,
    "scenario settings",
  );
  for (const key of [
    "arrivalInterval",
    "departureInterval",
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
  if (scenario.initialTraffic) {
    const initial = scenario.initialTraffic;
    for (const [kind, limit] of [
      ["departures", traffic.maxDepartures],
      ["arrivals", traffic.maxApproaches],
    ]) {
      const range = initial[kind];
      requireValue(
        Array.isArray(range) &&
          range.length === 2 &&
          range.every(Number.isSafeInteger) &&
          range[0] >= 0 &&
          range[1] >= range[0] &&
          range[1] <= limit,
        "initial random " + kind,
      );
    }
    requireValue(
      calls.length === 0 &&
        initial.departures[1] + initial.arrivals[1] <= traffic.maxActive,
      "random and scripted starts must be separate and fit capacity",
    );
  }
  for (const key of ["departurePrefixes", "arrivalPrefixes"])
    requireValue(
      Array.isArray(traffic[key]) &&
        traffic[key].length &&
        traffic[key].every(
          (v) => typeof v === "string" && /^[A-Z0-9-]+$/.test(v),
        ),
      key,
    );
  for (const key of ["turnaroundSeconds", "cleanupSeconds"])
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

  const primary = activeRunways[0],
    data = {
      ...geometry,
      operations,
      scenario,
      fleet,
      activeRunways,
      runwayConfigurations,
      runwayPresets,
      // Single-runway aliases remain available to simple renderers and fixtures.
      activeRunway: primary.physical,
      configuration: primary.configuration,
      runway: primary.label,
      oppositeRunway: primary.oppositeLabel,
      runwayStart: primary.start,
      runwayEnd: primary.end,
      departureHold: primary.departureHold,
      departureEntry: primary.departureEntry,
      arrivalExit: primary.arrivalExit,
      departureHoldLabel: primary.departureHoldLabel,
    };
  validateFleet(data);
  const sim = new GroundSim(data);
  for (const options of Object.values(operations.pushbacks || {}))
    for (const option of options)
      requireValue(
        option.path.every((id) => !sim.runwaysAt(nodes.get(id)).length),
        "pushback option crosses runway",
      );
  for (const active of runwayConfigurations.filter((r) =>
    r.capabilities.includes("arrival"),
  ))
    for (const exit of active.configuration.arrivalExits || [
      {
        id: "standard",
        node: active.arrivalExit,
        path: active.configuration.vacatePath,
      },
    ])
      requireValue(
        sim.runwayDistance(nodes.get(exit.node), active) <
          active.physical.protectedHalfWidth &&
          sim.runwayDistance(nodes.get(exit.path.at(-1)), active) >
            active.physical.releaseDistance &&
          geometry.stands.some(
            (s) => sim.path(exit.path.at(-1), s.node).length > 0,
          ),
        "unsafe arrival exit",
      );

  const crossings = operations.runwayCrossings || [];
  unique(
    crossings.map((crossing) => crossing.id),
    "runway crossings",
  );
  const controlledRunwayEdges = new Set();
  const authorizePath = (runwayId, path) =>
    path.slice(1).forEach((id, index) => {
      const pair = [path[index], id].sort().join(":");
      controlledRunwayEdges.add(runwayId + ":" + pair);
    });
  for (const active of runwayConfigurations) {
    if (active.capabilities.includes("departure"))
      authorizePath(active.runwayId, [
        active.departureHold,
        active.departureEntry,
      ]);
    if (active.capabilities.includes("arrival"))
      for (const exit of active.configuration.arrivalExits || [
        { path: active.configuration.vacatePath },
      ])
        authorizePath(active.runwayId, exit.path);
  }
  for (const crossing of crossings) {
    const physical = operations.runways.find(
      (runway) => runway.id === crossing.runwayId,
    );
    requireValue(
      token(crossing.id) &&
        text(crossing.label) &&
        physical &&
        connectedPath(crossing.path) &&
        operations.holdingPoints.includes(crossing.path[0]) &&
        operations.holdingPoints.includes(crossing.path.at(-1)) &&
        crossing.path.every((id) =>
          sim
            .runwaysAt(nodes.get(id))
            .every((runway) => runway.id === crossing.runwayId),
        ) &&
        crossing.path
          .slice(1, -1)
          .some(
            (id) =>
              sim.runwayDistance(nodes.get(id), { physical }) <
              physical.protectedHalfWidth,
          ),
      "runway crossing",
    );
    authorizePath(crossing.runwayId, crossing.path);
  }
  if (fleet) {
    requireValue(
      scenario.initialTraffic
        ? sim.planes.filter((p) => p.direction === "departure").length >=
            scenario.initialTraffic.departures[0] &&
            sim.planes.filter((p) => p.direction === "arrival").length >=
              scenario.initialTraffic.arrivals[0]
        : sim.planes.length === calls.length,
      "initial aircraft incompatible with stands/routes",
    );
    for (const type of new Set([
      ...fleet.departureTypes,
      ...fleet.arrivalTypes,
    ]))
      requireValue(
        data.stands.some((s) => sim.supportsType(type, s)),
        "no complete ground route for " + type,
      );
  }
  for (const edge of geometry.edges)
    for (const physical of operations.runways) {
      const pair = [edge.a, edge.b].sort().join(":"),
        declared = controlledRunwayEdges.has(physical.id + ":" + pair);
      requireValue(
        !sim.edgeCrossesRunway(edge.a, edge.b, { physical }) || declared,
        "unprotected runway crossing; explicit crossing support required",
      );
    }
  for (const active of runwayConfigurations) {
    if (active.capabilities.includes("departure"))
      requireValue(
        sim.runwayDistance(nodes.get(active.departureEntry), active) <
          active.physical.protectedHalfWidth &&
          sim.path(active.departureHold, active.departureEntry, active.key)
            .length >= 2,
        "unreachable runway entry",
      );
    if (active.capabilities.includes("arrival"))
      requireValue(
        sim.runwayDistance(nodes.get(active.arrivalExit), active) <
          active.physical.protectedHalfWidth,
        "arrival exit is not on runway",
      );
  }
  requireValue(
    operations.holdingPoints.every(
      (id) => !sim.runwaysAt(nodes.get(id)).length,
    ),
    "holding point is inside protected runway",
  );
  for (const s of stands.values()) {
    requireValue(
      activeRunways
        .filter((r) => r.departures)
        .some((r) => sim.path(s.exit, r.departureHold).length >= 2),
      "stand cannot reach departure hold: " + s.id,
    );
    requireValue(
      activeRunways
        .filter((r) => r.arrivals)
        .some(
          (r) =>
            sim.path(r.configuration.vacatePath.at(-1), s.node).length >= 2,
        ),
      "arrival cannot reach stand: " + s.id,
    );
    requireValue(
      s.path.every((id) => !sim.runwaysAt(nodes.get(id)).length),
      "pushback crosses protected runway: " + s.id,
    );
  }
  return freeze(data);
}
