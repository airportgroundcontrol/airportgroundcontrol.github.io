# Ground Control

A browser-only airport ground-control game with a data-driven airport engine. Edinburgh Airport's actual OpenStreetMap geometry is the first included package.

Continuing from another account or a fresh task? Start with [CONTINUE_HERE.md](CONTINUE_HERE.md). Planned architecture and feature work lives in [ROADMAP.md](ROADMAP.md); [AGENTS.md](AGENTS.md) preserves project instructions for coding agents.

The [architecture implementation plan](ARCHITECTURE_PLAN.md) records the completed first foundation package and the remaining phases, dependencies, save migrations and completion checks.

Open **Ground Control.html** directly in a browser. The map, icons, pathfinding and simulation are bundled; the game works without a server or internet connection. The `dist` folder is the equivalent static website.

## Play

- Play continuously with recurring arrivals and departures. There is no timer, movement target, or session end. A completed departure or arrival scores 100 points.
- Click or right-click an aircraft to open its action menu. The full-height right panel groups compact flight strips under shared request/status headers, with requests first. Requests gently pulse on the map and in their cards; reduced-motion preferences disable the animation. Clicking a strip opens the same aircraft menu. Successful commands close the menu.
- Departures: approve pushback, plan the taxi route, issue clearance, wait at D1, line up, then clear for takeoff.
- Arrivals: clear to land while the runway is available, wait for the aircraft to vacate, assign a free stand, plan and issue taxi clearance.
- Click taxiway points while planning to add intermediate waypoints. The proposed route appears on the map before clearance.
- Hold position stops a moving aircraft; a stopped taxiing aircraft can receive a revised route. Continue resumes the previous route.
- Taxi to holding point selects a named, mapped point (for example A15). The aircraft stops there and requests a new taxi clearance. Only D1 permits departure runway entry.
- Hold short of selects an upcoming mapped holding point or taxiway transition along the cleared route. At taxiway transitions the game stops the aircraft 60 metres along the route before the junction. It retains the remaining route and waits for Continue taxi; it does not automatically cross the clearance limit.
- Follow selects an aircraft sharing a forward taxi segment. Give way selects traffic whose cleared route intersects yours. Aircraft wait before the merge/crossing until that aircraft has passed and cleared, then resume automatically. Following and ordinary queues maintain a simplified 60-metre centre-to-centre spacing; normal yielding costs no points. Incompatible and circular traffic instructions are rejected. Cancel traffic instruction removes the conditional order, but never overrides spacing, a manual hold or a holding limit.
- Drag to pan, scroll or pinch to zoom, and use the fit button to restore the overview. Space pauses; 1x / 4x / 8x controls simulation speed.
- Shortcuts for the selected aircraft: P pushback; T plan taxi; Enter issue taxi clearance; H hold/resume; L land; U line up; D take off; G go around. N selects the next request, F fits the airport, and Escape dismisses the menu and cancels the route preview. The keyboard button or ? opens the reference. Shortcuts respect current clearance rules and do not fire while typing in a form or while a dialog is open.
- Additional shortcuts: B taxi to holding point; S hold short; Y follow; W give way; C continue past a holding limit; X cancel traffic instruction. Choose a target in the picker, then confirm. Enter confirms the picker when its menu is focused; select fields retain their native keyboard behavior.
- The map fills the entire screen. Dark controls and the flight panel float above it; movement, score and conflict KPIs are in the top bar. The panel can be hidden with its top-bar toggle.
- Unresolved ground conflicts cost 20 points. Normal spacing, right-of-way yielding and instructed holds do not. Delayed approaches go around after 210 simulation seconds and cost 25 points. A parked arrival turns around for a new departure after 100 simulation seconds.

## MVP Scope

One airport is available in the catalog: EGPH / Edinburgh. There are 33 playable numbered terminal stands, 793 connected routing nodes, and 822 ground-network edges. The data includes 55 taxiway ways, 82 stand lead-in ways, aprons, terminal buildings, nearby buildings and roads. Runway 24 is the active direction.

The geometry is real; traffic, wind and schedules are simulated. Stand eligibility, aircraft dimensions, taxi speeds, ground separation and turnaround timing are simplified. Aircraft use mapped centerlines with interpolated headings, not full steering or towing physics. Runway occupancy is enforced, with explicit line-up and takeoff clearance. Crossing traffic uses basic give-way-to-the-right logic; head-on blockages still need controller intervention. Conditional traffic clearances use route intersections and a fixed clearance buffer, not certified wingspan/wake separation or complete local procedures. There are no simulated stop-bar lights, live traffic, real weather, multiplayer, service vehicles or full ATC phraseology. This is a game, not an operational airport tool.

For continuous sessions, departed aircraft and their conflict records are retired after handoff, while cumulative scores remain. Automatic arrivals pause when the active flight count reaches 24 and resume as space becomes available. Active callsigns stay distinct.

## Saved Games

The game automatically saves locally in this browser, once per second, after commands and UI interactions, and when the page is hidden or closed. Reloading or reopening the same site restores aircraft, routes, clearances, holding limits, traffic instructions, runway occupancy, scheduling timers, scores and radio logs. It also restores selection, speed, pause state, filters, panel visibility, map labels, pan/zoom, and an unissued route draft. Popups and dialogs reopen closed. Time does not advance while the game is closed. Restart explicitly replaces the current save.

Storage uses a versioned `localStorage` snapshot per airport. The immutable airport graph is not saved. Loading validates simulation state, geometry revision and operational/scenario compatibility. Existing Edinburgh v1 saves are admitted by a pinned compatibility entry without changing their flight state. New v1 envelopes add configuration, scenario and operations-version metadata. Invalid/incompatible originals are preserved and copied to a recovery key when possible; the temporary fresh session cannot overwrite them until you explicitly Restart. If browser storage is unavailable or full, play still works and a warning is shown. General version migrations and a recovery-download UI remain planned.

