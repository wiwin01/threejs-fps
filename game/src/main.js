// KESTREL YARD — boot and the one loop. A fixed 60 Hz simulation steps the player, the bots and
// the match; rendering reads the state it leaves behind. This module owns combat resolution:
// every hitscan shot in the game, the player's and the bots' alike, goes through fireHitscan(),
// so damage, falloff, armour and headshots behave identically whoever pulls the trigger.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { createWorld, SPAWNS, SITE, HOLD_SPOTS } from './world.js';
import { createInput } from './input.js';
import { createPlayer } from './player.js';
import { createLoadout, createGrenades, WEAPONS, WEAPON_ORDER, GRENADE_PRICE, ARMOUR_PRICE } from './weapons.js';
import { createBot, placeBot, stepBot, assignRoute, killBot } from './bots.js';
import { createMatch, botWeaponFor } from './state.js';
import { createHud } from './hud.js';
import { createAudio } from './audio.js';

const FIXED_STEP = 1 / 60;
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seed = Number.parseInt(params.get('seed') ?? '1', 10) || 1;

function mulberry32(initial) {
  let a = initial;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const random = mulberry32(shot ? seed * 7919 : (Date.now() % 100000) + 1);

// --- renderer / scene ---
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.sky);
scene.fog = new THREE.Fog(new THREE.Color(PALETTE.fog), 30, 95);
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 160);
scene.add(camera);

// --- world, actors, systems ---
const world = createWorld(scene);
const playerBody = createPlayer(world.colliders);
const loadout = createLoadout();
const grenades = createGrenades(scene);
const match = createMatch();
const hud = createHud();
const audio = createAudio();

const player = {
  isPlayer: true, team: 'wardens', name: 'You',
  pos: playerBody.state.position, hp: 100, alive: true,
};
const bots = [];
const WARDEN_NAMES = ['Ibis', 'Condor', 'Heron'];
const BREAKER_NAMES = ['Viper', 'Mamba', 'Cobra', 'Asp'];
for (let i = 0; i < 3; i += 1) bots.push(createBot(scene, world.colliders, 'wardens', WARDEN_NAMES[i]));
for (let i = 0; i < 4; i += 1) bots.push(createBot(scene, world.colliders, 'breakers', BREAKER_NAMES[i]));
const combatants = [player, ...bots];

// The breach charge: a small orange block with a blinking light, carried then planted.
const chargeMesh = new THREE.Group();
const chargeBody = new THREE.Mesh(
  new THREE.BoxGeometry(0.42, 0.3, 0.3),
  new THREE.MeshStandardMaterial({ color: 0x333a41, roughness: 0.5, metalness: 0.4 }),
);
const chargeLamp = new THREE.Mesh(
  new THREE.BoxGeometry(0.1, 0.06, 0.1),
  new THREE.MeshStandardMaterial({ color: PALETTE.accent, emissive: PALETTE.accent, emissiveIntensity: 2 }),
);
chargeLamp.position.y = 0.19;
chargeMesh.add(chargeBody, chargeLamp);
chargeMesh.visible = false;
scene.add(chargeMesh);

// Viewmodel gun: simple built shapes per weapon, rebuilt on switch, kicked on fire.
const viewmodel = new THREE.Group();
camera.add(viewmodel);
let vmKick = 0;
function buildViewmodel(id) {
  viewmodel.clear();
  const dark = new THREE.MeshStandardMaterial({ color: 0x23272d, roughness: 0.55, metalness: 0.5 });
  const bodyLen = { pistol: 0.24, smg: 0.42, shotgun: 0.55, rifle: 0.52, sniper: 0.72 }[id];
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.11, bodyLen), dark);
  body.position.set(0.17, -0.16, -0.32 - bodyLen / 2);
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.16, 8), dark);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0.17, -0.125, -0.36 - bodyLen);
  const hand = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.13, 0.09), new THREE.MeshStandardMaterial({ color: 0x8a6f4d, roughness: 0.8 }));
  hand.position.set(0.17, -0.235, -0.3);
  viewmodel.add(body, barrel, hand);
  viewmodel.visible = true;
}
buildViewmodel('pistol');

