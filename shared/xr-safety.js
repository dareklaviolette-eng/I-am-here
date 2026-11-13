// I'M HERE: guaranteed ways out of VR, a crash-proof frame loop, and a frame-cost watchdog. Plain script, no imports.
// window.ImHereXR.install({ THREE, renderer, scene, camera, rays, scale, place: { right, down, ahead }, onQuality(level), onExit })
// Call it right after the renderer and camera exist, before renderer.setAnimationLoop and before entering VR.
//  - Exit VR: a big red button that stays in view (it follows your head lazily, low and to the right). Point a controller
//    at it and pull the trigger, or point a hand and pinch, or poke it with a fingertip. B or Y (xr-standard
//    gamepad buttons 4 and 5) exit at once. Every exit calls session.end() inside try/catch (retried once if the
//    session lingers). Nothing here calls preventDefault or captures any system input.
//  - The page's frame callback is wrapped in try/catch: an error is logged (rate-limited) and the next frame still comes.
//    If every frame errors for 2 s in VR, the session ends with a plain message on the page.
//  - Cost caps for Quest: framebuffer scale <= 1 (0.9 default), fixed foveation 1, no shadow maps while in VR.
//  - Watchdog: frames over 50 ms for most of 2 s -> onQuality(1), then 2.5 s later onQuality(2) (the page lightens its scene).
//    Frames over 1 s (twice within 10 s), or no frame at all for 2.5 s -> the session ends and the page says why.
//  - No allocations per frame (beyond what WebXR itself returns for poses).
//  Per-page options (all optional; leaving them out keeps the behaviour above):
//    panel: false        no big red Exit VR panel (the page offers its own exit target instead; B / Y still exit)
//    exitTargets: [obj]  page meshes that exit like the panel (ray + trigger / pinch, fingertip poke). Each one's
//                        obj.userData.exitRect = { cx, cy, w, h } is the hot area in the mesh's local plane (facing +z);
//                        obj.userData.exitIgnore = 'left' ignores that hand (a wrist panel on that hand); hover calls
//                        obj.userData.onExitHover(bool). Only counted while the object and its parents are visible.
//                        api.exitTargets is the live array (push more later).
//    exitButtons: [5]    gamepad buttons that exit (default [4, 5] = A/X and B/Y; [5] = B and Y only, so A/X stay free)
//    hint: 'text'        a small hint shown ahead of you for ~4 s each time VR starts (fades out)
(function () {
  'use strict';
  if (window.ImHereXR) return;
  var MSG_ID = 'imhere-xr-msg';
  function showMsg(text) {
    try {
      var d = document.getElementById(MSG_ID);
      if (!d) {
        d = document.createElement('div'); d.id = MSG_ID; d.setAttribute('role', 'alert');
        d.style.cssText = 'position:fixed;left:50%;top:18px;transform:translateX(-50%);z-index:99999;max-width:min(560px,92vw);' +
          'background:rgba(30,10,12,.94);color:#fff;font:15px/1.4 system-ui,sans-serif;padding:12px 40px 12px 16px;border-radius:12px;' +
          'box-shadow:0 4px 18px rgba(0,0,0,.4);border:1px solid rgba(255,120,125,.6)';
        var x = document.createElement('button'); x.textContent = '×'; x.setAttribute('aria-label', 'Close');
        x.style.cssText = 'position:absolute;right:6px;top:4px;background:none;border:0;color:#fff;font-size:22px;cursor:pointer';
        x.onclick = function () { d.remove(); };
        d.appendChild(document.createElement('span')); d.appendChild(x); document.body.appendChild(d);
      }
      d.firstChild.textContent = text;
    } catch (e) { /* ignore */ }
  }
  var nErr = 0;
  function logErr(where, e) {
    nErr++;
    if (nErr <= 5 || nErr % 300 === 0) { try { console.error('[I\'M HERE VR] ' + where + ' (#' + nErr + '):', e); } catch (e2) { /* ignore */ } }
  }

  function install(o) {   // never breaks the page: if anything here fails, the page runs as before (without these extras)
    try { return setup(o); } catch (e) { logErr('install', e); return null; }
  }
  function setup(o) {
    var THREE = o.THREE, renderer = o.renderer, xr = renderer.xr;
    var api = { level: 0, errors: function () { return nErr; }, lastExit: '' };
    try { xr.setFramebufferScaleFactor(Math.min(1, o.scale || 0.9)); } catch (e) { /* ignore */ }
    try { xr.setFoveation(1); } catch (e) { /* ignore */ }

    // ---- the Exit VR button (canvas drawn once; hover only tints the material)
    var c = document.createElement('canvas'); c.width = 512; c.height = 200;
    var g = c.getContext('2d');
    g.fillStyle = '#c8202a'; g.beginPath(); if (g.roundRect) g.roundRect(4, 4, 504, 192, 36); else g.rect(4, 4, 504, 192); g.fill();
    g.lineWidth = 8; g.strokeStyle = '#fff'; g.stroke();
    g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = '800 88px system-ui, sans-serif'; g.fillText('Exit VR', 256, 84);
    g.font = '600 32px system-ui, sans-serif'; g.fillText('or press B / Y', 256, 158);
    var tex = new THREE.CanvasTexture(c); if (THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;
    var BW = 0.26, BH = BW * 200 / 512;   // 26 x 10 cm, about 60 cm away
    var btn = new THREE.Mesh(new THREE.PlaneGeometry(BW, BH), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false, fog: false, toneMapped: false }));
    btn.name = 'imhere-exit-vr'; btn.renderOrder = 99999; btn.frustumCulled = false; btn.visible = false; btn.matrixAutoUpdate = false;
    var rayMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, depthTest: false, fog: false, toneMapped: false });
    var rays = [0, 1].map(function () {
      var l = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, -1)]), rayMat);
      l.visible = false; l.frustumCulled = false; l.renderOrder = 99998; l.matrixAutoUpdate = false; return l;
    });
    var usePanel = o.panel !== false;
    var exitBtns = o.exitButtons || [4, 5];
    api.exitTargets = (o.exitTargets || []).slice();
    // ---- optional entry hint (canvas drawn once; opacity fades)
    var hint = null, hintAt = 0, hintPlaced = false;
    if (o.hint) {
      var hc = document.createElement('canvas'); hc.width = 512; hc.height = 72;
      var hg = hc.getContext('2d');
      hg.fillStyle = 'rgba(10,18,32,0.78)'; hg.beginPath(); if (hg.roundRect) hg.roundRect(2, 2, 508, 68, 34); else hg.rect(2, 2, 508, 68); hg.fill();
      hg.fillStyle = '#fff'; hg.textAlign = 'center'; hg.textBaseline = 'middle'; hg.font = '500 30px system-ui, sans-serif';
      hg.fillText(String(o.hint), 256, 37);
      var htex = new THREE.CanvasTexture(hc); if (THREE.SRGBColorSpace) htex.colorSpace = THREE.SRGBColorSpace;
      hint = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.3 * 72 / 512), new THREE.MeshBasicMaterial({ map: htex, transparent: true, opacity: 1, depthTest: false, depthWrite: false, fog: false, toneMapped: false }));
      hint.name = 'imhere-exit-hint'; hint.renderOrder = 99997; hint.frustumCulled = false; hint.visible = false; hint.matrixAutoUpdate = false;
      api.hint = hint;
    }
    var holder = null;   // the camera's parent (the rig / dolly): WebXR poses are in its space
    function attach() {
      var p = (o.camera && o.camera.parent) || o.scene;
      if (!p || holder === p) return; holder = p;
      p.add(btn); if (hint) p.add(hint); if (o.rays) rays.forEach(function (l) { p.add(l); });
    }

    // ---- exit
    var ending = 0;
    function exit(reason) {
      var s = null; try { s = xr.getSession && xr.getSession(); } catch (e) { /* ignore */ }
      if (!s) return;
      api.lastExit = reason;
      try { console.warn('[I\'M HERE VR] exit: ' + reason); } catch (e) { /* ignore */ }
      if (o.onExit) try { o.onExit(reason); } catch (e) { logErr('onExit', e); }
      try { var p = s.end(); if (p && p.catch) p.catch(function (e) { logErr('session.end', e); }); } catch (e) { logErr('session.end', e); }
      clearTimeout(ending);
      ending = setTimeout(function () {   // still in the same session? try once more
        var s2 = null; try { s2 = xr.getSession && xr.getSession(); } catch (e) { /* ignore */ }
        if (s2 === s) { try { var p2 = s.end(); if (p2 && p2.catch) p2.catch(function () {}); } catch (e) { logErr('session.end retry', e); } }
      }, 1200);
    }
    api.exit = exit;

    // ---- per-frame: button placement, input, hit testing (all in the rig's local space; preallocated temporaries)
    var Minv = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(),
      lo = new THREE.Vector3(), ld = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1), sc = new THREE.Vector3(), e3 = new THREE.Euler();
    var TM = new THREE.Matrix4(), TMinv = new THREE.Matrix4();
    var PL = { right: 0.24, down: 0.24, ahead: 0.6 }; if (o.place) for (var k in o.place) PL[k] = o.place[k];
    var anchorYaw = null, prevDown = [false, false, false, false], hovered = false, invOk = false;
    function refSpace() { try { return xr.getReferenceSpace(); } catch (e) { return null; } }
    function inv() { if (!invOk) { Minv.copy(btn.matrix).invert(); invOk = true; } return Minv; }
    function shown(obj) { for (var x = obj; x; x = x.parent) { if (!x.visible) return false; if (x === holder) return true; } return true; }
    function targetInv(obj) {   // a page target's matrix in the rig's space (from its last rendered matrixWorld), inverted
      TM.copy(holder.matrixWorld).invert().multiply(obj.matrixWorld); return TMinv.copy(TM).invert();
    }
    // distance (rig units) along the pointing ray to the rectangle (cx, cy, hw, hh) in the plane of Mi's space, or -1
    function rayHitIn(frame, src, ref, Mi, cx, cy, hw, hh) {
      var pose = frame.getPose(src.targetRaySpace, ref); if (!pose) return -1;
      var p = pose.transform.position, r = pose.transform.orientation;
      q.set(r.x, r.y, r.z, r.w);
      lo.set(p.x, p.y, p.z); ld.set(0, 0, -1).applyQuaternion(q).add(lo);
      lo.applyMatrix4(Mi); ld.applyMatrix4(Mi).sub(lo);   // unnormalised: t stays in rig units
      if (Math.abs(ld.z) < 1e-9) return -1;
      var t = -lo.z / ld.z; if (t <= 0 || t > 6) return -1;
      var x = lo.x + ld.x * t - cx, y = lo.y + ld.y * t - cy;
      return Math.abs(x) <= hw + 0.01 && Math.abs(y) <= hh + 0.01 ? t : -1;
    }
    function pokeIn(frame, src, ref, Mi, cx, cy, hw, hh) {   // index fingertip pressed into the rectangle (hand tracking)
      if (!src.hand || !frame.getJointPose) return false;
      var j = src.hand.get && src.hand.get('index-finger-tip'); if (!j) return false;
      var jp = frame.getJointPose(j, ref); if (!jp) return false;
      var p = jp.transform.position; lo.set(p.x, p.y, p.z).applyMatrix4(Mi);
      return Math.abs(lo.x - cx) <= hw && Math.abs(lo.y - cy) <= hh && lo.z < 0.015 && lo.z > -0.04;
    }
    // what this input source points at / pokes: { t, obj } (obj null = the big panel); hit.t = -1 when nothing
    var hit = { t: -1, obj: null, poke: false };
    function probe(frame, src, ref) {
      hit.t = -1; hit.obj = null; hit.poke = false;
      if (usePanel && btn.visible) {
        if (pokeIn(frame, src, ref, inv(), 0, 0, BW / 2, BH / 2)) { hit.poke = true; hit.t = 0.01; return hit; }
        var t0 = rayHitIn(frame, src, ref, inv(), 0, 0, BW / 2, BH / 2); if (t0 > 0) { hit.t = t0; }
      }
      for (var i = 0; i < api.exitTargets.length && holder; i++) {
        var ob = api.exitTargets[i], R = ob && ob.userData && ob.userData.exitRect;
        if (!R || !shown(ob) || (ob.userData.exitIgnore && ob.userData.exitIgnore === src.handedness)) continue;
        var Mi = targetInv(ob);
        if (pokeIn(frame, src, ref, Mi, R.cx, R.cy, R.w / 2, R.h / 2)) { hit.poke = true; hit.t = 0.01; hit.obj = ob; return hit; }
        var t1 = rayHitIn(frame, src, ref, Mi, R.cx, R.cy, R.w / 2, R.h / 2);
        if (t1 > 0 && (hit.t < 0 || t1 < hit.t)) { hit.t = t1; hit.obj = ob; }
      }
      return hit;
    }
    function setTargetHover(ob, on) {
      if (!!ob.userData._exitHov === on) return; ob.userData._exitHov = on;
      if (ob.userData.onExitHover) try { ob.userData.onExitHover(on); } catch (e) { logErr('onExitHover', e); }
    }
    function placeButton(frame, ref) {   // follows the head's yaw lazily: about 0.6 m ahead, low and to the right
      var vp = frame.getViewerPose(ref); if (!vp) return;
      var tp = vp.transform.position, to = vp.transform.orientation;
      e3.setFromQuaternion(q.set(to.x, to.y, to.z, to.w), 'YXZ');
      var yaw = e3.y;
      if (hint && !hintPlaced) {   // the entry hint: fixed in the rig, ahead of where you look when VR starts
        hintPlaced = true; hintAt = performance.now();
        v.set(tp.x - Math.sin(yaw) * 0.8, tp.y - 0.12, tp.z - Math.cos(yaw) * 0.8);
        hint.matrix.compose(v, q.setFromEuler(e3.set(0.15, yaw, 0, 'YXZ')), one); hint.matrixWorldNeedsUpdate = true;
        hint.material.opacity = 1; hint.visible = true;
      }
      if (hint && hint.visible) {
        var age = performance.now() - hintAt;
        if (age > 4000) hint.visible = false; else hint.material.opacity = age < 3000 ? 1 : 1 - (age - 3000) / 1000;
      }
      if (!usePanel) return;
      if (anchorYaw === null) anchorYaw = yaw;
      var dy = Math.atan2(Math.sin(yaw - anchorYaw), Math.cos(yaw - anchorYaw));
      if (Math.abs(dy) > 0.45) anchorYaw += dy - (dy > 0 ? 0.45 : -0.45);   // never more than ~26 deg from where you look
      else anchorYaw += dy * 0.02;
      var cy = Math.cos(anchorYaw), sy = Math.sin(anchorYaw);
      v.set(tp.x - sy * PL.ahead + cy * PL.right, tp.y - PL.down, tp.z - cy * PL.ahead - sy * PL.right);
      q.setFromEuler(e3.set(-0.35, anchorYaw, 0, 'YXZ'));
      btn.matrix.compose(v, q, one); btn.matrixWorldNeedsUpdate = true; invOk = false;
      btn.visible = true;
    }
    function inputStep(frame) {
      var s = frame.session, ref = refSpace(); if (!ref) return;
      attach();
      placeButton(frame, ref);
      var hov = false, ri = 0, srcs = s.inputSources, hovObj = null;
      for (var i = 0; i < srcs.length; i++) {
        var src = srcs[i];
        // B / Y on xr-standard controllers (gamepad buttons 5, and 4 = A / X unless the page chose exitButtons): exit on press
        var gp = src.gamepad, down = false;
        if (gp && !src.hand && gp.buttons) for (var b = 0; b < exitBtns.length; b++) { var gb = gp.buttons[exitBtns[b]]; if (gb && gb.pressed) down = true; }
        var was = i < 4 ? prevDown[i] : false; if (i < 4) prevDown[i] = down;
        if (down && !was) { exit('B/Y button'); return; }
        var h = probe(frame, src, ref);
        if (h.poke) { exit('fingertip on Exit VR'); return; }
        var t = h.t;
        if (t > 0) { if (h.obj) hovObj = h.obj; else hov = true; }
        if (o.rays && ri < 2) {
          var l = rays[ri++], pose = frame.getPose(src.targetRaySpace, ref);
          if (pose) {
            var p = pose.transform.position, r = pose.transform.orientation, len = t > 0 ? t : 1.5;
            l.matrix.compose(v.set(p.x, p.y, p.z), q.set(r.x, r.y, r.z, r.w), sc.set(1, 1, len));
            l.matrixWorldNeedsUpdate = true; l.visible = true;
          } else l.visible = false;
        }
      }
      for (; ri < 2; ri++) rays[ri].visible = false;
      if (hov !== hovered) { hovered = hov; btn.material.color.setHex(hov ? 0xffd0d0 : 0xffffff); }
      for (var k2 = 0; k2 < api.exitTargets.length; k2++) if (api.exitTargets[k2]) setTargetHover(api.exitTargets[k2], api.exitTargets[k2] === hovObj);
    }
    function onSelectStart(ev) {   // trigger or pinch while pointing at Exit VR (the panel or a page exit target)
      try {
        var ref = refSpace(); if (!ref || !ev.frame) return;
        if (probe(ev.frame, ev.inputSource, ref).t > 0) exit('Exit VR pressed');
      } catch (e) { logErr('selectstart', e); }
    }

    // ---- watchdog (ring buffer of the last 2 s of frames; no allocations)
    var RING = 256, ringT = new Float64Array(RING), ringDt = new Float32Array(RING);
    var W = { start: 0, last: 0, head: 0, n: 0, levelAt: 0, big0: 0, big1: 0, timer: 0, errRun: 0, errSince: 0 };
    function resetHist() { W.head = 0; W.n = 0; W.last = 0; }
    function setLevel(n, why) {
      if (n <= api.level) return;
      api.level = n; W.levelAt = performance.now(); resetHist();
      try { console.warn('[I\'M HERE VR] quality level ' + n + ': ' + why); } catch (e) { /* ignore */ }
      if (o.onQuality) try { o.onQuality(n); } catch (e) { logErr('onQuality', e); }
    }
    function stopVR(why) {
      showMsg('VR was closed to keep your headset responsive (' + why + '). You can press Enter VR to go back in.');
      exit('watchdog: ' + why);
    }
    function watch(now) {
      if (!W.last) { W.last = now; return; }
      var dt = now - W.last; W.last = now;
      if (now - W.start < 4000) return;   // grace: shader compiles and loading right after entering VR
      if (dt > 1000) {
        if (now - W.big1 < 10000) { stopVR('frames took over 1 second'); return; }
        W.big0 = W.big1; W.big1 = now;
      }
      ringT[W.head] = now; ringDt[W.head] = dt; W.head = (W.head + 1) % RING; if (W.n < RING) W.n++;
      if (now - W.levelAt < 2500 || api.level >= 2) return;
      // share of the last 2 s spent in frames over 50 ms (time-weighted, so it also works at a few frames per second)
      var n = 0, all = 0, slow = 0;
      for (var i = 1; i <= W.n; i++) { var j = (W.head - i + RING) % RING; if (now - ringT[j] > 2000) break; n++; all += ringDt[j]; if (ringDt[j] > 50) slow += ringDt[j]; }
      if (n >= 3 && all > 1500 && slow / all > 0.6) setLevel(api.level + 1, 'frames over 50 ms');
    }

    // ---- the frame loop wrapper
    var orig = renderer.setAnimationLoop.bind(renderer);
    renderer.setAnimationLoop = function (cb) {
      if (!cb) return orig(null);
      return orig(function (time, frame) {
        var presenting = xr.isPresenting;
        if (presenting && frame) {
          try { if (frame.session.visibilityState === 'visible') watch(performance.now()); else W.last = 0; } catch (e) { logErr('watchdog', e); }
          try { inputStep(frame); } catch (e) { logErr('exit controls', e); }
        }
        try { cb(time, frame); W.errRun = 0; }
        catch (e) {
          logErr('frame', e);
          if (presenting) {
            var now = performance.now();
            if (!W.errRun++) W.errSince = now;
            else if (now - W.errSince > 2000) { W.errRun = 0; stopVR('the page kept failing to draw'); }
            if (o.scene && o.camera) { try { renderer.render(o.scene, o.camera); } catch (e2) { /* ignore */ } }
          }
        }
      });
    };

    function onVis() { resetHist(); W.big1 = 0; }
    xr.addEventListener('sessionstart', function () {
      var s = xr.getSession();
      api.level = 0; anchorYaw = null; hovered = false; hintPlaced = false; prevDown[0] = prevDown[1] = prevDown[2] = prevDown[3] = false;
      W.start = performance.now(); resetHist(); W.big0 = W.big1 = 0; W.levelAt = 0; W.errRun = 0;
      try { xr.setFoveation(1); } catch (e) { /* ignore */ }
      api.shadow = renderer.shadowMap.enabled; renderer.shadowMap.enabled = false;
      if (s) { s.addEventListener('selectstart', onSelectStart); s.addEventListener('visibilitychange', onVis); }
      attach();
      clearInterval(W.timer);
      W.timer = setInterval(function () {   // the loop stopped delivering frames altogether
        var s1 = null; try { s1 = xr.getSession && xr.getSession(); } catch (e) { /* ignore */ }
        if (!xr.isPresenting || !s1 || s1.visibilityState !== 'visible') { W.last = 0; return; }   // system menu open / headset off
        var now = performance.now();
        if (W.last && now - W.last > 2500 && now - W.start > 6000) stopVR('no frames for 2.5 seconds');
      }, 500);
    });
    xr.addEventListener('sessionend', function () {
      clearInterval(W.timer); clearTimeout(ending);
      btn.visible = false; if (hint) hint.visible = false; rays.forEach(function (l) { l.visible = false; });
      api.exitTargets.forEach(function (t) { if (t) setTargetHover(t, false); });
      if (api.shadow) renderer.shadowMap.enabled = true;
      if (api.level && o.onQuality) try { o.onQuality(0); } catch (e) { logErr('onQuality', e); }
      api.level = 0;
    });
    api.button = btn; api.renderer = renderer;
    api.sessionInit = { optionalFeatures: ['hand-tracking'] };
    window.ImHereXR.current = api;   // for tests and the console
    return api;
  }
  window.ImHereXR = { install: install, showMessage: showMsg };
})();
