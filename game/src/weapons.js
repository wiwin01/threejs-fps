// Weapon definitions and the player's loadout: what each gun costs, how it kicks, how its spread
// behaves standing, moving and crouched. Firing itself (the raycast) is resolved in main.js so
// the player and the bots share one damage path; this module owns timing, ammo and grenades.
import * as THREE from 'three';

// spread is in radians at the muzzle; moveSpread is added in full at walk speed.
// falloff: damage kept at `range` metres (0.55 = 55% at max range).
export const WEAPONS = {
  pistol: { name: 'Wasp P9', price: 0, damage: 26, headMult: 3.1, rpm: 380, mag: 12, reserve: 60, reloadMs: 1050, spread: 0.007, moveSpread: 0.016, auto: false, pellets: 1, range: 55, kick: 0.010, cycleMs: 0 },
  smg: { name: 'Jackal SMG', price: 1200, damage: 20, headMult: 2.6, rpm: 820, mag: 30, reserve: 120, reloadMs: 1900, spread: 0.016, moveSpread: 0.026, auto: true, pellets: 1, range: 42, kick: 0.007, cycleMs: 0 },
  shotgun: { name: 'Boar 12', price: 1500, damage: 11, headMult: 1.6, rpm: 68, mag: 6, reserve: 30, reloadMs: 2600, spread: 0.034, moveSpread: 0.030, auto: false, pellets: 7, range: 22, kick: 0.034, cycleMs: 0 },
  rifle: { name: 'Kestrel AR', price: 2700, damage: 34, headMult: 3.4, rpm: 600, mag: 30, reserve: 90, reloadMs: 2100, spread: 0.006, moveSpread: 0.024, auto: true, pellets: 1, range: 70, kick: 0.011, cycleMs: 0 },
  sniper: { name: 'Longbow DMR', price: 3500, damage: 96, headMult: 2.2, rpm: 42, mag: 5, reserve: 25, reloadMs: 2800, spread: 0.002, moveSpread: 0.05, auto: false, pellets: 1, range: 110, kick: 0.05, cycleMs: 1250, scoped: true },
};
export const WEAPON_ORDER = ['pistol', 'smg', 'shotgun', 'rifle', 'sniper'];
export const GRENADE_PRICE = 300;
export const ARMOUR_PRICE = 650;
export const MAX_GRENADES = 2;

export function createLoadout() {
  const owned = { pistol: freshGun('pistol') };
  let current = 'pistol';
  let grenades = 0;
  let armour = false;
  let nextShotAt = 0;
  let reloadEndsAt = -1;

  function freshGun(id) {
    const def = WEAPONS[id];
    return { mag: def.mag, reserve: def.reserve };
  }

  return {
    owned,
    get current() { return current; },
    get def() { return WEAPONS[current]; },
    get gun() { return owned[current]; },
    get grenades() { return grenades; },
    get armour() { return armour; },
    buy(id, money) {
      const def = WEAPONS[id];
      if (!def || money < def.price || owned[id]) return -1;
      owned[id] = freshGun(id);
      current = id;
      return def.price;
    },
    buyGrenade(money) {
      if (money < GRENADE_PRICE || grenades >= MAX_GRENADES) return -1;
      grenades += 1;
      return GRENADE_PRICE;
    },
    buyArmour(money) {
      if (money < ARMOUR_PRICE || armour) return -1;
      armour = true;
      return ARMOUR_PRICE;
    },
    select(id) {
      if (owned[id]) {
        current = id;
        reloadEndsAt = -1;
      }
    },
    selectSlot(n) {
      const id = WEAPON_ORDER[n - 1];
      if (id) this.select(id);
    },
    // Spread for a shot taken right now, given the shooter's ground speed and stance.
    spreadFor(speed, crouching, scoped) {
      const def = this.def;
      let s = def.spread + def.moveSpread * Math.min(1, speed / 4.6);
      if (crouching) s *= 0.55;
      if (scoped && def.scoped) s = 0.0008;
      return s;
    },
    ready(now, triggerHeld, triggerClicked) {
      const def = this.def;
      if (reloadEndsAt > now) return false;
      if (now < nextShotAt) return false;
      if (def.auto) return triggerHeld;
      return triggerClicked;
    },
    // Consume a round and book the next allowed shot. Returns false on an empty magazine.
    fire(now) {
      const gun = this.gun;
      if (gun.mag <= 0) return false;
      gun.mag -= 1;
      const def = this.def;
      nextShotAt = now + Math.max(60000 / def.rpm, def.cycleMs);
      return true;
    },
    reload(now) {
      const gun = this.gun;
      const def = this.def;
      if (reloadEndsAt > now || gun.mag >= def.mag || gun.reserve <= 0) return false;
      reloadEndsAt = now + def.reloadMs;
      return true;
    },
    step(now) {
      if (reloadEndsAt > 0 && now >= reloadEndsAt) {
        const gun = this.gun;
        const def = this.def;
        const take = Math.min(def.mag - gun.mag, gun.reserve);
        gun.mag += take;
        gun.reserve -= take;
        reloadEndsAt = -1;
      }
    },
    reloading(now) { return reloadEndsAt > now; },
    useGrenade() {
      if (grenades <= 0) return false;
      grenades -= 1;
      return true;
    },
    // Between rounds the loadout persists (that is the point of the economy); only ammo tops up
    // a little and the dead player's kit is reset by state.js calling resetKit().
    resetKit() {
      for (const id of Object.keys(owned)) delete owned[id];
      owned.pistol = freshGun('pistol');
      current = 'pistol';
      grenades = 0;
      armour = false;
      reloadEndsAt = -1;
      nextShotAt = 0;
    },
  };
}

// Thrown frag grenades ("Shard"): a small physics body on an arc, then a blast. Kept apart from
// the loadout so bots could throw too; in this build only the player carries them.
export function createGrenades(scene) {
  const live = []; // {mesh, vel, fuse}
  const blasts = []; // {pos, at} explosions for main.js to apply damage from
  const geo = new THREE.SphereGeometry(0.09, 10, 8);
  const mat = new THREE.MeshStandardMaterial({ color: 0x37474f, roughness: 0.5, metalness: 0.5 });

  return {
    throwFrom(origin, dir, strength = 15) {
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.copy(origin);
      scene.add(mesh);
      live.push({
        mesh,
        vel: new THREE.Vector3(dir.x * strength, dir.y * strength + 4.5, dir.z * strength),
        fuse: 1.6,
      });
    },
    step(dt, now) {
      for (let i = live.length - 1; i >= 0; i -= 1) {
        const g = live[i];
        g.fuse -= dt;
        g.vel.y -= 18 * dt;
        g.mesh.position.addScaledVector(g.vel, dt);
        if (g.mesh.position.y < 0.1) {
          g.mesh.position.y = 0.1;
          g.vel.y *= -0.35;
          g.vel.x *= 0.7;
          g.vel.z *= 0.7;
        }
        if (g.fuse <= 0) {
          blasts.push({ pos: g.mesh.position.clone(), at: now });
          scene.remove(g.mesh);
          live.splice(i, 1);
        }
      }
    },
    takeBlasts() {
      const out = blasts.slice();
      blasts.length = 0;
      return out;
    },
  };
}
