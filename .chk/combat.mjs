// The pistol and the damage model around it. A shot is instant: the trigger (left mouse, rate
// limited) throws one ray from the camera and the nearest ped, cop or car along it takes the hit.
// That frame shows the muzzle flash, a tracer that fades, a spinning shell and blood or sparks at
// the point of impact. Player damage goes through armour first, pulses a red vignette and shakes
// the camera; at zero health the player is marked dead with the cash loss applied, ready for main.js
// to show the wasted screen and respawn at Port Vireo General. Ammo and health packs float over the
// road grid and come back a while after they are taken. Every random choice comes from a seeded
// generator, never Math.random.
const FIRE_INTERVAL = 0.2;
const RANGE = 90;
const START_AMMO = 36;
const MAX_AMMO = 60;
const PED_DAMAGE = 52;
const COP_DAMAGE = 46;
const CAR_DAMAGE = 24;
const PICKUP_RADIUS = 2.1;
const AMMO_RESPAWN = 20;
const HEALTH_RESPAWN = 30;
const PICKUP_COUNT = 12;
const TRACER_COUNT = 10;
const TRACER_LIFE = 0.12;
const SHELL_COUNT = 8;
const BLOOD_COUNT = 64;
const SPARK_COUNT = 48;
const HOSPITAL = { x: -88, z: 0 };
const DEATH_CASH_LOSS = 0.1;
const CORPSE_TIME = 9;

/** mulberry32, the same generator the rest of the game uses: no Math.random anywhere below. */
function seededRandom(seed) {
  let a = seed | 0;
  return function random() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function getThree() {
  const THREE = globalThis.THREE;
  if (!THREE) throw new Error('combat.js needs the global THREE from three.min.js');
  return THREE;
}

function clamp(value, min, max) {
  return value < min ? min : value > max ? max : value;
}

function writeField(target, key, value) {
  if (!target) return;
  try {
    target[key] = value;
  } catch {
    // A getter-only field belongs to another module: leave its own state alone.
  }
}

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

/** Walk every list a peds or police module might expose and hand each entity to `visit`. */
function collectEntities(source, visit) {
  if (!source) return;
  if (Array.isArray(source)) {
    for (let index = 0; index < source.length; index += 1) visit(source[index]);
    return;
  }
  const keys = ['peds', 'pedestrians', 'people', 'crowd', 'agents', 'all', 'cops', 'police', 'units', 'officers', 'entries', 'list'];
  for (let index = 0; index < keys.length; index += 1) {
    const value = source[keys[index]];
    if (Array.isArray(value)) {
      for (let item = 0; item < value.length; item += 1) visit(value[item]);
    }
  }
}

function isEntityDead(entity) {
  if (!entity) return true;
  if (entity.dead === true || entity.alive === false || entity.killed === true) return true;
  const health = typeof entity.health === 'number' ? entity.health : typeof entity.hp === 'number' ? entity.hp : null;
  return health !== null && health <= 0;
}

function entityRadius(entity, fallback) {
  if (typeof entity.radius === 'number') return entity.radius;
  if (typeof entity.hitRadius === 'number') return entity.hitRadius;
  return fallback;
}

/** A ray against a sphere, returning the distance to the near side or -1. */
function raySphere(ox, oy, oz, dx, dy, dz, cx, cy, cz, radius) {
  const lx = cx - ox;
  const ly = cy - oy;
  const lz = cz - oz;
  const along = lx * dx + ly * dy + lz * dz;
  if (along <= 0 || along > RANGE + radius) return -1;
  const px = ox + dx * along;
  const py = oy + dy * along;
  const pz = oz + dz * along;
  const offsetX = px - cx;
  const offsetY = py - cy;
  const offsetZ = pz - cz;
  const squared = offsetX * offsetX + offsetY * offsetY + offsetZ * offsetZ;
  if (squared > radius * radius) return -1;
  const entry = along - Math.sqrt(radius * radius - squared);
  return entry < 0 ? 0 : entry;
}

/** One floating pickup icon: a glowing ring, a cross or a bullet box that bobs and turns. */
function makePickupIcon(THREE, kind) {
  const group = new THREE.Group();
  const ringMaterial = new THREE.MeshBasicMaterial({ color: kind === 'health' ? 0x7dffb0 : 0xffd062, transparent: true, opacity: 0.55, side: THREE.DoubleSide });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.055, 6, 18), ringMaterial);
  ring.rotation.x = Math.PI / 2;
  group.add(ring);
  if (kind === 'health') {
    const bodyMaterial = new THREE.MeshStandardMaterial({ color: 0xf2f6f4, emissive: 0x9fffc4, emissiveIntensity: 1.1, roughness: 0.4 });
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.24, 0.4), bodyMaterial);
    box.position.y = 0.55;
    group.add(box);
    const crossA = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.08, 0.14), new THREE.MeshBasicMaterial({ color: 0x1f8a4c }));
    crossA.position.set(0, 0.7, 0);
    group.add(crossA);
    const crossB = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.08, 0.34), new THREE.MeshBasicMaterial({ color: 0x1f8a4c }));
    crossB.position.set(0, 0.7, 0);
    group.add(crossB);
  } else {
    const boxMaterial = new THREE.MeshStandardMaterial({ color: 0x6b5320, emissive: 0xffb43c, emissiveIntensity: 0.7, roughness: 0.55 });
    const caseMesh = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.28, 0.36), boxMaterial);
    caseMesh.position.y = 0.55;
    group.add(caseMesh);
    for (let index = -1; index <= 1; index += 1) {
      const bullet = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.22, 6), new THREE.MeshStandardMaterial({ color: 0xffd777, emissive: 0xffb020, emissiveIntensity: 0.9, metalness: 0.6, roughness: 0.3 }));
      bullet.position.set(index * 0.13, 0.82, 0);
      group.add(bullet);
    }
  }
  return group;
}

