// The crowd. Every pedestrian is a small box person with a random shirt, trousers and skin tone,
// walking a beat along the kerb of one city block. When something loud happens nearby they scatter:
// they run from a threat point for a while, then calm down and pick a new beat. Nothing here is a
// game rule, so the pistol, missions and minimap all just read the `peds` array.
const PED_COUNT = 14;
const WALK_SPEED = 1.25;
const RUN_SPEED = 4.4;
const SCATTER_TIME = 7;

const SHIRTS = [0x8b4a3a, 0x3a5a8b, 0x6b6b4a, 0x7a3a6b, 0x3a7a6b, 0x9a7b32, 0x555a63, 0xb0b4b8, 0x2f4f8b, 0x9a3a3a];
const TROUSERS = [0x24262e, 0x3b3f47, 0x4a4038, 0x1d2126, 0x2c3440];
const SKINS = [0xc99a74, 0xa87a54, 0x8a5f3f, 0xe0b48f, 0x6f4a30];

function getThree() {
  const THREE = globalThis.THREE;
  if (!THREE) throw new Error('peds.js needs the global THREE from three.min.js');
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

function pushOut(world, radius, point) {
  const colliders = world && Array.isArray(world.colliders) ? world.colliders : [];
  for (let index = 0; index < colliders.length; index += 1) {
    const volume = colliders[index];
    const min = volume && volume.min;
    const max = volume && volume.max;
    if (!min || !max) continue;
    if (max.y !== undefined && max.y < 0.7) continue;
    const nearestX = clamp(point.x, min.x, max.x);
    const nearestZ = clamp(point.z, min.z, max.z);
    const dx = point.x - nearestX;
    const dz = point.z - nearestZ;
    const distanceSq = dx * dx + dz * dz;
    if (distanceSq >= radius * radius) continue;
    if (distanceSq > 0.000001) {
      const distance = Math.sqrt(distanceSq);
      const depth = radius - distance;
      point.x += (dx / distance) * depth;
      point.z += (dz / distance) * depth;
    } else {
      const left = point.x - min.x;
      const right = max.x - point.x;
      const back = point.z - min.z;
      const front = max.z - point.z;
      const smallest = Math.min(left, right, back, front);
      if (smallest === left) point.x = min.x - radius;
      else if (smallest === right) point.x = max.x + radius;
      else if (smallest === back) point.z = min.z - radius;
      else point.z = max.z + radius;
    }
  }
}

function buildPed(THREE, shirt, trousers, skin) {
  const group = new THREE.Group();
  const shirtMaterial = new THREE.MeshStandardMaterial({ color: shirt, roughness: 0.9 });
  const trouserMaterial = new THREE.MeshStandardMaterial({ color: trousers, roughness: 0.92 });
  const skinMaterial = new THREE.MeshStandardMaterial({ color: skin, roughness: 0.85 });
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.62, 0.3), shirtMaterial);
  torso.position.y = 1.18;
  group.add(torso);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.28, 0.26), skinMaterial);
  head.position.y = 1.62;
  group.add(head);
  const limbs = [];
  for (const side of [-1, 1]) {
    const legGroup = new THREE.Group();
    legGroup.position.set(side * 0.12, 0.88, 0);
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.8, 0.19), trouserMaterial);
    leg.position.y = -0.4;
    legGroup.add(leg);
    group.add(legGroup);
    limbs.push(legGroup);
    const armGroup = new THREE.Group();
    armGroup.position.set(side * 0.32, 1.42, 0);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.56, 0.15), shirtMaterial);
    arm.position.y = -0.26;
    armGroup.add(arm);
    group.add(armGroup);
    limbs.push(armGroup);
  }
  group.traverse((child) => {
    if (child.isMesh) child.castShadow = true;
  });
  return { group, legs: [limbs[0], limbs[2]], arms: [limbs[1], limbs[3]] };
}

