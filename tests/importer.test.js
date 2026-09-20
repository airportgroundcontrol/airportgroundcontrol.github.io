import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { XMLBuilder } from "fast-xml-parser";
import { syntheticInput } from "./fixtures/synthetic-airport.js";

test("generic OSM importer validates explicit connections and alphanumeric stands without replacing files", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ground-import-"));
  try {
    const { geometry, operations, scenario } = structuredClone(syntheticInput);
    const ids = new Map(geometry.nodes.map((n, i) => [n.id, String(i + 1)]));
    const translate = (value) =>
      typeof value === "string"
        ? ids.get(value) || value
        : Array.isArray(value)
          ? value.map(translate)
          : value && typeof value === "object"
            ? Object.fromEntries(
                Object.entries(value).map(([k, v]) => [k, translate(v)]),
              )
            : value;
    const nodes = geometry.nodes.map((n) => ({
      id: ids.get(n.id),
      lon: n.x / 111320,
      lat: -n.y / 111320,
      tag: n.hold
        ? [
            { k: "aeroway", v: "holding_position" },
            { k: "ref", v: n.ref },
          ]
        : [],
    }));
    const ways = geometry.edges
      .filter((e) => !e.a.startsWith("stand-") && !e.b.startsWith("stand-"))
      .map((e, i) => ({
        id: String(100 + i),
        nd: [{ ref: ids.get(e.a) }, { ref: ids.get(e.b) }],
        tag: [
          { k: "aeroway", v: "taxiway" },
          { k: "ref", v: e.ref },
        ],
      }));
    for (const [i, stand] of geometry.stands.entries())
      ways.push({
        id: String(200 + i),
        nd: stand.path.map((id) => ({ ref: ids.get(id) })),
        tag: [
          { k: "aeroway", v: "parking_position" },
          { k: "ref", v: stand.id },
        ],
      });
    const xml = new XMLBuilder({
      ignoreAttributes: false,
      attributeNamePrefix: "@_",
    });
    const attributes = (value) =>
      Array.isArray(value)
        ? value.map(attributes)
        : value && typeof value === "object"
          ? Object.fromEntries(
              Object.entries(value).map(([key, child]) => [
                typeof child === "object" ? key : "@_" + key,
                attributes(child),
              ]),
            )
          : value;
    fs.writeFileSync(
      path.join(directory, "source.osm"),
      xml.build({ osm: attributes({ node: nodes, way: ways }) }),
    );
    const write = (filename, value) =>
      fs.writeFileSync(path.join(directory, filename), JSON.stringify(value));
    write("operations.json", translate(operations));
    write("scenario.json", scenario);
    write("import.json", {
      id: geometry.id,
      iata: geometry.iata,
      name: geometry.name,
      country: geometry.country,
      center: [0, 0],
      source: geometry.source,
      standIds: geometry.stands.map((s) => s.id),
      operations: "operations.json",
      scenario: "scenario.json",
    });
    const output = path.join(directory, "candidate.json");
    const args = [
      "scripts/import-airport.mjs",
      path.join(directory, "source.osm"),
      path.join(directory, "import.json"),
      output,
    ];
    execFileSync(process.execPath, args, { stdio: "pipe" });
    const bytes = fs.readFileSync(output, "utf8"),
      imported = JSON.parse(bytes);
    assert.equal(imported.id, "TEST");
    assert.equal(imported.runway, "17");
    assert.deepEqual(
      imported.stands.map((s) => s.id),
      ["A1", "B2"],
    );
    assert.equal(imported.departureHold, ids.get("hold"));
    assert.throws(
      () => execFileSync(process.execPath, args, { stdio: "pipe" }),
      /Output already exists/,
    );
    assert.equal(fs.readFileSync(output, "utf8"), bytes);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
