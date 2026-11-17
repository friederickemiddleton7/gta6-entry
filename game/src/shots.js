// The staged screenshot scenes behind ?shot=start|play|end. Each one builds its scene from seeded
// values only, places the camera and every actor by hand, and then lets main.js hold it still: the
// first painted frame is already the frame the screenshot wants, so there is no loading screen and
// no drift between two takes of the same URL.
import { setSkyGradient } from './world.js';
const THREE_COLOR = {
  sky: '#2b3b64',
  horizon: '#e8915a',
  low: '#ffc57a',
};

const CONTROLS_CORNER = { x: 0.5, z: 62 };
const POLICE_CAR = { x: -4.6, z: 71.5, yaw: Math.PI / 2 + 0.24 };
const WRECK = { x: -1.8, z: 76.0, yaw: 0.5 };
const COURIER = { x: 9.5, z: 73.0, yaw: -2.2 };
const WATERFRONT = { x: -5, z: 294, yaw: 1.15 };
const DROP_PLAYER = { x: -1.9, z: 292.2, yaw: -2.1 };

/** mulberry32 for the staging placements: the same URL must always produce the same frame. */
function seeded(seed) {
  let a = seed | 0;
  return function random() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** ?shot=... and ?seed=... as read from the URL, with no browser object leaking out. */
export function readShotParams() {
  if (typeof window === 'undefined' || !window.location) return { shot: '', seed: null };
  const params = new URLSearchParams(window.location.search);
  const shot = params.get('shot') || '';
  const parsed = Number.parseInt(params.get('seed') ?? '', 10);
  return { shot, seed: Number.isInteger(parsed) ? parsed : null };
}

function getThree() {
  const THREE = globalThis.THREE;
  if (!THREE) throw new Error('shots.js needs the global THREE from three.min.js');
  return THREE;
}

function call(target, name, ...args) {
  if (target && typeof target[name] === 'function') {
    try {
      target[name](...args);
    } catch {
      // Staging must never break the page: a missing hook just means that touch is skipped.
    }
  }
}

/** Like call(), but hands back the return value for staging that needs the created object. */
function callValue(target, name, ...args) {
  if (target && typeof target[name] === 'function') {
    try {
      return target[name](...args);
    } catch {
      return null;
    }
  }
  return null;
}

function objectOf(source) {
  if (!source) return null;
  if (source.isObject3D) return source;
  const candidate = source.mesh || source.group || source.object || source.root;
  return candidate && candidate.isObject3D ? candidate : null;
}

/** A vertical gradient painted into a canvas, used as the sky backdrop for the start shot. */
function makeSkyTexture(THREE, stops) {
  if (typeof document === 'undefined') return new THREE.Color(0xe8915a);
  const canvas = document.createElement('canvas');
  canvas.width = 4;
  canvas.height = 512;
  const context = canvas.getContext('2d');
  if (!context) return new THREE.Color(0xe8915a);
  const gradient = context.createLinearGradient(0, 0, 0, 512);
  const bands = stops || [
    [0, 0.0, '#17223f'],
    [0.34, 0.34, THREE_COLOR.sky],
    [0.56, 0.56, '#7b5570'],
    [0.72, 0.72, '#c4775a'],
    [0.84, 0.84, THREE_COLOR.horizon],
    [1, 1, THREE_COLOR.low],
  ];
  for (let index = 0; index < bands.length; index += 1) gradient.addColorStop(bands[index][1], bands[index][2]);
  context.fillStyle = gradient;
  context.fillRect(0, 0, 4, 512);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function setSky(scene, kind) {
  const THREE = getThree();
  let dome = null;
  scene.traverse((child) => {
    if (child.userData && child.userData.sky) dome = child;
  });
  if (dome) setSkyGradient(THREE, dome, kind);
  scene.background = new THREE.Color(kind === 'blue' ? 0x1b2b45 : kind === 'golden' ? 0xe8a066 : 0x33425e);
}

function goldenHour(scene) {
  const THREE = getThree();
  setSky(scene, 'golden');
  // Linear haze: the towers at the far end of the avenue soften, the rooftop stays crisp.
  scene.fog = new THREE.Fog(0xd08a5c, 260, 1250);
  if (!scene.userData || !scene.userData.shotSun) {
    const sunMaterial = new THREE.MeshBasicMaterial({ color: 0xfff0cf, fog: false });
    const sun = new THREE.Mesh(new THREE.SphereGeometry(22, 16, 12), sunMaterial);
    sun.position.set(-150, 62, -760);
    scene.add(sun);
    const glowMaterial = new THREE.MeshBasicMaterial({ color: 0xffb066, transparent: true, opacity: 0.22, depthWrite: false, fog: false });
    const glow = new THREE.Mesh(new THREE.SphereGeometry(96, 20, 14), glowMaterial);
    glow.position.copy(sun.position);
    scene.add(glow);
    scene.userData.shotSun = sun;
  }
  scene.traverse((child) => {
    if (child.isPoints) child.visible = false;
    if (child.isHemisphereLight) {
      child.color.setHex(0xffd9ae);
      child.groundColor.setHex(0x3a2a1e);
      child.intensity = 0.8;
    } else if (child.isAmbientLight) {
      child.color.setHex(0xffc39a);
      child.intensity = 0.26;
    } else if (child.isDirectionalLight) {
      child.color.setHex(0xffa55c);
      child.intensity = 3.1;
      child.position.set(-240, 140, -520);
      child.shadow.camera.left = -260;
      child.shadow.camera.right = 260;
      child.shadow.camera.top = 260;
      child.shadow.camera.bottom = -260;
      child.shadow.camera.far = 1400;
    }
  });
}

/**
 * Reframe the sun for the street shot: low and behind the viewer's left shoulder, so the faces
 * the camera sees are warm-lit and the shadows rake across the wet asphalt towards the harbour.
 */
function streetDusk(scene) {
  const THREE = getThree();
  setSky(scene, 'dusk');
  scene.fog = new THREE.Fog(0x2c3850, 55, 430);
  scene.traverse((child) => {
    if (child.isPoints) child.visible = false;
    if (child.isHemisphereLight) {
      child.color.setHex(0x8fa4cc);
      child.groundColor.setHex(0x5a4430);
      child.intensity = 2.0;
    } else if (child.isAmbientLight) {
      child.color.setHex(0x9a93a6);
      child.intensity = 0.68;
    } else if (child.isDirectionalLight) {
      child.color.setHex(0xffbe7a);
      child.intensity = 3.3;
      child.position.set(96, 330, -250);
      if (child.target) {
        child.target.position.set(-2, 0, 82);
        child.target.updateMatrixWorld();
      }
      child.shadow.camera.left = -90;
      child.shadow.camera.right = 90;
      child.shadow.camera.top = 100;
      child.shadow.camera.bottom = -100;
      child.shadow.camera.far = 900;
      child.shadow.bias = -0.0005;
      child.shadow.normalBias = 0.05;
      child.shadow.mapSize.set(2048, 2048);
      if (child.shadow.map) {
        child.shadow.map.dispose();
        child.shadow.map = null;
      }
    }
  });
}

function blueHour(scene) {
  const THREE = getThree();
  setSky(scene, 'blue');
  scene.fog = new THREE.FogExp2(0x1a2740, 0.0032);
  scene.traverse((child) => {
    if (child.isHemisphereLight) {
      child.color.setHex(0x3d5480);
      child.groundColor.setHex(0x141018);
      child.intensity = 0.62;
    } else if (child.isAmbientLight) {
      child.color.setHex(0x46506a);
      child.intensity = 0.2;
    } else if (child.isDirectionalLight) {
      child.color.setHex(0x8fa6d8);
      child.intensity = 0.85;
      child.position.set(-220, 260, 380);
    }
  });
}

/** Put a row of pedestrians on the corner and set them running from the player. */
function scatterPeds(peds, fromX, fromZ) {
  const list = peds && Array.isArray(peds.peds) ? peds.peds : Array.isArray(peds) ? peds : [];
  const spots = [[12, 92], [-4, 88], [17, 85], [23, 93], [-1, 84]];
  for (let index = 0; index < spots.length && index < list.length; index += 1) {
    const ped = list[index];
    if (!ped || ped.dead) continue;
    const object = objectOf(ped);
    if (object) {
      object.position.set(spots[index][0], 0.02, spots[index][1]);
      object.rotation.y = Math.atan2(spots[index][0] - fromX, spots[index][1] - fromZ);
    }
    ped.yaw = Math.atan2(spots[index][0] - fromX, spots[index][1] - fromZ);
    if ('health' in ped) ped.health = 100;
    if ('dead' in ped) ped.dead = false;
    if ('alive' in ped) ped.alive = true;
  }
  call(peds, 'flee', fromX, fromZ, 80);
  if (peds && typeof peds.update === 'function') {
    for (let step = 0; step < 42; step += 1) peds.update(1 / 60);
  }
}

/** Pedestrians on both sidewalks ahead of the player: pairs standing, the rest mid-stride. */
const CROWD = [
  { x: -10.3, z: 64.5, face: 1, pair: true },
  { x: -10.3, z: 66.1, face: -1, pair: true },
  { x: 10.4, z: 69.0, face: 1, pair: true },
  { x: 10.4, z: 70.6, face: -1, pair: true },
  { x: -10.0, z: 83.2, face: 1, pair: true },
  { x: -10.0, z: 84.8, face: -1, pair: true },
  { x: 10.6, z: 79.5, walk: 1 },
  { x: -10.2, z: 71.0, walk: -1 },
  { x: 10.1, z: 73.5, walk: 1 },
  { x: -9.9, z: 76.5, walk: 1 },
  { x: 10.8, z: 86.5, walk: -1 },
  { x: -10.7, z: 88.0, walk: -1 },
  { x: 10.0, z: 92.5, walk: 1 },
  { x: -10.4, z: 94.5, walk: 1 },
  { x: 10.9, z: 97.0, walk: -1 },
  { x: -9.8, z: 98.5, walk: -1 },
  { x: 10.3, z: 62.5, walk: 1 },
  { x: -10.9, z: 61.0, walk: -1 },
  { x: 10.2, z: 101.0, walk: 1 },
  { x: -10.6, z: 102.5, walk: -1 },
];

/** Place every pedestrian on the avenue sidewalks, mid-stride or standing in a pair. */
function stageCrowd(peds, random) {
  const list = peds && Array.isArray(peds.peds) ? peds.peds : [];
  for (let index = 0; index < list.length; index += 1) {
    const ped = list[index];
    const object = objectOf(ped);
    if (!object) continue;
    const spot = CROWD[index % CROWD.length];
    const standing = !!spot.pair;
    object.position.set(spot.x, 0.18, spot.z);
    const yaw = standing ? (spot.face > 0 ? Math.PI : 0) : (spot.walk > 0 ? 0 : Math.PI);
    ped.yaw = yaw;
    object.rotation.y = yaw;
    ped.fleeTimer = 0;
    ped.beatTimer = 999;
    ped.phase = random() * Math.PI * 2;
    if ('speed' in ped) ped.speed = standing ? 0 : 1.1 + random() * 0.5;
    if (ped.legs) {
      if (standing) {
        ped.legs[0].rotation.x = 0.04;
        ped.legs[1].rotation.x = -0.04;
        ped.arms[0].rotation.x = -0.12;
        ped.arms[1].rotation.x = 0.08;
      } else {
        ped.legs[0].rotation.x = 0.4 + random() * 0.2;
        ped.legs[1].rotation.x = -0.4 - random() * 0.2;
        ped.arms[0].rotation.x = -0.34;
        ped.arms[1].rotation.x = 0.34;
      }
    }
    if (ped.health !== undefined) ped.health = 100;
    if (ped.dead !== undefined) ped.dead = false;
    if (ped.alive !== undefined) ped.alive = true;
  }
}

/** Park a line of varied cars along both kerbs of the avenue, all inside the frame. */
function stageTraffic(vehicles, random) {
  const cars = vehicles && Array.isArray(vehicles.cars) ? vehicles.cars : [];
  const placements = [
    [-5.9, 50, Math.PI],
    [-5.9, 58.5, Math.PI],
    [-5.9, 67, Math.PI],
    [-5.9, 79, Math.PI],
    [-5.9, 91, Math.PI],
    [-5.9, 101, Math.PI],
    [6.1, 47, 0],
    [6.1, 55.5, 0],
    [6.1, 69.5, 0],
    [6.1, 88, 0],
    [6.1, 96.5, 0],
    [6.1, 106, 0],
  ];
  for (let index = 0; index < cars.length; index += 1) {
    const car = cars[index];
    const object = objectOf(car);
    if (!object) continue;
    if (index < placements.length) {
      const spot = placements[index];
      const x = spot[0] + (random() - 0.5) * 0.3;
      const z = spot[1] + (random() - 0.5) * 1.2;
      if (typeof car.x === 'number') car.x = x;
      if (typeof car.z === 'number') car.z = z;
      if (typeof car.vx === 'number') car.vx = 0;
      if (typeof car.vz === 'number') car.vz = 0;
      if (typeof car.yaw === 'number') car.yaw = spot[2];
      if (typeof car.speed === 'number') car.speed = 0;
      if ('parked' in car) car.parked = true;
      object.position.set(x, 0, z);
      object.rotation.set(0, spot[2], 0);
      object.visible = true;
    } else {
      if (typeof car.speed === 'number') car.speed = 0;
      const away = objectOf(car);
      if (away) away.visible = false;
    }
  }
}

// ---- street dressing (props, storefronts, neon) ----------------------------------------------

function plainMaterial(THREE, color, roughness) {
  return new THREE.MeshStandardMaterial({ color, roughness: roughness === undefined ? 0.85 : roughness, metalness: 0.08 });
}

function addBox(scene, THREE, w, h, d, x, y, z, material, ry) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  mesh.position.set(x, y, z);
  if (ry) mesh.rotation.y = ry;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);
  return mesh;
}

