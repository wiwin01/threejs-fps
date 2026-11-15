// Bots: the other seven combatants. Each bot is a small articulated figure (legs, torso, head,
// gun) whose head and torso meshes are the hit targets. Bots route along the world's waypoint
// graph, hold defensive spots, plant and defuse the charge, and fight with burst fire: they see
// through a field-of-view and line-of-sight check, hear gunfire nearby, and remember where an
// enemy was last seen. All damage is applied by main.js through the ctx callbacks, so bots and
// the player share one combat path.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { MAP, WAYPOINTS, SITE, nearestNode, findPath } from './world.js';
import { WEAPONS } from './weapons.js';

const BOT_SPEED = 3.9;
const STRAFE_SPEED = 2.1;
const TURN_RATE = 7.5; // rad/s
const RADIUS = 0.42;

function makeFigure(team) {
  const color = team === 'wardens' ? PALETTE.wardens : PALETTE.breakers;
  const suit = new THREE.MeshStandardMaterial({ color, roughness: 0.85 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x2b2f36, roughness: 0.9 });
  const skin = new THREE.MeshStandardMaterial({ color: 0xc9a186, roughness: 0.7 });
  const group = new THREE.Group();

  const legs = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.8, 0.3), dark);
  legs.position.y = 0.4;
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.72, 0.34), suit);
  torso.position.y = 1.16;
  torso.castShadow = true;
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.36, 0.34), skin);
  head.position.y = 1.72;
  head.castShadow = true;
  const cap = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.1, 0.38), suit);
  cap.position.y = 1.93;
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.14, 0.72), dark);
  gun.position.set(0.2, 1.28, -0.42);
  group.add(legs, torso, head, cap, gun);
  return { group, torso, head };
}

let nextBotId = 1;

export function createBot(scene, colliders, team, name) {
  const { group, torso, head } = makeFigure(team);
  scene.add(group);
  const bot = {
    id: nextBotId++,
    name,
    team,
    isPlayer: false,
    group,
    pos: new THREE.Vector3(),
    yaw: 0,
    hp: 100,
    armour: false,
    alive: true,
    weaponId: 'pistol',
    state: 'route', // route | hold | engage | plant | defuse | planted-guard
    path: [],
    pathIdx: 0,
    holdSpot: null,
    hasCharge: false,
    channel: 0, // plant/defuse progress in seconds
    thinkAt: 0,
    nextShotAt: 0,
    burstLeft: 0,
    burstPauseUntil: 0,
    strafeDir: 1,
    strafeFlipAt: 0,
    memory: { pos: null, at: -99 }, // last seen enemy position
    deadAt: 0,
    hitMeshes: [torso, head],
  };
  torso.userData.bot = bot;
  torso.userData.part = 'body';
  head.userData.bot = bot;
  head.userData.part = 'head';
  bot.colliders = colliders;
  return bot;
}

export function placeBot(bot, spawn) {
  bot.pos.set(spawn.x, 0, spawn.z);
  bot.yaw = spawn.yaw;
  bot.hp = 100;
  bot.alive = true;
  bot.state = 'route';
  bot.path = [];
  bot.pathIdx = 0;
  bot.channel = 0;
  bot.memory.pos = null;
  bot.group.rotation.set(0, 0, 0);
  bot.group.visible = true;
  syncMesh(bot);
}

function syncMesh(bot) {
  bot.group.position.copy(bot.pos);
  bot.group.rotation.y = bot.yaw; // the figure is built facing -Z, the same convention as the camera
  // A dead bot topples backwards and stays as a marker of where the fight went.
  if (!bot.alive) bot.group.rotation.x = -Math.PI / 2 + 0.06;
}

