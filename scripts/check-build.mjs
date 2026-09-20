import assert from "node:assert/strict";
import fs from "node:fs";
const read = (name) =>
  fs.readFileSync(new URL("../" + name, import.meta.url), "utf8");
for (const name of ["index.html", "style.css"])
  assert.equal(read("dist/" + name), read("web/" + name));
assert.equal(
  read("dist/data/egph.json"),
  read("data/airports/egph/geometry.json"),
);
const offline = read("Ground Control.html");
assert.ok(offline.includes(`<style>${read("web/style.css")}</style>`));
assert.ok(
  offline.includes(
    `<script>${read("dist/app.js").replaceAll("</script", "<\\/script")}</script>`,
  ),
);
assert.ok(!offline.includes('<script type="module" src="app.js">'));
assert.ok(!offline.includes('<link rel="stylesheet" href="style.css">'));
console.log(
  "Static filenames, source copies and offline embedded assets verified.",
);
