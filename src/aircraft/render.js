import { aircraftType } from "./catalog.js";

// Original artwork, authored for Ground Control. No third-party icon assets.
// Coordinates are nose-up, normalized to 100 units of length and wingspan.
const artwork = {
  AT72: {
    body: "M0 -50 C2.4 -49 4.9 -43 5 -36 L5 26 C5 35 2.5 45 0 50 C-2.5 45 -5 35 -5 26 L-5 -36 C-4.9 -43 -2.4 -49 0 -50Z",
    wing: "M0 -13 L47 -8 Q50 -8 50 -6 L50 1 Q50 3 47 3 L10 8 L0 11Z",
    tail: "M0 29 L23 36 L24 42 Q24 43 22 43 L0 39Z",
    engine:
      "M22 -20 C24 -20 25 -18 25 -15 L25 4 L23 12 L21 12 L19 4 L19 -15 C19 -18 20 -20 22 -20Z",
    propeller: true,
  },
  E190: {
    body: "M0 -50 C2 -49.5 5.2 -42 5.4 -35 L5.4 24 C5.4 33 2.1 44 0 50 C-2.1 44 -5.4 33 -5.4 24 L-5.4 -35 C-5.2 -42 -2 -49.5 0 -50Z",
    wing: "M0 -14 L47 8 L50 6 L50 14 L47 16 L16 9 L0 17Z",
    tail: "M0 28 L24 40 L25 46 L21 46 L0 39Z",
    engine:
      "M20 -12 C22.4 -12 23.2 -10 23.2 -8 L23 1 Q23 4 21 5 L18 5 Q16.8 3 16.8 1 L16.8 -8 Q16.8 -12 20 -12Z",
  },
  A320: {
    body: "M0 -50 C3.4 -49 5.5 -43 5.5 -36 L5.5 25 C5.5 34 2.5 44 0 50 C-2.5 44 -5.5 34 -5.5 25 L-5.5 -36 C-5.5 -43 -3.4 -49 0 -50Z",
    wing: "M0 -15 L46 8 L50 5 L50 14 L46 17 L18 10 L0 17Z",
    tail: "M0 29 L23 40 L24 46 L20 46 L0 40Z",
    engine:
      "M19 -14 C21.5 -14 22.5 -12 22.5 -10 L22.5 0 Q22.5 3 20.5 4 L17.5 4 Q15.5 3 15.5 0 L15.5 -10 Q15.5 -14 19 -14Z",
  },
  B738: {
    body: "M0 -50 C1.6 -49 4.9 -42 5.1 -35 L5.1 24 C5.1 33 2 45 0 50 C-2 45 -5.1 33 -5.1 24 L-5.1 -35 C-4.9 -42 -1.6 -49 0 -50Z",
    wing: "M0 -12 L46 13 L50 9 L50 19 L46 22 L20 14 L0 18Z",
    tail: "M0 29 L22 41 L23 47 L19 47 L0 39Z",
    engine:
      "M18 -10 Q21.5 -10 21.5 -7 L21.5 2 Q21.5 5 19.5 6 L16.5 6 Q14.5 5 14.5 2 L14.5 -7 Q14.5 -10 18 -10Z",
  },
  A333: {
    body: "M0 -50 C2.5 -49 4.7 -44 4.7 -37 L4.7 24 C4.7 34 2.2 45 0 50 C-2.2 45 -4.7 34 -4.7 24 L-4.7 -37 C-4.7 -44 -2.5 -49 0 -50Z",
    wing: "M0 -18 L47 13 L50 12 L50 19 L47 21 L20 11 L0 18Z",
    tail: "M0 29 L23 41 L24 47 L20 47 L0 39Z",
    engine:
      "M18 -15 C20.5 -15 21.5 -13 21.5 -11 L21.5 -1 Q21.5 2 19.5 3 L16.5 3 Q14.5 2 14.5 -1 L14.5 -11 Q14.5 -15 18 -15Z",
  },
  A21N: {
    body: "M0 -50 C3 -49 5 -43 5 -36 L5 28 C5 37 2.2 46 0 50 C-2.2 46 -5 37 -5 28 L-5 -36 C-5 -43 -3 -49 0 -50Z",
    wing: "M0 -12 L45 9 L50 6 L50 14 L46 17 L18 10 L0 15Z",
    tail: "M0 31 L22 41 L23 47 L19 47 L0 41Z",
    engine:
      "M19 -12 C22 -12 23 -10 23 -7 L22.5 2 Q22.5 5 20 6 L17 6 Q15 4 15 2 L15 -8 Q15 -12 19 -12Z",
  },
  A223: {
    body: "M0 -50 C2.7 -49 5.1 -42 5.2 -35 L5.2 25 C5.2 34 2.2 45 0 50 C-2.2 45 -5.2 34 -5.2 25 L-5.2 -35 C-5.1 -42 -2.7 -49 0 -50Z",
    wing: "M0 -15 L46 7 L50 5 L50 13 L46 16 L16 9 L0 17Z",
    tail: "M0 29 L23 39 L25 45 L21 46 L0 39Z",
    engine:
      "M20 -14 C23 -14 24 -11 24 -8 L23.5 1 Q23.5 5 21 6 L17.5 6 Q15 4 15 1 L15 -8 Q15 -14 20 -14Z",
  },
  DH8D: {
    body: "M0 -50 C2.2 -49 4.5 -43 4.5 -36 L4.5 27 C4.5 36 2.2 45 0 50 C-2.2 45 -4.5 36 -4.5 27 L-4.5 -36 C-4.5 -43 -2.2 -49 0 -50Z",
    wing: "M0 -15 L48 -10 Q50 -10 50 -7 L50 -1 Q50 1 47 1 L9 7 L0 10Z",
    tail: "M0 31 L25 37 L26 43 L22 44 L0 40Z",
    engine:
      "M23 -23 C26 -23 27 -20 27 -17 L27 4 L24 12 L21 12 L19 4 L19 -17 Q19 -23 23 -23Z",
    propeller: true,
  },
  B77W: {
    body: "M0 -50 C2.5 -49 4.5 -44 4.5 -36 L4.5 28 C4.5 37 2 46 0 50 C-2 46 -4.5 37 -4.5 28 L-4.5 -36 C-4.5 -44 -2.5 -49 0 -50Z",
    wing: "M0 -18 L45 12 L50 9 L49 18 L45 22 L19 12 L0 18Z",
    tail: "M0 31 L22 42 L23 48 L19 48 L0 41Z",
    engine:
      "M18 -15 C21 -15 22.5 -13 22.5 -10 L22 -1 Q22 3 19.5 4 L16 4 Q13.5 2 13.5 -1 L13.5 -10 Q13.5 -15 18 -15Z",
  },
  B748: {
    body: "M0 -50 C2.7 -49 4.7 -44 4.7 -36 L4.7 27 C4.7 36 2.2 45 0 50 C-2.2 45 -4.7 36 -4.7 27 L-4.7 -36 C-4.7 -44 -2.7 -49 0 -50Z",
    wing: "M0 -17 L47 11 L50 10 L50 18 L47 21 L18 11 L0 18Z",
    tail: "M0 29 L23 42 L24 48 L20 48 L0 40Z",
    engine:
      "M16 -15 C18.5 -15 19.5 -13 19.5 -10 L19 -3 Q19 0 17 1 L14 1 Q12 0 12 -3 L12 -10 Q12 -15 16 -15Z",
    engine2:
      "M32 -5 C34.5 -5 35.5 -3 35.5 0 L35 7 Q35 10 33 11 L30 11 Q28 10 28 7 L28 0 Q28 -5 32 -5Z",
  },
  A359: {
    body: "M0 -50 C2.8 -49 4.8 -44 4.8 -36 L4.8 25 C4.8 35 2.2 45 0 50 C-2.2 45 -4.8 35 -4.8 25 L-4.8 -36 C-4.8 -44 -2.8 -49 0 -50Z",
    wing: "M0 -19 L46 11 L50 7 L49 17 L46 21 L19 11 L0 18Z",
    tail: "M0 29 L22 41 L24 47 L20 47 L0 39Z",
    engine:
      "M18 -15 C21 -15 22.5 -13 22.5 -10 L22 -1 Q22 3 19.5 4 L16 4 Q13.5 2 13.5 -1 L13.5 -10 Q13.5 -15 18 -15Z",
  },
};
const paths = new Map();