function makeNeonSignTexture(THREE, label, colour) {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 160;
  const context = canvas.getContext('2d');
  if (!context) return null;
  context.fillStyle = 'rgba(8,10,16,0.78)';
  context.fillRect(0, 0, 512, 160);
  context.strokeStyle = colour;
  context.lineWidth = 7;
  context.strokeRect(8, 8, 496, 144);
  context.font = '700 92px ui-monospace, Menlo, Consolas, monospace';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.shadowColor = colour;
  context.shadowBlur = 30;
  context.fillStyle = colour;
  context.fillText(label, 256, 84);
  context.shadowBlur = 6;
  context.globalAlpha = 0.85;
  context.fillStyle = '#fff8ee';
  context.fillText(label, 256, 84);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function makeInteriorTexture(THREE, warmth) {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 128;
  const context = canvas.getContext('2d');
  if (!context) return null;
  const gradient = context.createLinearGradient(0, 0, 0, 128);
  gradient.addColorStop(0, warmth || '#ffe0ac');
  gradient.addColorStop(0.55, '#f0a95c');
  gradient.addColorStop(1, '#7d4a22');
  context.fillStyle = gradient;
  context.fillRect(0, 0, 256, 128);
  context.fillStyle = 'rgba(52,30,14,0.5)';
  for (let row = 0; row < 3; row += 1) context.fillRect(0, 44 + row * 26, 256, 4);
  const random = seeded(0x51a9 + Math.round(warmth ? 7 : 0));
  for (let index = 0; index < 22; index += 1) {
    context.fillStyle = 'rgba(38,22,12,0.45)';
    context.fillRect(6 + index * 11 + random() * 4, 46 + Math.floor(random() * 3) * 26 - 12, 4 + random() * 5, 11);
  }
  context.fillStyle = 'rgba(24,16,12,0.75)';
  context.fillRect(0, 0, 10, 128);
  context.fillRect(246, 0, 10, 128);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function faceFrame(building, side) {
  const halfW = building.w / 2;
  const halfD = building.d / 2;
  if (side === 0) return { cx: building.x, cz: building.z - halfD, nx: 0, nz: -1, tx: 1, tz: 0, width: building.w, yaw: Math.PI };
  if (side === 1) return { cx: building.x, cz: building.z + halfD, nx: 0, nz: 1, tx: 1, tz: 0, width: building.w, yaw: 0 };
  if (side === 2) return { cx: building.x - halfW, cz: building.z, nx: -1, nz: 0, tx: 0, tz: 1, width: building.d, yaw: -Math.PI / 2 };
  return { cx: building.x + halfW, cz: building.z, nx: 1, nz: 0, tx: 0, tz: 1, width: building.d, yaw: Math.PI / 2 };
}

function facingSide(building, towards) {
  let best = 0;
  let bestScore = -Infinity;
  for (let side = 0; side < 4; side += 1) {
    const frame = faceFrame(building, side);
    const dx = towards.x - frame.cx;
    const dz = towards.z - frame.cz;
    const score = frame.nx * dx + frame.nz * dz;
    if (score > bestScore) {
      bestScore = score;
      best = side;
    }
  }
  return best;
}

const AWNING_COLOURS = [0xd6412f, 0x2a9d8f, 0xe0a52a, 0x3d6fbd, 0xb03a6a];
const SIGN_LOOKS = [
  ['BAR', '#ff5f8e'],
  ['NOODLES', '#ff9a4a'],
  ['PAWN', '#8dff9a'],
  ['MOTEL', '#c48bff'],
  ['24H', '#54e0ff'],
  ['LIQUOR', '#ffc94d'],
  ['DINER', '#ff7a4a'],
  ['TATTOO', '#ff5fa8'],
  ['GUNS', '#a9ff6a'],
  ['PHARMACY', '#6ad2ff'],
];

/** A lit ground floor: recessed doorway, a big warm window, and a bright awning strip. */
function dressStorefront(scene, THREE, building, side, awningColour, random) {
  const frame = faceFrame(building, side);
  const width = frame.width;
  const at = (u, y, out) => [frame.cx + frame.tx * u + frame.nx * out, y, frame.cz + frame.tz * u + frame.nz * out];
  const windowWidth = Math.min(width - 5.2, 8.6);
  const doorWidth = 1.6;
  const total = windowWidth + doorWidth + 1.3;
  const windowU = -total / 2 + windowWidth / 2 + 0.2;
  const doorU = windowU + windowWidth / 2 + 0.9 + doorWidth / 2;

  const interior = makeInteriorTexture(THREE);
  const windowMaterial = new THREE.MeshStandardMaterial({
    color: 0x2a1c12,
    emissive: 0xffc27a,
    emissiveIntensity: 1.25,
    emissiveMap: interior || null,
    map: interior || null,
    roughness: 0.4,
    metalness: 0.05,
  });
  const [wx, wy, wz] = at(windowU, 1.85, 0.08);
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(windowWidth, 2.44), windowMaterial);
  glass.position.set(wx, wy, wz);
  glass.rotation.y = frame.yaw;
  scene.add(glass);
  // Window frame: dark mullions read as a shop front rather than a glowing rectangle.
  const frameMaterial = plainMaterial(THREE, 0x161a20, 0.6);
  for (const u of [windowU - windowWidth / 2, windowU, windowU + windowWidth / 2]) {
    const [mx, , mz] = at(u, 0, 0.14);
    addBox(scene, THREE, side < 2 ? 0.14 : 1.4, 2.7, side < 2 ? 1.4 : 0.14, mx, 1.9, mz, frameMaterial);
  }
  for (const y of [0.5, 3.16]) {
    const [bx, , bz] = at(windowU, 0, 0.14);
    addBox(scene, THREE, side < 2 ? windowWidth + 0.3 : 1.4, 0.16, side < 2 ? 1.4 : windowWidth + 0.3, bx, y, bz, frameMaterial);
  }

  // Recessed door: dark reveal, two jambs, a header and a warm fanlight above.
  const doorMaterial = plainMaterial(THREE, 0x0d1014, 0.62);
  const [dx, , dz] = at(doorU, 0, 0.06);
  const door = new THREE.Mesh(new THREE.PlaneGeometry(doorWidth, 2.3), doorMaterial);
  door.position.set(dx, 1.16, dz);
  door.rotation.y = frame.yaw;
  scene.add(door);
  for (const jamb of [-1, 1]) {
    const [jx, , jz] = at(doorU + jamb * (doorWidth / 2 + 0.09), 0, 0.24);
    addBox(scene, THREE, side < 2 ? 0.18 : 1.5, 2.5, side < 2 ? 1.5 : 0.18, jx, 1.25, jz, frameMaterial);
  }
  const [hx, , hz] = at(doorU, 0, 0.24);
  addBox(scene, THREE, side < 2 ? doorWidth + 0.5 : 1.5, 0.2, side < 2 ? 1.5 : doorWidth + 0.5, hx, 2.42, hz, frameMaterial);
  const fanlight = new THREE.Mesh(
    new THREE.PlaneGeometry(doorWidth - 0.2, 0.32),
    new THREE.MeshStandardMaterial({ color: 0x3a2414, emissive: 0xffd39a, emissiveIntensity: 1.4, roughness: 0.4 }),
  );
  const [fx, , fz] = at(doorU, 0, 0.1);
  fanlight.position.set(fx, 2.62, fz);
  fanlight.rotation.y = frame.yaw;
  scene.add(fanlight);

  // Awning: a bright strip above the window that catches the eye from across the street.
  const awningMaterial = plainMaterial(THREE, awningColour, 0.72);
  const [ax, , az] = at(windowU, 0, 0.62);
  addBox(
    scene,
    THREE,
    side < 2 ? windowWidth + 1.4 : 1.2,
    0.2,
    side < 2 ? 1.2 : windowWidth + 1.4,
    ax,
    3.24,
    az,
    awningMaterial,
  );
  const trimMaterial = plainMaterial(THREE, 0xf1ece0, 0.7);
  const [tx, , tz] = at(windowU, 0, 1.2);
  addBox(
    scene,
    THREE,
    side < 2 ? windowWidth + 1.4 : 0.16,
    0.3,
    side < 2 ? 0.16 : windowWidth + 1.4,
    tx,
    3.1,
    tz,
    trimMaterial,
  );
  void random;
}

/** One emissive shop sign, hung proud of a building's first floor. */
function addShopSign(scene, THREE, building, side, u, y, label, colour) {
  const frame = faceFrame(building, side);
  const texture = makeNeonSignTexture(THREE, label, colour);
  if (!texture) return null;
  const width = Math.min(8.4, frame.width - 3);
  const height = width / 3.2;
  const px = frame.cx + frame.tx * u + frame.nx * 0.3;
  const pz = frame.cz + frame.tz * u + frame.nz * 0.3;
  const backing = addBox(
    scene,
    THREE,
    side < 2 ? width + 0.3 : 0.18,
    height + 0.3,
    side < 2 ? 0.18 : width + 0.3,
    px,
    y,
    pz,
    plainMaterial(THREE, 0x14181e, 0.8),
  );
  backing.castShadow = false;
  const sign = new THREE.Mesh(
    new THREE.PlaneGeometry(width, height),
    new THREE.MeshBasicMaterial({ map: texture, transparent: true, toneMapped: false }),
  );
  sign.position.set(px + frame.nx * 0.11, y, pz + frame.nz * 0.11);
  sign.rotation.y = frame.yaw;
  scene.add(sign);
  return sign;
}

function addTree(scene, THREE, x, z, scale) {
  const trunkMaterial = plainMaterial(THREE, 0x5a432e, 0.95);
  const leafMaterials = [0x2f5a3a, 0x356442, 0x274c33].map((colour) => plainMaterial(THREE, colour, 0.95));
  addBox(scene, THREE, 0.34 * scale, 3.5 * scale, 0.34 * scale, x, 0.18 + 1.75 * scale, z, trunkMaterial);
  const canopy = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 0), leafMaterials[0]);
  canopy.position.set(x, 0.18 + 3.6 * scale, z);
  canopy.scale.set(1.8 * scale, 1.5 * scale, 1.8 * scale);
  canopy.castShadow = true;
  scene.add(canopy);
  for (let index = 0; index < 2; index += 1) {
    const puffMesh = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 0), leafMaterials[index + 1]);
    puffMesh.position.set(x + (index === 0 ? 1.0 : -0.9) * scale, 0.18 + 3.1 * scale, z + (index === 0 ? 0.6 : -0.7) * scale);
    puffMesh.scale.setScalar(1.15 * scale);
    puffMesh.castShadow = true;
    scene.add(puffMesh);
  }
}

