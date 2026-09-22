# Continue Ground Control

This project can be developed from a fresh Codex task or another account without access to the original conversation. The repository, this handoff, project instructions and roadmap are the source of continuity.

## Same Computer, Another Account

1. Sign in to the desired account using the app's supported sign-in flow. No login files or account tokens need to be copied.
2. Add/open this existing local folder as the task's main project folder:

   `/Users/marco/Documents/Github/airportgroundcontrol`

3. Start a task with: **"Continue the Ground Control game in this folder. Read AGENTS.md, CONTINUE_HERE.md, ROADMAP.md and README.md first. Summarize the current state and help me choose the next roadmap item. Preserve existing saves and keep the game browser-only."**
4. Check `git status` before editing. Do not run two coding sessions against the same checkout simultaneously.

The new account must itself have access to Codex/local development, and the app must have filesystem access to this folder. This handoff does not grant account entitlements, migrate conversations, or transfer hosted-site ownership. Do not depend on the old conversation appearing after signing in.

## Portable Backups

The ignored `portability/` folder contains two snapshots created with this handoff:

- `ground-control-source.zip`: complete tracked source, lockfile, airport data, tests, docs and offline game. Generated `dist/` is rebuilt with npm, not included. No Git history or installed dependencies.
- `ground-control-history.bundle`: the local Git history and committed files. No remote credentials or Codex authentication state.

On another machine, either extract the ZIP and open the extracted folder, or restore history with:

```sh
git clone /path/to/ground-control-history.bundle ground-control
```

The clone's `origin` points to the local bundle, not an online Git host. It is a restore source, not a publish destination. A separately authorized remote can be configured later.

Backups are snapshots, not continuous synchronization. They exclude `node_modules`, browser saves, local preview processes, temporary screenshots, account credentials and chat history. They retain `.openai/hosting.json` only as existing-site metadata; it does not grant access.

## Run and Verify

From the project root, using a current supported Node.js installation (Node 22+ recommended for this project):

```sh
npm ci
npm run verify
npm run dev
```

Open `http://localhost:4173`. The static server is only a local development convenience; gameplay has no backend. `Ground Control.html` can also be opened directly offline without Node or a server.

With Google Chrome installed, browser tests can also run independently against the latest build:

```sh
npm run test:browser
npm run typecheck
npm run format:check
```

The browser runner owns a temporary server on an available port and closes its browsers/server on completion or failure. It uses installed Chrome by default and saves screenshots in ignored `test-results/`. Override `BROWSER_CHANNEL`, `BASE_URL` or `ARTIFACT_DIR` when needed. If preview port 4173 is occupied, use `npx http-server dist -p 4174 -c-1` rather than terminating another project's process. Browser tests do not need that preview server.

## Current State

- Reload fix: an incompatible saved game used to block autosave but still allow a temporary random game to run, making every reload appear to erase progress. `GameSession.awaitingRecovery` now blocks commands/ticks and opens the delete/reset confirmation. A newly randomized replacement must save successfully before play unlocks. Current-format seed/state compatibility is unchanged by this fix; no reset is required for existing seeded saves. File-URL regressions cover the actual failure path, failed reset writes and subsequent reload.

- Latest traffic update: airport scenarios configure opening traffic, schedules, planning windows and turnarounds. Edinburgh starts with 2-4 departures and 1-2 arrivals; Frankfurt starts with 3-7 and 1-3. The opening roster is the only source of gate-side aircraft; every later departure is a completed arrival turnaround. `GameSession` supplies crypto seeds, `GroundSim` owns a saved xorshift32 state, and reload restores the exact sequence. Behavior fingerprint is `ground-v7-runway-configuration`; audited previous format-2 fingerprints keep current production saves loadable. No legacy migration or replay UI.

