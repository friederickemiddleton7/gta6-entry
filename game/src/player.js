// The player on foot: a box-built body with a pistol in its right hand, a third-person chase
// camera that turns with the mouse, WASD movement with sprint and jump, and a gentle push out of
// the city's collision boxes. The module owns no game rules beyond walking: health, armour, money,
// wanted level and ammo are plain fields the HUD, combat and missions read and write.
const WALK_SPEED = 5.2;
const SPRINT_SPEED = 8.6;
const ACCELERATION = 12;
const JUMP_SPEED = 5.4;
const GRAVITY = 16;
const BODY_RADIUS = 0.45;
const CITY_LIMIT = 250;
const MOUSE_SENSITIVITY = 0.0022;
const PITCH_LIMIT = 1.05;

const SHIRT = 0x2d3b4d;
const TROUSERS = 0x1d2128;
const SKIN = 0xc99a74;
const SHOE = 0x14161a;

function getThree() {
  const THREE = globalThis.THREE;
  if (!THREE) throw new Error('player.js needs the global THREE from three.min.js');
  return THREE;
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

/** The body: torso, head, two swinging legs, two arms and the pistol the right arm carries. */
function buildBody(THREE) {
  const group = new THREE.Group();
  const shirtMaterial = new THREE.MeshStandardMaterial({ color: SHIRT, roughness: 0.86 });
  const trouserMaterial = new THREE.MeshStandardMaterial({ color: TROUSERS, roughness: 0.92 });
  const skinMaterial = new THREE.MeshStandardMaterial({ color: SKIN, roughness: 0.84 });
  const shoeMaterial = new THREE.MeshStandardMaterial({ color: SHOE, roughness: 0.95 });
  const gunMaterial = new THREE.MeshStandardMaterial({ color: 0x22262c, roughness: 0.36, metalness: 0.72 });

  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.66, 0.32), shirtMaterial);
  torso.position.y = 1.2;
  group.add(torso);

  const neck = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.1, 0.16), skinMaterial);
  neck.position.y = 1.55;
  group.add(neck);

  const head = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.3, 0.28), skinMaterial);
  head.position.y = 1.7;
  group.add(head);

  const hair = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.08, 0.3), new THREE.MeshStandardMaterial({ color: 0x1a1712, roughness: 1 }));
  hair.position.y = 1.86;
  group.add(hair);

  const legs = [];
  for (const side of [-1, 1]) {
    const legGroup = new THREE.Group();
    legGroup.position.set(side * 0.13, 0.9, 0);
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.82, 0.2), trouserMaterial);
    leg.position.y = -0.41;
    legGroup.add(leg);
    const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.12, 0.32), shoeMaterial);
    shoe.position.set(0, -0.84, 0.06);
    legGroup.add(shoe);
    group.add(legGroup);
    legs.push(legGroup);
  }

  const arms = [];
  for (const side of [-1, 1]) {
    const armGroup = new THREE.Group();
    armGroup.position.set(side * 0.35, 1.46, 0);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.6, 0.17), shirtMaterial);
    arm.position.y = -0.29;
    armGroup.add(arm);
    const hand = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.13, 0.15), skinMaterial);
    hand.position.y = -0.62;
    armGroup.add(hand);
    group.add(armGroup);
    arms.push(armGroup);
  }

  const pistol = new THREE.Group();
  const slide = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.1, 0.32), gunMaterial);
  slide.position.z = 0.12;
  pistol.add(slide);
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.18, 0.09), gunMaterial);
  grip.position.set(0, -0.12, -0.02);
  pistol.add(grip);
  pistol.position.set(0, -0.64, 0.14);
  arms[1].add(pistol);

  group.traverse((child) => {
    if (child.isMesh) {
      child.castShadow = true;
      child.receiveShadow = true;
    }
  });

  return { group, legs, arms, pistol };
}

