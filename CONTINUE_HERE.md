# Continue Ground Control

This project can be developed from a fresh Codex task or another account without access to the original conversation. The repository, this handoff, project instructions and roadmap are the source of continuity.

## Same Computer, Another Account

1. Sign in to the desired account using the app's supported sign-in flow. No login files or account tokens need to be copied.
2. Add/open this existing local folder as the task's main project folder:

   `/Users/marco/Documents/Codex/2026-09-20/i-w/outputs`

3. Start a task with: **"Continue the Ground Control game in this folder. Read AGENTS.md, CONTINUE_HERE.md, ROADMAP.md and README.md first. Summarize the current state and help me choose the next roadmap item. Preserve existing saves and keep the game browser-only."**
4. Check `git status` before editing. Do not run two coding sessions against the same checkout simultaneously.

The new account must itself have access to Codex/local development, and the app must have filesystem access to this folder. This handoff does not grant account entitlements, migrate conversations, or transfer hosted-site ownership. Do not depend on the old conversation appearing after signing in.

## Portable Backups

The ignored `portability/` folder contains two snapshots created with this handoff:

- `ground-control-source.zip`: complete tracked source, lockfile, airport data, tests, docs, built site and offline game. No Git history or installed dependencies.
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
npm run build
npm test
npm run dev
```

Open `http://localhost:4173`. The static server is only a local development convenience; gameplay has no backend. `Ground Control.html` can also be opened directly offline without Node or a server.

In a second terminal, with Google Chrome installed:

```sh
mkdir -p ../work
node tests/browser.mjs
node tests/traffic-browser.mjs
node tests/persistence-browser.mjs
```

The browser tests use Playwright with `channel: 'chrome'` and save screenshots in `../work`. If port 4173 is occupied by another project, use a different preview port and adjust the browser-test URLs together rather than terminating another project's process.

## Current State

- Latest gameplay implementation commit before this handoff: `fb7b28f85f486d62a2cb5040ccc13e3dc212aa25`.
- Last gameplay verification: 31 unit tests plus all three browser suites passed, including mobile layouts and offline save/reload.
- Gameplay: endless Edinburgh arrivals/departures, pushback, graph taxi routing, holds, follow/give-way, runway entry/takeoff, grouping and subtle request pulses.
- Persistence: localStorage per airport, versioned/validated snapshots, save on commands, periodic autosave, restore of simulation and view state. No elapsed-time catch-up while closed.
- Current limits: one airport/active runway; simplified separation and aircraft physics; no stop-bar simulation, multiplayer, account sync or save export/import.
- Work requested next is recorded in `ROADMAP.md`; those architecture changes are not yet implemented.

## Architecture and Editing Map

- `src/sim.js`: state machine, clearance validation, graph/A* routes, traffic spawning, scoring and runway occupancy.
- `src/traffic.js`: pure crossing/merging/spacing geometry.
- `src/map.js`: Canvas rendering, camera, hit testing and map interactions.
- `src/app.js`: UI, input handlers, menu state, flight groups and simulation loop.
- `src/persistence.js`: save format, validation and recovery.
- `dist/index.html`, `dist/style.css`: authored UI source. Keep these when cleaning generated files.
- `dist/data/egph.json`: real OSM-derived geometry and routing graph; preserve attribution/license.
- `scripts/build.mjs`: bundles `src/app.js` into `dist/app.js` and regenerates the offline HTML.
- `scripts/import-airport.mjs`: optional offline data importer. Existing development does not require refetching airport data.

## Hosting and Account Access

Existing live URL: https://ground-control-edinburgh.marco-boelling453907.chatgpt.site

Existing Sites project: `appgprj_6aafae3cccd0819181f9d719d008f9e6`, preserved in `.openai/hosting.json`. Last gameplay publication was version 5. The site was owner-private when published.

Local development/build/testing does not require the Sites plugin or this account's hosted repository. Publishing to that existing site is different: the signed-in account needs the required permissions and an available Sites connection. Verify access when publishing is requested. If unavailable, continue locally and resolve authorized sharing/ownership or separately requested replacement hosting with the user. Do not invent a transfer, guess credentials, change the site's audience, or silently replace its ID.

This handoff does not migrate gameplay progress between browser profiles or URLs. Existing progress stays in the browser's storage at its original address. Use one active game tab; simultaneous tabs currently use last-write-wins saves.

## Reference

Official documentation describes [local project folders](https://learn.chatgpt.com/docs/projects) and [AGENTS.md project instructions](https://learn.chatgpt.com/docs/agent-configuration/agents-md). Those mechanisms supply file-based continuity; they do not establish that conversations or hosted-site access transfer between accounts.
