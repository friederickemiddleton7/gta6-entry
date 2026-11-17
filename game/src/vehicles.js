// Traffic, parked cars and the one the player can steal. Every car is a small group of boxes: a
// body, glass, a roof and four spinning wheels, with emissive headlights and tail-lights so it
// reads at night and a roof sign on the taxis. Traffic drives the road grid in lanes, turns at
// junctions, keeps its distance and brakes for the player on foot. Stealing a car with F ejects
// the driver and gives the player arcade physics: acceleration, braking, reverse, steering that
// tightens with speed, a handbrake drift with tyre smoke, and buildings that dent the body and
// shake the chase camera. Every variant and every respawn comes from the seeded rng.

const LANE = 4.2;
const TRAFFIC_COUNT = 12;
const PARKED_COUNT = 8;
const CAR_RADIUS = 1.4;
const ROAD_FALLBACK = [-176, -88, 0, 88, 176];
const CAR_COLORS = [0x8b3232, 0x2f4f8b, 0xd6d6d2, 0x2f6b4f, 0x2b2b30, 0x9a7b32, 0x5b4a7a, 0x767b82, 0xb0b4b8, 0x3d6f8c];
const TAXI_YELLOW = 0xe5b31f;

function getThree() {
  const THREE = globalThis.THREE;
  if (!THREE) throw new Error('vehicles.js needs the global THREE from three.min.js');
  return THREE;
}

