// The city: geometry, lights and the collision boxes that go with them. buildWorld(scene, rng) puts
// a night-time grid of roads, kerbed sidewalks and varied buildings into the scene and returns the
// handles the rest of the game needs. Everything that repeats is drawn from an InstancedMesh, so the
// whole city stays at a few dozen draw calls and the seeded rng decides every variation.
export const KIND_BLOCK = 0;
export const KIND_COIN = 1;

export const EVENT_HIT = 1;
export const EVENT_COIN = 2;
export const EVENT_OVER = 4;

/** City layout, in metres. GRID x GRID blocks with PITCH between centres and ROAD wide streets. */
const GRID = 6;
const PITCH = 88;
const ROAD = 16;
const BLOCK_SIZE = PITCH - ROAD;
const SIDEWALK_H = 0.18;
const CITY = GRID * PITCH;
const HALF = CITY / 2;
const PARK = { x: -132, z: 132 };
const WATER_Z = HALF + 58;

const CONCRETE = [0x8d8c86, 0x9b9083, 0x7f7064, 0x69747d, 0x8d7c6b, 0xa19a8f, 0x5f6a73, 0x776e66];
const GLASS = [0x4f6070, 0x3f5364, 0x596773, 0x4a5a62];
const CAR_COLORS = [0x8b3232, 0x2f4f8b, 0xd6d6d2, 0x2f6b4f, 0x2b2b30, 0x9a7b32, 0x5b4a7a];
const WINDOW_LIGHT = [0xffd9a0, 0xffe6bf, 0xf7c879, 0xfff0d0, 0xdfe9ff, 0x9fc4e8];
const WINDOW_WARM = [0xffb066, 0xff9a54, 0xffc47e, 0xff7f4a, 0xffa85e, 0xffd18a];
const NEON = [
  { label: 'HOTEL', colour: '#ff5f9e' },
  { label: 'BAR', colour: '#54e0ff' },
  { label: 'LIQUOR', colour: '#ffc94d' },
  { label: 'NOODLES', colour: '#ff7a4a' },
  { label: 'PAWN', colour: '#8dff8a' },
  { label: 'MOTEL', colour: '#c48bff' },
];
const LEAVES = [0x2f5a3a, 0x2a5236, 0x376443, 0x305d3d, 0x284f33];

/** The dusk dome: a big inverted sphere with a vertical gradient burning orange over the water. */
function makeSkyDome(THREE) {
  const dome = new THREE.Mesh(new THREE.SphereGeometry(1600, 32, 24), new THREE.MeshBasicMaterial({ side: THREE.BackSide, fog: false, depthWrite: false }));
  dome.position.set(0, -120, 0);
  dome.renderOrder = -10;
  dome.frustumCulled = false;
  dome.userData.sky = true;
  setSkyGradient(THREE, dome, 'dusk');
  return dome;
}

/**
 * Paint a vertical gradient onto the sky dome. The sphere's v runs from the south pole at 0 to the
 * north pole at 1, so the horizon is v=0.5: all the interesting bands are squeezed into 0.5-0.7,
 * which is exactly the slice a street-level camera can see above the rooftops.
 */
export function setSkyGradient(THREE, dome, kind) {
  if (!dome || typeof document === 'undefined') return;
  const canvas = document.createElement('canvas');
  canvas.width = 8;
  canvas.height = 512;
  const context = canvas.getContext('2d');
  if (!context) return;
  const gradient = context.createLinearGradient(0, 0, 0, 512);
  const stops = kind === 'golden'
    ? [
        [0.0, '#1a1218'], [0.42, '#3a2a28'], [0.47, '#8d5a3e'], [0.5, '#ffc070'],
        [0.52, '#ffb066'], [0.55, '#e08a58'], [0.6, '#8f5f68'], [0.66, '#54486e'],
        [0.74, '#33405e'], [0.85, '#22304c'], [1.0, '#141d38'],
      ]
    : kind === 'blue'
      ? [
          [0.0, '#080c14'], [0.42, '#141d2e'], [0.47, '#33445e'], [0.5, '#7d8496'],
          [0.53, '#4f6484'], [0.58, '#2f4468'], [0.66, '#1d2f4e'], [0.78, '#16233b'],
          [0.9, '#111a2c'], [1.0, '#0a1220'],
        ]
      : [
          [0.0, '#161220'], [0.4, '#2c2530'], [0.46, '#8a5a44'], [0.495, '#ffbb7a'],
          [0.51, '#f0a066'], [0.535, '#c07a5e'], [0.57, '#7a5a6c'], [0.63, '#46486a'],
          [0.7, '#2e3a58'], [0.8, '#1e2a44'], [0.9, '#161f34'], [1.0, '#0f1728'],
        ];
  for (let index = 0; index < stops.length; index += 1) gradient.addColorStop(stops[index][0], stops[index][1]);
  context.fillStyle = gradient;
  context.fillRect(0, 0, 8, 512);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  if (dome.material.map) dome.material.map.dispose();
  dome.material.map = texture;
  dome.material.needsUpdate = true;
}

/** Cheap seeded noise for the canvas textures, so two screenshot takes never differ. */
function textureRandom(seed) {
  let a = seed | 0;
  return function random() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A repeating canvas texture. `paint(context, size)` fills it; nothing is fetched from disk. */
function canvasTexture(THREE, size, repeatX, repeatY, paint, seed) {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (!context) return null;
  paint(context, size, textureRandom(seed === undefined ? 7 : seed));
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeatX, repeatY);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}

/** Asphalt: dark grain, a few pale flecks of aggregate and faint tar seams. */
function makeAsphaltTexture(THREE) {
  return canvasTexture(THREE, 256, 34, 34, (context, size, random) => {
    context.fillStyle = '#6a6e77';
    context.fillRect(0, 0, size, size);
    for (let index = 0; index < 9000; index += 1) {
      const shade = 88 + Math.floor(random() * 54);
      context.fillStyle = 'rgba(' + shade + ',' + (shade + 2) + ',' + (shade + 5) + ',0.55)';
      const x = random() * size;
      const y = random() * size;
      context.fillRect(x, y, 1 + random() * 2, 1 + random() * 2);
    }
    for (let index = 0; index < 420; index += 1) {
      context.fillStyle = random() < 0.5 ? 'rgba(196,196,192,0.22)' : 'rgba(40,42,48,0.35)';
      context.fillRect(random() * size, random() * size, 1, 1);
    }
    context.strokeStyle = 'rgba(46,48,54,0.45)';
    context.lineWidth = 2;
    for (let index = 0; index < 3; index += 1) {
      context.beginPath();
      context.moveTo(random() * size, 0);
      context.bezierCurveTo(random() * size, size * 0.35, random() * size, size * 0.7, random() * size, size);
      context.stroke();
    }
    const glow = context.createLinearGradient(0, size * 0.38, 0, size * 0.62);
    glow.addColorStop(0, 'rgba(180,184,192,0)');
    glow.addColorStop(0.5, 'rgba(180,184,192,0.14)');
    glow.addColorStop(1, 'rgba(180,184,192,0)');
    context.fillStyle = glow;
    context.fillRect(0, size * 0.38, size, size * 0.24);
  }, 11);
}

