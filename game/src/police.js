// The law. A wanted level drives a pool of patrol cars and the officers they drop: at one star a
// single cruiser tails you, at three or more they ram and the officers shoot. The level burns down
// on its own once nothing has raised it for a while, and the sirens only play while somebody is
// actually looking for the player. Cars come from vehicles.js so the whole fleet matches.
import { makeCar } from './vehicles.js';

const MAX_UNITS = 5;
const MAX_COPS = 5;
const COP_SPEED = 4.6;
const COP_FIRE_RANGE = 26;
const DECAY_SECONDS = 26;
const HUNT_RADIUS = 150;

function getThree() {
  const THREE = globalThis.THREE;
  if (!THREE) throw new Error('police.js needs the global THREE from three.min.js');
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

function pointOf(source) {
  if (!source) return null;
  if (source.isObject3D) return source.position;
  const candidate = source.mesh || source.object || source.group || source.root;
  if (candidate && candidate.isObject3D) return candidate.position;
  if (source.position && typeof source.position.x === 'number') return source.position;
  if (typeof source.x === 'number' && typeof source.z === 'number') return source;
  return null;
}

/** A police officer on foot: dark uniform, cap, a pistol, and a little shuffle when running. */
function buildCop(THREE) {
  const group = new THREE.Group();
  const uniform = new THREE.MeshStandardMaterial({ color: 0x1c2a44, roughness: 0.82 });
  const trim = new THREE.MeshStandardMaterial({ color: 0x0f1522, roughness: 0.9 });
  const skinMaterial = new THREE.MeshStandardMaterial({ color: 0xc99a74, roughness: 0.85 });
  const vest = new THREE.MeshStandardMaterial({ color: 0x10151f, roughness: 0.75 });
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.66, 0.34), uniform);
  torso.position.y = 1.2;
  group.add(torso);
  const plate = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 0.08), vest);
  plate.position.set(0, 1.25, 0.2);
  group.add(plate);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.27, 0.29, 0.27), skinMaterial);
  head.position.y = 1.66;
  group.add(head);
  const cap = new THREE.Mesh(new THREE.BoxGeometry(0.31, 0.09, 0.32), trim);
  cap.position.set(0, 1.83, 0.02);
  group.add(cap);
  const brim = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.04, 0.14), trim);
  brim.position.set(0, 1.79, 0.2);
  group.add(brim);
  const limbs = [];
  for (const side of [-1, 1]) {
    const legGroup = new THREE.Group();
    legGroup.position.set(side * 0.14, 0.9, 0);
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.84, 0.21), trim);
    leg.position.y = -0.42;
    legGroup.add(leg);
    group.add(legGroup);
    limbs.push(legGroup);
    const armGroup = new THREE.Group();
    armGroup.position.set(side * 0.35, 1.44, 0);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.58, 0.17), uniform);
    arm.position.y = -0.27;
    armGroup.add(arm);
    group.add(armGroup);
    limbs.push(armGroup);
  }
  group.traverse((child) => {
    if (child.isMesh) child.castShadow = true;
  });
  return { group, legs: [limbs[0], limbs[2]], arms: [limbs[1], limbs[3]] };
}