export function createPlayer(scene, camera, world) {
  const THREE = getThree();
  const body = buildBody(THREE);
  const group = body.group;
  scene.add(group);

  const player = {
    group,
    mesh: group,
    position: group.position,
    yaw: Math.PI,
    pitch: -0.04,
    health: 100,
    armour: 0,
    money: 250,
    wanted: 0,
    ammo: 36,
    ammoReserve: 48,
    weapon: 'Pistol',
    dead: false,
    driving: false,
    radius: BODY_RADIUS,
    height: 1.8,
    pistolOut: true,
    controlsEnabled: true,
  };

  let verticalVelocity = 0;
  let walkPhase = 0;
  const keys = new Set();
  const velocity = { x: 0, z: 0 };

  function setPistolOut(out) {
    player.pistolOut = !!out;
    body.arms[1].rotation.x = out ? -1.34 : 0;
    body.arms[1].rotation.z = out ? -0.12 : 0;
    body.pistol.visible = !!out;
  }

  function place(x, z, yaw, pitch) {
    group.position.set(x, 0.02, z);
    if (typeof yaw === 'number') player.yaw = yaw;
    if (typeof pitch === 'number') player.pitch = clamp(pitch, -PITCH_LIMIT, PITCH_LIMIT);
    verticalVelocity = 0;
    velocity.x = 0;
    velocity.z = 0;
    group.rotation.y = player.yaw;
  }

  function setVisible(visible) {
    group.visible = !!visible;
  }

  function setControlsEnabled(enabled) {
    player.controlsEnabled = !!enabled;
    if (!enabled) {
      keys.clear();
      velocity.x = 0;
      velocity.z = 0;
    }
  }

  function updateCamera() {
    if (!camera) return;
    const forwardX = Math.sin(player.yaw);
    const forwardZ = Math.cos(player.yaw);
    const horizontal = 4.5;
    const height = 2.15 + player.pitch * 2.2;
    camera.position.set(
      group.position.x - forwardX * horizontal,
      group.position.y + height,
      group.position.z - forwardZ * horizontal,
    );
    const aimHeight = 1.35 + player.pitch * 4.2;
    camera.lookAt(
      group.position.x + forwardX * 8,
      group.position.y + aimHeight,
      group.position.z + forwardZ * 8,
    );
  }

  function update(dt) {
    if (player.controlsEnabled) {
      const forwardX = Math.sin(player.yaw);
      const forwardZ = Math.cos(player.yaw);
      const rightX = -Math.cos(player.yaw);
      const rightZ = Math.sin(player.yaw);
      let inputX = 0;
      let inputZ = 0;
      if (keys.has('KeyW') || keys.has('ArrowUp')) {
        inputX += forwardX;
        inputZ += forwardZ;
      }
      if (keys.has('KeyS') || keys.has('ArrowDown')) {
        inputX -= forwardX;
        inputZ -= forwardZ;
      }
      if (keys.has('KeyD') || keys.has('ArrowRight')) {
        inputX += rightX;
        inputZ += rightZ;
      }
      if (keys.has('KeyA') || keys.has('ArrowLeft')) {
        inputX -= rightX;
        inputZ -= rightZ;
      }
      const length = Math.hypot(inputX, inputZ);
      const sprinting = keys.has('ShiftLeft') || keys.has('ShiftRight');
      const speed = sprinting ? SPRINT_SPEED : WALK_SPEED;
      const targetX = length > 0 ? (inputX / length) * speed : 0;
      const targetZ = length > 0 ? (inputZ / length) * speed : 0;
      const blend = 1 - Math.exp(-ACCELERATION * dt);
      velocity.x += (targetX - velocity.x) * blend;
      velocity.z += (targetZ - velocity.z) * blend;
      group.position.x += velocity.x * dt;
      group.position.z += velocity.z * dt;
      pushOut(world, BODY_RADIUS, group.position);
      group.position.x = clamp(group.position.x, -CITY_LIMIT, CITY_LIMIT);
      group.position.z = clamp(group.position.z, -CITY_LIMIT, CITY_LIMIT);

      verticalVelocity -= GRAVITY * dt;
      group.position.y = Math.max(0.02, group.position.y + verticalVelocity * dt);
      if (group.position.y <= 0.02) verticalVelocity = 0;

      const moving = Math.hypot(velocity.x, velocity.z);
      walkPhase += dt * (moving * 1.9 + (moving > 0.2 ? 1 : 0));
      const swing = Math.min(0.8, moving * 0.11) * Math.sin(walkPhase);
      body.legs[0].rotation.x = swing;
      body.legs[1].rotation.x = -swing;
      if (!player.pistolOut) {
        body.arms[0].rotation.x = -swing * 0.7;
        body.arms[1].rotation.x = swing * 0.7;
      }
      group.rotation.y = player.yaw;
    }
    updateCamera();
  }

  function jump() {
    if (!player.controlsEnabled || player.driving) return;
    if (group.position.y <= 0.03) verticalVelocity = JUMP_SPEED;
  }

  function look(dx, dy) {
    player.yaw = wrapAngle(player.yaw - dx * MOUSE_SENSITIVITY);
    player.pitch = clamp(player.pitch - dy * MOUSE_SENSITIVITY, -PITCH_LIMIT, PITCH_LIMIT);
  }

  window.addEventListener('keydown', (event) => {
    if (event.code === 'Space' || event.code.startsWith('Arrow')) event.preventDefault();
    keys.add(event.code);
  });
  window.addEventListener('keyup', (event) => {
    keys.delete(event.code);
  });
  window.addEventListener('blur', () => keys.clear());

  setPistolOut(true);
  place(0, 16, Math.PI, -0.04);

  const api = {
    group,
    mesh: group,
    position: group.position,
    radius: BODY_RADIUS,
    height: 1.8,
    setPistolOut,
    place,
    setVisible,
    setControlsEnabled,
    update,
    jump,
    look,
    get pistolOut() {
      return player.pistolOut;
    },
    set pistolOut(value) {
      setPistolOut(value);
    },
    get controlsEnabled() {
      return player.controlsEnabled;
    },
    get ammo() {
      return player.ammo;
    },
    set ammo(value) {
      player.ammo = Math.max(0, Math.round(Number(value) || 0));
    },
    get ammoReserve() {
      return player.ammoReserve;
    },
    set ammoReserve(value) {
      player.ammoReserve = Math.max(0, Math.round(Number(value) || 0));
    },
    get weapon() {
      return player.weapon;
    },
    set weapon(value) {
      player.weapon = String(value);
    },
    get yaw() {
      return player.yaw;
    },
    set yaw(value) {
      player.yaw = wrapAngle(Number(value) || 0);
    },
    get pitch() {
      return player.pitch;
    },
    set pitch(value) {
      player.pitch = clamp(Number(value) || 0, -PITCH_LIMIT, PITCH_LIMIT);
    },
    get health() {
      return player.health;
    },
    set health(value) {
      player.health = clamp(Number(value) || 0, 0, 100);
    },
    get armour() {
      return player.armour;
    },
    set armour(value) {
      player.armour = clamp(Number(value) || 0, 0, 100);
    },
    get money() {
      return player.money;
    },
    set money(value) {
      player.money = Math.max(0, Math.round(Number(value) || 0));
    },
    get wanted() {
      return player.wanted;
    },
    set wanted(value) {
      player.wanted = clamp(Math.round(Number(value) || 0), 0, 5);
    },
    get dead() {
      return player.dead;
    },
    set dead(value) {
      player.dead = !!value;
    },
    get driving() {
      return player.driving;
    },
    set driving(value) {
      player.driving = !!value;
    },
  };
  return api;
}
