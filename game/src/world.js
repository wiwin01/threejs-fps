// The Kestrel Yard map: an original container-port yard at dusk. Three lanes run south to north —
// Container Row (west), the Warehouse (centre) and Crane Walk (east) — and meet at the crane pad,
// the charge site, in the north-east. Every solid is an axis-aligned box: the same box drives the
// three.js mesh, the movement collider and the bullet raycast, so what you see is what blocks you.
import * as THREE from 'three';
import { PALETTE, CONTAINER_COLORS } from './palette.js';

export const MAP = { halfX: 32, halfZ: 22, wallHeight: 4 };

const materials = new Map();
function material(color, rough = 0.9, metal = 0.05) {
  const key = `${color}|${rough}|${metal}`;
  if (!materials.has(key)) {
    materials.set(key, new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal }));
  }
  return materials.get(key);
}

export function createWorld(scene) {
  const colliders = []; // {minX, maxX, minZ, maxZ, top}
  const shootables = []; // meshes bullets and sight lines test against
  const group = new THREE.Group();
  scene.add(group);

  // Add a solid box: mesh + collider + shootable in one call so they can never disagree.
  function box(x, z, w, d, h, color, yBase = 0) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material(color));
    mesh.position.set(x, yBase + h / 2, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.solid = true;
    group.add(mesh);
    shootables.push(mesh);
    colliders.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2, top: yBase + h });
    return mesh;
  }
  // A visual-only box (no collider): roof beams, crane tops, markings.
  function visual(x, y, z, w, h, d, color, emissive = 0) {
    const mat = emissive
      ? new THREE.MeshStandardMaterial({ color, emissive, emissiveIntensity: 1.6, roughness: 0.6 })
      : material(color);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  }

  // Ground: asphalt slab plus painted yard lines and the site pad marking.
  const ground = new THREE.Mesh(
    new THREE.BoxGeometry(MAP.halfX * 2 + 8, 0.2, MAP.halfZ * 2 + 8),
    material(PALETTE.ground, 1, 0),
  );
  ground.position.y = -0.1;
  ground.receiveShadow = true;
  ground.userData.solid = true;
  group.add(ground);
  shootables.push(ground);
  for (let x = -24; x <= 24; x += 12) visual(x, 0.011, 0, 0.25, 0.02, MAP.halfZ * 2, PALETTE.groundLine);
  visual(0, 0.011, -10, MAP.halfX * 2, 0.02, 0.25, PALETTE.groundLine);

  // Perimeter walls with a lighter coping stone.
  const H = MAP.wallHeight;
  box(0, -MAP.halfZ - 0.5, MAP.halfX * 2 + 2, 1, H, PALETTE.wall);
  box(0, MAP.halfZ + 0.5, MAP.halfX * 2 + 2, 1, H, PALETTE.wall);
  box(-MAP.halfX - 0.5, 0, 1, MAP.halfZ * 2 + 2, H, PALETTE.wall);
  box(MAP.halfX + 0.5, 0, 1, MAP.halfZ * 2 + 2, H, PALETTE.wall);
  visual(0, H + 0.1, -MAP.halfZ - 0.5, MAP.halfX * 2 + 2, 0.2, 1.2, PALETTE.wallTop);
  visual(0, H + 0.1, MAP.halfZ + 0.5, MAP.halfX * 2 + 2, 0.2, 1.2, PALETTE.wallTop);

  // Container Row (west lane): stacks of painted boxes with gaps to slip through.
  const stack = (x, z, level, ci) => box(x, z, 6, 2.5, 1.3, CONTAINER_COLORS[ci % CONTAINER_COLORS.length], level * 1.3);
  stack(-22, 12, 0, 0); stack(-22, 12, 1, 3);
  stack(-22, 4, 0, 1);
  stack(-22, -6, 0, 2); stack(-22, -6, 1, 5);
  stack(-22, -14, 0, 4);
  stack(-14, -2, 0, 3); // mid-yard stack, cover between lanes
  stack(-14, 16, 0, 5); stack(-14, 16, 1, 1);

  // The Warehouse (centre): a hall with a doorway on each long side, built from wall segments.
  const wh = PALETTE.warehouse;
  box(-8, -0.25, 1, 11.5, 3.4, wh); // west wall
  box(8, 0.25, 1, 11.5, 3.4, wh); // east wall
  box(-5, -6, 5, 1, 3.4, wh); box(5, -6, 5, 1, 3.4, wh); // north face, door at x in (-2.5, 2.5)
  box(-5, 6, 5, 1, 3.4, wh); box(5, 6, 5, 1, 3.4, wh); // south face, door at x in (-2.5, 2.5)
  visual(0, 3.7, 0, 17.5, 0.35, 13.5, PALETTE.warehouseRoof); // roof slab (visual: nobody walks up there)
  box(0, 0, 1.6, 3, 1.1, PALETTE.crate); // workbench cover inside
  box(-4, 2.5, 1.2, 1.2, 1.2, PALETTE.crate);
  box(4.5, -3, 1.2, 1.2, 2.4, PALETTE.crate);

  // Crane Walk (east lane) and the crane pad site in the north-east.
  stack(22, 10, 0, 2);
  stack(14, 2, 0, 0); stack(14, 2, 1, 4);
  box(24, -4, 1.2, 1.2, 1.2, PALETTE.crate);
  box(25.3, -4, 1.2, 1.2, 1.2, PALETTE.crate);
  box(24.6, -4, 1.2, 1.2, 1.2, PALETTE.crate, 1.2);
  // Gantry crane over the pad: four legs (solid) and a beam (visual).
  box(10, -19, 0.6, 0.6, 7, PALETTE.accent); box(26, -19, 0.6, 0.6, 7, PALETTE.accent);
  box(10, -9, 0.6, 0.6, 7, PALETTE.accent); box(26, -9, 0.6, 0.6, 7, PALETTE.accent);
  visual(18, 7.2, -19, 17, 0.8, 0.8, PALETTE.accent);
  visual(18, 7.2, -9, 17, 0.8, 0.8, PALETTE.accent);
  visual(18, 7.6, -14, 0.8, 0.5, 10.8, PALETTE.accent);
  // Site pad outline on the ground.
  visual(18, 0.012, -14, 13, 0.024, 0.3, PALETTE.accent, PALETTE.accent);
  visual(18, 0.012, -14, 0.3, 0.024, 9, PALETTE.accent, PALETTE.accent);

  // Scattered cover: crates and barrel clusters on the open ground.
  const crateAt = (x, z, h = 1.2) => box(x, z, 1.2, 1.2, h, PALETTE.crate);
  crateAt(-6, 14); crateAt(-4.7, 14); crateAt(-5.3, 14, 2.4);
  crateAt(6, -13); crateAt(7.3, -13);
  crateAt(-2, -16); crateAt(2, 16);
  crateAt(-16, -16); crateAt(16, 14);
  for (const [x, z] of [[-10, -12], [10, 8], [-2, 4], [20, -16]]) {
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 1.05, 12), material(PALETTE.barrel, 0.7, 0.3));
    barrel.position.set(x, 0.525, z);
    barrel.castShadow = true;
    barrel.userData.solid = true;
    group.add(barrel);
    shootables.push(barrel);
    colliders.push({ minX: x - 0.42, maxX: x + 0.42, minZ: z - 0.42, maxZ: z + 0.42, top: 1.05 });
  }

  // Sodium lamp posts: a pole (solid) and a glowing head, with real point lights at three of them.
  const lampAt = (x, z, withLight) => {
    box(x, z, 0.25, 0.25, 4.6, PALETTE.wallTop);
    visual(x, 4.7, z, 0.7, 0.18, 0.7, PALETTE.lampGlow, PALETTE.lampGlow);
    if (withLight) {
      const light = new THREE.PointLight(PALETTE.lampGlow, 60, 20, 1.8);
      light.position.set(x, 4.5, z);
      scene.add(light);
    }
  };
  lampAt(-16, 8, true); lampAt(16, -2, true); lampAt(0, -18, true); lampAt(-28, -18, false); lampAt(28, 16, false);

  // Dusk key light with shadows, plus a cool ambient fill.
  const sun = new THREE.DirectionalLight(0xffd9a8, 2.2);
  sun.position.set(-28, 34, 14);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -40; sun.shadow.camera.right = 40;
  sun.shadow.camera.top = 30; sun.shadow.camera.bottom = -30;
  sun.shadow.camera.far = 110;
  scene.add(sun);
  scene.add(new THREE.HemisphereLight(0x8fb2d9, 0x2c2620, 0.85));

  return { colliders, shootables, group };
}