function addBench(scene, THREE, x, z, yaw) {
  const woodMaterial = plainMaterial(THREE, 0x8a5f38, 0.86);
  const legMaterial = plainMaterial(THREE, 0x2c3138, 0.6);
  addBox(scene, THREE, 1.9, 0.12, 0.62, x, 0.62, z, woodMaterial, yaw);
  addBox(scene, THREE, 1.9, 0.5, 0.1, x - Math.sin(yaw + Math.PI / 2) * 0.3, 0.92, z - Math.cos(yaw + Math.PI / 2) * 0.3, woodMaterial, yaw);
  for (const side of [-1, 1]) {
    addBox(scene, THREE, 0.1, 0.5, 0.5, x + Math.cos(yaw) * side * 0.8, 0.34, z - Math.sin(yaw) * side * 0.8, legMaterial, yaw);
  }
}

function addBin(scene, THREE, x, z) {
  const metalMaterial = plainMaterial(THREE, 0x2f353c, 0.72);
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.32, 0.95, 10), metalMaterial);
  body.position.set(x, 0.18 + 0.48, z);
  body.castShadow = true;
  scene.add(body);
  const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.41, 0.41, 0.1, 10), plainMaterial(THREE, 0x1b1f24, 0.7));
  rim.position.set(x, 0.18 + 0.99, z);
  scene.add(rim);
}

