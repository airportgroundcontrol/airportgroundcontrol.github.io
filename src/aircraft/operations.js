import { aircraftType } from "./catalog.js";
import { edgeAllows } from "./compatibility.js";

export const arrivalETA = (p, data) => {
  if (p.state !== "approach" && !(p.state === "landing" && p.airborne))
    return null;
  const runway =
    (data.runwayConfigurations || data.activeRunways).find(
      (candidate) => candidate.key === p.runwayKey,
    ) || data.activeRunways[0];
  return (
    Math.hypot(p.x - runway.start.x, p.y - runway.start.y) /
    aircraftType(p.type).performance.landing
  );
};

export function pushbackOptions(sim, p) {
  const stand = sim.stands.get(p.stand);
  if (!stand) return [];
  const configured = sim.data.operations.pushbacks?.[stand.id] || [];
  return [
    {
      id: "standard",
      label: "Straight back",
      path: [...stand.path].reverse(),
      mode: "tug",
    },
    ...configured,
  ].filter(
    (option) =>
      (!option.types || option.types.includes(p.type)) &&
      option.path.slice(1).every((id, i) => {
        const link =
          sim.graph.getLink(option.path[i], id) ||
          sim.graph.getLink(id, option.path[i]);
        return link && edgeAllows(sim.data, link.data, p.type);
      }),
  );
}

export function landingOptions(sim, p, runwayValue = p) {
  const runway = sim.runwayFor(runwayValue),
    config = runway.configuration;
  const options = config.arrivalExits || [
    {
      id: "standard",
      node: config.arrivalExit,
      path: config.vacatePath,
      speed: 7,
    },
  ];
  const type = aircraftType(p.type),
    perf = type.performance;
  return options
    .filter((exit) => {
      const point = sim.nodes.get(exit.node),
        last = sim.nodes.get(exit.path.at(-1));
      const roll = Math.hypot(
        point.x - runway.start.x,
        point.y - runway.start.y,
      );
      const needed =
        120 + (perf.landing ** 2 - exit.speed ** 2) / (2 * perf.braking);
      return (
        roll >= needed &&
        sim.runwayDistance(last, runway) >
          Math.max(
            runway.physical.releaseDistance,
            runway.physical.protectedHalfWidth +
              Math.hypot(type.length, type.wingspan) / 2 +
              3,
          ) &&
        exit.path.slice(1).every((id, i) => {
          const edge =
            sim.graph.getLink(exit.path[i], id) ||
            sim.graph.getLink(id, exit.path[i]);
          return edge && edgeAllows(sim.data, edge.data, p.type);
        }) &&
        sim.data.stands.some(
          (s) => !sim.standReason({ ...p, node: last.id }, s.id),
        )
      );
    })
    .sort(
      (a, b) =>
        Math.hypot(
          sim.nodes.get(a.node).x - runway.start.x,
          sim.nodes.get(a.node).y - runway.start.y,
        ) -
        Math.hypot(
          sim.nodes.get(b.node).x - runway.start.x,
          sim.nodes.get(b.node).y - runway.start.y,
        ),
    );
}