// Tracers: a small pool of fading lines.
const tracerPool = [];
for (let i = 0; i < 24; i += 1) {
  const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
  const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0 }));
  line.visible = false;
  scene.add(line);
  tracerPool.push({ line, until: 0 });
}
let tracerIdx = 0;
function tracer(from, to, now) {
  const t = tracerPool[tracerIdx++ % tracerPool.length];
  const pos = t.line.geometry.attributes.position;
  pos.setXYZ(0, from.x, from.y, from.z);
  pos.setXYZ(1, to.x, to.y, to.z);
  pos.needsUpdate = true;
  t.line.visible = true;
  t.line.material.opacity = 0.85;
  t.until = now + 0.055;
}

// Explosion flash: a quick point light + expanding shell.
const blastLight = new THREE.PointLight(0xffa050, 0, 18, 1.6);
scene.add(blastLight);
const blastShell = new THREE.Mesh(
  new THREE.SphereGeometry(1, 18, 12),
  new THREE.MeshBasicMaterial({ color: 0xffb45e, transparent: true, opacity: 0 }),
);
blastShell.visible = false;
scene.add(blastShell);
let blastAt = -9;
let blastPos = new THREE.Vector3();

// --- combat ---
const raycaster = new THREE.Raycaster();
raycaster.far = 130;
const tmpDir = new THREE.Vector3();
const tmpFrom = new THREE.Vector3();
const tmpTo = new THREE.Vector3();

function allHitMeshes() {
  const meshes = world.shootables.slice();
  for (const bot of bots) if (bot.alive) meshes.push(...bot.hitMeshes);
  return meshes;
}

// Line of sight between two points, blocked only by world solids (not bots).
function losClear(from, to) {
  tmpDir.subVectors(to, from);
  const dist = tmpDir.length();
  raycaster.set(from, tmpDir.normalize());
  raycaster.far = dist;
  const hit = raycaster.intersectObjects(world.shootables, false)[0];
  raycaster.far = 130;
  return !hit;
}

function applyDamage(target, amount, attacker, part, weaponName) {
  if (!target.alive) return;
  let dmg = amount;
  if (part === 'body' && ((target.isPlayer && loadout.armour) || target.armour)) dmg *= 0.55;
  target.hp -= dmg;
  if (target.isPlayer) {
    hud.damageFlash();
    audio.hurt();
  }
  if (attacker.isPlayer) hud.hitMarker(target.hp <= 0);
  if (target.hp <= 0) {
    target.alive = false;
    if (!target.isPlayer) killBot(target, simTime);
    if (target.hasCharge) dropCharge(target);
    hud.kill(`${attacker.name} ▸ ${target.name} — ${weaponName}`, attacker.isPlayer || target.isPlayer);
    if (attacker.isPlayer) {
      audio.hit(true);
      match.onKill('wardens'); // only the player's own kills pay the kill reward
    }
  } else if (attacker.isPlayer) {
    audio.hit(false);
  }
}

// One hitscan shot. Returns the hit point (for tracers) or null.
function fireHitscan(shooter, origin, dir, def, spread) {
  tmpDir.copy(dir);
  tmpDir.x += (random() * 2 - 1) * spread;
  tmpDir.y += (random() * 2 - 1) * spread;
  tmpDir.z += (random() * 2 - 1) * spread;
  tmpDir.normalize();
  raycaster.set(origin, tmpDir);
  const hit = raycaster.intersectObjects(allHitMeshes(), false)[0];
  lastShotPos = { x: origin.x, z: origin.z, time: simTime };
  if (!hit) {
    tmpTo.copy(origin).addScaledVector(tmpDir, 60);
    return tmpTo.clone();
  }
  const target = hit.object.userData.bot;
  if (target && target !== shooter && target.alive) {
    const part = hit.object.userData.part;
    let dmg = def.damage * (part === 'head' ? def.headMult : 1);
    dmg *= Math.max(0.45, 1 - (hit.distance / def.range) * 0.45);
    applyDamage(target, dmg, shooter, part, def.name);
  }
  return hit.point.clone();
}

function dropCharge(bot) {
  bot.hasCharge = false;
  // The charge drops where the carrier fell; another Breaker may pick it up by walking over it.
  chargeDropped = { x: bot.pos.x, z: bot.pos.z };
  chargeMesh.position.set(bot.pos.x, 0.16, bot.pos.z);
  chargeMesh.visible = true;
}
let chargeDropped = null;

