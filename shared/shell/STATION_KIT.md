# I'M HERE XR · Station starter kit

The shell (`/xr/`, `shared/shell/*.js`) is the one page that stays open; a **station** is a world that plugs into it.
You jump between stations without leaving VR. Spec: *I'M HERE XR · Station Rules v1* (Nov 14).

## The shell owns (never build your own copy)
Renderer, scene, camera rig, the WebXR session, xr-safety (Exit VR, B/Y, watchdog quality levels, recenter), the blink and
the arrival moment, sound volume, the EFB (VR) / panel (screens), the I'M HERE card and top bar (screens), the concierge,
the Be There reveal, the one Google 3D tiles instance, recent places, the address-bar link.

## Files
```
stations/<id>/meta.js     light: names, blocks, POV seats, places (concierge + globe), how to load, optional hero()
stations/<id>/station.js  export function createStation(ctx) -> { describe, load, run, targets, act, unload } (+ pointer)
shared/shell/registry.js  add one import + one entry in STATIONS
```
Copy `stations/example/` to start. It is the whole contract in ~90 lines.

## The contract (six calls)
| Call | When | Rules |
|---|---|---|
| `describe()` | any time | `{ id, name, blocks, povs, link }`. Blocks from: ride, stops, targets, time, pov. |
| `async load(params, progress)` | in the background, while the last world still runs | Build **only inside `ctx.root`** (not yet in the scene). Don't touch `ctx.rig`, `ctx.camera` or the scene. Call `progress(0..1, text)`. `await ctx.yield()` between heavy pieces (the VR watchdog ends sessions with frames over 1 s). Set your look with `ctx.setEnv({ fog, background, near, far, fov, exposure })`. |
| `run(dt, t)` | every frame once shown | Move, then seat the user with `ctx.placeSeat(x, y, z, yaw)` (shared comfort rules: level rig, head free, recenter). **No allocations** (preallocate vectors; no closures, arrays, strings, template literals). |
| `targets()` | on demand (concierge, lists) | `[{ id, name, line, tag: 'LIVE'|'HIST'|'SIM'|'RENDERED', station, params?, here?, hero?() }]`. `station` + `params` of another station = a cross-station jump. |
| `act(cmd)` | from the shell | `{ type: 'pov', id }`, `'stop'`, `'layer' (id, on)`, `'time' (mode)`, `'target' (id; after Be There on your own target: hop)`, `'quality' (level 0-2)`, `'recenter'`, `'xr' (on)`. |
| `unload()` | under the blink, before the next world shows | Remove **everything** you made: feeds, sockets, timers, GPU memory, DOM. The shell then disposes whatever is left under `ctx.root` as a safety net. |

Optional: `pointer(kind, origin, dir)` - world rays from screen taps and VR point + select (`kind`: 'hover' | 'select' |
'hoverEnd'); return true when you took it. Open the reveal with `ctx.reveal(target)`.

## ctx (what the shell gives you)
`THREE, renderer, scene, camera, rig, root, params, meta, sound` · `isXR()`, `quality()` · `setEnv(o)` · `placeSeat(x,y,z,yaw)`,
`setLookPitch(p)`, `ownsCamera(true)` (you seat the camera yourself, e.g. the Aurora) · `setCard(cardData)` (card spec v1 fields;
`live: true` only when truly live) · `setEfb({ povs, pov, listTitle, list: [{ id, name, sub, sel, tag, target? }], layers: [[id, label, on, soon]], time: [[id, label, sel, soon]], status, data })`
· `setCredit({ text, short })` (imagery / Google attribution) · `setTitle(t)` · `toast(t)` · `reveal(target)` · `jump(station, params)`
· `blink(fn)` (blink around a change, e.g. a POV switch) · `wantScenery({ lat, lon, elevFt })` -> Promise of the shared Google
tiles handle or null (use your rendered fallback) · `yield()` · `on(target, type, fn)`, `setInterval`, `setTimeout` (removed for you on unload).

## Rules every station follows
- Never assume ground or Google scenery (space has neither). Rendered is fine anywhere; label it (`RENDERED`, `SIM`) on the card.
- Universal input only: point + select (trigger or pinch), tap, click. Grips, buttons and sticks are bonus shortcuts.
- Nothing follows the head; nothing floats in VR except the EFB (the shell's).
- Honour quality levels (`act({ type: 'quality' })`): lighter, coarser, never off.
- A station link opens straight to it: `/xr/#station=<id>&<params>` (the shell keeps the address bar in sync).

## Checklist before it ships
- [ ] `meta.js` places have `lat, lon, name, sub, tag, keywords` (the concierge and the globe use them).
- [ ] `load` builds only under `ctx.root`, yields between heavy steps, reports progress, sets `setEnv`.
- [ ] `run` allocates nothing (check with DevTools allocation sampling).
- [ ] Card fed (`setCard`) with LOC / ORG / ID / RTE / POV / SIG / time; EFB fed (`setEfb`) with POVs, Stops or targets, Around me.
- [ ] Targets open the Be There reveal; Be There on one of yours hops (`act target`), on another station jumps.
- [ ] `unload` stops every feed / socket / timer and frees GPU memory (render targets: dispose the target, not just `.texture`).
- [ ] Add it to `xr/test/leak-test.mjs`'s ROUTE and run it: 10+ jumps, geometries / textures / heap back to baseline.
- [ ] `node xr/test/station-test.mjs` and `node xr/test/concierge-test.mjs` pass.
- [ ] On the Quest 3S: 10 jumps in a row, no slowdown, no crash. If it fails, it doesn't ship.

## Tests
```
node xr/test/concierge-test.mjs      # rules concierge
node xr/test/station-test.mjs        # metadata in sync with sources, generated files fresh, contract shape
node xr/test/leak-test.mjs 12        # headless Chrome: 12 jumps, memory back to baseline, no slowdown
node xr/test/shots.mjs /tmp/xr-shots # headless screenshots (sim data, no network)
node xr/tools/extract-boats.mjs      # regenerate stations/boats/{ais-core,ships3d}.js after boats/index.html changes
```
The headless tests need google-chrome and a local three.js r165 (`THREE_DIR`, default /home/claude/fleet3d/web/three).
