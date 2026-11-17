// Headless smoke: run the real world, vehicles, combat, missions and hud against stubs.
import { createRandom } from '../game/src/random.js';
import * as worldModule from '../game/src/world.js';
import { createVehicles } from '../game/src/vehicles.js';
import * as combatModule from '../game/src/combat.js';
import * as missionsModule from '../game/src/missions.js';
import * as hudModule from '../game/src/hud.js';
import * as audioModule from '../game/src/audio.js';

const THREE = globalThis.THREE;
if (!THREE) throw new Error('no THREE');

const scene = new THREE.Scene();
const rand = createRandom(7);
const world = worldModule.buildWorld(scene, rand);
const camera = new THREE.PerspectiveCamera(60, 1.6, 0.1, 2000);
scene.add(camera);

const player = { position: new THREE.Vector3(0, 0, 0), yaw: 0.4, health: 100, armour: 30, money: 500, wanted: 0 };
const vehicles = createVehicles(scene, world, rand);
vehicles.setCamera(camera);

// fake peds + police
const peds = { peds: [] };
const police = { cops: [], wanted: 0, setWanted(v) { this.wanted = v; } };
for (let i = 0; i < 6; i += 1) {
  const g = new THREE.Group();
  g.position.set(Math.cos(i) * 20, 0, Math.sin(i) * 20);
  scene.add(g);
  peds.peds.push({ group: g, mesh: g, health: 100, dead: false });
}
for (let i = 0; i < 3; i += 1) {
  const g = new THREE.Group();
  g.position.set(10 + i, 0, 5);
  scene.add(g);
  police.cops.push({ group: g, mesh: g, health: 100, dead: false });
}

const audio = audioModule.createAudio();
const missions = missionsModule.createMissions(scene, player, world, vehicles, peds, police, null);
const hud = hudModule.createHud(player, missions);

const combat = combatModule.createCombat(scene, camera, player, world, peds, police, vehicles, hud, audio);
globalThis.gameCombat = combat;
const hud2 = hud;

let t = 0;
function tick(dt) {
  t += dt;
  player.yaw += dt * 0.2;
  camera.position.set(player.position.x - Math.sin(player.yaw) * 4, 1.8, player.position.z - Math.cos(player.yaw) * 4);
  camera.lookAt(player.position.x + Math.sin(player.yaw) * 8, 1.2, player.position.z + Math.cos(player.yaw) * 8);
  world.update(dt);
  vehicles.update(dt, player);
  missions.update(dt);
  combat.update(dt);
  hud2.update(dt);
}

for (let i = 0; i < 60 * 90; i += 1) {
  tick(1 / 60);
  if (i === 30) {
    // walk onto the giver to start mission 1
    player.position.set(0, 0, -20);
  }
  if (i === 120) {
    const m = missions.current;
    console.log('after giver -> mission', m && m.n, m && m.name, 'objective:', m && m.objective, 'marker visible', !!missions.marker);
    player.position.set(176, 0, 176);
  }
  if (i === 420) {
    console.log('after banner -> current', missions.current && missions.current.n, 'money', player.money, 'save', JSON.stringify(missions.save()));
    player.position.set(0, 0, -20);
  }
  if (i === 460) console.log('mission2', missions.current && missions.current.n, missions.current && missions.current.objective);
  if (i === 470 && missions.current) {
    const car = missions.current.car;
    console.log('mission2 car chosen', !!car, car && car.parked);
    if (car) { car.stolen = true; vehicles.enter ? vehicles.enter(car) : null; }
  }
  if (i === 500) console.log('mission2 objective', missions.current && missions.current.objective);
  if (i % 97 === 0) {
    combat.fire();
  }
}
console.log('state', JSON.stringify(missions.save()));
console.log('combat ammo', combat.ammo, 'health', player.health, 'wanted', police.wanted);
console.log('kills: peds alive', peds.peds.filter((p) => !p.dead).length, 'of', peds.peds.length);
console.log('wanted stars', police.wanted);
combat.damage(200);
console.log('dead?', player.dead, 'combat.dead', combat.dead, 'money after death', player.money);
combat.revive();
console.log('after revive', player.position.x, player.position.z, player.health, 'ammo', combat.ammo);

// mission load round-trip
const saved = missions.save();
const ok = missions.load(saved);
console.log('load ok', ok, 'next', saved.next);
console.log('DONE');