/** A burning wreck: a dark car, a fire sprite, smoke puffs and a scorched halo on the road. */
export function makeWreck(scene, x, z, yaw) {
  const THREE = getThree();
  const group = makeCar(0x2a2c30, 'sedan');
  group.position.set(x, 0, z);
  group.rotation.y = typeof yaw === 'number' ? yaw : 0;
  group.userData.body.material = new THREE.MeshStandardMaterial({ color: 0x1b1c1f, roughness: 0.95, metalness: 0.2 });
  group.userData.body.rotation.z = 0.06;
  group.scale.set(1, 0.92, 1);
  scene.add(group);

  const fireMaterial = new THREE.MeshBasicMaterial({ color: 0xff8a2a, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
  const flames = [];
  for (let index = 0; index < 7; index += 1) {
    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.3 + (index % 3) * 0.06, 1.2 + (index % 2) * 0.5, 5), fireMaterial.clone());
    flame.material.color.setHex(index % 2 === 0 ? 0xff9a30 : 0xffd06a);
    flame.position.set((index - 3) * 0.2, 0.95, 0.4 + (index % 2) * 0.3);
    flame.rotation.x = Math.PI;
    group.add(flame);
    flames.push(flame);
  }
  const smokeMaterial = new THREE.MeshBasicMaterial({ color: 0x2c2c30, transparent: true, opacity: 0.45, depthWrite: false });
  const puffs = [];
  for (let index = 0; index < 9; index += 1) {
    const puff = new THREE.Mesh(new THREE.SphereGeometry(0.6 + index * 0.12, 6, 5), smokeMaterial.clone());
    puff.position.set((index % 3 - 1) * 0.4, 1.8 + index * 0.8, 0.2);
    group.add(puff);
    puffs.push(puff);
  }
  const halo = new THREE.Mesh(
    new THREE.CircleGeometry(3.4, 20),
    new THREE.MeshBasicMaterial({ color: 0xff7a24, transparent: true, opacity: 0.24, depthWrite: false, blending: THREE.AdditiveBlending }),
  );
  halo.rotation.x = -Math.PI / 2;
  halo.position.y = 0.05;
  group.add(halo);
  const light = new THREE.PointLight(0xff7a24, 26, 18, 2);
  light.position.set(x, 1.6, z);
  scene.add(light);

  let time = 0;
  const wreck = {
    group,
    health: 0,
    wrecked: true,
    burning: true,
    x,
    z,
    update(dt) {
      time += dt;
      for (let index = 0; index < flames.length; index += 1) {
        const flame = flames[index];
        const flicker = 0.7 + 0.5 * (0.5 + 0.5 * Math.sin(time * 9 + index * 1.7));
        flame.scale.set(flicker, 0.7 + 0.7 * flicker, flicker);
        flame.material.opacity = 0.55 + 0.35 * flicker;
      }
      for (let index = 0; index < puffs.length; index += 1) {
        const puff = puffs[index];
        const drift = (time * 0.55 + index * 0.42) % 5;
        puff.position.y = 1.8 + drift;
        puff.position.x = Math.sin(time * 0.9 + index) * 0.6;
        puff.material.opacity = Math.max(0, 0.42 - drift * 0.075);
        puff.scale.setScalar(1 + drift * 0.42);
      }
      light.intensity = 20 + 12 * (0.5 + 0.5 * Math.sin(time * 11.3));
      halo.material.opacity = 0.18 + 0.1 * (0.5 + 0.5 * Math.sin(time * 6.2));
    },
  };
  return wreck;
}

/** The white-and-black cruiser livery: white body, black doors and roof, chrome bumpers. */
function dressAsPolice(THREE, group) {
  const white = new THREE.MeshStandardMaterial({ color: 0xe8e6e0, roughness: 0.42, metalness: 0.28 });
  const black = new THREE.MeshStandardMaterial({ color: 0x0d1016, roughness: 0.55, metalness: 0.22 });
  group.userData.body.material = white;
  const length = group.userData.length || 4.35;
  for (const side of [-1, 1]) {
    const door = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.52, 1.9), black);
    door.position.set(side * 0.94, 0.66, 0.1);
    group.add(door);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.14, 4.1), black);
    stripe.position.set(side * 0.94, 0.94, 0);
    group.add(stripe);
  }
  const roof = new THREE.Mesh(new THREE.BoxGeometry(1.54, 0.1, 1.7), black);
  roof.position.set(0, 1.56, -0.25);
  group.add(roof);
  const pushBar = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.18, 0.16), black);
  pushBar.position.set(0, 0.5, length / 2 + 0.14);
  group.add(pushBar);
}