function fallbackRandom(seed) {
  let a = seed | 0;
  return function random() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp(value, min, max) {
  return value < min ? min : value > max ? max : value;
}

function wrapAngle(angle) {
  let value = angle;
  while (value > Math.PI) value -= Math.PI * 2;
  while (value < -Math.PI) value += Math.PI * 2;
  return value;
}

/** The player may be a mesh, a wrapper with .mesh/.group/.position, or just an { x, z }. */
function objectOf(source) {
  if (!source) return null;
  if (source.isObject3D) return source;
  const candidate = source.mesh || source.object || source.group || source.root || source.model;
  return candidate && candidate.isObject3D ? candidate : null;
}

function pointOf(source) {
  if (!source) return null;
  const object = objectOf(source);
  if (object) return object.position;
  if (source.position && typeof source.position.x === 'number') return source.position;
  if (source.pos && typeof source.pos.x === 'number') return source.pos;
  if (typeof source.x === 'number' && typeof source.z === 'number') return source;
  return null;
}

function setPlayerPosition(player, x, z) {
  const point = pointOf(player);
  if (!point) return;
  point.x = x;
  point.z = z;
  if (player && player.position && player.position !== point) {
    player.position.x = x;
    player.position.z = z;
  }
}

function setPlayerVisible(player, visible) {
  const object = objectOf(player);
  if (object) object.visible = visible;
  if (player && typeof player.setVisible === 'function') player.setVisible(visible);
}

/**
 * Build one low-poly car from boxes. `kind` is sedan (default), coupe, pickup or taxi; a taxi is a
 * sedan with a lit roof sign. The group carries its body, wheels and length in userData so the
 * driving code can dent it, spin the wheels and know its footprint.
 */
export function makeCar(colour, kind) {
  const THREE = getThree();
  const type = kind || 'sedan';
  const taxi = type === 'taxi';
  const shape = taxi ? 'sedan' : type;
  const group = new THREE.Group();
  const bodyMaterial = new THREE.MeshStandardMaterial({ color: colour, roughness: 0.42, metalness: 0.4 });
  const glassMaterial = new THREE.MeshStandardMaterial({ color: 0x16212d, roughness: 0.12, metalness: 0.72 });
  const tyreMaterial = new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: 0.95 });
  const trimMaterial = new THREE.MeshStandardMaterial({ color: 0x1d2126, roughness: 0.55, metalness: 0.5 });
  const headMaterial = new THREE.MeshStandardMaterial({ color: 0xfff4d4, emissive: 0xffdc96, emissiveIntensity: 2.4, roughness: 0.28 });
  const tailMaterial = new THREE.MeshStandardMaterial({ color: 0xff5a44, emissive: 0xff2a18, emissiveIntensity: 2.1, roughness: 0.36 });

  const length = shape === 'pickup' ? 4.7 : shape === 'coupe' ? 4.0 : 4.35;
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.86, 0.68, length), bodyMaterial);
  body.position.y = 0.64;
  group.add(body);

  if (shape === 'pickup') {
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.66, 0.68, 1.5), glassMaterial);
    cabin.position.set(0, 1.2, 0.5);
    group.add(cabin);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(1.56, 0.12, 1.4), bodyMaterial);
    roof.position.set(0, 1.58, 0.5);
    group.add(roof);
    for (const side of [-1, 1]) {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.45, 1.85), bodyMaterial);
      wall.position.set(side * 0.87, 1.0, -1.16);
      group.add(wall);
    }
    const gate = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.45, 0.12), bodyMaterial);
    gate.position.set(0, 1.0, -2.04);
    group.add(gate);
  } else {
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.64, shape === 'coupe' ? 0.56 : 0.62, shape === 'coupe' ? 1.5 : 2.1), glassMaterial);
    cabin.position.set(0, shape === 'coupe' ? 1.1 : 1.16, shape === 'coupe' ? -0.55 : -0.2);
    group.add(cabin);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(shape === 'coupe' ? 1.5 : 1.52, 0.12, shape === 'coupe' ? 1.2 : 1.7), bodyMaterial);
    roof.position.set(0, shape === 'coupe' ? 1.42 : 1.52, shape === 'coupe' ? -0.55 : -0.25);
    group.add(roof);
  }

  for (const side of [-1, 1]) {
    const bumper = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.22, 0.18), trimMaterial);
    bumper.position.set(0, 0.48, side * (length / 2 + 0.02));
    group.add(bumper);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.18, 0.08), headMaterial);
    head.position.set(side * 0.58, 0.8, length / 2 + 0.03);
    group.add(head);
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.16, 0.08), tailMaterial);
    tail.position.set(side * 0.58, 0.8, -length / 2 - 0.03);
    group.add(tail);
  }

  if (taxi) {
    const sign = new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.24, 0.34), new THREE.MeshStandardMaterial({ color: TAXI_YELLOW, emissive: 0xffcf4d, emissiveIntensity: 1.8, roughness: 0.4 }));
    sign.position.set(0, 1.78, -0.1);
    group.add(sign);
  }

  const wheelGeometry = new THREE.CylinderGeometry(0.37, 0.37, 0.28, 10);
  wheelGeometry.rotateZ(Math.PI / 2);
  const wheels = [];
  for (const side of [-1, 1]) {
    for (const front of [-1, 1]) {
      const wheel = new THREE.Mesh(wheelGeometry, tyreMaterial);
      wheel.position.set(side * 0.92, 0.37, front * (length / 2 - 0.95));
      group.add(wheel);
      wheels.push(wheel);
    }
  }

  group.traverse((child) => {
    if (child.isMesh) {
      child.castShadow = true;
      child.receiveShadow = true;
    }
  });
  group.userData = { body, wheels, length, kind: type };
  return group;
}