// --- Layout data the bots and the round logic share -------------------------------------------

// The charge site: the crane pad. Attackers plant inside it; the pad outline in createWorld
// matches these bounds.
export const SITE = { minX: 11.5, maxX: 24.5, minZ: -18.5, maxZ: -9.5, plantX: 18, plantZ: -14 };

export const SPAWNS = {
  wardens: [ // defenders, north end
    { x: -4, z: -19.5, yaw: Math.PI }, { x: 0, z: -20, yaw: Math.PI },
    { x: 4, z: -19.5, yaw: Math.PI }, { x: 12, z: -19.5, yaw: Math.PI },
  ],
  breakers: [ // attackers, south end
    { x: -4, z: 19.5, yaw: 0 }, { x: 0, z: 20, yaw: 0 },
    { x: 4, z: 19.5, yaw: 0 }, { x: -12, z: 19.5, yaw: 0 },
  ],
};

// Waypoint graph: nodes on open ground, edges walkable in a straight line. Bots route along it,
// so lanes, doorways and the site approaches are all covered.
export const WAYPOINTS = [
  { x: 0, z: 18 }, // 0 breaker spawn mid
  { x: -18, z: 16 }, // 1 west south
  { x: 14, z: 16 }, // 2 east south
  { x: -18, z: 8 }, // 3 west mid-south
  { x: 0, z: 10 }, // 4 warehouse south door
  { x: 10, z: 10 }, // 5 east mid-south
  { x: -18, z: -2 }, // 6 west mid
  { x: 0, z: 0 }, // 7 warehouse centre
  { x: 18, z: -4 }, // 8 east mid
  { x: -12, z: -10 }, // 9 west mid-north
  { x: 0, z: -10 }, // 10 warehouse north door
  { x: 18, z: -14 }, // 11 the site
  { x: -18, z: -16 }, // 12 west north
  { x: 4, z: -16 }, // 13 warden mid-north
  { x: -6, z: 16 }, // 14 breaker spawn west
  { x: 6, z: 8 }, // 15 warehouse south-east approach
  { x: -8, z: -14 }, // 16 warden west-north
  { x: 24, z: 2 }, // 17 east lane bend
  { x: -26, z: -8 }, // 18 far west lane
];
export const EDGES = [
  [0, 1], [0, 2], [0, 4], [0, 14], [1, 3], [1, 14], [2, 5], [2, 17], [3, 6], [4, 7], [4, 15],
  [5, 8], [5, 15], [5, 17], [6, 9], [6, 18], [7, 10], [8, 11], [8, 17], [9, 10], [9, 12],
  [9, 16], [10, 13], [11, 13], [12, 16], [12, 18], [13, 16], [3, 4], [6, 7], [15, 7],
];

