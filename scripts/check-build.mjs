import assert from "node:assert/strict";
import fs from "node:fs";
const read = (name) =>
  fs.readFileSync(new URL("../" + name, import.meta.url), "utf8");
const embeddedScript = read("dist/app.js")
  .replace(/[ \t]+(?=\r?\n)/g, "")
  .replace(/^ +(?=\t)/gm, "")
  .replaceAll("</script", "<\\/script");
for (const name of ["index.html", "style.css", "style-3d.css"])
  assert.equal(read("dist/" + name), read("web/" + name));
assert.equal(
  read("dist/3d.html"),
  read("web/index.html").replace(
    '<script type="module" src="app.js"></script>',
    '<script>window.__initialAirportId="EDDF";window.__initialViewMode="3d"</script><script type="module" src="app.js"></script>',
  ),
);
for (const entry of fs.readdirSync(
  new URL("../data/airports/", import.meta.url),
  { withFileTypes: true },
)) {
  if (entry.isDirectory())
    assert.equal(
      read(`dist/data/${entry.name}.json`),
      read(`data/airports/${entry.name}/geometry.json`),
    );
}
for (const name of ["Ground Control.html", "index.html"]) {
  const offline = read(name);
  assert.ok(offline.includes(`<style>${read("web/style.css")}</style>`));
  assert.ok(offline.includes(`<style>${read("web/style-3d.css")}</style>`));
  assert.ok(offline.includes(`<script>${embeddedScript}</script>`));
  assert.ok(!offline.includes('<script type="module" src="app.js">'));
  assert.ok(!offline.includes('<link rel="stylesheet" href="style.css">'));
}
const tower = read("Ground Control 3D.html");
assert.ok(tower.includes(`<style>${read("web/style.css")}</style>`));
assert.ok(tower.includes(`<style>${read("web/style-3d.css")}</style>`));
assert.ok(tower.includes(`<script>${embeddedScript}</script>`));
assert.ok(
  tower.includes(
    '<script>window.__initialAirportId="EDDF";window.__initialViewMode="3d"</script>',
  ),
);
assert.ok(!tower.includes('<script type="module" src="app.js">'));
assert.ok(!tower.includes('<link rel="stylesheet" href="style.css"'));
assert.ok(!tower.includes('<link rel="stylesheet" href="style-3d.css"'));
console.log(
  "Shared 2D/3D static filenames, source copies and offline assets verified.",
);
