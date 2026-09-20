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

- First architecture package: baseline commit `c811f0d`, dedicated mechanical-format commit `1a85858`, followed by source-layout/type-contract work. Use `git log -3 --oneline` for exact current checkpoints; original gameplay baseline is `fb7b28f85f486d62a2cb5040ccc13e3dc212aa25`.
- Current verification covers 70 unit/fixture/importer tests, strict current type checks, build/offline checks and four browser suites, including five responsive viewports, synthetic airports, per-airport save switching and offline save/reload. Archived v1 saves and performance/visual references are under `tests/fixtures/v1/` and `tests/baselines/`.
- Implementation checkpoint `a29e7ee` was also exported into a fresh directory and passed `npm ci` plus `npm run verify` without existing `dist/` or dependencies. A deliberately invalid browser-test URL exited with failure and cleaned up, as expected. Source formatting checks pass.
- Gameplay: endless Edinburgh arrivals/departures, pushback, graph taxi routing, holds, follow/give-way, runway entry/takeoff, grouping and subtle request pulses.
- GameSession was extracted first in commit `f4b8bac`: one owner for engine, UI/integration command dispatch and events, pacing, restore/autosave/restart/disposal. The subsequent airport refactor is recorded in Git history.
- Persistence: localStorage per airport, unchanged v1 aircraft state plus additive configuration/scenario/operations envelope metadata. Pinned legacy admission preserves existing Edinburgh saves. Invalid/incompatible originals stay protected until explicit Restart. No elapsed-time catch-up while closed.
- Current limits: one airport/active runway; simplified separation and aircraft physics; no stop-bar simulation, multiplayer, account sync or save export/import.
- The user requested GameSession followed by airport independence. Both are implemented: curated geometry/operations/scenario packages drive engine, renderer, UI and generic importer. The original Edinburgh geometry and 23 archived simulation continuations are unchanged. Initial contracts and traffic geometry are type checked; full engine/UI conversion remains incremental.
- Next recommended work: remaining Phase 2 save tooling (general migrations, recovery downloads, export/import and single-writer tab ownership), then focused UI extraction. Multiple runways, aircraft-size eligibility, fixed-step replay and a second real airport are not implemented. Do not mark all Phase 2 complete just because GameSession exists.

## Architecture and Editing Map

- `src/sim.js`: state machine, clearance validation, graph/A* routes, traffic spawning, scoring and runway occupancy.
- `src/traffic.js`: pure crossing/merging/spacing geometry.
- `src/map.js`: Canvas rendering, camera, hit testing and map interactions.
- `src/app.js`: UI, input handlers, menu state, flight groups and simulation loop.
- `src/persistence.js`: save format, validation and recovery.
- `src/session/game-session.js`: engine/command/save lifecycle owner; no DOM access.
- `src/airports/package.js`: validate/freeze packages and build the engine view. `catalog.js`: explicit production catalog.
- `src/ui/airport.js`: configuration-derived header, catalog, attribution, weather and radio metadata.
- `web/index.html`, `web/style.css`: authored UI source.
- `data/airports/egph/geometry.json`: real OSM-derived geometry and routing graph; preserve attribution/license and compatibility hash.
- `data/airports/egph/operations.json`, `scenario.json`, `compatibility.json`, `import.json`: curated operations, scenario, pinned legacy compatibility and importer descriptor. Read `data/airports/README.md` before adding an airport.
- `src/domain/contracts.ts`: branded IDs and geometry/operations/scenario, aircraft, command/session-result, UI and save contracts.
- `scripts/build.mjs`: cleans/recreates ignored `dist/`, copies UI/data, bundles JavaScript and regenerates the tracked offline HTML. Published filenames are unchanged.
- `scripts/test-browser.mjs`: owns the temporary verification server; `tests/browser-support.mjs` centralizes browser/environment/output settings.
- `scripts/import-airport.mjs`: generic offline importer requiring source OSM, airport descriptor and a new candidate output path. It never overwrites existing files or guesses an exit. Existing development does not require refetching airport data.

## Hosting and Account Access

Existing live URL: https://ground-control-edinburgh.marco-boelling453907.chatgpt.site

Existing Sites project: `appgprj_6aafae3cccd0819181f9d719d008f9e6`, preserved in `.openai/hosting.json`. Last gameplay publication was version 5. The site was owner-private when published.

The architecture checkpoint was not published: on 2026-09-20 the current Sites connection returned `Sites project not found`. Do not treat the hosted version as updated or create replacement hosting automatically. Existing site identity/access settings were not modified; local files and verification do not depend on that account.

Local development/build/testing does not require the Sites plugin or this account's hosted repository. Publishing to that existing site is different: the signed-in account needs the required permissions and an available Sites connection. Verify access when publishing is requested. If unavailable, continue locally and resolve authorized sharing/ownership or separately requested replacement hosting with the user. Do not invent a transfer, guess credentials, change the site's audience, or silently replace its ID.

This handoff does not migrate gameplay progress between browser profiles or URLs. Existing progress stays in the browser's storage at its original address. Use one active game tab; simultaneous tabs currently use last-write-wins saves.

## Reference

Official documentation describes [local project folders](https://learn.chatgpt.com/docs/projects) and [AGENTS.md project instructions](https://learn.chatgpt.com/docs/agent-configuration/agents-md). Those mechanisms supply file-based continuity; they do not establish that conversations or hosted-site access transfer between accounts.
