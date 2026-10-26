// Cron Worker: every minute, send each subscriber the adhan/iqama notices due in that minute.
// Subscribers and their settings are in D1 (table subs, written by functions/api/subscribe.js).
import { sendPush } from "./webpush.js";
import { due, ICU_UMALQURA } from "./schedule.js";
import { cleanSettings } from "./settings.js";

export async function run(env, now, log = console.log) {
  const { results } = await env.DB.prepare("SELECT endpoint, p256dh, auth, settings FROM subs").all();
  const vapid = { publicKey: env.VAPID_PUBLIC, privateKey: env.VAPID_PRIVATE, subject: env.VAPID_SUBJECT };
  const dry = env.DRY_RUN === "1";
  const gone = [];
  let sent = 0, failed = 0;

  await Promise.all(results.map(async row => {
    let S;
    try { S = cleanSettings(JSON.parse(row.settings)); } catch (e) {}
    if (!S) return;
    for (const n of due(S, now)) {
      const host = new URL(row.endpoint).host;
      if (dry) { log(`[dry-run] ${host} ${n.tag} | ${n.title} | ${n.body}`); sent++; continue; }
      try {
        const r = await sendPush(row, { title: n.title, body: n.body, tag: n.tag }, vapid, { ttl: n.ttl, topic: n.tag });
        if (r.status === 404 || r.status === 410) { gone.push(row.endpoint); break; }
        if (r.ok) sent++;
        else { failed++; log(`push ${host} ${n.tag}: HTTP ${r.status} ${(await r.text()).slice(0, 200)}`); }
      } catch (e) {
        failed++;
        log(`push ${host} ${n.tag}: ${e.message}`);
      }
    }
  }));

  if (gone.length) await env.DB.batch(gone.map(e => env.DB.prepare("DELETE FROM subs WHERE endpoint = ?").bind(e)));
  log(`${new Date(now).toISOString()} subs=${results.length} sent=${sent} failed=${failed} removed=${gone.length} hijri=${ICU_UMALQURA ? "icu" : "table"}`);
  return { subs: results.length, sent, failed, removed: gone.length };
}

export default {
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(run(env, controller.scheduledTime));
  },
};