function collide(bot) {
  const p = bot.pos;
  p.x = Math.max(-MAP.halfX + RADIUS, Math.min(MAP.halfX - RADIUS, p.x));
  p.z = Math.max(-MAP.halfZ + RADIUS, Math.min(MAP.halfZ - RADIUS, p.z));
  for (const c of bot.colliders) {
    if (c.top < 0.6) continue;
    const nearX = Math.max(c.minX, Math.min(p.x, c.maxX));
    const nearZ = Math.max(c.minZ, Math.min(p.z, c.maxZ));
    const dx = p.x - nearX;
    const dz = p.z - nearZ;
    const d2 = dx * dx + dz * dz;
    if (d2 >= RADIUS * RADIUS || d2 < 1e-8) continue;
    const d = Math.sqrt(d2);
    p.x = nearX + (dx / d) * RADIUS;
    p.z = nearZ + (dz / d) * RADIUS;
  }
}

function faceToward(bot, x, z, dt) {
  const want = Math.atan2(-(x - bot.pos.x), -(z - bot.pos.z));
  let diff = want - bot.yaw;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  const turn = Math.max(-TURN_RATE * dt, Math.min(TURN_RATE * dt, diff));
  bot.yaw += turn;
  return Math.abs(diff) < 0.12;
}

// Walk toward a point; returns true on arrival.
function moveToward(bot, x, z, dt, speed = BOT_SPEED) {
  const dx = x - bot.pos.x;
  const dz = z - bot.pos.z;
  const dist = Math.hypot(dx, dz);
  if (dist < 0.35) return true;
  faceToward(bot, x, z, dt);
  bot.pos.x += (dx / dist) * speed * dt;
  bot.pos.z += (dz / dist) * speed * dt;
  collide(bot);
  return false;
}

function setPathTo(bot, nodeIdx) {
  const from = nearestNode(bot.pos.x, bot.pos.z);
  bot.path = findPath(from, nodeIdx).slice(1);
  bot.pathIdx = 0;
}

// Follow the current path; returns true when the path is exhausted.
function followPath(bot, dt, speed) {
  while (bot.pathIdx < bot.path.length) {
    const node = WAYPOINTS[bot.path[bot.pathIdx]];
    if (!moveToward(bot, node.x, node.z, dt, speed)) return false;
    bot.pathIdx += 1;
  }
  return true;
}

const EYE = 1.55;