// Bot shooting: aim at the target's chest (sometimes head) with skill-based jitter, resolved by
// the same hitscan path as the player's shots.
function botShoot(bot, target) {
  const def = WEAPONS[bot.weaponId];
  const eye = tmpFrom.set(bot.pos.x, 1.5, bot.pos.z);
  const aimY = random() < 0.18 ? 1.72 : 1.2;
  tmpTo.set(target.pos.x, target.isPlayer ? target.pos.y + aimY : aimY, target.pos.z);
  const dist = eye.distanceTo(tmpTo);
  const jitter = 0.012 + dist * 0.0009 + (bot.moving ? 0.012 : 0);
  tmpDir.subVectors(tmpTo, eye).normalize();
  const end = fireHitscan(bot, eye.clone(), tmpDir, def, jitter);
  if (end) tracer(new THREE.Vector3(bot.pos.x, 1.42, bot.pos.z), end, simTime);
  audio.botShot();
}

const botCtx = {
  get now() { return simTime; },
  enemies: [], // replaced per bot in the step loop with that bot's opposing team
  losClear,
  shoot: botShoot,
  get hearAt() { return lastShotPos; },
  get planted() { return match.state.charge.planted; },
  onPlanted(bot) {
    match.state.charge.x = bot.pos.x;
    match.state.charge.z = bot.pos.z;
    chargeMesh.position.set(bot.pos.x, 0.16, bot.pos.z);
    chargeMesh.visible = true;
    match.onPlanted();
  },
  onDefused() { match.onDefused(); },
  random,
};
let lastShotPos = null;

// Per-team enemy views for the bots (rebuilt each step, cheap at 8 combatants).
function enemiesOf(team) {
  return combatants.filter((c) => c.team !== team);
}

// --- round setup ---
let playerDiedRound = false;
function setupRound() {
  const st = match.state;
  player.alive = true;
  player.hp = 100;
  playerDiedRound = false;
  if (st.round > 1 && playerWasDead) loadout.resetKit();
  playerWasDead = false;
  playerBody.reset(SPAWNS.wardens[1]);

  let wi = 0;
  let bi = 0;
  for (const bot of bots) {
    if (bot.team === 'wardens') {
      placeBot(bot, SPAWNS.wardens[[0, 2, 3][wi]]);
      bot.weaponId = botWeaponFor('wardens', wi, st.round, random);
      bot.armour = st.round > 2;
      bot.holdSpot = HOLD_SPOTS[wi % HOLD_SPOTS.length];
      assignRoute(bot, [10, 6, 11][wi % 3]);
      wi += 1;
    } else {
      placeBot(bot, SPAWNS.breakers[bi]);
      bot.weaponId = botWeaponFor('breakers', bi, st.round, random);
      bot.armour = st.round > 3;
      bot.hasCharge = bi === 1;
      if (bot.hasCharge) match.state.charge.carrierId = bot.id;
      assignRoute(bot, 11);
      bi += 1;
    }
  }
  chargeDropped = null;
  chargeMesh.visible = false;
  refreshHud();
  hud.banner(`ROUND ${st.round}`, st.round === 1 ? 'Defend the crane pad' : '', 2200);
  buyOpen = true;
}
let playerWasDead = false;
let buyOpen = false;
let lastBuySig = '';

// --- HUD sync ---
function refreshHud() {
  const st = match.state;
  hud.setHealth(player.hp, loadout.armour);
  hud.setAmmo(loadout.gun.mag, loadout.gun.reserve, loadout.reloading(simTime * 1000));
  hud.setWeapon(loadout.def.name);
  hud.setGrenades(loadout.grenades);
  hud.setMoney(st.playerMoney);
  hud.setScores(st.scores.wardens, st.scores.breakers, Math.max(1, st.round));
}

const BUY_ITEMS = [
  { key: '1', id: 'rifle', label: 'Kestrel AR', price: WEAPONS.rifle.price },
  { key: '2', id: 'smg', label: 'Jackal SMG', price: WEAPONS.smg.price },
  { key: '3', id: 'shotgun', label: 'Boar 12', price: WEAPONS.shotgun.price },
  { key: '4', id: 'sniper', label: 'Longbow DMR', price: WEAPONS.sniper.price },
  { key: '5', id: 'armour', label: 'Kevlar vest', price: ARMOUR_PRICE },
  { key: '6', id: 'grenade', label: 'Shard grenade', price: GRENADE_PRICE },
];
function buyMenuItems() {
  const money = match.state.playerMoney;
  return BUY_ITEMS.map((item) => {
    let state = 'buy';
    if (item.id === 'armour' && loadout.armour) state = 'owned';
    else if (item.id === 'grenade' && loadout.grenades >= 2) state = 'owned';
    else if (WEAPONS[item.id] && loadout.owned[item.id]) state = 'owned';
    else if (money < item.price) state = 'poor';
    return { ...item, state };
  });
}
function tryBuy(item) {
  let cost = -1;
  if (item.id === 'armour') cost = loadout.buyArmour(match.state.playerMoney);
  else if (item.id === 'grenade') cost = loadout.buyGrenade(match.state.playerMoney);
  else cost = loadout.buy(item.id, match.state.playerMoney);
  if (cost < 0) { audio.denied(); return; }
  match.state.playerMoney -= cost;
  audio.buy();
  buildViewmodel(loadout.current);
  refreshHud();
}

