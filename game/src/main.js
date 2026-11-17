// Boot for Port Vireo: one WebGL renderer, one camera, one scene, and one requestAnimationFrame
// loop that advances the city and every system in a fixed order, then paints once. Each subsystem
// is created behind its own try/catch so a single broken module cannot blank the whole picture; the
// error is logged (and kept on window.__game.errors) instead of thrown.
//
// ?seed=N picks the city; ?shot=start|play|end stages a screenshot scene through shots.js, paints
// two frames immediately (no animation frames, so the first screenshot is already the shot) and
// sets window.__shotReady for a headless capture.
import { createRandom } from './random.js';
import { buildWorld } from './world.js';
import { createPlayer } from './player.js';
import { createVehicles } from './vehicles.js';
import { createPeds } from './peds.js';
import { createPolice } from './police.js';
import { createCombat } from './combat.js';
import { createMissions } from './missions.js';
import { createHud } from './hud.js';
import { createUi } from './ui.js';
import { createAudio } from './audio.js';
import { readShotParams, applyShot } from './shots.js';
import { configureRenderer } from './render.js';
import { createInput, ACTION_CONFIRM, ACTION_PAUSE } from './input.js';

const MAX_FRAME = 0.25;
const DEFAULT_SEED = 1;
const SAVE_KEY = 'portvireo.save';

const THREE = globalThis.THREE;
if (!THREE) throw new Error('main.js needs the global THREE from three.min.js (load it before the module)');

const report = { errors: [] };
const reported = new Set();

function fail(what, error) {
  const message = what + ': ' + (error && error.message ? error.message : String(error));
  report.errors.push(message);
  if (!reported.has(what)) {
    reported.add(what);
    console.error('[port-vireo] ' + message, error);
  }
}

function safe(label, build, fallback) {
  try {
    const value = build();
    if (value === undefined || value === null) throw new Error(label + ' returned nothing');
    return value;
  } catch (error) {
    fail(label, error);
    return fallback;
  }
}

function fallbackWorld() {
  return { colliders: [], roads: [], sidewalks: [], buildings: [], update() {} };
}

function fallbackPlayer(scene) {
  const group = new THREE.Group();
  scene.add(group);
  return {
    group,
    mesh: group,
    position: group.position,
    radius: 0.45,
    height: 1.8,
    yaw: 0,
    pitch: 0,
    health: 100,
    armour: 0,
    money: 250,
    wanted: 0,
    ammo: 36,
    ammoReserve: 48,
    weapon: 'Pistol',
    dead: false,
    driving: false,
    update() {},
    place(x, z, yaw) {
      group.position.set(x, 0.02, z);
      if (typeof yaw === 'number') group.rotation.y = yaw;
    },
    look() {},
    jump() {},
    setControlsEnabled() {},
    setPistolOut() {},
    setVisible(visible) {
      group.visible = !!visible;
    },
  };
}

// ---- the page ------------------------------------------------------------------------------

const canvas = document.getElementById('game');
if (!canvas) throw new Error('index.html has no #game canvas');
const params = readShotParams();
const shot = params.shot;
const seed = Number.isInteger(params.seed) ? params.seed : DEFAULT_SEED;
const seeded = (offset) => createRandom((seed ^ offset) | 0);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight, false);
configureRenderer(renderer, THREE);
if (typeof window !== 'undefined' && /[?&]dbg=noshadow/.test(window.location.search)) renderer.shadowMap.enabled = false;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, Math.max(1, window.innerWidth) / Math.max(1, window.innerHeight), 0.1, 2200);
camera.position.set(0, 26, 120);
scene.add(camera);
globalThis.gameCamera = camera;

const audio = safe('audio system', () => createAudio(), null);

// ---- the city and its actors ---------------------------------------------------------------

const world = safe('world', () => buildWorld(scene, seeded(0)), fallbackWorld());

// buildWorld already lights the night and fogs the skyline; only add what is missing so the city
// is never black if that module ever changes.
(function ensureAtmosphere() {
  let ambient = null;
  let directional = null;
  scene.traverse((child) => {
    if (child.isAmbientLight && !ambient) ambient = child;
    if (child.isDirectionalLight && !directional) directional = child;
  });
  if (!ambient) {
    ambient = new THREE.AmbientLight(0x76839a, 0.35);
    scene.add(ambient);
  }
  if (!directional) {
    directional = new THREE.DirectionalLight(0xb9cdeb, 1.1);
    directional.position.set(160, 220, 110);
    directional.castShadow = true;
    directional.shadow.mapSize.set(1024, 1024);
    directional.shadow.camera.left = -300;
    directional.shadow.camera.right = 300;
    directional.shadow.camera.top = 300;
    directional.shadow.camera.bottom = -300;
    directional.shadow.camera.near = 1;
    directional.shadow.camera.far = 760;
    scene.add(directional);
  }
  if (!scene.fog) scene.fog = new THREE.Fog(0x101828, 190, 780);
})();

const player = safe('player', () => createPlayer(scene, camera, world), fallbackPlayer(scene));

