// /api/subscribe — Web Push subscribers for the cron Worker (worker/), kept in D1 (binding DB, table subs).
//   POST   {subscription, settings}       save or update this phone
//   POST   {subscription, oldEndpoint}    the browser renewed its subscription (sw.js): move the settings over
//   DELETE {endpoint}  or  ?endpoint=     forget this phone
//   GET    ?endpoint=                     {"exists": true|false}
import { cleanSettings, cleanSubscription, validEndpoint } from "../../worker/src/settings.js";

const MAX_BODY = 4096;
const json = (data, status = 200) => Response.json(data, { status, headers: { "cache-control": "no-store" } });

// The body as JSON, read with a hard size limit (content-length alone can be missing or wrong).
async function readJson(request) {
  if (!request.body) return null;
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_BODY) { reader.cancel(); throw new Error("too large"); }
    chunks.push(value);
  }
  if (size === 0) return null;
  const all = new Uint8Array(size);
  let i = 0;
  for (const c of chunks) { all.set(c, i); i += c.length; }
  return JSON.parse(new TextDecoder().decode(all));
}

export async function onRequest({ request, env }) {
  const url = new URL(request.url);
  const method = request.method;

  if (method === "GET") {
    const endpoint = validEndpoint(url.searchParams.get("endpoint"));
    if (!endpoint) return json({ error: "endpoint" }, 400);
    const row = await env.DB.prepare("SELECT 1 FROM subs WHERE endpoint = ?").bind(endpoint).first();
    return json({ exists: !!row });
  }

  if (method !== "POST" && method !== "DELETE") return json({ error: "method" }, 405);

  let body = null;
  try { body = await readJson(request); } catch (e) {
    return json({ error: e.message === "too large" ? "too large" : "json" }, e.message === "too large" ? 413 : 400);
  }

  if (method === "DELETE") {
    const endpoint = validEndpoint((body && body.endpoint) || url.searchParams.get("endpoint"));
    if (!endpoint) return json({ error: "endpoint" }, 400);
    await env.DB.prepare("DELETE FROM subs WHERE endpoint = ?").bind(endpoint).run();
    return json({ ok: true });
  }

  const sub = cleanSubscription(body && body.subscription);
  if (!sub) return json({ error: "subscription" }, 400);

  let settings = body.settings ? cleanSettings(body.settings) : null;
  if (body.settings && !settings) return json({ error: "settings" }, 400);
  if (!settings) {
    // A renewed subscription from the service worker carries no settings: take the old row's.
    const old = validEndpoint(body.oldEndpoint);
    const row = old && await env.DB.prepare("SELECT settings FROM subs WHERE endpoint = ?").bind(old).first();
    if (!row) return json({ error: "settings" }, 400);
    settings = JSON.parse(row.settings);
    await env.DB.prepare("DELETE FROM subs WHERE endpoint = ?").bind(old).run();
  }

  await env.DB.prepare(
    `INSERT INTO subs (endpoint, p256dh, auth, settings, updated) VALUES (?1, ?2, ?3, ?4, ?5)
     ON CONFLICT(endpoint) DO UPDATE SET p256dh = ?2, auth = ?3, settings = ?4, updated = ?5`
  ).bind(sub.endpoint, sub.p256dh, sub.auth, JSON.stringify(settings), Date.now()).run();
  return json({ ok: true });
}