// --- input / flow ---
const input = createInput(renderer.domElement, onLockChange);
let started = false;
let simTime = 0;
let prevFiring = false;

hud.onPlay(() => {
  if (shot) return;
  audio.unlock();
  if (match.state.phase === 'matchEnd') {
    loadout.resetKit();
    match.startMatch();
    setupRound();
  }
  input.requestLock();
});

function onLockChange(locked) {
  if (shot) return;
  if (locked) {
    started = true;
    hud.hideOverlay();
  } else if (match.state.phase !== 'matchEnd') {
    hud.showOverlay(started ? 'paused' : 'start');
  }
}

function syncCamera() {
  const b = playerBody.state;
  camera.position.set(b.position.x, b.position.y + b.eye, b.position.z);
  camera.rotation.set(b.pitch, b.yaw, 0, 'YXZ');
  const scoped = input.aiming && loadout.def.scoped && player.alive;
  const targetFov = scoped ? 26 : 74;
  if (Math.abs(camera.fov - targetFov) > 0.1) {
    camera.fov += (targetFov - camera.fov) * 0.35;
    camera.updateProjectionMatrix();
  }
  hud.setScope(scoped);
  viewmodel.visible = !scoped;
  // Viewmodel rest position, with recoil kick and a walk bob.
  vmKick *= 0.82;
  const bob = Math.sin(simTime * 9) * 0.006 * Math.min(1, playerBody.speedNow() / 4.6);
  viewmodel.position.set(0, bob, vmKick);
  viewmodel.rotation.x = vmKick * 1.4;
}

// Player defuse channel state.
let defuseProgress = 0;

function playerShoot(nowMs) {
  const def = loadout.def;
  if (!loadout.fire(nowMs)) {
    audio.dry();
    return;
  }
  const scoped = input.aiming && def.scoped;
  const spread = loadout.spreadFor(playerBody.speedNow(), playerBody.state.crouching, scoped);
  camera.getWorldDirection(tmpDir);
  const origin = camera.position.clone();
  for (let pellet = 0; pellet < def.pellets; pellet += 1) {
    const end = fireHitscan(player, origin, tmpDir, def, spread);
    if (end && pellet === 0) tracer(origin.clone().add(new THREE.Vector3(0, -0.12, 0)), end, simTime);
  }
  audio.shot(loadout.current);
  playerBody.recoil(def.kick * (0.8 + random() * 0.5), (random() * 2 - 1) * def.kick * 0.4);
  vmKick = Math.min(0.09, vmKick + def.kick * 1.6);
  refreshHud();
}

