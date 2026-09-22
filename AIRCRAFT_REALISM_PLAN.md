# Aircraft Realism Plan

Status: first implementation delivered, 2026-09-20; remaining items below are not all implemented. All work stays local-only; no publishing or source uploads.

## Implementation Checkpoint

- Second flow batch delivered: centerline-corridor cubic curves with graph-node provenance; smooth manual Hold braking; slow final parking; directional pushbacks and previews for configured stands; reservation protection through tug release; data-gated self-maneuver support; two Edinburgh exit alternatives with braking-distance eligibility; continuously moving arrivals, ETA, and visible one-penalty automatic go-arounds. Curves are not gear-based or swept-footprint validated. No production self-maneuver stand is asserted as verified.
- Arrival tuning: first approach is based six simulation minutes from threshold with 15% variation, subsequent approaches on the same assigned runway are at least 120 seconds apart by ETA, and an automatic go-around occurs if uncleared at 8 seconds to threshold for -25 points. Cleared approaches continue at approach speed until threshold, then begin the simplified landing roll. Clearance reserves a future threshold slot rather than immediate pavement occupancy. Departures may line up, take off or roll without stopping when projected runway-clear time plus performance/heavy-wake buffers fits before that slot. Forecast failure at the decision point sends the arrival around with both go-around and conflict penalties.
- Traffic now follows aircraft rotations: recurring traffic enters only through arrivals, which retain type and identity when becoming departures after a sampled turnaround. The randomized opening roster is the sole gate-side spawn. Narrow-body turnaround baseline is 45 simulation minutes, class-scaled and varied by 15%. Flight-number/registration separation and service milestones are still queued.
- Save format remains 2. The new behavior/configuration fingerprint explicitly accepts the immediately previous seeded-traffic revision because its state contract is unchanged; unrelated and legacy snapshots remain rejected and preserved. New snapshots round-trip during curves, braking, pushback, approach, landing and go-around.

- Implemented: eleven immutable type definitions and manufacturer dimensions; original top-down silhouettes; mixed airport-specific fleets; curated stand/route restrictions and adjacent reservations; type-aware A* and command rejection; fixed 0.05-second steps; acceleration/braking and corner-speed lookahead; nose-aware holding destinations; tug disconnection; type-dependent turnaround; dimension-based queue/crossing buffers; conservative runway-exit clearance; simplified configurable departure-wake delays.
- Implemented save tooling: automatic local format-2 snapshots, explicit top-bar reset and one browser writer per airport. Manual export/import and recovery downloads were removed by user request. Browsers without Web Locks use volatile play. Hidden tabs pause time; no catch-up.
- User override: **no legacy support**. V1 is rejected without migration; no legacy engine/profile is kept. Archived files now verify safe rejection. Start a new game to use this model.
- Not implemented: gear-based trajectories/minimum-radius feasibility, swept-footprint collision detection, jet-blast envelopes, runway suitability/weight/weather performance, arrival/mixed-operation wake rules, verified real stand/pavement limits, full engine/UI typing, replay UI or writer takeover. Curves and maneuvering areas use explicit game approximations; emergency safety stops remain immediate.
- Edinburgh and Frankfurt fleet limits are game assumptions, not certified local procedures. FRA restricts A333/A359/B77W/B748 traffic to six large cargo positions and the late P24 arrival exit. Geometric graph connectivity is tested, not full physical maneuver feasibility.

## Goal

Make aircraft visibly different and operationally meaningful while retaining a readable, responsive ground-control game. The player issues clearances; the simulated crew executes the authorized movement and stops when it cannot safely comply. Do not require manual steering or implement a flight simulator.

## Historical Baseline (Before Implementation)

- Aircraft type is a string in simulation state. Scenario departures use A320/B738 and arrivals use A320; dimensions and performance are not defined by type.
- The renderer draws one fixed-size aircraft shape. Stand selection checks occupancy/reservation, not physical compatibility.
- Traffic uses a shared 60-metre separation constant. Movement follows straight graph segments with interpolated heading, shared acceleration and abrupt speed reductions.
- GameSession and validated airport/scenario packages provide the integration points. Saves remain v1 with configuration fingerprints; general migrations/recovery/export and tab ownership are still pending.

## Modeling Principles

- Separate physical dimensions, airport compatibility, wake category, visual silhouette and gameplay performance. A wake category is not a gate-size classifier.
- Use manufacturer dimensions for specific aircraft variants. Use explicitly labeled, tunable game approximations for acceleration, taxi speeds, braking, service times and runway performance.
- Airport restrictions belong in curated operations data, not aircraft-specific branches in shared code. Missing restriction data is unknown, not unlimited capacity.
- Use a documented world-space aircraft reference point and physical footprint. Rendering enlargement and pointer hit targets must never change simulation dimensions.
- Retain existing ngraph routing. Adopt a maintained geometry library if swept-area intersection needs one; do not build a general physics engine.
- Keep full arrival/departure cycles and safety behavior consistent at 1x and 4x. Accelerated time increases simulation steps, not physical speeds.

