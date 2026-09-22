// Dimensions are manufacturer values; performance is deliberately game-tuned.
const profiles = {
  turboprop: {
    taxi: 7,
    pushback: 1.8,
    acceleration: 0.8,
    braking: 1.3,
    turn: 2.5,
    takeoff: 57,
    landing: 49,
    takeoffAcceleration: 1.8,
    turnaround: 0.7,
    tugSeconds: 7,
  },
  regional: {
    taxi: 8,
    pushback: 2,
    acceleration: 0.7,
    braking: 1.2,
    turn: 2.4,
    takeoff: 68,
    landing: 57,
    takeoffAcceleration: 2,
    turnaround: 0.85,
    tugSeconds: 9,
  },
  narrowbody: {
    taxi: 8,
    pushback: 2,
    acceleration: 0.6,
    braking: 1.1,
    turn: 2.2,
    takeoff: 74,
    landing: 61,
    takeoffAcceleration: 2,
    turnaround: 1,
    tugSeconds: 11,
  },
  longNarrowbody: {
    taxi: 8,
    pushback: 1.8,
    acceleration: 0.55,
    braking: 1,
    turn: 2,
    takeoff: 76,
    landing: 62,
    takeoffAcceleration: 1.9,
    turnaround: 1.15,
    tugSeconds: 13,
  },
  widebody: {
    taxi: 8,
    pushback: 1.6,
    acceleration: 0.45,
    braking: 0.9,
    turn: 1.8,
    takeoff: 80,
    landing: 65,
    takeoffAcceleration: 1.7,
    turnaround: 1.6,
    tugSeconds: 16,
  },
  largeWidebody: {
    taxi: 7.5,
    pushback: 1.4,
    acceleration: 0.38,
    braking: 0.95,
    turn: 1.55,
    takeoff: 84,
    landing: 68,
    takeoffAcceleration: 1.55,
    turnaround: 1.9,
    tugSeconds: 20,
  },
};
export const aircraftCatalogVersion = 2;
export const aircraftCatalog = Object.freeze(
  Object.fromEntries(
    [
      [
        "AT72",
        "ATR 72-600",
        27.17,
        27.05,
        "M",
        "turboprop",
        "https://www.atr-aircraft.com/regional-mobility/regional-aircraft/",
      ],
      [
        "E190",
        "Embraer E190",
        36.24,
        28.72,
        "M",
        "regional",
        "https://www.embraercommercialaviation.com/wp-content/uploads/2017/06/APM_190.pdf",
      ],
      [
        "A320",
        "Airbus A320 (sharklets)",
        37.57,
        35.8,
        "M",
        "narrowbody",
        "https://www.aircraft.airbus.com/sites/g/files/jlcbta126/files/2025-01/AC_A320_0624.pdf",
      ],
      [
        "B738",
        "Boeing 737-800 (winglets)",
        39.47,
        35.8,
        "M",
        "narrowbody",
        "https://www.boeing.com/content/dam/boeing/boeingdotcom/commercial/airports/acaps/737NG_REV_B.pdf",
      ],
      [
        "A333",
        "Airbus A330-300",
        63.67,
        60.3,
        "H",
        "widebody",
        "https://aircraft.airbus.com/sites/g/files/jlcbta126/files/2023-08/ac_a330_jul2023_0.pdf",
      ],
      [
        "A21N",
        "Airbus A321neo",
        44.51,
        35.8,
        "M",
        "longNarrowbody",
        "https://www.aircraft.airbus.com/en/aircraft/a320-family/a321neo",
      ],
      [
        "A223",
        "Airbus A220-300",
        38.7,
        35.1,
        "M",
        "regional",
        "https://www.aircraft.airbus.com/en/aircraft/a220/a220-300",
      ],
      [
        "DH8D",
        "De Havilland Dash 8-400",
        32.83,
        28.42,
        "M",
        "turboprop",
        "https://dehavilland.com/wp-content/uploads/2025/01/DHC_Dash8_SpecSheet_v9_DIGITAL.pdf",
      ],
      [
        "B77W",
        "Boeing 777-300ER",
        73.9,
        64.8,
        "H",
        "largeWidebody",
        "https://www.boeing.com/Commercial/777/design-highlights",
      ],
      [
        "B748",
        "Boeing 747-8",
        76.25,
        68.45,
        "H",
        "largeWidebody",
        "https://www.boeing.com/content/dam/boeing/boeingdotcom/commercial/airports/acaps/747-8_Rev_D.pdf",
      ],
      [
        "A359",
        "Airbus A350-900",
        66.8,
        64.75,
        "H",
        "widebody",
        "https://www.aircraft.airbus.com/en/aircraft/a350/a350-900",
      ],
    ].map(([id, name, length, wingspan, wake, shape, source]) => [
      id,
      Object.freeze({
        id,
        name,
        length,
        wingspan,
        wake,
        shape,
        source,
        performance: Object.freeze(profiles[shape]),
      }),
    ]),
  ),
);

export function aircraftType(id) {
  const type = aircraftCatalog[id];
  if (!type) throw new Error("Unsupported aircraft type: " + id);
  return type;
}

export function queueSeparation(a, b) {
  return (aircraftType(a.type).length + aircraftType(b.type).length) / 2 + 15;
}

export function crossingSeparation(a, b) {
  const own = aircraftType(a.type),
    other = aircraftType(b.type);
  return own.length / 2 + Math.max(other.wingspan, other.length) / 2 + 10;
}
