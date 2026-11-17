import { installDom, calls } from './domstub.mjs';
installDom();

import { createRandom } from '../game/src/random.js';
import { buildWorld } from '../game/src/world.js';
import { createVehicles } from '../game/src/vehicles.js';
import { createCombat } from '../game/src/combat.js';
import { createMissions } from '../game/src/missions.js';
import { createHud } from '../game/src/hud.js';
import { createAudio } from '../game/src/audio.js';

const THREE = globalThis.THREE;
const scene = new THREE.Scene();
const rand = createRandom(11);
const world = buildWorld(scene, rand);
const camera = new THREE.PerspectiveCamera(62, 1.7, 0.1, 2000);
scene.add(camera);
const player = { position: new THREE.Vector3(0, 0, 0), yaw: 0, health: 100, armour: 40, money: 250, wanted: 0 };
const vehicles = createVehicles(scene, world, rand);
vehicles.setCamera(camera);

const peds = { peds: [] };
const police = { cops: [], wanted: 0, setWanted(v) { this.wanted = v; } };
// one ped dead ahead (player looks +z? three camera looks -z; we place one both ways)
for (const [x, z] of [[0, -6], [0, -14], [0, 6], [4, -6]]) {
  const g = new THREE.Group(); g.position.set(x, 0, z); scene.add(g);
  peds.peds.push({ group: g, mesh: g, health: 100, dead: false, alive: true, radius: 0.6 });
}
for (const [x, z] of [[2, -10]]) {
  const g = new THREE.Group(); g.position.set(x, 0, z); scene.add(g);
  police.cops.push({ group: g, mesh: g, health: 100, dead: false, alive: true });
}

const audio = createAudio();
const missions = createMissions(scene, player, world, vehicles, peds, police, null);
const hud = createHud(player, missions);
const combat = createCombat(scene, camera, player, world, peds, police, vehicles, hud, audio);
globalThis.gameCombat = combat;
globalThis.gameWorld = world;
globalThis.gamePeds = peds;
globalThis.gamePolice = police;

camera.position.set(0, 1.8, 0);
camera.lookAt(0, 1.4, -10);

let hits = 0;
let shots = 0;
for (let i = 0; i < 90; i += 1) {
  combat.update(1 / 60);
  hud.update(1 / 60);
  missions.update(1 / 60);
  vehicles.update(1 / 60, player);
  if (i % 20 === 0) {
    const before = combat.ammo;
    const fired = combat.fire();
    if (fired) shots += 1;
    if (fired && combat.ammo === before - 1) hits += 0;
  }
  // rate limit must be respected
  if (i % 3 === 0) combat.fire();
}
console.log('shots fired', shots, 'ammo', combat.ammo);
console.log('peds', peds.peds.map((p) => p.health).join(','));
console.log('cops', police.cops.map((p) => p.health).join(','), 'wanted', police.wanted);
console.log('banner?', hud.root.children.length, 'canvas calls', calls.length, 'map calls include arc', calls.includes('arc'));
console.log('hud money', hud.money, 'player money', player.money);

// banner + objective text
hud.showBanner('MISSION PASSED', 'A Quiet Word - $400', 4000);
hud.subtitle('Rhea: keep moving.', 2000);
hud.update(1 / 60);
const found = [];
(function walk(n) { if (!n) return; if (n.textContent) found.push(n.textContent); (n.children || []).forEach(walk); })(hud.root);
console.log('texts', JSON.stringify(found.slice(0, 14)));

// armour-first damage
const hp0 = player.health, ar0 = player.armour;
combat.damage(60);
console.log('armour first ->', 'hp', hp0, '->', player.health, 'armour', ar0, '->', player.armour);
combat.damage(500);
console.log('dead', player.dead, combat.dead, 'money', player.money);
combat.revive();
console.log('revived', player.health, player.position.x, player.position.z, 'dead', player.dead);

// missions: giver -> start, and a full save/load
player.position.set(0, 0, -20);
missions.update(1 / 60);
console.log('started', missions.current && missions.current.n, missions.current && missions.current.objective);
const saveState = missions.save();
console.log('save', JSON.stringify(saveState));
console.log('load', missions.load(JSON.parse(JSON.stringify(saveState))), missions.current && missions.current.n);
console.log('list names', missions.list.map((m) => m.n + ':' + m.name).join(' | '));
console.log('DONE2');
