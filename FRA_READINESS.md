# EDDF / Frankfurt Package

EDDF is the second playable real-airport package. It uses licensed OpenStreetMap geometry, a curated connected stand set and selectable west/east operating presets. Its stand limits and detailed routing choices are labeled game assumptions, not operational data.

## Available source shape

- OpenStreetMap aerodrome relation: <https://www.openstreetmap.org/relation/5813621>
- OSM attribution/license: <https://www.openstreetmap.org/copyright>
- DFS geodata/AIXM entry point: <https://www.dfs.de/homepage/en/services/geo-data/>
- Fraport traffic regulations: <https://www.fraport.com/content/dam/fraport-company/documents/geschaeftsfelder/service/richtlinien-und-zahlungsbedingungen/richtlinien/en/C2.9%20Traffic%20Regulations1.pdf/_jcr_content/renditions/original.media_file.download_attachment.file/C2.9%20Traffic%20Regulations1.pdf>
- Fraport runway system: <https://www.fraport.com/en/sustainability/dialog-with-neighbors/noise-and-air/flight-operations/runway-system-and-operating-hours.html>

A September 2026 OSM audit found four runway ways, 583 taxiway ways, 446 parking-position ways, 360 holding-position nodes, 35 aprons, 122 gates and 19 terminal ways in the airport relation. Of 446 parking positions, 330 had refs and 280 refs were unique. Treat these counts as an ingestion snapshot, not as operational truth.

The physical runway pairs needed by the package are:

- `07L/25R`, 2,800 x 45 m
- `07C/25C`, 4,000 x 60 m
- `07R/25L`, 4,000 x 45 m
- `18`, 4,000 x 45 m; model its opposite threshold as a physical end even when no reciprocal operation is enabled

## Engine support now available

- Several physical runways and operational ends in one airport package
- Scenario-level arrival/departure roles and weighted aircraft assignment
- Shared occupancy for opposite ends of one physical runway
- Independent occupancy and wake history for different physical runways
- Runway-specific approach geometry, landing exits, departure holds and entries
- Explicit hold-to-hold runway-crossing clearances with keyboard/UI support
- Save/reload of per-aircraft assignments and per-runway owners
- Map and top-bar rendering for several runways
- Persistent preset/custom runway configuration with committed-traffic changeovers

The tests use an FRA-shaped synthetic fixture. It proves these rules without presenting fabricated geometry as Frankfurt data.

## Implemented package

- September 2026 OSM relation extract with attribution and ODbL metadata
- 7,424 connected route nodes and 7,925 normalized unique edges
- 53 playable, topologically connected terminal, cargo and remote positions selected explicitly in `import.json`; ambiguous duplicate labels, unnamed parking marks and disconnected OSM paths remain excluded rather than repaired by guesswork
- All four physical runway pairs rendered; west/east normal and reduced presets are available
- Curated entries and type-dependent exits for both directions of the three parallel runways, plus departure-only runway 18
- Airport-specific weighted fleet, conservative game-assumption stand-size groups and adjacent-stand exclusions; A333/A359/B77W/B748 can use curated cargo and remote positions
- Three-to-seven opening departures, one-to-three approaches, ten-minute base inbound planning and a 55-minute narrow-body turnaround baseline
- Per-airport persistence, desktop/mobile framing, standalone offline selection and production browser coverage

No playable route in the curated configuration set crosses another active runway, so no FRA `runwayCrossings` entry is needed yet. Directional pushback paths, sourced stand/pavement restrictions and intersecting-runway dependency groups remain future work. DFS chart images were not redistributed or copied into the package.
