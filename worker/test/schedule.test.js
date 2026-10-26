import { test } from "node:test";
import assert from "node:assert/strict";
import { due, dayEvents, isRamadan, ICU_UMALQURA } from "../src/schedule.js";
import { cleanSettings, cleanSubscription, validEndpoint } from "../src/settings.js";

// Makkah as the page sends it, with the page's defaults.
const MAKKAH = cleanSettings({ lat: 21.4266, lng: 39.8256, tz: "Asia/Riyadh", method: "UmmAlQura",
  iqama: { fajr: 25, dhuhr: 20, asr: 20, maghrib: 10, isha: 20 }, preAdhan: "on", muezzin: "off", warn: "on" });
const at = iso => Date.parse(iso);
const hm = (d, tz = "Asia/Riyadh") => new Intl.DateTimeFormat("en-GB-u-nu-latn", { timeZone: tz, hour: "2-digit", minute: "2-digit" }).format(d);

test("Makkah 2026-10-25: the five adhan times", () => {
  const adhans = dayEvents(MAKKAH, 2026, 10, 25).filter(e => e.kind === "adhan").map(e => hm(e.at));
  assert.deepEqual(adhans, ["05:04", "12:05", "15:22", "17:49", "19:19"]);
});

test("15:17 → «أذان العصر بعد 5 دقائق», 15:40 → iqama warning, 15:18 → nothing", () => {
  assert.deepEqual(due(MAKKAH, at("2026-10-25T15:17:00+03:00")),
    [{ title: "أذان العصر بعد 5 دقائق", body: "الساعة 3:22 م", tag: "preAdhan-asr-2026-10-25", ttl: 300 }]);
  // The cron can start a few seconds into its minute.
  assert.deepEqual(due(MAKKAH, at("2026-10-25T15:40:07+03:00")),
    [{ title: "إقامة العصر بعد دقيقتين", body: "الساعة 3:42 م", tag: "warn-asr-2026-10-25", ttl: 120 }]);
  assert.deepEqual(due(MAKKAH, at("2026-10-25T15:18:00+03:00")), []);
  assert.deepEqual(due(MAKKAH, at("2026-10-25T14:52:00+03:00")), []);   // muezzin is off by default
});

test("each notice fires in exactly one minute of the day", () => {
  const S = { ...MAKKAH, muezzin: "on" };
  const all = [];
  for (let t = at("2026-10-25T00:00:00+03:00"); t < at("2026-10-26T00:00:00+03:00"); t += 6e4) {
    for (const n of due(S, t)) all.push(`${hm(new Date(t))} ${n.title} | ${n.body}`);
  }
  assert.deepEqual(all, [
    "04:34 تذكير المؤذن: أذان الفجر بعد 30 دقيقة | الساعة 5:04 ص",
    "04:59 أذان الفجر بعد 5 دقائق | الساعة 5:04 ص",
    "05:27 إقامة الفجر بعد دقيقتين | الساعة 5:29 ص",
    "11:35 تذكير المؤذن: أذان الظهر بعد 30 دقيقة | الساعة 12:05 م",
    "12:00 أذان الظهر بعد 5 دقائق | الساعة 12:05 م",
    "12:23 إقامة الظهر بعد دقيقتين | الساعة 12:25 م",
    "14:52 تذكير المؤذن: أذان العصر بعد 30 دقيقة | الساعة 3:22 م",
    "15:17 أذان العصر بعد 5 دقائق | الساعة 3:22 م",
    "15:40 إقامة العصر بعد دقيقتين | الساعة 3:42 م",
    "17:19 تذكير المؤذن: أذان المغرب بعد 30 دقيقة | الساعة 5:49 م",
    "17:44 أذان المغرب بعد 5 دقائق | الساعة 5:49 م",
    "17:57 إقامة المغرب بعد دقيقتين | الساعة 5:59 م",
    "18:49 تذكير المؤذن: أذان العشاء بعد 30 دقيقة | الساعة 7:19 م",
    "19:14 أذان العشاء بعد 5 دقائق | الساعة 7:19 م",
    "19:37 إقامة العشاء بعد دقيقتين | الساعة 7:39 م",
  ]);
});

test("switches off: no notices", () => {
  const S = { ...MAKKAH, preAdhan: "off", warn: "off" };
  assert.deepEqual(due(S, at("2026-10-25T15:17:00+03:00")), []);
  assert.deepEqual(due(S, at("2026-10-25T15:40:00+03:00")), []);
});

