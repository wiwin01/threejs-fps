# Kestrel Yard

A round-based tactical FPS in three.js, set in a container port at dusk. You are a **Warden**,
defending the gantry crane pad. The **Breakers** cross the yard each round to plant a breach
charge on the pad: eliminate them, run out the clock, or defuse the charge after it is planted.
First team to 7 rounds takes the yard (12 rounds at most).

Single-player against bots, static files only — no build step, no network. Open it with any
static server:

```
node serve.ts          # then open http://localhost:8080
```

## How to play

| Input | Action |
| --- | --- |
| W A S D / mouse | Move / look (pointer lock) |
| Click | Fire — R reloads, right-click scopes the Longbow |
| Ctrl or C | Crouch: slower, but your spread tightens |
| Space | Jump |
| 1–5 | Switch weapon |
| G | Throw a Shard frag grenade |
| E (hold) | Defuse a planted charge |
| B / number keys | Buy menu during the 12-second buy phase |

## The tactical loop

- **Economy.** You start with $800. Round wins pay $1,400 ($1,900 for an objective win), losses
  pay a rising bonus, kills pay $300. Guns, a kevlar vest and Shard grenades persist between
  rounds — dying costs you your kit.
- **Arsenal.** Wasp P9 pistol · Jackal SMG · Boar 12 shotgun (7 pellets) · Kestrel AR ·
  Longbow DMR (scoped, bolt-cycled). Each has its own damage, falloff, spread and kick.
- **Accuracy pays.** Spread grows with your movement speed and shrinks when you crouch or stop;
  headshots multiply damage up to 3.4×; armour cuts body damage by 45%.
- **Bots with a plan.** Breakers route down three lanes (Container Row, the Warehouse, Crane
  Walk) along a waypoint graph; the carrier plants while escorts hold angles. Wardens hold
  prepared spots, converge on the site once the charge is down, and a bot will defuse if it
  gets there. Bots see through a view cone + line-of-sight, hear gunfire, remember last-seen
  positions, and fight in strafing bursts.

## Design notes

- **Original everything**: the map (a 64×44 m yard with a warehouse mid, container lanes and a
  gantry crane), team and weapon names, the dusk sodium-lamp palette, and all sounds are made
  for this game. Sounds are synthesised with WebAudio — there are no audio files.
- **One combat path**: player and bot shots resolve through the same hitscan function, so
  damage, falloff, armour and headshots behave identically for everyone.
- **Fixed-step simulation** at 60 Hz, kept apart from rendering; match state (phase, timers,
  scores, money, the charge) lives in one object in `state.js`; each module has one job:
  `world` (map + navigation graph), `player` (body), `weapons` (guns + grenades), `bots`
  (figures + AI), `audio` (synth SFX), `hud` (DOM), `input`, `palette`, `main` (boot + combat).
- **Deterministic screenshot mode**: `game/index.html?shot=start|play|end&seed=1` poses a
  fixed frame and sets `window.__shotReady` — that is how the screenshots in `screenshots/`
  were captured.

## Hand-in

`node main.ts` copies `game/` and `screenshots/` to the output directory and writes
`dossier.json` with the vendored make.fun library (`vendor/makefun-threejs.ts`, unchanged from
the kit). three.js 0.187.0 is vendored under `game/vendor/three/`, byte for byte.

MIT licensed — see `LICENSE`.