function step(dt) {
  simTime += dt;
  const st = match.state;
  const nowMs = simTime * 1000;
  const phase = st.phase;

  match.update(dt, {
    wardens: combatants.filter((c) => c.team === 'wardens' && c.alive).length,
    breakers: combatants.filter((c) => c.team === 'breakers' && c.alive).length,
  });
  for (const ev of match.drainEvents()) handleEvent(ev);
  if (st.phase !== phase && (st.phase === 'buy')) setupRound();

  const playing = phase === 'live' || phase === 'planted';
  const frozen = phase === 'buy';

  // Player
  if (player.alive) {
    if (!frozen) playerBody.step(dt, shot ? new Set() : input.keys);
    loadout.step(nowMs);
    if (playing && !shot) {
      const triggerClicked = input.firing && !prevFiring;
      if (loadout.ready(nowMs, input.firing, triggerClicked)) playerShoot(nowMs);
      else if (triggerClicked && loadout.gun.mag === 0 && !loadout.reloading(nowMs)) audio.dry();
      if (input.consumePressed('KeyR') && loadout.reload(nowMs)) audio.reload();
      if (input.consumePressed('KeyG') && loadout.useGrenade()) {
        camera.getWorldDirection(tmpDir);
        grenades.throwFrom(camera.position.clone(), tmpDir);
        audio.throwPin();
        refreshHud();
      }
      for (let n = 1; n <= 5; n += 1) {
        if (input.consumePressed(`Digit${n}`)) {
          loadout.selectSlot(n);
          buildViewmodel(loadout.current);
          refreshHud();
        }
      }
    }
    // Defuse: hold E beside the planted charge.
    const charge = st.charge;
    if (phase === 'planted' && charge.planted) {
      const near = Math.hypot(player.pos.x - charge.x, player.pos.z - charge.z) < 2.3;
      if (near && input.keys.has('KeyE')) {
        defuseProgress += dt;
        hud.progress(defuseProgress / 5, 'Defusing');
        if (defuseProgress >= 5) {
          defuseProgress = 0;
          hud.progress(null);
          match.onDefused();
        }
      } else {
        defuseProgress = 0;
        hud.progress(null);
      }
    }
  }
  prevFiring = input.firing;

  // Buy phase purchases.
  if (phase === 'buy' && !shot) {
    for (const item of BUY_ITEMS) {
      if (input.consumePressed(`Digit${item.key}`)) tryBuy(item);
    }
    if (input.consumePressed('KeyB')) buyOpen = !buyOpen;
  }

  // Bots act once the round is live; in the planted phase everyone keeps fighting.
  if (playing) {
    for (const bot of bots) {
      if (!bot.alive) continue;
      botCtx.enemies = enemiesOf(bot.team);
      stepBot(bot, dt, botCtx);
    }
    // Charge pickup: a living Breaker walking over a dropped charge takes it.
    if (chargeDropped && !st.charge.planted) {
      for (const bot of bots) {
        if (bot.team === 'breakers' && bot.alive
          && Math.hypot(bot.pos.x - chargeDropped.x, bot.pos.z - chargeDropped.z) < 1.1) {
          bot.hasCharge = true;
          match.state.charge.carrierId = bot.id;
          chargeDropped = null;
          chargeMesh.visible = false;
          assignRoute(bot, 11);
          if (bot.state === 'hold') bot.state = 'route';
          break;
        }
      }
    }
    // The carried charge rides on its carrier.
    if (!st.charge.planted && !chargeDropped) {
      const carrier = bots.find((b) => b.hasCharge && b.alive);
      if (carrier) {
        chargeMesh.visible = true;
        chargeMesh.position.set(carrier.pos.x, 2.15, carrier.pos.z);
      }
    }
  }

  grenades.step(dt, simTime);
  for (const blast of grenades.takeBlasts()) explode(blast.pos);

  // Charge beeps while planted, faster as the timer runs down.
  if (st.charge.planted && st.phase === 'planted') {
    const interval = st.phaseLeft > 10 ? 1 : st.phaseLeft > 5 ? 0.5 : 0.25;
    if (simTime % interval < dt) audio.beep(st.phaseLeft <= 0.3);
    chargeLamp.material.emissiveIntensity = (simTime % interval) < 0.1 ? 3 : 0.4;
  }

  // Tracers fade.
  for (const t of tracerPool) {
    if (t.line.visible && simTime > t.until) {
      t.line.material.opacity -= dt * 10;
      if (t.line.material.opacity <= 0) t.line.visible = false;
    }
  }
  // Blast visuals decay.
  const blastAge = simTime - blastAt;
  if (blastAge < 0.45) {
    blastShell.visible = true;
    blastShell.position.copy(blastPos);
    const r = 0.5 + blastAge * 11;
    blastShell.scale.set(r, r, r);
    blastShell.material.opacity = 0.5 * (1 - blastAge / 0.45);
    blastLight.position.copy(blastPos).y += 1;
    blastLight.intensity = 260 * (1 - blastAge / 0.45);
  } else {
    blastShell.visible = false;
    blastLight.intensity = 0;
  }

  // HUD clocks.
  hud.setTimer(st.phaseLeft, st.phase === 'planted' || st.phaseLeft < 11);
  hud.setScores(st.scores.wardens, st.scores.breakers, Math.max(1, st.round));
  if (phase === 'buy' && buyOpen && !shot) {
    // Rebuild the menu only when what it shows has changed (money, ownership, grenades).
    const sig = `${st.playerMoney}|${Object.keys(loadout.owned).join(',')}|${loadout.grenades}|${loadout.armour}`;
    if (sig !== lastBuySig) {
      lastBuySig = sig;
      hud.showBuy(buyMenuItems(), st.playerMoney);
    }
  } else {
    lastBuySig = '';
    hud.hideBuy();
  }
  hud.setSpread(4 + loadout.spreadFor(playerBody.speedNow(), playerBody.state.crouching, false) * 900);
  if (player.alive) hud.setHealth(player.hp, loadout.armour);
}