// One bot's step. ctx: { now, enemies, losClear(a, b), shoot(bot, target), hearAt, planted,
// onPlanted(bot), onDefused(bot), random }
export function stepBot(bot, dt, ctx) {
  if (!bot.alive) return;
  const now = ctx.now;

  // --- perception (throttled) ---
  if (now >= bot.thinkAt) {
    bot.thinkAt = now + 0.12;
    let seen = null;
    for (const enemy of ctx.enemies) {
      if (!enemy.alive) continue;
      const ex = enemy.pos.x;
      const ez = enemy.pos.z;
      const dx = ex - bot.pos.x;
      const dz = ez - bot.pos.z;
      const dist = Math.hypot(dx, dz);
      if (dist > 40) continue;
      const toEnemy = Math.atan2(-dx, -dz);
      let facing = Math.abs(((toEnemy - bot.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
      if (facing > Math.PI) facing = Math.PI * 2 - facing;
      if (facing > 1.05 && dist > 5) continue; // outside the view cone and not point-blank
      const from = new THREE.Vector3(bot.pos.x, EYE, bot.pos.z);
      const to = new THREE.Vector3(ex, 1.25, ez);
      if (ctx.losClear(from, to)) {
        seen = enemy;
        bot.memory.pos = { x: ex, z: ez };
        bot.memory.at = now;
        break;
      }
    }
    bot.seenEnemy = seen;
    if (ctx.hearAt && now - ctx.hearAt.time < 0.4) {
      const d = Math.hypot(ctx.hearAt.x - bot.pos.x, ctx.hearAt.z - bot.pos.z);
      if (d < 19 && !seen) {
        bot.memory.pos = { x: ctx.hearAt.x, z: ctx.hearAt.z };
        bot.memory.at = now;
      }
    }
  }

  const memoryFresh = bot.memory.pos && now - bot.memory.at < 4;

  // --- behaviour ---
  if (bot.seenEnemy || (memoryFresh && bot.state === 'engage')) {
    bot.state = 'engage';
  }

  if (bot.state === 'engage') {
    const target = bot.seenEnemy;
    const tx = target ? target.pos.x : bot.memory.pos.x;
    const tz = target ? target.pos.z : bot.memory.pos.z;
    faceToward(bot, tx, tz, dt);
    // Strafe in short bursts while fighting; it makes bots harder to hit without making them
    // dancers, and their own accuracy drops while they move (handled in main's hit roll).
    if (now >= bot.strafeFlipAt) {
      bot.strafeFlipAt = now + 0.5 + ctx.random() * 0.7;
      bot.strafeDir = ctx.random() < 0.5 ? -1 : 1;
    }
    const dist = Math.hypot(tx - bot.pos.x, tz - bot.pos.z);
    if (dist > 16) moveToward(bot, tx, tz, dt, BOT_SPEED * 0.8);
    else {
      const px = -(tz - bot.pos.z), pz = (tx - bot.pos.x);
      const len = Math.hypot(px, pz) || 1;
      bot.pos.x += (px / len) * bot.strafeDir * STRAFE_SPEED * dt;
      bot.pos.z += (pz / len) * bot.strafeDir * STRAFE_SPEED * dt;
      collide(bot);
    }
    bot.moving = dist > 16;
    if (target && now >= bot.burstPauseUntil && now >= bot.nextShotAt) {
      if (bot.burstLeft <= 0) {
        const def = WEAPONS[bot.weaponId];
        bot.burstLeft = def.auto ? 3 + Math.floor(ctx.random() * 3) : 1;
      }
      ctx.shoot(bot, target);
      const def = WEAPONS[bot.weaponId];
      bot.nextShotAt = now + 60000 / def.rpm / 1000;
      bot.burstLeft -= 1;
      if (bot.burstLeft <= 0) bot.burstPauseUntil = now + 0.38 + ctx.random() * 0.45;
    }
    if (!target && !memoryFresh) bot.state = bot.team === 'wardens' && bot.holdSpot ? 'hold' : 'route';
  } else if (bot.state === 'plant') {
    faceToward(bot, SITE.plantX, SITE.plantZ, dt);
    bot.channel += dt;
    if (bot.channel >= 3.5) {
      bot.state = 'planted-guard';
      ctx.onPlanted(bot);
    }
  } else if (bot.state === 'defuse') {
    bot.channel += dt;
    if (bot.channel >= 5) {
      bot.state = 'hold';
      ctx.onDefused(bot);
    }
  } else if (bot.state === 'hold' && bot.holdSpot) {
    if (!bot.atHold) {
      if (followPath(bot, dt)) bot.atHold = true;
    } else {
      faceToward(bot, bot.holdSpot.faceX, bot.holdSpot.faceZ, dt);
      bot.moving = false;
      // Once the charge is planted, holding defenders converge on the site to defuse.
      if (ctx.planted && bot.team === 'wardens') {
        bot.state = 'route';
        bot.atHold = false;
        setPathTo(bot, 11);
      }
    }
  } else {
    // route: attackers push the site, defenders fall back on their spots, planted attackers guard.
    bot.moving = true;
    if (followPath(bot, dt)) {
      if (bot.hasCharge && !ctx.planted) {
        if (moveToward(bot, SITE.plantX, SITE.plantZ, dt)) bot.state = 'plant';
      } else if (bot.team === 'wardens' && ctx.planted) {
        if (moveToward(bot, SITE.plantX, SITE.plantZ, dt)) bot.state = 'defuse';
      } else if (bot.team === 'wardens' && bot.holdSpot) {
        bot.state = 'hold';
      } else {
        bot.state = 'hold'; // attackers who arrived guard where they stand, watching mid-yard
        bot.holdSpot = { x: bot.pos.x, z: bot.pos.z, faceX: 0, faceZ: 0 };
        bot.atHold = true;
      }
    }
  }

  syncMesh(bot);
}

// Route assignment at round start (called by state.js).
export function assignRoute(bot, nodeIdx) {
  setPathTo(bot, nodeIdx);
}

export function killBot(bot, now) {
  bot.alive = false;
  bot.deadAt = now;
  bot.hp = 0;
  syncMesh(bot);
}
