import { aircraftType, aircraftCatalog } from "./catalog.js";

export function standLimits(data, id) {
  return data.fleet?.standGroups.find((group) => group.stands.includes(id));
}

export function standFit(data, id, typeId) {
  const limits = standLimits(data, id),
    type = aircraftType(typeId);
  if (!limits) return "Stand limits unknown";
  if (type.length > limits.maxLength || type.wingspan > limits.maxWingspan)
    return "Too small for " + typeId;
  return null;
}

export function excludedStands(data, id) {
  return new Set([
    id,
    ...(data.fleet?.exclusionGroups || []).filter((g) => g.includes(id)).flat(),
  ]);
}

export function edgeAllows(data, edge, typeId) {
  const rule = data.fleet?.routeRules.find((r) => r.refs.includes(edge.ref));
  return (rule?.allowedTypes || data.fleet?.defaultRouteTypes || []).includes(
    typeId,
  );
}

export function validateFleet(data) {
  const f = data.fleet;
  if (!f) return;
  const require = (ok, reason) => {
    if (!ok) throw new Error("Invalid aircraft operations: " + reason);
  };
  const types = (ids) =>
    Array.isArray(ids) &&
    ids.length > 0 &&
    ids.every((id) => Object.hasOwn(aircraftCatalog, id));
  require(f.version === 1 &&
    f.basis === "game-assumptions", "version/provenance");
  require(types(f.departureTypes) &&
    types(f.arrivalTypes) &&
    types(f.defaultRouteTypes), "fleet types");
  require(Array.isArray(f.standGroups) &&
    Array.isArray(f.exclusionGroups) &&
    Array.isArray(f.routeRules), "limits");
  const known = new Set(data.stands.map((s) => s.id)),
    seen = new Set();
  for (const group of f.standGroups) {
    require(Number.isFinite(group.maxLength) &&
      group.maxLength > 0 &&
      Number.isFinite(group.maxWingspan) &&
      group.maxWingspan > 0, "stand dimensions");
    require(Array.isArray(group.stands), "stand IDs");
    for (const id of group.stands) {
      require(known.has(id) && !seen.has(id), "stand reference " + id);
      seen.add(id);
    }
  }
  for (const group of f.exclusionGroups)
    require(Array.isArray(group) &&
      group.length > 1 &&
      new Set(group).size === group.length &&
      group.every((id) => known.has(id)), "exclusion group");
  const refs = new Set(data.edges.map((e) => e.ref)),
    restricted = new Set();
  for (const rule of f.routeRules) {
    require(types(rule.allowedTypes) &&
      Array.isArray(rule.refs), "route types");
    for (const ref of rule.refs) {
      require(refs.has(ref) && !restricted.has(ref), "route reference");
      restricted.add(ref);
    }
  }
  require(f.initialTypes &&
    Object.values(f.initialTypes).every((id) =>
      Object.hasOwn(aircraftCatalog, id),
    ), "initial types");
  for (const rule of Object.values(f.departureWakeSeconds || {}))
    require(rule &&
      Object.values(rule).every(
        (seconds) => Number.isFinite(seconds) && seconds >= 0 && seconds <= 300,
      ), "wake delay");
  for (const id of [...f.arrivalTypes, ...f.departureTypes])
    require(data.stands.some(
      (s) => !standFit(data, s.id, id),
    ), "no stand for " + id);
}
