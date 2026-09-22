# Ground Control: Architecture Implementation Plan

## Current Overrides

The aircraft-realism update supersedes older compatibility requirements below. The user explicitly requested **no legacy support** and later removed manual game transfer: format-2 automatic local saves only, no v1 migration, alternate engine, export/import, or previous/recovery UI. Exclusive browser writer locks and fixed 0.05-second steps are implemented. Missing Web Locks uses volatile play, not a non-atomic lock fallback. Writer takeover remains unimplemented.

Eleven aircraft definitions/silhouettes, type-specific movement parameters, stand/route eligibility, adjacent reservations, tug disconnection, dimension-based separation and simplified departure-wake delays are implemented. Edinburgh and Frankfurt use real OSM geometry; fleet restrictions are game assumptions. Curved gear-based paths, swept-footprint collision detection, jet blast and detailed runway/arrival-wake modeling remain incomplete. See `AIRCRAFT_REALISM_PLAN.md` for the current scope. Work is local-only; do not publish.

The checkpoint and original phased plan below are historical design context, not the current feature inventory. Use `CONTINUE_HERE.md` and `ROADMAP.md` for current status.

Status: Phase 0/1 foundation complete; GameSession, data-driven airport packages, multi-runway resources and persistent live runway configuration are implemented. Broader Phase 2 save tooling and the remaining physical-clearance/performance work remain planned.
Baseline: gameplay commit `fb7b28f85f486d62a2cb5040ccc13e3dc212aa25`; handoff commit `3acbe2295a00cd3442ece851e95aa7db6e440479`.
Goal: evolve the playable MVP into a maintainable, multi-airport ground-control game without a rewrite, a backend, or lost progress.

## Implementation Checkpoint

- Phase 0: 23 archived v1 saves with continuation digests, configurable/self-contained browser runner, desktop/mobile references and same-machine performance report under `tests/baselines/`.
- Phase 1: readable source, `web/`, unchanged geometry bytes, disposable build output, offline packaging and initial contracts. Strict TypeScript still covers contracts/traffic geometry, not the whole legacy engine/UI.
- Phase 2 subset: `GameSession` owns engine, command results, pacing, restore/save/reset/disposal. UI and integration commands share dispatch. The former radio event history was removed from runtime and persistence. Incompatible state blocks play until explicit deletion successfully writes a replacement. Manual transfer and save-history features are out of scope by user request.
- Airport package foundation (Phase 3/6): immutable geometry/operations/scenario inputs with runtime validation; no Edinburgh-specific operating assumptions in shared engine/map/UI/importer. Multiple physical runways and active ends, per-aircraft runway assignment, independent/shared pavement occupancy, per-runway wake state, declared runway crossings and airport-constrained runway presets/custom roles are supported. Curated arrival vacate paths replace inferred exits. The generic importer requires an explicit descriptor and writes only new validated candidates.
- User-directed sequence: GameSession first, then airport independence, without waiting for all Phase 2 product tooling. No aircraft-state migration was needed: v1 state/geometry and all 23 continuation fixtures remain identical. Additive envelope metadata identifies scenario/operations/configuration and pinned legacy compatibility. See `data/airports/README.md`.
- Verification: 120 unit/fixture/importer checks, strict current type checks, eight browser suites, desktop/mobile Canvas and runway-planner checks, anticipated-separation/rolling-departure reload coverage, production/synthetic per-airport save switching and offline builds. Original Edinburgh OSM reimport matches existing geometry bytes exactly.
- Next: continue focused UI/typed-boundary extraction, gear-aware trajectories and swept-footprint clearance. Frankfurt is the second bundled real airport.
- Publishing this checkpoint is currently blocked: the connected account returns `Sites project not found` for the existing site. Local development and testing are unaffected; existing hosting metadata/audience remain untouched.

## Decisions and Guardrails

