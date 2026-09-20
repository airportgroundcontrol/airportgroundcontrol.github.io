# Ground Control Roadmap

Architecture follow-up. The first foundation package is implemented; unchecked items remain queued.

Implementation order, module boundaries, save migrations and phase acceptance criteria are detailed in [ARCHITECTURE_PLAN.md](ARCHITECTURE_PLAN.md). Start with its baseline-protection phase; the checklist below is scope, not execution order.

## Next: Foundation for Expansion

- [ ] Extract airport/scenario configuration: initial stands, active runway, holding points, arrival exits, traffic schedules and runway-specific UI/radio text. Remove Edinburgh/24/D1 assumptions from shared logic.
- [ ] Introduce per-runway occupancy and clearance handling before supporting multiple active runways. Preserve the current single-runway behavior with regression tests.
- [ ] Split `src/app.js` into focused menu, keyboard, flight-panel and session coordination modules without redesigning the current interface.
- [x] Add initial typed aircraft states, commands, airport/scenario configuration and save contracts with strict TypeScript and checked traffic geometry. Engine/UI conversion remains incremental.
- [x] Format dense simulation/map source for maintainability, separately from behavioral changes.
- [ ] Extend deterministic scenario tests alongside each new rule. Add explicit save migrations whenever a state schema or airport routing revision changes.

## Later Product Work

- [ ] Expand the real-airport catalog after airport configuration is generalized; validate network connectivity, runway entries/exits and holding points for each airport.
- [ ] Richer aircraft behavior, aircraft-specific separation and ground movement characteristics.
- [ ] Weather, visibility, runway configuration changes and operating scenarios.
- [ ] Service vehicles and more complete ground operations.

## Later Engineering Work

- [ ] Fixed simulation timestep and seeded traffic generation for reproducible replay.
- [ ] Profile higher traffic loads before introducing a worker or spatial index.
- [ ] Save export/import for moving gameplay progress between browser profiles/devices.
- [ ] Coordinate multiple open tabs so an older tab cannot overwrite a newer save.
- [ ] Optional user-controlled Git remote for ongoing off-machine source backups. No new remote/account has been provisioned.

## Already Delivered

- [x] Archived v1 save/continuation fixtures, visual references and performance baseline.
- [x] One-command verification with owned temporary browser server, configurable outputs and offline checks.
- [x] Authored UI/data outside `dist/`; clean reproducible static/offline builds.
- [x] Browser-only Edinburgh game on real OpenStreetMap ground geometry.
- [x] Endless play, dark full-screen map, full-height right panel and top-bar KPIs.
- [x] Compact aircraft action menus and keyboard shortcuts.
- [x] Request/status groups with gentle request pulses and reduced-motion support.
- [x] Named holding-point, hold-short, follow, give-way and onward clearances.
- [x] Local browser persistence for simulation, clearance and view state.
- [x] Account-independent source handoff and portable Git/source backups.

Update this file as items are selected and completed. Preserve the browser-only requirement unless the user explicitly changes it.