export function createPolice(scene, camera, player, world, vehicles, peds, combat, audio, rng) {
  const THREE = getThree();
  const random = typeof rng === 'function' ? rng : fallbackRandom(0xc0b5);
  const units = [];
  const cops = [];
  let wanted = 0;
  let heatTimer = 0;
  let spawnTimer = 0;
  let sirenOn = false;
  let time = 0;

  const api = {
    units,
    cops,
    cars: units,
    get wanted() {
      return wanted;
    },
    set wanted(value) {
      setWanted(value);
    },
    get stars() {
      return wanted;
    },
    set stars(value) {
      setWanted(value);
    },
    get level() {
      return wanted;
    },
    set level(value) {
      setWanted(value);
    },
    setWanted,
    raiseWanted,
    clear,
    update,
    spawnUnit,
    spawnCop,
    makeWreckAt,
    get siren() {
      return sirenOn;
    },
  };

  function playerPoint() {
    return pointOf(player) || { x: 0, y: 0, z: 0 };
  }

  function setSiren(on) {
    if (sirenOn === on) return;
    sirenOn = on;
    if (audio && typeof audio.siren === 'function') audio.siren(on);
  }

  function setWanted(value) {
    const next = clamp(Math.round(Number(value) || 0), 0, 5);
    if (next === wanted) return;
    wanted = next;
    if (player) {
      try {
        player.wanted = next;
      } catch {
        // A read-only player field is fine: the police keep their own count.
      }
    }
    if (wanted === 0) clear();
    else setSiren(true);
  }

  function raiseWanted(amount) {
    setWanted(wanted + (Number(amount) || 0));
  }

  function spawnUnit(x, z, yaw) {
    if (units.length >= MAX_UNITS) return null;
    const group = makeCar(0x101820, 'sedan');
    dressAsPolice(THREE, group);
    const at = typeof x === 'number' && typeof z === 'number' ? { x, z } : playerPoint();
    const heading = typeof yaw === 'number' ? yaw : Math.atan2(at.x - playerPoint().x, at.z - playerPoint().z) + Math.PI;
    group.position.set(at.x, 0, at.z);
    group.rotation.y = heading;
    // Light bar: two emissive halves side by side on the roof, red left, blue right.
    const barRed = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.16, 0.26), new THREE.MeshStandardMaterial({ color: 0x3a0d0d, emissive: 0xff2a1a, emissiveIntensity: 3.2, roughness: 0.35 }));
    barRed.position.set(-0.24, 1.68, -0.1);
    group.add(barRed);
    const barBlue = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.16, 0.26), new THREE.MeshStandardMaterial({ color: 0x0d1a3a, emissive: 0x2a6aff, emissiveIntensity: 0.5, roughness: 0.35 }));
    barBlue.position.set(0.24, 1.68, -0.1);
    group.add(barBlue);
    const barBase = new THREE.Mesh(new THREE.BoxGeometry(0.98, 0.06, 0.3), new THREE.MeshStandardMaterial({ color: 0x14181f, roughness: 0.7 }));
    barBase.position.set(0, 1.6, -0.1);
    group.add(barBase);
    // The spotlight: a translucent cone from the bar to the road ahead.
    const spot = new THREE.Mesh(
      new THREE.ConeGeometry(2.6, 13, 16, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xdfe9ff, transparent: true, opacity: 0.09, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false }),
    );
    spot.rotation.x = -Math.PI / 2;
    spot.position.set(0, 3.2, 6.6);
    group.add(spot);
    scene.add(group);
    const unit = {
      group,
      mesh: group,
      car: group,
      x: at.x,
      z: at.z,
      yaw: heading,
      speed: 0,
      health: 150,
      hp: 150,
      dead: false,
      alive: true,
      radius: 1.6,
      height: 1.7,
      lights: [barRed, barBlue],
      spotlight: spot,
      flash: 0,
    };
    units.push(unit);
    return unit;
  }

  function spawnCop(x, z) {
    if (cops.length >= MAX_COPS) return null;
    const look = buildCop(THREE);
    const at = typeof x === 'number' && typeof z === 'number' ? { x, z } : playerPoint();
    look.group.position.set(at.x + (random() - 0.5) * 3, 0.02, at.z + (random() - 0.5) * 3);
    look.group.rotation.y = random() * Math.PI * 2;
    scene.add(look.group);
    const cop = {
      group: look.group,
      mesh: look.group,
      legs: look.legs,
      arms: look.arms,
      health: 100,
      hp: 100,
      dead: false,
      alive: true,
      killed: false,
      radius: 0.62,
      height: 1.8,
      yaw: 0,
      phase: random() * Math.PI * 2,
      fireTimer: 1.2 + random(),
      unit: null,
    };
    cops.push(cop);
    return cop;
  }

  function clear() {
    for (let index = 0; index < units.length; index += 1) {
      const unit = units[index];
      if (unit.group) scene.remove(unit.group);
    }
    units.length = 0;
    for (let index = 0; index < cops.length; index += 1) {
      const cop = cops[index];
      if (cop.group) scene.remove(cop.group);
    }
    cops.length = 0;
    setSiren(false);
  }

  function makeWreckAt(x, z, yaw) {
    const wreck = makeWreck(scene, x, z, yaw);
    wrecks.push(wreck);
    return wreck;
  }

  const wrecks = [];

  function updateUnit(unit, dt) {
    if (!unit.group) return;
    unit.flash += dt;
    const lit = Math.sin(unit.flash * 3.4) > 0;
    if (unit.lights[0]) unit.lights[0].material.emissiveIntensity = lit ? 4.2 : 0.3;
    if (unit.lights[1]) unit.lights[1].material.emissiveIntensity = lit ? 0.3 : 4.2;
    if (unit.spotlight) unit.spotlight.material.opacity = 0.06 + 0.05 * (0.5 + 0.5 * Math.sin(unit.flash * 2.1));

    if (unit.spawned && cops.length < Math.min(2, wanted)) {
      if (Math.hypot(unit.x - playerPoint().x, unit.z - playerPoint().z) < 40) {
        for (let index = 0; index < 2; index += 1) {
          const cop = spawnCop(unit.x, unit.z);
          if (cop) cop.unit = unit;
        }
      }
      unit.spawned = true;
    }

    const at = playerPoint();
    const dx = at.x - unit.x;
    const dz = at.z - unit.z;
    const distance = Math.hypot(dx, dz);
    if (distance > HUNT_RADIUS + 60) {
      unit.group.visible = false;
      return;
    }
    unit.group.visible = true;
    const targetSpeed = distance > 12 ? 14 + wanted * 1.6 : distance > 5 ? 5 : 0;
    unit.speed += (targetSpeed - unit.speed) * Math.min(1, dt * 1.6);
    if (distance > 0.001) {
      const desired = Math.atan2(dx, dz);
      unit.yaw = wrapAngle(unit.yaw + clamp(wrapAngle(desired - unit.yaw), -1.9 * dt, 1.9 * dt));
    }
    unit.x += Math.sin(unit.yaw) * unit.speed * dt;
    unit.z += Math.cos(unit.yaw) * unit.speed * dt;
    unit.group.position.set(unit.x, 0, unit.z);
    unit.group.rotation.y = unit.yaw;
    if (distance < 2.6 && unit.speed > 6) {
      if (combat && typeof combat.damage === 'function') combat.damage(6, unit.x, unit.z);
      if (typeof player.setPitch === 'function') player.setPitch(-0.2);
    }
  }

  function updateCop(cop, dt) {
    if (cop.dead) return;
    const at = playerPoint();
    const dx = at.x - cop.group.position.x;
    const dz = at.z - cop.group.position.z;
    const distance = Math.hypot(dx, dz);
    if (distance > 1.8) {
      const dirX = dx / (distance || 1);
      const dirZ = dz / (distance || 1);
      cop.yaw = Math.atan2(dirX, dirZ);
      cop.group.position.x += dirX * COP_SPEED * dt;
      cop.group.position.z += dirZ * COP_SPEED * dt;
    }
    cop.group.position.x = clamp(cop.group.position.x, -246, 246);
    cop.group.position.z = clamp(cop.group.position.z, -246, 246);
    cop.group.rotation.y = cop.yaw;
    cop.phase += dt * (distance > 3 ? 10 : 3);
    const swing = Math.sin(cop.phase) * (distance > 3 ? 0.6 : 0.16);
    cop.legs[0].rotation.x = swing;
    cop.legs[1].rotation.x = -swing;
    cop.group.position.y = 0.02 + Math.abs(Math.sin(cop.phase)) * 0.05;

    cop.fireTimer -= dt;
    if (cop.fireTimer <= 0 && distance < COP_FIRE_RANGE) {
      cop.fireTimer = 1.3 + random() * 1.1;
      if (combat && typeof combat.damage === 'function') combat.damage(2.4, cop.group.position.x, cop.group.position.z);
    }
    if (peds && typeof peds.flee === 'function' && distance < 24 && cop.fireTimer > 1.2) peds.flee(cop.group.position.x, cop.group.position.z, 16);
  }

  function update(dt) {
    const step = typeof dt === 'number' && dt > 0 ? Math.min(dt, 0.1) : 0;
    if (step <= 0) return;
    time += step;
    for (let index = 0; index < wrecks.length; index += 1) wrecks[index].update(step);

    if (wanted === 0) {
      if (units.length > 0 || cops.length > 0) clear();
      return;
    }
    heatTimer += step;
    if (heatTimer > DECAY_SECONDS) {
      heatTimer = 0;
      setWanted(wanted - 1);
      if (wanted === 0) return;
    }

    const desiredUnits = Math.min(MAX_UNITS, 1 + (wanted - 1));
    spawnTimer -= step;
    if (units.length < desiredUnits && spawnTimer <= 0) {
      spawnTimer = 2.4;
      const at = playerPoint();
      const angle = random() * Math.PI * 2;
      const distance = 42 + random() * 20;
      spawnUnit(at.x + Math.cos(angle) * distance, at.z + Math.sin(angle) * distance, Math.atan2(at.x, at.z));
    }
    for (let index = 0; index < units.length; index += 1) updateUnit(units[index], step);
    for (let index = 0; index < cops.length; index += 1) updateCop(cops[index], step);
    setSiren(cops.length > 0 || units.length > 0);
  }

  return api;
}
