// The staged screenshot scenes behind ?shot=start|play|end. Each one builds its scene from seeded
// values only, places the camera and every actor by hand, and then lets main.js hold it still: the
// first painted frame is already the frame the screenshot wants, so there is no loading screen and
// no drift between two takes of the same URL.
const THREE_COLOR = {
  sky: '#2b3b64',
  horizon: '#e8915a',
  low: '#ffc57a',
};

const CONTROLS_CORNER = { x: 3, z: 79 };
const POLICE_CAR = { x: 3, z: 94, yaw: Math.PI };
const WRECK = { x: 7.8, z: 93.2, yaw: 0.32 };
const WATERFRONT = { x: -5, z: 294, yaw: 1.15 };
const DROP_PLAYER = { x: -1.9, z: 292.2, yaw: -2.1 };

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

function objectOf(source) {
  if (!source) return null;
  if (source.isObject3D) return source;
  const candidate = source.mesh || source.group || source.object || source.root;
  return candidate && candidate.isObject3D ? candidate : null;
}

function placeObject(source, x, z, yaw) {
  const object = objectOf(source);
  if (!object) return;
  object.position.set(x, object.position.y || 0, z);
  if (typeof yaw === 'number') object.rotation.y = yaw;
}

/** A vertical golden-hour gradient painted into a canvas, used as the sky for the start shot. */
function makeSkyTexture(THREE) {
  if (typeof document === 'undefined') return new THREE.Color(0xe8915a);
  const canvas = document.createElement('canvas');
  canvas.width = 4;
  canvas.height = 512;
  const context = canvas.getContext('2d');
  if (!context) return new THREE.Color(0xe8915a);
  const gradient = context.createLinearGradient(0, 0, 0, 512);
  gradient.addColorStop(0, '#1d2a4c');
  gradient.addColorStop(0.34, THREE_COLOR.sky);
  gradient.addColorStop(0.62, '#b96f52');
  gradient.addColorStop(0.8, THREE_COLOR.horizon);
  gradient.addColorStop(1, THREE_COLOR.low);
  context.fillStyle = gradient;
  context.fillRect(0, 0, 4, 512);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function goldenHour(scene) {
  const THREE = getThree();
  scene.background = makeSkyTexture(THREE);
  scene.fog = new THREE.Fog(0xe2a36b, 280, 1700);
  const sunMaterial = new THREE.MeshBasicMaterial({ color: 0xffe0a8, fog: false });
  const sun = new THREE.Mesh(new THREE.SphereGeometry(42, 16, 12), sunMaterial);
  sun.position.set(430, 128, 980);
  scene.add(sun);
  scene.traverse((child) => {
    if (child.isPoints) child.visible = false;
    if (child.isHemisphereLight) {
      child.color.setHex(0xffd3a2);
      child.groundColor.setHex(0x493726);
      child.intensity = 0.95;
    } else if (child.isAmbientLight) {
      child.color.setHex(0xffb98a);
      child.intensity = 0.32;
    } else if (child.isDirectionalLight) {
      child.color.setHex(0xffb066);
      child.intensity = 1.25;
      child.position.set(340, 130, 620);
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

  if (ui) {
    call(ui, 'hidePrompt');
    call(ui, 'hideStart');
    call(ui, 'hideOverlay');
  }

  if (name === 'play') {
    if (hud) call(hud, 'setVisible', true);
    call(player.setControlsEnabled !== undefined ? player : null, 'setControlsEnabled', false);
    if (player) {
      player.health = 62;
      player.armour = 40;
      player.money = 1250;
      player.wanted = 3;
      player.ammo = 12;
      player.ammoReserve = 48;
      if ('place' in player) player.place(CONTROLS_CORNER.x, CONTROLS_CORNER.z, 0, -0.03);
      if ('setPistolOut' in player) player.setPistolOut(true);
      if ('setVisible' in player) player.setVisible(true);
    }
    if (police) {
      call(police, 'clear');
      call(police, 'setWanted', 3);
      call(police, 'spawnUnit', POLICE_CAR.x, POLICE_CAR.z, POLICE_CAR.yaw);
      call(police, 'makeWreckAt', WRECK.x, WRECK.z, WRECK.yaw);
      if ('wanted' in police) police.wanted = 3;
    }
    scatterPeds(peds, CONTROLS_CORNER.x, CONTROLS_CORNER.z);
    if (ctx.combat) {
      try {
        ctx.combat.ammo = 12;
      } catch {
        // Older combat builds keep their own count; the HUD fields above still read 12.
      }
    }
    if (hud) {
      call(hud, 'setClock', 21 * 60 + 47);
      call(hud, 'setWanted', 3);
      call(hud, 'setWeapon', 'PISTOL', 12);
      call(hud, 'setAmmo', 12);
      if ('objective' in hud) hud.objective = 'ELIMINATE THE COURIER';
      else call(hud, 'subtitle', 'ELIMINATE THE COURIER', 60000);
      if ('money' in hud) hud.money = 1250;
    }
    if (camera.isPerspectiveCamera) {
      camera.fov = 64;
      camera.updateProjectionMatrix();
    }
    if (player && typeof player.update === 'function') player.update(0);
    if (ui) call(ui, 'showPrompt');
    return;
  }

  if (name === 'end') {
    if (hud) call(hud, 'setVisible', true);
    call(player.setControlsEnabled !== undefined ? player : null, 'setControlsEnabled', false);
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
    }
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
  camera.position.set(-34, 26, -152);
  camera.lookAt(0, 9, 145);
  if (camera.isPerspectiveCamera) {
    camera.fov = 55;
    camera.updateProjectionMatrix();
  }
  if (ui) call(ui, 'showStart');
}
