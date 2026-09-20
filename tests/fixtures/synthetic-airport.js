// Deliberately not a real airport or a production catalog entry.
const node = (id, x, y, ref = "") => ({ id, x, y, hold: !!ref, ref });
const nodes = [
  node("entry", 3000, -4850),
  node("hold", 3150, -4850, "H9"),
  node("apron", 3300, -4850),
  node("stand-a", 3300, -4950),
  node("mid", 3300, -4000),
  node("stand-b", 3400, -4000),
  node("north", 3300, -3500),
  node("vacated", 3150, -3500),
  node("exit", 3000, -3500),
];
const pairs = [
  ["entry", "hold"],
  ["hold", "apron"],
  ["apron", "mid"],
  ["mid", "north"],
  ["north", "vacated"],
  ["vacated", "exit"],
  ["apron", "stand-a"],
  ["mid", "stand-b"],
];
const lookup = (id) => nodes.find((n) => n.id === id);
export const syntheticInput = {
  geometry: {
    id: "TEST",
    iata: "TST",
    name: "North Field",
    country: "Test Region",
    center: [0, 0],
    source: {
      name: "Synthetic test fixture",
      url: "https://example.invalid/test-data",
      license: "Test only",
      downloaded: "2026-09-20",
    },
    nodes,
    edges: pairs.map(([a, b]) => ({
      a,
      b,
      ref: "Q",
      type: [a, b].some((id) => id.startsWith("stand"))
        ? "parking_position"
        : "taxiway",
    })),
    stands: [
      {
        id: "A1",
        node: "stand-a",
        exit: "apron",
        path: ["apron", "stand-a"],
        heading: -Math.PI / 2,
      },
      {
        id: "B2",
        node: "stand-b",
        exit: "mid",
        path: ["mid", "stand-b"],
        heading: 0,
      },
    ],
    features: [
      {
        id: "runway",
        type: "runway",
        ref: "17/35",
        name: "",
        closed: false,
        width: 45,
        points: [
          [3000, -5000],
          [3000, -3000],
        ],
      },
      ...pairs.map(([a, b], i) => ({
        id: "way-" + i,
        type: "taxiway",
        ref: "Q",
        name: "",
        closed: false,
        width: 20,
        points: [a, b].map((id) => [lookup(id).x, lookup(id).y]),
      })),
    ],
  },
  operations: {
    version: 1,
    groundName: "North Field Ground",
    frequency: "123.450",
    runways: [
      {
        id: "north-south",
        label: "17 / 35",
        protectedHalfWidth: 35,
        releaseDistance: 90,
        ends: [
          { id: "southbound", label: "17", position: { x: 3000, y: -5000 } },
          { id: "northbound", label: "35", position: { x: 3000, y: -3000 } },
        ],
        configurations: [
          {
            endId: "southbound",
            departureHold: "hold",
            departureEntry: "entry",
            arrivalExit: "exit",
            vacatePath: ["exit", "vacated"],
          },
        ],
      },
    ],
    holdingPoints: ["hold"],
    map: {
      bounds: { minX: 2700, maxX: 3700, minY: -5500, maxY: -2750 },
      labels: [{ text: "NORTH FIELD", x: 3550, y: -3900, minZoom: 0 }],
      mediumZoomStands: ["A1", "B2"],
    },
  },
  scenario: {
    id: "test-day",
    version: 1,
    activeRunwayEnd: "southbound",
    initialDepartures: [{ stand: "A1", call: "TST101" }],
    initialArrivals: ["TST202"],
    departureStands: ["A1", "B2"],
    traffic: {
      arrivalInterval: 75,
      departureInterval: 90,
      maxApproaches: 1,
      maxDepartures: 3,
      maxActive: 8,
      arrivalSpacing: 300,
      queueSpacing: 200,
      departurePrefixes: ["DEP"],
      arrivalPrefixes: ["ARR"],
      departureTypes: ["E190"],
      arrivalType: "E190",
    },
    turnaroundSeconds: 50,
    goAroundSeconds: 300,
    cleanupSeconds: 60,
    scoring: { movement: 25, goAround: 5, conflict: 10 },
    clockStartSeconds: 36000,
    weather: { conditions: "VMC", wind: "170 / 05 KT" },
  },
};