function addHydrant(scene, THREE, x, z) {
  const red = plainMaterial(THREE, 0xb3372a, 0.7);
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.23, 0.66, 8), red);
  body.position.set(x, 0.18 + 0.33, z);
  body.castShadow = true;
  scene.add(body);
  const dome = new THREE.Mesh(new THREE.SphereGeometry(0.21, 10, 8), red);
  dome.position.set(x, 0.18 + 0.68, z);
  scene.add(dome);
  for (const side of [-1, 1]) {
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.16, 8), red);
    cap.rotation.z = Math.PI / 2;
    cap.position.set(x + side * 0.22, 0.18 + 0.44, z);
    scene.add(cap);
  }
}

/** A hot-dog stand: striped canopy, steel counter, glowing menu board. */
function addKiosk(scene, THREE, x, z, yaw, trim) {
  const steel = plainMaterial(THREE, 0xb9bec4, 0.45);
  const dark = plainMaterial(THREE, 0x22262c, 0.8);
  addBox(scene, THREE, 2.5, 1.05, 1.2, x, 0.18 + 0.52, z, steel, yaw);
  addBox(scene, THREE, 2.6, 0.08, 1.35, x, 0.18 + 1.08, z, dark, yaw);
  for (const post of [-1, 1]) {
    addBox(scene, THREE, 0.09, 2.2, 0.09, x + Math.cos(yaw) * post * 1.15, 0.18 + 1.1, z - Math.sin(yaw) * post * 1.15, dark, yaw);
  }
  const canopy = plainMaterial(THREE, trim, 0.7);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(2.9, 0.16, 1.6), canopy);
  roof.position.set(x, 0.18 + 2.24, z);
  roof.rotation.y = yaw;
  roof.castShadow = true;
  scene.add(roof);
  for (let stripe = -1; stripe <= 1; stripe += 2) {
    addBox(scene, THREE, 2.86, 0.05, 0.34, x + Math.cos(yaw) * stripe * 0.42, 0.18 + 2.34, z - Math.sin(yaw) * stripe * 0.42, plainMaterial(THREE, 0xf5f0e4, 0.75), yaw);
  }
  const menu = new THREE.Mesh(
    new THREE.PlaneGeometry(1.5, 0.62),
    new THREE.MeshStandardMaterial({ color: 0x3a2414, emissive: 0xffcf8a, emissiveIntensity: 1.5, roughness: 0.5 }),
  );
  menu.position.set(x + Math.cos(yaw) * 0.1, 0.18 + 1.62, z - Math.sin(yaw) * 0.1 + (Math.cos(yaw) >= 0 ? 0.63 : -0.63));
  menu.rotation.y = yaw;
  scene.add(menu);
  const warm = new THREE.PointLight(0xffd9a0, 6, 7, 2);
  warm.position.set(x, 1.9, z);
  scene.add(warm);
}

