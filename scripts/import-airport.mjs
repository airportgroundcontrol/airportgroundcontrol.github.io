import fs from "node:fs";
import path from "node:path";
import { XMLParser } from "fast-xml-parser";
import { createAirportPackage } from "../src/airports/package.js";
import { airportRevision } from "../src/persistence.js";

const [source, descriptor, output] = process.argv.slice(2);
if (!source || !descriptor || !output)
  throw new Error(
    "Usage: node scripts/import-airport.mjs source.osm airport/import.json candidate.geometry.json",
  );
if (fs.existsSync(output))
  throw new Error(
    "Output already exists. Choose a new candidate file; do not overwrite a published graph.",
  );
const metadata = JSON.parse(fs.readFileSync(descriptor, "utf8"));
const directory = path.dirname(path.resolve(descriptor));
const operations = JSON.parse(
  fs.readFileSync(path.resolve(directory, metadata.operations), "utf8"),
);
const scenario = JSON.parse(
  fs.readFileSync(path.resolve(directory, metadata.scenario), "utf8"),
);
const runway = operations.runways.find((r) =>
  r.configurations.some((c) => c.endId === scenario.activeRunwayEnd),
);
if (!runway)
  throw new Error("No curated runway configuration for this scenario");
const active = runway.ends.find((e) => e.id === scenario.activeRunwayEnd);
const opposite = runway.ends.find((e) => e.id !== scenario.activeRunwayEnd);
const configuration = runway.configurations.find(
  (c) => c.endId === scenario.activeRunwayEnd,
);
const raw = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
}).parse(fs.readFileSync(source, "utf8")).osm;
const array = (value) => (!value ? [] : Array.isArray(value) ? value : [value]);
const tags = (value) =>
  Object.fromEntries(array(value.tag).map((t) => [t.k, t.v]));
const [lon0, lat0] = metadata.center;
const nodes = new Map(
  array(raw.node).map((n) => [
    String(n.id),
    {
      id: String(n.id),
      x:
        Math.round(
          (+n.lon - lon0) * 111320 * Math.cos((lat0 * Math.PI) / 180) * 100,
        ) / 100,
      y: Math.round((lat0 - +n.lat) * 111320 * 100) / 100,
      tags: tags(n),
    },
  ]),
);
const ways = array(raw.way).map((w) => ({
  id: String(w.id),
  tags: tags(w),
  nodes: array(w.nd).map((n) => String(n.ref)),
}));
const features = ways
  .filter(
    (w) =>
      w.tags.aeroway ||
      w.tags.building ||
      w.tags.highway ||
      w.tags.natural === "wood",
  )
  .map((w) => ({
    id: w.id,
    type:
      w.tags.aeroway ||
      (w.tags.building ? "building" : w.tags.highway ? "road" : "wood"),
    ref: w.tags.ref || "",
    name: w.tags.name || "",
    width: parseFloat(w.tags.width) || 0,
    closed: w.nodes[0] === w.nodes.at(-1),
    points: w.nodes
      .map((id) => nodes.get(id))
      .filter(Boolean)
      .map((n) => [n.x, n.y]),
  }));
const routeWays = ways.filter((w) =>
  ["taxiway", "taxilane", "parking_position"].includes(w.tags.aeroway),
);
const routeNodes = new Map(),
  edges = [];
for (const w of routeWays) {
  if (w.nodes.some((id) => !nodes.has(id)))
    throw new Error("Incomplete OSM route way: " + w.id);
  for (const id of w.nodes) routeNodes.set(id, nodes.get(id));
  for (let i = 1; i < w.nodes.length; i++)
    edges.push({
      a: w.nodes[i - 1],
      b: w.nodes[i],
      ref: w.tags.ref || "",
      type: w.tags.aeroway,
    });
}
const adjacency = new Map([...routeNodes.keys()].map((id) => [id, []]));
for (const e of edges) {
  adjacency.get(e.a).push(e.b);
  adjacency.get(e.b).push(e.a);
}
if (!adjacency.has(configuration.departureHold))
  throw new Error("Configured departure hold is absent from source data");
const connected = new Set(),
  pending = [configuration.departureHold];
while (pending.length) {
  const id = pending.pop();
  if (connected.has(id)) continue;
  connected.add(id);
  pending.push(...adjacency.get(id).filter((id) => !connected.has(id)));
}
const stands = routeWays
  .filter(
    (w) =>
      w.tags.aeroway === "parking_position" &&
      connected.has(w.nodes[0]) &&
      w.nodes.length > 1,
  )
  .map((w) => ({
    id: w.tags.ref || w.id,
    node: w.nodes.at(-1),
    exit: w.nodes[0],
    path: w.nodes,
    heading: Math.atan2(
      nodes.get(w.nodes.at(-1)).y - nodes.get(w.nodes.at(-2)).y,
      nodes.get(w.nodes.at(-1)).x - nodes.get(w.nodes.at(-2)).x,
    ),
  }))
  .filter((s) => metadata.standIds.includes(s.id))
  .sort(
    (a, b) => metadata.standIds.indexOf(a.id) - metadata.standIds.indexOf(b.id),
  );
if (stands.length !== metadata.standIds.length)
  throw new Error("Not all curated stands were found exactly once");
const geometry = {
  id: metadata.id,
  iata: metadata.iata,
  name: metadata.name,
  country: metadata.country,
  center: [lon0, lat0],
  runway: active.label,
  runwayLength: Math.round(
    Math.hypot(
      active.position.x - opposite.position.x,
      active.position.y - opposite.position.y,
    ),
  ),
  source: metadata.source,
  features,
  nodes: [...routeNodes.values()]
    .filter((n) => connected.has(n.id))
    .map((n) => ({
      id: n.id,
      x: n.x,
      y: n.y,
      hold: n.tags.aeroway === "holding_position",
      ref: n.tags.ref || "",
    })),
  edges: edges.filter((e) => connected.has(e.a)),
  stands,
  runwayStart: active.position,
  runwayEnd: opposite.position,
  departureEntry: configuration.departureEntry,
  departureHold: configuration.departureHold,
  arrivalExit: configuration.arrivalExit,
};
const airport = createAirportPackage({ geometry, operations, scenario });
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, JSON.stringify(geometry));
console.log(
  JSON.stringify(
    {
      output,
      airport: airport.id,
      nodes: geometry.nodes.length,
      edges: geometry.edges.length,
      stands: stands.length,
      revision: airportRevision(airport),
      status:
        "Validated candidate only; review before replacing published geometry.",
    },
    null,
    2,
  ),
);