Saves belong to the current browser profile and site address, not an account. There is no cloud sync. Clearing site data removes them; private browsing may discard them on exit. The offline HTML has a separate save, whose availability depends on the browser's local-file storage policy. Use one active game tab; simultaneous tabs are not coordinated and the most recent save wins.

## Architecture

This is a static, client-only JavaScript application with no runtime backend or framework. The modules have separate responsibilities:

| Module | Responsibility |
| --- | --- |
| `src/sim.js` | Aircraft state transitions, clearance validation, spawning, scoring, runway ownership and graph routing. No DOM or storage access. |
| `src/traffic.js` | Pure route geometry for spacing, merges, crossings and conditional traffic clearances. |
| `src/map.js` | Canvas renderer, map camera, aircraft hit testing, pan/zoom and input callbacks. |
| `src/app.js` | Menus, flight groups, keyboard shortcuts, UI state, simulation loop and coordination. |
| `src/session/game-session.js` | Owns simulation, command dispatch/results/events, pacing, restore/autosave, restart and disposal. UI and integration commands share this entry point. |
| `src/airports/package.js` | Validates/freezes airport geometry, operations and scenario data and creates the engine-facing view. |
| `src/airports/catalog.js` | Explicit bundled airport registry; the only runtime module importing Edinburgh-specific files. |
| `src/ui/airport.js` | Airport-derived header, catalog, weather, attribution and radio metadata. |
| `src/persistence.js` | Versioned snapshots, validation, save/reload and safe recovery. |
| `data/airports/egph/geometry.json` | Authored airport geometry and routing network, copied unchanged to the published `data/egph.json` URL. |
| `web/` | Authored static HTML and CSS. |
| `src/domain/contracts.ts` | State/command/session-result and geometry/operations/scenario/save contracts. |
| `scripts/import-airport.mjs` | Offline OpenStreetMap ingestion; no map API is required during gameplay. |
| `scripts/build.mjs` | esbuild bundle plus the standalone offline HTML. |

Flow: mouse/keyboard input -> validated simulation command -> time-step updates -> Canvas/DOM rendering and periodic snapshots. Routing uses A* through ngraph.graph/ngraph.path; icons use Lucide. Tests exercise the simulation without a browser and actual gameplay with Playwright.

`GameSession` now owns commands and persistence. Geometry, curated operations and scenarios are separate package inputs; the engine, UI, map and importer no longer contain Edinburgh-specific operating assumptions. Map framing and labels derive from the package. A differently shaped synthetic airport completes both flight cycles and runs the shared UI in tests. Edinburgh's geometry bytes and all archived save continuations remain unchanged. Strict type checking still covers domain contracts, traffic geometry and compile-time tests, not the entire JavaScript engine/UI. Runtime package/save validation is independent of static types. Multiple runways, general save migrations, tab ownership and fixed-step timing remain future work.

## Data

Map data: [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), downloaded 2026-09-20 from the [OSM map API](https://api.openstreetmap.org/api/0.6/map?bbox=-3.405,55.930,-3.332,55.969). The derived airport database is provided in `dist/data/egph.json` under the [Open Database License 1.0](https://opendatacommons.org/licenses/odbl/1-0/). Coordinates are a local equirectangular projection in metres around 55.95 N, 3.372 W. No map tiles or third-party services are requested at runtime.

Airport ingestion now requires explicit metadata and operational connections: `node scripts/import-airport.mjs /path/to/source.osm data/airports/egph/import.json /path/to/new-candidate.json`. It validates a candidate without overwriting existing files or guessing runway exits. The original Edinburgh data reimports byte-for-byte unchanged. See [Airport Packages](data/airports/README.md) for configuration, validation, provenance and save compatibility. Named holding points are instructed clearance limits; aircraft do not stop at every mapped point automatically. Simulated operations are not a reproduction of certified local procedures.

## Development

Use Node 22+ and `npm ci`, then `npm run verify`. Verification cleans/rebuilds `dist/`, checks packaged output and types, runs unit/archived-save tests and all four browser suites (including offline play). Browser verification needs installed Google Chrome by default and manages its own temporary server on an available port. `npm test` runs unit tests alone; `npm run test:browser` runs browser tests against the most recent build. Set `BROWSER_CHANNEL`, `BASE_URL` or `ARTIFACT_DIR` to override browser channel, an existing preview URL or the default ignored `test-results/` artifact directory. Tests use isolated browser contexts, never your personal saves.

For interactive preview, run `npm run dev` after building, then open `http://localhost:4173`. If that port is occupied, use `npx http-server dist -p 4174 -c-1` instead. `npm run format:check` checks source formatting. `npm run benchmark` records simulation/draw/save timings separately from correctness checks. Frozen references and measurement caveats are in [tests/baselines/README.md](tests/baselines/README.md).

The simulation is in `src/sim.js`, Canvas map in `src/map.js`, and interface in `src/app.js`. HTML/CSS are authored in `web/` and airport data in `data/airports/egph/geometry.json`. `dist/` is entirely generated and ignored, so cleaning it cannot remove source. The standalone HTML is generated but remains tracked for immediate offline play. Pathfinding uses ngraph.graph and ngraph.path, and interface icons use Lucide. These libraries retain their upstream licenses in `node_modules` and bundled license notices.

WebMCP registration is optional and feature-detected: read the simulation or issue the same clearances exposed by the interface. Unsupported browsers simply run the regular game.
