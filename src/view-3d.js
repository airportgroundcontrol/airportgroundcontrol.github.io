import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { aircraftType } from "./aircraft/catalog.js";
import { aircraftVisual3d } from "./aircraft/visuals-3d.js";
import { a320ModelFailed, buildA320Model } from "./aircraft/a320-asset.js";

const colors = {
  stand: 0xf2f2ef,
  taxi: 0xf0ca62,
  landing: 0x78b7ff,
  takeoff: 0x67d68c,
  pushback: 0xb88762,
};

const aircraftColor = (aircraft) => {
  if (["gate", "parked"].includes(aircraft.state)) return colors.stand;
  if (aircraft.state === "pushback" && aircraft.pushbackMode === "self")
    return colors.taxi;
  if (["pushback", "disconnect"].includes(aircraft.state))
    return colors.pushback;
  if (["approach", "landing", "goaround"].includes(aircraft.state))
    return colors.landing;
  if (aircraft.state === "takeoff") return colors.takeoff;
  return colors.taxi;
};

function configureRenderer(renderer, pixelRatio) {
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.92;
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, pixelRatio));
}

const point3 = (point, height = 0) =>
  new THREE.Vector3(point.x ?? point[0], height, point.y ?? point[1]);

const normalizeYaw = (yaw) =>
  THREE.MathUtils.euclideanModulo(yaw + Math.PI, Math.PI * 2) - Math.PI;

function polygonShape(points) {
  if (!points || points.length < 3) return null;
  const shape = new THREE.Shape();
  shape.moveTo(points[0][0], -points[0][1]);
  for (let index = 1; index < points.length; index++)
    shape.lineTo(points[index][0], -points[index][1]);
  return shape;
}

function ribbonGeometry(points, width) {
  if (!points || points.length < 2) return null;
  const positions = [];
  for (let index = 0; index < points.length; index++) {
    const previous = points[Math.max(0, index - 1)];
    const next = points[Math.min(points.length - 1, index + 1)];
    const length =
      Math.hypot(next[0] - previous[0], next[1] - previous[1]) || 1;
    const nx = (-(next[1] - previous[1]) / length) * (width / 2);
    const nz = ((next[0] - previous[0]) / length) * (width / 2);
    positions.push(
      points[index][0] + nx,
      0,
      points[index][1] + nz,
      points[index][0] - nx,
      0,
      points[index][1] - nz,
    );
  }
  const indices = [];
  for (let index = 0; index < points.length - 1; index++) {
    const left = index * 2;
    indices.push(left, left + 2, left + 1, left + 2, left + 3, left + 1);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function mergedMesh(geometries, material) {
  if (!geometries.length) return null;
  const geometry = mergeGeometries(geometries, false);
  for (const item of geometries) item.dispose();
  return geometry ? new THREE.Mesh(geometry, material) : null;
}

function lineSegments(features, height, material) {
  const positions = [];
  for (const feature of features)
    for (let index = 1; index < feature.points.length; index++)
      positions.push(
        feature.points[index - 1][0],
        height,
        feature.points[index - 1][1],
        feature.points[index][0],
        height,
        feature.points[index][1],
      );
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3),
  );
  const lines = new THREE.LineSegments(geometry, material);
  if (material.isLineDashedMaterial) lines.computeLineDistances();
  return lines;
}