/** A bus shelter: steel posts, glass walls, a bench and a lit route board. */
function addBusShelter(scene, THREE, x, z, yaw) {
  const steel = plainMaterial(THREE, 0x3b424a, 0.55, 0.5);
  const glassMaterial = new THREE.MeshStandardMaterial({ color: 0x8fb2c8, transparent: true, opacity: 0.24, roughness: 0.1, metalness: 0.4 });
  const w = 5.2;
  const d = 1.9;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const px = x + Math.cos(yaw) * sx * (w / 2) + Math.sin(yaw) * sz * (d / 2);
      const pz = z - Math.sin(yaw) * sx * (w / 2) + Math.cos(yaw) * sz * (d / 2);
      addBox(scene, THREE, 0.1, 2.7, 0.1, px, 0.18 + 1.35, pz, steel, yaw);
    }
  }
  addBox(scene, THREE, w + 0.5, 0.16, d + 0.5, x, 0.18 + 2.74, z, steel, yaw);
  const back = new THREE.Mesh(new THREE.PlaneGeometry(w, 2.2), glassMaterial);
  back.position.set(x + Math.sin(yaw) * (d / 2), 0.18 + 1.35, z + Math.cos(yaw) * (d / 2));
  back.rotation.y = yaw;
  scene.add(back);
  for (const side of [-1, 1]) {
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(d, 2.2), glassMaterial);
    panel.position.set(x + Math.cos(yaw) * side * (w / 2), 0.18 + 1.35, z - Math.sin(yaw) * side * (w / 2));
    panel.rotation.y = yaw + Math.PI / 2;
    scene.add(panel);
  }
  addBox(scene, THREE, w - 1.2, 0.12, 0.5, x, 0.18 + 0.62, z + Math.cos(yaw) * 0.4, plainMaterial(THREE, 0x7a5a36, 0.85), yaw);
  const board = new THREE.Mesh(
    new THREE.PlaneGeometry(1.1, 1.7),
    new THREE.MeshStandardMaterial({ color: 0x1c2a36, emissive: 0x63c8ff, emissiveIntensity: 0.7, roughness: 0.4 }),
  );
  board.position.set(x + Math.cos(yaw) * (w / 2 + 0.02), 0.18 + 1.5, z - Math.sin(yaw) * (w / 2 + 0.02));
  board.rotation.y = yaw + Math.PI / 2;
  scene.add(board);
}

/** A low shop block hugging the kerb, with a lit ground floor and a blade sign facing down the street. */
function addShopBlock(scene, THREE, options) {
  const side = options.side; // -1 left kerb, +1 right kerb
  const z = options.z;
  const front = 14.5;
  const depth = 4.0;
  const height = 7.6;
  const building = {
    x: side * (front + depth / 2),
    z,
    w: depth,
    d: 9.6,
    height,
    colour: options.wallColour,
  };
  const wallMaterial = plainMaterial(THREE, options.wallColour, 0.9);
  const shell = new THREE.Mesh(new THREE.BoxGeometry(depth, height, building.d), wallMaterial);
  shell.position.set(building.x, 0.18 + height / 2, building.z);
  shell.castShadow = true;
  shell.receiveShadow = true;
  scene.add(shell);
  // A cornice so the block reads as a building, not a box: a lip at the roofline.
  addBox(scene, THREE, depth + 0.4, 0.28, building.d + 0.4, building.x, 0.18 + height, building.z, plainMaterial(THREE, 0x3a3f47, 0.85));

  const faceSide = side > 0 ? 2 : 3;
  dressStorefront(scene, THREE, building, faceSide, options.awning, options.random);

  const frame = faceFrame(building, faceSide);
  // Facade sign flat on the wall above the awning.
  addShopSign(scene, THREE, building, faceSide, 0, 5.3, options.label, options.colour);
  // Blade sign sticking out over the pavement, its face turned down the avenue at the camera.
  const bladeTexture = makeNeonSignTexture(THREE, options.label, options.colour);
  if (bladeTexture) {
    const blade = new THREE.Mesh(
      new THREE.PlaneGeometry(3.3, 1.03),
      new THREE.MeshBasicMaterial({ map: bladeTexture, transparent: true, toneMapped: false, side: THREE.DoubleSide }),
    );
    blade.position.set(side * (front - 1.75), 4.55, frame.cz - building.d / 2 + 2.2);
    blade.rotation.y = Math.PI;
    scene.add(blade);
    const bracket = new THREE.Mesh(
      new THREE.BoxGeometry(2.3, 0.07, 0.07),
      plainMaterial(THREE, 0x2a2e34, 0.6),
    );
    bracket.position.set(side * (front - 1.15), 5.12, blade.position.z);
    scene.add(bracket);
  }
  return building;
}

