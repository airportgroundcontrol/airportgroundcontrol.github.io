import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import sourceBytes from "../../assets/aircraft/A320_nologo.glb";

const LENGTH = 37.57;
const WINGSPAN = 35.8;
const HEIGHT = 11.76;
const WHEELBASE = 12.64;
const MAIN_GEAR_TRACK = 7.59;

// Source bounds are retained here so the logo-free mesh is centered and
// dimensioned deterministically without modifying the attributed GLB.
const SOURCE = Object.freeze({
  min: new THREE.Vector3(-21.896428685, -2.821072146, -17.776775503),
  max: new THREE.Vector3(15.784970931, 8.501037272, 17.70193589),
});
const sourceSize = SOURCE.max.clone().sub(SOURCE.min);
const sourceCenter = SOURCE.min.clone().add(SOURCE.max).multiplyScalar(0.5);
let template = null;
let loadError = null;

const buffer = sourceBytes.buffer.slice(
  sourceBytes.byteOffset,
  sourceBytes.byteOffset + sourceBytes.byteLength,
);

export const a320ModelReady = new Promise((resolve) => {
  new GLTFLoader().parse(
    buffer,
    "",
    (gltf) => {
      template = gltf.scene;
      template.traverse((object) => {
        if (!object.isMesh) return;
        object.castShadow = false;
        object.receiveShadow = false;
      });
      resolve(true);
    },
    (error) => {
      loadError = error;
      console.error("Could not load the A320 exterior model", error);
      resolve(false);
    },
  );
});

export function a320ModelFailed() {
  return loadError !== null;
}

function standardMaterial(color, options = {}) {
  return new THREE.MeshStandardMaterial({ color, ...options });
}

function strutBetween(start, end, radius, material) {
  const direction = end.clone().sub(start);
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius * 1.08, direction.length(), 12),
    material,
  );
  mesh.position.copy(start).add(end).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    direction.normalize(),
  );
  return mesh;
}

function landingGear() {
  const group = new THREE.Group();
  group.name = "landing-gear";
  const tire = standardMaterial(0x111315, { roughness: 0.96 });
  const hub = standardMaterial(0x9ca5a9, { roughness: 0.34, metalness: 0.7 });
  const strut = standardMaterial(0xc8cdcf, {
    roughness: 0.28,
    metalness: 0.75,
  });
  const door = standardMaterial(0xd8dddf, {
    roughness: 0.44,
    metalness: 0.18,
  });

  const addWheel = (x, y, z, radius, tube) => {
    const wheel = new THREE.Mesh(
      new THREE.TorusGeometry(radius - tube, tube, 10, 22),
      tire,
    );
    wheel.position.set(x, y, z);
    group.add(wheel);
    const axle = new THREE.Mesh(
      new THREE.CylinderGeometry(radius * 0.34, radius * 0.34, tube * 1.5, 16),
      hub,
    );
    axle.rotation.x = Math.PI / 2;
    axle.position.copy(wheel.position);
    group.add(axle);
  };

  const noseX = LENGTH / 2 - 5.07;
  const mainX = noseX - WHEELBASE;
  for (const side of [-1, 1]) addWheel(noseX, 0.31, side * 0.16, 0.31, 0.105);
  group.add(
    strutBetween(
      new THREE.Vector3(noseX, 0.31, 0),
      new THREE.Vector3(noseX - 0.12, 2.15, 0),
      0.075,
      strut,
    ),
    strutBetween(
      new THREE.Vector3(noseX, 0.8, 0),
      new THREE.Vector3(noseX - 0.72, 1.8, 0),
      0.045,
      strut,
    ),
  );

  for (const gearSide of [-1, 1]) {
    const z = gearSide * (MAIN_GEAR_TRACK / 2);
    for (const wheelSide of [-1, 1])
      addWheel(mainX, 0.47, z + wheelSide * 0.23, 0.47, 0.145);
    group.add(
      strutBetween(
        new THREE.Vector3(mainX, 0.47, z),
        new THREE.Vector3(mainX - 0.18, 2.65, z * 0.8),
        0.105,
        strut,
      ),
      strutBetween(
        new THREE.Vector3(mainX, 0.9, z),
        new THREE.Vector3(mainX - 0.92, 2.3, z * 0.78),
        0.06,
        strut,
      ),
    );
  }

  const doors = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.06, 0.48), door);
  doors.name = "nose-gear-doors";
  doors.position.set(noseX - 0.45, 1.7, 0);
  doors.rotation.z = -0.16;
  group.add(doors);
  return group;
}

export function buildA320Model({ aircraft }) {
  if (!template) return null;
  const group = new THREE.Group();
  const airframe = template.clone(true);
  airframe.name = "a320-airframe";
  airframe.position.set(
    -sourceCenter.x,
    HEIGHT - SOURCE.max.y,
    -sourceCenter.z,
  );
  airframe.scale.set(LENGTH / sourceSize.x, 1, WINGSPAN / sourceSize.z);
  group.add(airframe);

  const gear = landingGear();
  group.add(gear);

  const statusMaterial = new THREE.MeshBasicMaterial({ color: 0xf2f2ef });
  const beacon = new THREE.Mesh(
    new THREE.SphereGeometry(0.14, 10, 8),
    statusMaterial,
  );
  beacon.name = "status-beacon";
  beacon.position.set(-0.4, 5.08, 0);
  group.add(beacon);

  const pickTarget = new THREE.Mesh(
    new THREE.BoxGeometry(LENGTH, HEIGHT, WINGSPAN),
    new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0,
      depthWrite: false,
      colorWrite: false,
    }),
  );
  pickTarget.name = "pick-target";
  pickTarget.position.y = HEIGHT / 2;
  group.add(pickTarget);

  group.userData.statusMaterial = statusMaterial;
  group.userData.gear = gear;
  group.userData.modelProfile = {
    type: aircraft.type,
    propulsion: "jet",
    engineCount: 2,
    propellerBlades: 0,
    tail: "conventional",
    wingtip: "sharklet",
    mainGearLegs: 2,
    mainGearAxles: 1,
    upperDeck: false,
    fidelity: "cc-by-gltf-v1",
    dimensions: { length: LENGTH, wingspan: WINGSPAN, height: HEIGHT },
    wheelbase: WHEELBASE,
    mainGearTrack: MAIN_GEAR_TRACK,
    attribution: "amvlab aircraft-models / CC BY 4.0",
  };
  group.userData.visualParts = [
    "fuselage",
    "swept-wings",
    "windows",
    "jet-engine",
    "landing-gear",
  ];
  return group;
}
