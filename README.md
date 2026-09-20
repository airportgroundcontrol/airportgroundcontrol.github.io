# Ground Control

A browser-only playable MVP on Edinburgh Airport's actual OpenStreetMap geometry.

Open **Ground Control.html** directly in a browser. The map, icons, pathfinding and simulation are bundled; the game works without a server or internet connection. The `dist` folder is the equivalent static website.

## Play

- Play continuously with recurring arrivals and departures. There is no timer, movement target, or session end. A completed departure or arrival scores 100 points.
- Click or right-click an aircraft to open its action menu. The floating right panel stacks compact flight strips, with pending requests and traffic holds first. Clicking a strip opens the same aircraft menu.
- Departures: approve pushback, plan the taxi route, issue clearance, wait at D1, line up, then clear for takeoff.
- Arrivals: clear to land while the runway is available, wait for the aircraft to vacate, assign a free stand, plan and issue taxi clearance.
- Click taxiway points while planning to add intermediate waypoints. The proposed route appears on the map before clearance.
- Hold position stops a moving aircraft; a stopped taxiing aircraft can receive a revised route. Continue resumes the previous route.
- Drag to pan, scroll or pinch to zoom, and use the fit button to restore the overview. Space pauses; 1x / 4x / 8x controls simulation speed.
- Shortcuts for the selected aircraft: P pushback; T plan taxi; Enter issue taxi clearance; H hold/resume; L land; U line up; D take off; G go around. N selects the next request, F fits the airport, and Escape dismisses the menu and cancels the route preview. The keyboard button or ? opens the reference. Shortcuts respect current clearance rules and do not fire while typing in a form or while a dialog is open.
- The map fills the entire screen. Dark controls and the flight panel float above it; movement, score and conflict KPIs are in the top bar. The panel can be hidden with its top-bar toggle.
- Ground traffic holds cost 20 points. Delayed approaches go around after 210 simulation seconds and cost 25 points. A parked arrival turns around for a new departure after 100 simulation seconds.

## MVP Scope

One airport is available in the catalog: EGPH / Edinburgh. There are 33 playable numbered terminal stands, 793 connected routing nodes, and 822 ground-network edges. The data includes 55 taxiway ways, 82 stand lead-in ways, aprons, terminal buildings, nearby buildings and roads. Runway 24 is the active direction.

The geometry is real; traffic, wind and schedules are simulated. Stand eligibility, aircraft dimensions, taxi speeds, ground separation and turnaround timing are simplified. Aircraft use mapped centerlines with interpolated headings, not full steering or towing physics. Runway occupancy is enforced, with explicit line-up and takeoff clearance. There is no live traffic, real weather, saving, multiplayer, service vehicles or full ATC phraseology. This is a game, not an operational airport tool.

For continuous sessions, departed aircraft and their conflict records are retired after handoff, while cumulative scores remain. Automatic arrivals pause when the active flight count reaches 24 and resume as space becomes available. Active callsigns stay distinct.

## Data

Map data: [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), downloaded 2026-09-20 from the [OSM map API](https://api.openstreetmap.org/api/0.6/map?bbox=-3.405,55.930,-3.332,55.969). The derived airport database is provided in `dist/data/egph.json` under the [Open Database License 1.0](https://opendatacommons.org/licenses/odbl/1-0/). Coordinates are a local equirectangular projection in metres around 55.95 N, 3.372 W. No map tiles or third-party services are requested at runtime.

Airport ingestion is reproducible with `node scripts/import-airport.mjs /path/to/egph.osm`. The importer preserves OSM way/node identities, retains the connected ground network, combines runway sections for the full runway extent, uses mapped D1 for hold-short, and selects an actual runway/taxiway junction for arrival rollout and exit. OSM holds not relevant to the active runway are drawn as taxiway geometry but do not require separate clearances in this MVP.

## Development

Run `npm install`, `npm run build`, then `npm run dev`. The local static preview is on port 4173. Run `npm test` for network and simulation checks. `node tests/browser.mjs` exercises browser controls and captures screenshots in `../work` using installed Chrome.

The simulation is in `src/sim.js`, Canvas map in `src/map.js`, and interface in `src/app.js`. The static HTML and CSS are authored in `dist/`; the build bundles JavaScript and generates the standalone HTML file. Pathfinding uses ngraph.graph and ngraph.path, and interface icons use Lucide. These libraries retain their upstream licenses in `node_modules` and bundled license notices.

WebMCP registration is optional and feature-detected: read the simulation or issue the same clearances exposed by the interface. Unsupported browsers simply run the regular game.
