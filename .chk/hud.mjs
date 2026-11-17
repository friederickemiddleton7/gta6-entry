// Everything the player reads while playing, built in JS so the page stays one canvas: bars for
// health and armour, the cash counter, the wanted row, the weapon and its rounds, a clock, the
// current mission line and a subtitle, plus the circular minimap. Nothing here knows the game's
// rules: it reads the player and the mission book each frame and paints the DOM and the small
// canvas. The banner is the one loud thing, used for MISSION PASSED, WASTED and BUSTED.
const MAP_SIZE = 172;
const MAP_RADIUS = MAP_SIZE / 2 - 5;
const MAP_SCALE = 1.15;
const CLOCK_START = 21 * 60;
const CLOCK_RATE = 2.4;
const STAR_COUNT = 5;

function clamp(value, min, max) {
  return value < min ? min : value > max ? max : value;
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

function readPoint(source) {
  const point = pointOf(source);
  if (point) return point;
  return { x: 0, y: 0, z: 0 };
}

function collectFrom(source, keys, visit) {
  if (!source) return;
  if (Array.isArray(source)) {
    for (let index = 0; index < source.length; index += 1) visit(source[index]);
    return;
  }
  for (let index = 0; index < keys.length; index += 1) {
    const value = source[keys[index]];
    if (Array.isArray(value)) {
      for (let item = 0; item < value.length; item += 1) visit(value[item]);
    }
  }
}

function isDown(entity) {
  if (!entity) return false;
  if (entity.dead === true || entity.alive === false) return true;
  const health = typeof entity.health === 'number' ? entity.health : typeof entity.hp === 'number' ? entity.hp : null;
  return health !== null && health <= 0;
}

/** Read the wanted level from wherever the police module keeps it. */
function wantedOf(police, player) {
  if (police) {
    if (typeof police.wanted === 'number') return police.wanted;
    if (typeof police.stars === 'number') return police.stars;
    if (typeof police.level === 'number') return police.level;
  }
  if (player && typeof player.wanted === 'number') return player.wanted;
  return 0;
}

function moneyOf(player, fallback) {
  if (player) {
    if (typeof player.money === 'number') return player.money;
    if (typeof player.cash === 'number') return player.cash;
  }
  return fallback;
}

export function createHud(player, missions) {
  const doc = typeof document !== 'undefined' ? document : null;
  const root = doc ? doc.createElement('div') : null;
  let moneyValue = moneyOf(player, 0);
  let clockMinutes = CLOCK_START;
  let wanted = 0;
  let bannerTimer = 0;
  let subtitleTimer = 0;
  let hitTimer = 0;
  let lastHealth = -1;
  let lastArmour = -1;
  let lastWantedPips = -1;
  let lastClockText = '';
  let lastMoneyText = '';
  let lastMoneyValue = -1;
  let lastObjective = '';
  let lastAmmoText = '';

  function element(tag, css, parent) {
    if (!doc) return null;
    const node = doc.createElement(tag);
    node.style.cssText = css;
    (parent || root || doc.body).appendChild(node);
    return node;
  }

  if (root) {
    root.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:30;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;color:#eef1f5;user-select:none;';
    if (doc.body) doc.body.appendChild(root);
    else if (doc.addEventListener) doc.addEventListener('DOMContentLoaded', () => doc.body && doc.body.appendChild(root), { once: true });
  }

  const objectiveNode = element('div', 'position:absolute;top:18px;left:50%;transform:translateX(-50%);max-width:60vw;text-align:center;font-size:15px;letter-spacing:0.12em;text-transform:uppercase;color:#ffd76a;text-shadow:0 2px 6px rgba(0,0,0,0.85);', root);

  const moneyNode = element('div', 'position:absolute;top:16px;right:20px;font-size:30px;font-weight:600;letter-spacing:0.03em;text-align:right;text-shadow:0 2px 6px rgba(0,0,0,0.9);', root);
  const dollarNode = element('span', 'color:#63e07a;margin-right:5px;', moneyNode);
  if (dollarNode) dollarNode.textContent = '$';
  const cashNode = element('span', 'color:#eef4ea;', moneyNode);
  const clockNode = element('div', 'font-size:14px;font-weight:400;letter-spacing:0.15em;color:#aab4c4;margin-top:2px;', moneyNode);

  const wantedRow = element('div', 'position:absolute;top:74px;right:20px;font-size:24px;letter-spacing:4px;color:#8a8f99;text-align:right;text-shadow:0 2px 5px rgba(0,0,0,0.9);', root);
  const stars = [];
  for (let index = 0; index < STAR_COUNT; index += 1) {
    const star = element('span', 'color:#4a4f5a;transition:color 120ms linear;', wantedRow);
    if (star) star.textContent = '\u2605';
    stars.push(star);
  }
  const wantedTag = element('div', 'font-size:11px;letter-spacing:0.24em;color:#8f98a8;margin-top:2px;', wantedRow);
  if (wantedTag) wantedTag.textContent = 'WANTED';

  const weaponBox = element('div', 'position:absolute;right:20px;bottom:22px;text-align:right;font-size:13px;letter-spacing:0.16em;color:#c6ceda;text-shadow:0 2px 6px rgba(0,0,0,0.9);', root);
  const weaponIcon = element('div', 'position:relative;width:44px;height:20px;margin:0 0 6px auto;opacity:0.9;', weaponBox);
  if (weaponIcon) {
    weaponIcon.innerHTML = '<span style="position:absolute;right:0;top:3px;width:34px;height:9px;background:#dfe6f0;border-radius:1px;"></span>'
      + '<span style="position:absolute;right:20px;top:12px;width:9px;height:8px;background:#c6ceda;transform:skewX(-16deg);"></span>'
      + '<span style="position:absolute;right:26px;top:11px;width:5px;height:5px;background:#9aa4b2;"></span>';
  }
  const weaponName = element('div', 'font-size:15px;color:#e9eef7;letter-spacing:0.2em;', weaponBox);
  if (weaponName) weaponName.textContent = 'PISTOL';
  const ammoNode = element('div', 'font-size:30px;letter-spacing:0.04em;color:#ffe9b0;', weaponBox);
  if (ammoNode) ammoNode.textContent = '36';

  const mapHolder = element('div', 'position:absolute;left:20px;bottom:22px;width:' + MAP_SIZE + 'px;height:' + MAP_SIZE + 'px;', root);
  const minimapCanvas = doc ? doc.createElement('canvas') : null;
  if (minimapCanvas) {
    const ratio = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    minimapCanvas.width = Math.round(MAP_SIZE * ratio);
    minimapCanvas.height = Math.round(MAP_SIZE * ratio);
    minimapCanvas.style.cssText = 'width:' + MAP_SIZE + 'px;height:' + MAP_SIZE + 'px;display:block;';
    minimapCanvas.setAttribute('aria-hidden', 'true');
    if (mapHolder) mapHolder.appendChild(minimapCanvas);
  }
  const mapContext = minimapCanvas ? minimapCanvas.getContext('2d') : null;

  const bars = element('div', 'position:absolute;left:20px;bottom:' + (MAP_SIZE + 34) + 'px;width:' + MAP_SIZE + 'px;', root);
  const healthTrack = element('div', 'position:relative;height:10px;background:rgba(10,14,20,0.72);border:1px solid rgba(255,255,255,0.12);border-radius:5px;overflow:hidden;margin-bottom:6px;', bars);
  const healthFill = element('div', 'position:absolute;left:0;top:0;bottom:0;width:100%;background:linear-gradient(90deg,#2f9e58,#63e07a);border-radius:4px;transition:width 120ms linear;', healthTrack);
  const armourTrack = element('div', 'position:relative;height:8px;background:rgba(10,14,20,0.72);border:1px solid rgba(255,255,255,0.1);border-radius:4px;overflow:hidden;', bars);
  const armourFill = element('div', 'position:absolute;left:0;top:0;bottom:0;width:0%;background:linear-gradient(90deg,#3f7fd6,#8fc4ff);border-radius:3px;transition:width 120ms linear;', armourTrack);

  const subtitleNode = element('div', 'position:absolute;left:50%;bottom:64px;transform:translateX(-50%);max-width:62vw;text-align:center;font-size:17px;line-height:1.4;color:#f4f1e6;background:rgba(8,11,16,0.55);padding:8px 16px;border-radius:3px;opacity:0;transition:opacity 160ms linear;text-shadow:0 1px 3px rgba(0,0,0,0.9);', root);

  const crosshair = element('div', 'position:absolute;left:50%;top:50%;width:16px;height:16px;transform:translate(-50%,-50%);opacity:0.85;', root);
  if (crosshair) {
    crosshair.innerHTML = '<span style="position:absolute;left:7px;top:0;width:2px;height:4px;background:#fff;box-shadow:0 0 4px rgba(0,0,0,0.9);"></span>'
      + '<span style="position:absolute;left:7px;bottom:0;width:2px;height:4px;background:#fff;box-shadow:0 0 4px rgba(0,0,0,0.9);"></span>'
      + '<span style="position:absolute;left:0;top:7px;width:4px;height:2px;background:#fff;box-shadow:0 0 4px rgba(0,0,0,0.9);"></span>'
      + '<span style="position:absolute;right:0;top:7px;width:4px;height:2px;background:#fff;box-shadow:0 0 4px rgba(0,0,0,0.9);"></span>';
  }
  const hitMarker = element('div', 'position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);font-size:22px;font-weight:700;color:#ff4a3d;opacity:0;text-shadow:0 0 6px rgba(0,0,0,0.85);', root);
  if (hitMarker) hitMarker.textContent = '\u00d7';

  const banner = element('div', 'position:absolute;left:0;right:0;top:38%;text-align:center;opacity:0;transition:opacity 220ms linear;', root);
  const bannerTitle = element('div', 'font-size:54px;font-weight:800;letter-spacing:0.22em;color:#ffe9a8;text-shadow:0 2px 0 #22180a,0 8px 28px rgba(0,0,0,0.9);', banner);
  const bannerSub = element('div', 'margin-top:10px;font-size:18px;letter-spacing:0.18em;color:#dfe6f0;text-shadow:0 2px 8px rgba(0,0,0,0.9);', banner);

  function showBanner(title, sub, ms) {
    if (bannerTitle) bannerTitle.textContent = title || '';
    if (bannerSub) bannerSub.textContent = sub || '';
    bannerTimer = Math.max(0.2, (ms || 2600) / 1000);
    if (banner) banner.style.opacity = '1';
    if (bannerTitle) {
      bannerTitle.style.color = title === 'WASTED' ? '#ff6a5c' : title === 'BUSTED' ? '#8fc4ff' : '#ffe9a8';
    }
  }

  function subtitle(text, ms) {
    if (!subtitleNode) return;
    subtitleNode.textContent = text || '';
    subtitleNode.style.opacity = text ? '1' : '0';
    subtitleTimer = text ? Math.max(0.4, (ms || 3000) / 1000) : 0;
  }

  function hitMarkerPulse(seconds) {
    hitTimer = seconds || 0.16;
    if (hitMarker) hitMarker.style.opacity = '1';
  }

  function setWanted(value) {
    wanted = clamp(Math.round(Number(value) || 0), 0, STAR_COUNT);
  }

  function setWeapon(name, rounds) {
    if (weaponName && name) weaponName.textContent = String(name).toUpperCase();
    if (ammoNode && typeof rounds === 'number') ammoNode.textContent = String(rounds);
  }

  function setAmmo(rounds) {
    if (ammoNode) ammoNode.textContent = String(Math.max(0, Math.round(rounds)));
  }

  const api = {
    root,
    minimapCanvas,
    showBanner,
    subtitle,
    setWanted,
    setWeapon,
    setAmmo,
    hitMarker: hitMarkerPulse,
    update,
    get money() {
      return moneyValue;
    },
    set money(value) {
      moneyValue = Math.max(0, Math.round(Number(value) || 0));
    },
  };

  function currentObjectiveText() {
    if (!missions) return '';
    const current = missions.current;
    if (!current) return '';
    if (typeof current === 'string') return current;
    if (typeof current.objective === 'string') return current.objective;
    if (typeof current.text === 'string') return current.text;
    if (typeof current.name === 'string') return current.name;
    return '';
  }

  function renderBars() {
    const health = clamp(player && typeof player.health === 'number' ? player.health : 100, 0, 100);
    const armour = clamp(player && typeof player.armour === 'number' ? player.armour : player && typeof player.armor === 'number' ? player.armor : 0, 0, 100);
    if (health !== lastHealth) {
      lastHealth = health;
      if (healthFill) healthFill.style.width = health.toFixed(1) + '%';
      if (healthTrack) healthTrack.style.borderColor = health < 25 ? 'rgba(255,90,80,0.75)' : 'rgba(255,255,255,0.12)';
    }
    if (armour !== lastArmour) {
      lastArmour = armour;
      if (armourFill) armourFill.style.width = armour.toFixed(1) + '%';
    }
  }

  function renderMoney() {
    moneyValue = moneyOf(player, moneyValue);
    if (moneyValue !== lastMoneyValue) {
      lastMoneyValue = moneyValue;
      const text = moneyValue.toLocaleString('en-US');
      if (cashNode && text !== lastMoneyText) {
        lastMoneyText = text;
        cashNode.textContent = text;
      }
    }
    clockMinutes = ((clockMinutes % 1440) + 1440) % 1440;
    const minutes = Math.floor(clockMinutes);
    const hours = Math.floor(minutes / 60) % 24;
    const clockText = String(hours).padStart(2, '0') + ':' + String(minutes % 60).padStart(2, '0');
    if (clockNode && clockText !== lastClockText) {
      lastClockText = clockText;
      clockNode.textContent = clockText;
    }
  }

  function renderWanted() {
    if (wanted !== lastWantedPips) {
      lastWantedPips = wanted;
      for (let index = 0; index < stars.length; index += 1) {
        if (!stars[index]) continue;
        const lit = index < wanted;
        stars[index].style.color = lit ? '#ffd647' : '#454a54';
        stars[index].style.textShadow = lit ? '0 0 9px rgba(255,196,40,0.75)' : 'none';
      }
    }
  }

  function policeList() {
    if (missions && missions.police) return missions.police;
    if (globalThis.gamePolice) return globalThis.gamePolice;
    return null;
  }

  function pedList() {
    if (missions && missions.peds) return missions.peds;
    if (globalThis.gamePeds) return globalThis.gamePeds;
    return null;
  }

  function worldSource() {
    if (missions && missions.world) return missions.world;
    if (globalThis.gameWorld) return globalThis.gameWorld;
    return null;
  }

  function waypointOf() {
    if (!missions) return null;
    const marker = missions.marker || (missions.current && missions.current.marker) || null;
    const point = pointOf(marker);
    if (point) return point;
    if (marker && typeof marker.x === 'number' && typeof marker.z === 'number') return marker;
    const target = missions.waypoint || (missions.current && missions.current.target) || null;
    return pointOf(target);
  }

  function drawMap() {
    if (!mapContext || !minimapCanvas) return;
    const ratio = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    const context = mapContext;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, MAP_SIZE, MAP_SIZE);
    const centre = MAP_SIZE / 2;
    const point = readPoint(player);
    const yaw = player && typeof player.yaw === 'number' ? player.yaw : 0;
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);

    // World offset (dx, dz) to a point on the disc, turned so the player always looks up.
    function project(wx, wz, limit) {
      let dx = (wx - point.x) * MAP_SCALE;
      let dz = (wz - point.z) * MAP_SCALE;
      let x = dx * cos - dz * sin;
      let y = -(dx * sin + dz * cos);
      if (limit !== undefined) {
        const length = Math.hypot(x, y);
        if (length > limit) {
          x = (x / length) * limit;
          y = (y / length) * limit;
        }
      }
      return { x: centre + x, y: centre + y };
    }

    context.save();
    context.beginPath();
    context.arc(centre, centre, MAP_RADIUS, 0, Math.PI * 2);
    context.closePath();
    context.fillStyle = 'rgba(9,13,19,0.82)';
    context.fill();
    context.clip();

    const world = worldSource();
    const roads = world && Array.isArray(world.roads) ? world.roads : [];
    context.strokeStyle = 'rgba(122,133,148,0.5)';
    context.lineCap = 'butt';
    for (let index = 0; index < roads.length; index += 1) {
      const road = roads[index];
      if (!road || typeof road.x !== 'number' || typeof road.z !== 'number') continue;
      const horizontal = road.axis === 'x';
      const length = horizontal ? (road.width || 528) : (road.depth || 528);
      const thickness = horizontal ? (road.depth || 16) : (road.width || 16);
      const a = horizontal ? project(-length / 2, road.z) : project(road.x, -length / 2);
      const b = horizontal ? project(length / 2, road.z) : project(road.x, length / 2);
      context.lineWidth = Math.max(3, thickness * MAP_SCALE);
      context.beginPath();
      context.moveTo(a.x, a.y);
      context.lineTo(b.x, b.y);
      context.stroke();
    }

    const buildings = world && Array.isArray(world.buildings) ? world.buildings : [];
    context.fillStyle = 'rgba(78,86,98,0.92)';
    for (let index = 0; index < buildings.length; index += 1) {
      const building = buildings[index];
      if (!building) continue;
      if (Math.abs(building.x - point.x) > 140 || Math.abs(building.z - point.z) > 140) continue;
      const at = project(building.x, building.z);
      context.save();
      context.translate(at.x, at.y);
      context.rotate(-yaw);
      context.scale(MAP_SCALE, -MAP_SCALE);
      context.fillRect(-building.w / 2, -building.d / 2, building.w, building.d);
      context.restore();
    }

    const peds = pedList();
    context.fillStyle = 'rgba(238,243,250,0.85)';
    collectFrom(peds, ['peds', 'pedestrians', 'people', 'crowd', 'agents', 'units'], (entity) => {
      if (!entity || isDown(entity)) return;
      const at = pointOf(entity);
      if (!at) return;
      const mapped = project(at.x, at.z);
      if (Math.hypot(mapped.x - centre, mapped.y - centre) > MAP_RADIUS - 3) return;
      context.beginPath();
      context.arc(mapped.x, mapped.y, 1.7, 0, Math.PI * 2);
      context.fill();
    });

    const police = policeList();
    context.fillStyle = 'rgba(255,72,62,0.95)';
    collectFrom(police, ['cops', 'police', 'units', 'officers', 'agents', 'entries', 'list'], (entity) => {
      if (!entity || isDown(entity)) return;
      const at = pointOf(entity);
      if (!at) return;
      const mapped = project(at.x, at.z);
      if (Math.hypot(mapped.x - centre, mapped.y - centre) > MAP_RADIUS - 3) return;
      context.beginPath();
      context.arc(mapped.x, mapped.y, 2.6, 0, Math.PI * 2);
      context.fill();
    });

    const waypoint = waypointOf();
    if (waypoint) {
      const mapped = project(waypoint.x, waypoint.z, MAP_RADIUS - 10);
      context.save();
      context.translate(mapped.x, mapped.y);
      context.rotate(Math.PI / 4);
      context.fillStyle = '#ffdc55';
      context.shadowColor = 'rgba(255,210,60,0.9)';
      context.shadowBlur = 9;
      context.fillRect(-4, -4, 8, 8);
      context.restore();
    }

    context.save();
    context.translate(centre, centre);
    context.fillStyle = '#ffffff';
    context.beginPath();
    context.moveTo(0, -8);
    context.lineTo(6, 6);
    context.lineTo(0, 3);
    context.lineTo(-6, 6);
    context.closePath();
    context.fill();
    context.restore();
    context.restore();

    context.beginPath();
    context.arc(centre, centre, MAP_RADIUS - 0.5, 0, Math.PI * 2);
    context.strokeStyle = 'rgba(226,236,250,0.4)';
    context.lineWidth = 2;
    context.stroke();

    context.save();
    context.translate(centre, 13);
    context.fillStyle = 'rgba(200,214,232,0.72)';
    context.font = '600 10px system-ui, sans-serif';
    context.textAlign = 'center';
    context.fillText('PORT VIREO', 0, 0);
    context.restore();
  }

  function update(dt) {
    const step = typeof dt === 'number' && dt > 0 ? dt : 0;
    clockMinutes = (clockMinutes + step * CLOCK_RATE) % 1440;
    renderBars();
    renderMoney();
    setWanted(wantedOf(policeList(), player));
    renderWanted();
    const objective = currentObjectiveText();
    if (objectiveNode && objective !== lastObjective) {
      lastObjective = objective;
      objectiveNode.textContent = objective;
      objectiveNode.style.opacity = objective ? '1' : '0';
    }
    const rounds = player && typeof player.ammo === 'number' ? player.ammo : null;
    if (ammoNode && rounds !== null) {
      const text = String(Math.max(0, Math.round(rounds)));
      if (text !== lastAmmoText) {
        lastAmmoText = text;
        ammoNode.textContent = text;
      }
    }
    if (bannerTimer > 0) {
      bannerTimer -= step;
      if (bannerTimer <= 0 && banner) banner.style.opacity = '0';
    }
    if (subtitleTimer > 0) {
      subtitleTimer -= step;
      if (subtitleTimer <= 0 && subtitleNode) {
        subtitleNode.style.opacity = '0';
        subtitleNode.textContent = '';
      }
    }
    if (hitTimer > 0) {
      hitTimer -= step;
      if (hitTimer <= 0 && hitMarker) hitMarker.style.opacity = '0';
    }
    drawMap();
  }

  renderBars();
  renderMoney();
  renderWanted();
  drawMap();
  return api;
}