/** Concrete paving slabs with joint lines and a little speckle. */
function makeSidewalkTexture(THREE) {
  return canvasTexture(THREE, 256, 8, 8, (context, size, random) => {
    context.fillStyle = '#b9b5ab';
    context.fillRect(0, 0, size, size);
    for (let index = 0; index < 2600; index += 1) {
      const shade = 160 + Math.floor(random() * 62);
      context.fillStyle = 'rgba(' + shade + ',' + (shade - 4) + ',' + (shade - 12) + ',0.35)';
      context.fillRect(random() * size, random() * size, 1 + random() * 2, 1 + random() * 2);
    }
    context.strokeStyle = 'rgba(96,92,84,0.6)';
    context.lineWidth = 3;
    for (let step = 0; step <= 4; step += 1) {
      const at = (step * size) / 4;
      context.beginPath();
      context.moveTo(at, 0);
      context.lineTo(at, size);
      context.stroke();
      context.beginPath();
      context.moveTo(0, at);
      context.lineTo(size, at);
      context.stroke();
    }
    context.strokeStyle = 'rgba(190,186,178,0.25)';
    context.lineWidth = 1;
    for (let step = 0; step <= 4; step += 1) {
      const at = (step * size) / 4 + 2;
      context.beginPath();
      context.moveTo(at, 0);
      context.lineTo(at, size);
      context.stroke();
    }
  }, 23);
}

/** Brick: staggered courses, warm mortar and per-brick colour jitter. */
function makeBrickTexture(THREE) {
  return canvasTexture(THREE, 256, 5, 7, (context, size, random) => {
    context.fillStyle = '#8f8378';
    context.fillRect(0, 0, size, size);
    const rowHeight = 16;
    const brickWidth = 32;
    for (let row = 0; row * rowHeight < size; row += 1) {
      const offset = row % 2 === 0 ? 0 : brickWidth / 2;
      for (let col = -1; col * brickWidth < size + brickWidth; col += 1) {
        const warm = 126 + Math.floor(random() * 58);
        context.fillStyle = 'rgb(' + (warm + 20) + ',' + (warm - 12) + ',' + (warm - 28) + ')';
        context.fillRect(col * brickWidth + offset + 2, row * rowHeight + 2, brickWidth - 3, rowHeight - 3);
        context.fillStyle = 'rgba(255,240,220,0.05)';
        context.fillRect(col * brickWidth + offset + 2, row * rowHeight + 2, brickWidth - 3, 2);
      }
    }
  }, 31);
}

/** Curtain glass: deep blue panes between pale mullions, a few panes catching the sky. */
function makeGlassTexture(THREE) {
  return canvasTexture(THREE, 256, 6, 6, (context, size, random) => {
    context.fillStyle = '#4b6377';
    context.fillRect(0, 0, size, size);
    const cell = 32;
    for (let y = 0; y < size; y += cell) {
      for (let x = 0; x < size; x += cell) {
        const lift = Math.floor(random() * 24);
        context.fillStyle = 'rgba(' + (92 + lift) + ',' + (118 + lift) + ',' + (140 + lift) + ',0.9)';
        context.fillRect(x + 2, y + 2, cell - 4, cell - 4);
        if (random() < 0.14) {
          context.fillStyle = 'rgba(255,196,130,0.5)';
          context.fillRect(x + 3, y + 3, cell - 6, cell - 6);
        }
        context.fillStyle = 'rgba(200,220,240,0.16)';
        context.fillRect(x + 2, y + 2, cell - 4, 3);
      }
    }
    context.strokeStyle = 'rgba(170,182,196,0.55)';
    context.lineWidth = 2;
    for (let at = 0; at <= size; at += cell) {
      context.beginPath();
      context.moveTo(at, 0);
      context.lineTo(at, size);
      context.stroke();
      context.beginPath();
      context.moveTo(0, at);
      context.lineTo(size, at);
      context.stroke();
    }
  }, 43);
}