- Keep the client-only architecture, Canvas rendering, existing graph/A* libraries, Lucide icons, static hosting and standalone offline HTML.
- Do not introduce React, an entity-component system, a general plugin framework, a worker, or a database simply for architectural neatness.
- Introduce TypeScript incrementally at domain boundaries, with runtime validation at data/save/import boundaries. Static types do not validate saved JSON.
- Separate immutable airport data, operating scenarios, live simulation state, UI state and persisted snapshots.
- All command entry points use the same rules: mouse, keyboard, optional WebMCP integration and future replay. The UI must not independently decide whether a clearance is legal.
- Preserve current appearance and interaction behavior. This project is an architecture upgrade, not a redesign.
- Keep each phase playable and independently reviewable. Mechanical formatting, module movement and behavioral changes belong in separate commits.
- Treat save preservation as an acceptance criterion. Never map an aircraft onto new geometry by guessing its nearest node.
- Keep development independent of a Codex account or hosting provider. Deployment access stays a separate concern.

## Original Constraints

Historical baseline findings below motivated the plan. The checkpoint above records what is now resolved; remaining phase descriptions retain their full intended scope.

| Area | Current limitation | Consequence |
| --- | --- | --- |
| `sim.js` | Shared logic hard-codes initial stands, runway 24, D1, spawn intervals and one `runwayOwner` | A second airport or runway needs more than another JSON file |
| `app.js` | Bootstrap, menus, shortcuts, rendering, save coordination and animation loop share module state | New controls tend to affect unrelated behavior |
| `map.js` | Reads DOM layout and contains Edinburgh-specific camera extents, labels and runway direction text | Rendering is not yet airport-independent |
| `persistence.js` | Version 1 and a geometry hash, but no migration chain; unsupported saves start a fresh game after attempted recovery backup | Schema changes need explicit migration and recovery behavior |
| Clock | Simulation step size depends on rendered-frame duration; traffic checks update aircraft sequentially | Replay and timing comparisons need a defined simulation policy |
| Build | Authored HTML/CSS and airport data live inside `dist/` beside generated output | A routine output cleanup could delete source |
| Browser saves | Multiple tabs can overwrite the same save | Session ownership needs protection |
| Importer | Edinburgh-specific runway/hold selection and inferred arrival exit | Additional airports need curated operations, not geometry alone |

The last verified baseline has 31 unit tests and three browser suites. Re-run them when implementation begins; treat that count as a historical baseline, not a completion target.

## Target Boundaries

```text
Airport package + scenario
            |
            v
       Game session <---- versioned save / migration / browser storage
        |        ^
        |        | typed commands, outcomes and simulation events
        v        |
 Simulation engine <---- fixed-step clock
   |       |       |
 routing traffic runway rules
        |
        v
 Read-only view data ----> Canvas map + compact dialogs
                                |
                                v
                          user intentions
```

Proposed module destinations, created only as their responsibilities are extracted:

```text
src/
  main.ts                 composition/bootstrap only
  domain/                 state, commands, airport/scenario contracts
  airports/               catalog, validated adapters and loaders
  engine/                 simulation, routing, traffic, runway rules, clock
  session/                command dispatch, active game, lifecycle
  persistence/            snapshots, migrations, validation, storage adapters
  ui/                     menus, flight groups, toolbar, keyboard handling
  map/                    renderer, camera, pointer interaction
web/                      authored HTML/CSS
data/airports/egph/        geometry, operations, scenarios, provenance
tests/fixtures/           archived saves and deterministic scenarios
dist/                     generated static deployment only
```

Keep functions together until there is a real ownership boundary; the directory tree is not a demand for one file per concept. Framework-free DOM components are sufficient.

## Phase 0: Protect the Baseline