const vehicles = safe('vehicles', () => {
  const system = createVehicles(scene, world, seeded(0x51a7));
  if (typeof system.setCamera === 'function') system.setCamera(camera);
  return system;
}, null);

const peds = safe('peds', () => createPeds(scene, world, seeded(0x9ed5)), null);

// The law needs combat before it exists; a small forwarding shim keeps the reference live.
let combatRef = null;
const combatShim = {
  damage(amount, x, z) {
    return combatRef && typeof combatRef.damage === 'function' ? combatRef.damage(amount, x, z) : false;
  },
};
const police = safe('police', () => createPolice(scene, camera, player, world, vehicles, peds, combatShim, audio, seeded(0xc0b5)), null);

// The HUD reads the mission book through getters, so it can be built before the book exists.
const hub = {
  get current() {
    return missions && typeof missions.current !== 'undefined' ? missions.current : null;
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
  get marker() {
    return missions && typeof missions.marker !== 'undefined' ? missions.marker : null;
  },
  get waypoint() {
    return missions && typeof missions.target !== 'undefined' ? missions.target : null;
  },
};

let missions = null;
const hud = safe('hud', () => createHud(player, hub), null);

const combat = safe('combat', () => createCombat(scene, camera, player, world, peds, police, vehicles, hud, audio), null);
combatRef = combat;

missions = safe('missions', () => createMissions(scene, player, world, vehicles, peds, police, hud), null);

let ui = null;
let running = false;
let paused = false;
let respawnTimer = 0;

function startGame() {
  if (ui) {
    ui.hideStart();
    ui.togglePause(false);
  }
  if (hud) hud.setVisible(true);
  running = true;
  paused = false;
  if (player) player.setControlsEnabled(true);
  if (audio) {
    try {
      audio.resume();
      audio.musicStart();
    } catch (error) {
      fail('audio start', error);
    }
  }
}

function loadGame() {
  try {
    const raw = window.localStorage.getItem(SAVE_KEY);
    if (!raw || !missions) return;
    missions.load(JSON.parse(raw));
  } catch (error) {
    fail('loading progress', error);
  }
  startGame();
}

function saveGame() {
  try {
    if (!missions) return;
    window.localStorage.setItem(SAVE_KEY, JSON.stringify(missions.save()));
  } catch (error) {
    fail('saving progress', error);
  }
}

ui = safe('ui', () => createUi(startGame, loadGame, saveGame), null);

globalThis.gameWorld = world;
globalThis.gamePolice = police;
globalThis.gamePeds = peds;
globalThis.gameCombat = combat;

let input = null;
try {
  input = createInput(canvas);
} catch (error) {
  fail('input', error);
}

window.__game = { scene, camera, player, world, hud, ui, errors: report.errors };

// ---- pause, pointer look and shooting --------------------------------------------------------

canvas.addEventListener('pointerdown', (event) => {
  if (!running || paused) return;
  if (document.pointerLockElement !== canvas) {
    if (typeof canvas.requestPointerLock === 'function') {
      try {
        canvas.requestPointerLock();
      } catch (error) {
        fail('pointer lock', error);
      }
    }
    return;
  }
  if (event.button === 0 && combat && typeof combat.fire === 'function') combat.fire();
});

window.addEventListener('mousemove', (event) => {
  if (!running || paused) return;
  if (document.pointerLockElement !== canvas) return;
  if (player && typeof player.look === 'function') player.look(event.movementX || 0, event.movementY || 0);
});

window.addEventListener('keydown', (event) => {
  if (event.code === 'Escape' && document.pointerLockElement === canvas && document.exitPointerLock) document.exitPointerLock();
  if (event.code !== 'KeyF' || !running || paused || !vehicles) return;
  try {
    if (vehicles.driving) {
      vehicles.exit();
      player.driving = false;
      if (typeof player.setControlsEnabled === 'function') player.setControlsEnabled(true);
    } else {
      const car = typeof vehicles.nearest === 'function' ? vehicles.nearest(player.position, 4.5) : null;
      if (car) {
        vehicles.enter(car);
        player.driving = true;
        if (typeof player.setControlsEnabled === 'function') player.setControlsEnabled(false);
      }
    }
  } catch (error) {
    fail('entering a car', error);
  }
});

function setPaused(next) {
  paused = !!next;
  if (ui) {
    const actual = ui.togglePause(paused);
    paused = !!actual;
  }
  if (player && typeof player.setControlsEnabled === 'function') player.setControlsEnabled(running && !paused);
  if (audio) {
    try {
      if (paused) audio.suspend();
      else if (running) audio.resume();
    } catch (error) {
      fail('audio pause', error);
    }
  }
}

// ---- the loop --------------------------------------------------------------------------------

let lastFrame = 0;
let painted = 0;

function updateSystems(dt) {
  if (world && typeof world.update === 'function') world.update(dt);
  if (player && typeof player.update === 'function') player.update(dt);
  if (vehicles && typeof vehicles.update === 'function') vehicles.update(dt, player);
  if (peds && typeof peds.update === 'function') peds.update(dt);
  if (police && typeof police.update === 'function') police.update(dt);
  if (combat && typeof combat.update === 'function') combat.update(dt);
  if (missions && typeof missions.update === 'function') missions.update(dt);
  if (hud && typeof hud.update === 'function') hud.update(dt);
  if (audio && typeof audio.engine === 'function') {
    try {
      audio.engine(vehicles && vehicles.driving ? Math.abs(vehicles.driving.speed || 0) : 0);
    } catch (error) {
      fail('engine audio', error);
    }
  }
}

function handleDeath(dt) {
  if (!combat || !player) return;
  if (respawnTimer > 0) {
    respawnTimer -= dt;
    if (respawnTimer <= 0) {
      respawnTimer = 0;
      try {
        if (typeof combat.revive === 'function') combat.revive();
        if (ui) ui.hideOverlay();
        if (typeof player.setControlsEnabled === 'function') player.setControlsEnabled(running && !paused);
      } catch (error) {
        fail('respawn', error);
      }
    }
    return;
  }
  if (combat.dead) {
    respawnTimer = 3.6;
    if (typeof player.setControlsEnabled === 'function') player.setControlsEnabled(false);
    if (ui) ui.showWasted();
    if (audio) {
      try {
        audio.siren(false);
      } catch (error) {
        fail('siren stop', error);
      }
    }
  }
}

function frame(now) {
  requestAnimationFrame(frame);
  const raw = lastFrame === 0 ? 0 : (now - lastFrame) / 1000;
  lastFrame = now;
  const dt = Math.min(Math.max(raw, 0), MAX_FRAME);

  if (input) {
    let actions = 0;
    try {
      actions = input.takeActions();
    } catch (error) {
      fail('input', error);
    }
    if (actions & ACTION_PAUSE) {
      if (ui && ui.startVisible) {
        // Esc on the title screen does nothing.
      } else {
        setPaused(!paused);
      }
    }
    if (actions & ACTION_CONFIRM && !running) startGame();
    else if (actions & ACTION_CONFIRM && paused) setPaused(false);
  }

  if (!paused) {
    try {
      updateSystems(dt);
      handleDeath(dt);
      if (player && typeof player.controlsEnabled !== 'undefined' && !player.controlsEnabled && running && !player.driving && respawnTimer === 0) {
        // A system may have disabled controls (death); the loop restores them only on respawn.
      }
    } catch (error) {
      fail('frame update', error);
    }
  }

  renderer.render(scene, camera);
  painted += 1;
  if (painted >= 2) window.__shotReady = true;
}

// ---- boot ------------------------------------------------------------------------------------

window.addEventListener('resize', () => {
  const width = Math.max(1, window.innerWidth);
  const height = Math.max(1, window.innerHeight);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height, false);
});