/** A neon shop sign: glowing canvas lettering, transparent everywhere else. */
function makeNeonTexture(THREE, label, colour, size) {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = size || 512;
  canvas.height = 128;
  const context = canvas.getContext('2d');
  if (!context) return null;
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.font = '700 74px ui-monospace, Menlo, Consolas, monospace';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.shadowColor = colour;
  context.shadowBlur = 26;
  context.fillStyle = colour;
  context.fillText(label, canvas.width / 2, canvas.height / 2);
  context.shadowBlur = 10;
  context.fillStyle = '#fff8ee';
  context.globalAlpha = 0.75;
  context.fillText(label, canvas.width / 2, canvas.height / 2);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

/** mulberry32 again, only if a caller forgets the seeded generator: buildWorld must never call Math.random. */
function fallbackRandom(seed) {
  let a = seed | 0;
  return function random() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** One palm: a leaning segmented trunk and six drooping fronds, all in one vertex-coloured geometry. */
function makePalmGeometry(THREE) {
  const parts = [];
  const trunkHeight = 6.4;
  for (let segment = 0; segment < 4; segment += 1) {
    const radius = 0.32 - segment * 0.05;
    const geometry = new THREE.CylinderGeometry(radius * 0.85, radius, trunkHeight / 4 + 0.12, 6);
    geometry.translate(0, trunkHeight / 8 + segment * (trunkHeight / 4), 0);
    geometry.translate(segment * 0.12, 0, 0);
    parts.push(geometry, 0x6d5741);
  }
  const top = new THREE.Vector3(0.4, trunkHeight, 0);
  for (let frond = 0; frond < 6; frond += 1) {
    const angle = (frond / 6) * Math.PI * 2;
    const geometry = new THREE.ConeGeometry(0.42, 3.4, 3);
    geometry.scale(1, 0.16, 1);
    geometry.rotateX(Math.PI / 2);
    geometry.translate(0, 0, 1.7);
    geometry.rotateZ(-0.42);
    geometry.rotateY(angle);
    geometry.translate(top.x, top.y - 0.1, top.z);
    parts.push(geometry, frond % 2 === 0 ? 0x2f5d3c : 0x37694a);
  }
  const merged = mergeColoured(THREE, parts);
  return merged;
}

/** Merge [geometry, colour, geometry, colour, ...] into one non-indexed geometry with vertex colours. */
function mergeColoured(THREE, parts) {
  const positions = [];
  const normals = [];
  const colors = [];
  const colour = new THREE.Color();
  for (let index = 0; index < parts.length; index += 2) {
    const geometry = parts[index];
    const plain = geometry.index ? geometry.toNonIndexed() : geometry;
    const position = plain.getAttribute('position');
    const normal = plain.getAttribute('normal');
    colour.set(parts[index + 1]);
    for (let vertex = 0; vertex < position.count; vertex += 1) {
      positions.push(position.getX(vertex), position.getY(vertex), position.getZ(vertex));
      normals.push(normal.getX(vertex), normal.getY(vertex), normal.getZ(vertex));
      colors.push(colour.r, colour.g, colour.b);
    }
    if (plain !== geometry) plain.dispose();
    geometry.dispose();
  }
  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  merged.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  merged.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  merged.computeBoundingSphere();
  return merged;
}

/** A parked car's three pieces, shared by every car and drawn instanced: body, cabin, wheel. */
function makeCarParts(THREE) {
  const wheel = new THREE.CylinderGeometry(0.36, 0.36, 0.28, 8);
  wheel.rotateZ(Math.PI / 2);
  const body = new THREE.BoxGeometry(1.85, 0.72, 4.1);
  body.translate(0, 0.62, 0);
  const cabin = new THREE.BoxGeometry(1.62, 0.6, 2.0);
  cabin.translate(0, 1.26, -0.15);
  return { body, cabin, wheel };
}

export function buildWorld(scene, rng) {
  const THREE = globalThis.THREE;
  if (!THREE) throw new Error('buildWorld needs the global THREE from three.min.js');
  const random = typeof rng === 'function' ? rng : fallbackRandom(1);
  const rand = (min, max) => min + random() * (max - min);
  const pick = (list) => list[Math.floor(random() * list.length) % list.length];
  const chance = (p) => random() < p;

  const colliders = [];
  const roads = [];
  const sidewalks = [];
  const buildings = [];
  const dummy = new THREE.Object3D();
  const tint = new THREE.Color();
  const WHITE = new THREE.Color(0xffffff);

  /** Add one InstancedMesh for a list of { x, y, z, sx, sy, sz, rx, ry, rz, color } placements. */
  function instanced(geometry, material, items, shadows) {
    if (items.length === 0) return null;
    const mesh = new THREE.InstancedMesh(geometry, material, items.length);
    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];
      dummy.position.set(item.x, item.y, item.z);
      dummy.rotation.set(item.rx || 0, item.ry || 0, item.rz || 0);
      dummy.scale.set(item.sx === undefined ? 1 : item.sx, item.sy === undefined ? 1 : item.sy, item.sz === undefined ? 1 : item.sz);
      dummy.updateMatrix();
      mesh.setMatrixAt(index, dummy.matrix);
      if (item.color !== undefined) mesh.setColorAt(index, tint.set(item.color));
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.castShadow = !!shadows;
    mesh.receiveShadow = !!shadows;
    mesh.frustumCulled = false;
    scene.add(mesh);
    return mesh;
  }

  function boxCollider(x, z, w, d, height) {
    colliders.push({
      min: { x: x - w / 2, y: 0, z: z - d / 2 },
      max: { x: x + w / 2, y: height, z: z + d / 2 },
    });
  }

  // Dusk: a warm sun low over the water, a cool sky dome, and haze that swallows the far towers.
  scene.background = new THREE.Color(0x25314a);
  scene.fog = new THREE.FogExp2(0x1b2436, 0.0035);
  const skyDome = makeSkyDome(THREE);
  if (skyDome) scene.add(skyDome);
  const hemi = new THREE.HemisphereLight(0x2b3a55, 0x1a1410, 0.55);
  scene.add(hemi);
  scene.add(new THREE.AmbientLight(0x3a3a44, 0.18));
  const sun = new THREE.DirectionalLight(0xffb26b, 2.2);
  // ~20 degrees above the horizon, back over the harbour so the streets get long shadows.
  const sunDistance = 420;
  const sunAngle = THREE.MathUtils.degToRad(20);
  sun.position.set(Math.cos(sunAngle) * sunDistance * 0.55, Math.sin(sunAngle) * sunDistance, Math.cos(sunAngle) * sunDistance);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -170;
  sun.shadow.camera.right = 170;
  sun.shadow.camera.top = 170;
  sun.shadow.camera.bottom = -170;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 900;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.04;
  sun.target.position.set(0, 0, 40);
  scene.add(sun);
  scene.add(sun.target);
  // Two warm street lights near the staged corner, plus two further down the avenue.
  for (const [x, z, heat] of [[0, 64, 60], [0, 96, 55], [0, -40, 45], [0, 24, 40]]) {
    const lamp = new THREE.PointLight(0xffb266, heat, 34, 2);
    lamp.position.set(x, 5.4, z);
    scene.add(lamp);
  }

  const starPositions = [];
  for (let index = 0; index < 380; index += 1) starPositions.push(rand(-1000, 1000), rand(230, 560), rand(-1000, 1000));
  const starGeometry = new THREE.BufferGeometry();
  starGeometry.setAttribute('position', new THREE.Float32BufferAttribute(starPositions, 3));
  scene.add(new THREE.Points(starGeometry, new THREE.PointsMaterial({ color: 0xa9c2e2, size: 1.6, sizeAttenuation: true, transparent: true, opacity: 0.6, fog: false })));

  const asphaltMap = makeAsphaltTexture(THREE, 86, 86);
  const asphalt = new THREE.MeshStandardMaterial({ color: 0xffffff, map: asphaltMap, roughness: 0.88, metalness: 0.04 });
  const asphaltPlain = new THREE.MeshStandardMaterial({ color: 0x2a2d34, map: makeAsphaltTexture(THREE, 6, 24), roughness: 0.92, metalness: 0.05 });
  const concreteMap = makeSidewalkTexture(THREE, 1, 1);
  const concrete = new THREE.MeshStandardMaterial({ color: 0xffffff, map: concreteMap, roughness: 0.93, metalness: 0.02 });
  const kerbMaterial = new THREE.MeshStandardMaterial({ color: 0x9a9da6, roughness: 0.86 });
  const paint = new THREE.MeshStandardMaterial({ color: 0xd7d6c8, roughness: 0.66 });
  const metal = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5, metalness: 0.55 });
  const glow = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const waterMaterial = new THREE.MeshStandardMaterial({ color: 0x122a3d, roughness: 0.16, metalness: 0.92 });
  const brickMap = makeBrickTexture(THREE, 1, 1);
  const glassMap = makeGlassTexture(THREE, 1, 1);
  const brickWall = new THREE.MeshStandardMaterial({ color: 0xffffff, map: brickMap, roughness: 0.9, metalness: 0.02 });
  const glassWall = new THREE.MeshStandardMaterial({ color: 0xffffff, map: glassMap, roughness: 0.25, metalness: 0.65 });

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(CITY + 460, CITY + 140), asphalt);
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(0, 0, -6);
  ground.receiveShadow = true;
  scene.add(ground);
  const bedrock = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000), new THREE.MeshStandardMaterial({ color: 0x161a21, roughness: 1 }));
  bedrock.rotation.x = -Math.PI / 2;
  bedrock.position.set(0, -0.9, 0);
  scene.add(bedrock);

  const slabItems = [];
  const kerbItems = [];
  const dashItems = [];
  const crossingItems = [];
  const brickItems = [];
  const glassItems = [];
  const windowItems = [];
  const rooftopItems = [];
  const tankItems = [];
  const poleItems = [];
  const armItems = [];
  const lampItems = [];
  const poolItems = [];
  const trunkItems = [];
  const leafItems = [];
  const hydrantItems = [];
  const hydrantTopItems = [];
  const binItems = [];
  const benchItems = [];
  const benchBackItems = [];
  const wetItems = [];
  const carBodies = [];
  const carCabins = [];
  const carWheels = [];
  const farTowers = [];
  const farWindows = [];
  const beaconSpots = [];
  const palms = [];

  const roadCenters = [];
  for (let index = 0; index < GRID - 1; index += 1) roadCenters.push((index - (GRID - 2) / 2) * PITCH);

  for (const center of roadCenters) {
    roads.push({ x: center, z: 0, width: ROAD, depth: CITY, axis: 'z' });
    roads.push({ x: 0, z: center, width: CITY, depth: ROAD, axis: 'x' });
  }

  /** The park: grass, a pond, two paths, trees and benches. Placed before the block loop so it fills one block. */
  function buildPark(bx, bz) {
    const grass = new THREE.Mesh(new THREE.BoxGeometry(BLOCK_SIZE - 6, 0.2, BLOCK_SIZE - 6), new THREE.MeshStandardMaterial({ color: 0x35573b, roughness: 0.96 }));
    grass.position.set(bx, 0.1, bz);
    grass.receiveShadow = true;
    scene.add(grass);
    const pond = new THREE.Mesh(new THREE.CircleGeometry(8, 26), waterMaterial);
    pond.rotation.x = -Math.PI / 2;
    pond.position.set(bx + 5, 0.215, bz - 4);
    scene.add(pond);
    const pathMaterial = new THREE.MeshStandardMaterial({ color: 0x8d897d, roughness: 0.95 });
    const pathA = new THREE.Mesh(new THREE.BoxGeometry(BLOCK_SIZE - 8, 0.22, 6), pathMaterial);
    pathA.position.set(bx, 0.11, bz + 12);
    pathA.receiveShadow = true;
    scene.add(pathA);
    const pathB = new THREE.Mesh(new THREE.BoxGeometry(6, 0.22, BLOCK_SIZE - 10), pathMaterial);
    pathB.position.set(bx - 12, 0.11, bz);
    pathB.receiveShadow = true;
    scene.add(pathB);
    for (let index = 0; index < 14; index += 1) {
      const tx = bx + rand(-27, 27);
      const tz = bz + rand(-27, 27);
      if (Math.hypot(tx - (bx + 5), tz - (bz - 4)) < 11.5) continue;
      trunkItems.push({ x: tx, y: 0.2, z: tz, sx: rand(0.9, 1.4), sy: rand(1.0, 1.6), sz: rand(0.9, 1.4), color: 0x5c452f });
      leafItems.push({ x: tx, y: 0.2 + rand(3.2, 4.4), z: tz, sx: rand(2.1, 3.1), sy: rand(2.0, 2.9), sz: rand(2.1, 3.1), color: pick(LEAVES) });
    }
    for (let index = 0; index < 6; index += 1) {
      const angle = (index / 6) * Math.PI * 2 + 0.4;
      benchItems.push({ x: bx + 5 + Math.cos(angle) * 13, y: 0.62, z: bz - 4 + Math.sin(angle) * 13, ry: -angle + Math.PI / 2 });
      benchBackItems.push({ x: bx + 5 + Math.cos(angle) * 12.72, y: 0.94, z: bz - 4 + Math.sin(angle) * 12.72, ry: -angle + Math.PI / 2 });
    }
  }

  buildPark(PARK.x, PARK.z);

  for (let gx = 0; gx < GRID; gx += 1) {
    for (let gz = 0; gz < GRID; gz += 1) {
      const bx = (gx - (GRID - 1) / 2) * PITCH;
      const bz = (gz - (GRID - 1) / 2) * PITCH;
      const isPark = Math.abs(bx - PARK.x) < 1 && Math.abs(bz - PARK.z) < 1;
      const edge = BLOCK_SIZE / 2;

      slabItems.push({ x: bx, y: SIDEWALK_H / 2, z: bz, sx: BLOCK_SIZE, sy: SIDEWALK_H, sz: BLOCK_SIZE, color: 0x6f7278 });
      sidewalks.push({ min: { x: bx - edge, y: 0, z: bz - edge }, max: { x: bx + edge, y: SIDEWALK_H, z: bz + edge }, height: SIDEWALK_H });

      kerbItems.push({ x: bx, y: (SIDEWALK_H + 0.06) / 2, z: bz - edge, sx: BLOCK_SIZE + 0.4, sy: SIDEWALK_H + 0.06, sz: 0.4 });
      kerbItems.push({ x: bx, y: (SIDEWALK_H + 0.06) / 2, z: bz + edge, sx: BLOCK_SIZE + 0.4, sy: SIDEWALK_H + 0.06, sz: 0.4 });
      kerbItems.push({ x: bx - edge, y: (SIDEWALK_H + 0.06) / 2, z: bz, sx: 0.4, sy: SIDEWALK_H + 0.06, sz: BLOCK_SIZE + 0.4 });
      kerbItems.push({ x: bx + edge, y: (SIDEWALK_H + 0.06) / 2, z: bz, sx: 0.4, sy: SIDEWALK_H + 0.06, sz: BLOCK_SIZE + 0.4 });

      // Street lights on two or three corners, the lamp arm reaching out over the roadway.
      const corners = [[-1, -1], [1, -1], [-1, 1], [1, 1]];
      for (let index = corners.length - 1; index > 0; index -= 1) {
        const other = Math.floor(random() * (index + 1));
        const swap = corners[index];
        corners[index] = corners[other];
        corners[other] = swap;
      }
      const lampCount = chance(0.45) ? 3 : 2;
      for (let index = 0; index < lampCount; index += 1) {
        const sx = corners[index][0];
        const sz = corners[index][1];
        const length = Math.SQRT2;
        const dx = sx / length;
        const dz = sz / length;
        const px = bx + sx * (edge - 1.4);
        const pz = bz + sz * (edge - 1.4);
        poleItems.push({ x: px, y: SIDEWALK_H, z: pz, color: 0x3d4249 });
        armItems.push({ x: px, y: SIDEWALK_H + 4.5, z: pz, ry: Math.atan2(-dz, dx), color: 0x3d4249 });
        lampItems.push({ x: px + dx * 1.5, y: SIDEWALK_H + 4.5, z: pz + dz * 1.5, color: 0xffd39a });
        poolItems.push({ x: px + dx * 2.9, y: 0.035, z: pz + dz * 2.9, rx: -Math.PI / 2 });
        // A wet specular smear running down the roadway from under each lamp head.
        wetItems.push({
          x: px + dx * 5.4,
          y: 0.045,
          z: pz + dz * 5.4,
          rx: -Math.PI / 2,
          ry: 0,
          rz: Math.atan2(dx, dz),
          sx: 1,
          sy: 1,
        });
      }

      if (chance(0.55)) {
        const sx = chance(0.5) ? 1 : -1;
        const hx = bx + sx * (edge - 2.8);
        const hz = bz + rand(-24, 24);
        hydrantItems.push({ x: hx, y: SIDEWALK_H + 0.26, z: hz, color: 0xb03a2e });
        hydrantTopItems.push({ x: hx, y: SIDEWALK_H + 0.55, z: hz, color: 0xc9463a });
      }

      // Bins and the odd bench keep the kerb from reading as an empty grey strip.
      if (chance(0.7)) {
        const side = chance(0.5) ? 1 : -1;
        binItems.push({ x: bx + side * (edge - 1.9), y: SIDEWALK_H, z: bz + rand(-26, 26) });
      }
      if (chance(0.5)) {
        const side = chance(0.5) ? 1 : -1;
        const bz2 = bz + rand(-26, 26);
        benchItems.push({ x: bx + side * (edge - 2.2), y: 0.62, z: bz2, ry: side > 0 ? -Math.PI / 2 : Math.PI / 2 });
        benchBackItems.push({ x: bx + side * (edge - 2.2) + (side > 0 ? 0.26 : -0.26), y: 0.94, z: bz2, ry: side > 0 ? -Math.PI / 2 : Math.PI / 2 });
      }

      for (const side of chance(0.5) ? [0, 1] : [2, 3]) {
        for (let index = 0; index < 2; index += 1) {
          const along = rand(-24, 24);
          const inset = edge - 2.6;
          const tx = side < 2 ? bx + (side === 0 ? -inset : inset) : bx + along;
          const tz = side < 2 ? bz + along : bz + (side === 2 ? -inset : inset);
          trunkItems.push({ x: tx, y: SIDEWALK_H, z: tz, sx: rand(0.82, 1.12), sy: rand(0.9, 1.2), sz: rand(0.82, 1.12), color: 0x54402c });
          leafItems.push({ x: tx, y: SIDEWALK_H + rand(2.6, 3.1), z: tz, sx: rand(1.5, 2.1), sy: rand(1.4, 1.9), sz: rand(1.5, 2.1), color: pick(LEAVES) });
        }
      }

      // A parked car sometimes sits in the gutter lane along one face of the block.
      if (chance(0.5)) {
        const side = Math.floor(random() * 4);
        const along = rand(-20, 20);
        const gutter = edge + 2.6;
        let cx = bx;
        let cz = bz;
        let ry = 0;
        if (side === 0) {
          cx = bx - gutter;
          cz = bz + along;
          ry = 0;
        } else if (side === 1) {
          cx = bx + gutter;
          cz = bz + along;
          ry = 0;
        } else if (side === 2) {
          cx = bx + along;
          cz = bz - gutter;
          ry = Math.PI / 2;
        } else {
          cx = bx + along;
          cz = bz + gutter;
          ry = Math.PI / 2;
        }
        const color = pick(CAR_COLORS);
        carBodies.push({ x: cx, y: 0, z: cz, ry, color });
        carCabins.push({ x: cx, y: 0, z: cz, ry });
        for (const [ox, oz] of [[-0.94, 1.32], [0.94, 1.32], [-0.94, -1.32], [0.94, -1.32]]) {
          const cos = Math.cos(ry);
          const sin = Math.sin(ry);
          carWheels.push({ x: cx + ox * cos + oz * sin, y: 0, z: cz - ox * sin + oz * cos, ry, rx: 0, color: 0x1b1d21 });
        }
        if (side < 2) boxCollider(cx, cz, 2.1, 4.4, 1.5);
        else boxCollider(cx, cz, 4.4, 2.1, 1.5);
      }

      if (isPark) continue;

      // Lots: one tower, two halves, or a small cluster of three, always inside the kerb.
      const roll = random();
      const lots = [];
      if (roll < 0.28) {
        const w = rand(24, 44);
        const d = rand(24, 44);
        lots.push({ x: bx + rand(-2, 2), z: bz + rand(-2, 2), w, d });
      } else if (roll < 0.84) {
        const gap = rand(3, 6);
        if (chance(0.5)) {
          const w = (58 - gap) / 2;
          lots.push({ x: bx - (w + gap) / 2, z: bz + rand(-3, 3), w, d: rand(34, 56) });
          lots.push({ x: bx + (w + gap) / 2, z: bz + rand(-3, 3), w, d: rand(34, 56) });
        } else {
          const d = (58 - gap) / 2;
          lots.push({ x: bx + rand(-3, 3), z: bz - (d + gap) / 2, w: rand(34, 56), d });
          lots.push({ x: bx + rand(-3, 3), z: bz + (d + gap) / 2, w: rand(34, 56), d });
        }
      } else {
        const d = rand(42, 56);
        lots.push({ x: bx - 16, z: bz, w: 26, d });
        lots.push({ x: bx + 16, z: bz - 15.5, w: 26, d: 27 });
        lots.push({ x: bx + 16, z: bz + 15.5, w: 26, d: 27 });
      }

      const distance = Math.hypot(bx, bz);
      const downtown = Math.max(0, 1 - distance / 300);
      for (const lot of lots) {
        let height = 6 + random() * 15 + downtown * random() * 42;
        if (chance(0.07)) height = 50 + random() * 10;
        height = Math.min(60, Math.max(6, height));
        const glass = chance(0.26 + downtown * 0.24);
        const color = glass ? pick(GLASS) : pick(CONCRETE);
        buildings.push({ x: lot.x, z: lot.z, w: lot.w, d: lot.d, height, color });
        // Glass towers get the curtain-wall texture, the rest get brick; the instance colour is
        // lightened so the texture detail survives instead of multiplying down to mud.
        const wallValues = glass ? glassItems : brickItems;
        tint.set(color).lerp(WHITE, glass ? 0.55 : 0.62);
        wallValues.push({ x: lot.x, y: SIDEWALK_H + height / 2, z: lot.z, sx: lot.w, sy: height, sz: lot.d, color: tint.getHex() });
        boxCollider(lot.x, lot.z, lot.w, lot.d, SIDEWALK_H + height);

        // Emissive window strips on all four faces, a lit or unlit colour per window.
        const rowStep = glass ? 2.9 : 3.3;
        const colStep = glass ? 2.7 : 3.3;
        const innerW = lot.w - 2.6;
        const innerD = lot.d - 2.6;
        const rows = Math.min(16, Math.max(1, Math.floor((height - 3.4) / rowStep)));
        const columnsX = Math.max(1, Math.floor(innerW / colStep));
        const columnsZ = Math.max(1, Math.floor(innerD / colStep));
        for (let row = 0; row < rows; row += 1) {
          const y = SIDEWALK_H + 2.9 + row * rowStep;
          for (let col = 0; col < columnsX; col += 1) {
            const u = -innerW / 2 + colStep / 2 + col * colStep;
            const lit = chance(glass ? 0.82 : 0.66);
            const windowColor = lit ? (chance(0.16) ? pick(WINDOW_WARM) : pick(WINDOW_LIGHT)) : 0x22272f;
            windowItems.push({ x: lot.x + u, y, z: lot.z + lot.d / 2 + 0.06, sx: 1.3, sy: 0.8, sz: 0.12, color: windowColor });
            windowItems.push({ x: lot.x + u, y, z: lot.z - lot.d / 2 - 0.06, sx: 1.3, sy: 0.8, sz: 0.12, color: windowColor });
          }
          for (let col = 0; col < columnsZ; col += 1) {
            const u = -innerD / 2 + colStep / 2 + col * colStep;
            const lit = chance(glass ? 0.82 : 0.66);
            const windowColor = lit ? (chance(0.16) ? pick(WINDOW_WARM) : pick(WINDOW_LIGHT)) : 0x22272f;
            windowItems.push({ x: lot.x + lot.w / 2 + 0.06, y, z: lot.z + u, sx: 0.12, sy: 0.8, sz: 1.3, color: windowColor });
            windowItems.push({ x: lot.x - lot.w / 2 - 0.06, y, z: lot.z + u, sx: 0.12, sy: 0.8, sz: 1.3, color: windowColor });
          }
        }

        if (chance(0.45)) {
          rooftopItems.push({
            x: lot.x + rand(-lot.w * 0.16, lot.w * 0.16),
            y: SIDEWALK_H + height + 0.85,
            z: lot.z + rand(-lot.d * 0.16, lot.d * 0.16),
            sx: lot.w * rand(0.24, 0.42),
            sy: 1.7,
            sz: lot.d * rand(0.24, 0.42),
            color: 0x4f5155,
          });
        }
        if (height > 16 && chance(0.35)) {
          tankItems.push({ x: lot.x + rand(-lot.w * 0.2, lot.w * 0.2), y: SIDEWALK_H + height + 1.2, z: lot.z + rand(-lot.d * 0.2, lot.d * 0.2), color: 0x6b5c46 });
        }
      }
    }
  }

  // The harbour strip: a promenade in front of the last row, a quay wall, then open water, with a
  // railing and a line of palms. The city turns its back to it, so the far side stays calm.
  const promenade = new THREE.Mesh(new THREE.BoxGeometry(CITY + 260, 0.16, 54), new THREE.MeshStandardMaterial({ color: 0x777a80, roughness: 0.9 }));
  promenade.position.set(0, 0.08, HALF + 27);
  promenade.receiveShadow = true;
  scene.add(promenade);
  sidewalks.push({ min: { x: -(CITY + 260) / 2, y: 0, z: HALF }, max: { x: (CITY + 260) / 2, y: 0.16, z: HALF + 54 }, height: 0.16 });

  const quay = new THREE.Mesh(new THREE.BoxGeometry(CITY + 280, 1.4, 2.6), kerbMaterial);
  quay.position.set(0, 0.1, WATER_Z - 1.3);
  quay.receiveShadow = true;
  scene.add(quay);

  const water = new THREE.Mesh(new THREE.PlaneGeometry(2400, 1400), waterMaterial);
  water.rotation.x = -Math.PI / 2;
  water.position.set(0, -0.5, WATER_Z + 640);
  scene.add(water);

  const railTop = new THREE.Mesh(new THREE.BoxGeometry(CITY + 240, 0.1, 0.1), metal);
  railTop.position.set(0, 1.15, WATER_Z - 2.2);
  scene.add(railTop);
  const railPosts = [];
  for (let x = -(CITY + 240) / 2; x <= (CITY + 240) / 2; x += 4) railPosts.push({ x, y: 0.72, z: WATER_Z - 2.2, sx: 0.1, sy: 1.05, sz: 0.1 });
  instanced(new THREE.BoxGeometry(1, 1, 1), metal, railPosts, false);

  const palmGeometry = makePalmGeometry(THREE);
  const palmMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0.02, side: THREE.DoubleSide });
  for (let index = 0; index < 24; index += 1) {
    const holder = new THREE.Group();
    const palmMesh = new THREE.Mesh(palmGeometry, palmMaterial);
    palmMesh.castShadow = true;
    holder.add(palmMesh);
    holder.position.set(-(CITY + 150) / 2 + index * ((CITY + 150) / 23) + rand(-2.5, 2.5), 0.16, HALF + 15 + rand(-1.5, 1.5));
    holder.rotation.y = rand(0, Math.PI * 2);
    holder.scale.setScalar(rand(0.85, 1.2));
    scene.add(holder);
    palms.push({ holder, phase: rand(0, Math.PI * 2), strength: rand(0.7, 1.3) });
  }
  for (let index = 0; index < 4; index += 1) {
    const holder = new THREE.Group();
    const palmMesh = new THREE.Mesh(palmGeometry, palmMaterial);
    palmMesh.castShadow = true;
    holder.add(palmMesh);
    holder.position.set(PARK.x + rand(-20, 20), 0.22, PARK.z + rand(-20, 20));
    holder.rotation.y = rand(0, Math.PI * 2);
    holder.scale.setScalar(rand(0.8, 1.0));
    scene.add(holder);
    palms.push({ holder, phase: rand(0, Math.PI * 2), strength: rand(0.5, 0.9) });
  }

  // Lane dashes down the middle of every road, broken at the junctions, plus zebra crossings there.
  for (const center of roadCenters) {
    for (let z = -HALF + 8; z <= HALF - 8; z += 9) {
      let junction = false;
      for (const other of roadCenters) if (Math.abs(z - other) < 12) junction = true;
      if (!junction) dashItems.push({ x: center, y: 0.02, z, sx: 0.32, sy: 0.04, sz: 3.4 });
    }
    for (let x = -HALF + 8; x <= HALF - 8; x += 9) {
      let junction = false;
      for (const other of roadCenters) if (Math.abs(x - other) < 12) junction = true;
      if (!junction) dashItems.push({ x, y: 0.02, z: center, sx: 3.4, sy: 0.04, sz: 0.32 });
    }
  }
  for (const cx of roadCenters) {
    for (const cz of roadCenters) {
      for (let bar = -2; bar <= 2; bar += 1) {
        crossingItems.push({ x: cx + bar * 3, y: 0.03, z: cz + 10.4, sx: 1.6, sy: 0.05, sz: 3.4 });
        crossingItems.push({ x: cx + bar * 3, y: 0.03, z: cz - 10.4, sx: 1.6, sy: 0.05, sz: 3.4 });
        crossingItems.push({ x: cx + 10.4, y: 0.03, z: cz + bar * 3, sx: 3.4, sy: 0.05, sz: 1.6 });
        crossingItems.push({ x: cx - 10.4, y: 0.03, z: cz + bar * 3, sx: 3.4, sy: 0.05, sz: 1.6 });
      }
    }
  }

  // The skyline behind the water: tall, dark towers whose lit windows read as the far city.
  for (let index = 0; index < 38; index += 1) {
    const side = index % 3;
    let tx;
    let tz;
    if (side === 2) {
      tx = rand(-900, 900);
      tz = WATER_Z + rand(120, 620);
    } else {
      const angle = rand(0, Math.PI * 2);
      const radius = rand(420, 780);
      tx = Math.cos(angle) * radius;
      tz = Math.sin(angle) * radius;
      if (Math.abs(tx) < HALF + 40 && tz < HALF + 40) continue;
    }
    const height = rand(52, 155);
    const w = rand(24, 48);
    const d = rand(24, 48);
    farTowers.push({ x: tx, y: height / 2 - 0.5, z: tz, sx: w, sy: height, sz: d, color: pick([0x212831, 0x2a3039, 0x1c232b, 0x323942]) });
    if (height > 118 && beaconSpots.length < 8) beaconSpots.push({ x: tx, y: height + 1.4, z: tz });

    const faceZ = tz > 0 ? -1 : 1;
    const faceX = tx > 0 ? -1 : 1;
    const rows = Math.floor(height / 8.5);
    const cols = Math.floor(w / 7);
    for (let row = 0; row < rows; row += 1) {
      if (!chance(0.6)) continue;
      const y = 6 + row * 8.5;
      for (let col = 0; col < cols; col += 1) {
        if (!chance(0.55)) continue;
        const offset = -w / 2 + 4 + col * 7;
        if (Math.abs(tz) > Math.abs(tx)) {
          farWindows.push({ x: tx + offset, y, z: tz + faceZ * (d / 2 + 0.12), sx: 2.3, sy: 1.5, sz: 0.12, color: pick(WINDOW_LIGHT) });
        } else {
          farWindows.push({ x: tx + faceX * (w / 2 + 0.12), y, z: tz + offset, sx: 0.12, sy: 1.5, sz: 2.3, color: pick(WINDOW_LIGHT) });
        }
      }
    }
  }
  if (beaconSpots.length === 0) beaconSpots.push({ x: 0, y: 72, z: WATER_Z + 300 });
  const beacons = [];
  const beaconGeometry = new THREE.SphereGeometry(0.9, 6, 5);
  for (const spot of beaconSpots) {
    const beacon = new THREE.Mesh(beaconGeometry, new THREE.MeshBasicMaterial({ color: 0xff5a4a, transparent: true }));
    beacon.position.set(spot.x, spot.y, spot.z);
    scene.add(beacon);
    beacons.push(beacon);
  }

  // Everything that repeated is one draw call from here on. The unit box is stretched by each
  // instance's scale; poles and arms are pre-translated so their base sits at the placement point.
  // Neon shop signs on the street-facing faces of the lots closest to the centre. Each is one
  // emissive plane with canvas lettering, plus a soft additive halo so it blooms at dusk.
  const neonSigns = [];
  for (let index = 0; index < buildings.length; index += 1) {
    const building = buildings[index];
    if (Math.hypot(building.x, building.z) > 190) continue;
    if (building.height < 7) continue;
    if (!chance(0.55)) continue;
    const sign = pick(NEON);
    const texture = makeNeonTexture(THREE, sign.label, sign.colour, 512);
    if (!texture) continue;
    const height = 3.2;
    const width = height * 4;
    const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, fog: true });
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(width, height), material);
    const face = Math.floor(random() * 4);
    const y = SIDEWALK_H + 3.4 + random() * 1.6;
    if (face === 0) {
      plane.position.set(building.x, y, building.z - building.d / 2 - 0.12);
      plane.rotation.y = Math.PI;
    } else if (face === 1) {
      plane.position.set(building.x, y, building.z + building.d / 2 + 0.12);
    } else if (face === 2) {
      plane.position.set(building.x - building.w / 2 - 0.12, y, building.z);
      plane.rotation.y = -Math.PI / 2;
    } else {
      plane.position.set(building.x + building.w / 2 + 0.12, y, building.z);
      plane.rotation.y = Math.PI / 2;
    }
    scene.add(plane);
    neonSigns.push(plane);
  }

  const unitBox = new THREE.BoxGeometry(1, 1, 1);
  const slabs = instanced(unitBox, new THREE.MeshStandardMaterial({ color: 0xffffff, map: makeSidewalkTexture(THREE, 3, 3), roughness: 0.94, metalness: 0.03 }), slabItems, false);
  if (slabs) slabs.receiveShadow = true;
  instanced(unitBox, kerbMaterial, kerbItems, false);
  instanced(unitBox, brickWall, brickItems, true);
  instanced(unitBox, glassWall, glassItems, true);
  instanced(unitBox, glow, windowItems, false);
  instanced(unitBox, concrete, rooftopItems, true);
  instanced(unitBox, glow, farWindows, false);
  instanced(unitBox, concrete, farTowers, true);
  instanced(new THREE.CylinderGeometry(1.15, 1.28, 2.4, 8), metal, tankItems, true);
  instanced(new THREE.CylinderGeometry(0.11, 0.17, 4.6, 6).translate(0, 2.3, 0), metal, poleItems, true);
  instanced(new THREE.BoxGeometry(1.7, 0.1, 0.1).translate(0.85, 0, 0), metal, armItems, false);
  instanced(new THREE.SphereGeometry(0.2, 8, 6), glow, lampItems, false);
  const pools = instanced(new THREE.CircleGeometry(4.2, 20), new THREE.MeshBasicMaterial({ color: 0xffbe78, transparent: true, opacity: 0.2, depthWrite: false, blending: THREE.AdditiveBlending }), poolItems, false);
  if (pools) pools.renderOrder = 2;
  instanced(new THREE.CylinderGeometry(0.16, 0.26, 2.9, 6).translate(0, 1.45, 0), concrete, trunkItems, true);
  instanced(new THREE.IcosahedronGeometry(1, 0), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, flatShading: true }), leafItems, true);
  instanced(unitBox, paint, dashItems, false);
  instanced(unitBox, paint, crossingItems, false);
  instanced(new THREE.CylinderGeometry(0.17, 0.21, 0.58, 8), concrete, hydrantItems, true);
  instanced(new THREE.SphereGeometry(0.19, 8, 6), concrete, hydrantTopItems, false);
  instanced(new THREE.CylinderGeometry(0.4, 0.34, 0.92, 8).translate(0, 0.46, 0), new THREE.MeshStandardMaterial({ color: 0x2c3238, roughness: 0.8, metalness: 0.35 }), binItems, true);
  instanced(new THREE.BoxGeometry(1.9, 0.14, 0.6).translate(0, 0.62, 0), concrete, benchItems, true);
  instanced(new THREE.BoxGeometry(1.9, 0.5, 0.12).translate(0, 0.92, -0.26), concrete, benchBackItems, true);

  const carParts = makeCarParts(THREE);
  instanced(carParts.body, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.42, metalness: 0.35 }), carBodies, true);
  instanced(carParts.cabin, new THREE.MeshStandardMaterial({ color: 0x1d2733, roughness: 0.15, metalness: 0.7 }), carCabins, true);
  instanced(carParts.wheel, new THREE.MeshStandardMaterial({ color: 0x1b1d21, roughness: 0.9 }), carWheels, false);

  // Wet asphalt: a soft, stretched additive streak under each lamp, so the road catches the light.
  const wetStreaks = instanced(
    new THREE.PlaneGeometry(2.6, 12),
    new THREE.MeshBasicMaterial({ color: 0xffb878, transparent: true, opacity: 0.13, depthWrite: false, blending: THREE.AdditiveBlending }),
    wetItems,
    false,
  );
  if (wetStreaks) wetStreaks.renderOrder = 1;

  // Two lane light pools alternating on the central avenue, the only lights that blink.
  const blinkingPools = [];
  for (let index = 0; index < 8; index += 1) {
    const light = new THREE.Mesh(new THREE.PlaneGeometry(7, 7), new THREE.MeshBasicMaterial({ color: 0xffc06a, transparent: true, opacity: 0.09, depthWrite: false, blending: THREE.AdditiveBlending }));
    light.rotation.x = -Math.PI / 2;
    light.position.set(0, 0.04, -HALF + 40 + index * 40);
    scene.add(light);
    blinkingPools.push(light);
  }

  let time = 0;

  function update(dt) {
    time += dt;
    for (let index = 0; index < palms.length; index += 1) {
      const palm = palms[index];
      palm.holder.rotation.z = Math.sin(time * 0.7 + palm.phase) * 0.022 * palm.strength;
      palm.holder.rotation.x = Math.cos(time * 0.55 + palm.phase) * 0.014 * palm.strength;
    }
    for (let index = 0; index < beacons.length; index += 1) {
      beacons[index].material.opacity = 0.25 + 0.75 * (0.5 + 0.5 * Math.sin(time * 2.4 + index * 1.7));
    }
    for (let index = 0; index < blinkingPools.length; index += 1) {
      blinkingPools[index].material.opacity = 0.06 + 0.05 * (0.5 + 0.5 * Math.sin(time * 1.4 + index * 0.8));
    }
  }

  update(0);

  return { colliders, roads, sidewalks, buildings, palms, update, skyDome };
}