test("Friday 2026-10-30: Jumu'ah, no Dhuhr iqama", () => {
  const ev = dayEvents(MAKKAH, 2026, 10, 30);
  assert.ok(ev.some(e => e.p.key === "dhuhr" && e.kind === "adhan" && e.jumuah));
  assert.ok(!ev.some(e => e.p.key === "dhuhr" && e.kind === "iqama"));
  const dhuhr = ev.find(e => e.p.key === "dhuhr").at.getTime();
  assert.equal(due(MAKKAH, dhuhr - 5 * 6e4)[0].title, "أذان الجمعة بعد 5 دقائق");
  assert.equal(due({ ...MAKKAH, muezzin: "on" }, dhuhr - 30 * 6e4)[0].title, "تذكير المؤذن: أذان الجمعة بعد 30 دقيقة");
  assert.deepEqual(due(MAKKAH, dhuhr + 18 * 6e4), []);
});

test("Ramadan (2026-03-01): Isha 120 min after Maghrib; 90 outside Ramadan", () => {
  const gap = (y, m, d) => {
    const ev = dayEvents(MAKKAH, y, m, d).filter(e => e.kind === "adhan");
    return (ev[4].at - ev[3].at) / 6e4;
  };
  assert.equal(isRamadan(new Date(2026, 2, 1, 12)), true);
  assert.equal(gap(2026, 3, 1), 120);
  assert.equal(gap(2026, 10, 25), 90);
});

test("Umm al-Qura calendar: ICU is available here, and the fallback table agrees with it every day 2025–2045", () => {
  assert.equal(ICU_UMALQURA, true);
  for (let t = new Date(2025, 0, 1, 12); t.getFullYear() < 2046; t = new Date(t.getFullYear(), t.getMonth(), t.getDate() + 1, 12)) {
    assert.equal(isRamadan(t, false), isRamadan(t, true), t.toDateString());
  }
});

test("another zone and method: London, MuslimWorldLeague", () => {
  const S = cleanSettings({ lat: 51.5072, lng: -0.1276, tz: "Europe/London", method: "MuslimWorldLeague", iqama: {}, preAdhan: "on" });
  const asr = dayEvents(S, 2026, 10, 25).find(e => e.p.key === "asr" && e.kind === "adhan").at;
  const n = due(S, asr.getTime() - 5 * 6e4);
  assert.equal(n.length, 1);
  assert.equal(n[0].title, "أذان العصر بعد 5 دقائق");
  assert.match(n[0].body, /^الساعة \d{1,2}:\d\d [صم]$/);
});

test("settings and subscription checks", () => {
  assert.equal(cleanSettings({ lat: 200, lng: 0, tz: "Asia/Riyadh" }), null);
  assert.equal(cleanSettings({ lat: 21, lng: 39, tz: "Mars/Olympus" }), null);
  assert.equal(cleanSettings({ lat: 21, lng: 39 }), null);
  const s = cleanSettings({ lat: "21.4", lng: 39.8, tz: "Asia/Riyadh", method: "x", iqama: { fajr: 99, asr: -3 }, warn: "maybe" });
  assert.deepEqual(s, { lat: 21.4, lng: 39.8, tz: "Asia/Riyadh", method: "UmmAlQura",
    iqama: { fajr: 60, dhuhr: 20, asr: 0, maghrib: 10, isha: 20 }, preAdhan: "on", muezzin: "off", warn: "on" });

  for (const ok of ["https://fcm.googleapis.com/fcm/send/abc:def", "https://web.push.apple.com/QGuR3jA3eM", "https://updates.push.services.mozilla.com/wpush/v2/gAAA", "https://wns2-par02p.notify.windows.com/w/?token=x"]) {
    assert.equal(validEndpoint(ok), ok);
  }
  for (const bad of ["http://fcm.googleapis.com/x", "https://evil.com/fcm.googleapis.com", "https://fcm.googleapis.com.evil.com/x", "https://user@web.push.apple.com/x", "https://web.push.apple.com:8443/x", "https://127.0.0.1/x", "x".repeat(2000)]) {
    assert.equal(validEndpoint(bad), null, bad);
  }
  const keys = { p256dh: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4", auth: "BTBZMqHH6r4Tts7J_aSIgg" };
  assert.ok(cleanSubscription({ endpoint: "https://web.push.apple.com/abc", keys }));
  assert.equal(cleanSubscription({ endpoint: "https://web.push.apple.com/abc", keys: { ...keys, auth: "AAAA" } }), null);
  assert.equal(cleanSubscription({ endpoint: "https://web.push.apple.com/abc", keys: { ...keys, p256dh: "A" + keys.p256dh.slice(1) } }), null);
});
