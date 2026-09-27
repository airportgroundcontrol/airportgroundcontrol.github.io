import { build } from "esbuild";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
process.chdir(fileURLToPath(new URL("../", import.meta.url)));
fs.rmSync("dist", { recursive: true, force: true });
fs.mkdirSync("dist/data", { recursive: true });
for (const name of ["index.html", "style.css", "style-3d.css"]) {
  fs.copyFileSync(`web/${name}`, `dist/${name}`);
}
for (const entry of fs.readdirSync("data/airports", { withFileTypes: true })) {
  if (entry.isDirectory())
    fs.copyFileSync(
      `data/airports/${entry.name}/geometry.json`,
      `dist/data/${entry.name}.json`,
    );
}
await build({
  entryPoints: ["src/app.js"],
  bundle: true,
  format: "iife",
  outfile: "dist/app.js",
  minify: true,
  legalComments: "eof",
  loader: { ".glb": "binary" },
});
const moduleMarker = '<script type="module" src="app.js"></script>';
const gameHtml = fs.readFileSync("dist/index.html", "utf8");
if (gameHtml.split(moduleMarker).length !== 2)
  throw new Error("Expected exactly one application script marker");
fs.writeFileSync(
  "dist/3d.html",
  gameHtml.replace(
    moduleMarker,
    '<script>window.__initialAirportId="EDDF";window.__initialViewMode="3d"</script>' +
      moduleMarker,
  ),
);

function standalone(htmlName) {
  const html = fs.readFileSync(`dist/${htmlName}`, "utf8");
  const styleNames = ["style.css", "style-3d.css"];
  let output = html;
  for (const styleName of styleNames) {
    const marker = `<link rel="stylesheet" href="${styleName}" />`;
    if (html.split(marker).length !== 2)
      throw new Error(
        `Expected exactly one offline embedding marker: ${marker}`,
      );
    output = output.replace(
      marker,
      () => `<style>${fs.readFileSync(`dist/${styleName}`, "utf8")}</style>`,
    );
  }
  if (output.split(moduleMarker).length !== 2)
    throw new Error(
      `Expected exactly one offline embedding marker: ${moduleMarker}`,
    );
  const script = fs
    .readFileSync("dist/app.js", "utf8")
    .replace(/[ \t]+(?=\r?\n)/g, "")
    .replace(/^ +(?=\t)/gm, "")
    .replaceAll("</script", "<\\/script");
  return output.replace(moduleMarker, () => `<script>${script}</script>`);
}
const game = standalone("index.html");
for (const name of ["Ground Control.html", "index.html"])
  fs.writeFileSync(name, game);
fs.writeFileSync("Ground Control 3D.html", standalone("3d.html"));
console.log("Built the shared 2D/3D app and standalone offline entry files.");
