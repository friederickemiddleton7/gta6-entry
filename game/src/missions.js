// The story of Port Vireo, told in five jobs from Rhea Quill, a fixer who works out of a corner
// booth on the central avenue. Each mission owns one objective line, one world marker (a tall
// emissive beam, a ring on the pavement and a turning icon overhead) that the HUD also draws as a
// blip, a completion test and a cash reward. Everything the player touches is checked through the
// same loose helpers the other modules use, so a mission works whether the player is a group, a
// wrapper or a plain { x, z }; spawned characters are registered with the ped system so the pistol
// can hit them. Progress can be saved and restored whole.
const GIVER = { x: 0, z: -20 };
const DOCKS = { x: 176, z: 176 };
const MARIGOLD = { x: -176, z: -88 };
const LOCKUP = { x: 88, z: 176 };
const CAUSEWAY = { x: 0, z: 88 };
const WAREHOUSE = { x: 176, z: 132 };
const QUAY = { x: 0, z: 286 };
const GIVER_RADIUS = 3.4;
const ARRIVE_RADIUS = 10;
const BANNER_HOLD = 4;
const AMBUSH_SECONDS = 35;
const OBJECTIVE_COLOR = 0xffd24a;
const GIVER_COLOR = 0x59ffb0;

function clamp(value, min, max) {
  return value < min ? min : value > max ? max : value;
}

function writeField(target, key, value) {
  if (!target) return;
  try {
    target[key] = value;
  } catch {
    // A getter-only field belongs to another module: leave it alone.
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

/** Push a point out of the city's building boxes, the same rule the car code uses. */
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

function getThree() {
  const THREE = globalThis.THREE;
  if (!THREE) throw new Error('missions.js needs the global THREE from three.min.js');
  return THREE;
}

/** A stand-in courier or thug: the box-person the other modules use, with a health and a group. */
function makePerson(THREE, shirt, trousers, cap) {
  const group = new THREE.Group();
  const shirtMaterial = new THREE.MeshStandardMaterial({ color: shirt, roughness: 0.88 });
  const trouserMaterial = new THREE.MeshStandardMaterial({ color: trousers, roughness: 0.92 });
  const skinMaterial = new THREE.MeshStandardMaterial({ color: 0xc99a74, roughness: 0.85 });
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.64, 0.32), shirtMaterial);
  torso.position.y = 1.2;
  group.add(torso);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.28, 0.26), skinMaterial);
  head.position.y = 1.66;
  group.add(head);
  if (cap) {
    const brim = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.06, 0.34), new THREE.MeshStandardMaterial({ color: cap, roughness: 0.7 }));
    brim.position.set(0, 1.8, 0.05);
    group.add(brim);
  }
  for (const side of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.84, 0.2), trouserMaterial);
    leg.position.set(side * 0.13, 0.42, 0);
    group.add(leg);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.58, 0.16), shirtMaterial);
    arm.position.set(side * 0.34, 1.22, 0);
    arm.rotation.z = side * 0.3;
    group.add(arm);
  }
  group.traverse((child) => {
    if (child.isMesh) child.castShadow = true;
  });
  return group;
}