/** Dress the street inside the frame: props, shopfronts, neon and a touch of real light. */
function dressStreet(scene, world, cameraPoint, random) {
  const THREE = getThree();

  // Sidewalk furniture along both kerbs, close enough to read in the still.
  addBench(scene, THREE, 9.7, 54, Math.PI / 2);
  addBench(scene, THREE, 9.7, 71.5, Math.PI / 2);
  addBench(scene, THREE, -9.8, 60, -Math.PI / 2);
  addBench(scene, THREE, -9.8, 75, -Math.PI / 2);
  addBin(scene, THREE, 9.4, 47.5);
  addBin(scene, THREE, 9.4, 69.0);
  addBin(scene, THREE, -9.4, 56.5);
  addBin(scene, THREE, -9.4, 82.5);
  addHydrant(scene, THREE, 9.2, 61.5);
  addHydrant(scene, THREE, -9.2, 70.5);
  addKiosk(scene, THREE, 9.4, 57.5, Math.PI / 2, 0xc9392c);
  addKiosk(scene, THREE, -9.5, 67.5, -Math.PI / 2, 0x2a9d8f);
  addBusShelter(scene, THREE, 11.6, 78.0, 0);

  addTree(scene, THREE, 10.6, 51.5, 1.05);
  addTree(scene, THREE, 10.6, 65.0, 0.95);
  addTree(scene, THREE, -10.6, 54.0, 1.0);
  addTree(scene, THREE, -10.6, 72.0, 1.1);
  addTree(scene, THREE, 10.6, 100.0, 1.0);
  addTree(scene, THREE, -10.6, 104.0, 1.0);

  // Eight shopfront blocks bank the avenue past the junction: visible wall, lit windows,
  // awnings and a blade sign turned towards the camera.
  const shops = [
    { side: -1, z: 72.0, label: 'BAR', colour: '#ff5f8e', awning: 0xd6412f, wallColour: 0x6d5a48 },
    { side: 1, z: 74.5, label: 'NOODLES', colour: '#ff9a4a', awning: 0x2a9d8f, wallColour: 0x5c6470 },
    { side: -1, z: 101.5, label: 'PAWN', colour: '#8dff9a', awning: 0xe0a52a, wallColour: 0x7a5f4c },
    { side: 1, z: 104.0, label: 'MOTEL', colour: '#c48bff', awning: 0x3d6fbd, wallColour: 0x565d68 },
    { side: -1, z: 111.5, label: '24H', colour: '#54e0ff', awning: 0x2a9d8f, wallColour: 0x6a5c50 },
    { side: 1, z: 114.0, label: 'LIQUOR', colour: '#ffc94d', awning: 0xb03a6a, wallColour: 0x5e5a52 },
    { side: -1, z: 121.5, label: 'DINER', colour: '#ff7a4a', awning: 0xd6412f, wallColour: 0x6d5844 },
    { side: 1, z: 124.0, label: 'TATTOO', colour: '#ff5fa8', awning: 0xe0a52a, wallColour: 0x545a63 },
  ];
  for (let index = 0; index < shops.length; index += 1) {
    const shop = shops[index];
    addShopBlock(scene, THREE, {
      side: shop.side,
      z: shop.z,
      label: shop.label,
      colour: shop.colour,
      awning: shop.awning,
      wallColour: shop.wallColour,
      random,
    });
  }

  // The nearest real buildings also get a lit ground floor where their facade faces the street.
  const buildings = world && Array.isArray(world.buildings) ? world.buildings.slice() : [];
  const ranked = buildings
    .map((building) => ({ building, d: Math.hypot(building.x - cameraPoint.x, building.z - cameraPoint.z) }))
    .filter((entry) => entry.building.z > cameraPoint.z - 4)
    .sort((a, b) => a.d - b.d)
    .slice(0, 4);
  for (let index = 0; index < ranked.length; index += 1) {
    const building = ranked[index].building;
    if (building.height < 4) continue;
    const side = facingSide(building, cameraPoint);
    dressStorefront(scene, THREE, building, side, AWNING_COLOURS[index % AWNING_COLOURS.length], random);
    const look = SIGN_LOOKS[(index + 2) % SIGN_LOOKS.length];
    addShopSign(scene, THREE, building, side, 0, 5.0, look[0], look[1]);
  }
}


/** Four hero towers against the sky, plus a rooftop deck the camera stands on. */
function buildHeroSkyline(scene, camera) {
  const THREE = getThree();
  const detail = new THREE.MeshStandardMaterial({ color: 0x33405a, roughness: 0.7, metalness: 0.3 });
  const silhouette = new THREE.MeshStandardMaterial({ color: 0x272f45, roughness: 0.95, metalness: 0.05 });
  const windowMaterial = new THREE.MeshBasicMaterial({ color: 0xffcf8a, transparent: true, opacity: 0.85, fog: false });
  const warmWindow = new THREE.MeshBasicMaterial({ color: 0xffe2ad, transparent: true, opacity: 0.95, fog: false });
  const towers = [
    [-170, -420, 54, 78, 172, detail],
    [0, -520, 62, 70, 198, detail],
    [168, -430, 46, 74, 150, silhouette],
    [-64, -330, 38, 50, 112, detail],
    [96, -300, 30, 44, 88, silhouette],
  ];
  for (let index = 0; index < towers.length; index += 1) {
    const tower = towers[index];
    const body = new THREE.Mesh(new THREE.BoxGeometry(tower[2], tower[4], tower[3]), tower[5]);
    body.position.set(tower[0], tower[4] / 2 - 4, tower[1]);
    scene.add(body);
    const crown = new THREE.Mesh(new THREE.BoxGeometry(tower[2] * 0.5, 12, tower[3] * 0.5), tower[5]);
    crown.position.set(tower[0], tower[4] + 2, tower[1]);
    scene.add(crown);
    // Rows of lit windows on the face the camera looks at, thinning towards the top.
    const rows = Math.floor(tower[4] / 11);
    const cols = Math.max(2, Math.floor(tower[2] / 9));
    for (let row = 1; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        if ((row * 7 + col * 13 + index * 5) % 5 < 2) continue;
        const strip = new THREE.Mesh(new THREE.BoxGeometry(4.4, 1.4, 0.4), (row + col) % 9 === 0 ? warmWindow : windowMaterial);
        strip.position.set(
          tower[0] - tower[2] / 2 + 5 + col * 9,
          9 + row * 11,
          tower[1] + tower[3] / 2 + 0.3,
        );
        scene.add(strip);
      }
    }
  }

  // The rooftop the camera stands on, high above every city roof so nothing clips the lens.
  const deckMaterial = new THREE.MeshStandardMaterial({ color: 0x5e6068, roughness: 0.95 });
  const trimMaterial = new THREE.MeshStandardMaterial({ color: 0x3d4048, roughness: 0.8, metalness: 0.3 });
  const deck = new THREE.Mesh(new THREE.BoxGeometry(150, 3, 130), deckMaterial);
  deck.position.set(2, 89, 280);
  deck.receiveShadow = true;
  scene.add(deck);
  const parapet = new THREE.Mesh(new THREE.BoxGeometry(150, 1.3, 0.9), trimMaterial);
  parapet.position.set(2, 91.2, 215.4);
  scene.add(parapet);
  const lip = new THREE.Mesh(new THREE.BoxGeometry(150, 0.18, 1.6), trimMaterial);
  lip.position.set(2, 91.95, 215.4);
  scene.add(lip);
  for (let index = 0; index < 4; index += 1) {
    const vent = new THREE.Mesh(new THREE.BoxGeometry(8, 3, 6), trimMaterial);
    vent.position.set(-34 + index * 24, 92, 272 - index * 5);
    vent.castShadow = true;
    scene.add(vent);
  }
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.34, 18, 8), trimMaterial);
  mast.position.set(62, 99, 300);
  scene.add(mast);
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.7, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff4a3a, fog: false }));
  beacon.position.set(62, 108.2, 300);
  beacon.userData.beacon = true;
  scene.add(beacon);

  camera.position.set(2, 96.4, 226);
  camera.lookAt(-6, 28, -160);
  if (camera.isPerspectiveCamera) {
    camera.fov = 56;
    camera.updateProjectionMatrix();
  }
}

