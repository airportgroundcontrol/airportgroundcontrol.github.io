import assert from "node:assert/strict";
import fs from "node:fs";
const read = (name) =>
  fs.readFileSync(new URL("../" + name, import.meta.url), "utf8");
for (const name of ["index.html", "style.css"])
  assert.equal(read("dist/" + name), read("web/" + name));
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
  assert.ok(
    offline.includes(
      `<script>${read("dist/app.js").replaceAll("</script", "<\\/script")}</script>`,
    ),
  );
  assert.ok(!offline.includes('<script type="module" src="app.js">'));
  assert.ok(!offline.includes('<link rel="stylesheet" href="style.css">'));
}
console.log(
  "Static filenames, source copies and offline embedded assets verified.",
);