function sampleEdgeLights(features, spacing, offset) {
  const positions = [];
  for (const feature of features) {
    for (let index = 1; index < feature.points.length; index++) {
      const [ax, az] = feature.points[index - 1];
      const [bx, bz] = feature.points[index];
      const dx = bx - ax;
      const dz = bz - az;
      const length = Math.hypot(dx, dz);
      if (!length) continue;
      const nx = (-dz / length) * offset;
      const nz = (dx / length) * offset;
      const count = Math.max(1, Math.floor(length / spacing));
      for (let step = 0; step <= count; step++) {
        const amount = step / count;
        const x = ax + dx * amount;
        const z = az + dz * amount;
        positions.push(x + nx, 0.55, z + nz, x - nx, 0.55, z - nz);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3),
  );
  return geometry;
}

function featureHeight(feature, style = {}) {
  if (Number.isFinite(style.height) && style.height > 0)
    return Math.min(style.height, 180);
  if (Number.isFinite(style.levels) && style.levels > 0)
    return Math.min(
      style.levels * 3.15 +
        (Number.isFinite(style.roofLevels) ? style.roofLevels * 1.5 : 0),
      180,
    );
  if (/kontrollturm|control tower/i.test(feature.name || feature.ref || ""))
    return 65;
  if (feature.type === "terminal") return 18;
  if (feature.type === "hangar") return 15;
  let hash = 0;
  for (const character of String(feature.id))
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return 7 + (hash % 13);
}

function roadWidth(feature, style = {}) {
  if (feature.width > 0) return feature.width;
  return (
    {
      motorway: 14,
      trunk: 12,
      primary: 10,
      secondary: 8,
      tertiary: 7,
      residential: 5.5,
      unclassified: 5,
      service: 3.8,
      living_street: 4.5,
      cycleway: 2,
      footway: 1.5,
      path: 1.2,
    }[style.roadClass] || 3
  );
}

function buildingCategory(feature, style = {}) {
  const name = feature.name || "";
  const kind = style.buildingClass || "";
  if (
    feature.type === "terminal" ||
    /London City Airport|Jet Centre|City Aviation/i.test(name)
  )
    return "terminal";
  if (
    feature.type === "hangar" ||
    ["industrial", "warehouse", "hangar", "shed"].includes(kind)
  )
    return "industrial";
  if (style.material === "brick") return "brick";
  if (["apartments", "residential", "house", "terrace", "hotel"].includes(kind))
    return "residential";
  if (["church", "school", "university", "civic"].includes(kind))
    return "civic";
  return "commercial";
}

function flatPolygonGeometries(features, height) {
  return features
    .map((feature) => polygonShape(feature.points))
    .filter(Boolean)
    .map((shape) => {
      const geometry = new THREE.ShapeGeometry(shape);
      geometry.rotateX(-Math.PI / 2);
      geometry.translate(0, height, 0);
      return geometry;
    });
}

function facadeBandGeometry(points, bottom, top) {
  if (!points || points.length < 3) return null;
  const closed =
    points[0][0] === points.at(-1)[0] && points[0][1] === points.at(-1)[1];
  const ring = closed ? points.slice(0, -1) : points;
  if (ring.length < 3) return null;
  const centerX = ring.reduce((sum, point) => sum + point[0], 0) / ring.length;
  const centerZ = ring.reduce((sum, point) => sum + point[1], 0) / ring.length;
  const scaled = ring.map(([x, z]) => [
    centerX + (x - centerX) * 1.006,
    centerZ + (z - centerZ) * 1.006,
  ]);
  const positions = [];
  const indices = [];
  for (let index = 0; index < scaled.length; index++) {
    const next = (index + 1) % scaled.length;
    const offset = positions.length / 3;
    positions.push(
      scaled[index][0],
      bottom,
      scaled[index][1],
      scaled[next][0],
      bottom,
      scaled[next][1],
      scaled[index][0],
      top,
      scaled[index][1],
      scaled[next][0],
      top,
      scaled[next][1],
    );
    indices.push(
      offset,
      offset + 1,
      offset + 2,
      offset + 1,
      offset + 3,
      offset + 2,
    );
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function towerPosition(data) {
  const configured = data.towerView;
  const tower = configured
    ? data.features.find((feature) => feature.id === configured.featureId)
    : data.features.find((feature) =>
        /kontrollturm|control tower/i.test(feature.name || feature.ref || ""),
      );
  if (tower?.points?.length) {
    const closed =
      tower.points.length > 1 &&
      tower.points[0][0] === tower.points.at(-1)[0] &&
      tower.points[0][1] === tower.points.at(-1)[1];
    const points = closed ? tower.points.slice(0, -1) : tower.points;
    const height = configured?.structureHeight ?? featureHeight(tower) + 5;
    return {
      x: points.reduce((sum, point) => sum + point[0], 0) / points.length,
      y: points.reduce((sum, point) => sum + point[1], 0) / points.length,
      height,
      viewpointHeight: configured?.viewpointHeight ?? height,
      featureId: tower.id,
    };
  }
  const bounds = data.operations.map.bounds;
  return {
    x: (bounds.minX + bounds.maxX) / 2,
    y: (bounds.minY + bounds.maxY) / 2,
    height: 70,
    viewpointHeight: 70,
    featureId: null,
  };
}

const liveryColors = [
  0x1f5f9f, 0xb3262e, 0x176b68, 0x5c3f91, 0xd07c24, 0x2f4b68,
];

function callsignColor(callsign) {
  let hash = 0;
  for (const character of callsign)
    hash = (hash * 33 + character.charCodeAt(0)) >>> 0;
  return liveryColors[hash % liveryColors.length];
}

function horizontalPrism(points, bottom, top) {
  const positions = [];
  for (const height of [bottom, top])
    for (const [x, z] of points) positions.push(x, height, z);
  const count = points.length;
  const indices = [];
  for (let index = 1; index < count - 1; index++) {
    indices.push(count, count + index, count + index + 1);
    indices.push(0, index + 1, index);
  }
  for (let index = 0; index < count; index++) {
    const next = (index + 1) % count;
    indices.push(index, next, count + index, next, count + next, count + index);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function verticalPrism(points, thickness) {
  const positions = [];
  for (const z of [-thickness / 2, thickness / 2])
    for (const [x, y] of points) positions.push(x, y, z);
  const count = points.length;
  const indices = [];
  for (let index = 1; index < count - 1; index++) {
    indices.push(count, count + index, count + index + 1);
    indices.push(0, index + 1, index);
  }
  for (let index = 0; index < count; index++) {
    const next = (index + 1) % count;
    indices.push(index, next, count + index, next, count + next, count + index);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function mergedBoxes(boxes) {
  const geometries = boxes.map(({ size, position, rotation = [0, 0, 0] }) => {
    const geometry = new THREE.BoxGeometry(...size);
    geometry.rotateX(rotation[0]);
    geometry.rotateY(rotation[1]);
    geometry.rotateZ(rotation[2]);
    geometry.translate(...position);
    return geometry;
  });
  const geometry = mergeGeometries(geometries, false);
  for (const item of geometries) item.dispose();
  return geometry;
}

function aircraftGeometry(aircraft) {
  const type = aircraftType(aircraft.type);
  const visual = aircraftVisual3d(aircraft.type);
  const accentColor = callsignColor(aircraft.call);
  if (aircraft.type === "A320") {
    const model = buildA320Model({ aircraft });
    if (model) return model;
    if (!a320ModelFailed()) return null;
  }
  const group = new THREE.Group();
  const radius = visual.radius;
  const centerY = radius + visual.clearance;
  const bodyMaterial = new THREE.MeshStandardMaterial({
    color: 0xe8eaeb,
    roughness: 0.42,
    metalness: 0.18,
  });
  const wingMaterial = new THREE.MeshStandardMaterial({
    color: 0xc9ced1,
    roughness: 0.5,
    metalness: 0.22,
    side: THREE.DoubleSide,
  });
  const accentMaterial = new THREE.MeshStandardMaterial({
    color: accentColor,
    roughness: 0.42,
    metalness: 0.08,
    side: THREE.DoubleSide,
  });
  const glassMaterial = new THREE.MeshStandardMaterial({
    color: 0x15232c,
    roughness: 0.22,
    metalness: 0.48,
  });
  const tireMaterial = new THREE.MeshStandardMaterial({
    color: 0x111315,
    roughness: 0.92,
  });
  const engineMaterial = new THREE.MeshStandardMaterial({
    color: 0xaeb5b9,
    roughness: 0.4,
    metalness: 0.38,
  });
  const detailMaterial = new THREE.MeshStandardMaterial({
    color: 0x8d9599,
    roughness: 0.5,
    metalness: 0.12,
  });

  const noseTip = {
    airbus: 0.2,
    boeing: 0.08,
    embraer: 0.13,
    turboprop: 0.06,
  }[visual.nose];
  const noseShoulder = {
    airbus: 0.78,
    boeing: 0.65,
    embraer: 0.7,
    turboprop: 0.58,
  }[visual.nose];
  const fuselageProfile = [
    [0.04, -0.5],
    [0.42, -0.475],
    [0.82, -0.425],
    [1, -0.34],
    [1, 0.3],
    [0.96, 0.38],
    [noseShoulder, 0.45],
    [noseTip, 0.5],
  ].map(
    ([scale, longitudinal]) =>
      new THREE.Vector2(radius * scale, type.length * longitudinal),
  );
  const fuselage = new THREE.Mesh(
    new THREE.LatheGeometry(fuselageProfile, 24),
    bodyMaterial,
  );
  fuselage.name = "fuselage";
  fuselage.rotation.z = -Math.PI / 2;
  fuselage.position.y = centerY;
  group.add(fuselage);

  const stripeGeometry = mergedBoxes(
    [-1, 1].map((side) => ({
      size: [type.length * 0.7, 0.17, 0.07],
      position: [0, centerY - radius * 0.05, side * radius * 0.99],
    })),
  );
  const stripe = new THREE.Mesh(stripeGeometry, accentMaterial);
  stripe.name = "livery-stripe";
  group.add(stripe);

  const windows = [];
  const windowCount = Math.max(9, Math.floor(type.length / 1.65));
  for (const side of [-1, 1])
    for (let index = 0; index < windowCount; index++) {
      const amount = windowCount === 1 ? 0.5 : index / (windowCount - 1);
      windows.push({
        size: [0.52, 0.34, 0.08],
        position: [
          THREE.MathUtils.lerp(-type.length * 0.34, type.length * 0.31, amount),
          centerY + radius * 0.28,
          side * radius * 0.97,
        ],
      });
    }
  for (const side of [-1, 1])
    windows.push({
      size: [0.82, 0.48, 0.09],
      position: [
        type.length * 0.405,
        centerY + radius * 0.31,
        side * radius * 0.72,
      ],
      rotation: [0, side * 0.34, 0],
    });
  const windowMesh = new THREE.Mesh(mergedBoxes(windows), glassMaterial);
  windowMesh.name = "windows";
  group.add(windowMesh);

  const doorFractions = visual.upperDeck
    ? [0.34, 0.2, 0.02, -0.18, -0.35]
    : type.length > 55
      ? [0.34, 0.12, -0.13, -0.34]
      : [0.34, -0.32];
  const doors = new THREE.Mesh(
    mergedBoxes(
      [-1, 1].flatMap((side) =>
        doorFractions.flatMap((fraction) => {
          const width = Math.max(0.58, radius * 0.24);
          const height = radius * 0.72;
          const x = type.length * fraction;
          const y = centerY + radius * 0.02;
          const z = side * radius * 0.995;
          return [
            { size: [0.055, height, 0.07], position: [x - width / 2, y, z] },
            { size: [0.055, height, 0.07], position: [x + width / 2, y, z] },
            { size: [width, 0.055, 0.07], position: [x, y - height / 2, z] },
            { size: [width, 0.055, 0.07], position: [x, y + height / 2, z] },
          ];
        }),
      ),
    ),
    detailMaterial,
  );
  doors.name = "cabin-doors";
  group.add(doors);

  const [rootLeading, rootTrailing, tipLeading, tipTrailing, wingHeight] =
    visual.wing;
  const wingY = centerY + radius * wingHeight;
  const halfSpan = type.wingspan / 2;
  const wings = new THREE.Mesh(
    horizontalPrism(
      [
        [rootLeading, 0],
        [tipLeading, halfSpan],
        [tipTrailing, halfSpan],
        [rootTrailing, 0],
        [tipTrailing, -halfSpan],
        [tipLeading, -halfSpan],
      ],
      wingY - Math.max(0.15, radius * 0.08),
      wingY + Math.max(0.15, radius * 0.08),
    ),
    wingMaterial,
  );
  wings.name = "swept-wings";
  group.add(wings);

  const tailSpan = visual.tailSpan;
  const tailY =
    visual.tail === "t"
      ? type.height - Math.max(0.55, radius * 0.35)
      : centerY + radius * 0.12;
  const tail = new THREE.Mesh(
    horizontalPrism(
      [
        [-type.length * 0.34, 0],
        [-type.length * 0.4, tailSpan / 2],
        [-type.length * 0.47, tailSpan / 2],
        [-type.length * 0.46, 0],
        [-type.length * 0.47, -tailSpan / 2],
        [-type.length * 0.4, -tailSpan / 2],
      ],
      tailY,
      tailY + Math.max(0.18, radius * 0.08),
    ),
    wingMaterial,
  );
  tail.name = "horizontal-stabilizer";
  group.add(tail);

  const fin = new THREE.Mesh(
    verticalPrism(
      [
        [-type.length * 0.475, centerY + radius * 0.5],
        [-type.length * 0.31, centerY + radius * 0.5],
        [-type.length * 0.405, type.height],
        [-type.length * 0.465, type.height - radius * 0.25],
      ],
      Math.max(0.28, radius * 0.18),
    ),
    accentMaterial,
  );
  fin.name = "vertical-stabilizer";
  group.add(fin);

  if (!["plain", "raked"].includes(visual.wingtip)) {
    const wingletHeight = {
      small: 1.25,
      fence: 1.05,
      sharklet: 2.35,
      blended: 2.55,
      curved: 2.0,
    }[visual.wingtip];
    const wingletX = (tipLeading + tipTrailing) / 2;
    const winglets = mergedBoxes(
      [-1, 1].map((side) => ({
        size: [Math.max(0.25, radius * 0.16), wingletHeight, 0.24],
        position: [
          wingletX,
          wingY + wingletHeight / 2,
          side * (halfSpan - 0.15),
        ],
        rotation: [
          side * (visual.wingtip === "curved" ? 0.38 : 0.16),
          0,
          visual.wingtip === "blended" ? -0.28 : -0.12,
        ],
      })),
    );
    const wingletMesh = new THREE.Mesh(winglets, accentMaterial);
    wingletMesh.name = visual.wingtip + "-wingtips";
    group.add(wingletMesh);
  }

  const engineProfile = visual.engines;
  if (engineProfile.kind === "prop") {
    for (const side of [-1, 1]) {
      const lane = side * type.wingspan * engineProfile.lanes[0];
      const nacelle = new THREE.Mesh(
        new THREE.CapsuleGeometry(
          engineProfile.radius,
          engineProfile.length,
          6,
          16,
        ),
        engineMaterial,
      );
      nacelle.name = "turboprop-engine";
      nacelle.rotation.z = -Math.PI / 2;
      nacelle.position.set(engineProfile.x, wingY - radius * 0.08, lane);
      group.add(nacelle);

      const propeller = new THREE.Group();
      propeller.name = "propeller";
      propeller.position.set(
        engineProfile.x + engineProfile.length / 2 + engineProfile.radius,
        wingY - radius * 0.08,
        lane,
      );
      for (let blade = 0; blade < engineProfile.blades / 2; blade++) {
        const mesh = new THREE.Mesh(
          new THREE.BoxGeometry(0.12, engineProfile.radius * 4.4, 0.16),
          tireMaterial,
        );
        mesh.rotation.x = (blade * Math.PI) / (engineProfile.blades / 2);
        propeller.add(mesh);
      }
      const hub = new THREE.Mesh(
        new THREE.CylinderGeometry(
          engineProfile.radius * 0.24,
          engineProfile.radius * 0.33,
          0.62,
          14,
        ),
        accentMaterial,
      );
      hub.rotation.z = -Math.PI / 2;
      propeller.add(hub);
      group.add(propeller);
    }
  } else {
    const nacelleRadius = engineProfile.radius;
    const nacelleLength = engineProfile.length;
    for (const side of [-1, 1])
      for (const [laneIndex, laneFactor] of engineProfile.lanes.entries()) {
        const lane = side * type.wingspan * laneFactor;
        const pod = new THREE.Group();
        pod.position.set(
          engineProfile.x - laneIndex * radius * 0.75,
          Math.max(nacelleRadius + 0.35, wingY - nacelleRadius * 1.05),
          lane,
        );
        if (engineProfile.flattened) pod.scale.y = 0.82;
        const engine = new THREE.Mesh(
          new THREE.CylinderGeometry(
            nacelleRadius * 0.94,
            nacelleRadius * 0.72,
            nacelleLength,
            24,
          ),
          engineMaterial,
        );
        engine.name = "jet-engine";
        engine.rotation.z = -Math.PI / 2;
        pod.add(engine);
        const intake = new THREE.Mesh(
          new THREE.CylinderGeometry(
            nacelleRadius * 0.7,
            nacelleRadius * 0.7,
            0.1,
            24,
          ),
          glassMaterial,
        );
        intake.name = "engine-intake";
        intake.rotation.z = -Math.PI / 2;
        intake.position.x = nacelleLength / 2 + 0.06;
        pod.add(intake);
        const lip = new THREE.Mesh(
          new THREE.TorusGeometry(nacelleRadius * 0.82, 0.08, 7, 24),
          engineMaterial,
        );
        lip.name = "engine-lip";
        lip.rotation.y = Math.PI / 2;
        lip.position.x = nacelleLength / 2 + 0.12;
        pod.add(lip);
        const pylon = new THREE.Mesh(
          new THREE.BoxGeometry(
            nacelleLength * 0.35,
            nacelleRadius * 0.95,
            nacelleRadius * 0.18,
          ),
          wingMaterial,
        );
        pylon.name = "engine-pylon";
        pylon.position.set(-nacelleLength * 0.08, nacelleRadius * 0.72, 0);
        pylon.rotation.z = -0.14;
        pod.add(pylon);
        group.add(pod);
      }
  }

  if (visual.upperDeck) {
    const upperDeckProfile = [
      [0.03, -0.5],
      [0.42, -0.46],
      [0.82, -0.37],
      [1, -0.22],
      [1, 0.18],
      [0.78, 0.36],
      [0.12, 0.5],
    ].map(
      ([scale, longitudinal]) =>
        new THREE.Vector2(
          radius * 0.48 * scale,
          type.length * 0.28 * longitudinal,
        ),
    );
    const upperDeck = new THREE.Mesh(
      new THREE.LatheGeometry(upperDeckProfile, 20),
      bodyMaterial,
    );
    upperDeck.name = "upper-deck";
    upperDeck.rotation.z = -Math.PI / 2;
    upperDeck.position.set(type.length * 0.235, centerY + radius * 0.79, 0);
    group.add(upperDeck);
    const upperWindows = [];
    for (const side of [-1, 1])
      for (let index = 0; index < 9; index++)
        upperWindows.push({
          size: [0.48, 0.28, 0.08],
          position: [
            type.length * (0.13 + index * 0.018),
            centerY + radius * 1.04,
            side * radius * 0.48,
          ],
        });
    const upperWindowMesh = new THREE.Mesh(
      mergedBoxes(upperWindows),
      glassMaterial,
    );
    upperWindowMesh.name = "upper-deck-windows";
    group.add(upperWindowMesh);
  }

  const gear = new THREE.Group();
  gear.name = "landing-gear";
  const wheelRadius = Math.max(0.3, radius * 0.14);
  const wheelWidth = wheelRadius * 0.72;
  const wheelGeometry = new THREE.CylinderGeometry(
    wheelRadius,
    wheelRadius,
    wheelWidth,
    14,
  );
  wheelGeometry.rotateX(Math.PI / 2);
  const addLeg = (x, z, axles) => {
    const axleSpacing = wheelRadius * 2.35;
    for (let axle = 0; axle < axles; axle++) {
      const axleX = x + (axle - (axles - 1) / 2) * axleSpacing;
      for (const side of [-1, 1]) {
        const wheel = new THREE.Mesh(wheelGeometry, tireMaterial);
        wheel.position.set(axleX, wheelRadius, z + side * wheelWidth * 0.62);
        gear.add(wheel);
      }
    }
    const strut = new THREE.Mesh(
      new THREE.CylinderGeometry(
        Math.max(0.07, radius * 0.035),
        Math.max(0.07, radius * 0.035),
        Math.max(0.5, centerY - radius * 0.6),
        8,
      ),
      engineMaterial,
    );
    strut.position.set(x, (centerY - radius * 0.6) / 2, z);
    gear.add(strut);
  };
  addLeg(type.length * 0.33, 0, 1);
  const mainX = -type.length * 0.075;
  if (visual.gear.mainLegs === 4) {
    for (const z of [
      -type.wingspan * 0.16,
      -radius * 0.82,
      radius * 0.82,
      type.wingspan * 0.16,
    ])
      addLeg(mainX, z, visual.gear.mainAxles);
  } else {
    const mainZ = visual.gear.nacelleMounted
      ? type.wingspan * 0.27
      : radius * 1.18;
    for (const side of [-1, 1])
      addLeg(mainX, side * mainZ, visual.gear.mainAxles);
  }
  group.add(gear);

  const statusMaterial = new THREE.MeshBasicMaterial({ color: colors.stand });
  const beacon = new THREE.Mesh(
    new THREE.SphereGeometry(Math.max(0.16, radius * 0.09), 8, 6),
    statusMaterial,
  );
  beacon.name = "status-beacon";
  beacon.position.set(0, centerY + radius + 0.12, 0);
  group.add(beacon);
  for (const [z, color] of [
    [-halfSpan, 0xff4a45],
    [halfSpan, 0x55ff88],
  ]) {
    const light = new THREE.Mesh(
      new THREE.SphereGeometry(0.2, 7, 5),
      new THREE.MeshBasicMaterial({ color }),
    );
    light.position.set(-type.length * 0.07, wingY, z);
    group.add(light);
  }

  const pickTarget = new THREE.Mesh(
    new THREE.BoxGeometry(type.length, 12, type.wingspan),
    new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0,
      depthWrite: false,
      colorWrite: false,
    }),
  );
  pickTarget.name = "pick-target";
  pickTarget.position.y = 4;
  group.add(pickTarget);

  group.userData.statusMaterial = statusMaterial;
  group.userData.gear = gear;
  group.userData.modelProfile = {
    type: aircraft.type,
    propulsion: engineProfile.kind,
    engineCount: engineProfile.lanes.length * 2,
    propellerBlades: engineProfile.blades || 0,
    tail: visual.tail,
    wingtip: visual.wingtip,
    mainGearLegs: visual.gear.mainLegs,
    mainGearAxles: visual.gear.mainAxles,
    upperDeck: !!visual.upperDeck,
  };
  group.userData.visualParts = [
    "fuselage",
    "swept-wings",
    "windows",
    type.shape === "turboprop" ? "propeller" : "jet-engine",
    "landing-gear",
  ];
  return group;
}

function buildAirport(scene, data, tower) {
  const bounds = data.operations.map.bounds;
  const environment = data.environment || { features: [], featureStyles: {} };
  const visualStyle = (feature) => environment.featureStyles[feature.id] || {};
  const naturalAirfield = environment.features.some(
    (feature) => feature.type === "wood",
  );
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerZ = (bounds.minY + bounds.maxY) / 2;
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(
      bounds.maxX - bounds.minX + 7000,
      bounds.maxY - bounds.minY + 7000,
    ),
    new THREE.MeshStandardMaterial({
      color: naturalAirfield ? 0x465342 : 0x555a55,
      roughness: 1,
    }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(centerX, -0.18, centerZ);
  scene.add(ground);

  const byType = (types) =>
    data.features.filter((feature) => types.includes(feature.type));
  const environmentByType = (types) =>
    environment.features.filter((feature) => types.includes(feature.type));

  const water = environmentByType(["water"]);
  const waterMesh = mergedMesh(
    flatPolygonGeometries(water, -0.105),
    new THREE.MeshPhysicalMaterial({
      color: 0x426d7d,
      roughness: 0.24,
      metalness: 0.08,
      clearcoat: 0.45,
      clearcoatRoughness: 0.3,
    }),
  );
  if (waterMesh) scene.add(waterMesh);
  if (water.length)
    scene.add(
      lineSegments(
        water,
        -0.075,
        new THREE.LineBasicMaterial({
          color: 0x9aa8a2,
          transparent: true,
          opacity: 0.55,
        }),
      ),
    );

  const grass = environmentByType(["grass"]);
  const grassMesh = mergedMesh(
    flatPolygonGeometries(grass, -0.055),
    new THREE.MeshStandardMaterial({ color: 0x486143, roughness: 1 }),
  );
  if (grassMesh) scene.add(grassMesh);

  const woods = [...environmentByType(["wood"]), ...byType(["wood"])];
  const woodMesh = mergedMesh(
    flatPolygonGeometries(woods, -0.045),
    new THREE.MeshStandardMaterial({ color: 0x304b35, roughness: 1 }),
  );
  if (woodMesh) scene.add(woodMesh);

  const roads = [...byType(["road"]), ...environmentByType(["road"])];
  const roadGroups = {
    main: roads.filter((feature) =>
      ["motorway", "trunk", "primary", "secondary", "tertiary"].includes(
        visualStyle(feature).roadClass,
      ),
    ),
    local: roads.filter((feature) =>
      ["residential", "unclassified", "service", "living_street"].includes(
        visualStyle(feature).roadClass,
      ),
    ),
  };
  roadGroups.path = roads.filter(
    (feature) =>
      !roadGroups.main.includes(feature) && !roadGroups.local.includes(feature),
  );
  for (const [kind, features] of Object.entries(roadGroups)) {
    const mesh = mergedMesh(
      features
        .map((feature) =>
          ribbonGeometry(
            feature.points,
            roadWidth(feature, visualStyle(feature)),
          ),
        )
        .filter(Boolean),
      new THREE.MeshStandardMaterial({
        color:
          kind === "main" ? 0x45494b : kind === "local" ? 0x4d5151 : 0x5e625d,
        roughness: 0.96,
      }),
    );
    if (mesh) {
      mesh.position.y = kind === "path" ? -0.01 : 0;
      scene.add(mesh);
    }
  }

  const rail = environmentByType(["rail"]);
  const railBed = mergedMesh(
    rail
      .map((feature) => ribbonGeometry(feature.points, feature.width || 3))
      .filter(Boolean),
    new THREE.MeshStandardMaterial({ color: 0x34383a, roughness: 0.8 }),
  );
  if (railBed) {
    railBed.position.y = 0.04;
    scene.add(railBed);
  }

  const apronGeometries = flatPolygonGeometries(
    byType(["apron", "staging_area", "stand_area"]),
    0.015,
  );
  const aprons = mergedMesh(
    apronGeometries,
    new THREE.MeshStandardMaterial({ color: 0x4d5354, roughness: 0.92 }),
  );
  if (aprons) scene.add(aprons);

  const runways = byType(["runway"]);
  const runwayMesh = mergedMesh(
    runways
      .map((feature) => ribbonGeometry(feature.points, feature.width || 45))
      .filter(Boolean),
    new THREE.MeshStandardMaterial({ color: 0x252a2d, roughness: 0.88 }),
  );
  if (runwayMesh) {
    runwayMesh.position.y = 0.08;
    scene.add(runwayMesh);
  }

  const taxiways = byType(["taxiway"]);
  const taxiMesh = mergedMesh(
    taxiways
      .map((feature) => ribbonGeometry(feature.points, feature.width || 18))
      .filter(Boolean),
    new THREE.MeshStandardMaterial({ color: 0x3d4345, roughness: 0.9 }),
  );
  if (taxiMesh) {
    taxiMesh.position.y = 0.04;
    scene.add(taxiMesh);
  }

  scene.add(
    lineSegments(
      taxiways,
      0.19,
      new THREE.LineBasicMaterial({
        color: 0xe1bd55,
        transparent: true,
        opacity: 0.85,
      }),
    ),
  );
  scene.add(
    lineSegments(
      runways,
      0.2,
      new THREE.LineDashedMaterial({
        color: 0xe5e7e7,
        dashSize: 32,
        gapSize: 25,
        transparent: true,
        opacity: 0.8,
      }),
    ),
  );

  const runwayLights = new THREE.Points(
    sampleEdgeLights(runways, 65, 23),
    new THREE.PointsMaterial({
      color: 0xf5f1d0,
      size: 3.2,
      sizeAttenuation: true,
    }),
  );
  scene.add(runwayLights);
  const taxiLights = new THREE.Points(
    sampleEdgeLights(taxiways, 75, 9),
    new THREE.PointsMaterial({
      color: 0x5aa8ff,
      size: 1.7,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.85,
    }),
  );
  scene.add(taxiLights);

  const buildings = byType(["building", "terminal", "hangar"]);
  const buildingGroups = new Map();
  const windowGeometry = [];
  for (const feature of buildings) {
    if (feature.id === tower.featureId) continue;
    const shape = polygonShape(feature.points);
    if (!shape) continue;
    const style = visualStyle(feature);
    const height = featureHeight(feature, style);
    const category = buildingCategory(feature, style);
    const geometry = new THREE.ExtrudeGeometry(shape, {
      depth: height,
      bevelEnabled: false,
      curveSegments: 1,
    });
    geometry.rotateX(-Math.PI / 2);
    const roof = new THREE.ShapeGeometry(shape);
    roof.rotateX(-Math.PI / 2);
    roof.translate(0, height + 0.025, 0);
    if (!buildingGroups.has(category))
      buildingGroups.set(category, { walls: [], roofs: [] });
    buildingGroups.get(category).walls.push(geometry);
    buildingGroups.get(category).roofs.push(roof);
    if (height >= 9 && category !== "industrial") {
      const bands = category === "terminal" || height >= 24 ? 2 : 1;
      for (let index = 0; index < bands; index++) {
        const center = height * (bands === 1 ? 0.55 : 0.38 + index * 0.28);
        const windows = facadeBandGeometry(
          feature.points,
          Math.max(2.5, center - 0.7),
          Math.min(height - 0.7, center + 0.7),
        );
        if (windows) windowGeometry.push(windows);
      }
    }
  }
  const buildingPalette = {
    terminal: { wall: 0x819ca4, roof: 0xc5cbca, metalness: 0.16 },
    industrial: { wall: 0x727b78, roof: 0xa1a6a2, metalness: 0.08 },
    brick: { wall: 0x8a6456, roof: 0x625c58, metalness: 0 },
    residential: { wall: 0x9a8876, roof: 0x6c6761, metalness: 0 },
    civic: { wall: 0xaaa49a, roof: 0x777570, metalness: 0 },
    commercial: { wall: 0x747f82, roof: 0x9aa2a2, metalness: 0.04 },
  };
  for (const [category, geometries] of buildingGroups) {
    const palette = buildingPalette[category];
    const walls = mergedMesh(
      geometries.walls,
      new THREE.MeshStandardMaterial({
        color: palette.wall,
        roughness: category === "terminal" ? 0.48 : 0.78,
        metalness: palette.metalness,
      }),
    );
    const roofs = mergedMesh(
      geometries.roofs,
      new THREE.MeshStandardMaterial({
        color: palette.roof,
        roughness: 0.88,
        metalness: palette.metalness * 0.5,
      }),
    );
    if (walls) scene.add(walls);
    if (roofs) scene.add(roofs);
  }
  const windows = mergedMesh(
    windowGeometry,
    new THREE.MeshPhysicalMaterial({
      color: 0x263f49,
      roughness: 0.22,
      metalness: 0.18,
      clearcoat: 0.35,
    }),
  );
  if (windows) scene.add(windows);

  const towerBase = new THREE.Mesh(
    new THREE.CylinderGeometry(6, 9, tower.height - 9, 12, 1, true),
    new THREE.MeshStandardMaterial({ color: 0x8a9190, roughness: 0.74 }),
  );
  towerBase.position.set(tower.x, (tower.height - 9) / 2, tower.y);
  scene.add(towerBase);
  const towerCab = new THREE.Mesh(
    new THREE.CylinderGeometry(9.5, 7.5, 6.5, 12, 1, true),
    new THREE.MeshPhysicalMaterial({
      color: 0x233d48,
      roughness: 0.2,
      metalness: 0.18,
      clearcoat: 0.55,
    }),
  );
  towerCab.position.set(tower.x, tower.height - 4.25, tower.y);
  scene.add(towerCab);
  const antenna = new THREE.Mesh(
    new THREE.CylinderGeometry(0.15, 0.15, 5, 8),
    new THREE.MeshStandardMaterial({ color: 0x4d5150, roughness: 0.6 }),
  );
  antenna.position.set(tower.x, tower.height + 2.5, tower.y);
  scene.add(antenna);
}

export class TowerView {
  constructor(
    canvas,
    sim,
    onSelect,
    {
      labelRoot = document.getElementById("tower-labels"),
      viewState = null,
    } = {},
  ) {
    this.canvas = canvas;
    this.sim = sim;
    this.onSelect = onSelect;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x9aa8b0);
    this.scene.fog = new THREE.FogExp2(0x9aa8b0, 0.000105);
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.5, 24000);
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: "high-performance",
    });
    configureRenderer(this.renderer, 1.75);
    this.tower = towerPosition(sim.data);
    this.cameraDefinitions = new Map(
      sim.data.cameraViews.map((camera) => [camera.id, camera]),
    );
    this.cameraStates = new Map(
      sim.data.cameraViews.map((camera) => {
        const dx = camera.target.x - camera.position.x,
          dz = camera.target.y - camera.position.y,
          dy = camera.target.height - camera.position.height;
        return [
          camera.id,
          {
            yaw: Math.atan2(dx, dz),
            pitch: Math.atan2(dy, Math.hypot(dx, dz)),
            fov: camera.fov,
          },
        ];
      }),
    );
    this.feeds = new Map();
    this.lastFeedRender = 0;
    this.aircraft = new Map();
    this.labels = new Map();
    this.labelRoot = labelRoot;
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.selected = null;
    this.routeLine = new THREE.Line(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: 0x8fc9ff, linewidth: 2 }),
    );
    this.scene.add(this.routeLine);
    this.scene.add(new THREE.HemisphereLight(0xe4edf2, 0x283126, 2.2));
    const sun = new THREE.DirectionalLight(0xfff1d5, 2.6);
    sun.position.set(-3500, 5200, -2800);
    this.scene.add(sun);
    buildAirport(this.scene, sim.data, this.tower);
    this.resetView();
    this.restoreViewState(viewState);
    this.resize();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    this.bind();
  }

  resetView() {
    const bounds = this.sim.data.operations.map.bounds;
    const target = {
      x: (bounds.minX + bounds.maxX) / 2,
      y: (bounds.minY + bounds.maxY) / 2,
    };
    this.camera.position.set(
      this.tower.x,
      this.tower.viewpointHeight,
      this.tower.y,
    );
    this.yaw = Math.atan2(target.x - this.tower.x, target.y - this.tower.y);
    this.pitch = -0.08;
    this.camera.fov = 50;
    this.camera.updateProjectionMatrix();
    this.updateCamera();
  }

  updateCamera() {
    this.updateLook(this.camera, this);
  }

  updateLook(camera, state) {
    const direction = new THREE.Vector3(
      Math.sin(state.yaw) * Math.cos(state.pitch),
      Math.sin(state.pitch),
      Math.cos(state.yaw) * Math.cos(state.pitch),
    );
    camera.lookAt(camera.position.clone().add(direction));
  }

  resize() {
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
  }

  focusAircraft(id) {
    const aircraft = this.sim.planes.find((plane) => plane.id === id);
    if (!aircraft) return;
    const dx = aircraft.x - this.tower.x;
    const dz = aircraft.y - this.tower.y;
    const altitude = this.altitude(aircraft);
    this.yaw = Math.atan2(dx, dz);
    this.pitch = Math.atan2(
      altitude - this.tower.viewpointHeight,
      Math.hypot(dx, dz),
    );
    this.pitch = THREE.MathUtils.clamp(this.pitch, -0.55, 0.25);
    this.updateCamera();
  }

  setSelected(id, focus = false) {
    this.selected = id;
    if (focus) this.focusAircraft(id);
  }

  getViewpoint() {
    const verticalFov = THREE.MathUtils.degToRad(this.camera.fov);
    return {
      x: this.tower.x,
      y: this.tower.y,
      yaw: this.yaw,
      horizontalFov:
        2 * Math.atan(Math.tan(verticalFov / 2) * this.camera.aspect),
    };
  }

  cameraFor(definition, state, aspect = 16 / 9) {
    const camera = new THREE.PerspectiveCamera(state.fov, aspect, 0.5, 24000);
    camera.position.set(
      definition.position.x,
      definition.position.height,
      definition.position.y,
    );
    this.updateLook(camera, state);
    return camera;
  }

  bindCamera(canvas, camera, state) {
    const controls = new AbortController(),
      options = { signal: controls.signal };
    let drag = null;
    canvas.addEventListener(
      "pointerdown",
      (event) => {
        if (event.button !== 0) return;
        canvas.setPointerCapture(event.pointerId);
        drag = { x: event.clientX, y: event.clientY };
        canvas.classList.add("dragging");
      },
      options,
    );
    canvas.addEventListener(
      "pointermove",
      (event) => {
        if (!drag) return;
        state.yaw += (event.clientX - drag.x) * 0.0032;
        state.pitch = THREE.MathUtils.clamp(
          state.pitch + (event.clientY - drag.y) * 0.0024,
          -0.75,
          0.35,
        );
        drag = { x: event.clientX, y: event.clientY };
        this.updateLook(camera, state);
      },
      options,
    );
    for (const eventName of ["pointerup", "pointercancel"])
      canvas.addEventListener(
        eventName,
        () => {
          drag = null;
          canvas.classList.remove("dragging");
        },
        options,
      );
    canvas.addEventListener(
      "wheel",
      (event) => {
        event.preventDefault();
        state.fov = THREE.MathUtils.clamp(
          state.fov + event.deltaY * 0.025,
          6,
          75,
        );
        camera.fov = state.fov;
        camera.updateProjectionMatrix();
      },
      { passive: false, signal: controls.signal },
    );
    return controls;
  }

  attachCamera(id, canvas) {
    const definition = this.cameraDefinitions.get(id);
    if (!definition) return false;
    this.detachCamera(id);
    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: "high-performance",
    });
    configureRenderer(renderer, 1.25);
    const state = this.cameraStates.get(id),
      camera = this.cameraFor(definition, state);
    const resize = () => {
      const width = canvas.clientWidth,
        height = canvas.clientHeight;
      if (!width || !height) return;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(canvas);
    const controls = this.bindCamera(canvas, camera, state);
    this.feeds.set(id, { camera, renderer, resizeObserver, controls });
    resize();
    return true;
  }

  detachCamera(id) {
    const feed = this.feeds.get(id);
    if (!feed) return;
    feed.controls.abort();
    feed.resizeObserver.disconnect();
    feed.renderer.dispose();
    this.feeds.delete(id);
  }

  getCameraViewpoints() {
    return [...this.cameraDefinitions.values()].map((definition) => {
      const feed = this.feeds.get(definition.id),
        state = this.cameraStates.get(definition.id),
        aspect = feed?.camera.aspect || 16 / 9,
        verticalFov = THREE.MathUtils.degToRad(state.fov);
      return {
        id: definition.id,
        label: definition.label,
        shortLabel: definition.shortLabel,
        x: definition.position.x,
        y: definition.position.y,
        yaw: state.yaw,
        horizontalFov: 2 * Math.atan(Math.tan(verticalFov / 2) * aspect),
        active: this.feeds.has(definition.id),
      };
    });
  }

  captureViewState() {
    return {
      tower: {
        yaw: normalizeYaw(this.yaw),
        pitch: this.pitch,
        fov: this.camera.fov,
      },
      cameras: Object.fromEntries(
        [...this.cameraStates].map(([id, state]) => [
          id,
          {
            yaw: normalizeYaw(state.yaw),
            pitch: state.pitch,
            fov: state.fov,
          },
        ]),
      ),
    };
  }

  restoreViewState(value) {
    if (!value) return;
    if (value.tower) {
      this.yaw = normalizeYaw(value.tower.yaw);
      this.pitch = THREE.MathUtils.clamp(value.tower.pitch, -0.55, 0.25);
      this.camera.fov = THREE.MathUtils.clamp(value.tower.fov, 6, 60);
      this.camera.updateProjectionMatrix();
      this.updateCamera();
    }
    for (const [id, saved] of Object.entries(value.cameras || {})) {
      const state = this.cameraStates.get(id);
      if (!state) continue;
      state.yaw = normalizeYaw(saved.yaw);
      state.pitch = THREE.MathUtils.clamp(saved.pitch, -0.75, 0.35);
      state.fov = THREE.MathUtils.clamp(saved.fov, 6, 75);
    }
  }

  altitude(aircraft) {
    if (!aircraft.airborne) return 0;
    if (aircraft.state === "goaround") return 150;
    const runway = this.sim.runwayFor(aircraft);
    const distance = Math.hypot(
      aircraft.x - runway.start.x,
      aircraft.y - runway.start.y,
    );
    return Math.min(850, Math.max(8, distance * 0.0524));
  }

  updateAircraft() {
    const live = new Set();
    for (const aircraft of this.sim.planes) {
      if (aircraft.state === "done") continue;
      live.add(aircraft.id);
      let model = this.aircraft.get(aircraft.id);
      if (!model) {
        model = aircraftGeometry(aircraft);
        if (!model) continue;
        model.userData.aircraftId = aircraft.id;
        this.aircraft.set(aircraft.id, model);
        this.scene.add(model);
        const label = document.createElement("span");
        label.className = "aircraft-label";
        this.labels.set(aircraft.id, label);
        this.labelRoot.append(label);
      }
      const altitude = this.altitude(aircraft);
      model.position.set(aircraft.x, altitude, aircraft.y);
      model.rotation.y = -aircraft.angle;
      model.userData.statusMaterial.color.setHex(aircraftColor(aircraft));
      model.userData.gear.visible = altitude < 25;
    }
    for (const [id, model] of this.aircraft)
      if (!live.has(id)) {
        this.scene.remove(model);
        this.aircraft.delete(id);
        this.labels.get(id)?.remove();
        this.labels.delete(id);
      }
  }

  updateRoute() {
    const aircraft = this.sim.planes.find(
      (plane) => plane.id === this.selected,
    );
    const points = aircraft?.route?.length
      ? [aircraft, ...aircraft.route].map((point) => point3(point, 1.2))
      : [];
    if (points.length < 2) {
      this.routeLine.visible = false;
      return;
    }
    const positions = this.routeLine.geometry.getAttribute("position");
    if (!positions || positions.count !== points.length) {
      this.routeLine.geometry.dispose();
      this.routeLine.geometry = new THREE.BufferGeometry().setFromPoints(
        points,
      );
    } else {
      for (let index = 0; index < points.length; index++)
        positions.setXYZ(
          index,
          points[index].x,
          points[index].y,
          points[index].z,
        );
      positions.needsUpdate = true;
      this.routeLine.geometry.computeBoundingSphere();
    }
    this.routeLine.visible = true;
  }

  updateLabels() {
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    for (const [id, label] of this.labels) {
      const aircraft = this.sim.planes.find((plane) => plane.id === id);
      const model = this.aircraft.get(id);
      if (!aircraft || !model) {
        label.hidden = true;
        continue;
      }
      const position = model.position.clone();
      position.y += Math.max(7, aircraftType(aircraft.type).length * 0.1);
      position.project(this.camera);
      const visible = position.z > -1 && position.z < 1;
      label.hidden = !visible;
      if (!visible) continue;
      label.style.left = `${(position.x * 0.5 + 0.5) * width}px`;
      label.style.top = `${(-position.y * 0.5 + 0.5) * height}px`;
      label.textContent = `${aircraft.call} · ${aircraft.type}`;
      label.style.borderColor = `#${aircraftColor(aircraft).toString(16).padStart(6, "0")}`;
      label.classList.toggle("selected", id === this.selected);
    }
  }

  render(now = performance.now()) {
    this.updateAircraft();
    this.updateRoute();
    this.updateLabels();
    this.renderer.render(this.scene, this.camera);
    if (now - this.lastFeedRender >= 100) {
      for (const feed of this.feeds.values())
        feed.renderer.render(this.scene, feed.camera);
      this.lastFeedRender = now;
    }
  }

  pick(clientX, clientY) {
    const bounds = this.canvas.getBoundingClientRect();
    this.pointer.set(
      ((clientX - bounds.left) / bounds.width) * 2 - 1,
      -((clientY - bounds.top) / bounds.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects(
      [...this.aircraft.values()],
      true,
    );
    for (const hit of hits) {
      let target = hit.object;
      while (target && !target.userData.aircraftId) target = target.parent;
      if (target?.userData.aircraftId) return target.userData.aircraftId;
    }
    return null;
  }

  bind() {
    let drag = null;
    this.canvas.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      this.canvas.setPointerCapture(event.pointerId);
      drag = { x: event.clientX, y: event.clientY, moved: false };
      this.canvas.classList.add("dragging");
    });
    this.canvas.addEventListener("pointermove", (event) => {
      if (!drag) return;
      const dx = event.clientX - drag.x;
      const dy = event.clientY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 2) drag.moved = true;
      this.yaw += dx * 0.0032;
      this.pitch = THREE.MathUtils.clamp(this.pitch + dy * 0.0024, -0.55, 0.25);
      drag.x = event.clientX;
      drag.y = event.clientY;
      this.updateCamera();
    });
    this.canvas.addEventListener("pointerup", (event) => {
      this.canvas.classList.remove("dragging");
      if (drag && !drag.moved) {
        const id = this.pick(event.clientX, event.clientY);
        if (id) this.onSelect(id, { x: event.clientX, y: event.clientY });
      }
      drag = null;
    });
    this.canvas.addEventListener(
      "wheel",
      (event) => {
        event.preventDefault();
        this.camera.fov = THREE.MathUtils.clamp(
          this.camera.fov + event.deltaY * 0.025,
          6,
          60,
        );
        this.camera.updateProjectionMatrix();
      },
      { passive: false },
    );
  }

  dispose() {
    this.resizeObserver.disconnect();
    for (const id of [...this.feeds.keys()]) this.detachCamera(id);
    this.renderer.dispose();
    for (const label of this.labels.values()) label.remove();
  }
}
