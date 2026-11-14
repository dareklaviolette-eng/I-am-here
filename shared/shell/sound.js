// The shell's sound: one master volume carried across jumps (stations connect their sounds to sound.out), and the
// arrival whoosh (synthesised: filtered noise sweeping up then away; no files). Audio starts only after a user gesture.
export function createSound({ storageKey = 'imhere.xr.volume' } = {}) {
  let ctx = null, master = null, vol = 0.7;
  try { const v = parseFloat(localStorage.getItem(storageKey)); if (v >= 0 && v <= 1) vol = v; } catch (e) { /* ignore */ }
  function ensure() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume().catch(() => {}); return ctx; }
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return null;
    try { ctx = new AC(); master = ctx.createGain(); master.gain.value = vol; master.connect(ctx.destination); } catch (e) { ctx = null; }
    return ctx;
  }
  const api = {
    get volume() { return vol; },
    setVolume(v) { vol = Math.max(0, Math.min(1, Math.round(v * 10) / 10)); if (master) master.gain.value = vol; try { localStorage.setItem(storageKey, String(vol)); } catch (e) { /* ignore */ } },
    unlock() { ensure(); },   // call from a click / select
    get context() { return ensure(); }, get out() { ensure(); return master; },
    whoosh(sec = 1.6) {
      const c = ensure(); if (!c || vol <= 0) return;
      const n = Math.floor(c.sampleRate * sec), buf = c.createBuffer(1, n, c.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1);
      const src = c.createBufferSource(); src.buffer = buf;
      const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.4;
      const g = c.createGain(), t = c.currentTime;
      bp.frequency.setValueAtTime(220, t); bp.frequency.exponentialRampToValueAtTime(2400, t + sec * 0.55); bp.frequency.exponentialRampToValueAtTime(500, t + sec);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.22, t + sec * 0.4); g.gain.exponentialRampToValueAtTime(0.0001, t + sec);
      src.connect(bp); bp.connect(g); g.connect(master); src.start(t); src.stop(t + sec + 0.05);
    },
  };
  return api;
}
