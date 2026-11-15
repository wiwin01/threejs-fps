// The player's body: position, velocity, view angles. Movement has real acceleration and a
// friction stop, crouching lowers the eye and steadies the gun, and collision is a circle swept
// against the world's axis-aligned boxes. Combat stats (health, armour) live in state.js; this
// module is only the body.
import * as THREE from 'three';
import { MAP } from './world.js';

const WALK_SPEED = 4.6;
const CROUCH_SPEED = 2.5;
const ACCEL = 42;
const FRICTION = 11;
const GRAVITY = 18;
const JUMP_SPEED = 5.6;
const RADIUS = 0.42;
const EYE_STAND = 1.62;
const EYE_CROUCH = 1.02;

export function createPlayer(colliders) {
  const state = {
    position: new THREE.Vector3(0, 0, -19.5), // feet
    velocity: new THREE.Vector3(),
    yaw: Math.PI,
    pitch: 0,
    eye: EYE_STAND,
    crouching: false,
    grounded: true,
  };

  function collide() {
    const p = state.position;
    p.x = Math.max(-MAP.halfX + RADIUS, Math.min(MAP.halfX - RADIUS, p.x));
    p.z = Math.max(-MAP.halfZ + RADIUS, Math.min(MAP.halfZ - RADIUS, p.z));
    for (const c of colliders) {
      if (c.top < 0.6) continue; // low props never block the body
      const nearX = Math.max(c.minX, Math.min(p.x, c.maxX));
      const nearZ = Math.max(c.minZ, Math.min(p.z, c.maxZ));
      const dx = p.x - nearX;
      const dz = p.z - nearZ;
      const d2 = dx * dx + dz * dz;
      if (d2 >= RADIUS * RADIUS) continue;
      if (d2 > 1e-8) {
        const d = Math.sqrt(d2);
        p.x = nearX + (dx / d) * RADIUS;
        p.z = nearZ + (dz / d) * RADIUS;
      } else {
        // Centre inside the box: push out along the smallest penetration axis.
        const left = p.x - c.minX, right = c.maxX - p.x, near = p.z - c.minZ, far = c.maxZ - p.z;
        const m = Math.min(left, right, near, far);
        if (m === left) p.x = c.minX - RADIUS;
        else if (m === right) p.x = c.maxX + RADIUS;
        else if (m === near) p.z = c.minZ - RADIUS;
        else p.z = c.maxZ + RADIUS;
      }
    }
  }

  return {
    state,
    reset(spawn) {
      state.position.set(spawn.x, 0, spawn.z);
      state.velocity.set(0, 0, 0);
      state.yaw = spawn.yaw;
      state.pitch = 0;
      state.crouching = false;
      state.eye = EYE_STAND;
    },
    look(dx, dy) {
      state.yaw -= dx * 0.0021;
      state.pitch = Math.max(-1.45, Math.min(1.45, state.pitch - dy * 0.0021));
    },
    recoil(up, side) {
      state.pitch = Math.min(1.45, state.pitch + up);
      state.yaw += side;
    },
    speedNow() {
      return Math.hypot(state.velocity.x, state.velocity.z);
    },
    step(dt, keys) {
      const s = state;
      s.crouching = keys.has('ControlLeft') || keys.has('ControlRight') || keys.has('KeyC');
      const targetEye = s.crouching ? EYE_CROUCH : EYE_STAND;
      s.eye += (targetEye - s.eye) * Math.min(1, dt * 11);

      const sin = Math.sin(s.yaw), cos = Math.cos(s.yaw);
      let ix = 0, iz = 0;
      if (keys.has('KeyW')) iz -= 1;
      if (keys.has('KeyS')) iz += 1;
      if (keys.has('KeyA')) ix -= 1;
      if (keys.has('KeyD')) ix += 1;
      // Camera looks along -Z rotated by yaw: forward = (-sin(yaw), -cos(yaw)) on the ground plane.
      const wish = new THREE.Vector3(ix * cos + iz * sin, 0, -ix * sin + iz * cos);
      if (wish.lengthSq() > 0) wish.normalize();
      const maxSpeed = s.crouching ? CROUCH_SPEED : WALK_SPEED;
      wish.multiplyScalar(maxSpeed);

      if (s.grounded) {
        const blend = Math.min(1, dt * FRICTION);
        if (wish.lengthSq() === 0) {
          s.velocity.x -= s.velocity.x * blend;
          s.velocity.z -= s.velocity.z * blend;
        } else {
          s.velocity.x += (wish.x - s.velocity.x) * Math.min(1, dt * ACCEL / maxSpeed * 3.2);
          s.velocity.z += (wish.z - s.velocity.z) * Math.min(1, dt * ACCEL / maxSpeed * 3.2);
        }
        if (keys.has('Space')) {
          s.velocity.y = JUMP_SPEED;
          s.grounded = false;
        }
      } else {
        s.velocity.x += wish.x * dt * 2.2;
        s.velocity.z += wish.z * dt * 2.2;
      }
      s.velocity.y -= GRAVITY * dt;
      s.position.addScaledVector(s.velocity, dt);
      if (s.position.y <= 0) {
        s.position.y = 0;
        s.velocity.y = 0;
        s.grounded = true;
      }
      collide();
    },
  };
}
