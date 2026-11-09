const SITE = "https://dareklaviolette-eng.github.io";
const FEEDS = ["https://api.adsb.lol/v2/", "https://opendata.adsb.fi/api/v2/"];
const ALLOWED = /^\/(lat\/-?[\d.]+\/lon\/-?[\d.]+\/dist\/\d+|hex\/[0-9a-fA-F]{6})$/;

export default {
  async fetch(request) {
    const headers = {
      "Access-Control-Allow-Origin": SITE,
      "Content-Type": "application/json",
      "Cache-Control": "no-store"
    };
    const path = new URL(request.url).pathname;
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
