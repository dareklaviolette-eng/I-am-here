const SITE = "https://dareklaviolette-eng.github.io";
const FEEDS = ["https://api.adsb.lol/v2/", "https://opendata.adsb.fi/api/v2/"];
const ALLOWED = /^\/(lat\/-?[\d.]+\/lon\/-?[\d.]+\/dist\/\d+|hex\/[0-9a-fA-F]{6})$/;
// Weather for the 737 (live METAR): /metar/ICAO -> aviationweather.gov Data API (used only if the browser cannot reach it)
const METAR = /^\/metar\/([A-Za-z0-9]{3,4})$/;
// Ships for Boats: aisstream.io refuses browser connections, so the page opens a WebSocket here and this
// Worker holds the aisstream key (secret AISSTREAM_KEY) and relays the stream for one bounding box.
//   wss://<worker>/ais?box=lat1,lon1,lat2,lon2   -> aisstream PositionReport + ShipStaticData messages, passed through
//   GET /ais/status                               -> {"ais":true,"key":true|false}  (lets the page explain a failure)
// Control messages to the page: {"relay":"..."} (connected) and {"relayError":"..."} (plain-words reason), then close.
const AIS_UPSTREAM = "https://stream.aisstream.io/v0/stream";
const AIS_MAX_BOX_DEG = 6;

export default {
  async fetch(request, env) {
    const headers = {
      "Access-Control-Allow-Origin": SITE,
      "Content-Type": "application/json",
      "Cache-Control": "no-store"
    };
    const url = new URL(request.url);
    const path = url.pathname;
    if (path === "/ais/status") {
      return new Response(JSON.stringify({ ais: true, key: !!(env && env.AISSTREAM_KEY) }), { headers });
    }
    if (path === "/ais/probe") {
      // Diagnostic: open aisstream for up to 12 s over Los Angeles and report what came back.
      if (!env || !env.AISSTREAM_KEY) return new Response(JSON.stringify({ ok: false, why: "no key" }), { headers });
      const out = { ok: false, opened: false, messages: 0, types: {}, first: null, closed: null, dataKind: null, decodeError: null };
      try {
        const reply = await fetch(AIS_UPSTREAM, { headers: { Upgrade: "websocket", "User-Agent": "imhere-prototype" } });
        const ws = reply.webSocket;
        if (!ws) return new Response(JSON.stringify({ ok: false, why: "upstream HTTP " + reply.status }), { headers });
        ws.accept(); out.opened = true;
        ws.send(JSON.stringify({ APIKey: env.AISSTREAM_KEY, BoundingBoxes: [[[33.3, -118.6], [34.0, -117.9]]] }));
        await new Promise((resolve) => {
          const t = setTimeout(resolve, 20000);
          ws.addEventListener("message", async (e) => {
            out.messages++;
            const d = e.data; out.dataKind = out.dataKind || (typeof d === "string" ? "string" : (d && d.constructor && d.constructor.name) || typeof d);
            let text = "";
            try { text = typeof d === "string" ? d : (d instanceof ArrayBuffer || ArrayBuffer.isView(d)) ? new TextDecoder().decode(d) : (d && typeof d.text === "function") ? await d.text() : String(d); }
            catch (x) { out.decodeError = String(x && x.message || x); }
            if (out.first === null) out.first = text.slice(0, 300);
            try { const j = JSON.parse(text); const k = j.MessageType || (j.error ? "error" : "other"); out.types[k] = (out.types[k] || 0) + 1; } catch (x) {}
            if (out.messages >= 25) { clearTimeout(t); resolve(); }
          });
          ws.addEventListener("close", (e) => { out.closed = e.code + " " + (e.reason || ""); clearTimeout(t); resolve(); });
        });
        try { ws.close(1000, "probe done"); } catch (x) {}
        out.ok = out.messages > 0 && !out.types.error;
      } catch (error) { out.why = String(error && error.message || error); }
      return new Response(JSON.stringify(out, null, 1), { headers });
    }
    if (path === "/ais") {
      return aisRelay(request, env, url, headers);
    }
    const metar = METAR.exec(path);
    if (metar) {
      try {
        const reply = await fetch("https://aviationweather.gov/api/data/metar?format=json&ids=" + metar[1].toUpperCase(), { headers: { "User-Agent": "imhere-prototype" } });
        if (reply.ok) { return new Response(await reply.text(), { headers }); }
      } catch (error) {}
      return new Response('{"error":"metar unavailable"}', { status: 502, headers });
    }
    if (!ALLOWED.test(path)) {
      return new Response('{"error":"not allowed"}', { status: 404, headers });
    }
    for (const feed of FEEDS) {
      try {
        const reply = await fetch(feed + path.slice(1), {
          headers: { "User-Agent": "imhere-prototype" }
        });
        if (reply.ok) { return new Response(await reply.text(), { headers }); }
      } catch (error) {}
    }
    return new Response('{"error":"feeds unavailable"}', { status: 502, headers });
  }
};