export function createPeds(scene, world, rng) {
  const THREE = getThree();
  const random = typeof rng === 'function' ? rng : fallbackRandom(0x9ed5);
  const pick = (list) => list[Math.floor(random() * list.length) % list.length];
  const sidewalks = world && Array.isArray(world.sidewalks) ? world.sidewalks : [];
  const peds = [];

  function randomBeat() {
    if (sidewalks.length > 0) {
      const block = pick(sidewalks);
      const min = block && block.min;
      const max = block && block.max;
      if (min && max) {
        const inset = 1.6;
        return {
          x: min.x + inset + random() * Math.max(0.5, max.x - min.x - inset * 2),
          z: min.z + inset + random() * Math.max(0.5, max.z - min.z - inset * 2),
          y: 0.02,
        };
      }
    }
    const angle = random() * Math.PI * 2;
    const radius = 24 + random() * 120;
    return { x: Math.cos(angle) * radius, z: Math.sin(angle) * radius, y: 0.02 };
  }

  function makePed(index) {
    const look = buildPed(THREE, pick(SHIRTS), pick(TROUSERS), pick(SKINS));
    const at = randomBeat();
    look.group.position.set(at.x, at.y, at.z);
    scene.add(look.group);
    const entity = {
      group: look.group,
      mesh: look.group,
      legs: look.legs,
      arms: look.arms,
      health: 100,
      hp: 100,
      dead: false,
      alive: true,
      killed: false,
      radius: 0.55,
      height: 1.8,
      yaw: random() * Math.PI * 2,
      speed: WALK_SPEED * (0.8 + random() * 0.5),
      phase: random() * Math.PI * 2,
      stride: 3.4 + random() * 1.2,
      beatAngle: random() * Math.PI * 2,
      beatTimer: 3 + random() * 8,
      fleeTimer: 0,
      threatX: 0,
      threatZ: 0,
      down: false,
      seat: index,
    };
    look.group.rotation.y = entity.yaw;
    peds.push(entity);
    return entity;
  }

  for (let index = 0; index < PED_COUNT; index += 1) makePed(index);

  function flee(x, z, radius) {
    const reach = typeof radius === 'number' ? radius : 40;
    for (let index = 0; index < peds.length; index += 1) {
      const ped = peds[index];
      if (ped.dead) continue;
      const distance = Math.hypot(ped.group.position.x - x, ped.group.position.z - z);
      if (distance > reach) continue;
      ped.fleeTimer = SCATTER_TIME * (0.6 + random() * 0.7);
      ped.threatX = x;
      ped.threatZ = z;
      ped.beatTimer = 0;
    }
  }

  function calm() {
    for (let index = 0; index < peds.length; index += 1) {
      peds[index].fleeTimer = 0;
      peds[index].beatTimer = 0.2;
    }
  }

  function update(dt) {
    const step = typeof dt === 'number' && dt > 0 ? Math.min(dt, 0.1) : 0;
    if (step <= 0) return;
    for (let index = 0; index < peds.length; index += 1) {
      const ped = peds[index];
      if (ped.dead) continue;
      let speed;
      let dirX;
      let dirZ;
      if (ped.fleeTimer > 0) {
        ped.fleeTimer = Math.max(0, ped.fleeTimer - step);
        let dx = ped.group.position.x - ped.threatX;
        let dz = ped.group.position.z - ped.threatZ;
        let length = Math.hypot(dx, dz);
        if (length < 0.001) {
          dx = Math.cos(ped.phase);
          dz = Math.sin(ped.phase);
          length = 1;
        }
        dirX = dx / length;
        dirZ = dz / length;
        speed = RUN_SPEED;
        ped.yaw = Math.atan2(dirX, dirZ);
      } else {
        ped.beatAngle += (random() < 0.02 ? (random() - 0.5) * 1.4 : 0) * step * 60;
        ped.beatTimer -= step;
        if (ped.beatTimer <= 0) {
          ped.beatTimer = 4 + random() * 9;
          ped.beatAngle = random() * Math.PI * 2;
        }
        dirX = Math.sin(ped.beatAngle);
        dirZ = Math.cos(ped.beatAngle);
        speed = ped.speed;
        ped.yaw = ped.beatAngle;
      }
      const nextX = ped.group.position.x + dirX * speed * step;
      const nextZ = ped.group.position.z + dirZ * speed * step;
      const at = { x: nextX, y: 0, z: nextZ };
      pushOut(world, 0.55, at);
      ped.group.position.x = clamp(at.x, -246, 246);
      ped.group.position.z = clamp(at.z, -246, 246);
      if (Math.abs(at.x - nextX) > 0.001 || Math.abs(at.z - nextZ) > 0.001) {
        ped.beatAngle += Math.PI * (0.6 + random() * 0.8);
        ped.fleeTimer = 0;
      }
      ped.phase += step * (2.4 + speed * 1.7);
      const swing = Math.sin(ped.phase) * Math.min(0.75, speed * 0.13);
      ped.legs[0].rotation.x = swing;
      ped.legs[1].rotation.x = -swing;
      ped.arms[0].rotation.x = -swing * 0.8;
      ped.arms[1].rotation.x = swing * 0.8;
      ped.group.position.y = 0.02 + Math.abs(Math.sin(ped.phase)) * 0.05;
      ped.group.rotation.y = ped.yaw;
    }
  }

  return { peds, pedestrians: peds, update, flee, calm };
}
