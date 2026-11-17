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

const CONTROLS_CORNER = { x: 2.4, z: 70 };
const POLICE_CAR = { x: 4.9, z: 84.5, yaw: Math.PI + 0.06 };
const WRECK = { x: 8.4, z: 88.4, yaw: 0.42 };
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
    const glowMaterial = new THREE.MeshBasicMaterial({ color: 0xffb066, transparent: true, opacity: 0.3, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
    const glow = new THREE.Mesh(new THREE.SphereGeometry(96, 20, 14), glowMaterial);
    glow.position.copy(sun.position);
    scene.add(glow);
    const haloMaterial = new THREE.MeshBasicMaterial({ color: 0xffc78a, transparent: true, opacity: 0.12, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
    const halo = new THREE.Mesh(new THREE.SphereGeometry(260, 20, 14), haloMaterial);
    halo.position.copy(sun.position);
    scene.add(halo);
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
  scene.fog = new THREE.FogExp2(0x243049, 0.0029);
  scene.traverse((child) => {
    if (child.isPoints) child.visible = false;
    if (child.isHemisphereLight) {
      child.color.setHex(0x7288b0);
      child.groundColor.setHex(0x4a3424);
      child.intensity = 1.65;
    } else if (child.isAmbientLight) {
      child.color.setHex(0x8a8296);
      child.intensity = 0.55;
    } else if (child.isDirectionalLight) {
      child.color.setHex(0xffb26b);
      child.intensity = 2.9;
      // Sun mostly down the avenue (from behind the camera) and high: the tower shadows fall along
      // the street instead of laying a black blanket across the road we want to see.
      child.position.set(96, 330, -250);
      if (child.target) {
        child.target.position.set(-2, 0, 118);
        child.target.updateMatrixWorld();
      }
      child.shadow.camera.left = -120;
      child.shadow.camera.right = 120;
      child.shadow.camera.top = 130;
      child.shadow.camera.bottom = -130;
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
  // A big soft sunset glow low in the north, past the police car, to give the street a backdrop.
  const glow = new THREE.Mesh(
    new THREE.PlaneGeometry(1100, 260),
    new THREE.MeshBasicMaterial({ map: makeSkyTexture(THREE, [
      [0, 0.0, 'rgba(255,190,120,0.95)'],
      [0, 0.45, 'rgba(240,150,100,0.7)'],
      [0, 1.0, 'rgba(120,90,110,0.0)'],
    ]), transparent: true, opacity: 0.75, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }),
  );
  glow.position.set(30, 90, 470);
  glow.rotation.y = Math.PI;
  scene.add(glow);
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

/** Place every pedestrian on the avenue sidewalks, mid-stride, facing along their walk. */
function stageCrowd(peds, random) {
  const list = peds && Array.isArray(peds.peds) ? peds.peds : [];
  const lanes = [-11.2, -10.1, 10.4, 11.6];
  for (let index = 0; index < list.length; index += 1) {
    const ped = list[index];
    const object = objectOf(ped);
    if (!object) continue;
    const side = index % 2 === 0 ? 1 : -1;
    const x = side * (10.2 + random() * 1.9);
    // z bands that sit on the sidewalk blocks, not the junction between them.
    const band = index % 4;
    let z;
    if (band === 0) z = 58 + random() * 20;
    else if (band === 1) z = 98 + random() * 30;
    else if (band === 2) z = 118 + random() * 24;
    else z = 42 + random() * 16;
    object.position.set(x, 0.02 + (random() < 0.5 ? 0.04 : 0), z);
    ped.yaw = side > 0 ? Math.PI : 0;
    object.rotation.y = ped.yaw;
    ped.fleeTimer = 0;
    ped.phase = random() * Math.PI * 2;
    if ('speed' in ped) ped.speed = 1.2 + random() * 0.5;
    if ('yaw' in ped) ped.yaw = object.rotation.y;
    ped.legs[0].rotation.x = 0.4 + random() * 0.2;
    ped.legs[1].rotation.x = -0.4 - random() * 0.2;
    ped.arms[0].rotation.x = -0.34;
    ped.arms[1].rotation.x = 0.34;
  }
  // A few extra walkers on the far sidewalk so the street keeps receding.
  const extra = lanes.slice();
  void extra;
}

/** Park a line of varied cars along the avenue so at least eight read in the frame. */
function stageTraffic(vehicles, random) {
  const cars = vehicles && Array.isArray(vehicles.cars) ? vehicles.cars : [];
  const placements = [
    [-4.6, 78, Math.PI],
    [4.6, 96, 0],
    [-4.6, 104, Math.PI],
    [4.6, 112, 0],
    [-4.6, 120, Math.PI],
    [4.6, 128, 0],
    [-4.6, 138, Math.PI],
    [4.6, 146, 0],
    [-4.4, 56, Math.PI],
    [4.4, 48, 0],
  ];
  for (let index = 0; index < cars.length; index += 1) {
    const car = cars[index];
    const object = objectOf(car);
    if (!object) continue;
    if (index < placements.length) {
      const spot = placements[index];
      const x = spot[0] + (random() - 0.5) * 0.5;
      const z = spot[1] + (random() - 0.5) * 2.4;
      if (typeof car.x === 'number') car.x = x;
      if (typeof car.z === 'number') car.z = z;
      if (typeof car.yaw === 'number') car.yaw = spot[2];
      if (typeof car.speed === 'number') car.speed = 0;
      if ('parked' in car) car.parked = true;
      object.position.set(x, 0, z);
      object.rotation.y = spot[2];
    } else {
      // The rest sit on their generated lanes; hold them still for the shot.
      if (typeof car.speed === 'number') car.speed = 0;
    }
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

/** The stopped car at the waterfront: headlights on, a long warm cone on the quay. */
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
      if ('place' in player) player.place(CONTROLS_CORNER.x, CONTROLS_CORNER.z, 0, -0.02);
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
    stageCrowd(peds, random);
    stageTraffic(vehicles, random);
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
    if (player && typeof player.update === 'function') player.update(0);
    call(player, 'setPose', 'run');
    if (camera.isPerspectiveCamera) {
      camera.fov = 60;
      camera.updateProjectionMatrix();
    }
    // Re-aim with a touch more downward pitch so the wet road fills the lower third.
    camera.lookAt(camera.position.x, 1.1, camera.position.z + 14);
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
