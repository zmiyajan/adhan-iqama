// GET /radio → {"url": "https://nXX.radiojar.com/…"}: the live audio node for Saudi Quran Radio, looked up at the edge.
// The public link answers with a redirect to an http:// node carrying a short token; resolving it here lets the page
// open the https node directly when the button is tapped (one connection instead of two, and no http on iPhone).
const UPSTREAM = "https://stream.radiojar.com/0tpy1h0kxtzuv";

export async function onRequest() {
  try {
    const r = await fetch(UPSTREAM, { redirect: "manual" });
    const loc = r.headers.get("location");
    if (r.body) r.body.cancel();
    if (loc) {
      return Response.json({ url: loc.replace(/^http:/, "https:") }, { headers: { "cache-control": "no-store" } });
    }
  } catch (e) {}
  return Response.json({ url: null }, { status: 502, headers: { "cache-control": "no-store" } });
}