export function createCombat(scene, camera, player, world, peds, police, vehicles, hud, audio) {
  const THREE = getThree();
  const random = seededRandom(0x51c0de);
  const api = {
    weapon: 'Pistol',
    onKill: null,
    onDamage: null,
    get ammo() {
      return ammo;
    },
    set ammo(value) {
      ammo = clamp(Math.round(Number(value) || 0), 0, MAX_AMMO);
      syncAmmo();
    },
    get dead() {
      return dead;
    },
    get health() {
      return readHealth();
    },
    get armour() {
      return readArmour();
    },
    update,
    fire,
    damage,
    revive,
    addPickups,
  };

  let time = 0;
  let lastShot = -FIRE_INTERVAL;
  let ammo = START_AMMO;
  let dead = false;
  let wanted = 0;
  let internalHealth = 100;
  let internalArmour = 0;
  let lastHudAmmo = -1;
  let recoil = 0;
  let shake = 0;
  let vignette = 0;
  let flashLife = 0;
  let hitMarkerLife = 0;
  let tracerCursor = 0;
  let shellCursor = 0;
  let bloodCursor = 0;
  let sparkCursor = 0;
  let lastCamera = null;
  const shakeStart = { x: 0, y: 0, z: 0, rx: 0, ry: 0 };
  const shakeEnd = { x: 0, y: 0, z: 0, rx: 0, ry: 0 };

  const tmpDirection = new THREE.Vector3();
  const tmpOrigin = new THREE.Vector3();
  const tmpRight = new THREE.Vector3();
  const tmpUp = new THREE.Vector3();
  const tmpPoint = new THREE.Vector3();
  const tmpMatrix = new THREE.Matrix4();
  const forward = new THREE.Vector3(0, 0, -1);

  // The red damage pulse: a DOM layer over the canvas, created here so no other file has to know
  // about it. It is pointer transparent and fades back to nothing in update.
  let vignetteElement = null;
  if (typeof document !== 'undefined' && document.body) {
    vignetteElement = document.createElement('div');
    vignetteElement.style.cssText =
      'position:fixed;inset:0;pointer-events:none;z-index:28;opacity:0;background:radial-gradient(ellipse at center, rgba(140,0,0,0) 40%, rgba(150,0,0,0.58) 100%);transition:opacity 60ms linear;';
    document.body.appendChild(vignetteElement);
  }

  function findCamera() {
    if (camera && camera.isCamera) return camera;
    if (scene && scene.userData && scene.userData.camera && scene.userData.camera.isCamera) return scene.userData.camera;
    if (globalThis.gameCamera && globalThis.gameCamera.isCamera) return globalThis.gameCamera;
    if (scene && Array.isArray(scene.children)) {
      for (let index = 0; index < scene.children.length; index += 1) {
        if (scene.children[index] && scene.children[index].isCamera) return scene.children[index];
      }
    }
    return null;
  }

  function playerPoint() {
    return pointOf(player) || { x: 0, y: 0, z: 0 };
  }

  function readHealth() {
    if (player) {
      if (typeof player.health === 'number') return player.health;
      if (typeof player.hp === 'number') return player.hp;
    }
    return internalHealth;
  }

  function writeHealth(value) {
    internalHealth = clamp(value, 0, 100);
    if (player) {
      if (player.health === undefined || typeof player.health === 'number') writeField(player, 'health', internalHealth);
      if (typeof player.hp === 'number') writeField(player, 'hp', internalHealth);
    }
  }

  function readArmour() {
    if (player) {
      if (typeof player.armour === 'number') return player.armour;
      if (typeof player.armor === 'number') return player.armor;
    }
    return internalArmour;
  }

  function writeArmour(value) {
    internalArmour = clamp(value, 0, 100);
    if (player) {
      if (player.armour === undefined || typeof player.armour === 'number') writeField(player, 'armour', internalArmour);
      if (typeof player.armor === 'number') writeField(player, 'armor', internalArmour);
    }
  }

  function readMoney() {
    if (player) {
      if (typeof player.money === 'number') return player.money;
      if (typeof player.cash === 'number') return player.cash;
    }
    if (hud && typeof hud.money === 'number') return hud.money;
    return 0;
  }

  function writeMoney(value) {
    const next = Math.max(0, Math.round(value));
    if (player) {
      if (player.money === undefined || typeof player.money === 'number') writeField(player, 'money', next);
      if (typeof player.cash === 'number') writeField(player, 'cash', next);
    }
    if (hud) {
      if (hud.money === undefined || typeof hud.money === 'number') hud.money = next;
      else writeField(hud, 'money', next);
    }
  }

  function readWanted() {
    if (police) {
      if (typeof police.wanted === 'number') return police.wanted;
      if (typeof police.stars === 'number') return police.stars;
      if (typeof police.level === 'number') return police.level;
    }
    if (player && typeof player.wanted === 'number') return player.wanted;
    return wanted;
  }

  function pushWanted(value) {
    const next = clamp(Math.round(value), 0, 5);
    wanted = next;
    if (police) {
      try {
        if (typeof police.setWanted === 'function') police.setWanted(next);
        else if (typeof police.raiseWanted === 'function') police.raiseWanted(next - readWanted());
        writeField(police, 'wanted', next);
        writeField(police, 'stars', next);
      } catch {
        // Keep the local count if the police module is not ready yet.
      }
    }
    if (player) writeField(player, 'wanted', next);
    if (hud && typeof hud.setWanted === 'function') hud.setWanted(next);
  }

  function raiseWanted(amount) {
    const current = readWanted();
    const next = clamp(current + amount, 0, 5);
    if (next === current) return;
    pushWanted(next);
  }

  function syncAmmo() {
    if (player) {
      writeField(player, 'ammo', ammo);
      writeField(player, 'weapon', 'Pistol');
    }
    if (ammo === lastHudAmmo) return;
    lastHudAmmo = ammo;
    if (!hud) return;
    if (typeof hud.setWeapon === 'function') hud.setWeapon('Pistol', ammo);
    else if (typeof hud.setAmmo === 'function') hud.setAmmo(ammo);
  }

  function makeFlashTexture() {
    if (typeof document === 'undefined') return null;
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const context = canvas.getContext('2d');
    if (!context) return null;
    const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32);
    gradient.addColorStop(0, 'rgba(255,255,235,1)');
    gradient.addColorStop(0.24, 'rgba(255,214,120,0.95)');
    gradient.addColorStop(0.55, 'rgba(255,140,40,0.5)');
    gradient.addColorStop(1, 'rgba(255,80,0,0)');
    context.fillStyle = gradient;
    context.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(canvas);
  }

  const flashMaterial = new THREE.SpriteMaterial({
    map: makeFlashTexture(),
    color: 0xffd9a2,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const flash = new THREE.Sprite(flashMaterial);
  flash.scale.set(0.9, 0.9, 0.9);
  flash.visible = false;
  scene.add(flash);

  const tracerMaterial = new THREE.LineBasicMaterial({ color: 0xffe7b0, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
  const tracers = [];
  for (let index = 0; index < TRACER_COUNT; index += 1) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0], 3));
    const line = new THREE.Line(geometry, tracerMaterial.clone());
    line.visible = false;
    line.frustumCulled = false;
    scene.add(line);
    tracers.push({ line, life: 0, max: TRACER_LIFE });
  }

  const shellGeometry = new THREE.CylinderGeometry(0.035, 0.035, 0.12, 5);
  const shellMaterial = new THREE.MeshStandardMaterial({ color: 0xd9b25a, metalness: 0.75, roughness: 0.35 });
  const shells = [];
  for (let index = 0; index < SHELL_COUNT; index += 1) {
    const mesh = new THREE.Mesh(shellGeometry, shellMaterial);
    mesh.visible = false;
    scene.add(mesh);
    shells.push({ mesh, life: 0, vx: 0, vy: 0, vz: 0, spinX: 0, spinZ: 0 });
  }

  function makeParticlePool(count, color, size) {
    const pool = [];
    const geometry = new THREE.SphereGeometry(size, 4, 3);
    for (let index = 0; index < count; index += 1) {
      const material = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, depthWrite: false });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.visible = false;
      scene.add(mesh);
      pool.push({ mesh, material, life: 0, vx: 0, vy: 0, vz: 0, gravity: 0 });
    }
    return pool;
  }

  const blood = makeParticlePool(BLOOD_COUNT, 0x8e1010, 0.09);
  const sparks = makeParticlePool(SPARK_COUNT, 0xffc466, 0.07);

  function spawnParticles(pool, cursorName, x, y, z, count, speed, gravity, spread) {
    let cursor = cursorName === 'blood' ? bloodCursor : sparkCursor;
    for (let index = 0; index < count; index += 1) {
      const particle = pool[cursor % pool.length];
      cursor += 1;
      particle.life = 1;
      particle.vy = (0.4 + random() * 0.8) * speed;
      particle.vx = (random() - 0.5) * spread;
      particle.vz = (random() - 0.5) * spread;
      particle.gravity = gravity;
      particle.mesh.visible = true;
      particle.mesh.position.set(x + (random() - 0.5) * 0.16, y + (random() - 0.5) * 0.16, z + (random() - 0.5) * 0.16);
      particle.mesh.scale.setScalar(0.6 + random() * 0.9);
      particle.material.opacity = 0.95;
    }
    if (cursorName === 'blood') bloodCursor = cursor;
    else sparkCursor = cursor;
  }

  function updateParticles(pool, dt) {
    for (let index = 0; index < pool.length; index += 1) {
      const particle = pool[index];
      if (particle.life <= 0) continue;
      particle.life -= dt * 1.6;
      if (particle.life <= 0) {
        particle.life = 0;
        particle.mesh.visible = false;
        particle.material.opacity = 0;
        continue;
      }
      particle.vy -= particle.gravity * dt;
      particle.mesh.position.x += particle.vx * dt;
      particle.mesh.position.y += particle.vy * dt;
      particle.mesh.position.z += particle.vz * dt;
      if (particle.mesh.position.y < 0.04) {
        particle.mesh.position.y = 0.04;
        particle.vy *= -0.3;
        particle.vx *= 0.6;
        particle.vz *= 0.6;
      }
      particle.material.opacity = particle.life * 0.9;
    }
  }

  // ---- pickups ------------------------------------------------------------------------------

  const pickups = [];
  const roadSpots = [];
  const roads = world && Array.isArray(world.roads) ? world.roads : [];
  for (let index = 0; index < roads.length; index += 1) {
    const road = roads[index];
    if (!road || typeof road.x !== 'number' || typeof road.z !== 'number') continue;
    roadSpots.push(road);
  }

  function placePickup(pickup) {
    const half = world && typeof world.size === 'number' ? world.size / 2 : 264;
    for (let attempt = 0; attempt < 14; attempt += 1) {
      if (roadSpots.length > 0) {
        const road = roadSpots[Math.floor(random() * roadSpots.length) % roadSpots.length];
        const along = (random() * 2 - 1) * (half - 26);
        const offset = (random() * 2 - 1) * 4.2;
        const x = road.axis === 'x' ? along : road.x + offset;
        const z = road.axis === 'x' ? road.z + offset : along;
        if (Math.abs(x) < 22 && Math.abs(z) < 22 && attempt < 10) continue;
        pickup.x = x;
        pickup.z = z;
        pickup.group.position.set(x, 0.2, z);
        return;
      }
      const x = (random() * 2 - 1) * (half - 24);
      const z = (random() * 2 - 1) * (half - 24);
      if (Math.abs(x) < 26 && Math.abs(z) < 26 && attempt < 10) continue;
      pickup.x = x;
      pickup.z = z;
      pickup.group.position.set(x, 0.2, z);
      return;
    }
    pickup.x = 0;
    pickup.z = 0;
  }

  function addPickups(countable) {
    const total = typeof countable === 'number' ? countable : PICKUP_COUNT;
    for (let index = 0; index < total; index += 1) {
      const kind = index % 3 === 2 ? 'health' : 'ammo';
      const group = makePickupIcon(THREE, kind);
      group.visible = false;
      scene.add(group);
      const pickup = {
        kind,
        group,
        x: 0,
        z: 0,
        active: false,
        timer: random() * 3,
        period: kind === 'health' ? HEALTH_RESPAWN : AMMO_RESPAWN,
        phase: random() * Math.PI * 2,
      };
      placePickup(pickup);
      pickups.push(pickup);
      pickup.timer = 0;
      pickup.active = true;
      group.visible = true;
    }
  }

  addPickups(PICKUP_COUNT);

  function updatePickups(dt) {
    const point = playerPoint();
    for (let index = 0; index < pickups.length; index += 1) {
      const pickup = pickups[index];
      if (!pickup.active) {
        pickup.timer -= dt;
        if (pickup.timer <= 0) {
          placePickup(pickup);
          pickup.active = true;
          pickup.group.visible = true;
        }
        continue;
      }
      pickup.phase += dt * 1.6;
      pickup.group.rotation.y += dt * 1.4;
      pickup.group.position.y = 0.2 + Math.sin(pickup.phase) * 0.11;
      const distance = Math.hypot(pickup.x - point.x, pickup.z - point.z);
      if (distance > PICKUP_RADIUS) continue;
      const picked = pickup.kind === 'health' ? takeHealth() : takeAmmo();
      if (!picked) continue;
      pickup.active = false;
      pickup.timer = pickup.period;
      pickup.group.visible = false;
      if (audio && typeof audio.ui === 'function') audio.ui();
    }
  }

  function takeAmmo() {
    if (ammo >= MAX_AMMO) return false;
    ammo = clamp(ammo + 12, 0, MAX_AMMO);
    syncAmmo();
    return true;
  }

  function takeHealth() {
    if (readHealth() >= 100) return false;
    writeHealth(readHealth() + 35);
    return true;
  }

  // ---- targets ------------------------------------------------------------------------------

  const cops = [];
  const pedestrians = [];
  const targets = [];

  function gather() {
    pedestrians.length = 0;
    cops.length = 0;
    collectEntities(peds, (entity) => {
      if (entity) pedestrians.push(entity);
    });
    collectEntities(police, (entity) => {
      if (entity && pedestrians.indexOf(entity) === -1) cops.push(entity);
    });
  }

  function raycastTargets(origin, direction) {
    gather();
    let bestDistance = Infinity;
    let bestKind = null;
    let bestEntity = null;
    let bestPoint = null;
    const lists = [
      [pedestrians, 'ped'],
      [cops, 'cop'],
    ];
    for (let list = 0; list < lists.length; list += 1) {
      const entities = lists[list][0];
      const kind = lists[list][1];
      for (let index = 0; index < entities.length; index += 1) {
        const entity = entities[index];
        if (!entity || isEntityDead(entity)) continue;
        const point = pointOf(entity);
        if (!point) continue;
        const radius = entityRadius(entity, kind === 'cop' ? 0.62 : 0.55);
        const distance = raySphere(origin.x, origin.y, origin.z, direction.x, direction.y, direction.z, point.x, point.y + (typeof entity.height === 'number' ? entity.height / 2 : 0.9), point.z, radius);
        if (distance < 0 || distance >= bestDistance) continue;
        bestDistance = distance;
        bestKind = kind;
        bestEntity = entity;
        bestPoint = point;
      }
    }
    const list = vehicles && Array.isArray(vehicles.cars) ? vehicles.cars : Array.isArray(vehicles) ? vehicles : [];
    for (let index = 0; index < list.length; index += 1) {
      const car = list[index];
      if (!car || car === (vehicles && vehicles.driving)) continue;
      const x = typeof car.x === 'number' ? car.x : car.group ? car.group.position.x : null;
      const z = typeof car.z === 'number' ? car.z : car.group ? car.group.position.z : null;
      if (x === null || z === null) continue;
      const distance = raySphere(origin.x, origin.y, origin.z, direction.x, direction.y, direction.z, x, 0.85, z, 1.7);
      if (distance < 0 || distance >= bestDistance) continue;
      bestDistance = distance;
      bestKind = 'car';
      bestEntity = car;
      bestPoint = { x, y: 0.85, z };
    }
    if (bestKind === null) return null;
    tmpPoint.set(origin.x + direction.x * bestDistance, origin.y + direction.y * bestDistance, origin.z + direction.z * bestDistance);
    return { kind: bestKind, entity: bestEntity, point: bestPoint, distance: bestDistance, hit: tmpPoint.clone() };
  }

  function aimDirection(origin) {
    const active = findCamera();
    if (active) {
      active.updateMatrixWorld();
      tmpMatrix.extractRotation(active.matrixWorld);
      tmpDirection.copy(forward).applyMatrix4(tmpMatrix).normalize();
      tmpOrigin.set(active.position.x, active.position.y, active.position.z);
      const aim = tmpDirection;
      const startX = tmpOrigin.x;
      const startY = tmpOrigin.y;
      const startZ = tmpOrigin.z;
      const playerAt = playerPoint();
      const shift = Math.min(6, Math.hypot(playerAt.x - startX, playerAt.z - startZ));
      origin.set(startX + aim.x * Math.max(0, shift - 1.2), startY + aim.y * Math.max(0, shift - 1.2) - 0.12, startZ + aim.z * Math.max(0, shift - 1.2));
      return aim;
    }
    const point = playerPoint();
    const yaw = player && typeof player.yaw === 'number' ? player.yaw : 0;
    const pitch = player && typeof player.pitch === 'number' ? player.pitch : 0;
    origin.set(point.x, point.y + 1.55, point.z);
    aim.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)).normalize();
    return aim;
  }

  function markHitMarker() {
    hitMarkerLife = 0.18;
    if (hud && typeof hud.hitMarker === 'function') hud.hitMarker(0.18);
  }

  function damageEntity(hit) {
    const entity = hit.entity;
    const point = hit.point;
    if (hit.kind === 'car') {
      const car = entity;
      if (typeof car.health !== 'number') car.health = 100;
      car.health = Math.max(0, car.health - CAR_DAMAGE);
      if (car.health <= 0) {
        if (car.group && car.group.userData) car.group.userData.wrecked = true;
        writeField(car, 'wrecked', true);
      }
      spawnParticles(sparks, 'spark', point.x, point.y + 0.4, point.z, 7, 2.4, 7, 2.6);
      if (audio && typeof audio.impact === 'function') audio.impact();
      markHitMarker();
      return 'car';
    }
    const current = typeof entity.health === 'number' ? entity.health : typeof entity.hp === 'number' ? entity.hp : 100;
    const next = Math.max(0, current - (hit.kind === 'cop' ? COP_DAMAGE : PED_DAMAGE));
    if (typeof entity.health === 'number' || entity.health === undefined) writeField(entity, 'health', next);
    if (typeof entity.hp === 'number') writeField(entity, 'hp', next);
    if (typeof entity.health !== 'number' && typeof entity.hp !== 'number') writeField(entity, 'health', next);
    spawnParticles(blood, 'blood', point.x, point.y + 0.7, point.z, 9, 2.0, 9, 2.2);
    if (typeof entity.hit === 'function') {
      try {
        entity.hit(next);
      } catch {
        // The ped module may implement hit() with a different signature: the field writes stand.
      }
    }
    if (audio && typeof audio.impact === 'function') audio.impact();
    markHitMarker();
    if (next > 0) return hit.kind;
    killEntity(entity, hit.kind);
    return hit.kind;
  }

  function killEntity(entity, kind) {
    writeField(entity, 'dead', true);
    writeField(entity, 'alive', false);
    if (typeof entity.health === 'number' || typeof entity.hp !== 'number') writeField(entity, 'health', 0);
    if (typeof entity.hp === 'number') writeField(entity, 'hp', 0);
    if (typeof entity.die === 'function') {
      try {
        entity.die();
      } catch {
        // The entity's own death hook is optional.
      }
    }
    const group = objectOf(entity);
    if (group) {
      if (!entity.deathTime) entity.deathTime = time;
    }
    raiseWanted(kind === 'cop' ? 3 : 1);
    if (typeof api.onKill === 'function') api.onKill(entity, kind, entity.deathTime || time);
  }

  function updateCorpses() {
    gather();
    const all = cops.concat(pedestrians);
    for (let index = 0; index < all.length; index += 1) {
      const entity = all[index];
      if (!entity || isEntityDead(entity) === false) continue;
      const group = objectOf(entity);
      if (!group) continue;
      if (!entity.deathTime) entity.deathTime = time;
      const age = time - entity.deathTime;
      if (age > CORPSE_TIME) {
        group.visible = false;
        continue;
      }
      group.rotation.z = Math.min(1.45, Math.min(1, age * 2.2) * 1.45);
    }
  }

  function fire() {
    if (dead) return false;
    if (time - lastShot < FIRE_INTERVAL) return false;
    if (ammo <= 0) {
      if (audio && typeof audio.ui === 'function') audio.ui();
      return false;
    }
    const active = findCamera();
    tmpOrigin.set(0, 0, 0);
    const aim = aimDirection(tmpOrigin);
    lastShot = time;
    ammo -= 1;
    syncAmmo();
    recoil = Math.min(1.6, recoil + 0.9);
    shake = Math.min(0.5, shake + 0.12);
    flashLife = 0.06;
    if (audio && typeof audio.shot === 'function') audio.shot();

    const hit = raycastTargets(tmpOrigin, aim);
    const endX = hit ? hit.hit.x : tmpOrigin.x + aim.x * RANGE;
    const endY = hit ? hit.hit.y : tmpOrigin.y + aim.y * RANGE;
    const endZ = hit ? hit.hit.z : tmpOrigin.z + aim.z * RANGE;

    flash.visible = true;
    flash.position.set(tmpOrigin.x + aim.x * 0.7, tmpOrigin.y + aim.y * 0.7 - 0.16, tmpOrigin.z + aim.z * 0.7);
    flashMaterial.opacity = 1;

    const tracer = tracers[tracerCursor % tracers.length];
    tracerCursor += 1;
    const positions = tracer.line.geometry.getAttribute('position');
    positions.setXYZ(0, tmpOrigin.x + aim.x * 0.9, tmpOrigin.y + aim.y * 0.9 - 0.1, tmpOrigin.z + aim.z * 0.9);
    positions.setXYZ(1, endX, endY, endZ);
    positions.needsUpdate = true;
    tracer.line.geometry.computeBoundingSphere();
    tracer.life = TRACER_LIFE;
    tracer.line.material.opacity = 0.85;
    tracer.line.visible = true;

    const shell = shells[shellCursor % shells.length];
    shellCursor += 1;
    tmpRight.set(1, 0, 0).applyQuaternion(active ? active.quaternion : new THREE.Quaternion());
    tmpUp.set(0, 1, 0).applyQuaternion(active ? active.quaternion : new THREE.Quaternion());
    shell.mesh.visible = true;
    shell.mesh.position.set(tmpOrigin.x + tmpRight.x * 0.35 - tmpUp.y * 0.2, tmpOrigin.y + tmpUp.y * 0.2 - 0.28, tmpOrigin.z + tmpRight.z * 0.35 - tmpUp.y * 0.2);
    shell.vx = tmpRight.x * (1.6 + random() * 0.9) + (random() - 0.5) * 0.4;
    shell.vy = 1.6 + random() * 0.9;
    shell.vz = tmpRight.z * (1.6 + random() * 0.9) + (random() - 0.5) * 0.4;
    shell.spinX = (random() - 0.5) * 14;
    shell.spinZ = (random() - 0.5) * 14;
    shell.life = 1.1;

    if (hit) damageEntity(hit);
    return true;
  }

  // ---- player damage ------------------------------------------------------------------------

  function damage(amount, sourceX, sourceZ) {
    if (dead) return false;
    const value = Math.max(0, Number(amount) || 0);
    if (value <= 0) return false;
    let remaining = value;
    const armour = readArmour();
    if (armour > 0) {
      const absorbed = Math.min(armour, remaining);
      writeArmour(armour - absorbed);
      remaining -= absorbed;
    }
    if (remaining > 0) writeHealth(readHealth() - remaining);
    vignette = Math.min(1, vignette + 0.55 + value * 0.02);
    shake = Math.min(0.9, shake + 0.22 + value * 0.012);
    if (vignetteElement) vignetteElement.style.opacity = String(vignette.toFixed(2));
    if (typeof api.onDamage === 'function') api.onDamage(value, sourceX, sourceZ);
    if (readHealth() <= 0) die();
    return true;
  }

  function die() {
    dead = true;
    writeHealth(0);
    writeField(player, 'dead', true);
    if (player) writeField(player, 'deathCause', 'wasted');
    writeMoney(readMoney() * (1 - DEATH_CASH_LOSS));
    if (!api.deathPosition) api.deathPosition = { x: playerPoint().x, y: 0, z: playerPoint().z };
    if (hud && typeof hud.showBanner === 'function') hud.showBanner('WASTED', 'Waking up at Port Vireo General', 3200);
    if (audio && typeof audio.siren === 'function') audio.siren(false);
  }

  function revive() {
    dead = false;
    writeHealth(100);
    writeArmour(0);
    writeField(player, 'dead', false);
    api.deathPosition = null;
    const point = playerPoint();
    point.x = HOSPITAL.x;
    point.z = HOSPITAL.z;
    if (player && player.position && player.position !== point) {
      player.position.x = HOSPITAL.x;
      player.position.z = HOSPITAL.z;
    }
    if (player) {
      writeField(player, 'yaw', 0);
      writeField(player, 'vx', 0);
      writeField(player, 'vz', 0);
    }
    if (hud && typeof hud.showBanner === 'function') hud.showBanner('RELEASED', 'Port Vireo General - $' + Math.round(readMoney()), 2200);
    ammo = clamp(ammo + 12, 0, MAX_AMMO);
    syncAmmo();
  }

  function updateAccessories(dt) {
    if (flashLife > 0) {
      flashLife -= dt;
      flashMaterial.opacity = Math.max(0, flashLife / 0.06);
      if (flashLife <= 0) {
        flash.visible = false;
        flashMaterial.opacity = 0;
      }
    }
    for (let index = 0; index < tracers.length; index += 1) {
      const tracer = tracers[index];
      if (tracer.life <= 0) continue;
      tracer.life -= dt;
      if (tracer.life <= 0) {
        tracer.life = 0;
        tracer.line.visible = false;
        continue;
      }
      tracer.line.material.opacity = (tracer.life / tracer.max) * 0.85;
    }
    for (let index = 0; index < shells.length; index += 1) {
      const shell = shells[index];
      if (shell.life <= 0) continue;
      shell.life -= dt;
      if (shell.life <= 0) {
        shell.mesh.visible = false;
        continue;
      }
      shell.vy -= 20 * dt;
      shell.mesh.position.x += shell.vx * dt;
      shell.mesh.position.y += shell.vy * dt;
      shell.mesh.position.z += shell.vz * dt;
      shell.mesh.rotation.x += shell.spinX * dt;
      shell.mesh.rotation.z += shell.spinZ * dt;
      if (shell.mesh.position.y < 0.06) {
        shell.mesh.position.y = 0.06;
        shell.vy *= -0.35;
        shell.vx *= 0.6;
        shell.vz *= 0.6;
      }
    }
    updateParticles(blood, dt);
    updateParticles(sparks, dt);
    if (hitMarkerLife > 0) hitMarkerLife = Math.max(0, hitMarkerLife - dt);
  }

  function updateCameraFeel(dt) {
    const active = findCamera();
    if (active) {
      // Undo last frame's offsets only if nobody else has moved the camera since: the chase camera
      // writes its own position every frame, and taking our offset off that would drift.
      if (lastCamera && lastCamera === active) {
        if (Math.abs(active.position.x - shakeEnd.x) < 0.0005 && Math.abs(active.position.y - shakeEnd.y) < 0.0005 && Math.abs(active.position.z - shakeEnd.z) < 0.0005) {
          active.position.x = shakeStart.x;
          active.position.y = shakeStart.y;
          active.position.z = shakeStart.z;
        }
        if (Math.abs(active.rotation.x - shakeEnd.rx) < 0.0005 && Math.abs(active.rotation.y - shakeEnd.ry) < 0.0005) {
          active.rotation.x = shakeStart.rx;
          active.rotation.y = shakeStart.ry;
        }
      }
      shakeStart.x = active.position.x;
      shakeStart.y = active.position.y;
      shakeStart.z = active.position.z;
      shakeStart.rx = active.rotation.x;
      shakeStart.ry = active.rotation.y;
      recoil = Math.max(0, recoil - dt * 9);
      shake = Math.max(0, shake - dt * 2.4);
      let offsetX = 0;
      let offsetY = 0;
      let offsetZ = 0;
      let rotX = 0;
      let rotY = 0;
      if (recoil > 0.001) {
        rotX = recoil * 0.024;
        rotY = (random() - 0.5) * recoil * 0.006;
      }
      if (shake > 0.001) {
        offsetX = (random() - 0.5) * shake * 0.14;
        offsetY = (random() - 0.5) * shake * 0.12;
        offsetZ = (random() - 0.5) * shake * 0.14;
      }
      active.rotation.x += rotX;
      active.rotation.y += rotY;
      active.position.x += offsetX;
      active.position.y += offsetY;
      active.position.z += offsetZ;
      shakeEnd.x = active.position.x;
      shakeEnd.y = active.position.y;
      shakeEnd.z = active.position.z;
      shakeEnd.rx = active.rotation.x;
      shakeEnd.ry = active.rotation.y;
      lastCamera = active;
    }
    if (vignette > 0) {
      vignette = Math.max(0, vignette - dt * 1.7);
      if (vignetteElement) vignetteElement.style.opacity = vignette.toFixed(2);
    }
  }

  function update(dt) {
    time += dt;
    updateAccessories(dt);
    updatePickups(dt);
    updateCorpses();
    updateCameraFeel(dt);
    if (ammo !== lastHudAmmo) syncAmmo();
    if (dead && player) writeField(player, 'dead', true);
  }

  if (player) {
    if (typeof player.health !== 'number') writeField(player, 'health', 100);
    if (typeof player.armour !== 'number' && typeof player.armor !== 'number') writeField(player, 'armour', 0);
    if (typeof player.money !== 'number' && typeof player.cash !== 'number') writeField(player, 'money', 0);
    if (typeof player.wanted !== 'number') writeField(player, 'wanted', 0);
    if (typeof player.ammo !== 'number') writeField(player, 'ammo', ammo);
    if (typeof player.weapon !== 'string') writeField(player, 'weapon', 'Pistol');
  }
  syncAmmo();
  return api;
}