function explode(pos) {
  blastAt = simTime;
  blastPos.copy(pos);
  audio.explosion();
  for (const c of combatants) {
    if (!c.alive) continue;
    const d = Math.hypot(c.pos.x - pos.x, c.pos.z - pos.z);
    if (d < 5.2) {
      const dmg = 88 * (1 - d / 5.2) + 6;
      applyDamage(c, dmg, { isPlayer: false, team: 'neutral', name: 'Shard' }, 'body', 'Shard grenade');
    }
  }
}

function handleEvent(ev) {
  const st = match.state;
  if (ev.type === 'live') {
    buyOpen = false;
    hud.banner('GO', '', 700);
  } else if (ev.type === 'planted') {
    hud.banner('CHARGE PLANTED', 'Defuse it — hold E beside the charge', 3000);
    audio.beep();
  } else if (ev.type === 'roundEnd') {
    const won = ev.winner === 'wardens';
    const reasonText = {
      elimination: won ? 'Breakers eliminated' : 'Wardens eliminated',
      detonation: 'The charge detonated',
      defuse: 'Charge defused',
      time: 'Time expired — yard held',
    }[ev.reason];
    hud.banner(won ? 'ROUND WON' : 'ROUND LOST', reasonText, 3400);
    audio.roundEnd(won);
    if (ev.reason === 'detonation') {
      // The charge going off is a visual event now; the round is already decided.
      blastAt = simTime;
      blastPos.set(st.charge.x, 0.4, st.charge.z);
      audio.explosion();
      chargeMesh.visible = false;
    }
    hud.progress(null);
    defuseProgress = 0;
    if (!player.alive) playerWasDead = true;
  } else if (ev.type === 'matchEnd') {
    hud.showOverlay('matchEnd', { won: ev.winner === 'wardens', w: st.scores.wardens, b: st.scores.breakers });
    if (document.pointerLockElement) document.exitPointerLock();
  }
}

// --- the loop ---
let accumulator = 0;
let lastTime = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  if (!shot) {
    const look = input.takeLook();
    if (input.locked && player.alive) playerBody.look(look.x, look.y);
    accumulator += dt;
    let steps = 0;
    while (accumulator >= FIXED_STEP && steps < 5) {
      step(FIXED_STEP);
      accumulator -= FIXED_STEP;
      steps += 1;
    }
    if (accumulator > FIXED_STEP * 5) accumulator = 0;
  }
  syncCamera();
  renderer.render(scene, camera);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// --- shot mode: deterministic poses for the maker's screenshots ---
function runShot(name) {
  match.startMatch();
  setupRound();
  hud.hideOverlay();
  if (name === 'start') {
    // Buy phase at the Warden spawn, menu open, yard ahead.
    playerBody.state.yaw = Math.PI;
    hud.showBuy(buyMenuItems(), match.state.playerMoney);
  } else if (name === 'play') {
    match.state.phase = 'live';
    match.state.phaseLeft = 63;
    playerBody.state.position.set(2.5, 0, -9.5);
    playerBody.state.yaw = Math.PI * 0.92;
    player.hp = 78;
    loadout.buy('rifle', 10000);
    buildViewmodel('rifle');
    const viper = bots.find((b) => b.name === 'Viper');
    viper.pos.set(-1.5, 0, 2.5);
    viper.yaw = Math.PI;
    const ibis = bots.find((b) => b.name === 'Ibis');
    ibis.pos.set(6.5, 0, -6);
    ibis.yaw = Math.PI * 0.8;
    for (const bot of bots) {
      bot.group.position.copy(bot.pos);
      bot.group.rotation.y = bot.yaw;
    }
    refreshHud();
  } else if (name === 'end') {
    match.state.scores.wardens = 7;
    match.state.scores.breakers = 5;
    match.state.phase = 'matchEnd';
    hud.showOverlay('matchEnd', { won: true, w: 7, b: 5 });
    refreshHud();
  }
  syncCamera();
  let painted = 0;
  (function paint() {
    requestAnimationFrame(paint);
    renderer.render(scene, camera);
    painted += 1;
    if (painted === 3) window.__shotReady = true;
  })();
}

if (shot) runShot(shot);
else {
  match.startMatch();
  setupRound();
  requestAnimationFrame(frame);
}
