import { build } from "esbuild";
import path from "node:path";

// Same application, with a scripted catalog for precise clearance regressions.
// random-traffic-browser.mjs exercises the unmodified production bundle.
let javascript;
export async function useScriptedTraffic(context) {
  if (!javascript) {
    const result = await build({
      entryPoints: ["src/app.js"],
      bundle: true,
      write: false,
      format: "iife",
      plugins: [
        {
          name: "scripted-traffic",
          setup(build) {
            build.onResolve({ filter: /\/airports\/catalog\.js$/ }, () => ({
              path: path.resolve("tests/fixtures/standard-airport.js"),
            }));
          },
        },
      ],
    });
    javascript = result.outputFiles[0].text;
  }
  await context.route("**/app.js", (route) =>
    route.fulfill({ contentType: "text/javascript", body: javascript }),
  );
}