function silhouette(typeId) {
  if (!paths.has(typeId)) {
    const art = artwork[typeId],
      shapes = [],
      mirror = new DOMMatrix().scale(-1, 1);
    for (const component of [
      art.wing,
      art.tail,
      art.engine,
      art.engine2,
    ].filter(Boolean)) {
      const part = new Path2D(component);
      const reflected = new Path2D();
      reflected.addPath(part, mirror);
      shapes.push(part, reflected);
    }
    if (art.propeller) {
      const prop = new Path2D("M12 -19 Q22 -21 32 -19 L32 -18 Q22 -17 12 -18Z");
      const reflected = new Path2D();
      reflected.addPath(prop, mirror);
      shapes.push(prop, reflected);
    }
    shapes.push(new Path2D(art.body));
    paths.set(typeId, shapes);
  }
  return paths.get(typeId);
}

export function aircraftPixels(typeId, zoom) {
  const type = aircraftType(typeId),
    scale = Math.max(0.6, zoom);
  return { length: type.length * scale, wingspan: type.wingspan * scale };
}

export function drawAircraft(c, typeId, zoom, color) {
  const size = aircraftPixels(typeId, zoom);
  // Transform paths, not the context, to retain a thin screen-space outline.
  const transform = new DOMMatrix()
      .rotate(90)
      .scale(size.wingspan / 100, size.length / 100),
    shapes = silhouette(typeId).map((part) => {
      const shape = new Path2D();
      shape.addPath(part, transform);
      return shape;
    });
  c.save();
  c.lineJoin = "round";
  c.strokeStyle = "#111214";
  c.lineWidth = 1.5;
  for (const shape of shapes) c.stroke(shape);
  c.fillStyle = color;
  // Filling after outlining hides internal component joins at small sizes.
  for (const shape of shapes) c.fill(shape);
  if (size.length >= 32) {
    c.rotate(Math.PI / 2);
    c.scale(size.wingspan / 100, size.length / 100);
    c.fillStyle = "rgba(17, 18, 20, 0.5)";
    c.fill(new Path2D("M-3 -39 Q0 -42 3 -39 L3.5 -36 Q0 -38 -3.5 -36Z"));
  }
  c.restore();
}
