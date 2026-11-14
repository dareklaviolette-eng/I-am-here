// Example station: copy this folder to start a new one. It shows every part of the contract in the fewest lines:
// a raft (Ride) circling on a calm sea (no ground assumed: the sea is ours to draw), three Stops, two buoys you can point at
// (Targets: one hops here, one jumps to another station), two POV seats, rendered Time, and a clean unload.
// Rules: build only inside ctx.root; no allocations in run(); listeners / timers through ctx.on / ctx.setInterval.
const STOPS = [['north', 'Facing north', 0], ['sunset', 'Toward the sunset', -Math.PI / 2], ['south', 'Facing south', Math.PI]];

export function createStation(ctx) {
  const { THREE, root } = ctx;
  let raft, buoys = [], pov = 'seat', stop = 0, t = 0, hovered = null, sun;
  const eye = new THREE.Vector3(), card = {};

  return {
    // 1) Describe: who you are and which blocks you use (the shell also reads meta.js)
    describe: () => ({ id: 'example', name: 'Example station', blocks: ['ride', 'stops', 'targets', 'pov'] }),

    // 2) Load: build the world in the background (the last world is still running). Report progress. Touch nothing outside ctx.root.
    async load(params, progress) {
      progress(0.1, 'Building the sea');
      ctx.setEnv({ background: new THREE.Color(0x87a9c8), fog: new THREE.Fog(0x9fb6c8, 400, 4000), far: 5000 });
      const sea = new THREE.Mesh(new THREE.CircleGeometry(4000, 64), new THREE.MeshStandardMaterial({ color: 0x1f5f7a, roughness: 0.35, metalness: 0.1 }));
      sea.rotation.x = -Math.PI / 2; root.add(sea);
      root.add(new THREE.HemisphereLight(0xdfefff, 0x284050, 1.2));
      sun = new THREE.DirectionalLight(0xffe2b8, 2.2); sun.position.set(-300, 200, -100); root.add(sun);
      await ctx.yield();
      progress(0.5, 'Building the raft');
      raft = new THREE.Group();
      const deck = new THREE.Mesh(new THREE.BoxGeometry(3, 0.3, 4), new THREE.MeshStandardMaterial({ color: 0xb08a5e, roughness: 0.8 }));
      deck.position.y = 0.15; raft.add(deck); root.add(raft);
      [[-30, -60, 'Red buoy', 0xd23b2b], [40, -90, 'Yellow buoy', 0xf2c230]].forEach(([x, z, name, c], i) => {
        const b = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.6, 3, 16), new THREE.MeshStandardMaterial({ color: c, roughness: 0.5 }));
        b.position.set(x, 1.5, z); b.userData = { id: 'buoy' + i, name }; root.add(b); buoys.push(b);
      });
      progress(1, 'Ready');
      ctx.setCard({ type: 'Raft', loc: 'Open sea', org: "I'M HERE", id: { label: 'NAME', value: 'Example raft' }, rte: 'Circling · Underway', pov: 'Seat', sig: { source: 'Rendered', tag: 'RENDERED' }, time: Date.now() });
      pushEfb();
    },

    // 3) Run: move each frame and seat the user (ctx.placeSeat keeps the shell's comfort rules). No allocations here.
    run(dt) {
      t += dt * 0.05;
      raft.position.set(Math.sin(t) * 60, 0, Math.cos(t) * 60 - 40);
      raft.rotation.y = t + Math.PI / 2;
      const yaw = raft.rotation.y + STOPS[stop][2];
      if (pov === 'seat') { eye.set(raft.position.x, 1.5, raft.position.z); ctx.placeSeat(eye.x, eye.y, eye.z, yaw); }
      else { eye.set(raft.position.x + Math.sin(yaw) * 12, 6, raft.position.z + Math.cos(yaw) * 12); ctx.placeSeat(eye.x, eye.y, eye.z, yaw); }
    },

    // 4) Targets: what can be clicked now, and where each one jumps (same station, or another)
    targets: () => [
      { id: 'buoy0', name: 'Red buoy', line: 'A hop inside this station', tag: 'RENDERED', station: 'example' },
      { id: 'buoy1', name: 'Yellow buoy', line: 'Jumps to Sydney Harbour (Boats)', tag: 'LIVE', station: 'boats', params: { area: 'sydney' } },
    ],
    // optional: rays from the shell (screen taps, VR point + select); open the Be There reveal on a target
    pointer(kind, o, d) {
      if (kind === 'hoverEnd') { buoys.forEach((b) => b.scale.setScalar(b === hovered ? 1.2 : 1)); hovered = null; return false; }
      let best = null, bt = Infinity;
      for (const b of buoys) { const dx = b.position.x - o.x, dy = b.position.y - o.y, dz = b.position.z - o.z, tt = dx * d.x + dy * d.y + dz * d.z; if (tt <= 0) continue;
        const px = o.x + d.x * tt - b.position.x, py = o.y + d.y * tt - b.position.y, pz = o.z + d.z * tt - b.position.z; if (px * px + py * py + pz * pz < 9 && tt < bt) { bt = tt; best = b; } }
      if (!best) return false;
      if (kind === 'hover') hovered = best;
      if (kind === 'select') ctx.reveal(this.targets().find((x) => x.id === best.userData.id));
      return true;
    },

    // 5) Act: POV, stop, layer and time changes from the shell (and 'target' after Be There on a same-station target)
    act(cmd) {
      if (cmd.type === 'pov') { pov = cmd.id; ctx.setCard(Object.assign(card, { pov: pov === 'seat' ? 'Seat' : 'Chase' })); pushEfb(); }
      else if (cmd.type === 'stop') { stop = STOPS.findIndex((s) => s[0] === cmd.id); if (stop < 0) stop = 0; pushEfb(); }
      else if (cmd.type === 'target') { ctx.toast('You are at the ' + (cmd.id === 'buoy0' ? 'red' : 'yellow') + ' buoy'); }
    },

    // 6) Unload: remove everything you made. The shell also disposes what is left under ctx.root, as a safety net.
    unload() { raft = null; buoys = []; sun = null; },
  };
  function pushEfb() {
    ctx.setEfb({ povs: [['seat', 'Seat'], ['chase', 'Chase']], pov, listTitle: 'Stops', list: STOPS.map(([id, name], i) => ({ id, name, sel: i === stop })),
      layers: [['ships', 'Ships', false, true], ['planes', 'Planes', false, true]], time: [['rendered', 'REND', true, false]] });
  }
}