/** The driver thrown out of a stolen car: tumbles on the spot and is gone in a couple of seconds. */
function makeEjectedDriver(shirt, trousers) {
  const THREE = getThree();
  const group = new THREE.Group();
  const shirtMaterial = new THREE.MeshStandardMaterial({ color: shirt, roughness: 0.9 });
  const trouserMaterial = new THREE.MeshStandardMaterial({ color: trousers, roughness: 0.92 });
  const skinMaterial = new THREE.MeshStandardMaterial({ color: 0xc99a74, roughness: 0.85 });
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.6, 0.3), shirtMaterial);
  torso.position.y = 1.18;
  group.add(torso);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.28, 0.26), skinMaterial);
  head.position.y = 1.62;
  group.add(head);
  for (const side of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.82, 0.2), trouserMaterial);
    leg.position.set(side * 0.13, 0.42, 0);
    group.add(leg);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.56, 0.16), shirtMaterial);
    arm.position.set(side * 0.33, 1.2, 0);
    arm.rotation.z = side * 0.35;
    group.add(arm);
  }
  return group;
}
export function createVehicles(scene, world, rng) {
  const THREE = getThree();
  const random = typeof rng === 'function' ? rng : fallbackRandom(0x5eed);
  const pick = (list) => list[Math.floor(random() * list.length) % list.length];

  const roads = Array.isArray(world && world.roads) ? world.roads : [];
  const vertical = roads.filter((road) => road && road.axis === 'z' && typeof road.x === 'number');
  const seen = new Set();
  const roadCenters = [];
  for (let index = 0; index < vertical.length; index += 1) {
    const centre = Math.round(vertical[index].x * 100) / 100;
    if (!seen.has(centre)) {
      seen.add(centre);
      roadCenters.push(centre);
    }
  }
  roadCenters.sort((a, b) => a - b);
  if (roadCenters.length < 2) {
    for (let index = 0; index < ROAD_FALLBACK.length; index += 1) roadCenters.push(ROAD_FALLBACK[index]);
  }
  const half = vertical.length > 0 && typeof vertical[0].depth === 'number' ? vertical[0].depth / 2 : 264;

  const cars = [];
  const smoke = [];
  const ejected = [];
  let driven = null;
  let camera = null;
  let chase = null;
  let playerRef = null;
  let shake = 0;
  let smokeTimer = 0;
  let smokeCursor = 0;
  let time = 0;

  const keys = new Set();
  const api = {
    cars,
    crime: 0,
    onCrime: null,
    onSteal: null,
    nearest,
    update,
    enter,
    exit,
    makeCar,
    setCamera,
    get driving() {
      return driven;
    },
  };

  function setCamera(next) {
    camera = next && next.isCamera ? next : null;
  }

  function findCamera() {
    if (camera && camera.isCamera) return camera;
    if (scene.userData && scene.userData.camera && scene.userData.camera.isCamera) return scene.userData.camera;
    for (let index = 0; index < scene.children.length; index += 1) {
      const child = scene.children[index];
      if (child && child.isCamera) return child;
    }
    if (globalThis.gameCamera && globalThis.gameCamera.isCamera) return globalThis.gameCamera;
    return null;
  }

  function makeTrafficCar(index) {
    const roll = random();
    const kind = roll < 0.1 ? 'taxi' : roll < 0.3 ? 'coupe' : roll < 0.46 ? 'pickup' : 'sedan';
    const colour = kind === 'taxi' ? TAXI_YELLOW : pick(CAR_COLORS);
    const group = makeCar(colour, kind);
    scene.add(group);
    const car = {
      group,
      body: group.userData.body,
      wheels: group.userData.wheels,
      length: group.userData.length,
      x: 0,
      z: 0,
      yaw: 0,
      vx: 0,
      vz: 0,
      speed: 0,
      baseSpeed: 9 + random() * 5,
      axis: 'z',
      dir: 1,
      road: roadCenters[0],
      decided: null,
      parked: false,
      stolen: false,
      driver: true,
      dents: 0,
      wheelSpin: 0,
      seat: index,
    };
    group.userData.car = car;
    cars.push(car);
    respawn(car, null);
    return car;
  }

  function makeParkedCar() {
    const roll = random();
    const kind = roll < 0.1 ? 'taxi' : roll < 0.28 ? 'coupe' : roll < 0.4 ? 'pickup' : 'sedan';
    const colour = kind === 'taxi' ? TAXI_YELLOW : pick(CAR_COLORS);
    const group = makeCar(colour, kind);
    scene.add(group);
    const car = {
      group,
      body: group.userData.body,
      wheels: group.userData.wheels,
      length: group.userData.length,
      x: 0,
      z: 0,
      yaw: 0,
      vx: 0,
      vz: 0,
      speed: 0,
      baseSpeed: 0,
      axis: 'z',
      dir: 1,
      road: roadCenters[0],
      decided: null,
      parked: true,
      stolen: false,
      driver: false,
      dents: 0,
      wheelSpin: 0,
      seat: cars.length,
    };
    group.userData.car = car;
    for (let attempt = 0; attempt < 18; attempt += 1) {
      const axis = random() < 0.5 ? 'z' : 'x';
      const side = random() < 0.5 ? 1 : -1;
      const road = pick(roadCenters);
      const along = (random() * 2 - 1) * (half - 24);
      if (Math.abs(along - road) < 20) continue;
      const offset = road + side * (LANE + 2.4);
      const x = axis === 'z' ? offset : along;
      const z = axis === 'z' ? along : offset;
      if (!clearOf(x, z, 9, car)) continue;
      car.axis = axis;
      car.dir = random() < 0.5 ? 1 : -1;
      car.road = road;
      car.x = x;
      car.z = z;
      car.yaw = axis === 'z' ? (car.dir > 0 ? 0 : Math.PI) : car.dir > 0 ? Math.PI / 2 : -Math.PI / 2;
      break;
    }
    group.position.set(car.x, 0, car.z);
    group.rotation.y = car.yaw;
    cars.push(car);
    return car;
  }

  function clearOf(x, z, spacing, ignore) {
    for (let index = 0; index < cars.length; index += 1) {
      const other = cars[index];
      if (other === ignore || other === driven) continue;
      if (Math.hypot(other.x - x, other.z - z) < spacing) return false;
    }
    return true;
  }

  function placeInLane(car, axis, dir, road, along) {
    car.axis = axis;
    car.dir = dir;
    car.road = road;
    const lane = axis === 'z' ? road + dir * LANE : road - dir * LANE;
    if (axis === 'z') {
      car.x = lane;
      car.z = along;
      car.yaw = dir > 0 ? 0 : Math.PI;
    } else {
      car.x = along;
      car.z = lane;
      car.yaw = dir > 0 ? Math.PI / 2 : -Math.PI / 2;
    }
    car.group.position.set(car.x, 0, car.z);
    car.group.rotation.y = car.yaw;
  }

  function respawn(car, away) {
    for (let attempt = 0; attempt < 16; attempt += 1) {
      const axis = random() < 0.5 ? 'z' : 'x';
      const dir = random() < 0.5 ? 1 : -1;
      const road = pick(roadCenters);
      const along = (random() * 2 - 1) * (half - 22);
      let junction = false;
      for (let index = 0; index < roadCenters.length; index += 1) {
        if (Math.abs(along - roadCenters[index]) < 13) junction = true;
      }
      if (junction) continue;
      const lane = axis === 'z' ? road + dir * LANE : road - dir * LANE;
      const x = axis === 'z' ? lane : along;
      const z = axis === 'z' ? along : lane;
      if (away && Math.hypot(x - away.x, z - away.z) < 50) continue;
      if (!clearOf(x, z, 12, car)) continue;
      placeInLane(car, axis, dir, road, along);
      car.speed = car.baseSpeed * 0.7;
      car.decided = null;
      car.stolen = false;
      return;
    }
    placeInLane(car, 'z', 1, roadCenters[Math.floor(roadCenters.length / 2)], (random() * 2 - 1) * (half - 30));
    car.speed = car.baseSpeed;
    car.decided = null;
  }

  function buildSmoke() {
    const geometry = new THREE.SphereGeometry(0.42, 5, 4);
    for (let index = 0; index < 26; index += 1) {
      const material = new THREE.MeshBasicMaterial({ color: 0xb9bec4, transparent: true, opacity: 0, depthWrite: false });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.visible = false;
      scene.add(mesh);
      smoke.push({ mesh, material, life: 0, vx: 0, vy: 0, vz: 0, size: 1 });
    }
  }

  function emitSmoke(x, z, strength) {
    if (smoke.length === 0) return;
    const puff = smoke[smokeCursor % smoke.length];
    smokeCursor += 1;
    puff.life = 1;
    puff.mesh.visible = true;
    puff.mesh.position.set(x, 0.26 + random() * 0.2, z);
    puff.mesh.scale.setScalar(0.4);
    puff.vx = (random() - 0.5) * 2.4;
    puff.vz = (random() - 0.5) * 2.4;
    puff.vy = 0.6 + random() * 0.8;
    puff.size = 0.4 + strength * 0.35;
    puff.material.opacity = 0.3;
  }

  function updateSmoke(dt) {
    for (let index = 0; index < smoke.length; index += 1) {
      const puff = smoke[index];
      if (puff.life <= 0) continue;
      puff.life -= dt * 1.35;
      if (puff.life <= 0) {
        puff.life = 0;
        puff.mesh.visible = false;
        puff.material.opacity = 0;
        continue;
      }
      puff.mesh.position.x += puff.vx * dt;
      puff.mesh.position.y += puff.vy * dt;
      puff.mesh.position.z += puff.vz * dt;
      puff.vy *= 0.97;
      puff.mesh.scale.setScalar(puff.size + (1 - puff.life) * 1.6);
      puff.material.opacity = Math.max(0, puff.life) * 0.3;
    }
  }

  function ejectDriver(car) {
    const group = makeEjectedDriver(pick(CAR_COLORS), pick([0x22262e, 0x3b3f47, 0x4a4038]));
    const right = { x: Math.cos(car.yaw), z: -Math.sin(car.yaw) };
    group.position.set(car.x + right.x * 2.1, 0, car.z + right.z * 2.1);
    group.rotation.y = car.yaw;
    scene.add(group);
    ejected.push({
      group,
      life: 0,
      vx: right.x * 3.2 + (random() - 0.5),
      vz: right.z * 3.2 + (random() - 0.5),
    });
  }

  function updateEjected(dt) {
    for (let index = ejected.length - 1; index >= 0; index -= 1) {
      const item = ejected[index];
      item.life += dt;
      item.group.position.x += item.vx * dt;
      item.group.position.z += item.vz * dt;
      item.vx *= 0.9;
      item.vz *= 0.9;
      item.group.rotation.z = Math.sin(item.life * 10) * 0.22;
      item.group.rotation.x = Math.min(Math.PI / 2, item.life * 4);
      item.group.position.y = Math.min(0.42, item.life * 1.4);
      if (item.life > 2.4) {
        scene.remove(item.group);
        ejected.splice(index, 1);
      }
    }
  }
  function relative(car, otherX, otherZ) {
    const dx = otherX - car.x;
    const dz = otherZ - car.z;
    const distance = Math.hypot(dx, dz);
    if (distance < 0.001) return { distance: 0, ahead: 1 };
    const forward = Math.sin(car.yaw) * dx + Math.cos(car.yaw) * dz;
    return { distance, ahead: forward / distance };
  }

  function updateTrafficCar(car, dt, playerPoint, playerDriving) {
    if (car.parked || car === driven) return;
    const along = car.axis === 'z' ? car.z : car.x;
    let gap = Infinity;
    let junction = null;
    for (let index = 0; index < roadCenters.length; index += 1) {
      const centre = roadCenters[index];
      const ahead = car.dir * (centre - along);
      if (ahead > 4 && ahead < gap) {
        gap = ahead;
        junction = centre;
      }
    }
    if (junction !== null && gap < 6 && car.decided !== junction) {
      car.decided = junction;
      if (random() < 0.4) {
        car.axis = car.axis === 'z' ? 'x' : 'z';
        car.dir = random() < 0.5 ? 1 : -1;
        car.road = junction;
      }
    }

    let target = car.baseSpeed;
    if (gap < 18) target = Math.min(target, 6.5);
    for (let index = 0; index < cars.length; index += 1) {
      const other = cars[index];
      if (other === car || other.parked) continue;
      const look = relative(car, other.x, other.z);
      if (look.ahead > 0.55 && look.distance < 13) {
        if (look.distance < 6.2) target = 0;
        else target = Math.min(target, Math.max(0, other.speed * 0.8));
      }
    }
    if (!playerDriving && playerPoint) {
      const look = relative(car, playerPoint.x, playerPoint.z);
      if (look.ahead > 0.2 && look.distance < 9.5) target = 0;
    }
    if (car.speed < target) car.speed = Math.min(target, car.speed + 6 * dt);
    else car.speed = Math.max(target, car.speed - 22 * dt);

    const lookAhead = 8 + car.speed * 0.4;
    let targetX;
    let targetZ;
    if (car.axis === 'z') {
      targetX = car.road + car.dir * LANE;
      targetZ = car.z + car.dir * lookAhead;
    } else {
      targetX = car.x + car.dir * lookAhead;
      targetZ = car.road - car.dir * LANE;
    }
    const desired = Math.atan2(targetX - car.x, targetZ - car.z);
    const diff = wrapAngle(desired - car.yaw);
    car.yaw = wrapAngle(car.yaw + clamp(diff, -2.4 * dt, 2.4 * dt));

    car.x += Math.sin(car.yaw) * car.speed * dt;
    car.z += Math.cos(car.yaw) * car.speed * dt;
    car.group.position.set(car.x, 0, car.z);
    car.group.rotation.y = car.yaw;

    car.wheelSpin += (car.speed * dt) / 0.37;
    for (let index = 0; index < car.wheels.length; index += 1) car.wheels[index].rotation.x = car.wheelSpin;

    if (Math.abs(car.x) > half + 35 || Math.abs(car.z) > half + 35) respawn(car, playerPoint);
  }

  function dent(car, strength) {
    car.dents += 1;
    const body = car.body;
    if (!body) return;
    body.scale.x = Math.max(0.86, 1 - car.dents * 0.016);
    body.scale.y = Math.max(0.8, 1 - car.dents * 0.02);
    body.rotation.z = clamp(body.rotation.z + (random() - 0.5) * 0.08 * strength, -0.14, 0.14);
    car.group.rotation.z = clamp(car.group.rotation.z + (random() - 0.5) * 0.05, -0.07, 0.07);
  }

  /** Push a point out of every building/kerb box and report the hardest overlap, if any. */
  function collideWithCity(x, z, radius) {
    const colliders = world && Array.isArray(world.colliders) ? world.colliders : [];
    let pushX = 0;
    let pushZ = 0;
    let hit = 0;
    for (let index = 0; index < colliders.length; index += 1) {
      const volume = colliders[index];
      const min = volume && volume.min;
      const max = volume && volume.max;
      if (!min || !max) continue;
      if (max.y !== undefined && max.y < 0.7) continue;
      const nearestX = clamp(x, min.x, max.x);
      const nearestZ = clamp(z, min.z, max.z);
      const dx = x - nearestX;
      const dz = z - nearestZ;
      const distanceSq = dx * dx + dz * dz;
      if (distanceSq >= radius * radius) continue;
      if (distanceSq > 0.000001) {
        const distance = Math.sqrt(distanceSq);
        const depth = radius - distance;
        pushX += (dx / distance) * depth;
        pushZ += (dz / distance) * depth;
        hit = Math.max(hit, depth);
      } else {
        const left = x - min.x;
        const right = max.x - x;
        const back = z - min.z;
        const front = max.z - z;
        const smallest = Math.min(left, right, back, front);
        if (smallest === left) pushX -= radius + left;
        else if (smallest === right) pushX += radius + right;
        else if (smallest === back) pushZ -= radius + back;
        else pushZ += radius + front;
        hit = Math.max(hit, radius);
      }
    }
    return { x: pushX, z: pushZ, hit };
  }

  function driveCar(car, dt, playerPoint) {
    const throttle = keys.has('KeyW') || keys.has('ArrowUp') ? 1 : keys.has('KeyS') || keys.has('ArrowDown') ? -1 : 0;
    const steer = keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : keys.has('KeyD') || keys.has('ArrowRight') ? -1 : 0;
    const handbrake = keys.has('Space');

    const forward = Math.sin(car.yaw) * car.vx + Math.cos(car.yaw) * car.vz;
    let forwardSpeed = forward;
    let accel = 0;
    if (throttle > 0) accel = forwardSpeed < 0 ? 20 : 12;
    else if (throttle < 0) accel = forwardSpeed > 0 ? -24 : -7;
    else accel = -forwardSpeed * 1.4;
    if (handbrake) accel -= forwardSpeed * 4.5;
    forwardSpeed = clamp(forwardSpeed + accel * dt, -9, 30);

    const grip = handbrake ? 2.1 : 9.5;
    const side = Math.sin(car.yaw) * car.vz - Math.cos(car.yaw) * car.vx;
    const newSide = side * Math.max(0, 1 - grip * dt);
    const turnRate = steer * clamp(Math.abs(forwardSpeed) / 9, 0, 1) * (handbrake ? 2.6 : 1.9);
    car.yaw = wrapAngle(car.yaw + turnRate * dt * (forwardSpeed >= 0 ? 1 : -1));

    car.vx = Math.sin(car.yaw) * forwardSpeed + Math.cos(car.yaw) * newSide;
    car.vz = Math.cos(car.yaw) * forwardSpeed - Math.sin(car.yaw) * newSide;

    car.speed = forwardSpeed;
    car.x += car.vx * dt;
    car.z += car.vz * dt;

    const pushed = collideWithCity(car.x, car.z, CAR_RADIUS);
    if (pushed.hit > 0) {
      car.x += pushed.x;
      car.z += pushed.z;
      const magnitude = Math.hypot(car.vx, car.vz);
      car.vx *= 0.55;
      car.vz *= 0.55;
      if (magnitude > 4) {
        dent(car, Math.min(2.5, magnitude / 8));
        shake = Math.min(0.7, shake + magnitude * 0.022);
        emitSmoke(car.x, car.z, 1);
      }
    }

    const minX = -half - 10;
    const maxX = half + 10;
    const minZ = -half - 10;
    const maxZ = half + 10;
    if (car.x < minX || car.x > maxX) {
      car.x = clamp(car.x, minX, maxX);
      car.vx *= -0.35;
    }
    if (car.z < minZ || car.z > maxZ) {
      car.z = clamp(car.z, minZ, maxZ);
      car.vz *= -0.35;
    }

    for (let index = 0; index < cars.length; index += 1) {
      const other = cars[index];
      if (other === car) continue;
      const dx = other.x - car.x;
      const dz = other.z - car.z;
      const distance = Math.hypot(dx, dz);
      if (distance > 2.6 || distance < 0.0001) continue;
      const speed = Math.hypot(car.vx, car.vz);
      if (speed > 5) {
        other.speed = 0;
        other.x += (dx / distance) * (2.6 - distance);
        other.z += (dz / distance) * (2.6 - distance);
        other.group.position.set(other.x, 0, other.z);
        dent(car, 0.7);
        dent(other, 0.4);
        shake = Math.min(0.6, shake + speed * 0.012);
      }
      car.vx *= 0.6;
      car.vz *= 0.6;
    }

    car.group.position.set(car.x, 0, car.z);
    car.group.rotation.y = car.yaw;

    car.wheelSpin += (car.speed * dt) / 0.37;
    for (let index = 0; index < car.wheels.length; index += 1) car.wheels[index].rotation.x = car.wheelSpin;

    if (handbrake && Math.abs(car.speed) > 4) {
      smokeTimer += dt;
      while (smokeTimer > 0.035) {
        smokeTimer -= 0.035;
        const back = { x: car.x - Math.sin(car.yaw) * 1.6, z: car.z - Math.cos(car.yaw) * 1.6 };
        emitSmoke(back.x + (random() - 0.5), back.z + (random() - 0.5), 1.2);
      }
    }

    setPlayerPosition(playerRef, car.x, car.z);
  }

  function updateChase(dt, car) {
    const active = findCamera();
    if (!active) return;
    const speed = Math.abs(car.speed);
    const distance = 7.4 + speed * 0.14;
    const height = 3.4 + speed * 0.03;
    const behindX = car.x - Math.sin(car.yaw) * distance;
    const behindZ = car.z - Math.cos(car.yaw) * distance;
    const targetX = car.x + Math.sin(car.yaw) * 5;
    const targetZ = car.z + Math.cos(car.yaw) * 5;
    if (!chase) {
      chase = { x: behindX, y: height, z: behindZ, tx: targetX, ty: 1.2, tz: targetZ, active: true };
      active.position.set(behindX, height, behindZ);
      if (active.lookAt) active.lookAt(targetX, 1.2, targetZ);
    }
    const follow = 1 - Math.exp(-8 * dt);
    chase.x += (behindX - chase.x) * follow;
    chase.z += (behindZ - chase.z) * follow;
    chase.y += (height - chase.y) * follow;
    chase.tx += (targetX - chase.tx) * follow;
    chase.tz += (targetZ - chase.tz) * follow;
    shake = Math.max(0, shake - dt * 1.4);
    const jitter = shake * 0.5;
    active.position.set(
      chase.x + (random() - 0.5) * jitter,
      chase.y + (random() - 0.5) * jitter,
      chase.z + (random() - 0.5) * jitter,
    );
    if (active.lookAt) active.lookAt(chase.tx, 1.3, chase.tz);
  }

  function nearest(pos, maxDist) {
    const target = pointOf(pos);
    if (!target) return null;
    let best = null;
    let bestDistance = maxDist === undefined ? Infinity : maxDist;
    for (let index = 0; index < cars.length; index += 1) {
      const car = cars[index];
      if (car === driven) continue;
      const distance = Math.hypot(car.x - target.x, car.z - target.z);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = car;
      }
    }
    return best;
  }

  function enter(car) {
    if (!car || driven) return null;
    driven = car;
    if (car.driver) {
      ejectDriver(car);
      car.driver = false;
    }
    car.parked = false;
    car.stolen = true;
    car.speed = 0;
    car.vx = 0;
    car.vz = 0;
    const yaw = car.yaw;
    car.x = car.group.position.x;
    car.z = car.group.position.z;
    car.group.rotation.z = 0;
    car.group.rotation.y = yaw;
    setPlayerVisible(playerRef, false);
    setPlayerPosition(playerRef, car.x, car.z);
    if (typeof api.onSteal === 'function') api.onSteal(car);
    if (typeof api.onCrime === 'function') api.onCrime(1);
    return car;
  }

  function exit() {
    if (!driven) return;
    const car = driven;
    car.speed = 0;
    car.vx = 0;
    car.vz = 0;
    car.decided = null;
    car.dir = Math.cos(car.yaw) >= 0 ? 1 : -1;
    car.axis = Math.abs(Math.sin(car.yaw)) > Math.abs(Math.cos(car.yaw)) ? 'x' : 'z';
    car.road = car.axis === 'z' ? car.x - car.dir * LANE : car.z + car.dir * LANE;
    car.baseSpeed = 0;
    car.parked = true;
    driven = null;
    chase = null;
    const right = { x: Math.cos(car.yaw), z: -Math.sin(car.yaw) };
    setPlayerPosition(playerRef, car.x + right.x * 2.2, car.z + right.z * 2.2);
    setPlayerVisible(playerRef, true);
  }

  function update(dt, player) {
    if (player) playerRef = player;
    time += dt;
    const point = pointOf(playerRef);
    if (driven) {
      driveCar(driven, dt, point);
      updateChase(dt, driven);
    } else {
      chase = null;
      for (let index = 0; index < cars.length; index += 1) updateTrafficCar(cars[index], dt, point, false);
    }
    updateSmoke(dt);
    updateEjected(dt);
  }

  function attachKeyboard(target) {
    const element = target && target.addEventListener ? target : typeof window !== 'undefined' ? window : null;
    if (!element) return;
    element.addEventListener('keydown', (event) => {
      keys.add(event.code);
    });
    element.addEventListener('keyup', (event) => {
      keys.delete(event.code);
    });
    if (typeof window !== 'undefined') {
      window.addEventListener('blur', () => keys.clear());
    }
  }

  for (let index = 0; index < TRAFFIC_COUNT; index += 1) makeTrafficCar(index);
  for (let index = 0; index < PARKED_COUNT; index += 1) makeParkedCar();
  buildSmoke();
  attachKeyboard(typeof window !== 'undefined' ? window : null);

  return api;
}