Deliverables:
- Add reproducible scripts for unit tests, all browser suites and build verification. Make browser-test base URL/output paths configurable instead of relying on port 4173 and `../work` everywhere.
- Capture synthetic version-1 save fixtures at every lifecycle stage, including mid-edge taxi, runway occupancy, a held aircraft, follow/give-way, parked turnaround and a pending route draft. Do not commit personal browser data.
- Capture representative desktop/mobile screenshots and document which existing behaviors are intentional simplifications.
- Record baseline simulation/render/save costs on the same machine at 24 active aircraft; measure larger synthetic workloads separately.

Acceptance: a fresh checkout builds and passes the full suite; tests run independently and leave no preview processes behind. Offline HTML boots without network access. No gameplay or save-format change.

## Phase 1: Readable Source and Typed Contracts

Depends on Phase 0.

Deliverables:
- Format dense source and tests in a dedicated mechanical commit, verified against the baseline.
- Move authored HTML/CSS and airport data out of `dist/`. Update the importer, bundler, test fixtures and offline packager together. Preserve the published filenames/URLs and airport data bytes in this step.
- Add incremental TypeScript checks, retaining existing JavaScript through adapters while modules are converted. Retain esbuild; do not replace the build system.
- Define explicit `AirportDefinition`, `ScenarioDefinition`, `AircraftState`, `SimulationState`, `Command`, `CommandResult`, `SimulationEvent`, `UiState` and `SaveEnvelope` types. Distinguish aircraft IDs, node IDs, runway IDs and runway-end IDs.
- Express command payloads as discriminated unions. Model lifecycle-specific state carefully so a landing aircraft requires an exit and a conditional traffic instruction requires a target.
- Keep serialized version-1 data unchanged; types describe existing behavior first.

Acceptance: type checks, baseline tests and offline build pass; cleaning/rebuilding `dist/` cannot delete source; no UI changes or new simulation rules.

## Phase 2: Session Ownership and Save Evolution

Depends on Phase 1; complete before changing simulation state shapes.

Deliverables:
- Introduce a `GameSession` that owns the live engine, command dispatch, selected airport/scenario and save lifecycle. Keep command application synchronous initially; do not add an event bus framework.
- Route UI and optional integration commands through this entry point. Return structured command results so saving cannot be missed by one input path.
- Introduce a tested migration pipeline: parse envelope -> recognize version -> migrate a copy -> validate against airport data -> construct the engine -> activate session.
- Separate save-schema version, airport geometry revision and scenario version. Preserve original bytes until migration, validation and the replacement write have all succeeded.
- Unsupported or damaged saves must not be silently replaced with a new game. Block play and require an explicit delete/reset from the top bar.
- Manual save export/import and save-history UI were deliberately removed; persistence remains automatic and browser-local.
- Add single-writer ownership per airport save. Only the active owning tab simulates/writes; a second tab is read-only until an explicit takeover. Use browser locking when available; otherwise refuse competing writes and present a single-tab fallback rather than pretending a storage timestamp is atomic.
- Keep localStorage for the current compact snapshots behind an adapter. Change storage technology only if measured size/write cost requires it. Test hosted and local-file behavior separately.

Acceptance now follows the no-legacy/no-transfer decision: archived version-1 fixtures are rejected without mutation; blocked/quota-limited storage cannot unlock an unsaved replacement; a stale tab cannot write concurrently; current format reloads identically offline.

## Phase 3: Data-Driven Airports and Scenarios

Depends on Phases 1-2.

Deliverables:
- Split airport geometry from operational configuration. Preserve OSM node/way IDs and attribution; assign stable IDs to game-specific operational resources.
- Configure stands, eligible aircraft, pushback paths, physical runways, runway ends, holding points, entry/exit connections, protected areas and map bounds/label anchors.
- Define scenarios separately: active runway ends, initial traffic, flight mix, spawn cadence, capacity limits, turnaround timing and scoring settings. Keep an Edinburgh legacy scenario matching today's game.
- Replace hard-coded numbers/text in the engine, UI, renderer and importer with configuration-derived values. Distinguish runway length/width/boundary data from the current proximity-to-centreline heuristic.
- Add package validation for missing/duplicate IDs, disconnected routes, illegal runway traversal, usable pushback exits and unreachable stands. A malformed package should fail before gameplay starts.
- Keep the existing single-runway engine behind an adapter while migrating configuration. Map legacy saves to the same Edinburgh nodes and positions; no geometry reinterpretation in this phase.
- Exercise a small differently named/shaped synthetic airport in tests. It is a test fixture, not a fabricated real-airport catalog entry.

