import fs from "node:fs";

const [
  geometryPath,
  surfacesPath,
  buildingsPath,
  roadsPath,
  railsPath,
  output,
] = process.argv.slice(2);
if (
  !geometryPath ||
  !surfacesPath ||
  !buildingsPath ||
  !roadsPath ||
  !railsPath ||
  !output
)
  throw new Error(
    "Usage: node scripts/import-visual-environment.mjs geometry.json surfaces.json buildings.json roads.json rails.json environment.json",
  );
if (fs.existsSync(output))
  throw new Error(
    "Output already exists; review visual data before replacing it.",
  );

const read = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const geometry = read(geometryPath);
const surfaces = read(surfacesPath);
const buildings = read(buildingsPath);
const roads = read(roadsPath);
const rails = railsPath === "-" ? { elements: [] } : read(railsPath);
const featureIds = new Set(geometry.features.map((feature) => feature.id));
const [lon0, lat0] = geometry.center;
const longitudeScale = 111320 * Math.cos((lat0 * Math.PI) / 180);
const round = (value) => Math.round(value * 100) / 100;
const project = (point) => [
  round((point.lon - lon0) * longitudeScale),
  round((lat0 - point.lat) * 111320),
];
const token = (value) =>
  typeof value === "string" && /^[A-Za-z0-9._:-]+$/.test(value)
    ? value
    : undefined;
const number = (value) => {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};
const compact = (value) =>
  Object.fromEntries(Object.entries(value).filter(([, item]) => item != null));

const visualFeatures = surfaces.elements
  .filter(
    (element) =>
      Array.isArray(element.geometry) &&
      element.geometry.length >= 3 &&
      (element.tags?.natural === "water" ||
        element.tags?.waterway === "riverbank" ||
        element.tags?.landuse === "basin" ||
        element.tags?.landuse === "grass" ||
        element.tags?.natural === "grassland" ||
        element.tags?.landcover === "grass" ||
        element.tags?.leisure === "park"),
  )
  .map((element) => ({
    id: `osm-way-${element.id}`,
    type:
      element.tags.natural === "water" ||
      element.tags.waterway === "riverbank" ||
      element.tags.landuse === "basin"
        ? "water"
        : "grass",
    name: element.tags.name || "",
    closed:
      element.geometry[0].lat === element.geometry.at(-1).lat &&
      element.geometry[0].lon === element.geometry.at(-1).lon,
    points: element.geometry.map(project),
  }));

for (const element of rails.elements) {
  if (!Array.isArray(element.geometry) || element.geometry.length < 2) continue;
  visualFeatures.push({
    id: `osm-way-${element.id}`,
    type: "rail",
    name: element.tags?.name || "",
    closed: false,
    width: number(element.tags?.gauge) > 0 ? 3 : 2,
    points: element.geometry.map(project),
  });
}

const featureStyles = {};
for (const element of buildings.elements) {
  const id = String(element.id);
  if (!featureIds.has(id)) continue;
  const tags = element.tags || {};
  const style = compact({
    buildingClass: token(tags.building),
    levels: number(tags["building:levels"]),
    height: number(tags.height),
    material: token(tags["building:material"]),
    roofShape: token(tags["roof:shape"]),
    roofLevels: number(tags["roof:levels"]),
  });
  if (Object.keys(style).length) featureStyles[id] = style;
}
for (const element of roads.elements) {
  const id = String(element.id);
  if (!featureIds.has(id)) continue;
  const roadClass = token(element.tags?.highway);
  if (roadClass) featureStyles[id] = { roadClass };
}

const environment = {
  version: 1,
  source: {
    name: "OpenStreetMap contributors",
    url: "https://www.openstreetmap.org/copyright",
    license: "Open Database License (ODbL) 1.0",
    downloaded: new Date().toISOString().slice(0, 10),
  },
  features: visualFeatures,
  featureStyles,
};
fs.writeFileSync(output, JSON.stringify(environment));
console.log(
  JSON.stringify(
    {
      output,
      water: visualFeatures.filter((feature) => feature.type === "water")
        .length,
      grass: visualFeatures.filter((feature) => feature.type === "grass")
        .length,
      rail: visualFeatures.filter((feature) => feature.type === "rail").length,
      styledFeatures: Object.keys(featureStyles).length,
    },
    null,
    2,
  ),
);