/** The mission courier: a lit figure with a floating yellow diamond and a soft emissive rim. */
function stageCourier(scene, THREE, position) {
  const group = new THREE.Group();
  group.position.set(position.x, 0.18, position.z);
  group.rotation.y = position.yaw;

  const coatMaterial = new THREE.MeshStandardMaterial({ color: 0x2f6b4f, roughness: 0.82 });
  const trouserMaterial = new THREE.MeshStandardMaterial({ color: 0x24262e, roughness: 0.9 });
  const skinMaterial = new THREE.MeshStandardMaterial({ color: 0xc99a74, roughness: 0.85 });
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.66, 0.32), coatMaterial);
  torso.position.y = 1.2;
  group.add(torso);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.27, 0.29, 0.27), skinMaterial);
  head.position.y = 1.67;
  group.add(head);
  const cap = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.08, 0.34), new THREE.MeshStandardMaterial({ color: 0xb03a2e, roughness: 0.7 }));
  cap.position.set(0, 1.83, 0.04);
  group.add(cap);
  for (const side of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.84, 0.2), trouserMaterial);
    leg.position.set(side * 0.13, 0.42, 0);
    group.add(leg);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.58, 0.16), coatMaterial);
    arm.position.set(side * 0.34, 1.22, 0);
    arm.rotation.z = side * 0.28;
    group.add(arm);
  }
  // Backpack so he reads as a courier from this angle.
  const bag = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.46, 0.2), new THREE.MeshStandardMaterial({ color: 0x1f2833, roughness: 0.8 }));
  bag.position.set(0, 1.2, -0.24);
  group.add(bag);

  // A subtle emissive rim: a slightly larger, back-faced copy of the torso and head shell.
  const rimMaterial = new THREE.MeshBasicMaterial({ color: 0xffd24a, side: THREE.BackSide, transparent: true, opacity: 0.4 });
  const rimTorso = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.74, 0.4), rimMaterial);
  rimTorso.position.y = 1.2;
  group.add(rimTorso);
  const rimHead = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.37, 0.35), rimMaterial);
  rimHead.position.y = 1.67;
  group.add(rimHead);

  // Floating yellow diamond, double-sided and always lit, readable against any backdrop.
  const diamondMaterial = new THREE.MeshStandardMaterial({
    color: 0xffd24a,
    emissive: 0xffc21e,
    emissiveIntensity: 2.2,
    roughness: 0.3,
    metalness: 0.1,
  });
  const diamond = new THREE.Mesh(new THREE.OctahedronGeometry(0.44, 0), diamondMaterial);
  diamond.scale.set(1, 1.5, 1);
  diamond.position.y = 2.85;
  diamond.rotation.y = 0.4;
  group.add(diamond);
  const diamondBack = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.62, 0),
    new THREE.MeshBasicMaterial({ color: 0xffe27a, transparent: true, opacity: 0.22, depthWrite: false }),
  );
  diamondBack.scale.set(1, 1.5, 1);
  diamondBack.position.y = 2.85;
  group.add(diamondBack);

  group.traverse((child) => {
    if (child.isMesh) child.castShadow = true;
  });
  scene.add(group);
  return group;
}

function lightTheCar(scene, car) {
  const THREE = getThree();
  if (!car) return;
  const length = (car.userData && car.userData.length) || 4.35;
  const beam = new THREE.Mesh(
    new THREE.ConeGeometry(3.4, 18, 18, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xffe3ad, transparent: true, opacity: 0.12, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false }),
  );
  beam.rotation.x = Math.PI / 2;
  beam.position.set(0, 0.8, length / 2 + 8.6);
  car.add(beam);
  const spot = new THREE.Mesh(
    new THREE.PlaneGeometry(9, 16),
    new THREE.MeshBasicMaterial({ color: 0xffd99a, transparent: true, opacity: 0.16, depthWrite: false, blending: THREE.AdditiveBlending }),
  );
  spot.rotation.x = -Math.PI / 2;
  spot.position.set(0, 0.06, length / 2 + 8);
  car.add(spot);
  const lamp = new THREE.PointLight(0xffd9a0, 34, 26, 2);
  lamp.position.set(0, 1, length / 2 + 4);
  car.add(lamp);
  void scene;
}

/**
 * Set up the named scene (start, play or end; anything else is start) using the live systems in
 * ctx: { scene, camera, player, vehicles, peds, police, combat, missions, hud, ui }.
 */
