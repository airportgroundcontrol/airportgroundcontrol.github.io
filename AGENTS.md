# Ground Control: Project Instructions

Read `CONTINUE_HERE.md`, `ROADMAP.md`, and `README.md` before changing the project. These files provide continuity when the original conversation or account is unavailable.

## Product Constraints

- Local-only development until the user explicitly requests publishing again. Do not deploy, upload source, push to Sites, or create replacement hosting. The user requested removal of the existing hosted version on 2026-09-20; removal is still pending because the current account cannot access it.
- Browser-only, no runtime backend or API keys. Preserve both the static site and standalone offline HTML.
- Use real airport geometry and connected taxi routes. Edinburgh is the sole real catalog package, but shared code must remain airport-independent. Synthetic airports belong only in tests.
- Preserve endless play, dark default theme, full-screen map, direct map-based aircraft control, gentle request pulses, compact aircraft action menus and keyboard shortcuts. Do not reintroduce the removed flight sidebar or radio history.
- Successful actions close the menu. Requests sort before routine traffic; reduced-motion preferences are respected.
- Preserve current-format saves across normal reloads. The user explicitly rejected legacy support: use save format 2 only, with no v1 migration or parallel legacy behavior. Game saves are automatic local state only; do not add export/import, previous-save or recovery-copy UI.
- An incompatible load must block simulation and commands, not merely autosave. Keep the delete/reset decision visible until the replacement snapshot is written successfully. Never silently fall back to an unsaved random session behind a toast.

## Source and Verification

- `src/` is application source; `web/index.html` and `web/style.css` are authored UI source.
- `data/airports/egph/geometry.json` is checked-in airport data. `dist/` is entirely generated and ignored; every build cleans/recreates it. `Ground Control.html` is generated and tracked for convenient offline use. Never edit generated artifacts manually.
- Use `npm ci` with the checked-in lockfile, then `npm run verify` for a clean build, output checks, type checks, unit/fixture tests and all browser suites.
- `npm run test:browser` owns its temporary server and browsers. Installed Google Chrome is required by default; `BROWSER_CHANNEL`, `BASE_URL` and `ARTIFACT_DIR` are configurable. Output defaults to ignored `test-results/`. Run `npm run build` first when invoking browser suites alone.
- `npm run format:check` checks source formatting. `npm run benchmark` records diagnostic performance, not a pass/fail timing threshold.
- Type checking currently covers domain contracts, traffic geometry and compile-time contract tests, not the entire JavaScript engine/UI. Extend coverage as modules migrate; do not replace runtime save validation with casts.
- Preserve archived `tests/fixtures/v1/` bytes and `tests/baselines/` references. V1 fixtures now test rejection without migration, not unchanged continuation. Tests must not regenerate their own expectations. Airport data byte/hash changes need an explicit compatibility decision.
- Keep simulation/traffic logic independent of the DOM and storage. Prefer existing ngraph routing and Lucide icons over new dependencies.
- Route all application/integration commands through `GameSession`; do not add new direct engine command or storage paths in the UI.
- `GameSession` supplies new-game/restart entropy; `GroundSim` owns `randomSeed`/`randomState`. Keep all traffic randomness seeded and saved, with no random draws from rendering, validation of live state or serialization. Turnaround timing is sampled once at parking. Only a new game's opening roster may create departures at stands; ongoing departures must originate as arrivals and complete a turnaround. Scripted gameplay tests replace only the catalog; production randomized/offline tests must remain unmodified.
- Read `data/airports/README.md` for packages. Keep names, stands, runway ends/connections, schedules/scoring and map settings in data. Run `createAirportPackage` validation before starting a session. Never guess safe runway exits or add unvalidated real-airport catalog entries.
- Format-2 saves include aircraft-catalog/fleet compatibility, departure wake state and seeded random state. Exclusive browser writer locks are implemented. Missing Web Locks means volatile play only, not unsafe concurrent saves. Keep simulation at fixed 0.05-second steps; hidden tabs do not advance.
- Aircraft definitions and game performance live in `src/aircraft/`; airport fleet/stand/route limits live in `fleet.json`. Edinburgh limits are explicit game assumptions, not verified operational limits. Do not claim gear-based turns, swept-polygon collision avoidance, realistic runway performance or full wake rules are implemented.
- Ground routes may contain cubic samples with edgeFrom/edgeTo provenance between exact graph nodes. Preserve validated corridors and hold limits; do not treat visual smoothing as swept-wing or gear-based feasibility. Moving approaches and go-arounds are airborne, excluded from ground traffic checks; cleared approaches own the runway until vacated or sent around. Keep ETA, decision-point scoring and new-state save validation covered by tests.
- Do not revert unrelated changes. Update the roadmap/handoff when project assumptions or completed work change.

## Account and Hosting Boundary

- Local development requires only the project files, Node.js and npm, not the original Codex account, Sites plugin, remote Git credentials or chat history.
- `.openai/hosting.json` identifies an existing owner-private Sites deployment. Its ID is metadata, not an access credential.
- Do not assume a different account can edit/publish that site. For a publishing request, verify access through the supported Sites tools and preserve the existing audience. Do not change the existing site identity, expose it publicly, reuse old tokens, or provision replacement hosting just to continue local development.
- No remote Git is configured locally; prior Sites pushes used temporary per-command credentials. Do not store credentials in Git configuration or project files.
- `portability/` contains generated, ignored backups, not source. Refresh them after relevant changes if the user needs a new transfer snapshot.