Acceptance: the same engine completes arrival/departure flows at Edinburgh and the synthetic airport without airport-name conditionals. Core/UI code contains no operational dependency on `EGPH`, `24`, `D1` or stands `3/8/20`. Map fitting derives from bounds. Existing saves remain valid through migration.

## Phase 4: UI and Renderer Separation

Depends on Phases 2-3.

Deliverables:
- Extract menus, flight groups, toolbar and keyboard handling from `app.js`. Keep only composition in the entry point.
- Expose one engine/session query for available actions and rejection reasons; menus, shortcuts and integration commands use the same capability definitions and authoritative validation.
- Split persistent UI preferences/drafts from temporary popups, focus and hover state. Saving should observe state changes, not arbitrary global clicks/keystrokes.
- Pass the renderer a read-only view model and viewport insets. Remove queries for header DOM elements from map logic; emit selection/waypoint/pan intentions back to the session/UI.
- Separate world coordinates from screen coordinates and retain the current camera behavior, readable labels and hit targets.
- Keep fixed-size controls, request grouping, reduced-motion behavior, keyboard/form guards and popup closing behavior unchanged.

Acceptance: mouse, keyboard and integration calls produce equivalent outcomes; map fitting works at all existing viewports; draft routes and preferences survive reload.

## Phase 5: Reproducible Simulation Timing

Current delivery: fixed 0.05-second steps, hidden-tab pause and saved seeded traffic are implemented. New-game entropy comes from `GameSession`; simulation draws and sampled turnaround durations persist exactly. Tick-stamped command traces and replay controls remain queued. Older saves are preserved but not migrated, per the user's no-legacy-support requirement.

Depends on Phases 2-4; establish this before expanding runway interactions.

Deliverables:
- Introduce a fixed simulation step, initially 0.1 seconds, driven by an accumulator. Render independently with interpolation if needed. Speed controls change the number of simulation steps, not the rules.
- Explicitly freeze while hidden/suspended, clear accumulated wall-clock debt on resume and never simulate time spent closed. Bound catch-up work so a slow frame cannot lock the UI or advance hours of traffic.
- Apply commands at defined step boundaries and give them sequence numbers. Define stable aircraft/update ordering for equal-priority events.
- Preserve existing deterministic scheduling. If scenario randomness is introduced, use a seeded generator and persist its state; do not add randomness just to justify a generator.
- Add a bounded command/event trace for reproducing test failures. Full replay UI is a later product feature.
- Migrate old saves without applying elapsed wall time or invalidating remaining routes. Start old sessions at a defined tick with zero accumulated debt.

Acceptance: identical initial state and tick-stamped commands produce identical state at the same tick within one supported runtime regardless of 30/60/120Hz rendering or 1x/4x pacing. Assert numerical tolerances across browser engines, not unproven bitwise identity. Pause, resume, reload and background tests pass.

## Phase 6: Multiple Runways and Protected Crossings

Depends on Phases 3-5; this is a behavior expansion, not a field rename.