if (shot) {
  // Staging: no loop, no spawn logic; the shot module places everyone and we paint at once.
  try {
    applyShot(shot, { scene, camera, player, vehicles, peds, police, combat, missions, hud, ui });
  } catch (error) {
    fail('shot staging (' + shot + ')', error);
  }
  try {
    if (hud && typeof hud.update === 'function') hud.update(1 / 60);
  } catch (error) {
    fail('shot hud', error);
  }
  renderer.render(scene, camera);
  renderer.render(scene, camera);
  painted = 2;
  window.__shotReady = true;
  if (typeof window !== 'undefined' && /[?&]dbg=probe/.test(window.location.search)) {
    const out = { vp: [window.innerWidth, window.innerHeight], player: null, peds: [], units: [], cars: [], lights: 0 };
    const project = (object) => {
      if (!object || !object.position) return null;
      const point = object.position.clone();
      point.project(camera);
      if (point.z > 1) return null;
      return [Math.round((point.x * 0.5 + 0.5) * window.innerWidth), Math.round((-point.y * 0.5 + 0.5) * window.innerHeight), Math.round(point.z * 100) / 100];
    };
    out.player = project(player && player.group);
    if (peds && peds.peds) for (let i = 0; i < peds.peds.length; i += 1) out.peds.push(project(peds.peds[i].group));
    if (police && police.units) for (let i = 0; i < police.units.length; i += 1) out.units.push(project(police.units[i].group));
    if (vehicles && vehicles.cars) for (let i = 0; i < vehicles.cars.length; i += 1) out.cars.push(project(vehicles.cars[i].group));
    out.lights = (() => { let n = 0; scene.traverse((c) => { if (c.isLight) n += 1; }); return n; })();
    out.calls = renderer.info.render.calls;
    out.tris = renderer.info.render.triangles;
    console.log('PROBE' + JSON.stringify(out));
  }
} else {
  if (hud) hud.setVisible(false);
  if (player && typeof player.setControlsEnabled === 'function') player.setControlsEnabled(false);
  if (ui) ui.showStart();
  if (player && typeof player.place === 'function') player.place(0, 4, 0, -0.02);
  requestAnimationFrame(frame);
}
