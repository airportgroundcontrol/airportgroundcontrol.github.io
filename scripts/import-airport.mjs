import fs from "node:fs";
import { XMLParser } from "fast-xml-parser";

const source = process.argv[2] || "../work/egph.osm";
const raw = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
}).parse(fs.readFileSync(source, "utf8")).osm;
const array = (v) => (!v ? [] : Array.isArray(v) ? v : [v]);
const tags = (v) => Object.fromEntries(array(v.tag).map((t) => [t.k, t.v]));
const lon0 = -3.372,
  lat0 = 55.95;
const nodes = new Map(
  raw.node.map((n) => [
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
const ways = raw.way.map((w) => ({
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
const routeNodes = new Map();
const edges = [];
for (const w of routeWays) {
  for (const id of w.nodes)
    if (nodes.has(id)) routeNodes.set(id, nodes.get(id));
  for (let i = 1; i < w.nodes.length; i++)
    if (nodes.has(w.nodes[i - 1]) && nodes.has(w.nodes[i]))
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
const components = [];
const seen = new Set();
for (const id of adjacency.keys()) {
  if (seen.has(id)) continue;
  const group = [];
  const q = [id];
  seen.add(id);
  while (q.length) {
    const a = q.pop();
    group.push(a);
    for (const b of adjacency.get(a))
      if (!seen.has(b)) {
        seen.add(b);
        q.push(b);
      }
  }
  components.push(group);
}
components.sort((a, b) => b.length - a.length);
const connected = new Set(components[0]);
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
  .filter((s) => /^\d+$/.test(s.id) && +s.id <= 34)
  .sort((a, b) => +a.id - +b.id);
const rw = ways.find(
  (w) => w.tags.aeroway === "runway" && w.tags.ref === "06/24",
);
const rwpoints = ways
  .filter((w) => w.tags.aeroway === "runway")
  .flatMap((w) => w.nodes.map((id) => nodes.get(id)));
const northeast = rwpoints.reduce((a, b) => (a.x > b.x ? a : b)),
  southwest = rwpoints.reduce((a, b) => (a.x < b.x ? a : b));
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const candidates = [...routeNodes.values()].filter(
  (n) => connected.has(n.id) && n.tags.aeroway === "holding_position",
);
const runwayOffset = (n) =>
  Math.abs(
    (n.x - northeast.x) * (southwest.y - northeast.y) -
      (n.y - northeast.y) * (southwest.x - northeast.x),
  ) / distance(northeast, southwest);
const start = [...routeNodes.values()]
  .filter((n) => connected.has(n.id) && runwayOffset(n) < 1)
  .sort((a, b) => distance(a, northeast) - distance(b, northeast))[0];
const holding = candidates.find((n) => n.tags.ref === "D1");
// Keep mapped taxiway/runway junctions; arrival exits must actually meet the runway.
const junctions = rw.nodes
  .filter((id) => connected.has(id))
  .map((id) => nodes.get(id));
const arrival = junctions
  .filter((n) => distance(n, northeast) > 1000)
  .sort((a, b) => distance(a, northeast) - distance(b, northeast))[0];
const airport = {
  id: "EGPH",
  iata: "EDI",
  name: "Edinburgh",
  country: "United Kingdom",
  center: [lon0, lat0],
  runway: "24",
  runwayLength: Math.round(distance(northeast, southwest)),
  source: {
    name: "OpenStreetMap contributors",
    url: "https://www.openstreetmap.org/copyright",
    downloaded: "2026-09-20",
    license: "ODbL 1.0",
  },
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
  runwayStart: { x: northeast.x, y: northeast.y },
  runwayEnd: { x: southwest.x, y: southwest.y },
  departureEntry: start.id,
  departureHold: holding?.id,
  arrivalExit: arrival?.id,
};
fs.mkdirSync("data/airports/egph", { recursive: true });
fs.writeFileSync("data/airports/egph/geometry.json", JSON.stringify(airport));
console.log(
  JSON.stringify(
    {
      components: components.map((c) => c.length),
      nodes: airport.nodes.length,
      edges: airport.edges.length,
      stands: airport.stands.length,
      holds: candidates.map((n) => ({
        id: n.id,
        ref: n.tags.ref,
        dist: Math.round(distance(n, northeast)),
      })),
      start,
      arrival,
      junctions,
    },
    null,
    2,
  ),
);