const adjacency = WAYPOINTS.map(() => []);
for (const [a, b] of EDGES) {
  adjacency[a].push(b);
  adjacency[b].push(a);
}

export function nearestNode(x, z) {
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < WAYPOINTS.length; i += 1) {
    const d = (WAYPOINTS[i].x - x) ** 2 + (WAYPOINTS[i].z - z) ** 2;
    if (d < bestDist) { bestDist = d; best = i; }
  }
  return best;
}

// Breadth-first route between two nodes, returned as a list of node indices (start..goal).
export function findPath(fromNode, toNode) {
  if (fromNode === toNode) return [fromNode];
  const prev = new Array(WAYPOINTS.length).fill(-1);
  const queue = [fromNode];
  prev[fromNode] = fromNode;
  while (queue.length) {
    const node = queue.shift();
    for (const next of adjacency[node]) {
      if (prev[next] === -1) {
        prev[next] = node;
        if (next === toNode) {
          const path = [toNode];
          let cur = toNode;
          while (cur !== fromNode) { cur = prev[cur]; path.unshift(cur); }
          return path;
        }
        queue.push(next);
      }
    }
  }
  return [fromNode];
}

// Defensive hold spots: positions with a view over an approach, assigned to Warden bots.
export const HOLD_SPOTS = [
  { x: 18, z: -7.5, faceX: 18, faceZ: -20 }, // watches the site from its south edge
  { x: 5.5, z: -13, faceX: 0, faceZ: 6 }, // watches warehouse north door
  { x: -13, z: -11, faceX: -18, faceZ: 10 }, // watches the west lane
  { x: 12, z: -16, faceX: 24, faceZ: 4 }, // inside the site, watches Crane Walk
];
