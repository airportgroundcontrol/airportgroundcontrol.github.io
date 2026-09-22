# Ground Control Roadmap

Architecture follow-up. Foundation, GameSession, data-driven airport packages and multi-runway resources are implemented; unchecked items remain queued.

Implementation order, module boundaries, save migrations and phase acceptance criteria are detailed in [ARCHITECTURE_PLAN.md](ARCHITECTURE_PLAN.md). The user requested GameSession followed by airport independence; broader Phase 2 save tooling is still queued.

## Next: Foundation for Expansion

- [x] Extract airport/scenario configuration: initial stands, active runway, holding points, curated arrival exits, schedules, scoring, map framing and UI/radio text. Shared engine/map/UI/importer contain no Edinburgh/24/D1 assumptions; synthetic-airport cycles and browser tests verify this.
- [x] Extract GameSession for commands/events, simulation pacing, restore/save/restart and disposal; UI and integration commands use it.
- [x] Automatic current-format local persistence with validated reload and explicit top-bar delete/reset. Legacy migration and manual game transfer explicitly declined by the user; format 2 only.
- [x] Introduce per-runway assignment, occupancy, wake state and clearance handling for multiple active runways. Opposite ends share physical occupancy; declared hold-to-hold crossings reserve that pavement; single-runway behavior and reload compatibility remain covered.
- [x] Add persistent live runway configuration: airport-defined capabilities and presets, custom arrival/departure/mixed/closed roles, committed-traffic changeovers and automatic reassignment of uncommitted departures. Frankfurt ships west/east normal and reduced presets for every supported runway direction.
- [x] Let the controller choose a routed active departure runway per taxi clearance and a heading-compatible parallel arrival runway per landing clearance, with exit, stand, occupancy and projected-separation validation applied to the selected runway.
- [x] Index immutable stand/runway/aircraft routing constraints, cache bounded A* results and render static airport geometry through a camera-keyed canvas layer. Frankfurt session construction and steady-state drawing no longer repeat full-network work.
- [ ] Split `src/app.js` into focused menu, keyboard, aircraft-menu and session coordination modules without redesigning the current interface.
- [x] Add initial typed aircraft states, commands, airport/scenario configuration and save contracts with strict TypeScript and checked traffic geometry. Engine/UI conversion remains incremental.
- [x] Format dense simulation/map source for maintainability, separately from behavioral changes.
- [ ] Continue extending deterministic scenario tests with new rules and explicit save migrations when schemas/routing change. Current archived-save, synthetic-airport and generic-importer regressions pass.

## Later Product Work

- [x] Smooth manual Hold braking, low-speed final parking and centerline-corridor cubic taxi paths. Full landing-gear/turn-radius feasibility is still part of physical-clearance work below.
- [x] Directional pushback choices with previews (R), maneuver reservations through tug release, and explicitly configured self-maneuver support. Edinburgh directional choices cover stands 1, 3, 8 and 20; other stands retain their original lead-out. Self-maneuvering is tested synthetically, not enabled without real stand data.
- [x] Two curated Edinburgh arrival-exit paths, braking-distance eligibility and exit-speed control; suitable exits are selectable before landing clearance.
- [x] Continuously moving approaches, per-flight ETA, time-spaced arrivals, off-map indicators, visible go-arounds and a single score penalty for each missed landing clearance. Go-arounds leave the control area rather than freezing or teleporting back into a queue.
- [x] Anticipated runway separation for landing and takeoff: future threshold slots, performance/heavy-wake margins, continuously monitored forecasts, penalized separation-loss go-arounds, and selectable rolling departures from the runway hold.
- [ ] Physical clearance: landing-gear/minimum-radius feasibility, swept wing/tail envelopes, jet-blast zones and clearer deadlock intervention. Current curves protect the aircraft reference point only, not its complete footprint.
- [ ] Runway depth: suitability and roll profiles for weight/weather, certified arrival/mixed-operation wake rules, multiple queued arrival slots and airport-specific reduced-separation procedures.
- [ ] Verified airport restrictions: replace labeled game assumptions with sourced stand, pavement and maneuvering limits; expand curated pushback options to other stands.

- [x] Aircraft catalog and distinct silhouettes, stand/route eligibility, adjacent reservations, game-tuned acceleration/braking/turn speeds, tug disconnection and size-based separation buffers. See [aircraft realism plan](AIRCRAFT_REALISM_PLAN.md) for the exact scope.
- [x] Curate and add FRA as the second real-airport package: licensed OSM geometry, 17 connected playable stands, all four physical runways, both operating directions, type-dependent arrival exits, airport-specific fleet limits, persistence and desktop/mobile/offline browser QA.
- [ ] Richer aircraft behavior, aircraft-specific separation and ground movement characteristics.
- [ ] Dynamic weather, visibility and operating scenarios that influence runway suitability and capacity.
- [ ] Service vehicles and more complete ground operations.

## Later Engineering Work

- [x] Fixed 0.05-second simulation timestep across playback speeds; a saved seed and generator position preserve deterministic continuation.
- [x] Seeded stochastic traffic: varied initial counts, callsigns, weighted types and compatible stands; bounded schedule, approach and turnaround variation. New games/restarts draw fresh seeds; reload resumes the exact sequence.
- [x] Aircraft rotation traffic: six-minute inbound planning window, two-minute approach spacing, airline-scale type-dependent turnarounds, and no recurring gate-side aircraft creation after the opening roster.
- [ ] Seed selection/sharing, tick-stamped command trace and replay controls.
- [ ] Profile higher traffic loads before introducing a worker or spatial index.
- [x] Exclusive browser writer lock per airport; no unsafe storage-lease fallback. Unsupported locks use volatile play.
- [ ] Read-only secondary-tab viewer and explicit writer takeover (currently second tab is blocked until the first closes).
- [ ] Optional user-controlled Git remote for ongoing off-machine source backups. No new remote/account has been provisioned.

## Already Delivered

- [x] Archived v1 save/continuation fixtures, visual references and performance baseline.
- [x] One-command verification with owned temporary browser server, configurable outputs and offline checks.
- [x] Authored UI/data outside `dist/`; clean reproducible static/offline builds.
- [x] Browser-only Edinburgh game on real OpenStreetMap ground geometry.
- [x] Endless play, dark full-screen map, direct map-based aircraft control and top-bar KPIs. The former right panel and radio history were removed by request.
- [x] Compact aircraft action menus and keyboard shortcuts.
- [x] Request/status groups with gentle request pulses and reduced-motion support.
- [x] Named holding-point, hold-short, follow, give-way and onward clearances.
- [x] Local browser persistence for simulation, clearance and view state.
- [x] Blocking startup reset for incompatible saves; no silent unsaved fallback after an update.
- [x] Account-independent source handoff and portable Git/source backups.

Update this file as items are selected and completed. Preserve the browser-only requirement unless the user explicitly changes it.