- Latest flow update: bounded centerline curves, gradual manual Hold braking, slow stand docking, directional pushback picker/preview (R), moving approaches and anticipated runway separation. Landing clearance reserves a future threshold slot; takeoff and rolling departure (O) use aircraft performance and simplified heavy-wake buffers to fit before it. Forecast loss at the 8-second decision point triggers a go-around plus conflict penalty. Rolling entry, future slots and penalties survive reload.

- Aircraft artwork refreshed with original, type-specific vector silhouettes, rounded fuselages, engine nacelles and thin outlines. No FR24 assets or remote icon dependencies. Browser verification includes a three-zoom artwork sheet and pixel bounds checks; simulation dimensions/save compatibility are unchanged.

- Latest implementation: eleven aircraft types and original silhouettes. A21N, A223, DH8D, B77W, B748 and A359 join AT72, E190, A320, B738 and A333. Dimensions, stand/route restrictions, adjacent reservations, acceleration/braking/corner speeds, tug sequence, type-dependent turnaround, size-aware spacing, conservative runway-exit clearance and simplified departure wake delays are active. Limits are game assumptions on real geometry.
- FRA / EDDF is the second playable real airport. Its September 2026 OSM package has 7,424 routing nodes, 7,925 unique edges, 17 connected playable Terminal 1/cargo stands and all four physical runways. Both directions of the parallel runway system plus departure-only runway 18 have curated entries/exits. West/east normal and reduced presets are included; custom roles enforce runway-end capabilities. FRA opens with 3-7 departures and 1-3 arrivals, ten-minute base approach planning and a 55-minute narrow-body turnaround baseline.
- First architecture package: baseline commit `c811f0d`, dedicated mechanical-format commit `1a85858`, followed by source-layout/type-contract work. Use `git log -3 --oneline` for exact current checkpoints; original gameplay baseline is `fb7b28f85f486d62a2cb5040ccc13e3dc212aa25`.
- Verification covers 120 unit tests, current type checks, build/offline checks and eight browser suites. The production FRA suite checks the four-runway map, live runway planner, long-ETA approaches, desktop/mobile framing, configuration persistence and offline selection. Aircraft-flow browser coverage includes anticipated slots and rolling-departure shortcut/reload. Archived v1 fixtures verify unsupported-save rejection without mutation.
- Implementation checkpoint `a29e7ee` was also exported into a fresh directory and passed `npm ci` plus `npm run verify` without existing `dist/` or dependencies. A deliberately invalid browser-test URL exited with failure and cleaned up, as expected. Source formatting checks pass.
- Gameplay: endless Edinburgh or Frankfurt arrivals and aircraft rotations, pushback, graph taxi routing, holds, follow/give-way, runway entry/takeoff, grouping and subtle silhouette request pulses without aircraft selection circles.
- GameSession was extracted first in commit `f4b8bac`: one owner for engine, UI/integration command dispatch and events, pacing, restore/autosave/restart/disposal. The subsequent airport refactor is recorded in Git history.
- Persistence: one automatic local format-2 snapshot per airport, explicitly no legacy support/migrations or manual game transfer by user request. Reload restores the current state and PRNG position. The top-bar trash button resets it. Browser locks allow one writer per airport; unsupported locks mean volatile play. Fixed 0.05-second simulation steps; hidden tabs do not advance or catch up.
- Current limits: two shipped real airports; reference-point curves and approximate separation, not swept-wing clearance or minimum-radius/gear simulation. Multiple physical runways, live arrival/departure/mixed/closed roles, anticipated landing/takeoff sequencing, committed-traffic changeovers and declared crossings are supported. One future arrival slot per physical runway is modeled; intersecting-runway dependency groups are not. No jet blast, certified wake minima, realistic weight/weather/runway suitability, stop-bar simulation, multiplayer or account sync. Directional pushbacks cover four Edinburgh stands; FRA currently uses straight-back stand paths. Limits remain game assumptions; go-arounds depart rather than rejoin.
- The original Edinburgh geometry is unchanged. Contracts and traffic geometry are type checked; full engine/UI conversion remains incremental. Aircraft types must exist in the bundled catalog.
- Next recommended work: gear-aware curved trajectories and swept-footprint clearance, supported by curated taxiway corridors; then refined runway/arrival-wake rules. Verify real airport stand/pavement restrictions before presenting current game assumptions as authentic procedures. UI extraction and writer takeover remain queued. Do not reintroduce legacy support.