## 0. Save and Simulation Prerequisites

- Complete recovery/export and single-writer protections before introducing new persistent motion/reservation state. Legacy migrations were explicitly declined.
- Add versioned aircraft-catalog and behavior identifiers to compatibility checks. Keep geometry revisions separate; never edit compatibility hashes merely to admit incompatible saves.
- Unknown types produce a recoverable compatibility error, not a fallback A320. Old formats are incompatible; never silently restart or overwrite them.
- Introduce fixed-step simulation before kinematic changes, with a bounded accumulator and explicit hidden-tab policy. Record seeded traffic state when changing flight generation.
- Retain archived v1 bytes as unsupported-format rejection tests. Current behavior gets new scenarios; no legacy continuation engine is maintained.

Acceptance: round trips in active movement states, validation that does not mutate input, recovery after failed writes, incompatible-route handling and equivalent outcomes across time multipliers.

## 1. Aircraft Catalog and Distinct Map Shapes

- Add validated, immutable type definitions with stable IDs, variant names, length, wingspan, gear geometry where required, wake-category scheme, silhouette ID and performance-profile ID. Record source/revision and distinguish measured values from game tuning.
- Proposed first roster: AT72 (ATR 72), E190, A320, B738 (737-800), A333 (A330-300). Verify variant dimensions before implementation. These are game roster candidates, not a claim about current Edinburgh schedules.
- Build bundled top-down Canvas paths or SVG assets: visible propellers for turboprops, different fuselage/wing/tail proportions for jets and a clearly larger widebody. Avoid simply scaling the current generic symbol.
- Use world-scale silhouettes when zoomed in; apply bounded enlargement for readability when zoomed out. Keep generous independent hit targets, non-overlapping labels and existing status/selection/request colors.
- Show a compact type indicator in the right-hand flight card. Keep aircraft context menus action-only, respecting the earlier request to remove identity/type there.
- Generalize scenario fleet mixes for both arrivals and departures. Introduce new types into live scenarios only after their airport compatibility has been validated in Phase 2.

Acceptance: every catalog type distinguishable in a test scene at desktop/mobile sizes; matching headings, correct hit testing, offline assets, reduced-motion support and no popup/card regressions.

## 2. Aircraft-Aware Stands and Routes

- Add curated stand envelopes: permitted dimensions/types, parking reference/heading, stand purpose, approach and pushback options, and adjacent-stand exclusion groups where needed. Do not infer limits from stand numbers or OSM line widths.
- Add route restrictions by edge/turn: verified allowed types or size limits, direction, speed limits and minimum turning feasibility where known. A fitting gate is insufficient if its access or pushback route is unusable.
- Centralize compatibility queries and authoritative command validation. Filter A* traversals and validate player waypoints against the same rules; previews, menus, keyboard and integration calls must agree.
- Distinguish incompatible, occupied/reserved and temporarily blocked. Show disabled stand choices with concise reasons and highlight compatible choices while assigning a stand.
- Reserve a chosen destination and its exclusion groups atomically. Release reservations on reassignment/cancellation/completion according to explicit lifecycle rules; never clear a departure stand merely because its reference point has left it.
- Generate departures only for valid aircraft/stand/route combinations. Arrivals need a supported route and potential destination; when suitable stands are occupied, use an explicit waiting/overflow policy rather than forcing an invalid assignment.
- Maintain a provenance table for airport limits: source, date, verified or game assumption. Where official stand limits cannot be obtained, label curated approximations as gameplay data. Do not claim real-world certification.

Acceptance: a widebody cannot use a narrow stand or restricted taxiway; manual waypoints cannot bypass restrictions; adjacent stands cannot be double-reserved; no-compatible-stand situations remain recoverable. Run all cases on synthetic and Edinburgh packages.

## 3. Smooth, Type-Specific Ground Movement

- Separate pure movement/performance calculations from clearance/state transitions in sim.js. GameSession remains the command and persistence owner.
- Derive target speed from aircraft profile, local segment, upcoming curvature, stop distance and traffic. Add bounded acceleration/deceleration and stopping-distance lookahead.
- Respect the aircraft nose at holding limits. Brake before a queue, hold or stand; emergency stopping remains a safety fallback, not routine movement.
- Replace corner pivots with feasible turn trajectories that stay inside authorized corridors. Use gear/turn geometry and validate the swept footprint; never smooth blindly through buildings or outside a clearance.
- Treat pushback as reverse towing along approved paths, with correct orientation and a short configurable tug-release/engine-readiness sequence. Permit self-maneuvering only where stand/type data explicitly allows it, not for every small aircraft.
- Use type-specific final parking speeds, alignment and compressed turnaround durations. Aircraft stay on the same type through turnaround.