export function createMissions(scene, player, world, vehicles, peds, police, hud) {
  const THREE = getThree();
  const half = world && typeof world.size === 'number' ? world.size / 2 : 264;
  const state = {
    next: 0,
    activeIndex: -1,
    completed: [],
  };
  let currentMission = null;
  let bannerHold = 0;
  let pendingFinal = false;
  let giverArmed = true;
  let markerMode = '';
  let markerTime = 0;
  const spawns = [];

  // ---- geometry: the waypoint marker and its floating icon --------------------------------

  const marker = new THREE.Group();
  const beamMaterial = new THREE.MeshBasicMaterial({ color: OBJECTIVE_COLOR, transparent: true, opacity: 0.15, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending });
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.15, 84, 10, 1, true), beamMaterial);
  beam.position.y = 41;
  marker.add(beam);
  const ringMaterial = new THREE.MeshBasicMaterial({ color: OBJECTIVE_COLOR, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false });
  const ring = new THREE.Mesh(new THREE.RingGeometry(2.5, 3.2, 28), ringMaterial);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.12;
  marker.add(ring);
  const discMaterial = new THREE.MeshBasicMaterial({ color: OBJECTIVE_COLOR, transparent: true, opacity: 0.13, depthWrite: false });
  const disc = new THREE.Mesh(new THREE.CircleGeometry(2.5, 24), discMaterial);
  disc.rotation.x = -Math.PI / 2;
  disc.position.y = 0.1;
  marker.add(disc);
  const iconMaterial = new THREE.MeshStandardMaterial({ color: OBJECTIVE_COLOR, emissive: OBJECTIVE_COLOR, emissiveIntensity: 1.6, roughness: 0.32 });
  const icon = new THREE.Mesh(new THREE.OctahedronGeometry(0.95, 0), iconMaterial);
  icon.position.y = 3.5;
  marker.add(icon);
  marker.visible = false;
  scene.add(marker);

  function setMarkerColour(mode) {
    if (markerMode === mode) return;
    markerMode = mode;
    const colour = mode === 'giver' ? GIVER_COLOR : OBJECTIVE_COLOR;
    beamMaterial.color.setHex(colour);
    ringMaterial.color.setHex(colour);
    discMaterial.color.setHex(colour);
    iconMaterial.color.setHex(colour);
    iconMaterial.emissive.setHex(colour);
  }

  function placeMarker(x, z, mode) {
    marker.visible = true;
    marker.position.set(x, 0, z);
    setMarkerColour(mode);
  }

  // ---- reading the game's loose objects ---------------------------------------------------

  function playerPoint() {
    const driving = vehicles && vehicles.driving;
    if (driving) {
      const at = pointOf(driving);
      if (at) return at;
    }
    return pointOf(player) || { x: 0, y: 0, z: 0 };
  }

  function distanceTo(point) {
    if (!point) return Infinity;
    const at = playerPoint();
    return Math.hypot(point.x - at.x, point.z - at.z);
  }

  function playerIsDead() {
    return !!(player && player.dead === true);
  }

  function readMoney() {
    if (player) {
      if (typeof player.money === 'number') return player.money;
      if (typeof player.cash === 'number') return player.cash;
    }
    if (hud && typeof hud.money === 'number') return hud.money;
    return 0;
  }

  function addMoney(amount) {
    const next = Math.max(0, Math.round(readMoney() + amount));
    if (player) {
      if (player.money === undefined || typeof player.money === 'number') writeField(player, 'money', next);
      if (typeof player.cash === 'number') writeField(player, 'cash', next);
    }
    if (hud) {
      if (hud.money === undefined || typeof hud.money === 'number') hud.money = next;
      else writeField(hud, 'money', next);
    }
  }

  function setWanted(level) {
    const value = clamp(Math.round(level), 0, 5);
    if (police) {
      try {
        if (typeof police.setWanted === 'function') police.setWanted(value);
        else if (typeof police.raiseWanted === 'function' && typeof police.wanted === 'number') police.raiseWanted(value - police.wanted);
        writeField(police, 'wanted', value);
        writeField(police, 'stars', value);
      } catch {
        // The police module can be mid-startup: its own state stays.
      }
    }
    if (player) writeField(player, 'wanted', value);
    if (hud && typeof hud.setWanted === 'function') hud.setWanted(value);
  }

  function say(text, ms) {
    if (hud && typeof hud.subtitle === 'function') hud.subtitle(text, ms || 3600);
  }

  // ---- registering spawned characters so the pistol can find them -------------------------

  function pedLists() {
    const lists = [];
    if (!peds) return lists;
    if (Array.isArray(peds)) lists.push(peds);
    const keys = ['peds', 'pedestrians', 'people', 'crowd', 'agents', 'units', 'entries', 'list', 'all'];
    for (let index = 0; index < keys.length; index += 1) {
      if (Array.isArray(peds[keys[index]])) lists.push(peds[keys[index]]);
    }
    return lists;
  }

  function registerEntity(entity) {
    const lists = pedLists();
    if (lists.length > 0) {
      for (let index = 0; index < lists.length; index += 1) lists[index].push(entity);
      return;
    }
    if (peds && typeof peds === 'object') {
      try {
        peds.peds = [entity];
      } catch {
        // The ped module may not accept new members: the entity still stands, it just cannot be shot.
      }
    }
  }

  function unregisterEntity(entity) {
    const lists = pedLists();
    for (let index = 0; index < lists.length; index += 1) {
      const position = lists[index].indexOf(entity);
      if (position >= 0) lists[index].splice(position, 1);
    }
  }

  function spawnPerson(shirt, trousers, cap, x, z) {
    const group = makePerson(THREE, shirt, trousers, cap);
    group.position.set(x, 0, z);
    scene.add(group);
    const entity = {
      group,
      mesh: group,
      health: 100,
      hp: 100,
      dead: false,
      alive: true,
      killed: false,
      radius: 0.62,
      height: 1.8,
      yaw: 0,
      bob: 0,
      spawnX: x,
      spawnZ: z,
    };
    registerEntity(entity);
    spawns.push(entity);
    return entity;
  }

  function discardSpawns() {
    for (let index = 0; index < spawns.length; index += 1) {
      const entity = spawns[index];
      unregisterEntity(entity);
      if (entity.group) scene.remove(entity.group);
    }
    spawns.length = 0;
  }

  function removeEntity(entity) {
    if (!entity) return;
    unregisterEntity(entity);
    if (entity.group) scene.remove(entity.group);
    const position = spawns.indexOf(entity);
    if (position >= 0) spawns.splice(position, 1);
  }

  function isDown(entity) {
    if (!entity) return true;
    if (entity.dead === true || entity.alive === false) return true;
    return typeof entity.health === 'number' && entity.health <= 0;
  }

  // ---- the five jobs ----------------------------------------------------------------------

  function pickParkedCar(near) {
    if (!vehicles || !Array.isArray(vehicles.cars)) return null;
    let best = null;
    let bestDistance = Infinity;
    let anyCar = null;
    let anyDistance = Infinity;
    for (let index = 0; index < vehicles.cars.length; index += 1) {
      const car = vehicles.cars[index];
      if (!car || car === vehicles.driving) continue;
      if (car.stolen || car.wrecked) continue;
      const x = typeof car.x === 'number' ? car.x : car.group ? car.group.position.x : null;
      const z = typeof car.z === 'number' ? car.z : car.group ? car.group.position.z : null;
      if (x === null || z === null) continue;
      const distance = Math.hypot(x - near.x, z - near.z);
      if (distance < anyDistance) {
        anyDistance = distance;
        anyCar = car;
      }
      if (car.parked && distance < bestDistance) {
        bestDistance = distance;
        best = car;
      }
    }
    return best || anyCar;
  }

  function followFlee(target, dt, speedNear, speedFar) {
    const at = playerPoint();
    const group = target.group;
    if (!group) return;
    const dx = group.position.x - at.x;
    const dz = group.position.z - at.z;
    const distance = Math.hypot(dx, dz) || 1;
    let dirX;
    let dirZ;
    let speed;
    if (distance < 34) {
      dirX = dx / distance;
      dirZ = dz / distance;
      speed = speedNear;
    } else {
      const angle = Math.atan2(dz, dx) + dt * 0.8;
      dirX = Math.cos(angle);
      dirZ = Math.sin(angle);
      speed = speedFar;
    }
    target.yaw = Math.atan2(dirX, dirZ);
    group.position.x = clamp(group.position.x + dirX * speed * dt, -half + 8, half - 8);
    group.position.z = clamp(group.position.z + dirZ * speed * dt, -half + 8, half - 8);
    pushOut(world, 0.7, group.position);
    target.bob += dt * (6 + speed);
    group.position.y = Math.abs(Math.sin(target.bob)) * 0.06;
    group.rotation.y = target.yaw;
  }

  function chasePlayer(target, dt, speed) {
    const at = playerPoint();
    const group = target.group;
    if (!group) return;
    const dx = at.x - group.position.x;
    const dz = at.z - group.position.z;
    const distance = Math.hypot(dx, dz) || 1;
    if (distance > 2.2) {
      const dirX = dx / distance;
      const dirZ = dz / distance;
      target.yaw = Math.atan2(dirX, dirZ);
      group.position.x = clamp(group.position.x + dirX * speed * dt, -half + 8, half - 8);
      group.position.z = clamp(group.position.z + dirZ * speed * dt, -half + 8, half - 8);
      pushOut(world, 0.7, group.position);
    }
    target.bob += dt * 8;
    group.position.y = Math.abs(Math.sin(target.bob)) * 0.06;
    group.rotation.y = target.yaw;
  }

  function shootPlayer(target, dt) {
    target.fireTimer = (target.fireTimer || 0) - dt;
    if (target.fireTimer > 0) return;
    const at = playerPoint();
    const group = target.group;
    if (!group) return;
    if (Math.hypot(at.x - group.position.x, at.z - group.position.z) > 15) {
      target.fireTimer = 0.5;
      return;
    }
    target.fireTimer = 1.5;
    const combat = (player && player.combat) || globalThis.gameCombat;
    if (combat && typeof combat.damage === 'function') {
      try {
        combat.damage(2.5, group.position.x, group.position.z);
        return;
      } catch {
        // Combat can refuse while it restarts: the fallback below still applies.
      }
    }
    if (!player) return;
    let remaining = 2.5;
    if (typeof player.armour === 'number' && player.armour > 0) {
      const absorbed = Math.min(player.armour, remaining);
      player.armour -= absorbed;
      remaining -= absorbed;
    }
    if (typeof player.health === 'number') {
      player.health = Math.max(0, player.health - remaining);
      if (player.health <= 0) writeField(player, 'dead', true);
    }
  }

  const list = [
    {
      name: 'A Quiet Word',
      contact: 'Rhea Quill',
      brief: 'Rhea has a run to the docks and nobody to drive it.',
      reward: 400,
      objective: 'Drive to the Dockside gate',
      begin(mission) {
        mission.target = { x: DOCKS.x, z: DOCKS.z };
        say('Rhea: The Salt Crew runs Dockside now. Drive down, keep your eyes open, come back breathing.', 4600);
      },
      step(dt, mission) {
        return distanceTo(mission.target) < ARRIVE_RADIUS;
      },
    },
    {
      name: 'The Marigold Mercury',
      contact: 'Rhea Quill',
      brief: 'A certain coupe needs moving from Marigold Row to the Saltworks lockup.',
      reward: 750,
      objective: 'Steal the marked Mercury coupe',
      begin(mission) {
        const car = pickParkedCar(MARIGOLD);
        mission.car = car;
        if (car) {
          writeField(car, 'missionCar', true);
          const at = pointOf(car);
          mission.target = { x: at ? at.x : MARIGOLD.x, z: at ? at.z : MARIGOLD.z };
        } else {
          mission.target = { x: MARIGOLD.x, z: MARIGOLD.z };
        }
        say('Rhea: A marigold Mercury is parked on Marigold Row. Bring it to the Saltworks lockup, undented.', 4600);
      },
      step(dt, mission) {
        const car = mission.car;
        if (!car) {
          mission.objective = 'Reach the Marigold Row corner';
          return distanceTo(MARIGOLD) < ARRIVE_RADIUS;
        }
        const at = pointOf(car);
        if (at) mission.target = { x: at.x, z: at.z };
        const stolen = car.stolen === true || (vehicles && vehicles.driving === car);
        if (stolen) {
          mission.objective = 'Deliver the Mercury to the Saltworks lockup';
          mission.target = { x: LOCKUP.x, z: LOCKUP.z };
          if (distanceTo(LOCKUP) < 14) return true;
        } else {
          mission.objective = 'Steal the marked Mercury coupe';
        }
        return false;
      },
      end(mission) {
        if (mission.car) writeField(mission.car, 'missionCar', false);
      },
    },
    {
      name: 'Courier Down',
      contact: 'Rhea Quill',
      brief: 'Dex Marlow is running the same route for the Salt Crew. Stop him.',
      reward: 1100,
      objective: 'Chase down Dex Marlow',
      begin(mission) {
        const courier = spawnPerson(0x2f6b4f, 0x24262e, 0xb03a2e, CAUSEWAY.x + 5, CAUSEWAY.z - 24);
        courier.health = 90;
        courier.hp = 90;
        courier.isCourier = true;
        mission.courier = courier;
        mission.target = { x: courier.group.position.x, z: courier.group.position.z };
        say('Rhea: Dex Marlow is cutting across the Causeway with our money. He is quick. You are quicker.', 4800);
      },
      step(dt, mission) {
        const courier = mission.courier;
        if (!courier) return true;
        if (!isDown(courier)) {
          followFlee(courier, dt, 7.4, 3.2);
          mission.target = { x: courier.group.position.x, z: courier.group.position.z };
          mission.objective = 'Chase down Dex Marlow';
          return false;
        }
        mission.objective = 'Dex Marlow is down';
        say('Rhea: That is the courier run settled. Get out before the Salt Crew hears about it.', 3800);
        return true;
      },
      end(mission) {
        if (mission.courier) {
          removeEntity(mission.courier);
          mission.courier = null;
        }
      },
    },
    {
      name: 'Salt in the Wound',
      contact: 'Rhea Quill',
      brief: 'The Salt Crew wants their courier run back. Hold the warehouse.',
      reward: 1600,
      objective: 'Survive the Salt Crew ambush',
      begin(mission) {
        mission.countdown = AMBUSH_SECONDS;
        mission.paused = false;
        mission.target = { x: WAREHOUSE.x, z: WAREHOUSE.z };
        mission.thugs = [];
        const spots = [[-6, -16], [6, 14], [-3, 22]];
        for (let index = 0; index < spots.length; index += 1) {
          const thug = spawnPerson(0x6b2f2f, 0x1d2126, 0x14161a, WAREHOUSE.x + spots[index][0], WAREHOUSE.z + spots[index][1]);
          thug.health = 65;
          thug.hp = 65;
          thug.fireTimer = 1 + index * 0.4;
          mission.thugs.push(thug);
        }
        setWanted(3);
        say('Rhea: They brought friends and a police scanner. Hold the warehouse until the heat burns down.', 4600);
      },
      step(dt, mission) {
        if (playerIsDead()) {
          mission.paused = true;
          mission.objective = 'Survive the Salt Crew ambush';
          return false;
        }
        if (mission.paused) {
          mission.paused = false;
          mission.countdown = AMBUSH_SECONDS;
          say('Rhea: They are still coming. Move!', 2600);
        }
        mission.countdown = Math.max(0, mission.countdown - dt);
        const thugs = mission.thugs || [];
        for (let index = 0; index < thugs.length; index += 1) {
          const thug = thugs[index];
          if (isDown(thug)) continue;
          chasePlayer(thug, dt, 4.6);
          shootPlayer(thug, dt);
        }
        mission.objective = 'Survive the Salt Crew: ' + Math.ceil(mission.countdown) + 's';
        if (mission.countdown > 0) return false;
        say('Rhea: Heat is fading. Get to Lantern Quay and do not look back.', 4200);
        return true;
      },
      end(mission) {
        const thugs = mission.thugs || [];
        for (let index = 0; index < thugs.length; index += 1) removeEntity(thugs[index]);
        mission.thugs = [];
      },
    },
    {
      name: 'Lantern Quay',
      contact: 'Rhea Quill',
      brief: 'One last drive to the waterfront, with the whole city behind you.',
      reward: 6000,
      objective: 'Reach the Lantern Quay boat ramp',
      begin(mission) {
        mission.target = { x: QUAY.x, z: QUAY.z };
        setWanted(4);
        say('Rhea: The boat is at Lantern Quay. Everything you are owed is in the hold. Go.', 4800);
      },
      step(dt, mission) {
        if (playerIsDead()) return false;
        return distanceTo(mission.target) < 14;
      },
      end() {
        setWanted(0);
      },
    },
  ].map((definition, index) => Object.assign({ n: index + 1 }, definition));

  const api = {
    list,
    start,
    update,
    save,
    load,
    reset,
    get current() {
      return currentMission;
    },
    get marker() {
      return marker.visible ? marker : null;
    },
    get target() {
      return currentMission && currentMission.target ? currentMission.target : null;
    },
    get police() {
      return police;
    },
    get peds() {
      return peds;
    },
    get world() {
      return world;
    },
  };

  // ---- mission flow -----------------------------------------------------------------------

  function complete(mission) {
    if (!mission || mission.state !== 'active') return;
    mission.state = 'passed';
    if (state.completed.indexOf(mission.n) === -1) state.completed.push(mission.n);
    state.next = Math.max(state.next, mission.n);
    if (typeof mission.end === 'function') {
      try {
        mission.end(mission);
      } catch {
        // A mission's own clean-up must never block the payout.
      }
    }
    addMoney(mission.reward);
    if (hud && typeof hud.showBanner === 'function') {
      hud.showBanner('MISSION PASSED', mission.name + ' - $' + mission.reward.toLocaleString('en-US'), BANNER_HOLD * 1000);
    }
    pendingFinal = state.next >= list.length;
    bannerHold = BANNER_HOLD;
    giverArmed = false;
  }

  function start(n) {
    const requested = Number(n);
    const index = clamp((Number.isFinite(requested) ? requested : 1) - 1, 0, list.length - 1);
    if (currentMission) {
      if (typeof currentMission.end === 'function' && currentMission.state === 'active') {
        try {
          currentMission.end(currentMission);
        } catch {
          // Clean-up is best effort.
        }
      }
    }
    discardSpawns();
    bannerHold = 0;
    pendingFinal = false;
    state.activeIndex = index;
    state.next = Math.max(state.next, index);
    const definition = list[index];
    const mission = {
      n: definition.n,
      name: definition.name,
      contact: definition.contact,
      brief: definition.brief,
      objective: definition.objective,
      reward: definition.reward,
      target: { x: GIVER.x, z: GIVER.z },
      timer: 0,
      state: 'active',
      begin: definition.begin,
      step: definition.step,
      end: definition.end,
    };
    currentMission = mission;
    if (typeof definition.begin === 'function') {
      try {
        definition.begin(mission);
      } catch {
        // A broken begin() leaves the objective at its definition value.
      }
    }
    giverArmed = false;
    if (hud && typeof hud.showBanner === 'function') {
      hud.showBanner('MISSION ' + mission.n, mission.name, 2400);
    }
    return mission;
  }

  function reset() {
    if (currentMission && currentMission.state === 'active' && typeof currentMission.end === 'function') {
      try {
        currentMission.end(currentMission);
      } catch {
        // Best effort.
      }
    }
    discardSpawns();
    currentMission = null;
    state.next = 0;
    state.activeIndex = -1;
    state.completed.length = 0;
    bannerHold = 0;
    pendingFinal = false;
    giverArmed = true;
    marker.visible = false;
    markerMode = '';
  }

  function objectivePosition(mission) {
    if (!mission) return null;
    if (mission.car) {
      const at = pointOf(mission.car);
      if (at) return at;
    }
    if (mission.courier && mission.courier.group) return mission.courier.group.position;
    return mission.target;
  }

  function updateMarker(dt, mission) {
    markerTime += dt;
    const target = objectivePosition(mission);
    if (target) placeMarker(target.x, target.z, 'objective');
    else if (state.next < list.length) placeMarker(GIVER.x, GIVER.z, 'giver');
    else marker.visible = false;
    icon.position.y = 3.5 + Math.sin(markerTime * 2.2) * 0.28;
    icon.rotation.y += dt * 1.6;
    icon.rotation.x = Math.sin(markerTime * 0.9) * 0.18;
    beamMaterial.opacity = 0.11 + 0.06 * (0.5 + 0.5 * Math.sin(markerTime * 1.8));
    ring.rotation.z += dt * 0.6;
  }

  function update(dt) {
    const step = typeof dt === 'number' && dt > 0 ? Math.min(dt, 0.1) : 0;
    if (step <= 0) return;

    if (bannerHold > 0) {
      bannerHold = Math.max(0, bannerHold - step);
      updateMarker(step, null);
      if (bannerHold === 0) {
        currentMission = null;
        state.activeIndex = -1;
        giverArmed = true;
        if (pendingFinal) {
          pendingFinal = false;
          if (hud && typeof hud.showBanner === 'function') {
            hud.showBanner('PORT VIREO', 'The city is yours. Nice work.', 5200);
          }
        }
      }
      return;
    }

    if (currentMission) {
      const mission = currentMission;
      mission.timer += step;
      let finished = false;
      try {
        finished = mission.step ? mission.step(step, mission) === true : false;
      } catch {
        finished = false;
      }
      if (finished) complete(mission);
      updateMarker(step, mission);
      return;
    }

    updateMarker(step, null);
    if (state.next >= list.length) return;
    const distance = distanceTo(GIVER);
    if (!giverArmed) {
      if (distance > 7) giverArmed = true;
    } else if (distance < GIVER_RADIUS && !playerIsDead()) {
      giverArmed = false;
      start(state.next + 1);
    }
  }

  function save() {
    return {
      v: 1,
      next: state.next,
      completed: state.completed.slice(),
      active: currentMission && currentMission.state === 'active' ? currentMission.n : 0,
      objective: currentMission && currentMission.state === 'active' ? currentMission.objective : '',
      money: readMoney(),
    };
  }

  function load(data) {
    if (!data || data.v !== 1) return false;
    reset();
    state.next = clamp(Math.round(Number(data.next) || 0), 0, list.length);
    if (Array.isArray(data.completed)) {
      for (let index = 0; index < data.completed.length; index += 1) {
        const n = Math.round(Number(data.completed[index]));
        if (n >= 1 && n <= list.length && state.completed.indexOf(n) === -1) state.completed.push(n);
      }
    }
    if (typeof data.money === 'number') addMoney(data.money - readMoney());
    const active = Math.round(Number(data.active) || 0);
    if (active >= 1 && active <= list.length && state.completed.indexOf(active) === -1) {
      start(active);
      if (typeof data.objective === 'string' && data.objective && currentMission) currentMission.objective = data.objective;
    } else {
      giverArmed = true;
    }
    return true;
  }

  updateMarker(0, null);
  return api;
}
