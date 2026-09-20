import { build } from "esbuild";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
process.chdir(fileURLToPath(new URL("../", import.meta.url)));
fs.rmSync("dist", { recursive: true, force: true });
fs.mkdirSync("dist/data", { recursive: true });
for (const name of ["index.html", "style.css"]) {
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
});
const html = fs.readFileSync("dist/index.html", "utf8");
for (const marker of [
  '<link rel="stylesheet" href="style.css">',
  '<script type="module" src="app.js"></script>',
]) {
  if (html.split(marker).length !== 2)
    throw new Error(`Expected exactly one offline embedding marker: ${marker}`);
}
const standalone = html
  .replace(
    '<link rel="stylesheet" href="style.css">',
    () => `<style>${fs.readFileSync("dist/style.css", "utf8")}</style>`,
  )
  .replace(
    '<script type="module" src="app.js"></script>',
    () =>
      `<script>${fs.readFileSync("dist/app.js", "utf8").replaceAll("</script", "<\\/script")}</script>`,
  );
fs.writeFileSync("Ground Control.html", standalone);
console.log("Built static app and standalone offline game.");