Acceptance: no instant speed jumps, sliding pivots, overshot hold lines or cut corners; save/reload mid-turn and mid-pushback preserves state; test behavior at all time multipliers and under frame stalls.

## 4. Physical Separation and Crew Compliance

- Replace universal center spacing with pairwise footprint clearance plus tunable movement buffers and stopping distance. Include wings at crossings and turns, fuselage length in queues, and tail clearance when releasing a junction or runway.
- Initially use conservative swept envelopes, not computationally expensive full rigid-body contact simulation. Add spatial indexing only if measured traffic loads need it.
- Preserve explicit hold, follow and give-way clearances. Authorized crews automatically maintain spacing, slow for turns and resume after temporary obstructions clear; they never cross a clearance limit or runway without permission.
- Treat right-of-way logic as a documented game policy, not a universal replacement for airport/controller instructions. Head-on deadlocks request intervention; aircraft do not silently reroute or reverse.
- Protect pushback conflict areas, adjacent stands and selected jet-blast zones using airport/type data. Keep blast buffers separate from airborne wake separation.
- Present concise reasons such as traffic ahead, pushback blocked, incompatible stand or awaiting onward clearance. Normal safe waiting is not a conflict penalty.

Acceptance: crossing widebodies, staggered merges, stationary tails, adjacent pushbacks, narrow bidirectional routes and deadlocks are covered by deterministic scenarios. No swept-envelope overlap during ordinary authorized movements.

## 5. Runway and Fleet Depth

- Add type-specific, explicitly simplified takeoff/landing roll profiles and suitable exit selection from curated airport alternatives. Faster or larger aircraft must not make impossible exits.
- Keep runway occupancy until the entire aircraft is outside the protected area. Add data-driven wake-separation rules by leader/follower and operation; scope them to a named simplified ruleset rather than one universal heavy delay.
- Add runway suitability to fleet eligibility using curated game limits. Do not present this as real takeoff performance calculation; weight, weather, slope and other operational factors remain out of scope initially.
- Extend scenario traffic weights and gate demand for interesting mixed-fleet play. Large aircraft should create different planning choices, not simply move slowly everywhere.
- Multiple simultaneous runways and live airport-constrained role changes are now implemented separately. Full towing vehicles, service fleets, failures and detailed weight/fuel/engine simulation remain deferred.

Acceptance: mixed-fleet arrival/turnaround/departure sessions remain playable indefinitely, wake and physical spacing are independent, no arrival is forced into an impossible exit or stand, and save/offline behavior remains intact.

## Recommended Delivery Batches

1. Save prerequisites, aircraft catalog and silhouettes. Preserve existing movement and restrict live traffic to currently supported types until compatibility is ready.
2. Curated stand/route limits and authoritative eligibility; enable the validated mixed fleet, including a widebody only after confirming a usable airport path and stand.
3. Fixed-step timing, braking, turning and pushback behavior.
4. Footprint-based separation and conflict handling.
5. Runway performance, wake rules and traffic balancing.

Every batch: focused unit/scenario tests, affected browser tests, desktop/mobile visual checks, save compatibility checks and the full offline verification suite. No deployment. Update roadmap completion only for actually delivered behavior.

## Reference Basis

- [Airbus airport characteristics](https://www.aircraft.airbus.com/en/customer-care/fleet-wide-care/airport-operations-and-aircraft-characteristics/aircraft-characteristics): manufacturer airport-planning documents for dimensions and maneuvering geometry. Obtain equivalent manufacturer references for other roster types before populating their catalog values.
- [EASA aerodrome design rules](https://www.easa.europa.eu/en/document-library/easy-access-rules/online-publications/easy-access-rules-aerodromes-regulation-eu?erules-id=ERULES-1963177438-2368): reference-code wingspan bands are planning inputs, not a complete stand-compatibility test.
- [CAA CAP 797](https://www.caa.co.uk/publication/download/18503): wake categorization is distinct from stand fit. Verify applicable current airport/operational rules before adding a named ruleset.
- [FAA ground movement instructions](https://www.faa.gov/air_traffic/publications/atpubs/atc_html/chap3_section_7.html) and [AIM airport operations](https://www.faa.gov/air_traffic/publications/atpubs/aim_html/chap4_section_3.html): reference examples for explicit clearance limits and crew collision avoidance; not Edinburgh-specific procedures.