## Architecture and Editing Map

- `src/sim.js`: state machine, clearance validation, graph/A* routes, traffic spawning, scoring and runway occupancy.
- `src/traffic.js`: pure crossing/merging/spacing geometry.
- `src/map.js`: Canvas rendering, camera, hit testing and map interactions.
- `src/app.js`: UI, input handlers, menu state, flight groups and simulation loop.
- `src/persistence.js`: automatic local save format, validation, reload and reset.
- `src/session/game-session.js`: engine/command/save lifecycle owner; no DOM access.
- `src/session/random.js`: fresh nonzero crypto seeds and pure xorshift32 transition. Engine draws only for simulation events; never consume PRNG state in rendering or serialization.
- `src/airports/package.js`: validate/freeze packages and build the engine view. `catalog.js`: explicit production catalog.
- `src/ui/airport.js`: configuration-derived header, catalog, attribution and weather metadata.
- `web/index.html`, `web/style.css`: authored UI source.
- `data/airports/egph/` and `data/airports/eddf/`: real OSM-derived geometry plus curated operations, scenario, aircraft limits and importer descriptors. Preserve attribution, license and compatibility decisions. Legacy compatibility metadata was removed. Read `data/airports/README.md` before changing an airport.
- `src/domain/contracts.ts`: branded IDs and geometry/operations/scenario, aircraft, command/session-result, UI and save contracts.
- `scripts/build.mjs`: cleans/recreates ignored `dist/`, copies UI/data, bundles JavaScript and regenerates the tracked offline HTML. Published filenames are unchanged.
- `scripts/test-browser.mjs`: owns the temporary verification server; `tests/browser-support.mjs` centralizes browser/environment/output settings.
- `scripts/import-airport.mjs`: generic offline importer requiring source OSM, airport descriptor and a new candidate output path. It never overwrites existing files or guesses an exit. Existing development does not require refetching airport data.

## Hosting and Account Access

**Local-only, by user request (2026-09-20). Do not publish, upload source, or create replacement hosting unless the user explicitly requests publishing again.** The user also requested removal of the existing hosted version. Removal is pending: the current account again received `Sites project not found`, and no remote deletion or unpublishing was performed. Resume removal through the owning account's authorized site management; do not mistake local documentation changes for taking the site offline.

Previously published URL (removal not confirmed): https://ground-control-edinburgh.marco-boelling453907.chatgpt.site

Existing Sites project: `appgprj_6aafae3cccd0819181f9d719d008f9e6`, preserved in `.openai/hosting.json`. Last gameplay publication was version 5. The site was owner-private when published.

The architecture checkpoint was not published: on 2026-09-20 the current Sites connection returned `Sites project not found`. Do not treat the hosted version as updated or create replacement hosting automatically. Existing site identity/access settings were not modified; local files and verification do not depend on that account.

Local development/build/testing does not require the Sites plugin or this account's hosted repository. Publishing to that existing site is different: the signed-in account needs the required permissions and an available Sites connection. Verify access when publishing is requested. If unavailable, continue locally and resolve authorized sharing/ownership or separately requested replacement hosting with the user. Do not invent a transfer, guess credentials, change the site's audience, or silently replace its ID.

Progress remains local to its browser profile/address and cannot be manually transferred. V1 saves are unsupported. A browser lock prevents a second tab from writing the same airport; close the first tab and reload the second. No forced writer takeover is implemented.

## Reference

Official documentation describes [local project folders](https://learn.chatgpt.com/docs/projects) and [AGENTS.md project instructions](https://learn.chatgpt.com/docs/agent-configuration/agents-md). Those mechanisms supply file-based continuity; they do not establish that conversations or hosted-site access transfer between accounts.