function parseBox(text) {
  const n = String(text || "").split(",").map(Number);
  if (n.length !== 4 || !n.every(Number.isFinite)) return null;
  const [la1, lo1, la2, lo2] = n;
  if (Math.abs(la1) > 90 || Math.abs(la2) > 90 || Math.abs(lo1) > 180 || Math.abs(lo2) > 180) return null;
  if (Math.abs(la1 - la2) > AIS_MAX_BOX_DEG || Math.abs(lo1 - lo2) > AIS_MAX_BOX_DEG) return null;
  return [[la1, lo1], [la2, lo2]];
}

async function aisRelay(request, env, url, headers) {
  if ((request.headers.get("Upgrade") || "").toLowerCase() !== "websocket") {
    return new Response('{"error":"WebSocket only: wss://<this worker>/ais?box=lat1,lon1,lat2,lon2"}', { status: 426, headers });
  }
  const origin = request.headers.get("Origin") || "";
  if (origin && origin !== SITE && !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
    return new Response('{"error":"origin not allowed"}', { status: 403, headers });
  }
  // Always accept the page's socket, so a failure can be explained in words (browsers hide HTTP errors on WebSockets).
  const pair = new WebSocketPair();
  const client = pair[0], server = pair[1];
  server.accept();
  const fail = (reason) => {
    try { server.send(JSON.stringify({ relayError: reason })); } catch (e) {}
    try { server.close(1011, reason.slice(0, 120)); } catch (e) {}
  };
  const box = parseBox(url.searchParams.get("box"));
  if (!box) { fail("bad area (box must be lat1,lon1,lat2,lon2, at most " + AIS_MAX_BOX_DEG + " degrees across)"); return new Response(null, { status: 101, webSocket: client }); }
  if (!env || !env.AISSTREAM_KEY) { fail("the relay has no aisstream.io key yet (Worker secret AISSTREAM_KEY is not set)"); return new Response(null, { status: 101, webSocket: client }); }

  let upstream;
  try {
    const reply = await fetch(AIS_UPSTREAM, { headers: { Upgrade: "websocket", "User-Agent": "imhere-prototype" } });
    upstream = reply.webSocket;
    if (!upstream) { fail("aisstream.io did not accept the connection (HTTP " + reply.status + ")"); return new Response(null, { status: 101, webSocket: client }); }
  } catch (error) {
    fail("could not connect to aisstream.io (" + (error && error.message || "network error") + ")");
    return new Response(null, { status: 101, webSocket: client });
  }
  upstream.accept();
  // aisstream closes the socket unless this subscription arrives within 3 seconds.
  upstream.send(JSON.stringify({ APIKey: env.AISSTREAM_KEY, BoundingBoxes: [box], FilterMessageTypes: ["PositionReport", "ShipStaticData"] }));
  try { server.send(JSON.stringify({ relay: "connected to aisstream.io" })); } catch (e) {}

  let open = true;
  const closeBoth = (code, reason) => {
    if (!open) return; open = false;
    try { upstream.close(1000, "done"); } catch (e) {}
    try { server.close(code || 1000, reason || "done"); } catch (e) {}
  };
  upstream.addEventListener("message", async (event) => {
    // aisstream sends JSON as binary frames; turn every frame into text before passing it on.
    let d = event.data;
    try {
      if (typeof d !== "string") {
        if (d instanceof ArrayBuffer || ArrayBuffer.isView(d)) d = new TextDecoder().decode(d);
        else if (d && typeof d.arrayBuffer === "function") d = new TextDecoder().decode(await d.arrayBuffer());
        else d = String(d);
      }
      server.send(d);
    } catch (e) { try { server.send(JSON.stringify({ relayError: "relay could not pass on a ship report (" + (e && e.message || e) + ")" })); } catch (x) {} }
  });
  upstream.addEventListener("close", (event) => {
    if (!open) return;
    const why = "aisstream.io closed the feed (code " + event.code + (event.reason ? ": " + event.reason : "") + ")";
    try { server.send(JSON.stringify({ relayError: why })); } catch (e) {}
    closeBoth(1011, why.slice(0, 120));
  });
  upstream.addEventListener("error", () => {
    if (!open) return;
    try { server.send(JSON.stringify({ relayError: "aisstream.io connection error" })); } catch (e) {}
    closeBoth(1011, "upstream error");
  });
  server.addEventListener("close", () => closeBoth());
  server.addEventListener("error", () => closeBoth());
  return new Response(null, { status: 101, webSocket: client });
}

// Flight relay for the I AM HERE prototype.