export function applyShot(name, ctx) {
  const scene = ctx && ctx.scene;
  const camera = ctx && ctx.camera;
  const player = ctx && ctx.player;
  const vehicles = ctx && ctx.vehicles;
  const peds = ctx && ctx.peds;
  const police = ctx && ctx.police;
  const hud = ctx && ctx.hud;
  const ui = ctx && ctx.ui;
  if (!scene || !camera) return;
  const random = seeded(0x5eed1);

  if (ui) {
    call(ui, 'hidePrompt');
    call(ui, 'hideStart');
    call(ui, 'hideOverlay');
  }

  if (name === 'play') {
    if (hud) call(hud, 'setVisible', true);
    streetDusk(scene);
    call(player.setControlsEnabled !== undefined ? player : null, 'setControlsEnabled', false);
    if (player) {
      player.health = 62;
      player.armour = 40;
      player.money = 1250;
      player.wanted = 3;
      player.ammo = 12;
      player.ammoReserve = 48;
      if ('place' in player) player.place(CONTROLS_CORNER.x, CONTROLS_CORNER.z, 0, 0);
      if ('setPistolOut' in player) player.setPistolOut(true);
      if ('setVisible' in player) player.setVisible(true);
      if (typeof player.update === 'function') player.update(0);
      call(player, 'setPose', 'aim');
    }
    // Street furniture, shopfronts and neon inside the frame the camera will see.
    dressStreet(scene, ctx.world, { x: 0, z: CONTROLS_CORNER.z + 14 }, random);

    if (police) {
      call(police, 'clear');
      call(police, 'setWanted', 3);
      const unit = callValue(police, 'spawnUnit', POLICE_CAR.x, POLICE_CAR.z, POLICE_CAR.yaw);
      call(police, 'makeWreckAt', WRECK.x, WRECK.z, WRECK.yaw);
      if ('wanted' in police) police.wanted = 3;
      // The still must read as a chase: both bar halves lit, the spotlight on the player.
      call(police, 'freezeLights', true);
      if (unit) {
        const unitObject = objectOf(unit) || (unit.group ? unit.group : null);
        if (unitObject) {
          unitObject.position.set(POLICE_CAR.x, 0, POLICE_CAR.z);
          unitObject.rotation.set(0, POLICE_CAR.yaw, 0);
          unitObject.visible = true;
        }
        if (unit.spotLight) {
          const target = unit.spotLight.target;
          if (target) {
            target.position.set(CONTROLS_CORNER.x - POLICE_CAR.x, 1, CONTROLS_CORNER.z - POLICE_CAR.z);
            target.updateMatrixWorld();
          }
        }
        if (unit.spotlight) {
          unit.spotlight.lookAt(CONTROLS_CORNER.x, 1.2, CONTROLS_CORNER.z);
        }
        if (unit.lights) {
          for (let index = 0; index < unit.lights.length; index += 1) {
            if (unit.lights[index] && unit.lights[index].material) unit.lights[index].material.emissiveIntensity = 5;
          }
        }
      }
    }
    stageCrowd(peds, random);
    stageTraffic(vehicles, random);
    stageCourier(scene, getThree(), COURIER);
    if (ctx.combat) {
      try {
        ctx.combat.ammo = 12;
      } catch {
        // Older combat builds keep their own count; the HUD fields above still read 12.
      }
    }
    if (hud) {
      call(hud, 'setClock', 20 * 60 + 12);
      call(hud, 'setWanted', 3);
      call(hud, 'setWeapon', 'PISTOL', 12);
      call(hud, 'setAmmo', 12);
      if ('objective' in hud) hud.objective = 'ELIMINATE THE COURIER';
      else call(hud, 'subtitle', 'ELIMINATE THE COURIER', 60000);
      if ('money' in hud) hud.money = 1250;
    }
    // Over-the-shoulder: 2.6 m back, 0.7 m to the player's right, eye at 1.55 m, looking 12 m
    // up the street at chest height so the street recedes and the player sits in the left third.
    const forwardX = Math.sin(player && typeof player.yaw === 'number' ? player.yaw : 0);
    const forwardZ = Math.cos(player && typeof player.yaw === 'number' ? player.yaw : 0);
    const rightX = -Math.cos(player && typeof player.yaw === 'number' ? player.yaw : 0);
    const rightZ = Math.sin(player && typeof player.yaw === 'number' ? player.yaw : 0);
    const px = CONTROLS_CORNER.x;
    const pz = CONTROLS_CORNER.z;
    camera.position.set(px - forwardX * 2.6 + rightX * 0.7, 1.55, pz - forwardZ * 2.6 + rightZ * 0.7);
    camera.lookAt(px + forwardX * 12, 1.4, pz + forwardZ * 12);
    if (camera.isPerspectiveCamera) {
      camera.fov = 55;
      camera.updateProjectionMatrix();
    }
    if (typeof window !== 'undefined' && window.location && /[?&]dbg=over/.test(window.location.search)) {
      camera.position.set(70, 96, 10);
      camera.lookAt(0, 4, 120);
      if (camera.isPerspectiveCamera) {
        camera.fov = 55;
        camera.updateProjectionMatrix();
      }
    } else if (typeof window !== 'undefined' && window.location && /[?&]dbg=low/.test(window.location.search)) {
      camera.position.set(-16, 9, 34);
      camera.lookAt(4, 6, 110);
    }
    if (ui) call(ui, 'showPrompt');
    return;
  }

  if (name === 'end') {
    if (hud) call(hud, 'setVisible', true);
    call(player.setControlsEnabled !== undefined ? player : null, 'setControlsEnabled', false);
    blueHour(scene);
    if (player) {
      player.health = 100;
      player.armour = 25;
      player.money = 3750;
      player.wanted = 0;
      player.ammo = 12;
      player.ammoReserve = 36;
      if ('place' in player) player.place(DROP_PLAYER.x, DROP_PLAYER.z, DROP_PLAYER.yaw, -0.02);
      if ('setPistolOut' in player) player.setPistolOut(false);
      if ('setVisible' in player) player.setVisible(true);
    }
    if (police) {
      call(police, 'clear');
      if ('wanted' in police) police.wanted = 0;
    }
    let car = null;
    if (vehicles && typeof vehicles.makeCar === 'function') {
      car = vehicles.makeCar(0x8b3232, 'coupe');
      car.position.set(WATERFRONT.x, 0, WATERFRONT.z);
      car.rotation.y = WATERFRONT.yaw;
      scene.add(car);
    } else if (vehicles && Array.isArray(vehicles.cars) && vehicles.cars.length > 0) {
      const candidate = vehicles.cars[0];
      car = objectOf(candidate);
      if (car) {
        car.position.set(WATERFRONT.x, 0, WATERFRONT.z);
        car.rotation.y = WATERFRONT.yaw;
      }
    }
    if (car) {
      car.updateMatrixWorld(true);
      lightTheCar(scene, car);
      for (let index = 0; index < (vehicles.cars || []).length; index += 1) {
        const other = objectOf(vehicles.cars[index]);
        if (other) other.visible = false;
      }
    }
    if (peds && Array.isArray(peds.peds)) {
      for (let index = 0; index < peds.peds.length; index += 1) {
        const entity = objectOf(peds.peds[index]);
        if (entity) entity.visible = index < 2;
      }
      // The two witnesses stand by the quay wall, facing the car.
      for (let index = 0; index < Math.min(2, peds.peds.length); index += 1) {
        const witness = peds.peds[index];
        const object = objectOf(witness);
        if (!object) continue;
        object.position.set(3.4 + index * 1.6, 0.16, 300.5 - index * 1.4);
        object.rotation.y = -2.4;
        if (witness.legs) {
          witness.legs[0].rotation.x = 0.2;
          witness.legs[1].rotation.x = -0.2;
        }
      }
    }
    // A lit quay lamp and a warm boat beacon so the blue hour has some warm counterpoint.
    const THREE = getThree();
    const lampLight = new THREE.PointLight(0xffb266, 55, 42, 2);
    lampLight.position.set(6, 5.4, 302);
    scene.add(lampLight);
    const quayLamp = new THREE.Mesh(
      new THREE.SphereGeometry(0.24, 10, 8),
      new THREE.MeshBasicMaterial({ color: 0xffddad, fog: false }),
    );
    quayLamp.position.set(6, 5.4, 302);
    scene.add(quayLamp);
    const horizonGlow = new THREE.Mesh(
      new THREE.PlaneGeometry(900, 46),
      new THREE.MeshBasicMaterial({ color: 0x3d5a86, transparent: true, opacity: 0.32, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }),
    );
    horizonGlow.position.set(0, 8, 620);
    scene.add(horizonGlow);
    if (hud) {
      call(hud, 'setClock', 22 * 60 + 12);
      call(hud, 'setWanted', 0);
      call(hud, 'setWeapon', 'PISTOL', 12);
      call(hud, 'setAmmo', 12);
      if ('money' in hud) hud.money = 3750;
      if ('objective' in hud) hud.objective = '';
      call(hud, 'showBanner', 'MISSION PASSED', '$2 500', 6000);
    }
    camera.position.set(6.4, 3.2, 283);
    camera.lookAt(-3.2, 1.25, 295);
    if (camera.isPerspectiveCamera) {
      camera.fov = 58;
      camera.updateProjectionMatrix();
    }
    return;
  }

  goldenHour(scene);
  buildHeroSkyline(scene, camera);
  if (hud) call(hud, 'setVisible', false);
  call(player.setControlsEnabled !== undefined ? player : null, 'setControlsEnabled', false);
  if (player) {
    player.health = 100;
    player.armour = 40;
    player.money = 1250;
    player.wanted = 0;
    if ('place' in player) player.place(0, 40, Math.PI, 0);
    if ('setPistolOut' in player) player.setPistolOut(true);
  }
  if (police) {
    call(police, 'clear');
    call(police, 'setWanted', 2);
    call(police, 'spawnUnit', 4.2, -42, Math.PI);
    call(police, 'spawnUnit', 4.2, -18, Math.PI);
    call(police, 'spawnUnit', 4.2, -86, Math.PI);
  }
  if (ui) call(ui, 'showStart');
}