Deliverables:
- Replace the scalar `runwayOwner` with a runway resource table. Model a physical runway separately from its operational ends: 06 and 24 share the same pavement and must never acquire independent incompatible clearances.
- Distinguish issued reservations/clearances from physical occupancy. Define acquire/release transitions for landing, lineup, takeoff, crossing, vacating and cancellation.
- Model conflicts between intersecting runways/protected areas, not only occupancy within each runway. Independent non-conflicting runways may operate together; crossing resources are reserved atomically.
- Store intended runway end and associated entry/exit/hold in aircraft clearance state. An ordinary taxi route must stop before every protected runway boundary without a matching crossing/entry clearance.
- Replace broad `allowRunway=true` routing with permission for the specifically cleared resource and route segment. A lineup clearance cannot authorize passage across another runway.
- Implemented: runway selection/status controls use airport presets or capability-constrained custom roles. Mid-operation changes preserve committed approaches and runway-bound departures, reroute uncommitted departures and expose a persisted transition state until the old flow clears.
- Migrate version-1/legacy runway ownership to Edinburgh's physical runway resource without releasing an existing aircraft's protection.

Acceptance: tests cover opposing ends of one runway, two independent runways, intersecting runways, runway crossings, held crossings, landing/vacating, wrong-runway commands, cancelled reservations, save/reload while occupied, and invalid stand/runway routes. Edinburgh's existing cycle still passes.

## Phase 7: Prove It With a Second Real Airport

Depends on Phases 3-6.

Deliverables:
- Select the second airport during implementation based on accessible/licensed geometry, interpretable holding/entry/exit data and a manageable layout. Do not promise that OSM alone encodes full local procedures.
- Generalize ingestion around a supplied airport package/configuration. Curate operational connections explicitly instead of automatically guessing safe runway exits.
- Produce source/provenance notes and a connectivity/operability report. Clearly distinguish real geometry from simulated procedures.
- Add catalog switching, per-airport saves and scenario selection. Save the departing session before switching and dispose its timers/listeners; restore or explicitly start the destination session.
- Bundle the initial small catalog into the standalone HTML to preserve offline operation. If catalog size later warrants separate offline builds, make that an explicit product decision.

Acceptance: both real airports can be selected and played without core-code branches; each passes end-to-end arrival/departure and persistence tests. Repeated switching leaks no simulation loops and mixes no flight/save state. Both load with the network disabled.

## After the Foundation

Defer richer aircraft performance, weather, service vehicles, more realistic local procedures and replay UI until their required configuration/state boundaries are in place. Add each as a separate tested feature, not as part of the refactor.

Performance work is evidence-driven: repeat Phase 0 benchmarks at 24, 60 and 120 simulated aircraft on documented desktop/mobile test hardware. The higher loads are stress tests, not an immediate increase to gameplay limits. Adopt a spatial index or cache only if profiling identifies the hot path; use a worker only if main-thread simulation cost materially harms input/render responsiveness. Preserve determinism and session/save ownership in any such move.

Multiplayer, cloud accounts, live traffic APIs and a backend are out of scope. They are not prerequisites for this roadmap.

## Delivery and Rollback

For every phase:

1. Capture the starting commit and fixture/save versions; keep the previous valid save before upgrading it.
2. Implement one boundary or behavior change at a time. Keep the application runnable after each merged change.
3. Run type checks, relevant unit/scenario tests, all affected browser suites, desktop/mobile checks and the offline build. Run the full suite at the phase gate.
4. Update `README.md`, `ROADMAP.md` and `CONTINUE_HERE.md`, including save versions, known limitations and recovery commands. Refresh transfer snapshots for a new account handoff.
5. Publish only a verified checkpoint with authorized hosting access and the existing audience preserved. Local development must remain possible without publishing.
6. Roll back code and save compatibility together. Older code must not overwrite a newer unsupported save; recover the pre-upgrade snapshot instead. State clearly that rollback may lose progress made after that upgrade.

## Recommended First Work Package

Start with Phase 0, then Phase 1's formatting/build-layout work and initial typed contracts. Do not begin multi-runway behavior or new airport ingestion in that package. Its success is intentionally unexciting: the same playable game, clearer source, reproducible checks, preserved saves and a foundation for the next phase.

Phases 2-6 should each be separate implementation tasks, potentially multiple reviewable changes. Reassess scope after each gate rather than promising a single large rewrite or a fixed completion date. Later phases remain separate tasks, not part of the accepted first work package.
